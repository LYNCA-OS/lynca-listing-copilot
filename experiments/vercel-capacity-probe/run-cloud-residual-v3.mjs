#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { finishCanonicalTitle } from "../../lib/listing/thin/thin-listing-path.mjs";
import { captureModelResidualCandidatesV3, splitModelResidualCandidateEnvelopeV3 }
  from "../accuracy/model-residual-candidate-lane-v3.mjs";
import { resolveModelResidualVisibleEvidenceV3 }
  from "../accuracy/model-residual-visible-evidence-v3.mjs";
import { assertScreenSchedule, semanticRequestSha256 } from "../accuracy/model-residual-v3-screen-plan.mjs";
import { acquireCheckpointLock, deploymentOrigin, durableJsonWriter, invokePreview, readJson,
  runTokenFromKeychain } from "./cloud-io.mjs";
import { ARM_REQUEST_SPECS, FROZEN_REQUEST_CONTRACTS, requestForAsset, requestIdentity, sha256 }
  from "./request-contract.mjs";

const ARMS = Object.freeze(["control_a", "control_b", "residual_c"]);
const MAX_PROVIDER_ATTEMPTS = 105;
const CONCURRENCY = 1;
const FROZEN_STORAGE_HOST = "irpgnhkslrsiucybkufc.supabase.co";
const DEFAULT_MINIMUM_TTL_MS = 3 * 60 * 60 * 1000;
const SINGLE_JOB_TIMEOUT_MS = 150 * 1000;
const SINGLE_JOB_TTL_SAFETY_MS = 30 * 1000;
const SINGLE_JOB_MINIMUM_TTL_MS = SINGLE_JOB_TIMEOUT_MS + SINGLE_JOB_TTL_SAFETY_MS;
const FORBIDDEN_EXECUTION_KEYS = new Set([
  "reviewed_title", "reference_title", "ground_truth", "sealed_labels", "labels", "label",
  "sealed_eval_label_ref", "expected_title", "scorer_reference"
]);

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const clean = (value) => String(value ?? "").trim();
const exactKeys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");

function assertNoExecutionLabels(value, path = "prereg") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_EXECUTION_KEYS.has(key.toLowerCase())) {
      throw new Error(`v3_cloud_forbidden_execution_key:${path}.${key}`);
    }
    assertNoExecutionLabels(nested, `${path}.${key}`);
  }
}

function executionPreregProjection(prereg) {
  assertNoExecutionLabels(prereg);
  if (prereg?.design?.planned_provider_calls !== MAX_PROVIDER_ATTEMPTS
    || !Array.isArray(prereg?.cohort) || prereg.cohort.length !== 35
    || !/^[0-9a-f]{64}$/.test(String(prereg?.frozen_contract?.control_request_sha256 || ""))
    || !/^[0-9a-f]{64}$/.test(String(prereg?.frozen_contract?.residual_request_sha256 || ""))
    || !/^[0-9a-f]{64}$/.test(String(prereg?.analysis_inputs?.sealed_labels_sha256 || ""))) {
    throw new Error("v3_cloud_prereg_invalid");
  }
  return {
    design: { planned_provider_calls: prereg.design.planned_provider_calls },
    frozen_contract: {
      control_request_sha256: prereg.frozen_contract.control_request_sha256,
      residual_request_sha256: prereg.frozen_contract.residual_request_sha256
    },
    analysis_inputs: { sealed_labels_sha256: prereg.analysis_inputs.sealed_labels_sha256 },
    cohort: prereg.cohort.map((card) => ({ asset_id: card.asset_id,
      image_set_sha256: card.image_set_sha256, order: structuredClone(card.order) }))
  };
}

function assertFrozenTemplate(arm, template) {
  const spec = ARM_REQUEST_SPECS[arm]; const frozen = FROZEN_REQUEST_CONTRACTS[arm];
  if (!spec || !frozen || template?.model !== "gpt-5.6-luna"
    || template?.reasoning?.effort !== spec.effort
    || template?.max_output_tokens !== spec.max_output_tokens
    || template?.text?.format?.name !== spec.format_name) throw new Error(`v3_cloud_template_shape_invalid:${arm}`);
  const identity = requestIdentity(requestForAsset(template,
    ["https://contract.invalid/front", "https://contract.invalid/back"]));
  if (identity.normalized_request_sha256 !== frozen.normalized_request_sha256
    || identity.normalized_request_bytes !== frozen.normalized_request_bytes
    || identity.wire_sha256 !== frozen.contract_wire_sha256
    || identity.wire_bytes !== frozen.contract_wire_bytes) throw new Error(`v3_cloud_template_not_frozen:${arm}`);
  return identity;
}

function signedExpiryMs(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || parsed.hostname !== FROZEN_STORAGE_HOST
    || !parsed.pathname.startsWith("/storage/v1/object/sign/")) throw new Error("v3_cloud_signed_url_invalid");
  const part = parsed.searchParams.get("token")?.split(".")?.[1];
  if (!part) throw new Error("v3_cloud_signed_url_token_missing");
  let claims;
  try { claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")); }
  catch { throw new Error("v3_cloud_signed_url_token_invalid"); }
  if (!Number.isInteger(claims?.exp)) throw new Error("v3_cloud_signed_url_expiry_missing");
  return claims.exp * 1000;
}

function validateInputs(prereg, payload, nowMs) {
  const executionPrereg = executionPreregProjection(prereg);
  assertScreenSchedule(executionPrereg.cohort);
  if (!exactKeys(payload, ["schema_version", "materialized_at", "minimum_remaining_ttl_ms",
    "ordered_signed_urls_sha256", ...ARMS])
    || payload.schema_version !== "cloud-residual-v3-materialized-payload-v1") {
    throw new Error("v3_cloud_payload_shape_invalid");
  }
  const contracts = {};
  for (const arm of ARMS) {
    if (!exactKeys(payload[arm], ["arm_id", "request_template", "assets"])
      || payload[arm].arm_id !== arm) throw new Error(`v3_cloud_arm_shape_invalid:${arm}`);
    contracts[arm] = assertFrozenTemplate(arm, payload[arm].request_template);
  }
  if (JSON.stringify(payload.control_a.request_template) !== JSON.stringify(payload.control_b.request_template)) {
    throw new Error("v3_cloud_controls_not_byte_identical");
  }
  const semanticRequests = {
    control_a: semanticRequestSha256(requestForAsset(payload.control_a.request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"])),
    control_b: semanticRequestSha256(requestForAsset(payload.control_b.request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"])),
    residual_c: semanticRequestSha256(requestForAsset(payload.residual_c.request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"]))
  };
  if (semanticRequests.control_a !== executionPrereg.frozen_contract.control_request_sha256
    || semanticRequests.control_b !== executionPrereg.frozen_contract.control_request_sha256
    || semanticRequests.residual_c !== executionPrereg.frozen_contract.residual_request_sha256) {
    throw new Error("v3_cloud_preregistered_semantic_request_mismatch");
  }
  const assets = payload.control_a.assets;
  if (!Array.isArray(assets) || assets.length !== 35) throw new Error("v3_cloud_assets_invalid");
  for (const arm of ARMS.slice(1)) {
    if (JSON.stringify(payload[arm].assets) !== JSON.stringify(assets)) throw new Error("v3_cloud_assets_not_identical");
  }
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  if (byId.size !== 35) throw new Error("v3_cloud_asset_duplicate");
  for (const asset of assets) {
    if (!exactKeys(asset, ["asset_id", "image_set_sha256", "image_urls"])) {
      throw new Error(`v3_cloud_asset_shape_invalid:${asset?.asset_id || "missing"}`);
    }
  }
  for (const card of executionPrereg.cohort) {
    const asset = byId.get(card.asset_id);
    if (!asset || asset.image_set_sha256 !== card.image_set_sha256) {
      throw new Error(`v3_cloud_preregistered_asset_mismatch:${card.asset_id}`);
    }
  }
  const expiry = [];
  for (const asset of assets) {
    if (!Array.isArray(asset.image_urls) || asset.image_urls.length !== 2) {
      throw new Error(`v3_cloud_image_count_invalid:${asset.asset_id}`);
    }
    asset.image_urls.forEach((url) => expiry.push(signedExpiryMs(url)));
  }
  const earliestExpiryMs = Math.min(...expiry);
  const minimumTtlMs = Number(payload.minimum_remaining_ttl_ms || DEFAULT_MINIMUM_TTL_MS);
  if (!Number.isInteger(minimumTtlMs) || minimumTtlMs < DEFAULT_MINIMUM_TTL_MS
    || earliestExpiryMs - nowMs < minimumTtlMs) throw new Error("v3_cloud_materialized_payload_ttl_insufficient");
  if (!payload.materialized_at || !/^[0-9a-f]{64}$/.test(String(payload.ordered_signed_urls_sha256 || ""))) {
    throw new Error("v3_cloud_materialized_payload_receipt_missing");
  }
  const actualUrlSha = sha256(JSON.stringify(assets.map((asset) => asset.image_urls)));
  if (actualUrlSha !== payload.ordered_signed_urls_sha256) throw new Error("v3_cloud_materialized_url_hash_mismatch");
  return { executionPrereg, assetsById: byId, contracts, semanticRequests,
    earliestExpiryMs, minimumTtlMs };
}

function jobsFrom(prereg) {
  const jobs = prereg.cohort.flatMap((card) => card.order.map((arm) => ({
    job_key: `${card.asset_id}:${arm}`, asset_id: card.asset_id,
    image_set_sha256: card.image_set_sha256, arm
  })));
  if (jobs.length !== MAX_PROVIDER_ATTEMPTS || new Set(jobs.map((job) => job.job_key)).size !== jobs.length) {
    throw new Error("v3_cloud_job_schedule_invalid");
  }
  return jobs;
}

function completedEnvelope(report, job, runFingerprint,
  { origin, jobRunId, expectedRequest, semanticRequestSha }) {
  const hostname = new URL(origin).hostname;
  if (report?.provider_calls !== 1 || report?.provider_retries !== 0
    || report?.arm_id !== job.arm || report?.run_id !== jobRunId || report?.rows?.length !== 1
    || report?.environment !== "preview" || report?.region !== "sin1"
    || report?.deployment_hostname !== hostname
    || report?.storage_host !== FROZEN_STORAGE_HOST
    || report?.model !== "gpt-5.6-luna" || report?.reasoning_effort !== "low"
    || report?.requested_effort !== "low"
    || report?.image_detail !== "high") {
    throw new Error(`v3_cloud_endpoint_contract_invalid:${job.job_key}`);
  }
  const cloud = report.rows[0];
  if (!report.ok || !cloud.ok || cloud.asset_id !== job.asset_id
    || cloud.image_set_sha256 !== job.image_set_sha256) {
    throw new Error(`v3_cloud_endpoint_job_failed:${job.job_key}`);
  }
  const frozen = FROZEN_REQUEST_CONTRACTS[job.arm];
  if (report.contract_normalized_request_sha256 !== frozen.normalized_request_sha256
    || report.contract_normalized_request_bytes !== frozen.normalized_request_bytes
    || report.contract_wire_sha256 !== frozen.contract_wire_sha256
    || report.contract_wire_bytes !== frozen.contract_wire_bytes
    || cloud.normalized_request_sha256 !== expectedRequest.normalized_request_sha256
    || cloud.normalized_request_bytes !== expectedRequest.normalized_request_bytes
    || cloud.request_wire_sha256 !== expectedRequest.wire_sha256
    || cloud.request_wire_bytes !== expectedRequest.wire_bytes
    || !clean(cloud.provider_response_id)
    || cloud.served_model !== "gpt-5.6-luna" || cloud.requested_effort !== "low"
    || cloud.served_effort !== "low") {
    throw new Error(`v3_cloud_response_identity_invalid:${job.job_key}`);
  }
  const raw = cloud.structured_output;
  const envelope = job.arm === "residual_c" ? splitModelResidualCandidateEnvelopeV3(raw)
    : { canonical_payload: structuredClone(raw), candidate_source: null, defect: null };
  if (envelope.defect || !envelope.canonical_payload) throw new Error(`v3_cloud_envelope_invalid:${job.job_key}`);
  const canonical = finishCanonicalTitle(JSON.stringify(envelope.canonical_payload));
  const candidateCapture = job.arm === "residual_c"
    ? captureModelResidualCandidatesV3(raw, { canonicalFields: canonical.fields }) : null;
  const resolved = job.arm === "residual_c"
    ? resolveModelResidualVisibleEvidenceV3(canonical.fields, candidateCapture.candidates) : null;
  return {
    request_attempt_count: 1,
    request_sha256: expectedRequest.wire_sha256,
    semantic_request_sha256: semanticRequestSha,
    normalized_request_sha256: cloud.normalized_request_sha256,
    request_wire_sha256: cloud.request_wire_sha256,
    response_id: cloud.provider_response_id,
    provider_response_sha256: cloud.provider_response_sha256,
    structured_output_raw_sha256: cloud.structured_output_raw_sha256,
    structured_output_envelope_sha256: sha256(JSON.stringify(raw)),
    structured_output_envelope: structuredClone(raw),
    served_model: cloud.served_model,
    requested_effort: cloud.requested_effort,
    served_effort: cloud.served_effort,
    latency_ms: cloud.latency_ms,
    usage: { input_tokens: cloud.input_tokens, cached_input_tokens: cloud.cached_input_tokens,
      output_tokens: cloud.output_tokens },
    canonical_payload: envelope.canonical_payload,
    canonical_fields: canonical.fields,
    canonical_title: canonical.title,
    canonical_field_defects: canonical.field_defects,
    candidate_capture: candidateCapture,
    resolved,
    run_fingerprint: runFingerprint
  };
}

function assertCompletedRecord(record, job, runFingerprint,
  { asset, semanticRequestSha, requestTemplate, expectedJobRunId }) {
  const expectedRequest = requestIdentity(requestForAsset(
    requestTemplate, asset.image_urls));
  const result = record?.result;
  if (record?.job_key !== job.job_key || record?.asset_id !== job.asset_id
    || record?.image_set_sha256 !== job.image_set_sha256 || record?.arm !== job.arm
    || record?.state !== "COMPLETE" || record?.attempt_count !== 1
    || record?.job_run_id !== expectedJobRunId
    || result?.request_attempt_count !== 1 || result?.run_fingerprint !== runFingerprint
    || result?.semantic_request_sha256 !== semanticRequestSha
    || result?.request_sha256 !== expectedRequest.wire_sha256
    || result?.request_wire_sha256 !== expectedRequest.wire_sha256
    || result?.normalized_request_sha256 !== expectedRequest.normalized_request_sha256
    || !clean(result?.response_id) || result?.served_model !== "gpt-5.6-luna"
    || result?.requested_effort !== "low" || result?.served_effort !== "low"
    || !/^[0-9a-f]{64}$/.test(String(result?.provider_response_sha256 || ""))
    || !/^[0-9a-f]{64}$/.test(String(result?.structured_output_raw_sha256 || ""))
    || !/^[0-9a-f]{64}$/.test(String(result?.structured_output_envelope_sha256 || ""))
    || result.structured_output_envelope_sha256
      !== sha256(JSON.stringify(result?.structured_output_envelope))) {
    throw new Error(`v3_cloud_complete_checkpoint_identity_invalid:${job.job_key}`);
  }
  const raw = result.structured_output_envelope;
  const envelope = job.arm === "residual_c" ? splitModelResidualCandidateEnvelopeV3(raw)
    : { canonical_payload: structuredClone(raw), candidate_source: null, defect: null };
  if (envelope.defect || !envelope.canonical_payload) {
    throw new Error(`v3_cloud_complete_checkpoint_envelope_invalid:${job.job_key}`);
  }
  const canonical = finishCanonicalTitle(JSON.stringify(envelope.canonical_payload));
  const capture = job.arm === "residual_c"
    ? captureModelResidualCandidatesV3(raw, { canonicalFields: canonical.fields }) : null;
  const resolved = job.arm === "residual_c"
    ? resolveModelResidualVisibleEvidenceV3(canonical.fields, capture.candidates) : null;
  for (const [name, actual, expected] of [
    ["canonical_payload", result.canonical_payload, envelope.canonical_payload],
    ["canonical_fields", result.canonical_fields, canonical.fields],
    ["canonical_title", result.canonical_title, canonical.title],
    ["canonical_field_defects", result.canonical_field_defects, canonical.field_defects],
    ["candidate_capture", result.candidate_capture, capture],
    ["resolved", result.resolved, resolved]
  ]) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`v3_cloud_complete_checkpoint_${name}_invalid:${job.job_key}`);
    }
  }
}

export async function runCloudResidualV3({ prereg, payload, deployment, outPath, runId,
  dryRun = false, runToken, authorization = null, invoke = invokePreview, nowMs = () => Date.now() }) {
  const origin = deploymentOrigin(deployment);
  const { executionPrereg, assetsById, contracts, semanticRequests, earliestExpiryMs, minimumTtlMs }
    = validateInputs(prereg, payload, nowMs());
  const jobs = jobsFrom(executionPrereg);
  const fingerprintValue = { schema_version: "cloud-residual-v3-run-contract-v1", origin, runId,
    prereg_sha256: sha256(JSON.stringify(prereg)), payload_sha256: sha256(JSON.stringify(payload)),
    jobs_sha256: sha256(JSON.stringify(jobs)), contracts, concurrency: CONCURRENCY,
    max_provider_attempts: MAX_PROVIDER_ATTEMPTS, retries: 0, earliest_signed_url_expiry_ms: earliestExpiryMs,
    minimum_remaining_ttl_ms: minimumTtlMs, ordered_signed_urls_sha256: payload.ordered_signed_urls_sha256 };
  const runFingerprint = sha256(JSON.stringify(fingerprintValue));
  const existing = await readJson(outPath);
  if (existing) assertNoExecutionLabels(existing, "checkpoint");
  let state = existing || { ...fingerprintValue, run_fingerprint: runFingerprint,
    state: "READY", provider_attempts: 0, provider_calls: 0, provider_retries: 0,
    single_job_minimum_ttl_ms: SINGLE_JOB_MINIMUM_TTL_MS,
    sealed_labels_accessed_during_execution: false,
    jobs: Object.fromEntries(jobs.map((job) => [job.job_key, { ...job, state: "PENDING" }])) };
  if (state.run_fingerprint !== runFingerprint) throw new Error("v3_cloud_checkpoint_fingerprint_mismatch");
  const attemptedStates = Object.values(state.jobs).filter((job) =>
    ["ATTEMPTED", "COMPLETE", "FAILED"].includes(job.state)).length;
  const completeStates = Object.values(state.jobs).filter((job) => job.state === "COMPLETE").length;
  if (Object.keys(state.jobs).sort().join("\0")
    !== jobs.map((job) => job.job_key).sort().join("\0")) {
    throw new Error("v3_cloud_checkpoint_job_set_invalid");
  }
  if (state.provider_attempts !== attemptedStates || state.provider_attempts > MAX_PROVIDER_ATTEMPTS
    || state.provider_calls !== completeStates || state.provider_calls > state.provider_attempts
    || state.provider_retries !== 0) throw new Error("v3_cloud_checkpoint_attempt_ledger_invalid");
  const write = durableJsonWriter(outPath);
  const release = await acquireCheckpointLock(outPath);
  try {
    if (dryRun) {
      for (const arm of ARMS) {
        const asset = assetsById.get(executionPrereg.cohort[0].asset_id);
        const report = await invoke({ deployment: origin, runToken, body: { arm_id: arm,
          run_id: runId, request_template: payload[arm].request_template, assets: [asset],
          concurrency: 1, dry_run: true } });
        if (!report?.ok || report.provider_calls !== 0 || report.provider_retries !== 0) {
          throw new Error(`v3_cloud_preflight_failed:${arm}`);
        }
      }
      state.state = "PREFLIGHT_COMPLETE"; state.preflight_provider_calls = 0;
      await write(state); return state;
    }
    const requiredAuthorization = {
      schema_version: "model-residual-v3-paid105-authorization-v1",
      execution_surface: "vercel_preview_only", authorized: true,
      prereg_sha256: fingerprintValue.prereg_sha256, payload_sha256: fingerprintValue.payload_sha256,
      sealed_labels_sha256: executionPrereg.analysis_inputs.sealed_labels_sha256,
      run_id: runId, deployment_hostname: new URL(origin).hostname,
      run_fingerprint: runFingerprint, max_provider_attempts: MAX_PROVIDER_ATTEMPTS
    };
    if (!authorization) throw new Error("v3_cloud_independent_authorization_required");
    assertNoExecutionLabels(authorization, "authorization");
    if (!exactKeys(authorization, Object.keys(requiredAuthorization)) || Object.entries(requiredAuthorization)
      .some(([key, value]) => authorization[key] !== value)) {
      throw new Error("v3_cloud_independent_authorization_required");
    }
    const authorizationReceiptSha = sha256(JSON.stringify(authorization));
    if (state.authorization_receipt_sha256
      && state.authorization_receipt_sha256 !== authorizationReceiptSha) {
      throw new Error("v3_cloud_authorization_receipt_changed");
    }
    state.authorization_receipt_sha256 = authorizationReceiptSha;
    if (state.state === "READY") throw new Error("v3_cloud_preflight_required");
    if (Object.values(state.jobs).some((job) => job.state === "ATTEMPTED" || job.state === "FAILED")) {
      throw new Error("v3_cloud_unretryable_prior_attempt_requires_stop");
    }
    const responseIds = new Set(Object.values(state.jobs).flatMap((job) =>
      job.state === "COMPLETE" && job.result?.response_id ? [job.result.response_id] : []));
    if (responseIds.size !== Object.values(state.jobs).filter((job) => job.state === "COMPLETE").length) {
      throw new Error("v3_cloud_checkpoint_response_id_duplicate");
    }
    for (const [jobIndex, job] of jobs.entries()) {
      const record = state.jobs[job.job_key];
      if (!record) throw new Error(`v3_cloud_checkpoint_job_missing:${job.job_key}`);
      if (record.job_key !== job.job_key || record.asset_id !== job.asset_id
        || record.image_set_sha256 !== job.image_set_sha256 || record.arm !== job.arm
        || !["PENDING", "COMPLETE", "ATTEMPTED", "FAILED"].includes(record.state)) {
        throw new Error(`v3_cloud_checkpoint_job_identity_invalid:${job.job_key}`);
      }
      if (record.state === "COMPLETE") assertCompletedRecord(record, job, runFingerprint, {
        asset: assetsById.get(job.asset_id), semanticRequestSha: semanticRequests[job.arm],
        requestTemplate: payload[job.arm].request_template,
        expectedJobRunId: `${runId}.${String(jobIndex + 1).padStart(3, "0")}`
      });
    }
    for (const [jobIndex, job] of jobs.entries()) {
      const record = state.jobs[job.job_key];
      if (record.state === "COMPLETE" || record.state === "FAILED" || record.state === "ATTEMPTED") continue;
      if (state.provider_attempts >= MAX_PROVIDER_ATTEMPTS) throw new Error("v3_cloud_cumulative_attempt_cap_reached");
      const asset = assetsById.get(job.asset_id);
      const remainingTtlMs = Math.min(...asset.image_urls.map(signedExpiryMs)) - nowMs();
      if (remainingTtlMs < SINGLE_JOB_MINIMUM_TTL_MS) {
        throw new Error(`v3_cloud_job_signed_url_ttl_insufficient:${job.job_key}`);
      }
      record.state = "ATTEMPTED"; record.attempt_count = 1;
      state.provider_attempts += 1; state.state = "RUNNING";
      await write(state);
      const jobRunId = `${runId}.${String(jobIndex + 1).padStart(3, "0")}`;
      record.job_run_id = jobRunId;
      try {
        const report = await invoke({ deployment: origin, runToken, body: { arm_id: job.arm,
          run_id: jobRunId, request_template: payload[job.arm].request_template, assets: [asset],
          concurrency: 1, dry_run: false } });
        const expectedRequest = requestIdentity(requestForAsset(payload[job.arm].request_template, asset.image_urls));
        record.result = completedEnvelope(report, job, runFingerprint,
          { origin, jobRunId, expectedRequest, semanticRequestSha: semanticRequests[job.arm] });
        if (responseIds.has(record.result.response_id)) throw new Error("v3_cloud_response_id_reused");
        responseIds.add(record.result.response_id);
        record.state = "COMPLETE"; state.provider_calls += 1;
      } catch (error) {
        record.state = "FAILED";
        record.error = String(error?.message || "v3_cloud_attempt_failed").slice(0, 240);
        await write(state);
        throw error;
      }
      await write(state);
    }
    state.state = Object.values(state.jobs).every((job) => job.state === "COMPLETE") ? "COMPLETE" : "STOPPED";
    await write(state); return state;
  } finally { await release(); }
}

function argument(argv, name, fallback = "") {
  const index = argv.indexOf(name); return index < 0 ? fallback : clean(argv[index + 1]);
}

export async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes("--dry-run");
  const preregValue = argument(argv, "--prereg"); const payloadValue = argument(argv, "--payload");
  const authorizationValue = argument(argv, "--authorization");
  const outValue = argument(argv, "--out");
  if (!preregValue || !payloadValue || !outValue) throw new Error("v3_cloud_required_path_missing");
  const preregPath = resolve(preregValue); const payloadPath = resolve(payloadValue); const outPath = resolve(outValue);
  return runCloudResidualV3({ prereg: await json(preregPath), payload: await json(payloadPath),
    deployment: argument(argv, "--deployment"), outPath, runId: argument(argv, "--run-id"),
    dryRun, authorization: authorizationValue ? await json(resolve(authorizationValue)) : null,
    runToken: await runTokenFromKeychain() });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((result) => process.stdout.write(`${JSON.stringify({ state: result.state,
    provider_attempts: result.provider_attempts, provider_calls: result.provider_calls })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
