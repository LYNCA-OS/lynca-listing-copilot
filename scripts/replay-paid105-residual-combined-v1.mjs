#!/usr/bin/env node

// Provider-free scoring of the independent-105 residual treatment. Run only
// after the paired checkpoint is complete; labels never enter request building.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { runPaidResidualCombinedV1 } from "../experiments/accuracy/paid-residual-combined-v1.mjs";
import { ARM_SPECS, requestFingerprint } from "./run-thin-path-eval.mjs";

const CONTROL = "thin_canonical_high";
const TREATMENT = "thin_canonical_residual_v1_high";
const EXPECTED_CARDS = 105;
const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? fallback) : fallback;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? null;
};
const tokens = (value) => new Set(clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const numbers = (value) => new Set((clean(value).match(/\d+/g) || []).map((part) => String(Number(part))));
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const sameSet = (left, right) => left.size === right.size
  && [...left].every((value) => right.has(value));
const score = (reference, title) => {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};

const inputPath = resolve(arg("--input"));
const manifestPath = resolve(arg("--manifest"));
const outPath = resolve(arg("--out-json", "artifacts/paid105-residual-v1/replay.json"));
if (!arg("--input") || !arg("--manifest")) {
  throw new Error("usage: replay-paid105-residual-combined-v1.mjs --input <checkpoint.jsonl> --manifest <manifest.json> [--out-json <path>]");
}
const [checkpointBody, manifestBody] = await Promise.all([readFile(inputPath), readFile(manifestPath)]);
const manifest = JSON.parse(manifestBody);
const rows = checkpointBody.toString("utf8").split(/\n+/).filter((line) => line.trim()).map(JSON.parse);
if (rows.length !== EXPECTED_CARDS * 2) throw new Error(`paid105_checkpoint_row_count:${rows.length}`);
if (manifest.checkpoint_sha256 !== sha256(checkpointBody)
    || manifest.checkpoint_rows !== rows.length
    || manifest.paired_cards !== EXPECTED_CARDS) {
  throw new Error("paid105_completed_manifest_checkpoint_mismatch");
}
const armKeys = manifest?.contract?.arms?.map(({ key }) => key) || [];
if (JSON.stringify(armKeys) !== JSON.stringify([CONTROL, TREATMENT])
    || manifest?.contract?.model !== "gpt-5.6-luna"
    || manifest?.contract?.effort !== "none"
    || manifest?.contract?.image_detail !== "high"
    || manifest?.contract?.cohort?.selection_role !== "disjoint105_learning") {
  throw new Error("paid105_manifest_contract_mismatch");
}

const byArm = new Map([[CONTROL, new Map()], [TREATMENT, new Map()]]);
for (const row of rows) {
  if (!byArm.has(row.arm)) throw new Error(`paid105_unexpected_arm:${row.arm}`);
  if (byArm.get(row.arm).has(row.asset_id)) throw new Error(`paid105_duplicate_row:${row.asset_id}:${row.arm}`);
  if (row.run_fingerprint !== manifest.fingerprint
      || row.model !== "gpt-5.6-luna"
      || row.requested_effort !== "none"
      || row.served_effort !== "none"
      || row.image_detail !== "high") {
    throw new Error(`paid105_row_contract_mismatch:${row.asset_id}:${row.arm}`);
  }
  const expectedRequest = ARM_SPECS[row.arm].buildRequest({
    imageUrls: Array.from({ length: row.image_count }, (_, index) => `https://contract.invalid/image-${index + 1}`),
    model: "gpt-5.6-luna",
    effort: "none",
    imageDetail: "high"
  });
  if (row.request_sha256 !== requestFingerprint(expectedRequest)) {
    throw new Error(`paid105_request_bytes_mismatch:${row.asset_id}:${row.arm}`);
  }
  byArm.get(row.arm).set(row.asset_id, row);
}
if ([...byArm.values()].some((arm) => arm.size !== EXPECTED_CARDS)) {
  throw new Error("paid105_arm_card_count_mismatch");
}

const allowedByMechanism = Object.freeze({
  attested_insert: new Set(["card_name"]),
  finish_family_color_only: new Set(["print_finish", "parallel_exact"]),
  product_known_manufacturer_extension: new Set(["product"]),
  serial_single_digit_v1: new Set(["serial"]),
  exact_season_suffix: new Set(["year"]),
  front_same_value_serial: new Set(["serial"]),
  typed_exact_admission: new Set(["set", "release_variant", "card_name", "product"]),
  phrase_aware_resolver_guard: new Set(["year", "card_name", "product", "set", "ip"]),
  typed_product_finish_compaction: new Set(["product", "parallel_exact", "print_finish"]),
  exact_parallel_color_compaction: new Set(["parallel_exact", "print_finish"]),
  compact_lot_quantity: new Set([])
});

const cards = [];
for (const [assetId, control] of byArm.get(CONTROL)) {
  const treatment = byArm.get(TREATMENT).get(assetId);
  if (!treatment) throw new Error(`paid105_unpaired_asset:${assetId}`);
  if (control.reference !== treatment.reference
      || control.image_set_sha256 !== treatment.image_set_sha256
      || control.image_count !== treatment.image_count) {
    throw new Error(`paid105_pair_identity_mismatch:${assetId}`);
  }
  if (treatment.residual_source_present !== true
      || treatment.residual_canonical_fields_unchanged !== true) {
    throw new Error(`paid105_residual_parse_contract_missing:${assetId}`);
  }
  const replay = runPaidResidualCombinedV1(
    treatment.fields,
    treatment.residual_replay_candidates || [],
    { sourceFingerprint: manifest.checkpoint_sha256 }
  );
  const candidateTitle = replay.bundle.candidate.title;
  const controlScore = score(control.reference, control.title);
  const treatmentScore = score(treatment.reference, treatment.title);
  const candidateScore = score(treatment.reference, candidateTitle);
  const baselineTokens = tokens(treatment.title);
  const candidateTokens = tokens(candidateTitle);
  const referenceTokens = tokens(treatment.reference);
  const controlTokens = tokens(control.title);
  const lostBaseline = difference(baselineTokens, candidateTokens);
  const referenceLosses = lostBaseline.filter((token) => referenceTokens.has(token));
  const numericMutation = difference(numbers(treatment.title), numbers(candidateTitle)).length > 0
    || difference(numbers(candidateTitle), numbers(treatment.title)).length > 0;
  const subjectFieldMutation = JSON.stringify(treatment.fields?.subjects || [])
    !== JSON.stringify(replay.bundle.candidate.fields?.subjects || []);
  const subjectTokens = tokens((treatment.fields?.subjects || []).join(" "));
  const subjectTitleLosses = difference(subjectTokens, candidateTokens)
    .filter((token) => baselineTokens.has(token));
  const unrelated = replay.bundle.stages.flatMap((stage) => stage.changed_fields
    .filter((field) => !(allowedByMechanism[stage.mechanism] || new Set()).has(field))
    .map((field) => ({ mechanism: stage.mechanism, field })));
  cards.push({
    asset_id: assetId,
    reference: treatment.reference,
    control_title: control.title,
    treatment_canonical_title: treatment.title,
    candidate_title: candidateTitle,
    control_f1: controlScore.f1,
    treatment_canonical_f1: treatmentScore.f1,
    candidate_f1: candidateScore.f1,
    control_token_set_exact: sameSet(controlTokens, referenceTokens),
    treatment_token_set_exact: sameSet(baselineTokens, referenceTokens),
    candidate_token_set_exact: sameSet(candidateTokens, referenceTokens),
    candidate_missing_reference_tokens: difference(referenceTokens, candidateTokens),
    candidate_extra_tokens: difference(candidateTokens, referenceTokens),
    candidate_numeric_reference_mismatch: !sameSet(numbers(candidateTitle), numbers(treatment.reference)),
    canonical_interference_delta_f1: treatmentScore.f1 - controlScore.f1,
    bundle_delta_f1: candidateScore.f1 - treatmentScore.f1,
    changed: candidateTitle !== treatment.title,
    changed_mechanisms: replay.bundle.stages.filter((stage) => stage.changed_title).map((stage) => stage.mechanism),
    residual_candidate_count: (treatment.residual_candidates || []).length,
    residual_replay_candidate_count: (treatment.residual_replay_candidates || []).length,
    residual_defects: treatment.residual_defects || [],
    reference_losses: referenceLosses,
    numeric_mutation: numericMutation,
    subject_field_mutation: subjectFieldMutation,
    subject_title_losses: subjectTitleLosses,
    unrelated_field_drift: unrelated,
    over_80: candidateTitle.length > 80,
    control_latency_ms: control.latency_ms,
    treatment_latency_ms: treatment.latency_ms,
    control_output_tokens: control.output_tokens,
    treatment_output_tokens: treatment.output_tokens,
    request_attempts: { control: control.request_attempt_count, treatment: treatment.request_attempt_count }
  });
}

const sign = (values) => ({
  wins: values.filter((value) => value > 1e-12).length,
  losses: values.filter((value) => value < -1e-12).length,
  ties: values.filter((value) => Math.abs(value) <= 1e-12).length
});
const bundleSign = sign(cards.map((card) => card.bundle_delta_f1));
const p50ControlLatency = quantile(cards.map((card) => card.control_latency_ms), 0.5);
const p50TreatmentLatency = quantile(cards.map((card) => card.treatment_latency_ms), 0.5);
const p95ControlLatency = quantile(cards.map((card) => card.control_latency_ms), 0.95);
const p95TreatmentLatency = quantile(cards.map((card) => card.treatment_latency_ms), 0.95);
const outputDeltas = cards.map((card) => card.treatment_output_tokens - card.control_output_tokens);
const summary = {
  cards: cards.length,
  control_macro_f1: mean(cards.map((card) => card.control_f1)),
  treatment_canonical_macro_f1: mean(cards.map((card) => card.treatment_canonical_f1)),
  candidate_macro_f1: mean(cards.map((card) => card.candidate_f1)),
  control_token_set_exact_cards: cards.filter((card) => card.control_token_set_exact).length,
  treatment_token_set_exact_cards: cards.filter((card) => card.treatment_token_set_exact).length,
  candidate_token_set_exact_cards: cards.filter((card) => card.candidate_token_set_exact).length,
  candidate_token_set_exact_rate: cards.filter((card) => card.candidate_token_set_exact).length / cards.length,
  candidate_numeric_reference_mismatch_cards: cards.filter(
    (card) => card.candidate_numeric_reference_mismatch
  ).length,
  canonical_interference_delta_f1: mean(cards.map((card) => card.canonical_interference_delta_f1)),
  residual_bundle_delta_f1: mean(cards.map((card) => card.bundle_delta_f1)),
  ...bundleSign,
  changed_cards: cards.filter((card) => card.changed).length,
  reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
  numeric_mutation_cards: cards.filter((card) => card.numeric_mutation).length,
  mechanism_subject_mutation_cards: cards.filter((card) => (
    card.subject_field_mutation || card.subject_title_losses.length
  )).length,
  unrelated_field_drift_cards: cards.filter((card) => card.unrelated_field_drift.length).length,
  over_80_cards: cards.filter((card) => card.over_80).length,
  residual_defect_cards: cards.filter((card) => card.residual_defects.length).length,
  cards_with_residual_candidates: cards.filter((card) => card.residual_candidate_count).length,
  residual_candidates: cards.reduce((sum, card) => sum + card.residual_candidate_count, 0),
  residual_replay_candidates: cards.reduce((sum, card) => sum + card.residual_replay_candidate_count, 0),
  retry_cards: cards.filter((card) => card.request_attempts.control > 1 || card.request_attempts.treatment > 1).length,
  latency: {
    control_p50_ms: p50ControlLatency,
    treatment_p50_ms: p50TreatmentLatency,
    treatment_over_control_p50: p50TreatmentLatency / p50ControlLatency,
    control_p95_ms: p95ControlLatency,
    treatment_p95_ms: p95TreatmentLatency,
    treatment_over_control_p95: p95TreatmentLatency / p95ControlLatency
  },
  output_token_delta: { p50: quantile(outputDeltas, 0.5), p95: quantile(outputDeltas, 0.95) }
};
const gate = {
  candidate_macro_f1_at_least_090: summary.candidate_macro_f1 >= 0.90,
  canonical_interference_at_least_negative_0002: summary.canonical_interference_delta_f1 >= -0.002,
  residual_bundle_delta_at_least_0003: summary.residual_bundle_delta_f1 >= 0.003,
  residual_bundle_at_least_8_wins_zero_losses: summary.wins >= 8 && summary.losses === 0,
  zero_reference_loss: summary.reference_loss_cards === 0,
  zero_numeric_mutation: summary.numeric_mutation_cards === 0,
  zero_mechanism_subject_mutation: summary.mechanism_subject_mutation_cards === 0,
  zero_unrelated_field_drift: summary.unrelated_field_drift_cards === 0,
  zero_over_80: summary.over_80_cards === 0,
  latency_budget: summary.latency.treatment_over_control_p50 <= 1.15
    && summary.latency.treatment_over_control_p95 <= 1.20,
  output_token_budget: summary.output_token_delta.p50 <= 48 && summary.output_token_delta.p95 <= 112
};
const result = {
  schema_version: "paid105-residual-combined-replay-v1",
  authority: "evaluation_only",
  claim_boundary: "development_disjoint_105_reused_learning_only_not_independent_confirmation",
  provider_calls_by_replay: 0,
  source: {
    checkpoint: inputPath,
    checkpoint_sha256: sha256(checkpointBody),
    manifest: manifestPath,
    run_fingerprint: manifest.fingerprint
  },
  summary,
  gate,
  learning_gate_pass: Object.values(gate).every(Boolean),
  production_promotion_allowed: false,
  subject_ground_truth_boundary: "sealed labels are reviewed titles, not structured subject ground truth; zero means no mechanism-introduced subject mutation",
  changed_cards: cards.filter((card) => card.changed)
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
