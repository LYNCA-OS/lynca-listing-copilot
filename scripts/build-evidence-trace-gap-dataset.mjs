#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "results", "cards", "records", "failures"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function id(value = {}) {
  return String(value.source_feedback_id || value.item_id || value.query_card_id || "").trim().toLowerCase();
}

function partition(value = {}) {
  return String(value.partition || value.evaluation_partition || value.dataset_partition || "").trim().toLowerCase();
}

export function buildEvidenceTraceGapDataset(dataset = {}, taxonomy = {}, {
  categories = ["TRACE_MISSING"],
  sampleSize = null,
  validationSize = null,
  seed = "v4-evidence-recovery-v1",
  titleIsReviewedGroundTruth = false
} = {}) {
  const accepted = new Set(categories.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean));
  const gapIds = new Set(rows(taxonomy).filter((failure) => (
    accepted.has(String(failure.category || "").trim().toUpperCase())
  )).map(id).filter(Boolean));
  const eligibleItems = rows(dataset).filter((item) => gapIds.has(id(item)));
  const found = new Set(eligibleItems.map(id));
  const unresolved = [...gapIds].filter((itemId) => !found.has(itemId)).sort();
  if (unresolved.length) throw new Error(`evidence trace gap dataset is missing ${unresolved.length} source item(s)`);
  let items = eligibleItems;
  const normalizedSampleSize = sampleSize == null ? null : Math.max(1, Math.trunc(Number(sampleSize)));
  if (normalizedSampleSize != null && normalizedSampleSize < eligibleItems.length) {
    const score = (item) => crypto.createHash("sha256").update(`${seed}\0${id(item)}`).digest("hex");
    const ordered = [...eligibleItems].sort((left, right) => score(left).localeCompare(score(right)) || id(left).localeCompare(id(right)));
    const normalizedValidationSize = Math.max(0, Math.min(
      normalizedSampleSize,
      validationSize == null ? Math.round(normalizedSampleSize * 0.25) : Math.trunc(Number(validationSize))
    ));
    const validation = ordered.filter((item) => partition(item) === "validation").slice(0, normalizedValidationSize);
    const development = ordered.filter((item) => partition(item) !== "validation").slice(0, normalizedSampleSize - validation.length);
    const selected = new Set([...development, ...validation].map(id));
    if (selected.size < normalizedSampleSize) {
      for (const item of ordered) {
        if (selected.size >= normalizedSampleSize) break;
        selected.add(id(item));
      }
    }
    items = ordered.filter((item) => selected.has(id(item))).slice(0, normalizedSampleSize);
  }
  if (titleIsReviewedGroundTruth) {
    items = items.map((item) => ({
      ...item,
      reviewed_title: String(item.reviewed_title || item.title || "").trim(),
      policy: {
        ...(item.policy || {}),
        reviewed_title_is_ground_truth: true,
        model_prompt_visible: false
      }
    }));
  }
  return {
    ...dataset,
    schema_version: "evidence-trace-gap-dataset-v1",
    item_count: items.length,
    evaluation_sample_policy: {
      mode: "FIXED_REGRESSION",
      randomized_selection: normalizedSampleSize != null,
      deterministic_seed: normalizedSampleSize != null ? seed : null,
      requested_sample_size: normalizedSampleSize,
      selected_item_set_sha256: crypto.createHash("sha256").update(items.map(id).sort().join("\n")).digest("hex"),
      sample_reuse_permitted: true,
      reuse_reason: "missing_full_information_evidence_trace_recovery",
      reuse_scope_id: "independent-identity-evidence-trace-gap-v1",
      reuse_policy_complete: true,
      generalization_claim_permitted: false,
      same_sample_required: true
    },
    evidence_trace_gap: { categories: [...accepted].sort() },
    items
  };
}

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = arg(argv, "--dataset");
  const taxonomyPath = arg(argv, "--taxonomy");
  const outputPath = resolve(arg(argv, "--out", ".local/oracle/evidence-trace-gap-dataset.json"));
  if (!datasetPath || !taxonomyPath) throw new Error("--dataset and --taxonomy are required");
  const [dataset, taxonomy] = await Promise.all([
    readFile(resolve(datasetPath), "utf8").then(JSON.parse),
    readFile(resolve(taxonomyPath), "utf8").then(JSON.parse)
  ]);
  const sampleSizeValue = arg(argv, "--sample-size", "");
  const validationSizeValue = arg(argv, "--validation-size", "");
  const output = buildEvidenceTraceGapDataset(dataset, taxonomy, {
    sampleSize: sampleSizeValue ? Number(sampleSizeValue) : null,
    validationSize: validationSizeValue ? Number(validationSizeValue) : null,
    seed: arg(argv, "--seed", "v4-evidence-recovery-v1"),
    titleIsReviewedGroundTruth: argv.includes("--title-is-reviewed-ground-truth")
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output: outputPath, item_count: output.item_count }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
