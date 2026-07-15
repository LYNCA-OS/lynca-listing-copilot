import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildGoldenTitleRelease } from "../lib/listing/evaluation/golden-title-release.mjs";
import { fetchSupabaseFeedbackRows } from "../lib/listing/recognition/supabase-recognition-source.mjs";

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
  if (fromSupabase) {
    const result = await fetchSupabaseFeedbackRows({
      env,
      fetchImpl,
      table: argValue(argv, "--table", env.SUPABASE_RECOGNITION_FEEDBACK_TABLE || "listing_title_feedback"),
      limit: Number(argValue(argv, "--limit", "1000")) || 1000,
      offset: Number(argValue(argv, "--offset", "0")) || 0
    });
    if (!result.ok) throw new Error(`Supabase Golden Title export failed: ${result.reason}`);
    records = result.rows;
  } else {
    records = recordsFromPayload(JSON.parse(await readFile(input, "utf8")));
  }
  const release = buildGoldenTitleRelease(records, { sourcePolicy, releaseId });
  if (!release.item_count) throw new Error("No writer-verified Golden Title rows passed source policy.");
  await writeJsonl(output, release.items);
  await mkdir(dirname(manifestOutput), { recursive: true });
  await writeFile(manifestOutput, `${JSON.stringify({ ...release, items: undefined }, null, 2)}\n`);
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
