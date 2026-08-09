#!/usr/bin/env node

// Offline-only analyzer. It completes checkpoint/raw-response replay and all
// non-label receipt validation before the sealed reviewed-title bytes are read.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { inflateModelResidualSinglePrintedPhraseV4,
  inferModelResidualSinglePrintedPhraseRouteV4 } from
  "../experiments/accuracy/model-residual-compact-v4.mjs";
import { assertCompactV4RequestIsolation, semanticCompactV4RequestSha256 } from
  "../experiments/accuracy/model-residual-compact-v4-cloud-plan.mjs";
import { evaluateModelResidualCompactV4PreviewGate } from
  "../experiments/accuracy/model-residual-compact-v4-preview-gate.mjs";
import { resolveModelResidualVisibleEvidenceV3 } from
  "../experiments/accuracy/model-residual-visible-evidence-v3.mjs";
import { writeJsonAtomic } from "../experiments/vercel-capacity-probe/cloud-io.mjs";
import { assertSignedUrlMatchesImage, validateAssetsOnlyManifest } from
  "../experiments/vercel-capacity-probe/materialize-residual-v3-payload.mjs";
import { assertCompactV4PreflightReceipt, compactV4JobsFrom,
  parseCompactV4ProviderRaw } from
  "../experiments/vercel-capacity-probe/run-cloud-residual-compact-v4.mjs";
import { FROZEN_REQUEST_CONTRACTS, requestForAsset, requestIdentity, sha256 } from
  "../experiments/vercel-capacity-probe/request-contract.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const HEX = /^[0-9a-f]{64}$/;
const SOURCE_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const EPSILON = 1e-12;
const EMPTY_SHA256 = sha256("");
const FROZEN_COMPOSER_FEATURES = Object.freeze({ exact_parallel_color_compaction: false });
const FORBIDDEN_KEYS = new Set(["reviewed_title", "reference_title", "ground_truth",
  "sealed_labels", "labels", "expected_title", "scorer_reference"]);
const AUTHORIZATION_KEYS = ["schema_version", "execution_surface", "authorized",
  "approval_ref", "prereg_sha256", "payload_sha256", "physical_manifest_sha256",
  "label_ref_receipt_sha256", "sealed_labels_sha256", "deployment_receipt_sha256",
  "materialization_byte_receipts_sha256", "preflight_receipt_sha256", "run_id",
  "run_fingerprint", "max_provider_attempts", "zero_call_title_fidelity",
  "zero_call_field_fidelity"];

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const exactKeys = (value, expected) => value && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function assertNoLabels(value, path = "checkpoint") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    invariant(!FORBIDDEN_KEYS.has(key.toLowerCase()),
      `compact_v4_analysis_forbidden_checkpoint_key:${path}.${key}`);
    assertNoLabels(nested, `${path}.${key}`);
  }
}

function tokens(value) {
  return new Set(clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").match(/[a-z0-9]+(?:\/[a-z0-9]+)*/g) || []);
}

function score(reference, title) {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
}

function numericClaims(value) {
  return new Set((clean(value).toLowerCase().match(
    /(?<![a-z0-9])(?:\d{1,6}\/\d{1,6}|\d+(?:\.\d+)?|(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+)(?![a-z0-9])/g
  ) || []).map((text) => {
    const fraction = text.match(/^(\d{1,6})\/(\d{1,6})$/);
    if (fraction) return `${Number(fraction[1])}/${Number(fraction[2])}`;
    return /^\d+(?:\.\d+)?$/.test(text) ? String(Number(text)) : text;
  }));
}

function flatten(value) {
  return Array.isArray(value) ? value.flatMap(flatten)
    : value && typeof value === "object" ? Object.values(value).flatMap(flatten)
      : [clean(value)];
}

function parseJsonLines(body) {
  return String(body).split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch { throw new Error(`compact_v4_labels_invalid_json:${index + 1}`); }
  });
}

function fingerprintValue(checkpoint) {
  return {
    schema_version: checkpoint.schema_version,
    origin: checkpoint.origin,
    run_id: checkpoint.run_id,
    prereg_sha256: checkpoint.prereg_sha256,
    payload_sha256: checkpoint.payload_sha256,
    physical_manifest_sha256: checkpoint.physical_manifest_sha256,
    label_ref_receipt_sha256: checkpoint.label_ref_receipt_sha256,
    deployment_receipt_sha256: checkpoint.deployment_receipt_sha256,
    jobs_sha256: checkpoint.jobs_sha256,
    contracts: checkpoint.contracts,
    concurrency: checkpoint.concurrency,
    max_provider_attempts: checkpoint.max_provider_attempts,
    retries: checkpoint.retries,
    earliest_signed_url_expiry_ms: checkpoint.earliest_signed_url_expiry_ms,
    minimum_remaining_ttl_ms: checkpoint.minimum_remaining_ttl_ms,
    ordered_signed_urls_sha256: checkpoint.ordered_signed_urls_sha256,
    materialization_byte_receipts_sha256:
      checkpoint.materialization_byte_receipts_sha256
  };
}

function validateLabelRefReceipt(prereg, labelRefReceipt) {
  invariant(exactKeys(labelRefReceipt, ["schema_version", "dataset_sha256",
    "mapping_sha256", "expected_labels_path", "sealed_labels_sha256",
    "sealed_label_bytes_read", "selected"])
    && labelRefReceipt.schema_version === "residual-compact-v4-label-ref-receipt-v1"
    && HEX.test(String(labelRefReceipt.dataset_sha256 || ""))
    && HEX.test(String(labelRefReceipt.mapping_sha256 || ""))
    && HEX.test(String(labelRefReceipt.sealed_labels_sha256 || ""))
    && labelRefReceipt.sealed_label_bytes_read === false
    && clean(labelRefReceipt.expected_labels_path)
    && Array.isArray(labelRefReceipt.selected)
    && labelRefReceipt.selected.length === 70,
  "compact_v4_analysis_label_ref_receipt_invalid");
  const assetIds = new Set(); const labelKeys = new Set();
  for (const [index, selected] of labelRefReceipt.selected.entries()) {
    const ref = selected?.sealed_eval_label_ref;
    invariant(exactKeys(selected, ["asset_id", "sealed_eval_label_ref"])
      && exactKeys(ref, ["path", "key"])
      && selected.asset_id === prereg.confirmatory_70.asset_ids[index]
      && ref.path === labelRefReceipt.expected_labels_path && clean(ref.key)
      && !assetIds.has(selected.asset_id) && !labelKeys.has(ref.key),
    `compact_v4_analysis_label_ref_selected_invalid:${index + 1}`);
    assetIds.add(selected.asset_id); labelKeys.add(ref.key);
  }
}

function validateDeploymentReceipt(deploymentReceipt, checkpoint) {
  invariant(exactKeys(deploymentReceipt, ["schema_version", "project_name", "project_id",
    "org_id", "environment", "region", "deployment_id", "deployment_hostname",
    "source_git_sha", "source_tree_clean", "source_status_sha256"])
    && deploymentReceipt.schema_version
      === "residual-compact-v4-preview-deployment-receipt-v1"
    && deploymentReceipt.project_name === "lynca-capacity-lab"
    && deploymentReceipt.project_id === "prj_OnBhU4kHtWuOBCs3iGoYZsYfaWbg"
    && deploymentReceipt.org_id === "team_il17GLcdGsr5fows3jsKwMoA"
    && deploymentReceipt.environment === "preview" && deploymentReceipt.region === "sin1"
    && clean(deploymentReceipt.deployment_id) && clean(deploymentReceipt.deployment_hostname)
    && SOURCE_SHA.test(String(deploymentReceipt.source_git_sha || ""))
    && deploymentReceipt.source_tree_clean === true
    && deploymentReceipt.source_status_sha256 === EMPTY_SHA256
    && checkpoint.origin === `https://${deploymentReceipt.deployment_hostname}`,
  "compact_v4_analysis_deployment_receipt_invalid");
}

function validatePayloadBindings({ prereg, payload, manifest, labelRefReceipt }) {
  validateAssetsOnlyManifest(manifest, { expectedCards: 70, minimumImages: 1,
    maximumImages: 2, schemaVersion: "residual-compact-v4-assets-only-manifest-v1" });
  invariant(exactKeys(payload, ["schema_version", "materialized_at",
    "minimum_remaining_ttl_ms", "prereg_sha256", "physical_manifest_sha256",
    "label_ref_receipt_sha256", "ordered_signed_urls_sha256",
    "materialization_byte_receipts_sha256", "control", "treatment"])
    && payload.schema_version === "cloud-residual-compact-v4-materialized-payload-v1"
    && payload.prereg_sha256 === sha256(JSON.stringify(prereg))
    && payload.physical_manifest_sha256 === sha256(JSON.stringify(manifest))
    && payload.label_ref_receipt_sha256 === sha256(JSON.stringify(labelRefReceipt))
    && JSON.stringify(payload.control?.assets) === JSON.stringify(payload.treatment?.assets),
  "compact_v4_analysis_payload_receipt_invalid");
  for (const [arm, armId] of [["control", "compact_v4_control"],
    ["treatment", "compact_v4_treatment"]]) {
    invariant(exactKeys(payload[arm], ["arm_id", "request_template", "assets"])
      && payload[arm].arm_id === armId && Array.isArray(payload[arm].assets),
    `compact_v4_analysis_payload_arm_invalid:${arm}`);
    const identity = requestIdentity(requestForAsset(payload[arm].request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"]));
    const frozen = FROZEN_REQUEST_CONTRACTS[armId];
    invariant(identity.normalized_request_sha256 === frozen.normalized_request_sha256
      && identity.normalized_request_bytes === frozen.normalized_request_bytes
      && identity.wire_sha256 === frozen.contract_wire_sha256
      && identity.wire_bytes === frozen.contract_wire_bytes,
    `compact_v4_analysis_template_not_frozen:${arm}`);
  }
  const assets = payload.control.assets;
  const physicalById = new Map(manifest.assets.map((asset) => [asset.asset_id, asset]));
  invariant(assets.length === 70
    && new Set(assets.map((asset) => asset.asset_id)).size === 70,
  "compact_v4_analysis_payload_asset_duplicate");
  for (const [assetIndex, assetId] of prereg.confirmatory_70.asset_ids.entries()) {
    const asset = assets[assetIndex]; const physical = physicalById.get(assetId);
    invariant(exactKeys(asset, ["asset_id", "image_set_sha256", "image_urls",
      "image_receipts"])
      && asset.asset_id === assetId && physical
      && asset.image_set_sha256 === physical.image_set_sha256
      && Array.isArray(asset.image_urls) && Array.isArray(asset.image_receipts)
      && asset.image_urls.length === physical.images.length
      && asset.image_receipts.length === physical.images.length,
    `compact_v4_analysis_physical_pairing_invalid:${assetId}`);
    for (const [index, image] of physical.images.entries()) {
      const receipt = asset.image_receipts[index];
      invariant(exactKeys(receipt, ["role", "bucket", "object_path", "content_sha256",
        "byte_length"])
        && receipt.role === image.role && receipt.bucket === image.bucket
        && receipt.object_path === image.object_path
        && HEX.test(String(receipt.content_sha256 || ""))
        && Number.isInteger(receipt.byte_length) && receipt.byte_length > 0,
      `compact_v4_analysis_image_receipt_invalid:${assetId}:${index + 1}`);
      try { assertSignedUrlMatchesImage(asset.image_urls[index], image); }
      catch { throw new Error(`compact_v4_analysis_signed_url_slot_invalid:${assetId}:${index + 1}`); }
    }
  }
  invariant(payload.ordered_signed_urls_sha256
    === sha256(JSON.stringify(assets.map((asset) => asset.image_urls))),
  "compact_v4_analysis_signed_url_hash_invalid");
  invariant(payload.materialization_byte_receipts_sha256
    === sha256(JSON.stringify(assets.map((asset) => ({ asset_id: asset.asset_id,
      image_receipts: asset.image_receipts })))),
  "compact_v4_analysis_byte_receipt_hash_invalid");
  for (const imageCount of [1, 2]) {
    const urls = Array.from({ length: imageCount }, (_, index) =>
      `https://contract.invalid/image-${index + 1}`);
    const isolation = assertCompactV4RequestIsolation({
      control: requestForAsset(payload.control.request_template, urls),
      treatment: requestForAsset(payload.treatment.request_template, urls)
    });
    const frozen = prereg.frozen_contract.provider.request_contracts_by_image_count
      ?.[String(imageCount)];
    invariant(frozen && isolation.control_request_sha256 === frozen.control_request_sha256
      && isolation.treatment_request_sha256 === frozen.treatment_request_sha256
      && isolation.control_schema_sha256 === frozen.control_schema_sha256
      && isolation.treatment_schema_sha256 === frozen.treatment_schema_sha256,
    `compact_v4_analysis_preregistered_request_invalid:${imageCount}`);
  }
  return new Map(assets.map((asset) => [asset.asset_id, asset]));
}

function validateAuthorization({ prereg, payload, manifest, labelRefReceipt,
  deploymentReceipt, authorization, checkpoint }) {
  const expected = {
    schema_version: "model-residual-compact-v4-paid105-authorization-v1",
    execution_surface: "vercel_preview_only",
    authorized: true,
    approval_ref: "user-explicit-approval-2026-08-09-reuse-existing-key",
    prereg_sha256: sha256(JSON.stringify(prereg)),
    payload_sha256: sha256(JSON.stringify(payload)),
    physical_manifest_sha256: sha256(JSON.stringify(manifest)),
    label_ref_receipt_sha256: sha256(JSON.stringify(labelRefReceipt)),
    sealed_labels_sha256: labelRefReceipt.sealed_labels_sha256,
    deployment_receipt_sha256: sha256(JSON.stringify(deploymentReceipt)),
    materialization_byte_receipts_sha256:
      payload.materialization_byte_receipts_sha256,
    preflight_receipt_sha256: checkpoint.preflight_receipt_sha256,
    run_id: checkpoint.run_id,
    run_fingerprint: checkpoint.run_fingerprint,
    max_provider_attempts: 105,
    zero_call_title_fidelity: "35/35",
    zero_call_field_fidelity: "35/35"
  };
  invariant(exactKeys(authorization, AUTHORIZATION_KEYS)
    && Object.entries(expected).every(([key, value]) => authorization[key] === value),
  "compact_v4_analysis_authorization_invalid");
  const authorizationSha = sha256(JSON.stringify(authorization));
  invariant(checkpoint.authorization_receipt_sha256 === authorizationSha,
    "compact_v4_analysis_authorization_hash_mismatch");
  return authorizationSha;
}

function validatePreflightReceipt({ checkpoint, payload, deploymentReceipt }) {
  const receipt = assertCompactV4PreflightReceipt(checkpoint);
  for (const arm of receipt.arms) {
    const frozen = FROZEN_REQUEST_CONTRACTS[arm.arm_id];
    invariant(arm.run_id === `${checkpoint.run_id}.preflight.${arm.arm}`
      && arm.deployment_id === deploymentReceipt.deployment_id
      && arm.deployment_hostname === deploymentReceipt.deployment_hostname
      && arm.release_git_sha === deploymentReceipt.source_git_sha
      && arm.request_template_sha256
        === sha256(JSON.stringify(payload[arm.arm].request_template))
      && arm.contract_normalized_request_sha256 === frozen.normalized_request_sha256
      && arm.contract_normalized_request_bytes === frozen.normalized_request_bytes
      && arm.contract_wire_sha256 === frozen.contract_wire_sha256
      && arm.contract_wire_bytes === frozen.contract_wire_bytes,
    `compact_v4_analysis_preflight_binding_invalid:${arm.arm}`);
  }
}

function validateAssetReverifyReceipt(payload, receipt) {
  invariant(exactKeys(receipt, ["schema_version", "verified_at", "provider_calls",
    "storage_read_calls", "payload_sha256", "materialization_byte_receipts_sha256",
    "all_match", "images_sha256", "images"])
    && receipt.schema_version === "residual-compact-v4-postrun-byte-reverify-v1"
    && Number.isFinite(Date.parse(receipt.verified_at)) && receipt.provider_calls === 0
    && receipt.storage_read_calls === 139 && receipt.all_match === true
    && receipt.payload_sha256 === sha256(JSON.stringify(payload))
    && receipt.materialization_byte_receipts_sha256
      === payload.materialization_byte_receipts_sha256
    && Array.isArray(receipt.images) && receipt.images.length === 139,
  "compact_v4_analysis_asset_reverify_invalid");
  const expected = payload.control.assets.flatMap((asset) =>
    asset.image_receipts.map((image, index) => ({ asset_id: asset.asset_id, slot: index + 1,
      role: image.role, content_sha256: image.content_sha256,
      byte_length: image.byte_length })));
  invariant(receipt.images.every((image) => exactKeys(image,
    ["asset_id", "slot", "role", "content_sha256", "byte_length"]))
    && new Set(receipt.images.map((image) => `${image.asset_id}\0${image.slot}`)).size === 139
    && same(receipt.images, expected)
    && receipt.images_sha256 === sha256(JSON.stringify(receipt.images)),
  "compact_v4_analysis_asset_reverify_mismatch");
  return sha256(JSON.stringify(receipt));
}

function replayResult(row, payload, asset) {
  const result = row.result;
  const request = requestForAsset(payload[row.arm].request_template, asset.image_urls);
  const identity = requestIdentity(request);
  const provider = parseCompactV4ProviderRaw(result?.provider_response_raw, row.arm);
  invariant(result?.request_attempt_count === 1
    && result.request_sha256 === identity.wire_sha256
    && result.request_wire_sha256 === identity.wire_sha256
    && result.normalized_request_sha256 === identity.normalized_request_sha256
    && result.semantic_request_sha256 === semanticCompactV4RequestSha256(request)
    && result.response_id === provider.responseId
    && result.provider_response_sha256 === sha256(result.provider_response_raw)
    && result.structured_output_raw_sha256 === sha256(provider.structuredRaw)
    && same(result.structured_output_envelope, provider.structured)
    && result.structured_output_envelope_sha256
      === sha256(JSON.stringify(provider.structured))
    && result.served_model === provider.servedModel
    && result.requested_effort === "low" && result.served_effort === provider.servedEffort
    && same(result.usage, provider.usage),
  `compact_v4_analysis_response_identity_invalid:${row.job_key}`);
  const raw = structuredClone(provider.structured);
  const phrase = row.arm === "treatment" ? raw.residual_printed_phrase : null;
  const canonicalPayload = structuredClone(raw);
  delete canonicalPayload.residual_printed_phrase;
  const canonical = finishCanonicalTitle(JSON.stringify(canonicalPayload),
    { exactParallelColorCompaction: false });
  const inference = row.arm === "treatment"
    ? inferModelResidualSinglePrintedPhraseRouteV4(phrase,
      { canonicalFields: canonical.fields }) : null;
  const candidates = row.arm === "treatment" && !inference.ambiguous
    ? inflateModelResidualSinglePrintedPhraseV4(phrase,
      { canonicalFields: canonical.fields }) : [];
  const resolved = row.arm === "treatment"
    ? resolveModelResidualVisibleEvidenceV3(canonical.fields, candidates,
      { composerFeatures: FROZEN_COMPOSER_FEATURES }) : null;
  for (const [name, actual, expected] of [
    ["canonical_payload", result.canonical_payload, canonicalPayload],
    ["canonical_fields", result.canonical_fields, canonical.fields],
    ["canonical_title", result.canonical_title, canonical.title],
    ["canonical_field_defects", result.canonical_field_defects, canonical.field_defects],
    ["residual_printed_phrase", result.residual_printed_phrase, phrase],
    ["residual_inference", result.residual_inference, inference],
    ["resolved", result.resolved, resolved]
  ]) invariant(same(actual, expected),
    `compact_v4_analysis_envelope_replay_mismatch:${name}:${row.job_key}`);
  const input = provider.usage.input_tokens; const output = provider.usage.output_tokens;
  invariant(Number.isFinite(result.latency_ms) && result.latency_ms > 0,
    `compact_v4_analysis_cost_invalid:${row.job_key}`);
  return { canonical, phrase, inference, resolved, totalTokens: input + output,
    outputTokens: output, latencyMs: result.latency_ms };
}

function validateFrozenRun({ prereg, payload, manifest, labelRefReceipt, deploymentReceipt,
  authorization, checkpoint, assetReverifyReceipt }) {
  assertNoLabels(checkpoint);
  invariant(prereg?.schema_version === "model-residual-compact-v4-cloud-prereg-v1"
    && prereg.authority === "evaluation_only"
    && Array.isArray(prereg.confirmatory_70?.asset_ids)
    && prereg.confirmatory_70.asset_ids.length === 70
    && new Set(prereg.confirmatory_70.asset_ids).size === 70,
  "compact_v4_analysis_prereg_invalid");
  validateLabelRefReceipt(prereg, labelRefReceipt);
  const assets = validatePayloadBindings({ prereg, payload, manifest, labelRefReceipt });
  invariant(checkpoint?.schema_version === "cloud-residual-compact-v4-run-contract-v1"
    && checkpoint.state === "COMPLETE" && checkpoint.provider_attempts === 105
    && checkpoint.provider_calls === 105 && checkpoint.provider_retries === 0
    && checkpoint.max_provider_attempts === 105 && checkpoint.concurrency === 1
    && checkpoint.retries === 0 && checkpoint.preflight_provider_calls === 0
    && checkpoint.sealed_labels_accessed_during_execution === false,
  "compact_v4_analysis_checkpoint_incomplete");
  validateDeploymentReceipt(deploymentReceipt, checkpoint);
  invariant(checkpoint.prereg_sha256 === sha256(JSON.stringify(prereg))
    && checkpoint.payload_sha256 === sha256(JSON.stringify(payload))
    && checkpoint.physical_manifest_sha256 === sha256(JSON.stringify(manifest))
    && checkpoint.label_ref_receipt_sha256 === sha256(JSON.stringify(labelRefReceipt))
    && checkpoint.deployment_receipt_sha256 === sha256(JSON.stringify(deploymentReceipt))
    && checkpoint.ordered_signed_urls_sha256 === payload.ordered_signed_urls_sha256
    && checkpoint.materialization_byte_receipts_sha256
      === payload.materialization_byte_receipts_sha256
    && checkpoint.run_fingerprint === sha256(JSON.stringify(fingerprintValue(checkpoint))),
  "compact_v4_analysis_run_fingerprint_mismatch");
  validatePreflightReceipt({ checkpoint, payload, deploymentReceipt });
  const authorizationSha = validateAuthorization({ prereg, payload, manifest,
    labelRefReceipt, deploymentReceipt, authorization, checkpoint });
  const assetReverifyReceiptSha256 = validateAssetReverifyReceipt(payload,
    assetReverifyReceipt);
  const jobs = compactV4JobsFrom(prereg);
  invariant(checkpoint.jobs_sha256 === sha256(JSON.stringify(jobs))
    && exactKeys(checkpoint.jobs, jobs.map((job) => job.job_key)),
  "compact_v4_analysis_job_set_invalid");
  const responses = new Set(); const byAsset = new Map();
  for (const [index, job] of jobs.entries()) {
    const row = checkpoint.jobs[job.job_key]; const asset = assets.get(job.asset_id);
    invariant(row?.state === "COMPLETE" && row.attempt_count === 1
      && row.authorization_receipt_sha256 === authorizationSha
      && row.job_run_id === `${checkpoint.run_id}.${String(index + 1).padStart(3, "0")}`
      && row.asset_id === job.asset_id && row.arm === job.arm
      && row.slot === job.slot && row.block_index === job.block_index
      && row.job_key === job.job_key && row.image_set_sha256 === asset?.image_set_sha256,
    `compact_v4_analysis_job_invalid:${job.job_key}`);
    const replay = replayResult(row, payload, asset);
    invariant(!responses.has(row.result.response_id),
      "compact_v4_analysis_response_id_duplicate");
    responses.add(row.result.response_id);
    if (!byAsset.has(job.asset_id)) byAsset.set(job.asset_id, {});
    byAsset.get(job.asset_id)[job.arm] = { row, replay };
  }
  invariant(prereg.confirmatory_70.asset_ids.every((assetId) => byAsset.get(assetId)?.treatment)
    && new Set(prereg.confirmatory_70.schedule.map((block) => block.paired_asset_id))
      .size === 35,
  "compact_v4_analysis_arm_coverage_invalid");
  return { jobs, byAsset, authorizationSha, assetReverifyReceiptSha256 };
}

export function prepareCompactV4Analysis({ prereg, payload, manifest, labelRefReceipt,
  deploymentReceipt, authorization, checkpoint, assetReverifyReceipt }) {
  const frozen = validateFrozenRun({ prereg, payload, manifest, labelRefReceipt,
    deploymentReceipt, authorization, checkpoint, assetReverifyReceipt });
  return { prereg, payload, manifest, labelRefReceipt, deploymentReceipt, authorization,
    checkpoint, assetReverifyReceipt, frozen };
}

export function validateCompactV4DatasetMapping(prepared, datasetBody) {
  const { prereg, labelRefReceipt } = prepared;
  invariant(sha256(datasetBody) === labelRefReceipt.dataset_sha256,
    "compact_v4_analysis_dataset_hash_mismatch");
  let dataset;
  try { dataset = JSON.parse(String(datasetBody)); }
  catch { throw new Error("compact_v4_analysis_dataset_invalid_json"); }
  invariant(Array.isArray(dataset?.items), "compact_v4_analysis_dataset_invalid");
  const ids = new Set(); const byId = new Map();
  for (const item of dataset.items) {
    invariant(clean(item?.asset_id) && !ids.has(item.asset_id),
      "compact_v4_analysis_dataset_asset_id_duplicate");
    ids.add(item.asset_id); byId.set(item.asset_id, item);
  }
  const mapping = prereg.confirmatory_70.asset_ids.map((assetId) => {
    const ref = structuredClone(byId.get(assetId)?.sealed_eval_label_ref);
    invariant(exactKeys(ref, ["path", "key"]),
      `compact_v4_analysis_dataset_label_ref_missing:${assetId}`);
    return { asset_id: assetId, sealed_eval_label_ref: ref };
  });
  invariant(sha256(JSON.stringify(mapping)) === labelRefReceipt.mapping_sha256
    && same(mapping, labelRefReceipt.selected),
  "compact_v4_analysis_label_mapping_mismatch");
  return mapping;
}

export function validateCompactV4SealedLabelKeys(labelsBody) {
  const rows = parseJsonLines(labelsBody); const labels = new Map();
  for (const row of rows) {
    invariant(clean(row?.key) && !labels.has(row.key),
      "compact_v4_analysis_sealed_label_key_duplicate");
    labels.set(row.key, row);
  }
  return labels;
}

function references({ labelsBody, mapping, labelRefReceipt }) {
  invariant(sha256(labelsBody) === labelRefReceipt.sealed_labels_sha256,
    "compact_v4_analysis_sealed_labels_hash_mismatch");
  const labels = validateCompactV4SealedLabelKeys(labelsBody);
  return new Map(mapping.map(({ asset_id, sealed_eval_label_ref: ref }) => {
    const label = labels.get(ref.key);
    invariant(ref.path === labelRefReceipt.expected_labels_path
      && label?.label_type === "REVIEWED_INTERNAL_TITLE" && clean(label.reviewed_title)
      && label.policy?.reviewed_title_is_ground_truth === true
      && label.policy?.model_prompt_visible === false
      && label.policy?.load_after_predictions_frozen === true,
    `compact_v4_analysis_sealed_label_invalid:${asset_id}`);
    return [asset_id, label.reviewed_title];
  }));
}

function safetyFor(reference, replay) {
  const canonicalTitle = replay.canonical.title; const resolvedTitle = replay.resolved.title;
  const baseline = tokens(canonicalTitle); const resolved = tokens(resolvedTitle);
  const referenceTokens = tokens(reference);
  const sourceText = [...flatten(replay.canonical.fields), replay.phrase].join(" ");
  const sourceTokens = tokens(sourceText);
  const referenceLoss = difference(baseline, resolved).some((token) => referenceTokens.has(token));
  const unbacked = difference(resolved, baseline).some((token) => !sourceTokens.has(token));
  const baselineNumbers = numericClaims(canonicalTitle);
  const resolvedNumbers = numericClaims(resolvedTitle); const sourceNumbers = numericClaims(sourceText);
  const unsupportedNumeric = difference(baselineNumbers, resolvedNumbers).length > 0
    || difference(resolvedNumbers, baselineNumbers).some((claim) => !sourceNumbers.has(claim));
  const invalidValue = replay.phrase !== null
    && (typeof replay.phrase !== "string" || !clean(replay.phrase)
      || clean(replay.phrase).length > 64);
  const resolverDefect = (replay.resolved.defects || []).length > 0
    || replay.resolved.accepted !== true;
  return { referenceLoss, unbacked, unsupportedNumeric, invalidValue, resolverDefect,
    ambiguousApplied: replay.inference.ambiguous && replay.resolved.applied === true,
    over80: resolvedTitle.length > 80 };
}

export function applyCompactV4TypedGoldBoundary(proxyGate, { typedGoldCards = 0,
  expectedCards = 70 } = {}) {
  invariant(proxyGate && typeof proxyGate === "object",
    "compact_v4_typed_boundary_gate_missing");
  const proxyDecision = proxyGate.decision;
  const hardProxyStop = proxyDecision === "STOP_HARD_REGRESSION";
  const titleProxyErrorCards = proxyGate.safety?.critical_error ?? null;
  return {
    ...proxyGate,
    decision: hardProxyStop ? proxyDecision : "HOLD_TYPED_GOLD_REQUIRED",
    capture_economics_decision: proxyDecision,
    production_authorized: false,
    utility: { ...proxyGate.utility, metric_scope: "reviewed_title_token_proxy" },
    safety: {
      ...proxyGate.safety,
      passed: false,
      proxy_safety_passed: proxyGate.safety?.passed === true,
      title_proxy_error_cards: titleProxyErrorCards,
      critical_error: null,
      critical_factual_error_cards: null,
      typed_gold_coverage: `${typedGoldCards}/${expectedCards}`,
      typed_field_precision: null,
      typed_field_recall: null,
      typed_required_missing_cards: null,
      typed_wrong_role_cards: null,
      factual_authority: "UNAVAILABLE_UNTIL_INDEPENDENT_TYPED_GOLD"
    },
    next_if_pass: "complete independent typed-gold annotation and rerun the frozen analyzer; title proxy alone cannot advance the mechanism"
  };
}

export function analyzePreparedCompactV4({ prepared, datasetBody, labelsBody,
  mapping = validateCompactV4DatasetMapping(prepared, datasetBody) }) {
  const { prereg, payload, labelRefReceipt, checkpoint, frozen } = prepared;
  const refs = references({ labelsBody, mapping, labelRefReceipt });
  const pairedIds = new Set(prereg.confirmatory_70.schedule.map((block) => block.paired_asset_id));
  const treatmentRows = prereg.confirmatory_70.asset_ids.map((assetId) => {
    const treatment = frozen.byAsset.get(assetId).treatment;
    const reference = refs.get(assetId); const replay = treatment.replay;
    const safety = safetyFor(reference, replay);
    const control = frozen.byAsset.get(assetId).control;
    const criticalFields = ["year", "players", "card_number", "serial_number",
      "grade_company", "card_grade", "cert_number"];
    const pairedCriticalRegression = Boolean(control)
      && score(reference, replay.canonical.title) + EPSILON
        < score(reference, control.replay.canonical.title)
      && criticalFields.some((field) => !same(replay.canonical.fields[field] ?? null,
        control.replay.canonical.fields[field] ?? null));
    const titleProxyError = safety.referenceLoss || safety.unbacked || safety.unsupportedNumeric
      || safety.invalidValue || safety.resolverDefect || safety.ambiguousApplied || safety.over80;
    return {
      asset_id: assetId,
      image_count: payload.treatment.assets.find((asset) => asset.asset_id === assetId)
        .image_urls.length,
      environment: "preview", region: "sin1", request_attempt_count: 1,
      provider_retries: 0, request_sha256: treatment.row.result.semantic_request_sha256,
      canonical_f1: score(reference, replay.canonical.title),
      resolved_f1: score(reference, replay.resolved.title),
      latency_ms: replay.latencyMs, total_tokens: replay.totalTokens,
      output_tokens: replay.outputTokens, title_proxy_error: titleProxyError,
      reference_loss: safety.referenceLoss, unbacked_new_token: safety.unbacked,
      unsupported_numeric_change: safety.unsupportedNumeric,
      invalid_compact_value: safety.invalidValue,
      ambiguous_route_applied: safety.ambiguousApplied, title_over_80: safety.over80,
      canonical_shape_defect: replay.canonical.field_defects.length > 0,
      resolved_field_regression: safety.resolverDefect,
      canonical_critical_field_regression: pairedCriticalRegression
    };
  });
  const controlRows = [...pairedIds].map((assetId) => {
    const control = frozen.byAsset.get(assetId).control;
    const reference = refs.get(assetId); const replay = control.replay;
    return { asset_id: assetId,
      image_count: payload.control.assets.find((asset) => asset.asset_id === assetId)
        .image_urls.length,
      environment: "preview", region: "sin1", request_attempt_count: 1,
      provider_retries: 0, request_sha256: control.row.result.semantic_request_sha256,
      canonical_f1: score(reference, replay.canonical.title), latency_ms: replay.latencyMs,
      total_tokens: replay.totalTokens, output_tokens: replay.outputTokens,
      canonical_shape_defect: replay.canonical.field_defects.length > 0,
      canonical_critical_field_regression: false };
  });
  const gateRows = treatmentRows.map((row) => ({ ...row,
    critical_error: row.title_proxy_error }));
  const proxyGate = evaluateModelResidualCompactV4PreviewGate({ prereg,
    treatmentRows: gateRows, controlRows });
  const gate = applyCompactV4TypedGoldBoundary(proxyGate);
  return { schema_version: "model-residual-compact-v4-cloud-analysis-v1",
    authority: "evaluation_only", production_authorized: false,
    sealed_labels_opened_after_complete_run_validation: true,
    validated_run: { provider_calls: 105, provider_retries: 0,
      run_fingerprint: checkpoint.run_fingerprint,
      authorization_receipt_sha256: frozen.authorizationSha,
      asset_reverify_receipt_sha256: frozen.assetReverifyReceiptSha256 },
    gate, treatment_rows: treatmentRows, control_rows: controlRows };
}

export function analyzeCompactV4FrozenRun({ prereg, payload, manifest, labelRefReceipt,
  deploymentReceipt, authorization, checkpoint, assetReverifyReceipt, datasetBody,
  labelsBody }) {
  const prepared = prepareCompactV4Analysis({ prereg, payload, manifest, labelRefReceipt,
    deploymentReceipt, authorization, checkpoint, assetReverifyReceipt });
  return analyzePreparedCompactV4({ prepared, datasetBody, labelsBody });
}

async function jsonFrom(path, readFileImpl) {
  return JSON.parse(String(await readFileImpl(resolve(path))));
}

export async function analyzeCompactV4Files({ preregPath, payloadPath, manifestPath,
  labelRefReceiptPath, deploymentReceiptPath, authorizationPath, checkpointPath,
  assetReverifyPath, datasetPath, labelsPath, readFileImpl = readFile,
  readLabelsImpl = readFile }) {
  const [prereg, payload, manifest, labelRefReceipt, deploymentReceipt, authorization,
    checkpoint, assetReverifyReceipt] = await Promise.all([
    jsonFrom(preregPath, readFileImpl), jsonFrom(payloadPath, readFileImpl),
    jsonFrom(manifestPath, readFileImpl), jsonFrom(labelRefReceiptPath, readFileImpl),
    jsonFrom(deploymentReceiptPath, readFileImpl), jsonFrom(authorizationPath, readFileImpl),
    jsonFrom(checkpointPath, readFileImpl), jsonFrom(assetReverifyPath, readFileImpl)
  ]);
  const prepared = prepareCompactV4Analysis({ prereg, payload, manifest, labelRefReceipt,
    deploymentReceipt, authorization, checkpoint, assetReverifyReceipt });
  const datasetBody = await readFileImpl(resolve(datasetPath));
  const mapping = validateCompactV4DatasetMapping(prepared, datasetBody);
  const labelsBody = await readLabelsImpl(resolve(labelsPath));
  return analyzePreparedCompactV4({ prepared, datasetBody, labelsBody, mapping });
}

const arg = (argv, name) => {
  const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || "");
};

export async function main(argv = process.argv.slice(2)) {
  const required = ["--prereg", "--payload", "--assets-manifest", "--label-ref-receipt",
    "--deployment-receipt", "--authorization", "--checkpoint", "--asset-reverify",
    "--dataset", "--labels", "--out"];
  if (required.some((name) => !arg(argv, name))) {
    throw new Error("compact_v4_analysis_required_path_missing");
  }
  const result = await analyzeCompactV4Files({
    preregPath: arg(argv, "--prereg"), payloadPath: arg(argv, "--payload"),
    manifestPath: arg(argv, "--assets-manifest"),
    labelRefReceiptPath: arg(argv, "--label-ref-receipt"),
    deploymentReceiptPath: arg(argv, "--deployment-receipt"),
    authorizationPath: arg(argv, "--authorization"),
    checkpointPath: arg(argv, "--checkpoint"),
    assetReverifyPath: arg(argv, "--asset-reverify"),
    datasetPath: arg(argv, "--dataset"), labelsPath: arg(argv, "--labels")
  });
  await writeJsonAtomic(resolve(arg(argv, "--out")), result);
  process.stdout.write(`${JSON.stringify({ decision: result.gate.decision,
    utility: result.gate.utility, safety: result.gate.safety,
    economics: result.gate.economics, output: resolve(arg(argv, "--out")) }, null, 2)}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
