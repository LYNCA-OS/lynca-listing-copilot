#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSemPrediction, normalizeGoldenSemValue } from "../lib/listing/evaluation/golden-sem-accuracy.mjs";
import { semProjectionFromTitle } from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";

const LOSS = Object.freeze({
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

function retrievalMatches(result, field, expected) {
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

function classifyField({ expected, observation, resolved, final, retrieval }) {
  if (valuesMatch(expected.field, expected.value, final)) return LOSS.PRESERVED;
  if (valuesMatch(expected.field, expected.value, resolved)) return LOSS.RENDERER;
  if (valuesMatch(expected.field, expected.value, observation)) return LOSS.RESOLVER;
  const selected = retrieval.filter((entry) => entry.selected);
  if (selected.some((entry) => ["APPLY", "SUPPORT"].includes(entry.decision))) return LOSS.RESOLVER;
  if (selected.length) return LOSS.APPLICATION;
  if (retrieval.length) return LOSS.SELECTION;
  return LOSS.RETRIEVAL;
}

export function analyzeSemStageLoss(report = {}) {
  const rows = [];
  const traceLimitations = new Set();
  for (const result of Array.isArray(report.results) ? report.results : []) {
    const expectedProjection = semProjectionFromTitle(result.reference_title || result.reviewed_title || "");
    const observationSnapshot = result?.l2_candidate_debug?.candidate_observation_snapshot || {};
    const observationSem = canonicalSemPrediction({ resolved_fields: observationSnapshot });
    const resolvedSem = canonicalSemPrediction({ resolved_fields: result.resolved_fields || {} });
    const finalProjection = semProjectionFromTitle(result.final_title || "");
    if (!result.provider_raw_observation && !result.provider_observation) {
      traceLimitations.add("Raw Provider observation is absent; Provider miss and normalization drop cannot be separated.");
    }
    for (const [field, status] of Object.entries(expectedProjection.field_statuses || {})) {
      if (status !== "CONFIRMED") continue;
      const value = expectedProjection.sem?.[field];
      if (!normalizeGoldenSemValue(field, value)) continue;
      const retrieval = retrievalMatches(result, field, value);
      const classification = classifyField({
        expected: { field, value },
        observation: observationSem[field],
        resolved: resolvedSem[field],
        final: finalProjection.sem?.[field],
        retrieval
      });
      rows.push({
        job_id: result.job_id || null,
        asset_id: result.asset_id || null,
        field,
        expected_value: value,
        observation_value: observationSem[field] ?? null,
        resolved_value: resolvedSem[field] ?? null,
        final_value: finalProjection.sem?.[field] ?? null,
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
    traceLimitations.add("When neither normalized observation nor persisted candidate decisions contain the expected value, the report cannot distinguish an Evidence miss from a Retrieval miss.");
  }
  return {
    schema_version: "sem-stage-loss-audit-v1",
    authority: "reviewed-title-derived-sem-proxy",
    tuning_eligible: false,
    result_count: Array.isArray(report.results) ? report.results.length : 0,
    confirmed_field_count: rows.length,
    preserved_field_count: counts[LOSS.PRESERVED] || 0,
    missing_field_count: missingRows.length,
    preservation_rate: rows.length ? Number(((counts[LOSS.PRESERVED] || 0) / rows.length).toFixed(6)) : null,
    classification_counts: counts,
    largest_actionable_or_trace_category: largest ? { category: largest[0], count: largest[1] } : null,
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
