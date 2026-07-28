#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSemPrediction, normalizeGoldenSemValue } from "../lib/listing/evaluation/golden-sem-accuracy.mjs";
import { semProjectionFromTitle } from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";

const LOSS = Object.freeze({
  TRACE: "TRACE_MISSING",
  UNKNOWN: "UNKNOWN",
  RETRIEVAL: "EVIDENCE_OR_RETRIEVAL_MISSING",
  SELECTION: "CANDIDATE_NOT_SELECTED",
  APPLICATION: "SAFE_APPLICATION_BLOCKED",
  RESOLVER: "RESOLVER_DROPPED",
  RENDERER: "RENDERER_DROPPED",
  PRESERVED: "PRESERVED_IN_FINAL"
});

const decisionFieldToSem = Object.freeze({
  year: "year",
  manufacturer: "manufacturer",
  brand: "manufacturer",
  product: "product",
  set: "set",
  subset: "set",
  insert: "card_name",
  player: "subject",
  players: "subject",
  subject: "subject",
  character: "subject",
  card_name: "card_name",
  official_card_type: "card_name",
  card_type: "card_name",
  card_number: "card_number",
  checklist_code: "card_number",
  collector_number: "card_number",
  rarity: "descriptive_rarity",
  numerical_rarity: "numerical_rarity",
  print_run_number: "numerical_rarity",
  serial_number: "numerical_rarity",
  release_variant: "release_variant",
  variation: "release_variant",
  print_finish: "print_finish",
  parallel: "print_finish",
  parallel_exact: "print_finish",
  parallel_family: "print_finish",
  surface_color: "print_finish"
});

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valuesMatch(field, expected, actual) {
  const left = normalizeGoldenSemValue(field, expected);
  const right = normalizeGoldenSemValue(field, actual);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftParts = left.split("|").filter(Boolean);
  const rightParts = right.split("|").filter(Boolean);
  return leftParts.every((part) => rightParts.includes(part));
}

function anyValueMatches(field, expected, values = []) {
  return (Array.isArray(values) ? values : [values]).some((value) => valuesMatch(field, expected, value));
}

function reportedValue(field, value) {
  return normalizeGoldenSemValue(field, value) ? value : null;
}

function fieldLineage(result, field) {
  return (Array.isArray(result?.evaluation_decision_trace_packet?.field_lineage)
    ? result.evaluation_decision_trace_packet.field_lineage
    : []).find((entry) => entry?.field === field) || null;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasOwnAny(value = {}, keys = []) {
  const row = plainObject(value);
  return keys.some((key) => Object.hasOwn(row, key));
}

function evaluationPacket(result = {}) {
  const packet = plainObject(result.evaluation_decision_trace_packet);
  return packet.trace_level === "evaluation" ? packet : null;
}

function stageAvailable(packet = null, stage = "", legacyPath = []) {
  if (!packet) return false;
  const explicitStatus = clean(packet.stage_execution?.[stage]?.status).toUpperCase();
  if (explicitStatus) return ["RAN", "RAN_EMPTY"].includes(explicitStatus);
  let current = packet;
  for (const key of legacyPath) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

function normalizedEvidence(result = {}, packet = null) {
  if (stageAvailable(packet, "normalization", ["normalization", "output"])) {
    return plainObject(packet.normalization?.output);
  }
  if (hasOwnAny(result, ["raw_observed_fields"])) return plainObject(result.raw_observed_fields);
  if (hasOwnAny(result, ["evidence_fields"])) return plainObject(result.evidence_fields);
  return {};
}

function missingTraceForField(packet = null) {
  return !stageAvailable(packet, "provider_observation", ["provider_observation_fields"])
    || !stageAvailable(packet, "normalization", ["normalization", "output"])
    || !stageAvailable(packet, "retrieval", ["retrieval"]);
}

function retrievalMatches(result, field, expected) {
  const lineage = fieldLineage(result, field);
  if (lineage) {
    return (Array.isArray(lineage.retrieval?.decisions) ? lineage.retrieval.decisions : []).flatMap((decision) => (
      valuesMatch(field, expected, decision.value) ? [{
        candidate_id: clean(decision.candidate_id),
        selected: decision.selected === true,
        decision: clean(decision.action).toUpperCase(),
        reason: clean(decision.reason),
        applied_to_final: decision.action === "APPLY",
        supported_final: decision.action === "SUPPORT"
      }] : []
    ));
  }
  const trace = result?.l2_candidate_debug || {};
  const selectedId = clean(trace.selected_candidate_id);
  const decisions = Array.isArray(trace?.retrieval_application?.decisions)
    ? trace.retrieval_application.decisions
    : [];
  return decisions.flatMap((decision) => {
    const semField = decisionFieldToSem[clean(decision.field)] || decisionFieldToSem[clean(decision.resolver_field)];
    if (semField !== field || !valuesMatch(field, expected, decision.candidate_value)) return [];
    return [{
      candidate_id: clean(decision.candidate_id),
      selected: clean(decision.candidate_id) === selectedId,
      decision: clean(decision.decision).toUpperCase(),
      reason: clean(decision.reason),
      applied_to_final: decision.applied_to_final === true,
      supported_final: decision.supported_final === true
    }];
  });
}

function classifyField({ expected, observation, resolved, final, retrieval, traceMissing = false }) {
  if (!normalizeGoldenSemValue(expected.field, expected.value)) return LOSS.UNKNOWN;
  if (valuesMatch(expected.field, expected.value, final)) return LOSS.PRESERVED;
  if (valuesMatch(expected.field, expected.value, resolved)) return LOSS.RENDERER;
  if (valuesMatch(expected.field, expected.value, observation)) return LOSS.RESOLVER;
  const selected = retrieval.filter((entry) => entry.selected);
  if (selected.some((entry) => ["APPLY", "SUPPORT"].includes(entry.decision))) return LOSS.RESOLVER;
  if (selected.length) return LOSS.APPLICATION;
  if (retrieval.length) return LOSS.SELECTION;
  if (traceMissing) return LOSS.TRACE;
  return LOSS.RETRIEVAL;
}

export function analyzeSemStageLoss(report = {}) {
  const rows = [];
  const traceLimitations = new Set();
  for (const result of Array.isArray(report.results) ? report.results : []) {
    const expectedProjection = semProjectionFromTitle(result.reference_title || result.reviewed_title || "");
    const packet = evaluationPacket(result);
    const normalizedSnapshot = normalizedEvidence(result, packet);
    const observationSem = canonicalSemPrediction({ resolved_fields: normalizedSnapshot });
    const resolvedSem = canonicalSemPrediction({ resolved_fields: result.resolved_fields || {} });
    const finalProjection = semProjectionFromTitle(result.final_title || "");
    if (!stageAvailable(packet, "provider_observation", ["provider_observation_fields"])) {
      traceLimitations.add("Evaluation Provider stage trace is absent; missing evidence is TRACE_MISSING, not a guessed Provider miss.");
    }
    for (const [field, status] of Object.entries(expectedProjection.field_statuses || {})) {
      if (status !== "CONFIRMED") continue;
      const value = expectedProjection.sem?.[field];
      if (!normalizeGoldenSemValue(field, value)) continue;
      const retrieval = retrievalMatches(result, field, value);
      const lineage = fieldLineage(result, field);
      const lineageObservation = lineage?.normalization?.values || [];
      const lineageResolved = lineage?.resolver?.values || [];
      const lineageFinal = lineage?.final_title_span?.matched_values || [];
      const classification = classifyField({
        expected: { field, value },
        observation: anyValueMatches(field, value, lineageObservation) ? value : observationSem[field],
        resolved: anyValueMatches(field, value, lineageResolved) ? value : resolvedSem[field],
        final: anyValueMatches(field, value, lineageFinal) ? value : finalProjection.sem?.[field],
        retrieval,
        traceMissing: missingTraceForField(packet)
      });
      rows.push({
        job_id: result.job_id || null,
        asset_id: result.asset_id || null,
        field,
        expected_value: value,
        observation_value: anyValueMatches(field, value, lineageObservation)
          ? value
          : reportedValue(field, observationSem[field]),
        resolved_value: reportedValue(field, resolvedSem[field]),
        final_value: reportedValue(field, finalProjection.sem?.[field]),
        retrieval_matches: retrieval,
        classification,
        reference_title: result.reference_title || null,
        final_title: result.final_title || null
      });
    }
  }
  const counts = {};
  for (const row of rows) counts[row.classification] = (counts[row.classification] || 0) + 1;
  const missingRows = rows.filter((row) => row.classification !== LOSS.PRESERVED);
  const missingCounts = Object.fromEntries(Object.entries(counts).filter(([key]) => key !== LOSS.PRESERVED));
  const largest = Object.entries(missingCounts).sort((left, right) => right[1] - left[1])[0] || null;
  if ((missingCounts[LOSS.RETRIEVAL] || 0) > 0) {
    traceLimitations.add("Evidence and Retrieval are both present, but this stage report defers their exact split to the GT-aware evaluation decision trace classifier.");
  }
  // Classification totals say which *stage* leaks; they do not say which field,
  // and the field is what you go and fix. On the 2026-07-25 cold-20 the totals
  // read "25 evidence/retrieval missing", which is not actionable, while the
  // per-field rollup showed one field (search_optimization) accounted for 8 of
  // 32 losses and was null on 20/20 cards. Ship the rollup with the audit so
  // that step is not a manual re-derivation every time.
  const fieldLoss = new Map();
  for (const row of missingRows) {
    const field = row.field || "(unknown)";
    const entry = fieldLoss.get(field) || { field, total: 0, by_classification: {} };
    entry.total += 1;
    entry.by_classification[row.classification] = (entry.by_classification[row.classification] || 0) + 1;
    fieldLoss.set(field, entry);
  }
  const fieldLossSummary = [...fieldLoss.values()].sort((left, right) => (
    (right.total - left.total) || left.field.localeCompare(right.field)
  ));

  return {
    schema_version: "sem-stage-loss-audit-v2",
    authority: "reviewed-title-derived-sem-proxy",
    tuning_eligible: false,
    result_count: Array.isArray(report.results) ? report.results.length : 0,
    confirmed_field_count: rows.length,
    preserved_field_count: counts[LOSS.PRESERVED] || 0,
    missing_field_count: missingRows.length,
    preservation_rate: rows.length ? Number(((counts[LOSS.PRESERVED] || 0) / rows.length).toFixed(6)) : null,
    classification_counts: counts,
    largest_actionable_or_trace_category: largest ? { category: largest[0], count: largest[1] } : null,
    field_loss_summary: fieldLossSummary,
    top_lossy_field: fieldLossSummary[0] || null,
    trace_limitations: [...traceLimitations],
    rows
  };
}

async function main(argv = process.argv.slice(2)) {
  const inputPath = argv[0];
  if (!inputPath) throw new Error("Usage: analyze-sem-stage-loss.mjs <report.json> [output.json]");
  const outputPath = argv[1] || null;
  const report = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const analysis = analyzeSemStageLoss(report);
  const serialized = `${JSON.stringify(analysis, null, 2)}\n`;
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, serialized);
  } else {
    process.stdout.write(serialized);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
