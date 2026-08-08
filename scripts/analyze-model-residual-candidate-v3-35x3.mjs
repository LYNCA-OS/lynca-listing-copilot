#!/usr/bin/env node

// Offline-only analyzer for the preregistered residual-v3 35 x 3 screen.
// The file-loading boundary is intentional: sealed labels are not opened until
// the complete 105-row run, its fingerprints, and the three-arm pairing pass.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveModelResidualVisibleEvidenceV3 } from
  "../experiments/accuracy/model-residual-visible-evidence-v3.mjs";
import { captureModelResidualCandidatesV3, splitModelResidualCandidateEnvelopeV3 } from
  "../experiments/accuracy/model-residual-candidate-lane-v3.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import { imageSetFingerprint } from "./run-thin-path-eval.mjs";
import {
  FROZEN_REQUEST_CONTRACTS,
  requestForAsset,
  requestIdentity
} from "../experiments/vercel-capacity-probe/request-contract.mjs";
import { assertThreeArmRequestIsolation } from
  "../experiments/accuracy/model-residual-v3-screen-plan.mjs";

const EXPECTED_CARDS = 35;
const EXPECTED_JOBS = 105;
const ARMS = Object.freeze(["control_a", "control_b", "residual_c"]);
const EPSILON = 1e-12;
const HEX_256 = /^[0-9a-f]{64}$/;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const quantile = (values, q) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? null;
};
const ratio = (numerator, denominator) => Number.isFinite(numerator)
  && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null;
const difference = (left, right) => [...left].filter((value) => !right.has(value));

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

const stableJson = (value) => JSON.stringify(stableValue(value));
const sameValue = (left, right) => stableJson(left) === stableJson(right);

function jsonLines(body, name) {
  return String(body).split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line);
      invariant(row && typeof row === "object" && !Array.isArray(row),
        `${name}_row_not_object:${index + 1}`);
      return [row];
    } catch (error) {
      if (String(error?.message || "").startsWith(`${name}_`)) throw error;
      throw new Error(`${name}_invalid_json:${index + 1}`);
    }
  });
}

function titleTokens(value) {
  return new Set(clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").match(/[a-z0-9]+(?:\/[a-z0-9]+)*/g) || []);
}

function normalizedNumericClaim(value) {
  const text = clean(value).toLowerCase();
  const fraction = text.match(/^(\d{1,6})\/(\d{1,6})$/);
  if (fraction) return `${Number(fraction[1])}/${Number(fraction[2])}`;
  const decimal = text.match(/^\d+(?:\.\d+)?$/);
  if (decimal) return String(Number(text));
  return text;
}

function numericClaims(value) {
  const claims = clean(value).toLowerCase().match(
    /(?<![a-z0-9])(?:\d{1,6}\/\d{1,6}|\d+(?:\.\d+)?|(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+)(?![a-z0-9])/g
  ) || [];
  return new Set(claims.map(normalizedNumericClaim));
}

function flatten(value) {
  return Array.isArray(value) ? value.flatMap(flatten)
    : value && typeof value === "object" ? Object.values(value).flatMap(flatten)
      : [clean(value)];
}

function titleScore(reference, title) {
  const wanted = titleTokens(reference);
  const got = titleTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision
    ? 2 * recall * precision / (recall + precision) : 0 };
}

function binomialCoefficient(n, k) {
  let value = 1;
  for (let index = 1; index <= k; index += 1) value = value * (n - index + 1) / index;
  return value;
}

export function pairedSignTest(wins, losses) {
  invariant(Number.isInteger(wins) && wins >= 0 && Number.isInteger(losses) && losses >= 0,
    "v3_sign_counts_invalid");
  const n = wins + losses;
  if (!n) return 1;
  const tail = Math.min(wins, losses);
  let probability = 0;
  for (let index = 0; index <= tail; index += 1) {
    probability += binomialCoefficient(n, index) * (0.5 ** n);
  }
  return Math.min(1, 2 * probability);
}

function pairedSummary(rows, left, right) {
  const deltas = rows.map((row) => right(row) - left(row));
  const wins = deltas.filter((value) => value > EPSILON).length;
  const losses = deltas.filter((value) => value < -EPSILON).length;
  return {
    n: rows.length,
    left_macro_f1: mean(rows.map(left)),
    right_macro_f1: mean(rows.map(right)),
    delta_macro_f1: mean(deltas),
    wins,
    losses,
    ties: deltas.length - wins - losses,
    two_sided_sign_test_p: pairedSignTest(wins, losses),
    delta_distribution: { p50: quantile(deltas, 0.5), p95: quantile(deltas, 0.95) }
  };
}

function usageValue(row, field) {
  const fallback = field === "total_tokens"
    ? Number(row.result?.usage?.input_tokens) + Number(row.result?.usage?.output_tokens)
    : undefined;
  const value = Number(row.result?.usage?.[field] ?? row.result?.[field] ?? row[field] ?? fallback);
  invariant(Number.isFinite(value) && value > 0,
    `v3_usage_invalid:${field}:${row.job_key}`);
  return value;
}

function latencyValue(row) {
  const value = Number(row.result?.latency_ms ?? row.latency_ms);
  invariant(Number.isFinite(value) && value > 0, `v3_latency_invalid:${row.job_key}`);
  return value;
}

function validatePrereg(prereg) {
  invariant(prereg?.schema_version === "model-residual-candidate-v3-35x3-prereg-v2",
    "v3_analysis_prereg_schema_invalid");
  invariant(prereg?.authority === "evaluation_only"
    && prereg?.design?.unique_cards === EXPECTED_CARDS
    && prereg?.design?.arms_per_card === ARMS.length
    && prereg?.design?.planned_provider_calls === EXPECTED_JOBS,
  "v3_analysis_prereg_design_invalid");
  invariant(prereg?.frozen_contract?.model === "gpt-5.6-luna"
    && prereg?.frozen_contract?.reasoning_effort === "low"
    && prereg?.frozen_contract?.image_detail === "high"
    && prereg?.frozen_contract?.controls_byte_identical === true
    && prereg?.frozen_contract?.treatment_changes_response_schema_only === true,
  "v3_analysis_prereg_contract_invalid");
  invariant(Array.isArray(prereg.cohort) && prereg.cohort.length === EXPECTED_CARDS,
    "v3_analysis_prereg_cohort_invalid");
  invariant(typeof prereg?.analysis_inputs?.dataset_path === "string"
    && HEX_256.test(prereg.analysis_inputs.dataset_sha256)
    && HEX_256.test(prereg.analysis_inputs.selected_label_ref_mapping_sha256)
    && typeof prereg.analysis_inputs.expected_labels_path === "string"
    && HEX_256.test(prereg.analysis_inputs.sealed_labels_sha256)
    && prereg.analysis_inputs.sealed_label_bytes_read_before_predictions_frozen === false,
  "v3_analysis_prereg_analysis_input_invalid");
  const ids = new Set();
  for (const card of prereg.cohort) {
    invariant(typeof card?.asset_id === "string" && !ids.has(card.asset_id),
      "v3_analysis_prereg_asset_invalid");
    invariant(HEX_256.test(card.image_set_sha256), `v3_analysis_prereg_image_hash_invalid:${card.asset_id}`);
    invariant(Array.isArray(card.order) && card.order.length === ARMS.length
      && new Set(card.order).size === ARMS.length
      && ARMS.every((arm) => card.order.includes(arm)),
    `v3_analysis_prereg_arm_order_invalid:${card.asset_id}`);
    ids.add(card.asset_id);
  }
}

function cloudJobs(prereg) {
  return prereg.cohort.flatMap((card) => card.order.map((arm) => ({
    job_key: `${card.asset_id}:${arm}`,
    asset_id: card.asset_id,
    image_set_sha256: card.image_set_sha256,
    arm
  })));
}

function validatePayload(payload, prereg, checkpoint) {
  invariant(payload?.schema_version === "cloud-residual-v3-materialized-payload-v1",
    "v3_analysis_payload_schema_invalid");
  invariant(checkpoint.payload_sha256 === sha256(JSON.stringify(payload)),
    "v3_analysis_payload_fingerprint_mismatch");
  const controlTemplate = payload?.control_a?.request_template;
  invariant(payload?.control_a?.arm_id === "control_a"
    && payload?.control_b?.arm_id === "control_b"
    && payload?.residual_c?.arm_id === "residual_c"
    && sameValue(controlTemplate, payload.control_b.request_template),
  "v3_analysis_payload_arm_contract_invalid");
  const assets = payload.control_a.assets;
  invariant(Array.isArray(assets) && assets.length === EXPECTED_CARDS,
    "v3_analysis_payload_assets_invalid");
  invariant(sameValue(assets, payload.control_b.assets) && sameValue(assets, payload.residual_c.assets),
    "v3_analysis_payload_assets_not_shared");
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  invariant(assetsById.size === EXPECTED_CARDS, "v3_analysis_payload_duplicate_asset");
  for (const card of prereg.cohort) {
    const asset = assetsById.get(card.asset_id);
    invariant(asset?.image_set_sha256 === card.image_set_sha256
      && Array.isArray(asset.image_urls) && asset.image_urls.length >= 1 && asset.image_urls.length <= 2,
    `v3_analysis_payload_asset_mismatch:${card.asset_id}`);
  }
  for (const arm of ARMS) {
    const identity = requestIdentity(requestForAsset(payload[arm].request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"]));
    const frozen = FROZEN_REQUEST_CONTRACTS[arm];
    invariant(frozen && identity.normalized_request_sha256 === frozen.normalized_request_sha256
      && identity.normalized_request_bytes === frozen.normalized_request_bytes
      && identity.wire_sha256 === frozen.contract_wire_sha256
      && identity.wire_bytes === frozen.contract_wire_bytes
      && sameValue(checkpoint.contracts?.[arm], identity),
    `v3_analysis_request_contract_mismatch:${arm}`);
  }
  const semantic = assertThreeArmRequestIsolation({
    controlA: requestForAsset(payload.control_a.request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"]),
    controlB: requestForAsset(payload.control_b.request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"]),
    residualC: requestForAsset(payload.residual_c.request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"])
  });
  for (const field of ["control_request_sha256", "residual_request_sha256",
    "control_schema_sha256", "residual_schema_sha256"]) {
    invariant(semantic[field] === prereg.frozen_contract[field],
      `v3_analysis_preregistered_request_contract_mismatch:${field}`);
  }
  return assetsById;
}

function validateCloudCheckpoint(checkpoint, prereg, payload, preregBody) {
  invariant(checkpoint?.schema_version === "cloud-residual-v3-run-contract-v1",
    "v3_analysis_checkpoint_schema_invalid");
  invariant(checkpoint.state === "COMPLETE", "v3_analysis_checkpoint_not_complete");
  invariant(HEX_256.test(checkpoint.run_fingerprint),
    "v3_analysis_run_fingerprint_invalid");
  invariant(checkpoint.prereg_sha256 === sha256(JSON.stringify(JSON.parse(String(preregBody)))),
    "v3_analysis_prereg_fingerprint_mismatch");
  invariant(checkpoint.jobs_sha256 === sha256(JSON.stringify(cloudJobs(prereg))),
    "v3_analysis_job_schedule_fingerprint_mismatch");
  invariant(checkpoint.concurrency === 1 && checkpoint.max_provider_attempts === EXPECTED_JOBS
    && checkpoint.retries === 0 && checkpoint.provider_attempts === EXPECTED_JOBS
    && checkpoint.provider_calls === EXPECTED_JOBS && checkpoint.provider_retries === 0
    && checkpoint.single_job_minimum_ttl_ms === 180_000,
  "v3_analysis_execution_contract_invalid");
  invariant(checkpoint.sealed_labels_accessed_during_execution === false,
    "v3_analysis_label_blindness_not_attested");
  invariant(HEX_256.test(checkpoint.authorization_receipt_sha256),
    "v3_analysis_authorization_receipt_missing");
  invariant(typeof checkpoint.origin === "string" && /^https:\/\//.test(checkpoint.origin)
    && typeof checkpoint.runId === "string" && checkpoint.runId.length >= 8,
  "v3_analysis_cloud_identity_invalid");
  const fingerprintValue = {
    schema_version: checkpoint.schema_version,
    origin: checkpoint.origin,
    runId: checkpoint.runId,
    prereg_sha256: checkpoint.prereg_sha256,
    payload_sha256: checkpoint.payload_sha256,
    jobs_sha256: checkpoint.jobs_sha256,
    contracts: checkpoint.contracts,
    concurrency: checkpoint.concurrency,
    max_provider_attempts: checkpoint.max_provider_attempts,
    retries: checkpoint.retries,
    earliest_signed_url_expiry_ms: checkpoint.earliest_signed_url_expiry_ms,
    minimum_remaining_ttl_ms: checkpoint.minimum_remaining_ttl_ms,
    ordered_signed_urls_sha256: checkpoint.ordered_signed_urls_sha256
  };
  invariant(checkpoint.run_fingerprint === sha256(JSON.stringify(fingerprintValue)),
    "v3_analysis_run_fingerprint_mismatch");
  invariant(checkpoint.ordered_signed_urls_sha256 === payload.ordered_signed_urls_sha256,
    "v3_analysis_signed_url_order_mismatch");
}

function validateResult(row) {
  const result = row.result;
  invariant(result && typeof result === "object" && !Array.isArray(result),
    `v3_result_missing:${row.job_key}`);
  invariant(result.request_attempt_count === 1, `v3_attempt_count_invalid:${row.job_key}`);
  invariant(result.served_model === "gpt-5.6-luna" && clean(result.response_id),
    `v3_served_model_or_response_invalid:${row.job_key}`);
  invariant(result.requested_effort === "low", `v3_requested_effort_invalid:${row.job_key}`);
  invariant(result.served_effort === "low", `v3_served_effort_invalid:${row.job_key}`);
  invariant(HEX_256.test(result.provider_response_sha256)
    && HEX_256.test(result.structured_output_raw_sha256)
    && HEX_256.test(result.structured_output_envelope_sha256)
    && result.structured_output_envelope && typeof result.structured_output_envelope === "object"
    && result.structured_output_envelope_sha256
      === sha256(JSON.stringify(result.structured_output_envelope)),
  `v3_provider_evidence_invalid:${row.job_key}`);
  const rawEnvelope = result.structured_output_envelope;
  const replayEnvelope = row.arm === "residual_c"
    ? splitModelResidualCandidateEnvelopeV3(rawEnvelope)
    : { canonical_payload: structuredClone(rawEnvelope), defect: null };
  invariant(!replayEnvelope.defect && replayEnvelope.canonical_payload,
    `v3_provider_envelope_invalid:${row.job_key}`);
  const replayCanonical = finishCanonicalTitle(JSON.stringify(replayEnvelope.canonical_payload));
  const replayCapture = row.arm === "residual_c"
    ? captureModelResidualCandidatesV3(rawEnvelope, { canonicalFields: replayCanonical.fields }) : null;
  const replayResolved = row.arm === "residual_c"
    ? resolveModelResidualVisibleEvidenceV3(replayCanonical.fields, replayCapture.candidates) : null;
  for (const [field, actual, expected] of [
    ["canonical_payload", result.canonical_payload, replayEnvelope.canonical_payload],
    ["canonical_fields", result.canonical_fields, replayCanonical.fields],
    ["canonical_title", result.canonical_title, replayCanonical.title],
    ["canonical_field_defects", result.canonical_field_defects, replayCanonical.field_defects],
    ["candidate_capture", result.candidate_capture, replayCapture],
    ["resolved", result.resolved, replayResolved]
  ]) {
    invariant(sameValue(actual, expected), `v3_provider_envelope_replay_mismatch:${field}:${row.job_key}`);
  }
  invariant(typeof result.canonical_title === "string" && clean(result.canonical_title),
    `v3_canonical_title_invalid:${row.job_key}`);
  invariant(result.canonical_fields && typeof result.canonical_fields === "object"
    && !Array.isArray(result.canonical_fields), `v3_canonical_fields_invalid:${row.job_key}`);
  invariant(result.canonical_title === composeFromCanonicalFields(result.canonical_fields).title,
    `v3_canonical_title_fields_mismatch:${row.job_key}`);
  invariant(Array.isArray(result.canonical_field_defects),
    `v3_canonical_defects_invalid:${row.job_key}`);
  usageValue(row, "input_tokens");
  usageValue(row, "output_tokens");
  usageValue(row, "total_tokens");
  const cached = Number(result.usage?.cached_input_tokens ?? 0);
  invariant(Number.isFinite(cached) && cached >= 0,
    `v3_cached_input_tokens_invalid:${row.job_key}`);
  latencyValue(row);
  if (row.arm !== "residual_c") {
    invariant(result.candidate_capture === null && result.resolved === null,
      `v3_control_candidate_leak:${row.job_key}`);
    return;
  }
  invariant(result.candidate_capture && Array.isArray(result.candidate_capture.candidates)
    && Array.isArray(result.candidate_capture.defects),
  `v3_candidate_capture_invalid:${row.job_key}`);
  invariant(result.resolved && typeof result.resolved === "object",
    `v3_resolved_result_invalid:${row.job_key}`);
  const replay = resolveModelResidualVisibleEvidenceV3(
    result.canonical_fields, result.candidate_capture.candidates
  );
  for (const field of ["accepted", "applied", "fields", "title", "defects", "guards", "safety"]) {
    invariant(sameValue(result.resolved[field], replay[field]),
      `v3_frozen_resolver_mismatch:${field}:${row.job_key}`);
  }
}

export function validateModelResidualV3FrozenRun({ preregBody, payloadBody, checkpointBody }) {
  const prereg = JSON.parse(String(preregBody));
  const payload = JSON.parse(String(payloadBody));
  const checkpoint = JSON.parse(String(checkpointBody));
  validatePrereg(prereg);
  validateCloudCheckpoint(checkpoint, prereg, payload, preregBody);
  const assetsById = validatePayload(payload, prereg, checkpoint);
  invariant(checkpoint.jobs && typeof checkpoint.jobs === "object"
    && !Array.isArray(checkpoint.jobs), "v3_checkpoint_jobs_invalid");
  const jobEntries = Object.entries(checkpoint.jobs);
  for (const [key, row] of jobEntries) {
    invariant(row?.job_key === key, `v3_checkpoint_job_map_key_mismatch:${key}`);
  }
  const rows = jobEntries.map(([, row]) => row);
  invariant(rows.length === EXPECTED_JOBS, `v3_checkpoint_not_complete:${rows.length}/${EXPECTED_JOBS}`);
  const expected = new Map(prereg.cohort.flatMap((card) => card.order.map((arm) => [
    `${card.asset_id}:${arm}`, { ...card, arm }
  ])));
  const byAsset = new Map(prereg.cohort.map(({ asset_id }) => [asset_id, new Map()]));
  const seen = new Set();
  for (const row of rows) {
    invariant(typeof row.job_key === "string" && !seen.has(row.job_key),
      `v3_checkpoint_duplicate_or_missing_key:${row.job_key || "missing"}`);
    const spec = expected.get(row.job_key);
    invariant(spec, `v3_checkpoint_unregistered_job:${row.job_key}`);
    invariant(row.asset_id === spec.asset_id && row.arm === spec.arm
      && row.image_set_sha256 === spec.image_set_sha256,
    `v3_checkpoint_pair_binding_mismatch:${row.job_key}`);
    invariant(row.state === "COMPLETE" && row.attempt_count === 1,
      `v3_checkpoint_job_not_complete:${row.job_key}`);
    invariant(row.result?.run_fingerprint === checkpoint.run_fingerprint,
      `v3_checkpoint_fingerprint_mismatch:${row.job_key}`);
    const asset = assetsById.get(row.asset_id);
    const expectedRequest = requestIdentity(requestForAsset(
      payload[row.arm].request_template, asset.image_urls
    ));
    invariant(row.result?.request_sha256 === expectedRequest.wire_sha256,
      `v3_checkpoint_request_fingerprint_mismatch:${row.job_key}`);
    validateResult(row);
    seen.add(row.job_key);
    byAsset.get(row.asset_id).set(row.arm, row);
  }
  invariant(seen.size === expected.size && [...expected.keys()].every((key) => seen.has(key)),
    "v3_checkpoint_job_set_incomplete");
  for (const [assetId, armRows] of byAsset) {
    invariant(armRows.size === ARMS.length && ARMS.every((arm) => armRows.has(arm)),
      `v3_checkpoint_three_arms_incomplete:${assetId}`);
  }
  return { prereg, payload, checkpoint, rows, byAsset,
    completion: { status: "COMPLETE", completed_jobs: EXPECTED_JOBS, expected_jobs: EXPECTED_JOBS,
      complete_cards: EXPECTED_CARDS, arms_per_card: ARMS.length } };
}

function validateDataset(datasetBody, frozen) {
  invariant(sha256(datasetBody) === frozen.prereg.analysis_inputs.dataset_sha256,
    "v3_analysis_dataset_fingerprint_mismatch");
  const dataset = JSON.parse(String(datasetBody));
  const items = Array.isArray(dataset?.items) ? dataset.items : [];
  const byId = new Map(items.map((item) => [item.asset_id, item]));
  invariant(byId.size === items.length, "v3_analysis_dataset_duplicate_asset");
  const labelKeys = new Map();
  let sealedPath = null;
  for (const card of frozen.prereg.cohort) {
    const item = byId.get(card.asset_id);
    const ref = item?.sealed_eval_label_ref;
    invariant(item && typeof ref?.key === "string" && typeof ref?.path === "string",
      `v3_analysis_label_ref_missing:${card.asset_id}`);
    sealedPath ||= ref.path;
    invariant(ref.path === sealedPath, `v3_analysis_label_path_mismatch:${card.asset_id}`);
    invariant(!labelKeys.has(ref.key), `v3_analysis_duplicate_label_key:${ref.key}`);
    invariant((item.image_set_sha256 || imageSetFingerprint(item)) === card.image_set_sha256,
      `v3_analysis_dataset_image_set_mismatch:${card.asset_id}`);
    labelKeys.set(ref.key, card.asset_id);
  }
  const mapping = frozen.prereg.cohort.map(({ asset_id }) => ({ asset_id,
    sealed_eval_label_ref: structuredClone(byId.get(asset_id).sealed_eval_label_ref) }));
  invariant(sha256(JSON.stringify(mapping))
    === frozen.prereg.analysis_inputs.selected_label_ref_mapping_sha256,
  "v3_analysis_label_ref_mapping_mismatch");
  invariant(sealedPath === frozen.prereg.analysis_inputs.expected_labels_path,
    "v3_analysis_labels_path_identity_mismatch");
  return { labelKeys, sealedPath };
}

function validateAnalysisPaths(frozen, datasetPath, labelsPath) {
  const datasetRelative = frozen.prereg.analysis_inputs.dataset_path;
  const labelsRelative = frozen.prereg.analysis_inputs.expected_labels_path;
  const datasetAbsolute = resolve(datasetPath);
  const suffix = `/${datasetRelative}`;
  invariant(datasetAbsolute.endsWith(suffix), "v3_analysis_dataset_path_identity_mismatch");
  const evalRoot = datasetAbsolute.slice(0, -suffix.length);
  invariant(resolve(labelsPath) === resolve(evalRoot, labelsRelative),
    "v3_analysis_labels_path_identity_mismatch");
}

function validateLabels(labelsBody, labelRefs, expectedSha256) {
  invariant(sha256(labelsBody) === expectedSha256,
    "v3_sealed_labels_fingerprint_mismatch");
  const all = jsonLines(labelsBody, "v3_sealed_labels");
  const selected = new Map();
  for (const row of all) {
    if (!labelRefs.labelKeys.has(row.key)) continue;
    invariant(!selected.has(row.key), `v3_sealed_labels_duplicate:${row.key}`);
    invariant(row.label_type === "REVIEWED_INTERNAL_TITLE"
      && typeof row.reviewed_title === "string" && clean(row.reviewed_title)
      && row.policy?.reviewed_title_is_ground_truth === true
      && row.policy?.model_prompt_visible === false
      && row.policy?.load_after_predictions_frozen === true
      && row.policy?.self_retrieval_exclusion_required === true,
    `v3_sealed_label_contract_invalid:${row.key}`);
    selected.set(row.key, row);
  }
  invariant(selected.size === EXPECTED_CARDS,
    `v3_sealed_labels_incomplete:${selected.size}/${EXPECTED_CARDS}`);
  return new Map([...labelRefs.labelKeys].map(([key, assetId]) => [assetId, selected.get(key).reviewed_title]));
}

function fieldDisagreement(left, right) {
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changed = fields.filter((field) => !sameValue(left[field] ?? null, right[field] ?? null));
  return { fields, changed };
}

function metricDistribution(rows, valueFor) {
  const values = rows.map(valueFor);
  return { p50: quantile(values, 0.5), p95: quantile(values, 0.95) };
}

function compareDistributions(controlRows, treatmentRows, valueFor) {
  const pooled = metricDistribution(controlRows, valueFor);
  const treatment = metricDistribution(treatmentRows, valueFor);
  return {
    pooled_control: pooled,
    treatment,
    treatment_to_pooled_control: {
      p50: ratio(treatment.p50, pooled.p50),
      p95: ratio(treatment.p95, pooled.p95)
    }
  };
}

export function analyzeValidatedModelResidualV3({ frozen, datasetBody, labelsBody }) {
  const labelRefs = validateDataset(datasetBody, frozen);
  // This is the first operation in this module that interprets sealed bytes.
  const references = validateLabels(labelsBody, labelRefs,
    frozen.prereg.analysis_inputs.sealed_labels_sha256);
  const cards = frozen.prereg.cohort.map(({ asset_id }) => {
    const arms = frozen.byAsset.get(asset_id);
    const a = arms.get("control_a");
    const b = arms.get("control_b");
    const c = arms.get("residual_c");
    const reference = references.get(asset_id);
    const replay = resolveModelResidualVisibleEvidenceV3(
      c.result.canonical_fields, c.result.candidate_capture.candidates
    );
    const titles = { control_a: a.result.canonical_title, control_b: b.result.canonical_title,
      residual_c_canonical: c.result.canonical_title, residual_c_resolved: replay.title };
    const scores = Object.fromEntries(Object.entries(titles)
      .map(([key, title]) => [key, titleScore(reference, title)]));
    const baselineTokens = titleTokens(titles.residual_c_canonical);
    const resolvedTokens = titleTokens(titles.residual_c_resolved);
    const referenceTokens = titleTokens(reference);
    const sourceText = [
      ...flatten(c.result.canonical_fields),
      ...c.result.candidate_capture.candidates.map(({ text }) => text)
    ].join(" ");
    const sourceTokens = titleTokens(sourceText);
    const lostBaseline = difference(baselineTokens, resolvedTokens);
    const referenceLosses = lostBaseline.filter((token) => referenceTokens.has(token));
    const unbackedNew = difference(resolvedTokens, baselineTokens)
      .filter((token) => !sourceTokens.has(token));
    const baselineNumbers = numericClaims(titles.residual_c_canonical);
    const resolvedNumbers = numericClaims(titles.residual_c_resolved);
    const sourceNumbers = numericClaims(sourceText);
    const removedNumbers = difference(baselineNumbers, resolvedNumbers);
    const unbackedAddedNumbers = difference(resolvedNumbers, baselineNumbers)
      .filter((claim) => !sourceNumbers.has(claim));
    const unsupportedNumeric = [...removedNumbers, ...unbackedAddedNumbers];
    const disagreement = fieldDisagreement(a.result.canonical_fields, b.result.canonical_fields);
    const captureDefects = c.result.candidate_capture.defects;
    const resolverDefects = replay.defects || [];
    const critical = referenceLosses.length > 0 || unbackedNew.length > 0
      || unsupportedNumeric.length > 0 || captureDefects.length > 0 || resolverDefects.length > 0;
    return {
      asset_id,
      reference,
      titles,
      scores,
      control_field_disagreement: disagreement.changed,
      candidates: c.result.candidate_capture.candidates,
      candidate_capture_defects: captureDefects,
      resolver_defects: resolverDefects,
      resolver_accepted: replay.accepted,
      resolver_applied: replay.applied === true,
      safety: {
        critical,
        reference_losses: referenceLosses,
        unbacked_new_tokens: unbackedNew,
        unsupported_numeric_changes: unsupportedNumeric,
        over_80: titles.residual_c_resolved.length > 80
      },
      rows: { control_a: a, control_b: b, residual_c: c }
    };
  });

  const selfJitter = pairedSummary(cards,
    (card) => card.scores.control_a.f1, (card) => card.scores.control_b.f1);
  const canonicalInterference = pairedSummary(cards,
    (card) => (card.scores.control_a.f1 + card.scores.control_b.f1) / 2,
    (card) => card.scores.residual_c_canonical.f1);
  const resolverUtility = pairedSummary(cards,
    (card) => card.scores.residual_c_canonical.f1,
    (card) => card.scores.residual_c_resolved.f1);
  const allControlFields = cards.flatMap((card) => fieldDisagreement(
    card.rows.control_a.result.canonical_fields, card.rows.control_b.result.canonical_fields
  ).fields);
  const differingFieldCells = cards.reduce((sum, card) =>
    sum + card.control_field_disagreement.length, 0);
  const candidateRows = cards.flatMap((card) => card.candidates);
  const counts = (field) => Object.fromEntries([...new Set(candidateRows.map((row) => row[field]))]
    .sort().map((value) => [value, candidateRows.filter((row) => row[field] === value).length]));
  const controlRows = cards.flatMap((card) => [card.rows.control_a, card.rows.control_b]);
  const treatmentRows = cards.map((card) => card.rows.residual_c);
  const costLatency = {
    input_tokens: compareDistributions(controlRows, treatmentRows,
      (row) => usageValue(row, "input_tokens")),
    output_tokens: compareDistributions(controlRows, treatmentRows,
      (row) => usageValue(row, "output_tokens")),
    total_tokens: compareDistributions(controlRows, treatmentRows,
      (row) => usageValue(row, "total_tokens")),
    latency_ms: compareDistributions(controlRows, treatmentRows, latencyValue)
  };
  const safety = {
    critical_cards: cards.filter((card) => card.safety.critical).length,
    reference_loss_cards: cards.filter((card) => card.safety.reference_losses.length).length,
    unbacked_new_token_cards: cards.filter((card) => card.safety.unbacked_new_tokens.length).length,
    unsupported_numeric_change_cards: cards.filter(
      (card) => card.safety.unsupported_numeric_changes.length
    ).length,
    titles_over_80: cards.filter((card) => card.safety.over_80).length,
    canonical_field_shape_defect_cards: cards.filter(
      (card) => card.rows.residual_c.result.canonical_field_defects.length
    ).length,
    candidate_contract_defect_cards: cards.filter(
      (card) => card.candidate_capture_defects.length || card.resolver_defects.length
    ).length
  };
  const primaryChecks = {
    resolver_delta_macro_f1_at_least_0003: resolverUtility.delta_macro_f1 >= 0.003,
    resolver_wins_at_least_8: resolverUtility.wins >= 8,
    resolver_losses_zero: resolverUtility.losses === 0,
    critical_cards_zero: safety.critical_cards === 0,
    reference_loss_cards_zero: safety.reference_loss_cards === 0,
    unbacked_new_token_cards_zero: safety.unbacked_new_token_cards === 0,
    unsupported_numeric_change_cards_zero: safety.unsupported_numeric_change_cards === 0,
    titles_over_80_zero: safety.titles_over_80 === 0
  };
  const canonicalChecks = {
    mean_delta_f1_at_least_negative_0002: canonicalInterference.delta_macro_f1 >= -0.002,
    canonical_field_shape_defects_zero: safety.canonical_field_shape_defect_cards === 0
  };
  const costChecks = {
    treatment_to_control_input_tokens_p50_at_most_106:
      costLatency.input_tokens.treatment_to_pooled_control.p50 <= 1.06,
    treatment_to_control_latency_p50_at_most_115:
      costLatency.latency_ms.treatment_to_pooled_control.p50 <= 1.15,
    treatment_to_control_latency_p95_at_most_120:
      costLatency.latency_ms.treatment_to_pooled_control.p95 <= 1.20
  };
  const group = (checks) => ({ checks, pass: Object.values(checks).every(Boolean) });
  const gates = {
    primary_screen: group(primaryChecks),
    canonical_interference: group(canonicalChecks),
    cost_latency: group(costChecks)
  };
  const pass = Object.values(gates).every((gate) => gate.pass);
  return {
    schema_version: "model-residual-candidate-v3-35x3-analysis-v1",
    authority: "evaluation_only",
    claim_boundary: frozen.prereg.design.claim_boundary,
    production_promotion_allowed: false,
    provider_calls_by_analysis: 0,
    validated_run: {
      ...frozen.completion,
      run_fingerprint: frozen.checkpoint.run_fingerprint,
      prereg_sha256: frozen.checkpoint.prereg_sha256,
      payload_sha256: frozen.checkpoint.payload_sha256,
      dataset_sha256: sha256(datasetBody),
      sealed_labels_sha256: sha256(labelsBody),
      sealed_labels_opened_after_complete_run_validation: true
    },
    self_jitter: {
      exact_canonical_title_equal_cards: cards.filter(
        (card) => card.titles.control_a === card.titles.control_b
      ).length,
      exact_canonical_title_equality_rate: cards.filter(
        (card) => card.titles.control_a === card.titles.control_b
      ).length / cards.length,
      exact_canonical_field_equal_cards: cards.filter(
        (card) => card.control_field_disagreement.length === 0
      ).length,
      cards_with_field_disagreement: cards.filter(
        (card) => card.control_field_disagreement.length > 0
      ).length,
      differing_field_cells: differingFieldCells,
      field_disagreement_rate: ratio(differingFieldCells, allControlFields.length),
      paired_f1: selfJitter
    },
    canonical_interference: canonicalInterference,
    resolver_utility: resolverUtility,
    candidate_capture: {
      cards_with_rows: cards.filter((card) => card.candidates.length).length,
      rows: candidateRows.length,
      by_role: counts("role"),
      by_region: counts("region")
    },
    safety,
    cost_latency: costLatency,
    gates,
    decision: pass ? "PASS" : "FAIL",
    cards: cards.map(({ rows, ...card }) => card)
  };
}

export async function analyzeModelResidualV3Files({
  preregPath,
  payloadPath,
  checkpointPath,
  datasetPath,
  labelsPath,
  readFileImpl = readFile
}) {
  const [preregBody, payloadBody, checkpointBody] = await Promise.all([
    readFileImpl(preregPath), readFileImpl(payloadPath), readFileImpl(checkpointPath)
  ]);
  const frozen = validateModelResidualV3FrozenRun({ preregBody, payloadBody, checkpointBody });
  validateAnalysisPaths(frozen, datasetPath, labelsPath);
  const datasetBody = await readFileImpl(datasetPath);
  validateDataset(datasetBody, frozen);
  const labelsBody = await readFileImpl(labelsPath);
  return analyzeValidatedModelResidualV3({ frozen, datasetBody, labelsBody });
}

const valueFor = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || fallback);
};

export async function main(argv = process.argv.slice(2)) {
  const evalRoot = resolve(valueFor(argv, "--eval-root", "/Users/paidaxin/lynca-eval-root"));
  const outPath = resolve(valueFor(argv, "--out-json",
    "artifacts/model-residual-v3-paid105/analysis.json"));
  const result = await analyzeModelResidualV3Files({
    preregPath: resolve(valueFor(argv, "--prereg",
      "experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json")),
    payloadPath: resolve(valueFor(argv, "--payload",
      "artifacts/model-residual-v3-cloud/materialized-payload.json")),
    checkpointPath: resolve(valueFor(argv, "--checkpoint",
      "artifacts/model-residual-v3-cloud/checkpoint.json")),
    datasetPath: resolve(evalRoot, valueFor(argv, "--dataset",
      "data/eval/reviewed-title-blind/reviewed-title-image-only.json")),
    labelsPath: resolve(evalRoot, valueFor(argv, "--labels",
      "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl"))
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ decision: result.decision,
    resolver_utility: result.resolver_utility,
    canonical_interference: result.canonical_interference,
    safety: result.safety,
    cost_latency: result.cost_latency,
    output_path: outPath }, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
