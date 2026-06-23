import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableManifestHash, validateRecognitionDataset } from "../lib/listing/recognition/recognition-dataset.mjs";

const schemaVersion = "agnes-supabase-feedback-shard-plan-v1";
const defaultInputPath = "data/recognition/manifests/supabase-feedback-candidates.json";
const defaultOutDir = "data/eval/agnes-supabase-feedback-shards/current";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function numberArg(argv, name, fallback) {
  const raw = argValue(argv, name, "");
  if (raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function imageBackedItems(dataset = {}) {
  return (Array.isArray(dataset.items) ? dataset.items : [])
    .filter((item) => Array.isArray(item.images) && item.images.some((image) => image?.bucket && image?.object_path));
}

function shardItems(items = [], shardCount = 1) {
  const shards = Array.from({ length: shardCount }, () => []);
  items.forEach((item, index) => {
    shards[index % shardCount].push(item);
  });
  return shards;
}

function shardSummary(items = []) {
  const buckets = [...new Set(items.flatMap((item) => (item.images || []).map((image) => image.bucket).filter(Boolean)))].sort();
  return {
    item_count: items.length,
    front_image_items: items.filter((item) => item.images?.some((image) => image.role === "front_original")).length,
    back_image_items: items.filter((item) => item.images?.some((image) => image.role === "back_original")).length,
    buckets,
    review_status: "NEEDS_REVIEW",
    corrected_title_used_as_ground_truth: false,
    validation_error_count: validateRecognitionDataset(items).length
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, payload) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function shardAgnesSupabaseFeedbackDataset({
  dataset,
  outDir = defaultOutDir,
  shardCount = 4,
  limit = 0,
  now = () => new Date(),
  write = true
} = {}) {
  const allItems = imageBackedItems(dataset);
  const selectedItems = limit > 0 ? allItems.slice(0, limit) : allItems;
  const boundedShardCount = Math.max(1, Math.min(Math.floor(Number(shardCount) || 1), selectedItems.length || 1));
  const shards = shardItems(selectedItems, boundedShardCount);
  const generatedAt = now().toISOString();
  const sourceManifestHash = dataset.manifest_hash || stableManifestHash(allItems);
  const outDirPath = resolve(outDir);
  const shardPayloads = shards.map((items, index) => {
    const shardPath = join(outDirPath, `shard-${index}.json`);
    return {
      path: shardPath,
      payload: {
        schema_version: dataset.schema_version || "recognition-candidate-export-v1",
        source: {
          ...(dataset.source || {}),
          source_manifest_hash: sourceManifestHash,
          shard_index: index,
          shard_count: boundedShardCount,
          full_image_backed_item_count: allItems.length
        },
        generated_at: generatedAt,
        manifest_hash: stableManifestHash(items),
        summary: shardSummary(items),
        items
      }
    };
  });
  const plan = {
    schema_version: schemaVersion,
    generated_at: generatedAt,
    source_manifest_hash: sourceManifestHash,
    total_items: allItems.length,
    selected_items: selectedItems.length,
    shard_count: boundedShardCount,
    shards: shardPayloads.map(({ path, payload }, index) => ({
      index,
      count: payload.items.length,
      dataset_path: path,
      report_path: join(outDirPath, `report-${index}.json`)
    }))
  };

  if (write) {
    await mkdir(outDirPath, { recursive: true });
    await Promise.all(shardPayloads.map(({ path, payload }) => writeJson(path, payload)));
    await writeJson(join(outDirPath, "plan.json"), plan);
  }

  return {
    plan,
    shards: shardPayloads
  };
}

export async function main(argv = process.argv) {
  const inputPath = argValue(argv, "--input", process.env.AGNES_SUPABASE_FEEDBACK_SHARD_INPUT || defaultInputPath);
  const outDir = argValue(argv, "--out-dir", process.env.AGNES_SUPABASE_FEEDBACK_SHARD_OUT_DIR || defaultOutDir);
  const shardCount = numberArg(argv, "--shard-count", Number(process.env.AGNES_SUPABASE_FEEDBACK_SHARD_COUNT || 4));
  const limit = numberArg(argv, "--limit", Number(process.env.AGNES_SUPABASE_FEEDBACK_SHARD_LIMIT || 0));
  const dryRun = hasFlag(argv, "--dry-run");
  const dataset = await readJson(inputPath);
  const result = await shardAgnesSupabaseFeedbackDataset({
    dataset,
    outDir,
    shardCount,
    limit,
    write: !dryRun
  });

  process.stdout.write([
    `Agnes Supabase feedback shard plan ${result.plan.schema_version}`,
    `input: ${resolve(inputPath)}`,
    `out_dir: ${resolve(outDir)}`,
    `total_items: ${result.plan.total_items}`,
    `selected_items: ${result.plan.selected_items}`,
    `shard_count: ${result.plan.shard_count}`,
    ...result.plan.shards.map((shard) => `shard_${shard.index}: ${shard.count}`)
  ].join("\n") + "\n");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Agnes Supabase feedback sharding failed: ${error.message}`);
    process.exit(1);
  });
}
