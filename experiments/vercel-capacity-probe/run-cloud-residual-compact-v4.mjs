#!/usr/bin/env node

// Hardened Preview-only executor for the preregistered compact-v4 70T/35C
// screen. No label bytes enter this process. Every attempt is durably written
// before the one-call Preview invocation; ambiguous attempts are never retried.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { finishCanonicalTitle } from "../../lib/listing/thin/thin-listing-path.mjs";
import { inflateModelResidualSinglePrintedPhraseV4,
  inferModelResidualSinglePrintedPhraseRouteV4 } from
  "../accuracy/model-residual-compact-v4.mjs";
import { resolveModelResidualVisibleEvidenceV3 } from
  "../accuracy/model-residual-visible-evidence-v3.mjs";
import { assertCompactV4BudgetSchedule, assertCompactV4RequestIsolation,
  semanticCompactV4RequestSha256 } from
  "../accuracy/model-residual-compact-v4-cloud-plan.mjs";
import { acquireCheckpointLock, cleanCommittedSourceState, deploymentOrigin, durableJsonWriter,
  invokePreview, readJson, runTokenFromKeychain } from "./cloud-io.mjs";
import { assertSignedUrlMatchesImage, validateAssetsOnlyManifest } from
  "./materialize-residual-v3-payload.mjs";
import { FROZEN_REQUEST_CONTRACTS, requestForAsset, requestIdentity, sha256 }
  from "./request-contract.mjs";

const EXPECTED_JOBS = 105;
const CONCURRENCY = 1;
const STORAGE_HOST = "irpgnhkslrsiucybkufc.supabase.co";
const MINIMUM_PAYLOAD_TTL_MS = 3 * 60 * 60 * 1000;
const SINGLE_JOB_MINIMUM_TTL_MS = 180_000;
const FROZEN_COMPOSER_FEATURES = Object.freeze({ exact_parallel_color_compaction: false });
const HEX = /^[0-9a-f]{64}$/;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FORBIDDEN_KEYS = new Set(["reviewed_title", "reference_title", "ground_truth",
  "sealed_labels", "labels", "expected_title", "scorer_reference"]);

const clean = (value) => String(value ?? "").trim();
const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exactKeys = (value, expected) => value && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
const json = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

function assertNoLabels(value, path = "execution") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`compact_v4_forbidden_execution_key:${path}.${key}`);
    }
    assertNoLabels(nested, `${path}.${key}`);
  }
}

function signedExpiryMs(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.hostname !== STORAGE_HOST
      || !url.pathname.startsWith("/storage/v1/object/sign/")) {
    throw new Error("compact_v4_signed_url_invalid");
  }
  const encoded = url.searchParams.get("token")?.split(".")?.[1];
  if (!encoded) throw new Error("compact_v4_signed_url_token_missing");
  let claims;
  try { claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { throw new Error("compact_v4_signed_url_token_invalid"); }
  if (!Number.isInteger(claims?.exp)) throw new Error("compact_v4_signed_url_expiry_missing");
  return claims.exp * 1000;
}

function providerAsset(asset) {
  return { asset_id: asset.asset_id, image_set_sha256: asset.image_set_sha256,
    image_urls: structuredClone(asset.image_urls) };
}

export function parseCompactV4ProviderRaw(raw, arm) {
  if (typeof raw !== "string" || !raw) throw new Error("compact_v4_provider_raw_missing");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("compact_v4_provider_raw_invalid_json"); }
  const topEffort = typeof parsed?.reasoning_effort === "string" ? parsed.reasoning_effort : null;
  const nestedEffort = typeof parsed?.reasoning?.effort === "string" ? parsed.reasoning.effort : null;
  const servedEffort = topEffort && nestedEffort && topEffort !== nestedEffort
    ? null : topEffort || nestedEffort;
  const texts = (Array.isArray(parsed?.output) ? parsed.output : []).flatMap((item) =>
    Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text);
  let structured = null;
  try { if (texts.length === 1) structured = JSON.parse(texts[0]); } catch {}
  const hasCompact = plainObject(structured)
    && Object.hasOwn(structured, "residual_printed_phrase");
  if (!clean(parsed?.id) || parsed.status !== "completed" || parsed.error
      || parsed.incomplete_details || parsed.model !== "gpt-5.6-luna"
      || servedEffort !== "low" || texts.length !== 1 || !plainObject(structured)
      || hasCompact !== (arm === "treatment")) {
    throw new Error("compact_v4_provider_raw_contract_invalid");
  }
  const inputTokens = Number(parsed.usage?.input_tokens);
  const outputTokens = Number(parsed.usage?.output_tokens);
  const cachedTokens = Number(parsed.usage?.input_tokens_details?.cached_tokens ?? 0);
  if (!Number.isFinite(inputTokens) || inputTokens <= 0
      || !Number.isFinite(outputTokens) || outputTokens <= 0
      || !Number.isFinite(cachedTokens) || cachedTokens < 0) {
    throw new Error("compact_v4_provider_raw_usage_invalid");
  }
  return { parsed, structured, structuredRaw: texts[0], responseId: parsed.id,
    servedModel: parsed.model, servedEffort,
    usage: { input_tokens: inputTokens, cached_input_tokens: cachedTokens,
      output_tokens: outputTokens } };
}

export function compactV4JobsFrom(prereg) {
  assertCompactV4BudgetSchedule(prereg.confirmatory_70?.schedule);
  const jobs = [];
  for (const block of prereg.confirmatory_70.schedule) {
    const slots = {
      paired_control: { asset_id: block.paired_asset_id, arm: "control" },
      paired_treatment: { asset_id: block.paired_asset_id, arm: "treatment" },
      unpaired_treatment: { asset_id: block.unpaired_asset_id, arm: "treatment" }
    };
    for (const slot of block.order) jobs.push({ ...slots[slot], slot,
      block_index: block.block_index });
  }
  if (jobs.length !== EXPECTED_JOBS
      || new Set(jobs.map((job) => `${job.asset_id}:${job.arm}`)).size !== EXPECTED_JOBS) {
    throw new Error("compact_v4_job_schedule_invalid");
  }
  return jobs.map((job) => ({ ...job, job_key: `${job.asset_id}:${job.arm}` }));
}

export function assertCompactV4PreflightReceipt(checkpoint) {
  const receipt = checkpoint?.preflight_receipt;
  const expectedKeys = ["schema_version", "run_fingerprint", "payload_sha256",
    "deployment_receipt_sha256", "provider_attempts", "provider_calls", "provider_retries",
    "arms"];
  if (!exactKeys(receipt, expectedKeys)
      || receipt.schema_version !== "cloud-residual-compact-v4-preflight-receipt-v1"
      || receipt.run_fingerprint !== checkpoint.run_fingerprint
      || receipt.payload_sha256 !== checkpoint.payload_sha256
      || receipt.deployment_receipt_sha256 !== checkpoint.deployment_receipt_sha256
      || receipt.provider_attempts !== 0 || receipt.provider_calls !== 0
      || receipt.provider_retries !== 0 || !Array.isArray(receipt.arms)
      || receipt.arms.length !== 2
      || receipt.arms.map((arm) => arm.arm).join(",") !== "control,treatment"
      || checkpoint.preflight_provider_calls !== 0
      || checkpoint.preflight_receipt_sha256 !== sha256(JSON.stringify(receipt))) {
    throw new Error("compact_v4_preflight_receipt_invalid");
  }
  for (const arm of receipt.arms) {
    if (!exactKeys(arm, ["arm", "arm_id", "run_id", "deployment_id",
      "deployment_hostname", "release_git_sha", "request_template_sha256",
      "contract_normalized_request_sha256", "contract_normalized_request_bytes",
      "contract_wire_sha256", "contract_wire_bytes", "provider_calls", "provider_retries"])
        || arm.arm_id !== `compact_v4_${arm.arm}` || !clean(arm.run_id)
        || !clean(arm.deployment_id) || !clean(arm.deployment_hostname)
        || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(arm.release_git_sha)
        || !HEX.test(String(arm.request_template_sha256 || ""))
        || !HEX.test(String(arm.contract_normalized_request_sha256 || ""))
        || !Number.isInteger(arm.contract_normalized_request_bytes)
        || !HEX.test(String(arm.contract_wire_sha256 || ""))
        || !Number.isInteger(arm.contract_wire_bytes)
        || arm.provider_calls !== 0 || arm.provider_retries !== 0) {
      throw new Error("compact_v4_preflight_arm_receipt_invalid");
    }
  }
  return receipt;
}

function validateDeploymentReceipt(receipt, origin) {
  const expected = ["schema_version", "project_name", "project_id", "org_id", "environment",
    "region", "deployment_id", "deployment_hostname", "source_git_sha", "source_tree_clean",
    "source_status_sha256"];
  if (!exactKeys(receipt, expected)
      || receipt.schema_version !== "residual-compact-v4-preview-deployment-receipt-v1"
      || receipt.project_name !== "lynca-capacity-lab"
      || receipt.project_id !== "prj_OnBhU4kHtWuOBCs3iGoYZsYfaWbg"
      || receipt.org_id !== "team_il17GLcdGsr5fows3jsKwMoA"
      || receipt.environment !== "preview" || receipt.region !== "sin1"
      || !clean(receipt.deployment_id)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(receipt.source_git_sha || ""))
      || receipt.source_tree_clean !== true
      || receipt.source_status_sha256 !== sha256("")
      || receipt.deployment_hostname !== new URL(origin).hostname) {
    throw new Error("compact_v4_preview_deployment_receipt_invalid");
  }
  return receipt;
}

function validateInputs({ prereg, payload, manifest, labelRefReceipt, deploymentReceipt,
  origin, nowMs, sourceState }) {
  assertNoLabels(prereg, "prereg");
  assertNoLabels(payload, "payload");
  assertNoLabels(manifest, "manifest");
  assertNoLabels(labelRefReceipt, "label_ref_receipt");
  assertNoLabels(deploymentReceipt, "deployment_receipt");
  if (prereg?.schema_version !== "model-residual-compact-v4-cloud-prereg-v1"
      || prereg.authority !== "evaluation_only" || prereg.run_fingerprint?.length !== 64
      || !Array.isArray(prereg.confirmatory_70?.asset_ids)
      || prereg.confirmatory_70.asset_ids.length !== 70
      || new Set(prereg.confirmatory_70.asset_ids).size !== 70) {
    throw new Error("compact_v4_prereg_invalid");
  }
  validateAssetsOnlyManifest(manifest, { expectedCards: 70, minimumImages: 1,
    maximumImages: 2, schemaVersion: "residual-compact-v4-assets-only-manifest-v1" });
  const labelReceiptKeys = ["schema_version", "dataset_sha256", "mapping_sha256",
    "expected_labels_path", "sealed_labels_sha256", "sealed_label_bytes_read", "selected"];
  if (!exactKeys(labelRefReceipt, labelReceiptKeys)
      || labelRefReceipt?.schema_version !== "residual-compact-v4-label-ref-receipt-v1"
      || labelRefReceipt.sealed_label_bytes_read !== false
      || !HEX.test(String(labelRefReceipt.dataset_sha256 || ""))
      || !HEX.test(String(labelRefReceipt.mapping_sha256 || ""))
      || !HEX.test(String(labelRefReceipt.sealed_labels_sha256 || ""))
      || typeof labelRefReceipt.expected_labels_path !== "string"
      || !Array.isArray(labelRefReceipt.selected) || labelRefReceipt.selected.length !== 70) {
    throw new Error("compact_v4_label_ref_receipt_invalid");
  }
  const selectedAssets = new Set(); const selectedKeys = new Set();
  for (const selected of labelRefReceipt.selected) {
    const ref = selected?.sealed_eval_label_ref;
    if (!exactKeys(selected, ["asset_id", "sealed_eval_label_ref"])
        || !exactKeys(ref, ["path", "key"])
        || !prereg.confirmatory_70.asset_ids.includes(selected.asset_id)
        || ref.path !== labelRefReceipt.expected_labels_path || !clean(ref.key)
        || selectedAssets.has(selected.asset_id) || selectedKeys.has(ref.key)) {
      throw new Error("compact_v4_label_ref_receipt_selected_invalid");
    }
    selectedAssets.add(selected.asset_id); selectedKeys.add(ref.key);
  }
  validateDeploymentReceipt(deploymentReceipt, origin);
  if (sourceState?.clean !== true || sourceState.head_sha !== deploymentReceipt.source_git_sha
      || sourceState.status_porcelain_sha256 !== deploymentReceipt.source_status_sha256) {
    throw new Error("compact_v4_execution_source_not_clean_deployed_commit");
  }
  const payloadKeys = ["schema_version", "materialized_at", "minimum_remaining_ttl_ms",
    "prereg_sha256", "physical_manifest_sha256", "label_ref_receipt_sha256",
    "ordered_signed_urls_sha256", "materialization_byte_receipts_sha256", "control", "treatment"];
  if (!exactKeys(payload, payloadKeys)
      || payload.schema_version !== "cloud-residual-compact-v4-materialized-payload-v1"
      || payload.prereg_sha256 !== sha256(JSON.stringify(prereg))
      || payload.physical_manifest_sha256 !== sha256(JSON.stringify(manifest))
      || payload.label_ref_receipt_sha256 !== sha256(JSON.stringify(labelRefReceipt))) {
    throw new Error("compact_v4_payload_receipt_invalid");
  }
  const arms = { control: "compact_v4_control", treatment: "compact_v4_treatment" };
  for (const [arm, armId] of Object.entries(arms)) {
    if (!exactKeys(payload[arm], ["arm_id", "request_template", "assets"])
        || payload[arm].arm_id !== armId) throw new Error(`compact_v4_payload_arm_invalid:${arm}`);
  }
  if (JSON.stringify(payload.control.assets) !== JSON.stringify(payload.treatment.assets)) {
    throw new Error("compact_v4_payload_assets_not_shared");
  }
  const assets = payload.control.assets;
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const physicalById = new Map(manifest.assets.map((asset) => [asset.asset_id, asset]));
  if (assets.length !== 70 || byId.size !== 70) throw new Error("compact_v4_payload_assets_invalid");
  for (const assetId of prereg.confirmatory_70.asset_ids) {
    const asset = byId.get(assetId); const physical = physicalById.get(assetId);
    if (!exactKeys(asset, ["asset_id", "image_set_sha256", "image_urls", "image_receipts"])
        || !physical || asset.image_set_sha256 !== physical.image_set_sha256
        || !Array.isArray(asset.image_urls)
        || asset.image_urls.length !== physical.images.length
        || !Array.isArray(asset.image_receipts)
        || asset.image_receipts.length !== physical.images.length) {
      throw new Error(`compact_v4_physical_pairing_mismatch:${assetId}`);
    }
    for (const [index, image] of physical.images.entries()) {
      const receipt = asset.image_receipts[index];
      if (!exactKeys(receipt, ["role", "bucket", "object_path", "content_sha256", "byte_length"])
          || receipt.role !== image.role || receipt.bucket !== image.bucket
          || receipt.object_path !== image.object_path
          || !HEX.test(String(receipt.content_sha256 || ""))
          || !Number.isInteger(receipt.byte_length) || receipt.byte_length < 1) {
        throw new Error(`compact_v4_image_byte_receipt_invalid:${assetId}:${index + 1}`);
      }
      try { assertSignedUrlMatchesImage(asset.image_urls[index], image); }
      catch { throw new Error(`compact_v4_signed_url_slot_mismatch:${assetId}:${index + 1}`); }
    }
  }
  const actualUrlHash = sha256(JSON.stringify(assets.map((asset) => asset.image_urls)));
  if (actualUrlHash !== payload.ordered_signed_urls_sha256) {
    throw new Error("compact_v4_signed_url_hash_mismatch");
  }
  const actualByteReceiptHash = sha256(JSON.stringify(assets.map((asset) => ({
    asset_id: asset.asset_id, image_receipts: asset.image_receipts
  }))));
  if (actualByteReceiptHash !== payload.materialization_byte_receipts_sha256) {
    throw new Error("compact_v4_materialization_byte_receipt_hash_mismatch");
  }
  const expiries = assets.flatMap((asset) => asset.image_urls.map(signedExpiryMs));
  const earliestExpiryMs = Math.min(...expiries);
  if (payload.minimum_remaining_ttl_ms < MINIMUM_PAYLOAD_TTL_MS
      || earliestExpiryMs - nowMs < payload.minimum_remaining_ttl_ms) {
    throw new Error("compact_v4_payload_ttl_insufficient");
  }
  const controlContract = requestIdentity(requestForAsset(payload.control.request_template,
    ["https://contract.invalid/front", "https://contract.invalid/back"]));
  const treatmentContract = requestIdentity(requestForAsset(payload.treatment.request_template,
    ["https://contract.invalid/front", "https://contract.invalid/back"]));
  for (const [arm, actual] of [["compact_v4_control", controlContract],
    ["compact_v4_treatment", treatmentContract]]) {
    const frozen = FROZEN_REQUEST_CONTRACTS[arm];
    if (!frozen || actual.normalized_request_sha256 !== frozen.normalized_request_sha256
        || actual.normalized_request_bytes !== frozen.normalized_request_bytes
        || actual.wire_sha256 !== frozen.contract_wire_sha256
        || actual.wire_bytes !== frozen.contract_wire_bytes) {
      throw new Error(`compact_v4_template_not_frozen:${arm}`);
    }
  }
  for (const imageCount of [1, 2]) {
    const urls = Array.from({ length: imageCount }, (_, index) =>
      `https://contract.invalid/image-${index + 1}`);
    const isolation = assertCompactV4RequestIsolation({
      control: requestForAsset(payload.control.request_template, urls),
      treatment: requestForAsset(payload.treatment.request_template, urls)
    });
    const frozen = prereg.frozen_contract.provider.request_contracts_by_image_count
      [String(imageCount)];
    if (!frozen || isolation.control_request_sha256 !== frozen.control_request_sha256
        || isolation.treatment_request_sha256 !== frozen.treatment_request_sha256
        || isolation.control_schema_sha256 !== frozen.control_schema_sha256
        || isolation.treatment_schema_sha256 !== frozen.treatment_schema_sha256) {
      throw new Error(`compact_v4_preregistered_request_mismatch:${imageCount}`);
    }
  }
  return { assetsById: byId, earliestExpiryMs, jobs: compactV4JobsFrom(prereg),
    contracts: { control: controlContract, treatment: treatmentContract } };
}

function resultEnvelope(report, job, asset, request, runFingerprint, origin, deploymentReceipt,
  jobRunId) {
  const frozen = FROZEN_REQUEST_CONTRACTS[`compact_v4_${job.arm}`];
  if (!report?.ok || report.provider_calls !== 1 || report.provider_retries !== 0
      || report.arm_id !== `compact_v4_${job.arm}` || report.run_id !== jobRunId
      || report.environment !== "preview" || report.region !== "sin1"
      || report.deployment_id !== deploymentReceipt.deployment_id
      || report.deployment_hostname !== new URL(origin).hostname
      || report.release_git_sha !== deploymentReceipt.source_git_sha
      || report.storage_host !== STORAGE_HOST || report.model !== "gpt-5.6-luna"
      || report.requested_effort !== "low" || report.reasoning_effort !== "low"
      || report.image_detail !== "high" || report.rows?.length !== 1
      || report.contract_normalized_request_sha256 !== frozen.normalized_request_sha256
      || report.contract_normalized_request_bytes !== frozen.normalized_request_bytes
      || report.contract_wire_sha256 !== frozen.contract_wire_sha256
      || report.contract_wire_bytes !== frozen.contract_wire_bytes) {
    throw new Error(`compact_v4_endpoint_contract_invalid:${job.job_key}`);
  }
  const cloud = report.rows[0];
  const requestIdentityValue = requestIdentity(request);
  const providerRaw = parseCompactV4ProviderRaw(cloud?.provider_response_raw, job.arm);
  if (!cloud?.ok || cloud.asset_id !== job.asset_id
      || cloud.image_set_sha256 !== asset.image_set_sha256
      || cloud.provider_response_id !== providerRaw.responseId
      || cloud.served_model !== providerRaw.servedModel || cloud.requested_effort !== "low"
      || cloud.served_effort !== providerRaw.servedEffort
      || cloud.request_wire_sha256 !== requestIdentityValue.wire_sha256
      || cloud.request_wire_bytes !== requestIdentityValue.wire_bytes
      || cloud.normalized_request_sha256 !== requestIdentityValue.normalized_request_sha256
      || cloud.normalized_request_bytes !== requestIdentityValue.normalized_request_bytes
      || cloud.provider_response_sha256 !== sha256(cloud.provider_response_raw)
      || cloud.structured_output_raw_sha256 !== sha256(providerRaw.structuredRaw)
      || JSON.stringify(cloud.structured_output) !== JSON.stringify(providerRaw.structured)
      || Number(cloud.input_tokens) !== providerRaw.usage.input_tokens
      || Number(cloud.cached_input_tokens) !== providerRaw.usage.cached_input_tokens
      || Number(cloud.output_tokens) !== providerRaw.usage.output_tokens) {
    throw new Error(`compact_v4_response_identity_invalid:${job.job_key}`);
  }
  const raw = structuredClone(providerRaw.structured);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`compact_v4_envelope_invalid:${job.job_key}`);
  }
  const phrase = job.arm === "treatment" ? raw.residual_printed_phrase : null;
  const canonicalPayload = structuredClone(raw);
  delete canonicalPayload.residual_printed_phrase;
  const canonical = finishCanonicalTitle(JSON.stringify(canonicalPayload),
    { exactParallelColorCompaction: false });
  const inference = job.arm === "treatment"
    ? inferModelResidualSinglePrintedPhraseRouteV4(phrase,
      { canonicalFields: canonical.fields }) : null;
  const candidates = job.arm === "treatment" && !inference.ambiguous
    ? inflateModelResidualSinglePrintedPhraseV4(phrase,
      { canonicalFields: canonical.fields }) : [];
  const resolved = job.arm === "treatment"
    ? resolveModelResidualVisibleEvidenceV3(canonical.fields, candidates,
      { composerFeatures: FROZEN_COMPOSER_FEATURES }) : null;
  return {
    request_attempt_count: 1,
    request_sha256: requestIdentityValue.wire_sha256,
    request_wire_sha256: requestIdentityValue.wire_sha256,
    normalized_request_sha256: requestIdentityValue.normalized_request_sha256,
    semantic_request_sha256: semanticCompactV4RequestSha256(request),
    response_id: cloud.provider_response_id,
    provider_response_raw: cloud.provider_response_raw,
    provider_response_sha256: sha256(cloud.provider_response_raw),
    structured_output_raw_sha256: sha256(providerRaw.structuredRaw),
    structured_output_envelope_sha256: sha256(JSON.stringify(raw)),
    structured_output_envelope: raw,
    served_model: providerRaw.servedModel,
    requested_effort: cloud.requested_effort,
    served_effort: providerRaw.servedEffort,
    latency_ms: cloud.latency_ms,
    usage: providerRaw.usage,
    canonical_payload: canonicalPayload,
    canonical_fields: canonical.fields,
    canonical_title: canonical.title,
    canonical_field_defects: canonical.field_defects,
    residual_printed_phrase: phrase,
    residual_inference: inference,
    resolved,
    run_fingerprint: runFingerprint
  };
}

function validateComplete(record, job, state, payload, asset) {
  const result = record?.result;
  const request = requestForAsset(payload[job.arm].request_template, asset.image_urls);
  const providerRaw = parseCompactV4ProviderRaw(result?.provider_response_raw, job.arm);
  if (record?.state !== "COMPLETE" || record.attempt_count !== 1
      || result?.run_fingerprint !== state.run_fingerprint
      || result?.request_attempt_count !== 1
      || result?.request_sha256 !== requestIdentity(request).wire_sha256
      || result?.request_wire_sha256 !== requestIdentity(request).wire_sha256
      || result?.normalized_request_sha256 !== requestIdentity(request).normalized_request_sha256
      || result?.semantic_request_sha256 !== semanticCompactV4RequestSha256(request)
      || result?.response_id !== providerRaw.responseId
      || result.served_model !== providerRaw.servedModel
      || result.requested_effort !== "low" || result.served_effort !== providerRaw.servedEffort
      || result.provider_response_sha256 !== sha256(result.provider_response_raw)
      || result.structured_output_raw_sha256 !== sha256(providerRaw.structuredRaw)
      || JSON.stringify(result.structured_output_envelope)
        !== JSON.stringify(providerRaw.structured)
      || JSON.stringify(result.usage) !== JSON.stringify(providerRaw.usage)
      || result.structured_output_envelope_sha256
        !== sha256(JSON.stringify(result.structured_output_envelope))) {
    throw new Error(`compact_v4_complete_checkpoint_invalid:${job.job_key}`);
  }
  const raw = structuredClone(result.structured_output_envelope);
  const phrase = job.arm === "treatment" ? raw.residual_printed_phrase : null;
  const canonicalPayload = structuredClone(raw);
  delete canonicalPayload.residual_printed_phrase;
  const canonical = finishCanonicalTitle(JSON.stringify(canonicalPayload),
    { exactParallelColorCompaction: false });
  const inference = job.arm === "treatment"
    ? inferModelResidualSinglePrintedPhraseRouteV4(phrase,
      { canonicalFields: canonical.fields }) : null;
  const candidates = job.arm === "treatment" && !inference.ambiguous
    ? inflateModelResidualSinglePrintedPhraseV4(phrase,
      { canonicalFields: canonical.fields }) : [];
  const resolved = job.arm === "treatment"
    ? resolveModelResidualVisibleEvidenceV3(canonical.fields, candidates,
      { composerFeatures: FROZEN_COMPOSER_FEATURES }) : null;
  for (const [actual, expected] of [
    [result.canonical_payload, canonicalPayload],
    [result.canonical_fields, canonical.fields],
    [result.canonical_title, canonical.title],
    [result.canonical_field_defects, canonical.field_defects],
    [result.residual_printed_phrase, phrase],
    [result.residual_inference, inference],
    [result.resolved, resolved]
  ]) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`compact_v4_complete_checkpoint_replay_invalid:${job.job_key}`);
    }
  }
}

export async function runCloudResidualCompactV4({ prereg, payload, manifest, labelRefReceipt,
  deploymentReceipt, deployment, outPath, runId, dryRun = false, authorization = null,
  runToken, invoke = invokePreview, nowMs = () => Date.now(), sourceState = null,
  checkpointIo = undefined }) {
  const origin = deploymentOrigin(deployment);
  const verifiedSourceState = sourceState || await cleanCommittedSourceState(REPOSITORY_ROOT);
  const validated = validateInputs({ prereg, payload, manifest, labelRefReceipt,
    deploymentReceipt, origin, nowMs: nowMs(), sourceState: verifiedSourceState });
  const fingerprintValue = {
    schema_version: "cloud-residual-compact-v4-run-contract-v1",
    origin, run_id: runId,
    prereg_sha256: sha256(JSON.stringify(prereg)),
    payload_sha256: sha256(JSON.stringify(payload)),
    physical_manifest_sha256: sha256(JSON.stringify(manifest)),
    label_ref_receipt_sha256: sha256(JSON.stringify(labelRefReceipt)),
    deployment_receipt_sha256: sha256(JSON.stringify(deploymentReceipt)),
    jobs_sha256: sha256(JSON.stringify(validated.jobs)),
    contracts: validated.contracts,
    concurrency: CONCURRENCY, max_provider_attempts: EXPECTED_JOBS, retries: 0,
    earliest_signed_url_expiry_ms: validated.earliestExpiryMs,
    minimum_remaining_ttl_ms: payload.minimum_remaining_ttl_ms,
    ordered_signed_urls_sha256: payload.ordered_signed_urls_sha256,
    materialization_byte_receipts_sha256:
      payload.materialization_byte_receipts_sha256
  };
  const runFingerprint = sha256(JSON.stringify(fingerprintValue));
  const existing = await readJson(outPath);
  if (existing) assertNoLabels(existing, "checkpoint");
  const initialJobs = Object.fromEntries(validated.jobs.map((job) => [job.job_key,
    { ...job, image_set_sha256: validated.assetsById.get(job.asset_id).image_set_sha256,
      state: "PENDING" }]));
  const state = existing || { ...fingerprintValue, run_fingerprint: runFingerprint,
    state: "READY", provider_attempts: 0, provider_calls: 0, provider_retries: 0,
    single_job_minimum_ttl_ms: SINGLE_JOB_MINIMUM_TTL_MS,
    sealed_labels_accessed_during_execution: false, jobs: initialJobs };
  if (state.run_fingerprint !== runFingerprint) {
    throw new Error("compact_v4_checkpoint_fingerprint_mismatch");
  }
  const attempts = Object.values(state.jobs).filter((job) =>
    ["ATTEMPTED", "COMPLETE", "FAILED"].includes(job.state)).length;
  const completed = Object.values(state.jobs).filter((job) => job.state === "COMPLETE").length;
  if (attempts !== state.provider_attempts || completed !== state.provider_calls
      || attempts > EXPECTED_JOBS || completed > attempts || state.provider_retries !== 0) {
    throw new Error("compact_v4_checkpoint_attempt_ledger_invalid");
  }
  const write = durableJsonWriter(outPath, checkpointIo ? { io: checkpointIo } : {});
  const release = await acquireCheckpointLock(outPath);
  try {
    if (dryRun) {
      const first = validated.assetsById.get(validated.jobs[0].asset_id);
      const receipts = [];
      for (const arm of ["control", "treatment"]) {
        const armRunId = `${runId}.preflight.${arm}`;
        const report = await invoke({ deployment: origin, runToken, body: {
          arm_id: payload[arm].arm_id, run_id: armRunId,
          request_template: payload[arm].request_template, assets: [providerAsset(first)], concurrency: 1,
          dry_run: true
        } });
        const frozen = FROZEN_REQUEST_CONTRACTS[payload[arm].arm_id];
        if (!report?.ok || report.provider_calls !== 0 || report.provider_retries !== 0
            || report.arm_id !== payload[arm].arm_id || report.run_id !== armRunId
            || report.environment !== "preview" || report.region !== "sin1"
            || report.deployment_id !== deploymentReceipt.deployment_id
            || report.deployment_hostname !== deploymentReceipt.deployment_hostname
            || report.release_git_sha !== deploymentReceipt.source_git_sha
            || report.storage_host !== STORAGE_HOST || report.model !== "gpt-5.6-luna"
            || report.reasoning_effort !== "low" || report.requested_effort !== "low"
            || report.image_detail !== "high"
            || report.contract_normalized_request_sha256 !== frozen.normalized_request_sha256
            || report.contract_normalized_request_bytes !== frozen.normalized_request_bytes
            || report.contract_wire_sha256 !== frozen.contract_wire_sha256
            || report.contract_wire_bytes !== frozen.contract_wire_bytes) {
          throw new Error(`compact_v4_preflight_failed:${arm}`);
        }
        receipts.push({ arm, arm_id: report.arm_id, run_id: report.run_id,
          deployment_id: report.deployment_id, deployment_hostname: report.deployment_hostname,
          release_git_sha: report.release_git_sha,
          request_template_sha256: report.request_template_sha256,
          contract_normalized_request_sha256: report.contract_normalized_request_sha256,
          contract_normalized_request_bytes: report.contract_normalized_request_bytes,
          contract_wire_sha256: report.contract_wire_sha256,
          contract_wire_bytes: report.contract_wire_bytes,
          provider_calls: report.provider_calls, provider_retries: report.provider_retries });
      }
      state.state = "PREFLIGHT_COMPLETE";
      state.preflight_provider_calls = 0;
      state.preflight_receipt = {
        schema_version: "cloud-residual-compact-v4-preflight-receipt-v1",
        run_fingerprint: state.run_fingerprint,
        payload_sha256: state.payload_sha256,
        deployment_receipt_sha256: state.deployment_receipt_sha256,
        provider_attempts: 0, provider_calls: 0, provider_retries: 0,
        arms: receipts
      };
      state.preflight_receipt_sha256 = sha256(JSON.stringify(state.preflight_receipt));
      await write(state);
      return state;
    }
    assertCompactV4PreflightReceipt(state);
    if (state.state === "PREFLIGHT_COMPLETE") {
      if (state.provider_attempts !== 0 || state.provider_calls !== 0 || state.provider_retries !== 0) {
        throw new Error("compact_v4_preflight_zero_ledger_required");
      }
    } else if (!["RUNNING", "COMPLETE"].includes(state.state)) {
      throw new Error("compact_v4_preflight_required");
    }
    const requiredAuthorization = {
      schema_version: "model-residual-compact-v4-paid105-authorization-v1",
      execution_surface: "vercel_preview_only",
      authorized: true,
      approval_ref: "user-explicit-approval-2026-08-09-reuse-existing-key",
      prereg_sha256: fingerprintValue.prereg_sha256,
      payload_sha256: fingerprintValue.payload_sha256,
      physical_manifest_sha256: fingerprintValue.physical_manifest_sha256,
      label_ref_receipt_sha256: fingerprintValue.label_ref_receipt_sha256,
      sealed_labels_sha256: labelRefReceipt.sealed_labels_sha256,
      deployment_receipt_sha256: fingerprintValue.deployment_receipt_sha256,
      materialization_byte_receipts_sha256:
        fingerprintValue.materialization_byte_receipts_sha256,
      preflight_receipt_sha256: state.preflight_receipt_sha256,
      run_id: runId,
      run_fingerprint: runFingerprint,
      max_provider_attempts: EXPECTED_JOBS,
      zero_call_title_fidelity: "35/35",
      zero_call_field_fidelity: "35/35"
    };
    if (!authorization || !exactKeys(authorization, Object.keys(requiredAuthorization))
        || Object.entries(requiredAuthorization).some(([key, value]) => authorization[key] !== value)) {
      throw new Error("compact_v4_independent_authorization_required");
    }
    assertNoLabels(authorization, "authorization");
    const authorizationSha = sha256(JSON.stringify(authorization));
    if (state.authorization_receipt_sha256
        && state.authorization_receipt_sha256 !== authorizationSha) {
      throw new Error("compact_v4_authorization_receipt_changed");
    }
    state.authorization_receipt_sha256 = authorizationSha;
    if (Object.values(state.jobs).some((job) => ["ATTEMPTED", "FAILED"].includes(job.state))) {
      throw new Error("compact_v4_unretryable_prior_attempt_requires_stop");
    }
    const responseIds = new Set();
    for (const job of validated.jobs) {
      const record = state.jobs[job.job_key];
      if (!record || record.asset_id !== job.asset_id || record.arm !== job.arm) {
        throw new Error(`compact_v4_checkpoint_job_identity_invalid:${job.job_key}`);
      }
      if (record.state === "COMPLETE") {
        validateComplete(record, job, state, payload, validated.assetsById.get(job.asset_id));
        if (responseIds.has(record.result.response_id)) {
          throw new Error("compact_v4_response_id_duplicate");
        }
        responseIds.add(record.result.response_id);
      }
    }
    for (const [index, job] of validated.jobs.entries()) {
      const record = state.jobs[job.job_key];
      if (record.state === "COMPLETE") continue;
      if (state.provider_attempts >= EXPECTED_JOBS) {
        throw new Error("compact_v4_cumulative_attempt_cap_reached");
      }
      const asset = validated.assetsById.get(job.asset_id);
      const remainingTtl = Math.min(...asset.image_urls.map(signedExpiryMs)) - nowMs();
      if (remainingTtl < SINGLE_JOB_MINIMUM_TTL_MS) {
        throw new Error(`compact_v4_job_signed_url_ttl_insufficient:${job.job_key}`);
      }
      const jobRunId = `${runId}.${String(index + 1).padStart(3, "0")}`;
      record.state = "ATTEMPTED"; record.attempt_count = 1;
      record.job_run_id = jobRunId;
      record.authorization_receipt_sha256 = authorizationSha;
      state.provider_attempts += 1; state.state = "RUNNING";
      await write(state);
      try {
        const request = requestForAsset(payload[job.arm].request_template, asset.image_urls);
        const report = await invoke({ deployment: origin, runToken, body: {
          arm_id: payload[job.arm].arm_id, run_id: jobRunId,
          request_template: payload[job.arm].request_template, assets: [providerAsset(asset)], concurrency: 1,
          dry_run: false
        } });
        record.result = resultEnvelope(report, job, asset, request, runFingerprint, origin,
          deploymentReceipt, jobRunId);
        if (responseIds.has(record.result.response_id)) throw new Error("compact_v4_response_id_reused");
        responseIds.add(record.result.response_id);
        record.state = "COMPLETE"; state.provider_calls += 1;
      } catch (error) {
        record.state = "FAILED";
        record.error = clean(error?.message || "compact_v4_attempt_failed").slice(0, 240);
        await write(state);
        throw error;
      }
      await write(state);
    }
    state.state = Object.values(state.jobs).every((job) => job.state === "COMPLETE")
      ? "COMPLETE" : "STOPPED";
    await write(state);
    return state;
  } finally {
    await release();
  }
}

function argument(argv, name) {
  const index = argv.indexOf(name); return index < 0 ? "" : clean(argv[index + 1]);
}

export async function main(argv = process.argv.slice(2)) {
  const required = ["--prereg", "--payload", "--assets-manifest", "--label-ref-receipt",
    "--deployment-receipt", "--deployment", "--out", "--run-id"];
  if (required.some((name) => !argument(argv, name))) {
    throw new Error("compact_v4_cloud_required_path_missing");
  }
  const authorizationPath = argument(argv, "--authorization");
  return runCloudResidualCompactV4({
    prereg: await json(argument(argv, "--prereg")),
    payload: await json(argument(argv, "--payload")),
    manifest: await json(argument(argv, "--assets-manifest")),
    labelRefReceipt: await json(argument(argv, "--label-ref-receipt")),
    deploymentReceipt: await json(argument(argv, "--deployment-receipt")),
    deployment: argument(argv, "--deployment"), outPath: resolve(argument(argv, "--out")),
    runId: argument(argv, "--run-id"), dryRun: argv.includes("--dry-run"),
    authorization: authorizationPath ? await json(authorizationPath) : null,
    runToken: await runTokenFromKeychain()
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((state) => process.stdout.write(`${JSON.stringify({ state: state.state,
    provider_attempts: state.provider_attempts, provider_calls: state.provider_calls,
    provider_retries: state.provider_retries })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
