import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDatasetPath = "data/eval/ebay-reference/ebay-image-intake-dataset.json";
const defaultOutPath = "data/eval/ebay-reference/ebay-manual-gt-sample.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readJsonl(text = "") {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function sealedLabelMap(path = "") {
  if (!path || !existsSync(resolve(path))) return new Map();
  const rows = readJsonl(await readFile(resolve(path), "utf8"));
  const map = new Map();
  rows.forEach((row) => {
    [
      row.case_id,
      row.asset_id,
      row.candidate_id,
      row.label_key,
      row.key
    ].map(normalizeText).filter(Boolean).forEach((key) => map.set(key, row));
  });
  return map;
}

function labelForItem(item = {}, labels = new Map()) {
  const keys = [
    item.asset_id,
    item.candidate_id,
    item.sealed_eval_label_ref?.key
  ].map(normalizeText).filter(Boolean);
  for (const key of keys) {
    if (labels.has(key)) return labels.get(key);
  }
  return null;
}

function reviewItem(item = {}, labels = new Map()) {
  const label = labelForItem(item, labels);
  return {
    candidate_id: item.asset_id || item.candidate_id || "",
    source_provider: item.source_provider || item.source_record?.source_provider || "",
    image_refs: (Array.isArray(item.images) ? item.images : []).map((image) => ({
      image_id: image.image_id || "",
      role: image.role || "",
      bucket: image.bucket || "",
      object_path: image.object_path || "",
      local_path: image.local_path || "",
      content_sha256: image.content_sha256 || ""
    })),
    fields_to_review: {
      subject: null,
      year: null,
      product_family: null,
      product_or_set: null,
      card_name: null,
      card_number: null,
      collector_number: null,
      checklist_code: null,
      serial_number: null,
      serial_denominator: null,
      grade: null,
      surface_color: null,
      observable_components: [],
      rc: null,
      auto: null,
      patch: null,
      relic: null,
      critical_errors: [],
      safe_draft_acceptability: null
    },
    reviewer_notes: "",
    policy: {
      corrected_title_is_ground_truth: false,
      seller_title_is_ground_truth: false,
      title_visible_to_model: false,
      training_eligible_before_writer_approval: false
    },
    noisy_reference_for_reviewer_only: label
      ? {
        title: label.title || label.seller_title || "",
        item_id: label.item_id || "",
        item_web_url: label.item_web_url || "",
        not_ground_truth: true
      }
      : null
  };
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export async function buildEbayManualGtSample({
  argv = process.argv.slice(2),
  env = process.env,
  now = new Date()
} = {}) {
  const datasetPath = argValue(argv, "--dataset", env.EBAY_MANUAL_GT_DATASET || defaultDatasetPath);
  const sealedLabelsPath = argValue(argv, "--sealed-labels", env.EBAY_MANUAL_GT_SEALED_LABELS || "");
  const outPath = argValue(argv, "--out", env.EBAY_MANUAL_GT_OUT || defaultOutPath);
  const count = numberArg(argv, "--count", Number(env.EBAY_MANUAL_GT_COUNT || 30));
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const labels = await sealedLabelMap(sealedLabelsPath);
  const sourceItems = Array.isArray(dataset.items) ? dataset.items : [];
  const items = sourceItems.slice(0, count).map((item) => reviewItem(item, labels));
  const packet = {
    schema_version: "ebay-manual-gt-sample-v1",
    generated_at: now.toISOString(),
    dataset_path: datasetPath,
    sealed_labels_path: sealedLabelsPath || null,
    item_count: items.length,
    policy: {
      for_manual_review_only: true,
      marketplace_title_is_noisy_reference_only: true,
      marketplace_title_enters_model_prompt: false,
      marketplace_title_enters_training: false,
      training_requires_writer_review: true
    },
    items
  };
  await writeJson(outPath, packet);
  return packet;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildEbayManualGtSample().then((packet) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      schema_version: packet.schema_version,
      item_count: packet.item_count
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
