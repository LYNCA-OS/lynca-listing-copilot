#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { distillWriterTitleEvidenceV1 } from
  "../lib/listing/evaluation/writer-title-evidence-distillation-v1.mjs";

const clean = (value) => String(value ?? "").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function options(argv, name) {
  return argv.flatMap((value, index) => value === name ? [argv[index + 1]] : [])
    .filter(Boolean);
}

function armSpec(value, label) {
  const split = String(value || "").lastIndexOf("::");
  invariant(split > 0 && clean(value.slice(split + 2)),
    `writer_distillation_${label}_spec_invalid`);
  return { path: resolve(value.slice(0, split)), arm: clean(value.slice(split + 2)) };
}

function parseJsonLines(body, label) {
  return body.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`writer_distillation_${label}_jsonl_invalid:${index + 1}`); }
  });
}

async function loadArmRows(specValues, label, selector) {
  invariant(specValues.length > 0, `writer_distillation_${label}_spec_required`);
  const index = new Map();
  const receipts = [];
  for (const value of specValues) {
    const spec = armSpec(value, label);
    const body = await readFile(spec.path, "utf8");
    const rows = parseJsonLines(body, label).filter((row) => row.arm === spec.arm);
    invariant(rows.length > 0, `writer_distillation_${label}_arm_empty:${spec.arm}`);
    for (const row of rows) {
      const assetId = clean(row.asset_id);
      invariant(assetId && !index.has(assetId),
        `writer_distillation_${label}_asset_duplicate:${assetId || "missing"}`);
      index.set(assetId, selector(row, spec.arm));
    }
    receipts.push({ path: spec.path, arm: spec.arm, file_sha256: sha256(body),
      selected_rows: rows.length });
  }
  return { index, receipts };
}

function labelsByKey(rows) {
  const labels = new Map();
  for (const row of rows) {
    const key = clean(row.key);
    const policy = row.policy;
    invariant(key && !labels.has(key) && row.label_type === "REVIEWED_INTERNAL_TITLE"
      && clean(row.reviewed_title) && policy?.field_ground_truth === false
      && policy.model_prompt_visible === false
      && policy.self_retrieval_exclusion_required === true,
    `writer_distillation_label_invalid:${key || "missing"}`);
    labels.set(key, row);
  }
  return labels;
}

function outputPathAllowed(path) {
  const normalized = resolve(path);
  return normalized.startsWith(`${resolve(tmpdir())}/`) || normalized.includes("/artifacts/");
}

export async function writeWriterTitleEvidenceDistillationV1({ datasetPath, labelsPath,
  predictionSpecs, sourceSpecs, outPath, labelAwareDevelopmentOnly = false }) {
  invariant(labelAwareDevelopmentOnly === true,
    "writer_distillation_requires_label_aware_development_only");
  invariant(datasetPath && labelsPath && outPath && outputPathAllowed(outPath),
    "writer_distillation_inputs_or_output_scope_invalid");
  const [datasetBody, predictions, observations] = await Promise.all([
    readFile(resolve(datasetPath), "utf8"),
    loadArmRows(predictionSpecs, "prediction", (row) => {
      invariant(typeof row.title === "string" && row.fields && typeof row.fields === "object"
        && !Array.isArray(row.fields),
      `writer_distillation_prediction_invalid:${clean(row.asset_id)}`);
      return { title: row.title, fields: row.fields };
    }),
    loadArmRows(sourceSpecs, "source", (row) => {
      invariant(typeof row.title === "string",
        `writer_distillation_source_invalid:${clean(row.asset_id)}`);
      return { observation: row.title };
    })
  ]);
  const labelsBody = await readFile(resolve(labelsPath), "utf8");
  let dataset;
  try { dataset = JSON.parse(datasetBody); }
  catch { throw new Error("writer_distillation_dataset_invalid_json"); }
  const labels = labelsByKey(parseJsonLines(labelsBody, "labels"));
  invariant(Array.isArray(dataset?.items) && dataset.items.length >= 200,
    "writer_distillation_dataset_too_small");
  const assets = new Set();
  const boundLabelKeys = new Set();
  const rows = dataset.items.map((item) => {
    const assetId = clean(item.asset_id);
    const labelKey = clean(item.sealed_eval_label_ref?.key);
    const prediction = predictions.index.get(assetId);
    const observation = observations.index.get(assetId);
    const label = labels.get(labelKey);
    invariant(assetId && !assets.has(assetId) && labelKey && !boundLabelKeys.has(labelKey)
      && label && prediction && observation,
      `writer_distillation_dataset_binding_invalid:${assetId || "missing"}`);
    assets.add(assetId);
    boundLabelKeys.add(labelKey);
    return {
      asset_id: assetId,
      writer_title: label.reviewed_title,
      candidate_title: prediction.title,
      candidate_fields: prediction.fields,
      source_backing: [
        { source: "canonical_model_fields", value: prediction.fields },
        { source: "exhaustive_model_observation", value: observation.observation }
      ]
    };
  });
  invariant(labels.size === rows.length && predictions.index.size === rows.length
    && observations.index.size === rows.length,
    "writer_distillation_input_cohort_mismatch");
  const report = distillWriterTitleEvidenceV1(rows);
  report.input_receipts = {
    dataset: { path: resolve(datasetPath), sha256: sha256(datasetBody), rows: rows.length },
    sealed_labels: { path: resolve(labelsPath), sha256: sha256(labelsBody), rows: labels.size,
      bytes_opened_after_prediction_files_loaded: true },
    predictions: predictions.receipts,
    source_observations: observations.receipts
  };
  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(target, 0o600);
  return report;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  writeWriterTitleEvidenceDistillationV1({
    datasetPath: option(argv, "--dataset"),
    labelsPath: option(argv, "--sealed-labels"),
    predictionSpecs: options(argv, "--prediction"),
    sourceSpecs: options(argv, "--source-observation"),
    outPath: option(argv, "--out"),
    labelAwareDevelopmentOnly: argv.includes("--label-aware-development-only")
  }).then((report) => {
    process.stdout.write(`${JSON.stringify({
      schema_version: report.schema_version,
      authority: report.authority,
      summary: report.summary,
      factual_metrics: report.factual_metrics,
      output: resolve(option(argv, "--out"))
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
