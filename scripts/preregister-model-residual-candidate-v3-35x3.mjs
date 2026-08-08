#!/usr/bin/env node

// Provider-free preregistration. It reads historical response-side features,
// never scoring labels, and cannot execute a provider request.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ARM_SPECS } from "./run-thin-path-eval.mjs";
import {
  assertScreenSchedule,
  assertThreeArmRequestIsolation,
  balancedThreeArmSchedule,
  providerOnlyFeatures,
  selectLabelBlindCohort
} from "../experiments/accuracy/model-residual-v3-screen-plan.mjs";
import {
  MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3,
  MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3,
  withModelResidualCandidateLaneV3
} from "../experiments/accuracy/model-residual-candidate-lane-v3.mjs";

const SOURCE_ROWS = "artifacts/accuracy-field-observation-v2-105-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const SOURCE_IDS = "artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105.asset-ids.json";
const IDS = "experiments/accuracy/model-residual-candidate-v3-35.asset-ids.json";
const OUT = "experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json";
const DATASET_PATH = "data/eval/reviewed-title-blind/reviewed-title-image-only.json";
const LABELS_PATH = "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl";
const EXPECTED_ROWS_SHA = "b844dc7edcdbefdee41ca84dc2786772dd3b487b00fbe88444b905b58029b560";
const EXPECTED_IDS_SHA = "2e834df556ac1b8b6c9d929e6da3c77764a27f4aa05856f04453db6b7ca3769f";
const EXPECTED_DATASET_SHA = "5aebd6a4bb08665d6601801258e39a5954ec82b7187f71f577f18c71bd27adca";
const EXPECTED_LABEL_REF_MAPPING_SHA = "16d80d87632d083a6abb98fedc5c6c57c47092369391f92f1bd684f0ece75ab9";
const EXPECTED_SEALED_LABELS_SHA = "59669f166180aab0bef24b5133b3cc92b06366f955eae54af0c43f7247436646";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const rowsBody = readFileSync(SOURCE_ROWS);
const idsBody = readFileSync(SOURCE_IDS);
if (sha256(rowsBody) !== EXPECTED_ROWS_SHA) throw new Error("v3_prereg_source_rows_hash_mismatch");
if (sha256(idsBody) !== EXPECTED_IDS_SHA) throw new Error("v3_prereg_source_ids_hash_mismatch");
const sourceIds = JSON.parse(idsBody);
const rows = String(rowsBody).trim().split("\n").filter(Boolean).map(JSON.parse);
const features = providerOnlyFeatures(rows);
if (features.length !== 105 || sourceIds.length !== 105
  || [...features].map((row) => row.asset_id).sort().join("\0") !== [...sourceIds].sort().join("\0")) {
  throw new Error("v3_prereg_outside105_membership_mismatch");
}
const cohort = selectLabelBlindCohort(features);
const schedule = balancedThreeArmSchedule(cohort);
const scheduleEvidence = assertScreenSchedule(schedule);

const context = {
  imageUrls: ["https://contract.invalid/front", "https://contract.invalid/back"],
  model: "gpt-5.6-luna",
  effort: "low",
  imageDetail: "high"
};
const controlA = ARM_SPECS.thin_canonical_high_effort_low.buildRequest(context);
const controlB = structuredClone(controlA);
const residualC = withModelResidualCandidateLaneV3(controlA, { enabled: true });
const contract = assertThreeArmRequestIsolation({ controlA, controlB, residualC });
const selectedIds = schedule.map((row) => row.asset_id);
const evalRoot = resolve(process.env.LYNCA_EVAL_ROOT || "/Users/paidaxin/lynca-eval-root");
const datasetBody = readFileSync(resolve(evalRoot, DATASET_PATH));
if (sha256(datasetBody) !== EXPECTED_DATASET_SHA) throw new Error("v3_prereg_dataset_hash_mismatch");
const dataset = JSON.parse(datasetBody);
const datasetById = new Map((dataset.items || []).map((item) => [item.asset_id, item]));
const selectedLabelRefs = schedule.map(({ asset_id }) => ({ asset_id,
  sealed_eval_label_ref: structuredClone(datasetById.get(asset_id)?.sealed_eval_label_ref) }));
if (selectedLabelRefs.some((row) => row.sealed_eval_label_ref?.path !== LABELS_PATH
    || typeof row.sealed_eval_label_ref?.key !== "string")
  || sha256(JSON.stringify(selectedLabelRefs)) !== EXPECTED_LABEL_REF_MAPPING_SHA) {
  throw new Error("v3_prereg_label_ref_mapping_mismatch");
}

const prereg = {
  schema_version: "model-residual-candidate-v3-35x3-prereg-v2",
  authority: "evaluation_only",
  status: "AWAITING_INDEPENDENT_REVIEW",
  execution_authorized: false,
  provider_calls_made: 0,
  design: {
    unique_cards: 35,
    arms_per_card: 3,
    planned_provider_calls: 105,
    arms: {
      control_a: "canonical low/high",
      control_b: "byte-identical repeat of control_a",
      residual_c: "control_a plus response-schema-only candidate lane"
    },
    estimands: {
      self_jitter: "control_b - control_a",
      canonical_interference: "residual_c canonical output - mean(control_a, control_b)",
      resolver_utility: "residual_c resolved title - residual_c canonical-only title"
    },
    cohort: "outside105; 14 prior candidate-rich + 14 prior schema-sensitive + 7 prior stable controls",
    selection_authority: "provider-response-only features; scorer labels and reviewed titles are not projected",
    order_balance: scheduleEvidence.order_counts,
    claim_boundary: "enriched development screen; never accuracy promotion or production authority"
  },
  frozen_contract: {
    model: context.model,
    reasoning_effort: "low",
    image_detail: "high",
    max_output_tokens: controlA.max_output_tokens,
    prompt_sha256: sha256(controlA.input[0].content.find((part) => part.type === "input_text").text),
    prompt_bytes_unchanged: true,
    format_name_unchanged: controlA.text.format.name === residualC.text.format.name,
    controls_byte_identical: JSON.stringify(controlA) === JSON.stringify(controlB),
    treatment_changes_response_schema_only: true,
    allowed_treatment_delta_paths: [
      "text.format.schema.properties.residual_visible_evidence",
      "text.format.schema.required[0]"
    ],
    ...contract,
    candidate_property: MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3,
    candidate_max_rows: MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3,
    no_second_call: true,
    runner_network_capability: "none; execution requires a separately reviewed injected adapter"
  },
  authorization: {
    default: "STOP",
    required_receipt_schema: "model-residual-v3-paid105-authorization-v1",
    receipt_must_bind: ["run_fingerprint", "prereg_sha256", "max_provider_attempts=105"]
  },
  analysis: {
    controls: "retain both A and B; never choose the better control post hoc",
    self_jitter_report: ["exact canonical equality", "paired macro-F1 distribution", "field disagreement rate"],
    candidate_capture_report: ["cards with rows", "rows by role and region", "0/1/2/3 is not applicable because C runs once"],
    primary_screen_gate: {
      resolver_delta_macro_f1_at_least: 0.003,
      resolver_wins_at_least: 8,
      resolver_losses: 0,
      reference_loss_cards: 0,
      unbacked_new_token_cards: 0,
      unsupported_numeric_change_cards: 0,
      titles_over_80: 0
    },
    canonical_interference_gate: {
      mean_delta_f1_at_least: -0.002,
      assessed_against: "mean of both controls, with self-jitter interval shown",
      canonical_field_shape_defects: 0
    },
    cost_latency_gate: {
      treatment_to_pooled_control_input_tokens_p50_at_most: 1.06,
      treatment_to_pooled_control_latency_p50_at_most: 1.15,
      treatment_to_pooled_control_latency_p95_at_most: 1.20
    }
  },
  sources: {
    provider_rows: { path: SOURCE_ROWS, sha256: EXPECTED_ROWS_SHA, tracked: false },
    outside105_ids: { path: SOURCE_IDS, sha256: EXPECTED_IDS_SHA, tracked: false },
    selected_asset_ids_sha256: sha256(`${JSON.stringify(selectedIds, null, 2)}\n`)
  },
  analysis_inputs: {
    dataset_path: DATASET_PATH,
    dataset_sha256: EXPECTED_DATASET_SHA,
    selected_label_ref_mapping_sha256: EXPECTED_LABEL_REF_MAPPING_SHA,
    expected_labels_path: LABELS_PATH,
    sealed_labels_sha256: EXPECTED_SEALED_LABELS_SHA,
    sealed_label_bytes_read_before_predictions_frozen: false
  },
  cohort: schedule
};

mkdirSync(dirname(IDS), { recursive: true });
writeFileSync(IDS, `${JSON.stringify(selectedIds, null, 2)}\n`);
writeFileSync(OUT, `${JSON.stringify(prereg, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  out: OUT,
  ids: IDS,
  provider_calls_made: 0,
  planned_provider_calls: 105,
  selected_cards: 35,
  controls_byte_identical: true,
  treatment_changes_response_schema_only: true,
  order_counts: scheduleEvidence.order_counts
}, null, 2)}\n`);
