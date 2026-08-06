#!/usr/bin/env node
// Apply the set_or_insert proposals produced by measure-thin-row-backfill.mjs.
//
//   node scripts/apply-thin-row-backfill.mjs /tmp/thin-backfill.json            (dry run)
//   node scripts/apply-thin-row-backfill.mjs /tmp/thin-backfill.json --apply
//   node scripts/apply-thin-row-backfill.mjs --rollback /tmp/thin-backfill-undo.json --apply
//
// Every write records the prior value first, so the whole batch can be put back
// exactly as it was. The proposals only ever fill a column that is currently
// empty, so a rollback restores NULL and nothing else is disturbed.
//
// Writes are refused when the target row's set_or_insert is no longer empty:
// the proposal was computed against a snapshot, and a row that has since been
// filled by an official checklist import carries better evidence than a phrase
// matched out of a marketplace title.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BATCH = 50;

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function patchRow(base, key, id, patch) {
  const response = await fetch(`${base}/rest/v1/catalog_cards?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error(`patch ${id} http_${response.status}: ${(await response.text()).slice(0, 160)}`);
}

async function readCurrent(base, key, ids) {
  const query = `id=in.(${ids.map((id) => `"${id}"`).join(",")})`;
  const response = await fetch(`${base}/rest/v1/catalog_cards?select=id,set_or_insert&${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) throw new Error(`read http_${response.status}: ${(await response.text()).slice(0, 160)}`);
  return new Map((await response.json()).map((row) => [String(row.id), row]));
}

export async function main(argv = process.argv.slice(2)) {
  // No fallback ref. This script WRITES, and the literal that used to sit here
  // named a project that was decommissioned -- an unset SUPABASE_URL would have
  // sent a backfill at a dead host and failed as DNS noise rather than as the
  // misconfiguration it was.
  const base = cleanText(process.env.SUPABASE_URL);
  if (!base) throw new Error("SUPABASE_URL is required: there is no default project");
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  const apply = argv.includes("--apply");
  const rollbackPath = argValue(argv, "--rollback", "");
  const inputPath = rollbackPath
    || argv.find((a) => a.endsWith(".json") && !a.startsWith("--") && a !== rollbackPath);
  if (!inputPath) throw new Error("a proposal file (or --rollback <undo.json>) is required");

  const doc = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const rows = rollbackPath
    ? doc.undo.map((u) => ({ id: u.id, proposed: { set_or_insert: u.previous_set_or_insert } }))
    : (doc.proposals || []).filter((p) => cleanText(p.proposed?.set_or_insert));

  console.log(`${rollbackPath ? "rollback" : "backfill"}: ${rows.length} rows  (${apply ? "APPLY" : "dry run"})`);

  const undo = [];
  let written = 0;
  let skippedNotEmpty = 0;
  let missing = 0;

  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const slice = rows.slice(offset, offset + BATCH);
    const current = await readCurrent(base, key, slice.map((r) => r.id));

    for (const row of slice) {
      const live = current.get(String(row.id));
      if (!live) { missing += 1; continue; }
      // On a forward pass only fill what is still empty; a rollback deliberately
      // restores the prior value whatever it is now.
      if (!rollbackPath && cleanText(live.set_or_insert)) { skippedNotEmpty += 1; continue; }
      undo.push({ id: row.id, previous_set_or_insert: live.set_or_insert ?? null });
      if (apply) await patchRow(base, key, row.id, { set_or_insert: row.proposed.set_or_insert });
      written += 1;
    }
    process.stderr.write(`  ${Math.min(offset + BATCH, rows.length)}/${rows.length}\r`);
  }

  console.log(`\n  ${apply ? "written" : "would write"}: ${written}`);
  if (skippedNotEmpty) console.log(`  skipped (already filled since the snapshot): ${skippedNotEmpty}`);
  if (missing) console.log(`  skipped (row no longer present): ${missing}`);

  if (apply && !rollbackPath) {
    const undoPath = resolve(inputPath.replace(/\.json$/, "") + "-undo.json");
    await writeFile(undoPath, `${JSON.stringify({
      schema_version: "thin-row-backfill-undo-v1",
      generated_at: new Date().toISOString(),
      source: inputPath,
      undo
    })}\n`, "utf8");
    console.log(`  undo written -> ${undoPath}`);
    console.log(`  to revert: node scripts/apply-thin-row-backfill.mjs --rollback ${undoPath} --apply`);
  }
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
