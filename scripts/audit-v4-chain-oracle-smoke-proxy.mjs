#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEM_STANDARD_VERSION } from "../lib/listing/csm/sem-definition.mjs";
import { evaluateV4ChainOracleAudit } from "../lib/listing/evaluation/v4-chain-oracle-audit.mjs";
import { goldenSemLaunchFields } from "../lib/listing/evaluation/golden-sem-release.mjs";
import { renderV4ChainOracleReport } from "./run-v4-chain-oracle-audit.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.values(value).some(valuePresent);
  return cleanText(value) !== "";
}

function packetByFeedbackId(packet = {}) {
  return new Map((packet.items || []).map((item) => [cleanText(item.source_feedback_id || item.item_id), item]));
}

function proxyItem(smokeRow, packetItem) {
  const suggestion = packetItem?.parser_suggestion?.fields || {};
  const fields = {};
  const fieldStatuses = {};
  for (const field of goldenSemLaunchFields) {
    const present = valuePresent(suggestion[field]);
    fields[field] = present ? suggestion[field] : "UNKNOWN";
    fieldStatuses[field] = present ? "CONFIRMED" : "UNKNOWN";
  }
  return {
    item_id: cleanText(smokeRow.source_feedback_id),
    source_feedback_id: cleanText(smokeRow.source_feedback_id),
    reviewed_ground_truth: {
      fields,
      field_statuses: fieldStatuses,
      reviewed_by: "TITLE_DERIVATION_ONLY",
      sem_standard_version: SEM_STANDARD_VERSION
    }
  };
}

function fieldFlowMap(row, key) {
  return Object.fromEntries((row.pipeline_node_ledger?.field_flow?.fields || []).flatMap((field) => {
    const values = field[key];
    if (!Array.isArray(values) || !values.length) return [];
    return [[field.field_group, values.length === 1 ? values[0] : values]];
  }));
}

function smokeTrace(row) {
  const debug = row.l2_candidate_debug || {};
  const ranked = debug.card_domain_reranker?.ranked_candidates || debug.shadow_reranker?.ranked_candidates || [];
  const decisions = debug.retrieval_application?.decisions || [];
  return {
    query_card_id: cleanText(row.source_feedback_id),
    evidence_observations: [{ source: "PRODUCTION_MERGED_PROVIDER_EVIDENCE", fields: fieldFlowMap(row, "raw_values") }],
    retrieval_candidates: ranked.map((candidate, index) => ({
      candidate_id: candidate.candidate_id,
      identity_id: candidate.candidate_identity_id,
      rank: index + 1,
      source: candidate.candidate_lane,
      fields: {}
    })),
    selected_candidate_id: debug.selected_candidate_id || debug.card_domain_reranker?.selected_candidate_id || "",
    application_decisions: decisions,
    resolver_fields: row.resolved_fields || {},
    renderer_fields: fieldFlowMap(row, "rendered_values")
  };
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const smokePath = argValue(argv, "--smoke");
  const packetPath = argValue(argv, "--packet");
  if (!smokePath || !packetPath) throw new Error("--smoke and --packet are required");
  const outputDir = resolve(argValue(argv, "--output-dir", "data/eval/v4-chain-oracle/smoke-proxy"));
  const smoke = JSON.parse(await readFile(resolve(smokePath), "utf8"));
  const packet = JSON.parse(await readFile(resolve(packetPath), "utf8"));
  const byFeedbackId = packetByFeedbackId(packet);
  const matchedRows = (smoke.results || []).filter((row) => byFeedbackId.has(cleanText(row.source_feedback_id)));
  const dataset = {
    schema_version: "golden-sem-partition-v1",
    partition: "diagnostic_proxy",
    evaluation_truth_policy: { field_ground_truth_class: "REVIEWED_TITLE_DERIVED_SEM_PROXY", launch_gate_eligible: false },
    items: matchedRows.map((row) => proxyItem(row, byFeedbackId.get(cleanText(row.source_feedback_id))))
  };
  const trace = { schema_version: "v4-chain-oracle-trace-v1", cards: matchedRows.map(smokeTrace) };
  const audit = evaluateV4ChainOracleAudit({ dataset, trace });
  await Promise.all([
    writeJson(resolve(outputDir, "proxy-dataset.json"), dataset),
    writeJson(resolve(outputDir, "chain-trace.json"), trace),
    writeJson(resolve(outputDir, "audit.json"), audit),
    mkdir(outputDir, { recursive: true }).then(() => writeFile(resolve(outputDir, "audit.md"), renderV4ChainOracleReport(audit)))
  ]);
  console.log(JSON.stringify({ matched_card_count: matchedRows.length, status: audit.status, metrics: audit.metrics, data_quality: audit.data_quality }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
