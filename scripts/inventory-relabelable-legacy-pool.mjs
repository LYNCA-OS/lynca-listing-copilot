import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const schemaVersion = "legacy-relabel-inventory-v1";
const defaultOut = "artifacts/legacy-relabel-inventory-2026-08-02.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] || fallback) : fallback;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function inspectSource(source) {
  const datasetPath = resolve(source.dataset);
  const labelsPath = resolve(source.labels);
  const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
  const labelLines = (await readFile(labelsPath, "utf8"))
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const labels = new Map(labelLines.map((row) => [clean(row.key), row]));
  const items = Array.isArray(dataset.items) ? dataset.items : [];
  const imageRows = items.flatMap((item) => Array.isArray(item.images) ? item.images : []);
  const materialized = imageRows.filter((image) => existsSync(image.local_path));
  const missing = imageRows.filter((image) => !existsSync(image.local_path));
  const policy = dataset.intake_policy || {};
  const policySafe = {
    image_only: policy.image_only === true,
    seller_titles_are_ground_truth: policy.seller_titles_are_ground_truth === true,
    ebay_answer_key_is_reviewed_ground_truth: policy.ebay_answer_key_is_reviewed_ground_truth === true,
    title_derived_catalog_import_allowed: policy.title_derived_catalog_import_allowed === true,
    requires_writer_review_before_approved_reference: policy.requires_writer_review_before_approved_reference === true
  };

  return {
    source_id: source.id,
    dataset_path: datasetPath,
    labels_path: labelsPath,
    dataset_sha256: await sha256(datasetPath),
    labels_sha256: await sha256(labelsPath),
    declared_cards: Number(dataset.item_count || items.length),
    item_rows: items.length,
    label_rows: labelLines.length,
    labels_matching_item_refs: items.filter((item) => labels.has(clean(item.sealed_eval_label_ref?.key))).length,
    image_rows: imageRows.length,
    materialized_images: materialized.length,
    missing_images: missing.length,
    all_images_materialized: imageRows.length > 0 && missing.length === 0,
    policy: policySafe,
    review_status_counts: items.reduce((counts, item) => {
      const status = clean(item.review_status) || "UNSPECIFIED";
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {}),
    accuracy_eval_eligible: false,
    relabel_ready: items.length > 0
      && labelLines.length === items.length
      && imageRows.length > 0
      && missing.length === 0
      && policySafe.seller_titles_are_ground_truth === false
      && policySafe.ebay_answer_key_is_reviewed_ground_truth === false,
    next_action: "obtain_sealed_reviewed_reference_labels_without_model_or_seller_title_visibility"
  };
}

export async function inventoryRelabelableLegacyPool({ sources, now = () => new Date() } = {}) {
  const rows = [];
  const errors = [];
  for (const source of sources || []) {
    try {
      rows.push(await inspectSource(source));
    } catch (error) {
      errors.push({ source_id: source.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    schema_version: schemaVersion,
    created_at: now().toISOString(),
    purpose: "read_only_inventory_for_human_or_official_relabeling",
    accuracy_gate_policy: {
      accuracy_eval_eligible: false,
      seller_titles_are_not_ground_truth: true,
      requires_sealed_reviewed_reference: true,
      no_titles_exported: true,
      no_images_copied: true
    },
    source_count: rows.length,
    relabel_ready_source_count: rows.filter((row) => row.relabel_ready).length,
    cards_available_for_relabeling: rows.filter((row) => row.relabel_ready).reduce((sum, row) => sum + row.item_rows, 0),
    cards_available_for_accuracy_gate: 0,
    sources: rows,
    errors
  };
}

export async function main(argv = process.argv) {
  const outPath = resolve(argValue(argv, "--out", process.env.LEGACY_RELABEL_INVENTORY_OUT || defaultOut));
  const sources = [
    {
      id: "ebay-c100-cloud-eval-20260707",
      dataset: argValue(argv, "--c100-dataset", "/Users/paidaxin/Documents/lynca-listing-copilot.v2_pai/data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json"),
      labels: argValue(argv, "--c100-labels", "/Users/paidaxin/Documents/lynca-listing-copilot.v2_pai/data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl")
    },
    {
      id: "ebay-image-intake-20260701",
      dataset: argValue(argv, "--intake-dataset", "/Users/paidaxin/Documents/lynca-listing-copilot.v2_pai/data/eval/ebay-reference/ebay-image-intake-dataset-20260701.json"),
      labels: argValue(argv, "--intake-labels", "/Users/paidaxin/Documents/lynca-listing-copilot.v2_pai/data/eval/ebay-reference/ebay-image-intake-sealed-labels-20260701.jsonl")
    }
  ];
  const report = await inventoryRelabelableLegacyPool({ sources });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ out: outPath, source_count: report.source_count, relabel_ready_source_count: report.relabel_ready_source_count, cards_available_for_relabeling: report.cards_available_for_relabeling, cards_available_for_accuracy_gate: report.cards_available_for_accuracy_gate, errors: report.errors.length }, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
