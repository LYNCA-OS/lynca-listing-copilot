#!/usr/bin/env node

// Network-free preregistration. Cohort selection reads asset identifiers only;
// it never opens the image dataset, sealed labels, or provider credentials.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ARM_SPECS } from "./run-thin-path-eval.mjs";
import {
  MODEL_RESIDUAL_COMPACT_V4_CONCURRENCY,
  MODEL_RESIDUAL_COMPACT_V4_CONFIRMATORY_SALT,
  MODEL_RESIDUAL_COMPACT_V4_DETAIL,
  MODEL_RESIDUAL_COMPACT_V4_EFFORT,
  MODEL_RESIDUAL_COMPACT_V4_MAX_ATTEMPTS_PER_JOB,
  MODEL_RESIDUAL_COMPACT_V4_MODEL,
  MODEL_RESIDUAL_COMPACT_V4_PROPERTY,
  MODEL_RESIDUAL_COMPACT_V4_REGION,
  MODEL_RESIDUAL_COMPACT_V4_SCHEMA_SHA256,
  assertCompactV4BudgetSchedule,
  assertCompactV4RequestIsolation,
  balancedCompactV4BudgetSchedule,
  binomialTailProbability,
  minimumTrialsForBinomialPower,
  selectCompactV4ConfirmatoryCohort,
  withModelResidualCompactV4
} from "../experiments/accuracy/model-residual-compact-v4-cloud-plan.mjs";

const SOURCE_105 = "artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105.asset-ids.json";
const DEVELOPMENT_35 = "experiments/accuracy/model-residual-candidate-v3-35.asset-ids.json";
const V3_PREREG = "experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json";
const V3_PAYLOAD = "artifacts/model-residual-v3-paid105-2026-08-08/payload.json";
const V3_CHECKPOINT = "artifacts/model-residual-v3-paid105-2026-08-08/checkpoint.json";
const OUT_IDS = "experiments/accuracy/model-residual-compact-v4-confirmatory-70.asset-ids.json";
const OUT = "experiments/accuracy/model-residual-compact-v4-cloud-prereg.json";
const EXPECTED_HASHES = Object.freeze({
  source_105: "2e834df556ac1b8b6c9d929e6da3c77764a27f4aa05856f04453db6b7ca3769f",
  development_35: "0fef6bcf50d32914f1e93323eccef02f240aec90d08f2c5a0a309d9df77a5386",
  v3_prereg: "bb6c651acef754beb7ed260614d4017af981057b7eda3bddeb3e775a7b5590e8",
  v3_payload: "26684cd3bac9a5dec7748af3cc831afb22bf9b8011ed150a4044def0bb83f843",
  v3_checkpoint: "5e51bf36f1a8ed444cf2269668821c53abbad594eea286615cae974b69aad0dd"
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const DEVELOPMENT_WIN_RATE = 4 / 35;

function readFrozen(path, expectedHash, errorCode) {
  const body = readFileSync(path);
  if (sha256(body) !== expectedHash) throw new Error(errorCode);
  return body;
}

function buildRequest(imageCount) {
  const imageUrls = Array.from({ length: imageCount }, (_, index) =>
    `https://contract.invalid/image-${index + 1}`);
  return ARM_SPECS.thin_canonical_high_effort_low.buildRequest({
    imageUrls,
    model: MODEL_RESIDUAL_COMPACT_V4_MODEL,
    effort: MODEL_RESIDUAL_COMPACT_V4_EFFORT,
    imageDetail: MODEL_RESIDUAL_COMPACT_V4_DETAIL
  });
}

const source105Body = readFrozen(SOURCE_105, EXPECTED_HASHES.source_105,
  "compact_v4_source105_hash_mismatch");
const development35Body = readFrozen(DEVELOPMENT_35, EXPECTED_HASHES.development_35,
  "compact_v4_development35_hash_mismatch");
readFrozen(V3_PREREG, EXPECTED_HASHES.v3_prereg, "compact_v4_v3_prereg_hash_mismatch");
readFrozen(V3_PAYLOAD, EXPECTED_HASHES.v3_payload, "compact_v4_v3_payload_hash_mismatch");
readFrozen(V3_CHECKPOINT, EXPECTED_HASHES.v3_checkpoint, "compact_v4_v3_checkpoint_hash_mismatch");

const source105 = JSON.parse(source105Body);
const development35 = JSON.parse(development35Body);
if (source105.length !== 105 || development35.length !== 35
    || development35.some((assetId) => !source105.includes(assetId))) {
  throw new Error("compact_v4_cohort_membership_invalid");
}
const confirmatory70 = selectCompactV4ConfirmatoryCohort(source105, development35);
const schedule = balancedCompactV4BudgetSchedule(confirmatory70);
const scheduleEvidence = assertCompactV4BudgetSchedule(schedule);
const requestContracts = Object.fromEntries([1, 2].map((imageCount) => {
  const control = buildRequest(imageCount);
  const treatment = withModelResidualCompactV4(control);
  return [String(imageCount), assertCompactV4RequestIsolation({ control, treatment })];
}));
const controlTwoImage = buildRequest(2);
const prompt = controlTwoImage.input[0].content.find((part) => part.type === "input_text")?.text;
if (!prompt) throw new Error("compact_v4_prompt_missing");

const frozenContract = {
  provider: {
    model: MODEL_RESIDUAL_COMPACT_V4_MODEL,
    reasoning_effort: MODEL_RESIDUAL_COMPACT_V4_EFFORT,
    image_detail: MODEL_RESIDUAL_COMPACT_V4_DETAIL,
    max_output_tokens: controlTwoImage.max_output_tokens,
    prompt_sha256: sha256(prompt),
    response_format_name: controlTwoImage.text.format.name,
    compact_property: MODEL_RESIDUAL_COMPACT_V4_PROPERTY,
    compact_property_schema_sha256: MODEL_RESIDUAL_COMPACT_V4_SCHEMA_SHA256,
    request_contracts_by_image_count: requestContracts,
    treatment_changes_response_schema_only: true,
    no_second_call: true
  },
  execution: {
    environment: "preview",
    project: "lynca-capacity-lab",
    region: MODEL_RESIDUAL_COMPACT_V4_REGION,
    concurrency: MODEL_RESIDUAL_COMPACT_V4_CONCURRENCY,
    retry_policy: "none",
    max_attempts_per_job: MODEL_RESIDUAL_COMPACT_V4_MAX_ATTEMPTS_PER_JOB,
    checkpoint_before_next_job: true,
    durable_attempt_ledger_fsynced_before_invoke: true,
    attempted_or_ambiguous_resume_policy: "STOP_FOR_RECONCILIATION; never reinvoke",
    one_process_out_dir_lock: true,
    production_endpoint_forbidden: true
  },
  execution_hard_blockers_before_authorization: [
    "exact physical assets-only manifest with asset, image role, object path, and image-set hash",
    "dataset-to-label-ref mapping and sealed-label bytes hash frozen outside the execution process",
    "immutable Preview deployment, hostname, project, and sin1 receipt",
    "signed-URL payload hash plus per-job remaining-TTL proof",
    "authorization receipt hash persisted in every checkpoint event",
    "existing COMPLETE events verify response id, served model and effort, request and raw response hashes",
    "full structured output and raw provider hashes retained for deterministic zero-call replay"
  ]
};

const stages = {
  zero_call_precondition: {
    status: "PASS",
    source: "model-residual-compact-v4-zero-call-screen-v1",
    exact_title_fidelity_vs_wide_v3: "35/35",
    exact_field_fidelity_vs_wide_v3: "35/35",
    required_exact_title_fidelity: "35/35",
    required_exact_field_fidelity: "35/35",
    previously_blocking_asset_id: "reviewed_blind_a9aadb9c5ddd197c1cb8",
    recovered_field: "Product Chrome -> Topps Chrome through a strict printed token-superset route",
    decision_role: "title and field compression fidelity pass; this does not prove provider capture"
  },
  budgeted_strict_70t_35c: {
    status: "READY_AWAITING_INDEPENDENT_AUTHORIZATION",
    cohort_role: "fixed-hash label-blind 70-card reserve outside v3 development35",
    selection_salt: MODEL_RESIDUAL_COMPACT_V4_CONFIRMATORY_SALT,
    treatment_cards: 70,
    contemporaneous_paired_control_cards: 35,
    arms: ["compact_treatment_on_all_70", "fresh_control_on_fixed_35_subset"],
    planned_provider_calls: 105,
    max_provider_attempts: 105,
    balanced_order: scheduleEvidence.order_counts,
    decision_role: "strict budgeted mechanism confirmation; may enter a fresh150 bundle only",
    design_reason: "utility is paired within each treatment response; controls are needed only for schema interference and relative latency"
  }
};

const gates = {
  zero_call_precondition: {
    exact_title_fidelity_cards: 35,
    exact_field_fidelity_cards: 35,
    resolver_losses: 0,
    reference_loss_cards: 0,
    unbacked_new_token_cards: 0,
    unsupported_numeric_change_cards: 0,
    titles_over_80: 0
  },
  budgeted_strict_70t_35c: {
    resolver_delta_macro_f1_at_least: 0.003,
    resolver_wins_at_least: 6,
    resolver_losses: 0,
    two_sided_exact_sign_p_at_most: 0.05,
    critical_error_cards: 0,
    reference_loss_cards: 0,
    unbacked_new_token_cards: 0,
    unsupported_numeric_change_cards: 0,
    invalid_compact_value_cards: 0,
    ambiguous_route_applied_cards: 0,
    titles_over_80: 0,
    treatment_canonical_delta_f1_vs_fresh_paired_control_at_least: -0.002,
    treatment_resolved_field_regressions: 0,
    treatment_canonical_critical_field_regressions_vs_fresh_paired_control: 0,
    canonical_shape_defect_cards: 0,
    treatment_to_control_total_tokens_p50_at_most: 1.06,
    treatment_to_control_output_tokens_p50_at_most: 1.20,
    treatment_to_control_latency_p50_at_most: 1.15,
    treatment_to_control_latency_p95_at_most: 1.20,
    provider_failures: 0,
    provider_retries: 0
  }
};

const productionBoundary = {
  authorized_by_this_prereg: false,
  reason: "the budgeted 70-treatment/35-control mechanism screen is not an independent fresh150 release gate",
  required_next_if_budgeted_strict_gate_passes: {
    cohort: "new image-backed fresh150 outside the current 255-card development population",
    design: "shared fresh canonical control150 plus frozen 5-8-mechanism treatment150",
    total_provider_calls: 300,
    marginal_compact_v4_calls_when_bundled: 150,
    absolute_treatment_macro_f1_at_least: 0.90,
    critical_factual_error_cards: 0,
    unsupported_factual_addition_cards: 0,
    titles_over_80: 0,
    full_protected_release_gates_required: true
  }
};

const runFingerprint = sha256(JSON.stringify({ frozenContract, stages, gates,
  productionBoundary, confirmatory70, schedule }));
const prereg = {
  schema_version: "model-residual-compact-v4-cloud-prereg-v1",
  date: "2026-08-09",
  authority: "evaluation_only",
  status: "PREREGISTERED_NOT_AUTHORIZED",
  execution_authorized: false,
  provider_calls_made: 0,
  labels_bytes_read_by_preregistration: false,
  run_fingerprint: runFingerprint,
  cheapest_valid_sequence: {
    now: 0,
    next_provider_calls_after_independent_authorization: 105,
    design: "70 treatment plus a fixed contemporaneous control on 35 of those cards",
    production_gate_bundle: 300
  },
  old_control_reuse_decision: {
    decision: "REUSE_FOR_DEVELOPMENT_CONTEXT_ONLY",
    reason: "old A/B and a later compact C are separated by provider time, cache, and deployment state",
    valid_estimands_with_new_c_only: ["compact capture", "within-response resolver utility", "absolute token and latency"],
    invalid_estimands_against_old_a_b: ["causal canonical interference", "causal latency ratio", "strict promotion"]
  },
  frozen_contract: frozenContract,
  stages,
  gates,
  production_boundary: productionBoundary,
  sources: {
    population_105: { path: SOURCE_105, sha256: EXPECTED_HASHES.source_105 },
    development_35: { path: DEVELOPMENT_35, sha256: EXPECTED_HASHES.development_35 },
    v3_prereg: { path: V3_PREREG, sha256: EXPECTED_HASHES.v3_prereg },
    v3_payload: { path: V3_PAYLOAD, sha256: EXPECTED_HASHES.v3_payload },
    v3_checkpoint: { path: V3_CHECKPOINT, sha256: EXPECTED_HASHES.v3_checkpoint }
  },
  power: {
    assumed_win_rate_from_development: "4/35",
    utility_treatment_cards: 70,
    pass_threshold: "at least 6 wins and 0 losses",
    exact_two_sided_sign_p_for_6_wins_0_losses: 0.03125,
    probability_of_at_least_6_wins_at_4_over_35_rate:
      binomialTailProbability(70, 6, DEVELOPMENT_WIN_RATE),
    probability_of_at_least_8_wins_at_4_over_35_rate:
      binomialTailProbability(70, 8, DEVELOPMENT_WIN_RATE),
    minimum_treatment_cards_for_80_percent_power_at_6_wins:
      minimumTrialsForBinomialPower({ threshold: 6, probability: DEVELOPMENT_WIN_RATE, power: 0.8 }),
    minimum_treatment_cards_for_80_percent_power_at_8_wins:
      minimumTrialsForBinomialPower({ threshold: 8, probability: DEVELOPMENT_WIN_RATE, power: 0.8 }),
    minimum_fully_paired_calls_for_8_win_80_percent_power:
      2 * minimumTrialsForBinomialPower({ threshold: 8, probability: DEVELOPMENT_WIN_RATE, power: 0.8 }),
    budget_limit: 105,
    decision_contract: {
      pass: "all utility, field, safety, interference, latency, token, and execution gates pass",
      hold: "fewer than 6 wins or an inconclusive interference margin with no factual loss",
      stop: "any factual/reference/field regression, critical error, retry, request drift, or contract defect"
    }
  },
  confirmatory_70: {
    asset_ids_path: OUT_IDS,
    asset_ids: confirmatory70,
    ordered_asset_ids_sha256: sha256(`${JSON.stringify(confirmatory70, null, 2)}\n`),
    population_after_exclusion: 70,
    overlap_with_v3_development_35: 0,
    schedule
  }
};

mkdirSync(dirname(OUT_IDS), { recursive: true });
writeFileSync(OUT_IDS, `${JSON.stringify(confirmatory70, null, 2)}\n`);
writeFileSync(OUT, `${JSON.stringify(prereg, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  out: OUT,
  ids: OUT_IDS,
  provider_calls_made: 0,
  run_fingerprint: runFingerprint,
  compact_schema_sha256: MODEL_RESIDUAL_COMPACT_V4_SCHEMA_SHA256,
  cheapest_next_calls: 105,
  execution_blocker: "independent_authorization_receipt_not_issued",
  strict_budgeted_calls: 105,
  production_authorized: false
}, null, 2)}\n`);
