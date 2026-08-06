#!/usr/bin/env node

// Provider-free preregistration check for the independent-105 learning run.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { COMBINED_POSITIVE_PAID_MECHANISMS_V1 } from "../experiments/accuracy/combined-positive-bundle-v1.mjs";
import { withResidualEvidenceLaneV1 } from "../lib/listing/thin/residual-evidence-lane-v1.mjs";
import { ARM_SPECS, requestFingerprint } from "./run-thin-path-eval.mjs";
import { validateIndependentAccuracyCohort } from "./verify-independent-accuracy-cohort.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? fallback) : fallback;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));

const root = resolve(new URL("..", import.meta.url).pathname);
const datasetPath = resolve(arg("--dataset",
  "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json"));
const labelsPath = resolve(arg("--sealed-labels",
  "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl"));
const developmentPath = resolve(arg("--development",
  `${root}/artifacts/bounded-evidence-v2/cohorts/development-150.asset-ids.json`));
const assetIdsPath = resolve(arg("--asset-ids-file",
  `${root}/artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105.asset-ids.json`));
const count = Number(arg("--count", "105"));
if (count !== 105) throw new Error("paid105_readiness_requires_exactly_105_cards");

const [datasetBody, labelsBody, developmentBody, assetIdsBody] = await Promise.all([
  readFile(datasetPath), readFile(labelsPath), readFile(developmentPath), readFile(assetIdsPath)
]);
const dataset = JSON.parse(datasetBody);
const labels = labelsBody.toString("utf8").split(/\n+/).filter((line) => line.trim()).map(JSON.parse);
const developmentAssetIds = JSON.parse(developmentBody);
const selectedAssetIds = JSON.parse(assetIdsBody);
const cohort = await validateIndependentAccuracyCohort({
  dataset,
  developmentAssetIds,
  selectedAssetIds,
  sealedLabels: labels,
  targetCount: count
});

const context = {
  imageUrls: ["https://contract.invalid/front", "https://contract.invalid/back"],
  model: "gpt-5.6-luna",
  effort: "none",
  imageDetail: "high"
};
const control = ARM_SPECS.thin_canonical_high.buildRequest(context);
const treatment = ARM_SPECS.thin_canonical_residual_v1_high.buildRequest(context);
const expectedTreatment = withResidualEvidenceLaneV1(control, { enabled: true });
if (JSON.stringify(treatment) !== JSON.stringify(expectedTreatment)) {
  throw new Error("residual_treatment_diff_exceeds_frozen_transform");
}
if (requestFingerprint(control) === requestFingerprint(treatment)) {
  throw new Error("control_treatment_request_bytes_identical");
}
for (const name of ["model", "max_output_tokens", "reasoning"]) {
  if (JSON.stringify(control[name]) !== JSON.stringify(treatment[name])) {
    throw new Error(`residual_treatment_unexpected_request_change:${name}`);
  }
}
const controlImages = control.input[0].content.filter(({ type }) => type === "input_image");
const treatmentImages = treatment.input[0].content.filter(({ type }) => type === "input_image");
if (JSON.stringify(controlImages) !== JSON.stringify(treatmentImages)) {
  throw new Error("residual_treatment_image_contract_changed");
}
if (COMBINED_POSITIVE_PAID_MECHANISMS_V1.length !== 11
    || COMBINED_POSITIVE_PAID_MECHANISMS_V1.includes("candidate_identity_v3")) {
  throw new Error("paid_mechanism_set_not_frozen_11");
}

const result = {
  ok: true,
  schema_version: "paid105-residual-readiness-v1",
  claim_boundary: "development_disjoint_105_reused_learning_only_not_independent_confirmation",
  cohort: {
    ...cohort,
    development_card_disjoint: true,
    mechanism_selection_independent: false,
    prior_replay_evidence: [
      "artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105-nonserial-confirmation-v3.json",
      "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/safe-bundle-replay-outside-105.json"
    ],
    dataset_sha256: sha256(datasetBody),
    sealed_labels_sha256: sha256(labelsBody),
    development_asset_ids_sha256: sha256(developmentBody),
    selected_asset_ids_file_sha256: sha256(assetIdsBody)
  },
  request_contract: {
    model: context.model,
    reasoning_effort: context.effort,
    image_detail: context.imageDetail,
    images_per_request: 2,
    treatment_provider_calls_per_card: 1,
    paired_provider_calls_per_card: 2,
    expected_treatment_calls: count,
    expected_total_paired_calls: count * 2,
    control_request_sha256: requestFingerprint(control),
    treatment_request_sha256: requestFingerprint(treatment),
    control_request_bytes: bytes(control),
    treatment_request_bytes: bytes(treatment),
    request_delta_bytes: bytes(treatment) - bytes(control),
    prompt_delta_bytes: bytes(treatment.input[0].content[0].text) - bytes(control.input[0].content[0].text),
    schema_delta_bytes: bytes(treatment.text.format.schema) - bytes(control.text.format.schema),
    no_second_stage_call: true,
    no_cloud_run_vector_ocr_or_web: true
  },
  offline_bundle: {
    name: "combined-positive-bundle-v1",
    enabled_mechanisms: [...COMBINED_POSITIVE_PAID_MECHANISMS_V1],
    mechanism_count: COMBINED_POSITIVE_PAID_MECHANISMS_V1.length,
    provider_calls: 0,
    residual_authority: "candidate_only_until_typed_guard"
  },
  preregistered_learning_gate: {
    candidate_macro_f1_at_least: 0.90,
    reference_loss_cards: 0,
    numeric_mutation_cards: 0,
    mechanism_subject_mutation_cards: 0,
    unrelated_field_drift_cards: 0,
    titles_over_80: 0,
    treatment_canonical_interference_delta_f1_at_least: -0.002,
    residual_offline_bundle_delta_f1_at_least: 0.003,
    residual_offline_bundle_wins_at_least: 8,
    residual_offline_bundle_losses: 0,
    latency_treatment_over_control_p50_at_most: 1.15,
    latency_treatment_over_control_p95_at_most: 1.20,
    output_token_delta_p50_at_most: 48,
    output_token_delta_p95_at_most: 112,
    production_promotion_allowed: false
  },
  label_boundary: {
    ground_truth: "reviewed_title_only",
    raw_subject_identification_error_can_be_certified: false,
    enforceable_subject_gate: "bundle_must_not_mutate_canonical_subjects_or_drop_subject_title_tokens"
  }
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
