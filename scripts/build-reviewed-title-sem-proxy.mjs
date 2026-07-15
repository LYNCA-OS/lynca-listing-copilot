#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseSetItemSetSha256 } from "../lib/listing/evaluation/release-set-contract.mjs";
import {
  goldenSemLaunchFields,
  goldenSemPartitionSchemaVersion,
  titleDerivedSemSuggestion
} from "../lib/listing/evaluation/golden-sem-release.mjs";
import { SEM_STANDARD_VERSION } from "../lib/listing/csm/sem-definition.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every((entry) => cleanText(entry));
  if (value && typeof value === "object") return Object.values(value).some(valuePresent);
  return cleanText(value) !== "";
}

async function readJson(path, label) {
  const target = resolve(path);
  if (!existsSync(target)) throw new Error(`${label} not found: ${target}`);
  return JSON.parse(await readFile(target, "utf8"));
}

async function readJsonl(path, label) {
  const target = resolve(path);
  if (!existsSync(target)) throw new Error(`${label} not found: ${target}`);
  const text = await readFile(target, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label} is invalid at line ${index + 1}: ${error.message}`);
    }
  });
}

function normalizedImages(item = {}) {
  return (Array.isArray(item.images) ? item.images : []).map((image, index) => ({
    image_id: cleanText(image.image_id || image.id || `image-${index + 1}`),
    bucket: cleanText(image.bucket) || null,
    object_path: cleanText(image.object_path || image.path) || null,
    url: cleanText(image.url || image.image_url) || null,
    image_role: cleanText(image.image_role || image.role) || null
  })).filter((image) => image.url || (image.bucket && image.object_path));
}

export function buildReviewedTitleSemProxy({
  blindDataset = {},
  sealedLabels = [],
  datasetId = "reviewed-title-sem-proxy-v1",
  now = () => new Date()
} = {}) {
  const labelsByKey = new Map(sealedLabels.map((label) => [cleanText(label.key), label]));
  const items = (Array.isArray(blindDataset.items) ? blindDataset.items : []).map((item, index) => {
    const itemId = cleanText(item.asset_id || item.item_id || item.query_card_id || `proxy-${index + 1}`);
    const labelKey = cleanText(item.sealed_eval_label_ref?.key || item.source_record?.sealed_eval_label_key);
    const label = labelsByKey.get(labelKey);
    if (!label) throw new Error(`${itemId}: sealed reviewed-title label is missing`);
    const reviewedTitle = cleanText(label.reviewed_title);
    if (!reviewedTitle) throw new Error(`${itemId}: reviewed title is empty`);
    const suggestion = titleDerivedSemSuggestion(reviewedTitle);
    const fields = {};
    const fieldStatuses = {};
    const evidenceSources = {};
    for (const field of goldenSemLaunchFields) {
      const value = suggestion[field];
      const present = valuePresent(value);
      fields[field] = present ? value : "UNKNOWN";
      fieldStatuses[field] = present ? "CONFIRMED" : "UNKNOWN";
      evidenceSources[field] = present ? ["WRITER_REVIEWED_TITLE_DERIVATION"] : [];
    }
    return {
      item_id: itemId,
      query_card_id: itemId,
      source_feedback_id: cleanText(item.source_feedback_id) || null,
      recognition_input: { images: normalizedImages(item) },
      reviewed_ground_truth: {
        fields,
        field_statuses: fieldStatuses,
        evidence_sources: evidenceSources,
        reviewed_by: "TITLE_DERIVATION_ONLY",
        reviewed_at: now().toISOString(),
        sem_standard_version: SEM_STANDARD_VERSION
      },
      sealed_evaluation_reference: {
        writer_reviewed_title: reviewedTitle,
        visible_to_recognition: false
      }
    };
  });
  return {
    schema_version: goldenSemPartitionSchemaVersion,
    dataset_id: datasetId,
    partition: "diagnostic_proxy",
    generated_at: now().toISOString(),
    sem_standard_version: SEM_STANDARD_VERSION,
    item_set_sha256: releaseSetItemSetSha256(items),
    evaluation_truth_policy: {
      field_ground_truth_class: "REVIEWED_TITLE_DERIVED_SEM_PROXY",
      formal_golden_sem: false,
      launch_gate_eligible: false,
      title_visible_to_recognition: false,
      missing_title_fields_are_unknown: true,
      limitations: [
        "Writer-reviewed title is authoritative at title level but was not manually reviewed field by field.",
        "Parser omissions and field-boundary errors can affect this diagnostic proxy.",
        "Use only for retrieval ON/OFF relative comparison, never for the formal SEM launch gate."
      ]
    },
    data_policy: {
      training_eligible: false,
      threshold_tuning_eligible: false,
      catalog_promotion_eligible: false,
      recognition_hint_eligible: false
    },
    items
  };
}

async function writeJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const blindDatasetPath = argValue(argv, "--dataset");
  const labelsPath = argValue(argv, "--sealed-labels");
  const outPath = argValue(argv, "--out", "data/eval/retrieval-application/reviewed-title-sem-proxy.json");
  const datasetId = argValue(argv, "--dataset-id", "reviewed-title-sem-proxy-v1");
  if (!blindDatasetPath || !labelsPath) throw new Error("--dataset and --sealed-labels are required");
  const proxy = buildReviewedTitleSemProxy({
    blindDataset: await readJson(blindDatasetPath, "blind dataset"),
    sealedLabels: await readJsonl(labelsPath, "sealed labels"),
    datasetId
  });
  await writeJson(outPath, proxy);
  console.log(JSON.stringify({
    output: resolve(outPath),
    item_count: proxy.items.length,
    field_ground_truth_class: proxy.evaluation_truth_policy.field_ground_truth_class,
    formal_launch_gate_eligible: proxy.evaluation_truth_policy.launch_gate_eligible
  }, null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Reviewed-title SEM proxy build failed: ${error.message}`);
    process.exitCode = 2;
  });
}
