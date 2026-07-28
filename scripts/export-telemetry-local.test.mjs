#!/usr/bin/env node
// The export claims two things that read as obviously true and were both false
// in production: that it survives a failure mid-run, and that it never reports
// success on a partial pull. The first attempt lost 750 MB of progress to a
// gateway error; the second reported success at 1,262 of 6,581 rows. Since the
// export gates an irreversible TRUNCATE, both claims are tested here against a
// stub that fails exactly the way the database did.

import { createServer } from "node:http";
import { rm, readdir, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const TOTAL = 1000;
const rowsFor = (afterId, limit) => Array.from(
  { length: Math.max(0, Math.min(limit, TOTAL - afterId)) },
  (_, i) => ({ id: afterId + i + 1, created_at: `2026-07-2${(afterId + i) % 2 === 0 ? "7" : "8"}T10:00:00Z`, payload: "x".repeat(50) })
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
};

// A stub PostgREST: `health` controls the preflight probe, `dieAfterRows`
// makes the telemetry read fail once that many rows have been served.
function startStub() {
  const state = { health: "up", dieAfterRows: Infinity, served: 0, telemetryHits: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.includes("catalog_sources")) {
      if (state.health === "down") { res.writeHead(521); return res.end("origin down"); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("[]");
    }
    if (!url.pathname.includes("request_logs")) { res.writeHead(200, { "content-range": "0-0/0" }); return res.end("[]"); }
    if (req.headers.prefer?.includes("count=planned")) {
      res.writeHead(200, { "content-range": `0-0/${TOTAL}`, "content-type": "application/json" });
      return res.end("[]");
    }
    state.telemetryHits += 1;
    if (state.served >= state.dieAfterRows) { res.writeHead(521); return res.end("origin down"); }
    const after = Number((url.searchParams.get("id") || "gt.0").replace("gt.", "")) || 0;
    const rows = rowsFor(after, Number(url.searchParams.get("limit")) || 500);
    state.served += rows.length;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(rows));
  });
  return { server, state };
}

async function localIds(dest) {
  const files = (await readdir(resolve(dest, "request_logs")).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
  const ids = [];
  for (const file of files) {
    const text = await readFile(resolve(dest, "request_logs", file), "utf8");
    for (const line of text.split("\n").filter(Boolean)) ids.push(JSON.parse(line).id);
  }
  return ids;
}

async function main() {
  const dest = await mkdtemp(resolve(tmpdir(), "telemetry-export-test-"));
  const { server, state } = startStub();
  await new Promise((r) => server.listen(0, r));
  process.env.TELEMETRY_EXPORT_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub";

  const module = await import("./export-telemetry-local.mjs");
  const args = ["--apply", "--skip-preflight", "--only", "request_logs", "--dest", dest];
  const quiet = () => {};

  console.log("resume after a mid-run failure:");
  state.dieAfterRows = 400; // refuse the second page
  const error = await module.main(args).then(() => null).catch((e) => e);
  check("run 1 throws rather than reporting success", Boolean(error), String(error?.message || "").slice(0, 30));
  const afterCrash = await localIds(dest);
  check("run 1 keeps the rows it did fetch", afterCrash.length === 500, `${afterCrash.length} rows`);

  state.dieAfterRows = Infinity;
  const code = await module.main(args);
  const final = await localIds(dest);
  check("run 2 exits clean", code === 0, `exit ${code}`);
  check("no row lost", new Set(final).size === TOTAL, `${new Set(final).size}/${TOTAL} distinct`);
  check("no row duplicated", final.length === TOTAL, `${final.length} lines`);

  console.log("\nstability preflight:");
  state.health = "down";
  const down = await module.waitForStableDatabase("stub", { probes: 4, spacingMs: 1, log: quiet });
  check("a 521 origin is refused", down.stable === false && down.failedProbe === 1);
  const blockedDest = resolve(dest, "blocked");
  const hitsBefore = state.telemetryHits;
  const blocked = await module.main(["--apply", "--only", "request_logs", "--dest", blockedDest]);
  check("main aborts with exit 1", blocked === 1, `exit ${blocked}`);
  check("no telemetry read is attempted", state.telemetryHits === hitsBefore, `${state.telemetryHits - hitsBefore} reads`);

  state.health = "up";
  const up = await module.waitForStableDatabase("stub", { probes: 3, spacingMs: 1, log: quiet });
  check("a healthy origin passes", up.stable === true);

  console.log("\npacing backs off under load:");
  check("a slow page widens the delay", module.nextPace(250, 5_000) === 500);
  check("backoff is capped", module.nextPace(4_000, 9_000) === 5_000);
  check("a fast page relaxes toward the floor", module.nextPace(250, 300) === 250);

  server.close();
  await rm(dest, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failing` : "\nall passing");
  return failures ? 1 : 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e); process.exitCode = 1; });
