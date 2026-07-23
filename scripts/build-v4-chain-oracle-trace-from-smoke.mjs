#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { v4ChainOracleTraceSchemaVersion } from "../lib/listing/evaluation/v4-chain-oracle-audit.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValues(argv, name) {
  return argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1]] : []);
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["results", "items", "cards"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function renderedFields(ledger = {}) {
  const aliases = {
    parallel_exact: "print_finish",
    collector_number: "card_number"
  };
  return Object.fromEntries((ledger.field_flow?.fields || []).flatMap((row) => {
    const values = Array.isArray(row.rendered_values) ? row.rendered_values.filter(Boolean) : [];
    if (!values.length) return [];
    const field = aliases[row.field_group] || row.field_group;
    return [[field, field === "subject" || values.length > 1 ? values : values[0]]];
  }));
}

function providerFieldFlowEvidence(ledger = {}) {
  const aliases = {
    subject: "players",
    parallel_exact: "parallel_exact",
    surface_color: "surface_color",
    collector_number: "collector_number",
    numerical_rarity: "numerical_rarity",
    grade: "grading_info"
  };
  return (ledger.field_flow?.fields || []).flatMap((row, index) => {
    if (row?.raw_provider_present !== true) return [];
    const values = Array.isArray(row.raw_values)
      ? row.raw_values.map(cleanText).filter(Boolean)
      : [];
    if (!values.length) return [];
    const field = aliases[row.field_group] || cleanText(row.field_group || row.field);
    if (!field) return [];
    return [{
      evidence_id: `provider-field-flow-${index + 1}`,
      source: "GPT_5_MINI_PROVIDER_FIELD_FLOW",
      fields: {
        [field]: field === "players" || values.length > 1 ? values : values[0]
      },
      raw_text: values.join(" ")
    }];
  });
}

function embeddedOcrEvidence(result = {}) {
  const rendezvous = result.l2_status?.preingestion_ocr_rendezvous
    || result.preingestion_ocr_rendezvous
    || {};
  const observations = Array.isArray(rendezvous.raw_ocr_observations)
    ? rendezvous.raw_ocr_observations
    : [];
  return observations.map((observation, index) => ({
    evidence_id: `preingestion-ocr-${index + 1}`,
    source: cleanText(observation.model_id).toLowerCase().includes("google")
      ? "GOOGLE_VISION_OCR"
      : "PREINGESTION_OCR",
    fields: observation.fields || {},
    raw_text: cleanText(observation.raw_text)
  })).filter((observation) => observation.raw_text || Object.keys(observation.fields).length > 0);
}

function candidateFields(decisions = []) {
  const output = new Map();
  for (const row of decisions) {
    const id = cleanText(row.candidate_id);
    const field = cleanText(row.resolver_field || row.field);
    const value = row.resolver_value ?? row.candidate_value;
    if (!id || !field || value === null || value === undefined || value === "") continue;
    const fields = output.get(id) || {};
    fields[field] = value;
    output.set(id, fields);
  }
  return output;
}

function retrievalCandidates(debug = {}) {
  const traces = Array.isArray(debug.candidate_application_trace) ? debug.candidate_application_trace : [];
  const decisions = debug.retrieval_application?.decisions || [];
  const fieldsByCandidate = candidateFields(decisions);
  const laneFallbackRanks = new Map();
  const candidates = traces.map((trace) => {
    const lane = cleanText(trace.candidate_lane || trace.source_type || "retrieval");
    const fallbackRank = (laneFallbackRanks.get(lane) || 0) + 1;
    laneFallbackRanks.set(lane, fallbackRank);
    return {
      candidate_id: cleanText(trace.candidate_id),
      identity_id: cleanText(trace.candidate_identity_id) || null,
      rank: Number(trace.retrieval_rank) || fallbackRank,
      source: lane,
      fields: fieldsByCandidate.get(cleanText(trace.candidate_id)) || {}
    };
  }).filter((candidate) => candidate.candidate_id);
  const bestById = new Map();
  for (const candidate of candidates) {
    const current = bestById.get(candidate.candidate_id);
    if (!current || candidate.rank < current.rank) bestById.set(candidate.candidate_id, candidate);
  }
  return [...bestById.values()].sort((left, right) => left.rank - right.rank || left.candidate_id.localeCompare(right.candidate_id));
}

function applicationDecisions(debug = {}) {
  const selectedFieldReasons = debug.selected_candidate_safe_field_application?.field_reasons || {};
  return (debug.retrieval_application?.decisions || []).map((row) => ({
    candidate_id: cleanText(row.candidate_id),
    field: cleanText(row.resolver_field || row.field),
    source_field: cleanText(row.field),
    value: row.resolver_value ?? row.candidate_value,
    old_value: row.old_value ?? null,
    final_value: row.final_value ?? null,
    applied: row.applied_to_final === true,
    applied_to_final: row.applied_to_final === true,
    supported_final: row.supported_final === true,
    decision: cleanText(row.decision),
    reason: cleanText(row.reason) || null,
    application_plan_reason: cleanText(selectedFieldReasons[row.field]) || null,
    outcome: cleanText(row.outcome) || null
  })).filter((row) => row.field);
}

export function buildV4ChainOracleTraceFromSmoke(reports = [], ocrObservations = {}) {
  const ocrById = new Map(rows(ocrObservations).map((row) => [cleanText(row.query_card_id).toLowerCase(), row]));
  const resultByCardId = new Map();
  for (const result of reports.flatMap(rows)) {
    const cardId = cleanText(result.source_feedback_id || result.source_asset_id || result.asset_id).toLowerCase();
    if (!cardId) continue;
    const incumbent = resultByCardId.get(cardId);
    const resultScore = (result.ok === true ? 1_000_000 : 0)
      + (result.pipeline_node_ledger ? 10_000 : 0)
      + (result.l2_candidate_debug ? 1_000 : 0)
      + Number(result.l2_candidate_debug?.candidate_application_trace?.length || 0);
    const incumbentScore = incumbent
      ? (incumbent.ok === true ? 1_000_000 : 0)
        + (incumbent.pipeline_node_ledger ? 10_000 : 0)
        + (incumbent.l2_candidate_debug ? 1_000 : 0)
        + Number(incumbent.l2_candidate_debug?.candidate_application_trace?.length || 0)
      : -1;
    if (!incumbent || resultScore > incumbentScore) resultByCardId.set(cardId, result);
  }
  const cards = [...resultByCardId.values()].map((result) => {
    const ledger = result.pipeline_node_ledger || {};
    const debug = result.l2_candidate_debug || {};
    const nativeSensorEvidence = Array.isArray(ledger.sensor_evidence) ? ledger.sensor_evidence : [];
    const fieldFlowEvidence = nativeSensorEvidence.length ? [] : providerFieldFlowEvidence(ledger);
    return {
      query_card_id: cleanText(result.source_feedback_id || result.source_asset_id || result.asset_id),
      recognition_ok: result.ok === true,
      recognition_error: result.ok === true ? null : cleanText(result.error).slice(0, 240),
      evidence_observations: [
        ...nativeSensorEvidence,
        ...fieldFlowEvidence,
        ...embeddedOcrEvidence(result),
        ...(ocrById.get(cleanText(result.source_feedback_id || result.source_asset_id || result.asset_id).toLowerCase())?.observations || [])
      ],
      retrieval_candidates: retrievalCandidates(debug),
      selected_candidate_id: cleanText(debug.selected_candidate_id || debug.selected_candidate_decision?.selected_candidate_id),
      selected_candidate_group_ids: [
        ...new Set([
          debug.selected_candidate_id,
          debug.selected_candidate_decision?.selected_candidate_id,
          ...(Array.isArray(debug.selected_candidate_decision?.selected_candidate_group_ids)
            ? debug.selected_candidate_decision.selected_candidate_group_ids
            : [])
        ].map(cleanText).filter(Boolean))
      ],
      application_decisions: applicationDecisions(debug),
      resolver_fields: result.resolved_fields || {},
      renderer_fields: renderedFields(ledger),
      instrumentation: {
        recognition_profile: result.recognition_profile || null,
        pipeline_missing_required_node_count: ledger.coverage?.missing_required_node_count ?? null,
        sensor_evidence_instrumented: nativeSensorEvidence.length > 0 || fieldFlowEvidence.length > 0,
        sensor_evidence_mode: nativeSensorEvidence.length
          ? "native_sensor_evidence"
          : fieldFlowEvidence.length
            ? "provider_field_flow_fallback"
            : "missing",
        retrieval_candidate_count: retrievalCandidates(debug).length,
        application_decision_count: debug.retrieval_application?.decisions?.length || 0
      }
    };
  });
  return {
    schema_version: v4ChainOracleTraceSchemaVersion,
    generated_at: new Date().toISOString(),
    cards
  };
}

export async function main(argv = process.argv.slice(2)) {
  const inputs = argValues(argv, "--input");
  if (!inputs.length) throw new Error("at least one --input smoke report is required");
  const output = resolve(argValue(argv, "--out", "data/eval/v4-chain-oracle/chain-trace.json"));
  const reports = await Promise.all(inputs.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))));
  const ocrPaths = argValues(argv, "--ocr-observations");
  const ocrReports = await Promise.all(ocrPaths.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))));
  const ocrObservations = ocrReports.length
    ? { cards: ocrReports.flatMap(rows) }
    : {};
  const trace = buildV4ChainOracleTraceFromSmoke(reports, ocrObservations);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(trace, null, 2)}\n`);
  console.log(JSON.stringify({ output, card_count: trace.cards.length }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
