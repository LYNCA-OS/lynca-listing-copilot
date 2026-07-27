#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildEvaluationDecisionTracePacket } from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";

const evaluationPayload = Object.freeze({
  benchmark_profile: "cold_algorithm",
  trace_level: "evaluation"
});

export function rehydrateFieldLineageReport(report = {}) {
  const results = Array.isArray(report.results) ? report.results : [];
  let rehydrated = 0;
  const nextResults = results.map((row) => {
    const packet = buildEvaluationDecisionTracePacket(row, evaluationPayload);
    if (!packet) return row;
    rehydrated += 1;
    return { ...row, evaluation_decision_trace_packet: packet };
  });
  return {
    ...report,
    results: nextResults,
    field_lineage_rehydration: {
      schema_version: "field-lineage-rehydration-v1",
      source_result_count: results.length,
      rehydrated_result_count: rehydrated,
      provider_calls: 0,
      title_results_changed: false
    }
  };
}

export async function main(argv = process.argv.slice(2)) {
  const [inputPath, outputPath] = argv;
  if (!inputPath || !outputPath) {
    throw new Error("usage: rehydrate-field-lineage-ledger.mjs <input-report.json> <output-report.json>");
  }
  const report = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const rehydrated = rehydrateFieldLineageReport(report);
  await writeFile(resolve(outputPath), `${JSON.stringify(rehydrated, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(rehydrated.field_lineage_rehydration));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
