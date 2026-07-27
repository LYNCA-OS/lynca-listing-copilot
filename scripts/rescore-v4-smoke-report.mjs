#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  attachPostRecognitionScoring,
  readSealedLabels,
  summarize
} from "./v4-ebay-smoke.mjs";

function datasetItems(dataset) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || dataset.cards || [];
}

export async function rescoreV4SmokeReport({ report, dataset, sealedLabelsPath }) {
  const offset = Math.max(0, Number(report.offset) || 0);
  const sourceItems = datasetItems(dataset);
  const selectedItems = sourceItems.slice(offset, offset + report.results.length);
  if (selectedItems.length !== report.results.length) {
    throw new Error(`dataset_report_count_mismatch:dataset=${selectedItems.length}:report=${report.results.length}`);
  }
  const labels = await readSealedLabels(sealedLabelsPath, { required: true });
  const results = attachPostRecognitionScoring(report.results, selectedItems, labels, offset);
  const missing = results.filter((row) => row.reference_title_is_reviewed_ground_truth !== true);
  if (missing.length) throw new Error(`reviewed_ground_truth_missing:${missing.length}`);
  return {
    ...report,
    sealed_labels_path: path.resolve(sealedLabelsPath),
    rescore_provenance: {
      schema_version: "v4-smoke-offline-rescore-v1",
      rescored_at: new Date().toISOString(),
      provider_calls_added: 0,
      prediction_rows_changed: 0,
      reviewed_ground_truth_count: results.length
    },
    results,
    summary: summarize(results, {
      runWallMs: report.run_wall_ms ?? report.summary?.run_wall_ms ?? null
    })
  };
}

async function main(argv = process.argv.slice(2)) {
  const [reportPath, datasetPath, sealedLabelsPath, outputPath] = argv;
  if (!reportPath || !datasetPath || !sealedLabelsPath || !outputPath) {
    throw new Error("Usage: rescore-v4-smoke-report.mjs <report.json> <dataset.json> <sealed-labels.jsonl> <output.json>");
  }
  const [report, dataset] = await Promise.all([
    readFile(path.resolve(reportPath), "utf8").then(JSON.parse),
    readFile(path.resolve(datasetPath), "utf8").then(JSON.parse)
  ]);
  const rescored = await rescoreV4SmokeReport({ report, dataset, sealedLabelsPath });
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(rescored, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: path.resolve(outputPath),
    result_count: rescored.results.length,
    final_accuracy_proxy: rescored.summary.final_accuracy_proxy
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
