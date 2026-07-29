import crypto from "node:crypto";

import { buildShadowOcrDetailSchedule } from "./shadow-ocr-detail-completion-snapshot.mjs";
import {
  bundlePatchesFromOcrResult,
  ocrRequestForPreingestionJob
} from "../preingestion/preingestion-ocr-worker.mjs";

// Evaluation-only transport adapter for the fastest no-full-Provider OCR
// shape. It does not claim durable jobs, persist patches, resolve identity or
// render a title. The existing per-field jobs remain the evidence owners; this
// packet only proves that one card's three required views crossed one external
// batch request with generation-bound provenance.
export const shadowOneShotOcrCardPacketVersion = "shadow-one-shot-ocr-card-packet-v1";

export const shadowOneShotOcrStatuses = Object.freeze({
  READY: "READY",
  COMPLETE: "COMPLETE",
  INCOMPLETE: "INCOMPLETE",
  STALE: "STALE",
  UNAVAILABLE: "UNAVAILABLE",
  MIXED_REVISION_NON_ONE_SHOT: "MIXED_REVISION_NON_ONE_SHOT"
});

const requiredViews = Object.freeze([
  Object.freeze({ role: "subject_crop", side: "front" }),
  Object.freeze({ role: "year_product_crop", side: "back" }),
  Object.freeze({ role: "card_code_crop", side: "back" })
]);

const allowedFieldsByRole = Object.freeze({
  subject_crop: new Set([
    "player",
    "players",
    "player_name",
    "player_names",
    "subject",
    "subject_name"
  ]),
  year_product_crop: new Set([
    "product",
    "product_text",
    "product_text_candidate",
    "year",
    "year_product",
    "year_product_candidate"
  ]),
  card_code_crop: new Set([
    "card_number",
    "checklist_code",
    "collector_number",
    "tcg_card_number"
  ])
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function cropForJob(job = {}) {
  return job.payload?.crop || {};
}

function cropMetadataForJob(job = {}) {
  return cropForJob(job).crop_metadata || {};
}

function cropRoleForJob(job = {}) {
  const crop = cropForJob(job);
  return cleanText(crop.role || crop.crop_metadata?.crop_role).toLowerCase();
}

function cropSideForJob(job = {}, imageSideById = new Map()) {
  const crop = cropForJob(job);
  const sourceImageId = cleanText(crop.source_image_id || crop.crop_metadata?.source_image_id);
  // Selection follows the canonical bundle image. Crop metadata is validated
  // separately below; allowing stale metadata to choose the side would hide a
  // lineage mismatch as a merely missing role.
  return imageSideById.get(sourceImageId) || "";
}

function imageSide(image = {}) {
  const value = cleanText(image.role || image.storage_role || image.image_role).toLowerCase();
  if (value.includes("front")) return "front";
  if (value.includes("back")) return "back";
  return "";
}

function imageId(image = {}) {
  return cleanText(image.image_id || image.derived_id || image.id);
}

function imageSha(image = {}) {
  return cleanText(image.content_sha256 || image.sha256).toLowerCase();
}

function imagePath(image = {}) {
  return cleanText(image.object_path || image.storage_path);
}

function sourceDescriptor(job = {}, imageById = new Map()) {
  const crop = cropForJob(job);
  const metadata = cropMetadataForJob(job);
  const cropSourceImageId = cleanText(crop.source_image_id);
  const metadataSourceImageId = cleanText(metadata.source_image_id);
  const sourceImageId = cropSourceImageId || metadataSourceImageId;
  const image = imageById.get(sourceImageId) || {};
  return {
    image_id: sourceImageId || null,
    side: imageSide(image) || null,
    object_path: imagePath(image) || null,
    content_sha256: imageSha(image) || null,
    crop_id: cleanText(metadata.crop_id || crop.source_region) || null,
    crop_role: cropRoleForJob(job),
    crop_box: metadata.pixel_bounds || metadata.normalized_bounds || crop.crop_region || null,
    lineage: {
      crop_source_image_id: cropSourceImageId || null,
      metadata_source_image_id: metadataSourceImageId || null,
      metadata_source_side: cleanText(metadata.source_side).toLowerCase() || null,
      metadata_source_object_path: cleanText(metadata.source_object_path) || null,
      metadata_source_content_sha256: cleanText(metadata.source_content_sha256).toLowerCase() || null
    }
  };
}

function uniqueReasons(reasons = []) {
  return [...new Set(reasons.filter(Boolean))];
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function sharedBatchTelemetry(results = []) {
  const fields = [
    "batch_request_count",
    "batch_unique_image_download_count",
    "batch_decode_count",
    "batch_vision_unit_count",
    "batch_vision_http_attempt_count",
    "batch_google_annotate_request_count",
    "batch_attempted_vision_unit_count",
    "batch_confirmed_vision_unit_count",
    "batch_latency_ms"
  ];
  const values = Object.fromEntries(fields.map((field) => {
    const observed = results.map((result) => safeInteger(result?.[field]));
    const complete = results.length > 0 && observed.every((value) => value !== null);
    const unique = complete ? [...new Set(observed)] : [];
    return [field, unique.length === 1 ? unique[0] : null];
  }));
  const observedAuthModes = results.map((result) => cleanText(result?.batch_auth_mode).toLowerCase());
  const authModesComplete = results.length > 0 && observedAuthModes.every((value) => (
    value === "adc" || value === "api_key"
  ));
  const authModes = authModesComplete ? [...new Set(observedAuthModes)] : [];
  const observedAttempts = results.map((result) => safeInteger(result?.worker_attempt_count));
  const attemptsComplete = results.length > 0 && observedAttempts.every((value) => value !== null);
  const attempts = attemptsComplete ? [...new Set(observedAttempts)] : [];
  const observedBillingUnknown = results.map((result) => (
    typeof result?.batch_billing_unknown === "boolean" ? result.batch_billing_unknown : null
  ));
  const billingComplete = results.length > 0 && observedBillingUnknown.every((value) => value !== null);
  const billingStates = billingComplete ? [...new Set(observedBillingUnknown)] : [];
  return {
    ...values,
    batch_auth_mode: authModes.length === 1 ? authModes[0] : null,
    worker_attempt_count: attempts.length === 1 ? attempts[0] : null,
    batch_billing_unknown: billingStates.length === 1 ? billingStates[0] : null
  };
}

function transportProofReasons(telemetry = {}, expectedRequestCount, expectedSourceCount) {
  const reasons = [];
  if (telemetry.batch_request_count !== expectedRequestCount) reasons.push("BATCH_REQUEST_COUNT_UNPROVEN");
  if (telemetry.batch_unique_image_download_count !== expectedSourceCount) reasons.push("UNIQUE_IMAGE_DOWNLOAD_COUNT_UNPROVEN");
  if (telemetry.batch_decode_count !== expectedSourceCount) reasons.push("DECODE_COUNT_UNPROVEN");
  if (telemetry.batch_vision_unit_count !== expectedRequestCount) reasons.push("VISION_UNIT_COUNT_UNPROVEN");
  if (telemetry.batch_vision_http_attempt_count !== 1) reasons.push("VISION_HTTP_ATTEMPT_COUNT_UNPROVEN");
  if (telemetry.batch_google_annotate_request_count !== 1) reasons.push("GOOGLE_ANNOTATE_REQUEST_COUNT_UNPROVEN");
  if (telemetry.batch_attempted_vision_unit_count !== expectedRequestCount) reasons.push("ATTEMPTED_VISION_UNIT_COUNT_UNPROVEN");
  if (telemetry.batch_confirmed_vision_unit_count !== expectedRequestCount) reasons.push("CONFIRMED_VISION_UNIT_COUNT_UNPROVEN");
  if (telemetry.batch_billing_unknown !== false) reasons.push("VISION_BILLING_STATE_UNPROVEN");
  if (telemetry.batch_latency_ms === null) reasons.push("BATCH_LATENCY_UNPROVEN");
  if (!telemetry.batch_auth_mode) reasons.push("BATCH_AUTH_MODE_UNPROVEN");
  if (telemetry.worker_attempt_count !== 1) reasons.push("WORKER_ATTEMPT_COUNT_NOT_ONE");
  return reasons;
}

export function buildShadowOneShotOcrCardPacket({ bundle = {} } = {}) {
  const detailSchedule = buildShadowOcrDetailSchedule({
    bundle,
    requiredRoles: requiredViews.map((view) => view.role)
  });
  const images = [
    ...(Array.isArray(bundle.images) ? bundle.images : []),
    ...(Array.isArray(bundle.derived_images) ? bundle.derived_images : [])
  ];
  const imageById = new Map(images.map((image) => [imageId(image), image]).filter(([id]) => id));
  const sideById = new Map(images.map((image) => [imageId(image), imageSide(image)]).filter(([id]) => id));
  const selectedJobs = [];
  const reasons = [];

  for (const view of requiredViews) {
    const matches = detailSchedule.jobs.filter((job) => (
      cropRoleForJob(job) === view.role
      && cropSideForJob(job, sideById) === view.side
    ));
    if (matches.length === 0) {
      reasons.push(`ROLE_NOT_SCHEDULED:${view.role}:${view.side}`);
      continue;
    }
    if (matches.length > 1) {
      reasons.push(`ROLE_AMBIGUOUS:${view.role}:${view.side}`);
      continue;
    }
    const job = matches[0];
    const source = sourceDescriptor(job, imageById);
    const lineage = source.lineage || {};
    if (!lineage.crop_source_image_id) reasons.push(`CROP_SOURCE_IMAGE_ID_MISSING:${view.role}`);
    if (!lineage.metadata_source_image_id) reasons.push(`CROP_METADATA_SOURCE_IMAGE_ID_MISSING:${view.role}`);
    if (lineage.crop_source_image_id && lineage.metadata_source_image_id
      && lineage.crop_source_image_id !== lineage.metadata_source_image_id) {
      reasons.push(`SOURCE_IMAGE_ID_MISMATCH:${view.role}`);
    }
    if (!source.image_id || !imageById.has(source.image_id)) {
      reasons.push(`SOURCE_IMAGE_NOT_FOUND:${view.role}`);
    }
    if (!source.object_path) reasons.push(`SOURCE_PATH_MISSING:${view.role}`);
    if (!lineage.metadata_source_object_path) {
      reasons.push(`CROP_METADATA_SOURCE_PATH_MISSING:${view.role}`);
    } else if (source.object_path && lineage.metadata_source_object_path !== source.object_path) {
      reasons.push(`SOURCE_PATH_MISMATCH:${view.role}`);
    }
    if (!/^[0-9a-f]{64}$/.test(source.content_sha256 || "")) {
      reasons.push(`SOURCE_HASH_MISSING:${view.role}`);
    }
    if (!/^[0-9a-f]{64}$/.test(lineage.metadata_source_content_sha256 || "")) {
      reasons.push(`CROP_METADATA_SOURCE_HASH_MISSING:${view.role}`);
    } else if (source.content_sha256
      && lineage.metadata_source_content_sha256 !== source.content_sha256) {
      reasons.push(`SOURCE_HASH_MISMATCH:${view.role}`);
    }
    if (lineage.metadata_source_side !== "front" && lineage.metadata_source_side !== "back") {
      reasons.push(`CROP_METADATA_SOURCE_SIDE_MISSING:${view.role}`);
    } else if (source.side && lineage.metadata_source_side !== source.side) {
      reasons.push(`SOURCE_SIDE_MISMATCH:${view.role}`);
    }
    if (!source.crop_id || !source.crop_box) reasons.push(`CROP_DESCRIPTOR_MISSING:${view.role}`);
    selectedJobs.push({ job, source });
  }

  const uniqueSources = new Map();
  for (const entry of selectedJobs) {
    const key = entry.source.content_sha256 || entry.source.object_path;
    if (!key) continue;
    const previous = uniqueSources.get(key);
    if (previous && previous.object_path !== entry.source.object_path) {
      reasons.push(`SOURCE_HASH_PATH_CONFLICT:${entry.source.crop_role}`);
    } else if (!previous) {
      uniqueSources.set(key, {
        image_id: entry.source.image_id,
        side: entry.source.side,
        object_path: entry.source.object_path,
        content_sha256: entry.source.content_sha256
      });
    }
  }

  const normalizedReasons = uniqueReasons(reasons);
  const packetCore = {
    schema_version: shadowOneShotOcrCardPacketVersion,
    evaluation_mode: "SHADOW_EVALUATION_ONLY",
    production_effect: "NONE",
    title_effect: "NONE",
    provider_calls: 0,
    asset_id: cleanText(bundle.asset_id) || null,
    bundle_id: cleanText(bundle.bundle_id) || null,
    bundle_generation_fingerprint: detailSchedule.token.bundle_generation_fingerprint,
    detail_revision: detailSchedule.token.detail_revision,
    required_views: requiredViews,
    source_images: [...uniqueSources.values()].sort((left, right) => (
      String(left.side).localeCompare(String(right.side))
    )),
    jobs: selectedJobs.map(({ job, source }) => ({ job, source })),
    status: normalizedReasons.length ? shadowOneShotOcrStatuses.INCOMPLETE : shadowOneShotOcrStatuses.READY,
    reason_codes: normalizedReasons.length ? normalizedReasons : ["ONE_SHOT_PACKET_READY"]
  };
  return Object.freeze({
    ...packetCore,
    packet_id: `ocr-card-${sha256(packetCore).slice(0, 24)}`
  });
}

export async function executeShadowOneShotOcrCardPacket({
  bundle = {},
  client,
  signedReadUrlFor,
  clock = () => Date.now()
} = {}) {
  const packet = buildShadowOneShotOcrCardPacket({ bundle });
  const base = {
    schema_version: shadowOneShotOcrCardPacketVersion,
    evaluation_mode: "SHADOW_EVALUATION_ONLY",
    production_effect: "NONE",
    title_effect: "NONE",
    provider_calls: 0,
    packet_id: packet.packet_id,
    asset_id: packet.asset_id,
    bundle_id: packet.bundle_id,
    bundle_generation_fingerprint: packet.bundle_generation_fingerprint,
    detail_revision: packet.detail_revision,
    source_image_count: packet.source_images.length,
    request_count: packet.jobs.length
  };
  if (packet.status !== shadowOneShotOcrStatuses.READY) {
    return Object.freeze({
      ...base,
      status: packet.status,
      reason_codes: packet.reason_codes,
      evidence: [],
      evidence_patches: [],
      telemetry: {
        signed_url_request_count: 0,
        cloud_run_request_count: 0,
        google_annotate_request_count: 0,
        vision_http_attempt_count: 0
      }
    });
  }
  if (!client || typeof client.verifyCrops !== "function") {
    return Object.freeze({
      ...base,
      status: shadowOneShotOcrStatuses.UNAVAILABLE,
      reason_codes: ["BATCH_CLIENT_UNAVAILABLE"],
      evidence: [],
      evidence_patches: [],
      telemetry: {
        signed_url_request_count: 0,
        cloud_run_request_count: 0,
        google_annotate_request_count: 0,
        vision_http_attempt_count: 0
      }
    });
  }
  if (typeof signedReadUrlFor !== "function") {
    throw new Error("Shadow one-shot OCR requires signedReadUrlFor.");
  }

  const startedAt = clock();
  const urlByPath = new Map();
  try {
    await Promise.all(packet.source_images.map(async (source) => {
      const matchingJob = packet.jobs.find((entry) => entry.source.object_path === source.object_path)?.job;
      const url = cleanText(await signedReadUrlFor(source.object_path, matchingJob));
      if (!url) throw new Error("signed_read_url_missing");
      urlByPath.set(source.object_path, url);
    }));
  } catch (error) {
    return Object.freeze({
      ...base,
      status: shadowOneShotOcrStatuses.UNAVAILABLE,
      reason_codes: [`SIGNED_URL_FAILED:${cleanText(error?.message || error).slice(0, 120)}`],
      evidence: [],
      evidence_patches: [],
      telemetry: {
        total_ms: Math.max(0, clock() - startedAt),
        signed_url_request_count: urlByPath.size,
        cloud_run_request_count: 0,
        google_annotate_request_count: 0,
        vision_http_attempt_count: 0
      }
    });
  }

  const signCompletedAt = clock();
  const requests = packet.jobs.map(({ job, source }) => ocrRequestForPreingestionJob(job, {
    imageUrl: urlByPath.get(source.object_path)
  }));
  let results;
  try {
    results = await client.verifyCrops(requests);
  } catch (error) {
    return Object.freeze({
      ...base,
      status: shadowOneShotOcrStatuses.UNAVAILABLE,
      reason_codes: [`BATCH_REQUEST_FAILED:${cleanText(error?.message || error).slice(0, 120)}`],
      evidence: [],
      evidence_patches: [],
      telemetry: {
        total_ms: Math.max(0, clock() - startedAt),
        sign_ms: Math.max(0, signCompletedAt - startedAt),
        signed_url_request_count: urlByPath.size,
        cloud_run_request_count: 1,
        google_annotate_request_count: null,
        vision_http_attempt_count: null
      }
    });
  }

  if (!Array.isArray(results) || results.length !== packet.jobs.length) {
    return Object.freeze({
      ...base,
      status: shadowOneShotOcrStatuses.UNAVAILABLE,
      reason_codes: ["BATCH_RESULT_COUNT_MISMATCH"],
      evidence: [],
      evidence_patches: [],
      telemetry: {
        total_ms: Math.max(0, clock() - startedAt),
        sign_ms: Math.max(0, signCompletedAt - startedAt),
        signed_url_request_count: urlByPath.size,
        cloud_run_request_count: 1,
        google_annotate_request_count: null,
        vision_http_attempt_count: null
      }
    });
  }

  const batchTelemetry = sharedBatchTelemetry(results);
  const proofReasons = transportProofReasons(batchTelemetry, packet.jobs.length, packet.source_images.length);
  const evidence = [];
  const evidencePatches = [];
  const evidenceReasons = [];
  for (let index = 0; index < packet.jobs.length; index += 1) {
    const { job, source } = packet.jobs[index];
    const result = results[index] || {};
    const role = source.crop_role;
    const requestId = cleanText(result.request_id || requests[index].request_id);
    const roleReasons = [];
    if (requestId !== cleanText(job.job_key)) roleReasons.push("RESULT_REQUEST_ID_MISMATCH");
    const patches = bundlePatchesFromOcrResult(result, job);
    const allowed = allowedFieldsByRole[role] || new Set();
    const legalPatches = patches.filter((patch) => allowed.has(cleanText(patch.field).toLowerCase()));
    const leakedFields = [...new Set(patches
      .map((patch) => cleanText(patch.field).toLowerCase())
      .filter((field) => field && !allowed.has(field)))].sort();
    if (leakedFields.length) roleReasons.push(`ROLE_FIELD_LEAK:${leakedFields.join(",")}`);
    const workerStatus = cleanText(result.worker_status || result.status).toUpperCase();
    let state = "UNKNOWN";
    if (!roleReasons.length && legalPatches.length) state = "VALUE";
    else if (!roleReasons.length && workerStatus === "NO_TEXT") state = "EMPTY";
    if (!roleReasons.length) evidencePatches.push(...legalPatches);
    evidenceReasons.push(...roleReasons.map((reason) => `${reason}:${role}`));
    evidence.push({
      crop_role: role,
      crop_id: source.crop_id,
      source_image_id: source.image_id,
      source_content_sha256: source.content_sha256,
      state,
      worker_status: workerStatus || "UNKNOWN",
      fields: state === "VALUE"
        ? legalPatches.map((patch) => ({ field: patch.field, value: patch.value, provenance: patch.provenance }))
        : [],
      reason_codes: roleReasons.length
        ? roleReasons
        : state === "UNKNOWN"
          ? ["NORMALIZATION_OR_WORKER_UNAVAILABLE"]
          : []
    });
  }

  const allReasons = uniqueReasons([...proofReasons, ...evidenceReasons]);
  const hasUnknown = evidence.some((entry) => entry.state === "UNKNOWN");
  const status = proofReasons.length
    ? shadowOneShotOcrStatuses.MIXED_REVISION_NON_ONE_SHOT
    : evidenceReasons.length || hasUnknown
      ? shadowOneShotOcrStatuses.INCOMPLETE
      : shadowOneShotOcrStatuses.COMPLETE;
  const completedAt = clock();
  return Object.freeze({
    ...base,
    status,
    reason_codes: allReasons.length
      ? allReasons
      : ["ONE_SHOT_OCR_COMPLETE"],
    evidence,
    evidence_patches: evidencePatches,
    telemetry: {
      total_ms: Math.max(0, completedAt - startedAt),
      sign_ms: Math.max(0, signCompletedAt - startedAt),
      batch_call_ms: Math.max(0, completedAt - signCompletedAt),
      signed_url_request_count: urlByPath.size,
      cloud_run_request_count: 1,
      google_annotate_request_count: batchTelemetry.batch_google_annotate_request_count,
      vision_http_attempt_count: batchTelemetry.batch_vision_http_attempt_count,
      vision_unit_count: batchTelemetry.batch_vision_unit_count,
      attempted_vision_unit_count: batchTelemetry.batch_attempted_vision_unit_count,
      confirmed_vision_unit_count: batchTelemetry.batch_confirmed_vision_unit_count,
      billing_unknown: batchTelemetry.batch_billing_unknown,
      unique_image_download_count: batchTelemetry.batch_unique_image_download_count,
      decode_count: batchTelemetry.batch_decode_count,
      worker_attempt_count: batchTelemetry.worker_attempt_count,
      worker_batch_latency_ms: batchTelemetry.batch_latency_ms,
      auth_mode: batchTelemetry.batch_auth_mode
    }
  });
}
