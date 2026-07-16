import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildGoldenTitleRelease } from "../lib/listing/evaluation/golden-title-release.mjs";
import { readV4Rows } from "../lib/listing/v4/session/supabase-rest.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function recordsFromPayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.items)) return payload.items;
  throw new Error("Golden Title input must be an array, { rows }, or { items }.");
}

async function writeJsonl(filePath, rows = []) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function safeTableName(value) {
  const table = String(value || "").trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error("Invalid Supabase feedback table name.");
  return table;
}

function normalizedCutoff(value) {
  const cutoff = String(value || "").trim();
  const parsed = new Date(cutoff);
  if (!cutoff || Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() + 60_000) {
    throw new Error("--cutoff must be a valid, non-future ISO timestamp for a reproducible Supabase release.");
  }
  return parsed.toISOString();
}

function quotedPostgrestValue(value) {
  return '"' + String(value || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

export async function readGoldenRowsAtCutoff({
  table,
  select,
  cutoff,
  pageSize,
  readRows
}) {
  const boundedPageSize = Math.max(1, Math.min(1000, Number(pageSize) || 500));
  const baseSearch = {
    created_at: "lte." + cutoff,
    order: "created_at.asc,id.asc"
  };
  const countResult = await readRows({
    table,
    select: "id",
    count: "exact",
    search: { ...baseSearch, limit: "1" }
  });
  if (!countResult.ok || !Number.isSafeInteger(countResult.count) || countResult.count < 0) {
    throw new Error("golden_title_snapshot_count_unavailable");
  }
  const expectedCount = countResult.count;
  const rows = [];
  const seenIds = new Set();
  let cursorCreatedAt = "";
  let cursorId = "";

  for (let page = 0; rows.length < expectedCount && page < 100_000; page += 1) {
    const search = {
      ...baseSearch,
      limit: String(boundedPageSize)
    };
    if (cursorCreatedAt) {
      search.or = [
        "(created_at.gt.",
        cursorCreatedAt,
        ",and(created_at.eq.",
        cursorCreatedAt,
        ",id.gt.",
        quotedPostgrestValue(cursorId),
        "))"
      ].join("");
    }
    const result = await readRows({ table, select, search });
    if (!result.ok) {
      throw new Error("golden_title_snapshot_page_read_failed:" + (result.error || "unknown_error"));
    }
    const pageRows = Array.isArray(result.rows) ? result.rows : [];
    if (!pageRows.length) break;
    for (const row of pageRows) {
      const id = String(row?.id || "").trim();
      const createdAt = String(row?.created_at || "").trim();
      if (!id || !createdAt || Number.isNaN(Date.parse(createdAt))) {
        throw new Error("golden_title_snapshot_watermark_required");
      }
      if (seenIds.has(id)) throw new Error("golden_title_snapshot_duplicate_id:" + id);
      seenIds.add(id);
      rows.push(row);
      cursorCreatedAt = new Date(createdAt).toISOString();
      cursorId = id;
    }
    if (pageRows.length < boundedPageSize) break;
  }

  const finalCount = await readRows({
    table,
    select: "id",
    count: "exact",
    search: { ...baseSearch, limit: "1" }
  });
  if (!finalCount.ok
      || finalCount.count !== expectedCount
      || rows.length !== expectedCount) {
    throw new Error(
      "golden_title_snapshot_changed_during_export:"
      + rows.length + "/" + expectedCount + "/" + String(finalCount.count)
    );
  }

  return {
    rows,
    snapshot: {
      mode: "CUTOFF_KEYSET_V1",
      cutoff_created_at: cutoff,
      expected_count: expectedCount,
      exported_count: rows.length,
      watermark_created_at: cursorCreatedAt || null,
      watermark_id: cursorId || null,
      order: "created_at.asc,id.asc"
    }
  };
}

async function writeReleaseAtomically({ output, manifestOutput, release }) {
  if (output === manifestOutput) throw new Error("Golden Title data and manifest paths must be different.");
  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(manifestOutput), { recursive: true });
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const temporaryOutput = `${output}${suffix}`;
  const temporaryManifest = `${manifestOutput}${suffix}`;
  try {
    await writeJsonl(temporaryOutput, release.items);
    await writeFile(
      temporaryManifest,
      `${JSON.stringify({ ...release, items: undefined }, null, 2)}\n`
    );
    // The manifest is the commit marker. Remove the old marker before
    // replacing data so consumers never accept a mixed release.
    await rm(manifestOutput, { force: true });
    await rename(temporaryOutput, output);
    await rename(temporaryManifest, manifestOutput);
  } finally {
    await rm(temporaryOutput, { force: true });
    await rm(temporaryManifest, { force: true });
  }
}

export async function runBuildGoldenTitleV1({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const input = argValue(argv, "--input");
  const fromSupabase = argv.includes("--supabase");
  if (!input && !fromSupabase) throw new Error("--input or --supabase is required");
  const output = argValue(argv, "--out", "learning/golden/golden-title-v1.jsonl");
  const manifestOutput = argValue(argv, "--manifest", "learning/golden/golden-title-v1.manifest.json");
  const releaseId = argValue(argv, "--release-id", "golden-title-v1");
  const sourcePolicy = argValue(
    argv,
    "--source-policy",
    fromSupabase ? "WRITER_VERIFIED_SUPABASE" : ""
  ).trim().toUpperCase();
  let records;
  let sourceSnapshot = null;
  if (fromSupabase) {
    if (Number(argValue(argv, "--offset", "0")) !== 0) {
      throw new Error("Golden Title releases cannot start from a non-zero offset.");
    }
    const table = safeTableName(argValue(
      argv,
      "--table",
      env.SUPABASE_RECOGNITION_FEEDBACK_TABLE || "listing_title_feedback"
    ));
    const cutoff = normalizedCutoff(argValue(argv, "--cutoff"));
    const snapshot = await readGoldenRowsAtCutoff({
      table,
      select: "id,generated_title,corrected_title,front_image_url,back_image_url,operator_id,created_at",
      pageSize: Math.max(1, Math.min(1000, Number(argValue(argv, "--limit", "500")) || 500)),
      cutoff,
      readRows: (options) => readV4Rows({ ...options, env, fetchImpl })
    });
    records = snapshot.rows;
    sourceSnapshot = {
      ...snapshot.snapshot,
      table
    };
  } else {
    records = recordsFromPayload(JSON.parse(await readFile(input, "utf8")));
  }
  const release = buildGoldenTitleRelease(records, {
    sourcePolicy,
    releaseId,
    sourceSnapshot
  });
  if (!release.item_count) throw new Error("No writer-verified Golden Title rows passed source policy.");
  await writeReleaseAtomically({ output, manifestOutput, release });
  return release;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBuildGoldenTitleV1().then((release) => {
    console.error(`Golden Title v1: ${release.item_count} verified titles (${release.image_backed_count} image-backed).`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
