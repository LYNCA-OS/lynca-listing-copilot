#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function rowId(item = {}) {
  return String(item.item_id || item.id || item.source_feedback_id || "").trim();
}

export function rebaseV4OracleRetrievalTruth(dataset = {}, truthPacket = {}) {
  const truthById = new Map((truthPacket.items || []).map((item) => [rowId(item), item.retrieval_ground_truth]));
  const missingIds = [];
  const items = (dataset.items || []).map((item) => {
    const id = rowId(item);
    const retrievalTruth = truthById.get(id);
    if (!retrievalTruth) {
      missingIds.push(id);
      return item;
    }
    return { ...item, retrieval_ground_truth: retrievalTruth };
  });
  if (missingIds.length) {
    throw new Error(`retrieval truth missing for ${missingIds.length} dataset item(s): ${missingIds.join(", ")}`);
  }
  const retrievalEvaluableItemCount = items.filter((item) => (
    item.retrieval_ground_truth?.retrieval_evaluable === true
  )).length;
  return {
    ...dataset,
    schema_version: "v4-oracle-cloud-eval-dataset-v2",
    retrieval_truth_rebase: {
      source_schema_version: truthPacket.promotion_contract?.schema_version || null,
      same_feedback_catalog_ids_are_provenance_only: true,
      item_count: items.length,
      retrieval_evaluable_item_count: retrievalEvaluableItemCount,
      retrieval_ineligible_item_count: items.length - retrievalEvaluableItemCount
    },
    items
  };
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = argValue(argv, "--dataset");
  const truthPath = argValue(argv, "--truth");
  const outputPath = resolve(argValue(argv, "--out", "data/eval/v4-chain-oracle/rebased-retrieval-truth.json"));
  if (!datasetPath || !truthPath) throw new Error("--dataset and --truth are required");
  const result = rebaseV4OracleRetrievalTruth(
    JSON.parse(await readFile(resolve(datasetPath), "utf8")),
    JSON.parse(await readFile(resolve(truthPath), "utf8"))
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output: outputPath, ...result.retrieval_truth_rebase }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
