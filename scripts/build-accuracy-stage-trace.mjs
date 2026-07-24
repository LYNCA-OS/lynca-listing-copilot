#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageTraceContractVersion } from "../lib/listing/evaluation/stage-trace-coverage.mjs";

const stageMappings = Object.freeze([
  ["observation", "observation"],
  ["evidence", "preingestion_evidence"],
  ["retrieval", "retrieval"],
  ["selection", "candidate_decision"],
  ["application", "candidate_decision"],
  ["resolver", "field_resolution"],
  ["renderer", "renderer"]
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["results", "items", "cards"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function id(result = {}) {
  return clean(result.source_feedback_id || result.source_asset_id || result.asset_id).toLowerCase();
}

function resultScore(result = {}) {
  return (result.ok === true ? 1_000_000 : 0)
    + (result.v4_pipeline_contract ? 100_000 : 0)
    + (result.pipeline_node_ledger ? 10_000 : 0)
    + (result.l2_candidate_debug ? 1_000 : 0);
}

function reasonCode(value, fallback) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function outputPresence(result = {}) {
  const ledger = result.pipeline_node_ledger || {};
  const debug = result.l2_candidate_debug || {};
  const fieldFlow = ledger.field_flow?.fields || [];
  const evidence = ledger.sensor_evidence || [];
  return {
    observation: evidence.length > 0 || fieldFlow.some((field) => field.raw_provider_present === true),
    evidence: evidence.length > 0 || fieldFlow.length > 0 || Boolean(result.preingestion_ocr_rendezvous || result.l2_status?.preingestion_ocr_rendezvous),
    retrieval: Array.isArray(debug.candidate_application_trace),
    selection: Boolean(debug.selected_candidate_id || debug.selected_candidate_decision),
    application: Array.isArray(debug.retrieval_application?.decisions),
    resolver: Object.hasOwn(result, "resolved_fields"),
    renderer: Array.isArray(fieldFlow)
  };
}

function droppedFields(result = {}) {
  const debug = result.l2_candidate_debug || {};
  const reasons = debug.selected_candidate_safe_field_application?.field_reasons || {};
  return (debug.retrieval_application?.decisions || []).filter((row) => row.applied_to_final !== true).map((row) => ({
    field: clean(row.resolver_field || row.field) || "unknown_field",
    reason_code: reasonCode(row.reason || reasons[row.field] || row.outcome, "APPLICATION_POLICY_BLOCKED")
  }));
}

function stageTrace(result = {}) {
  const contract = result.v4_pipeline_contract || {};
  const contractStages = new Map((contract.stages || []).map((stage) => [stage.stage_id, stage]));
  const presence = outputPresence(result);
  const contractInputVersion = [contract.schema_version, contract.strategy_profile?.policy_version].map(clean).filter(Boolean).join(":");
  return stageMappings.map(([stageName, contractStageName]) => {
    const source = contractStages.get(contractStageName) || {};
    const status = clean(source.status).toUpperCase() || "FAILED";
    const produced = presence[stageName] === true;
    const implementation = clean(source.metrics?.heuristic_version || source.metrics?.model || source.execution_mode);
    const fallbackReason = status === "COMPLETED"
      ? (produced ? null : `${stageName.toUpperCase()}_OUTPUT_EMPTY`)
      : `${stageName.toUpperCase()}_${status || "NOT_RECORDED"}`;
    return {
      contract_version: stageTraceContractVersion,
      stage: stageName,
      owner: source.owner || contract.owners?.[contractStageName] || null,
      status,
      input_version: contractInputVersion
        ? `${contractInputVersion}${implementation ? `:${implementation}` : ""}`
        : null,
      output_produced: produced,
      output_persisted: produced,
      reason_code: reasonCode(source.reason, fallbackReason),
      dropped_fields: stageName === "application" ? droppedFields(result) : [],
      final_decision_owner: stageName === "renderer" ? (source.owner || contract.owners?.renderer || null) : null
    };
  });
}

export function buildAccuracyStageTrace(reports = []) {
  const bestById = new Map();
  for (const result of reports.flatMap(rows)) {
    const resultId = id(result);
    if (!resultId) continue;
    const current = bestById.get(resultId);
    // A later fixed-regression report supersedes an equally complete earlier
    // artifact. This lets a source-contract repair replace stale warnings
    // without preferring a structurally richer but older result.
    if (!current || resultScore(result) >= resultScore(current)) bestById.set(resultId, result);
  }
  return {
    schema_version: "accuracy-stage-trace-v1",
    generated_at: new Date().toISOString(),
    cards: [...bestById.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([queryCardId, result]) => ({
      query_card_id: queryCardId,
      recognition_ok: result.ok === true,
      stage_trace: stageTrace(result),
      instrumentation: {
        pipeline_contract_status: result.v4_pipeline_contract?.contract_status || null,
        pipeline_contract_violations: (result.v4_pipeline_contract?.violations || []).map((violation) => ({
          code: violation.code || "UNKNOWN",
          severity: violation.severity || "UNKNOWN",
          owner: violation.owner || null
        }))
      }
    }))
  };
}

function argValues(argv, name) {
  return argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1]] : []);
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const inputs = argValues(argv, "--input");
  if (!inputs.length) throw new Error("at least one --input report is required");
  const reports = await Promise.all(inputs.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))));
  const outputPath = resolve(argValue(argv, "--out", ".local/oracle/accuracy-stage-trace.json"));
  const trace = buildAccuracyStageTrace(reports);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(trace, null, 2)}\n`);
  console.log(JSON.stringify({ output: outputPath, card_count: trace.cards.length }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
