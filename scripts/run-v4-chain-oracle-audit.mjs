#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateV4ChainOracleAudit } from "../lib/listing/evaluation/v4-chain-oracle-audit.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasArg(argv, name) {
  return argv.includes(name);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function percent(metric) {
  return metric.rate === null ? "N/A" : `${(metric.rate * 100).toFixed(2)}% (${metric.numerator}/${metric.denominator})`;
}

export function renderV4ChainOracleReport(report) {
  const metrics = report.metrics;
  return `${[
    "# V4 Accuracy Ceiling and Chain Oracle Audit",
    "",
    `状态：${report.status}`,
    `字段真值口径：${report.truth_policy.field_ground_truth_class}`,
    `卡片/Trace：${report.data_quality.matched_trace_count}/${report.data_quality.dataset_card_count}`,
    `正式字段数：${report.data_quality.reviewed_field_count}`,
    "",
    "## Chain waterfall",
    "",
    `- Evidence Oracle Recall: ${percent(metrics.evidence_oracle_recall)}`,
    `- Retrieval Recall@1: ${percent(metrics.retrieval_recall_at_1)}`,
    `- Retrieval Recall@5: ${percent(metrics.retrieval_recall_at_5)}`,
    `- Retrieval Recall@20: ${percent(metrics.retrieval_recall_at_20)}`,
    `- Selection Accuracy given Recall@20: ${percent(metrics.selection_accuracy_given_retrieved_at_20)}`,
    `- Safe Application Recall: ${percent(metrics.safe_application_recall)}`,
    `- Safe Application Precision: ${percent(metrics.safe_application_precision)}`,
    `- Resolver Fidelity: ${percent(metrics.resolver_fidelity)}`,
    `- Renderer Fidelity: ${percent(metrics.renderer_fidelity)}`,
    "",
    "## Hard boundaries",
    "",
    "- Writer-approved title is commercial title truth; parser output remains a prefill/proxy until field review or trusted-source promotion.",
    "- Retrieval scoring requires a sealed identity id. Missing identity labels are excluded, never guessed from the evaluation title.",
    "- Selecting a sealed same-feedback catalog record marks the trace contaminated and excludes its downstream application metrics.",
    "- Renderer Fidelity consumes emitted SEM trace fields, not a second parse of the final title; this prevents same-parser correlated error.",
    "- This audit is offline-only and does not change production strategy or chain routing.",
    ""
  ].join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = argValue(argv, "--dataset");
  const tracePath = argValue(argv, "--trace");
  const outPath = resolve(argValue(argv, "--out", "data/eval/v4-chain-oracle/audit.json"));
  const reportPath = resolve(argValue(argv, "--report", "data/eval/v4-chain-oracle/audit.md"));
  if (!datasetPath || !tracePath) throw new Error("--dataset and --trace are required");
  const report = evaluateV4ChainOracleAudit({
    dataset: await readJson(datasetPath),
    trace: await readJson(tracePath),
    independentIdentityOnly: hasArg(argv, "--independent-identity-only")
  });
  await Promise.all([
    mkdir(dirname(outPath), { recursive: true }).then(() => writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`)),
    mkdir(dirname(reportPath), { recursive: true }).then(() => writeFile(reportPath, renderV4ChainOracleReport(report)))
  ]);
  console.log(JSON.stringify({
    status: report.status,
    matched_trace_count: report.data_quality.matched_trace_count,
    reviewed_field_count: report.data_quality.reviewed_field_count,
    output: outPath,
    report: reportPath
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
