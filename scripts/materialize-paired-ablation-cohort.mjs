#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildEvaluationSamplePolicy } from "../lib/listing/evaluation/sample-policy.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function itemsFrom(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

function itemKey(item = {}) {
  return cleanText(
    item.sealed_eval_label_ref?.key
    || item.source_feedback_id
    || item.source_record?.sealed_eval_label_key
    || item.asset_id
    || item.physical_card_id
  );
}

async function readJsonl(path) {
  const text = await readFile(resolve(path), "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid_jsonl_${path}_${index + 1}:${error.message}`);
    }
  });
}

async function writeJson(path, value) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(path, rows) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

export async function materializePairedAblationCohort({
  datasetPath,
  labelsPath,
  outPath,
  labelsOutPath,
  limit = 10,
  reuseReason,
  reuseScopeId,
  evaluationPartition = ""
} = {}) {
  if (!datasetPath || !labelsPath || !outPath || !labelsOutPath) {
    throw new Error("dataset, labels, out, and labels-out are required");
  }
  if (!cleanText(reuseReason) || !cleanText(reuseScopeId)) {
    throw new Error("paired ablation reuse reason and scope are required");
  }
  const partition = cleanText(evaluationPartition).toLowerCase();
  if (!["development", "validation"].includes(partition)) {
    throw new Error("paired ablation requires an explicit development or validation partition");
  }
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const selectedItems = itemsFrom(dataset).slice(0, Math.max(1, Math.trunc(Number(limit) || 10)));
  if (!selectedItems.length) throw new Error("paired ablation cohort is empty");
  const selectedKeys = selectedItems.map(itemKey);
  if (selectedKeys.some((key) => !key) || new Set(selectedKeys).size !== selectedKeys.length) {
    throw new Error("paired ablation item keys must be non-empty and unique");
  }
  const labels = await readJsonl(labelsPath);
  const labelsByKey = new Map(labels.map((row) => [cleanText(row.key || row.item_id), row]));
  const selectedLabels = selectedKeys.map((key) => labelsByKey.get(key)).filter(Boolean);
  if (selectedLabels.length !== selectedItems.length) {
    throw new Error(`paired ablation label coverage ${selectedLabels.length}/${selectedItems.length}`);
  }
  const evaluationSamplePolicy = buildEvaluationSamplePolicy({
    mode: "PAIRED_ABLATION",
    selectedItemIds: selectedKeys,
    reuseReason,
    reuseScopeId
  });
  const outputDataset = {
    ...(Array.isArray(dataset) ? {} : dataset),
    schema_version: cleanText(dataset.schema_version) || "paired-ablation-cohort-v1",
    generated_at: new Date().toISOString(),
    item_count: selectedItems.length,
    evaluation_partition: partition,
    data_policy: {
      threshold_tuning_eligible: true,
      training_eligible: partition === "development",
      frozen_holdout: false
    },
    sealed_labels_path: resolve(labelsOutPath),
    evaluation_sample_policy: evaluationSamplePolicy,
    items: selectedItems
  };
  await writeJson(outPath, outputDataset);
  await writeJsonl(labelsOutPath, selectedLabels);
  return { dataset: outputDataset, labels: selectedLabels };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await materializePairedAblationCohort({
    datasetPath: argValue(argv, "--dataset"),
    labelsPath: argValue(argv, "--labels"),
    outPath: argValue(argv, "--out"),
    labelsOutPath: argValue(argv, "--labels-out"),
    limit: argValue(argv, "--limit", "10"),
    reuseReason: argValue(argv, "--reuse-reason"),
    reuseScopeId: argValue(argv, "--reuse-scope-id"),
    evaluationPartition: argValue(argv, "--evaluation-partition")
  });
  process.stdout.write(`${JSON.stringify({
    item_count: result.dataset.item_count,
    selected_item_ids_sha256: result.dataset.evaluation_sample_policy.selected_item_ids_sha256,
    reuse_scope_id: result.dataset.evaluation_sample_policy.reuse_scope_id
  }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export const __materializePairedAblationTestHooks = Object.freeze({ itemKey, itemsFrom });
