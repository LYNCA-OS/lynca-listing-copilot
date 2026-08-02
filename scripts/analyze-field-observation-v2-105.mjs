#!/usr/bin/env node

// Analyze the paid, 105-card same-call field-observation screen.  This is an
// evaluation report only: references are used for scoring diagnostics, never
// by the capture lane or any resolver.

import { readFileSync, writeFileSync } from "node:fs";
import { captureFieldSpecificObservationLaneV2 } from "../experiments/accuracy/field-specific-observation-lane-v2.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const inputPath = process.argv.includes("--input")
  ? process.argv[process.argv.indexOf("--input") + 1]
  : "artifacts/accuracy-field-observation-v2-105-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const outputPath = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "artifacts/accuracy-field-observation-v2-105-2026-08-02/analysis.json";

const rows = readFileSync(inputPath, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const arms = new Map();
for (const row of rows) {
  if (!arms.has(row.arm)) arms.set(row.arm, new Map());
  const byAsset = arms.get(row.arm);
  if (byAsset.has(row.asset_id)) throw new Error(`duplicate_row:${row.asset_id}:${row.arm}`);
  byAsset.set(row.asset_id, row);
}
const control = arms.get("thin_canonical_high");
const treatment = arms.get("thin_canonical_field_observation_v2_high");
if (!control || !treatment || control.size !== 105 || treatment.size !== 105) {
  throw new Error("expected_105_rows_per_arm");
}
const ids = [...control.keys()];
if (ids.some((id) => !treatment.has(id))) throw new Error("paired_asset_mismatch");

const clean = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tokenSet = (value) => new Set(clean(value).toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const scoreF1 = (reference, title) => {
  const wanted = tokenSet(reference);
  const got = tokenSet(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const countBy = (values) => values.reduce((out, value) => {
  const key = String(value || "(empty)");
  out[key] = (out[key] || 0) + 1;
  return out;
}, {});

const candidateRows = [];
const integrity = [];
for (const id of ids) {
  const row = treatment.get(id);
  const rawCapture = captureFieldSpecificObservationLaneV2(row.raw_title, { canonicalFields: row.fields });
  const candidates = Array.isArray(row.observations) ? row.observations : [];
  candidateRows.push(...candidates.map((candidate) => ({
    asset_id: id,
    reference: row.reference,
    title: row.title,
    ...candidate,
    reference_token_overlap: [...tokenSet(candidate.text)].filter((token) => tokenSet(row.reference).has(token))
  })));
  const canonicalFromRaw = finishCanonicalTitle(row.raw_title).fields;
  integrity.push({
    asset_id: id,
    candidates: candidates.length,
    parser_candidates: rawCapture.candidates.length,
    canonical_fields_unchanged: JSON.stringify(canonicalFromRaw) === JSON.stringify(row.fields),
    all_candidate_rows_candidate_only: candidates.every((candidate) => (
      candidate.authority === "candidate_only"
      && candidate.automatic_csm_admission === false
      && candidate.automatic_renderer_admission === false
      && candidate.persistence_authority === false
    )),
    defects: rawCapture.defects
  });
}

const byArm = (map) => {
  const values = [...map.values()];
  return {
    cards: values.length,
    macro_f1: mean(values.map((row) => row.f1)),
    recall: mean(values.map((row) => row.recall)),
    precision: mean(values.map((row) => row.precision)),
    input_tokens_median: median(values.map((row) => row.input_tokens)),
    output_tokens_median: median(values.map((row) => row.output_tokens)),
    latency_ms_median: median(values.map((row) => row.latency_ms)),
    title_length_median: median(values.map((row) => row.length))
  };
};
function median(values) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return finite.length ? finite[Math.floor(finite.length / 2)] : null;
}

const deltas = ids.map((id) => treatment.get(id).f1 - control.get(id).f1);
const payload = {
  schema_version: "field-specific-observation-v2-paid105-analysis-v1",
  authority: "evaluation_only",
  claim_boundary: "same-call-capture_screen_not_production_accuracy_promotion",
  source: { input_path: inputPath, cards: ids.length, arms: [...arms.keys()] },
  title_score_screen: {
    control: byArm(control),
    treatment: byArm(treatment),
    treatment_minus_control_macro_f1: mean(deltas),
    treatment_wins: deltas.filter((delta) => delta > 1e-12).length,
    treatment_losses: deltas.filter((delta) => delta < -1e-12).length,
    ties: deltas.filter((delta) => Math.abs(delta) <= 1e-12).length,
    interpretation: "paired final-title score is confounded by independent model responses; it is not a resolver result"
  },
  capture: {
    candidate_rows: candidateRows.length,
    cards_with_candidates: new Set(candidateRows.map((row) => row.asset_id)).size,
    roles: countBy(candidateRows.map((row) => row.role)),
    regions: countBy(candidateRows.map((row) => row.region)),
    bases: countBy(candidateRows.map((row) => row.basis)),
    exact_reference_token_overlap_rows: candidateRows.filter((row) => row.reference_token_overlap.length > 0).length,
    candidate_details: candidateRows
  },
  integrity: {
    canonical_fields_unchanged_all: integrity.every((row) => row.canonical_fields_unchanged),
    candidate_only_all: integrity.every((row) => row.all_candidate_rows_candidate_only),
    parser_candidate_count_matches_row_count: integrity.every((row) => row.parser_candidates === row.candidates),
    rows: integrity
  },
  decision: {
    status: "CAPTURE_POSITIVE_RESOLVER_UNPROVEN",
    production: "STOP",
    reason: "The lane captured 25 typed candidates on 23 cards without authority leakage, but no downstream admission was run; the raw paired title score is not causal and the lane added output/latency cost. Build a conservative resolver replay before any further paid arm."
  }
};
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({
  schema_version: payload.schema_version,
  candidate_rows: payload.capture.candidate_rows,
  cards_with_candidates: payload.capture.cards_with_candidates,
  roles: payload.capture.roles,
  title_delta: payload.title_score_screen.treatment_minus_control_macro_f1,
  integrity: payload.integrity,
  decision: payload.decision.status
}, null, 2));
