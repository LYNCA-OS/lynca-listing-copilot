#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "results", "cards", "records"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function id(value = {}) {
  return String(value.item_id || value.source_feedback_id || value.query_card_id || "").trim().toLowerCase();
}

export function buildStageTraceGapDataset(dataset = {}, audit = {}, { includeSourceContractViolations = false } = {}) {
  const missingIds = new Set(rows(audit).filter((card) => (
    card.complete !== true || (includeSourceContractViolations && card.source_contract_violations?.length)
  )).map(id).filter(Boolean));
  const items = rows(dataset).filter((item) => missingIds.has(id(item)));
  const foundIds = new Set(items.map(id));
  const unresolvedIds = [...missingIds].filter((itemId) => !foundIds.has(itemId)).sort();
  if (unresolvedIds.length) throw new Error(`trace gap dataset is missing ${unresolvedIds.length} source item(s)`);
  return {
    ...dataset,
    schema_version: "stage-trace-gap-dataset-v1",
    item_count: items.length,
    evaluation_sample_policy: {
      mode: "FIXED_REGRESSION",
      randomized_selection: false,
      sample_reuse_permitted: true,
      reuse_reason: "missing_stage_trace_recovery",
      reuse_scope_id: "independent-identity-stage-trace-gap-v1",
      reuse_policy_complete: true,
      generalization_claim_permitted: false,
      same_sample_required: true
    },
    items
  };
}

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = arg(argv, "--dataset");
  const auditPath = arg(argv, "--audit");
  const outputPath = resolve(arg(argv, "--out", ".local/oracle/stage-trace-gap-dataset.json"));
  if (!datasetPath || !auditPath) throw new Error("--dataset and --audit are required");
  const [dataset, audit] = await Promise.all([
    readFile(resolve(datasetPath), "utf8").then(JSON.parse),
    readFile(resolve(auditPath), "utf8").then(JSON.parse)
  ]);
  const output = buildStageTraceGapDataset(dataset, audit, {
    includeSourceContractViolations: argv.includes("--include-source-contract-violations")
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
