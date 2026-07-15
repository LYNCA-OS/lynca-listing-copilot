import { createPaddleOcrClient } from "../ocr/paddle-ocr-client.mjs";
import { parsePrintRunValue } from "../print-run/print-run-fields.mjs";
import { createListingImageSignedReadUrl } from "../storage/supabase-image-storage.mjs";
import { extractDirectSlabLabelParallel } from "./slab-label-evidence.mjs";
import {
  currentPreingestionEvidencePatches,
  normalizeEvidencePatch,
  preingestionOcrJobVersion,
  preingestionSupabaseConfigured
} from "./preingestion-bundle.mjs";
import {
  acquireListingStageCapacity,
  listingStageCapacityPlan,
  ocrGlobalConcurrencyPlan,
  ocrPerAssetConcurrencyPlan,
  releaseListingStageCapacity
} from "../v4/orchestration/stage-capacity.mjs";

// Consumer for the `ocr_crop_verification` jobs that api/listing-preingest.js
// enqueues into `preingestion_jobs`. Without this, the jobs sit queued forever
// and `preingestion_bundles.evidence_patches` stays empty, so the hard-evidence
// channel (serial / grade / card code) never reaches the title decision.
//
// Fail-closed: when the PaddleOCR field verifier is disabled or unconfigured,
// jobs are left queued and the caller gets `ocr_configured: false` — nothing
// is fabricated and nothing is marked failed.

function normalizeText(value) {
  return String(value ?? "").trim();
}

function requiredOcrTenantId(value) {
  const tenantId = normalizeText(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tenantId)) {
    throw new Error("Pre-ingestion OCR tenant_id is required.");
  }
  return tenantId;
}

function optionalOcrTenantId(value) {
  const tenantId = normalizeText(value);
  return tenantId ? requiredOcrTenantId(tenantId) : "";
}

function normalizedComparableText(value) {
  return normalizeText(value)
    .replace(/[｜|]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function candidateSupportsFieldValue(candidate = {}, fieldValue = "") {
  const expected = normalizedComparableText(fieldValue);
  const observed = normalizedComparableText(candidate.text || candidate.normalized_text || candidate.value || "");
  if (!expected || !observed) return false;
  if (observed === expected) return true;
  // A bare numeric field must not borrow confidence from a different compound
  // token (for example collector number 30 from the print run 30/99).
  if (/^\d{1,14}$/.test(expected)) return false;
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, "i").test(observed);
}

export function ocrConfidenceForFieldValue(ocrResult = {}, fieldValue = "") {
  let confidence = Number.isFinite(Number(ocrResult.confidence)) ? Number(ocrResult.confidence) : 0;
  for (const candidate of Array.isArray(ocrResult.text_candidates) ? ocrResult.text_candidates : []) {
    if (!candidateSupportsFieldValue(candidate, fieldValue)) continue;
    const candidateConfidence = Number(candidate.confidence);
    if (Number.isFinite(candidateConfidence)) confidence = Math.max(confidence, candidateConfidence);
  }
  return Math.max(0, Math.min(1, confidence));
}

function preingestionSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase preingestion storage is not configured.");
  }
  return { url, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const preingestionOcrJobType = "ocr_crop_verification";

const expectedPatternByCropRole = Object.freeze({
  serial_crop: "(?:1\\s*[/\\-]\\s*1|#?\\s*\\d{1,5}\\s*[/\\-]\\s*\\d{1,5})",
  card_code_crop: "[A-Z0-9][A-Z0-9._-]{1,24}",
  grade_label_crop: "(?:PSA|BGS|CGC|SGC|TAG|BECKETT)?\\s*(?:AUTH(?:ENTIC)?|ALTERED|\\d{1,2}(?:\\.\\d)?)",
  year_product_crop: "(?:19|20)\\d{2}(?:[-/]\\d{2})?|(?:TOPPS|PANINI|BOWMAN|PRIZM|CHROME|POKEMON|BANDAI|KONAMI)",
  subject_crop: "[A-Za-z][A-Za-z.'-]+(?:\\s+[A-Za-z][A-Za-z.'-]+){1,3}"
});

function verifiedSerialEvidenceFromPatches(patches = []) {
  const values = new Map();
  for (const patch of Array.isArray(patches) ? patches : []) {
    if (!["print_run_number", "serial_number", "numerical_rarity"].includes(normalizeText(patch.field))) continue;
    if (normalizeText(patch.source_type).toUpperCase() !== "OCR") continue;
    const confidence = Number(patch.confidence || 0);
    if (!Number.isFinite(confidence) || confidence < 0.86) continue;
    const parsed = parsePrintRunValue(patch.value);
    if (!parsed.print_run_number || !parsed.print_run_numerator || parsed.suspicious_print_run) continue;
    const provenance = patch.provenance || {};
    const observationKey = normalizeText(
      provenance.job_key
      || provenance.crop_id
      || patch.crop_id
      || `${patch.source_image_id || "unknown-image"}:${provenance.source_region || provenance.crop_type || "unknown-region"}`
    );
    const descriptor = [
      provenance.source_region,
      provenance.crop_type,
      provenance.job_key,
      provenance.crop_id,
      patch.crop_id
    ].filter(Boolean).join(" ").toLowerCase();
    const directCrop = /serial/.test(descriptor) && !/full[_ -]?image/.test(descriptor);
    const current = values.get(parsed.print_run_number) || {
      value: parsed.print_run_number,
      confidence: 0,
      observations: new Set(),
      direct_crop_observations: new Set()
    };
    current.confidence = Math.max(current.confidence, confidence);
    if (observationKey) current.observations.add(observationKey);
    if (directCrop && observationKey) current.direct_crop_observations.add(observationKey);
    values.set(parsed.print_run_number, current);
  }
  const candidates = [...values.entries()]
    .map(([value, record]) => ({
      value,
      confidence: record.confidence,
      independent_observation_count: record.observations.size,
      direct_crop_observation_count: record.direct_crop_observations.size,
      verified: record.observations.size >= 2
        || (record.direct_crop_observations.size >= 1 && record.confidence >= 0.94)
    }))
    .sort((left, right) => right.confidence - left.confidence);
  return {
    verified: candidates.length === 1 && candidates[0].verified,
    conflict: candidates.length > 1,
    value: candidates.length === 1 && candidates[0].verified ? candidates[0].value : null,
    candidate_count: candidates.length,
    candidates
  };
}

function jobHasCropRole(job = {}, role = "") {
  const expected = normalizeText(role);
  return normalizeText(job?.payload?.crop?.role) === expected
    || normalizeText(job.job_key).includes(`__${expected}__`);
}

function positiveInteger(value, fallback, max = 32) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, parsed);
}

function requiredOcrLeaseOwner(value) {
  const owner = normalizeText(value);
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(owner)) {
    throw new Error("Pre-ingestion OCR lease owner is required.");
  }
  return owner;
}

function createOcrLeaseOwner(prefix = "ocr-dispatch") {
  return requiredOcrLeaseOwner(
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`.slice(0, 160)
  );
}

function preingestionOcrLeaseSeconds(env = process.env) {
  // Vercel functions can run for five minutes. A six-minute default prevents
  // an active invocation from being reclaimed during its final write while a
  // crashed invocation is still recovered by the minute sweep.
  return positiveInteger(env.PREINGESTION_OCR_LEASE_SECONDS, 360, 900);
}

function leaseExpiryIso(leaseSeconds, now = new Date()) {
  const timestamp = now instanceof Date ? now : new Date(now);
  return new Date(timestamp.getTime() + positiveInteger(leaseSeconds, 360, 900) * 1000).toISOString();
}

function maxAttemptsForOcrJob(job = {}, env = process.env) {
  return positiveInteger(
    job.max_attempts,
    positiveInteger(env.PREINGESTION_OCR_MAX_ATTEMPTS, 3, 20),
    20
  );
}

function oneReturnedRow(payload) {
  return Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
}

async function mapWithConcurrency(items = [], concurrency = 1, worker) {
  if (!Array.isArray(items) || items.length === 0 || Number(concurrency) <= 0) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function ocrClaimRoleRank(job = {}) {
  return {
    serial_crop: 0,
    grade_label_crop: 1,
    card_code_crop: 2,
    year_product_crop: 3,
    subject_crop: 4
  }[cropRoleForJob(job)] ?? 9;
}

function jobSourceLooksLikeSlab(job = {}) {
  const metadata = job.payload?.crop?.crop_metadata || {};
  if (metadata.grade_source_looks_like_slab === true) return true;
  return gradeCropSourceLooksLikeSlab(job);
}

function orderedOcrJobsForAsset(rows = []) {
  const slabLike = rows.some((job) => (
    cropRoleForJob(job) === "grade_label_crop" && jobSourceLooksLikeSlab(job)
  ));
  const roleOrder = slabLike
    ? ["grade_label_crop", "serial_crop", "card_code_crop", "year_product_crop", "subject_crop"]
    : ["serial_crop", "card_code_crop", "grade_label_crop", "year_product_crop", "subject_crop"];
  const buckets = new Map(roleOrder.map((role) => [role, []]));
  const remainder = [];
  const sorted = [...rows].sort((left, right) => (
    Number(left.priority || 99) - Number(right.priority || 99)
      || normalizeText(left.created_at).localeCompare(normalizeText(right.created_at))
      || normalizeText(left.job_id).localeCompare(normalizeText(right.job_id))
  ));
  for (const job of sorted) {
    const role = cropRoleForJob(job);
    if (buckets.has(role)) buckets.get(role).push(job);
    else remainder.push(job);
  }
  const ordered = [];
  while (roleOrder.some((role) => buckets.get(role).length)) {
    for (const role of roleOrder) {
      const job = buckets.get(role).shift();
      if (job) ordered.push(job);
    }
  }
  return [...ordered, ...remainder.sort((left, right) => (
    ocrClaimRoleRank(left) - ocrClaimRoleRank(right)
      || Number(left.priority || 99) - Number(right.priority || 99)
  ))];
}

export function fairOcrClaimOrder(jobs = [], { limit = jobs.length, jobsPerAsset = 2 } = {}) {
  const outputLimit = Math.max(0, Math.min(jobs.length, Number(limit) || jobs.length));
  if (!outputLimit) return [];
  const perAsset = Math.max(1, Math.min(4, Number(jobsPerAsset) || 2));
  const groups = new Map();
  for (const job of jobs) {
    const key = normalizeText(job.asset_id || job.bundle_id || job.job_id) || `unknown-${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  const queues = [...groups.values()].map(orderedOcrJobsForAsset);
  const ordered = [];
  while (ordered.length < outputLimit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      for (let index = 0; index < perAsset && queue.length && ordered.length < outputLimit; index += 1) {
        ordered.push(queue.shift());
      }
      if (ordered.length >= outputLimit) break;
    }
  }
  return ordered;
}

export async function recoverStalePreingestionOcrJobs({
  tenantId = "",
  assetId = "",
  bundleId = "",
  limit = 128,
  now = new Date(),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) {
    return { configured: false, recovered: 0, failed_final: 0, inspected: 0 };
  }
  const scopedToAsset = Boolean(normalizeText(assetId) || normalizeText(bundleId));
  const safeTenantId = scopedToAsset
    ? requiredOcrTenantId(tenantId)
    : optionalOcrTenantId(tenantId);
  const recoveredAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(recoveredAt.getTime())) throw new TypeError("invalid_preingestion_ocr_recovery_time");

  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set(
    "select",
    "tenant_id,job_id,job_key,asset_id,bundle_id,status,attempts,max_attempts,lease_owner,lease_expires_at,updated_at"
  );
  endpoint.searchParams.set("status", "eq.running");
  endpoint.searchParams.set("job_type", `eq.${preingestionOcrJobType}`);
  if (safeTenantId) endpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  if (normalizeText(assetId)) endpoint.searchParams.set("asset_id", `eq.${normalizeText(assetId)}`);
  if (normalizeText(bundleId)) endpoint.searchParams.set("bundle_id", `eq.${normalizeText(bundleId)}`);
  endpoint.searchParams.set("order", "updated_at.asc");
  endpoint.searchParams.set("limit", String(Math.max(1, Math.min(500, Number(limit) || 128))));

  const response = await fetchImpl(endpoint, { headers: supabaseHeaders(serviceRoleKey) });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase stale preingestion OCR read failed: ${response.status} ${message.slice(0, 180)}`);
  }
  const payload = await readResponseJson(response);
  const rows = Array.isArray(payload) ? payload : [];
  const recoveredAtIso = recoveredAt.toISOString();
  const legacyLeaseMs = preingestionOcrLeaseSeconds(env) * 1000;
  let recovered = 0;
  let failedFinal = 0;
  let skipped = 0;

  for (const row of rows) {
    const rowTenantId = normalizeText(row.tenant_id);
    if (!rowTenantId || (safeTenantId && rowTenantId !== safeTenantId) || normalizeText(row.status).toLowerCase() !== "running") {
      skipped += 1;
      continue;
    }
    const leaseExpiry = Date.parse(row.lease_expires_at || "");
    const lastUpdate = Date.parse(row.updated_at || "");
    const stale = Number.isFinite(leaseExpiry)
      ? leaseExpiry <= recoveredAt.getTime()
      : Number.isFinite(lastUpdate) && lastUpdate + legacyLeaseMs <= recoveredAt.getTime();
    if (!stale) continue;

    const attempts = Math.max(0, Number.parseInt(String(row.attempts || 0), 10) || 0);
    const terminal = attempts >= maxAttemptsForOcrJob(row, env);
    const update = new URL(`${url}/rest/v1/preingestion_jobs`);
    update.searchParams.set("job_id", `eq.${normalizeText(row.job_id)}`);
    update.searchParams.set("tenant_id", `eq.${rowTenantId}`);
    update.searchParams.set("status", "eq.running");
    update.searchParams.set("attempts", `eq.${attempts}`);
    if (normalizeText(row.lease_owner)) {
      update.searchParams.set("lease_owner", `eq.${normalizeText(row.lease_owner)}`);
    } else {
      update.searchParams.set("lease_owner", "is.null");
    }
    if (normalizeText(row.lease_expires_at)) {
      update.searchParams.set("lease_expires_at", `eq.${normalizeText(row.lease_expires_at)}`);
    } else {
      update.searchParams.set("lease_expires_at", "is.null");
      if (normalizeText(row.updated_at)) update.searchParams.set("updated_at", `eq.${normalizeText(row.updated_at)}`);
    }
    const updateResponse = await fetchImpl(update, {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
      body: JSON.stringify({
        status: terminal ? "failed" : "queued",
        last_error: terminal ? "lease_expired_after_max_attempts" : "lease_expired_retryable",
        lease_owner: null,
        lease_expires_at: null,
        updated_at: recoveredAtIso
      })
    });
    if (!updateResponse.ok) continue;
    const updated = oneReturnedRow(await readResponseJson(updateResponse));
    if (!updated) continue;
    if (terminal) failedFinal += 1;
    else recovered += 1;
  }

  return {
    configured: true,
    inspected: rows.length,
    recovered,
    failed_final: failedFinal,
    skipped
  };
}

export async function claimQueuedPreingestionOcrJobs({
  tenantId = "",
  assetId = "",
  bundleId = "",
  limit = 32,
  anchorOnly = false,
  targetFields = [],
  leaseOwner = "",
  leaseSeconds = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) return [];
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);

  const requestedLimit = Math.max(1, Math.min(32, Number(limit) || 8));
  const scopedToAsset = Boolean(normalizeText(assetId) || normalizeText(bundleId));
  const safeTenantId = scopedToAsset
    ? requiredOcrTenantId(tenantId)
    : optionalOcrTenantId(tenantId);
  const safeLeaseOwner = leaseOwner
    ? requiredOcrLeaseOwner(leaseOwner)
    : createOcrLeaseOwner("ocr-claim");
  const effectiveLeaseSeconds = positiveInteger(
    leaseSeconds,
    preingestionOcrLeaseSeconds(env),
    900
  );
  // Claim only the stage capacity we can start now, but inspect a wider window
  // first so value-aware ordering can see grade/serial/code jobs that sit behind
  // lower numeric priorities in the database.
  const candidateLimit = Math.min(scopedToAsset ? 32 : 128, requestedLimit * 4);
  const listEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  listEndpoint.searchParams.set("select", "tenant_id,job_id,job_key,asset_id,bundle_id,payload,attempts,max_attempts,priority,created_at");
  listEndpoint.searchParams.set("status", "eq.queued");
  listEndpoint.searchParams.set("job_type", `eq.${preingestionOcrJobType}`);
  if (safeTenantId) listEndpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  if (normalizeText(assetId)) listEndpoint.searchParams.set("asset_id", `eq.${normalizeText(assetId)}`);
  if (normalizeText(bundleId)) listEndpoint.searchParams.set("bundle_id", `eq.${normalizeText(bundleId)}`);
  if (anchorOnly) listEndpoint.searchParams.set("priority", "lte.14");
  // Global sweeps fetch a wider oldest-first candidate window, then apply a
  // one-first-wave-job-per-card order while stage capacity is enabled. This
  // prevents early cards from occupying every worker before later cards get
  // their highest-value hard-text read.
  listEndpoint.searchParams.set("order", scopedToAsset ? "priority.asc,created_at.asc" : "created_at.asc,priority.asc");
  listEndpoint.searchParams.set("limit", String(candidateLimit));

  const listResponse = await fetchImpl(listEndpoint, {
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
  });
  if (!listResponse.ok) {
    const message = await listResponse.text();
    throw new Error(`Supabase preingestion job list failed: ${listResponse.status} ${message.slice(0, 180)}`);
  }
  const listedRows = (await readResponseJson(listResponse)) || [];
  const targetRoles = ocrCropRolesForTargetFields(targetFields);
  const targetedRows = targetRoles.size
    ? listedRows.filter((job) => targetRoles.has(cropRoleForJob(job)))
    : listedRows;
  const ocrPlan = listingStageCapacityPlan(env).ocr;
  const rows = fairOcrClaimOrder(targetedRows, {
    limit: requestedLimit,
    jobsPerAsset: ocrPlan.capacity_control_enabled ? ocrPlan.per_asset_capacity : 2
  });

  const claimed = [];
  for (const row of rows) {
    // Conditional update on status=queued makes the claim atomic per row:
    // a concurrent worker's PATCH matches zero rows and returns empty.
    const claimEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
    claimEndpoint.searchParams.set("job_id", `eq.${row.job_id}`);
    claimEndpoint.searchParams.set("tenant_id", `eq.${normalizeText(row.tenant_id)}`);
    claimEndpoint.searchParams.set("status", "eq.queued");
    claimEndpoint.searchParams.set("attempts", `eq.${Math.max(0, Number(row.attempts) || 0)}`);
    claimEndpoint.searchParams.set("lease_owner", "is.null");
    claimEndpoint.searchParams.set("lease_expires_at", "is.null");
    const leaseExpiresAt = leaseExpiryIso(effectiveLeaseSeconds);
    const claimResponse = await fetchImpl(claimEndpoint, {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
      body: JSON.stringify({
        status: "running",
        attempts: (Number(row.attempts) || 0) + 1,
        max_attempts: maxAttemptsForOcrJob(row, env),
        last_error: null,
        lease_owner: safeLeaseOwner,
        lease_expires_at: leaseExpiresAt
      })
    });
    if (!claimResponse.ok) continue;
    const updated = (await readResponseJson(claimResponse)) || [];
    if (Array.isArray(updated) && updated.length === 1) {
      const updatedOwner = normalizeText(updated[0]?.lease_owner);
      if (updatedOwner && updatedOwner !== safeLeaseOwner) continue;
      claimed.push({
        ...row,
        ...updated[0],
        lease_owner: updatedOwner || safeLeaseOwner,
        lease_expires_at: updated[0]?.lease_expires_at || leaseExpiresAt,
        max_attempts: Number(updated[0]?.max_attempts || maxAttemptsForOcrJob(row, env))
      });
    }
  }
  return claimed;
}

export async function completePreingestionOcrJob({
  jobId,
  tenantId = "",
  leaseOwner = "",
  status = "succeeded",
  error = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env) || !normalizeText(jobId) || !normalizeText(leaseOwner)) return false;
  const safeTenantId = requiredOcrTenantId(tenantId);
  const safeLeaseOwner = requiredOcrLeaseOwner(leaseOwner);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("job_id", `eq.${normalizeText(jobId)}`);
  endpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  endpoint.searchParams.set("status", "eq.running");
  endpoint.searchParams.set("lease_owner", `eq.${safeLeaseOwner}`);
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
    body: JSON.stringify({
      status: status === "failed" ? "failed" : "succeeded",
      last_error: normalizeText(error).slice(0, 500) || null,
      lease_owner: null,
      lease_expires_at: null
    })
  });
  return response.ok && Boolean(oneReturnedRow(await readResponseJson(response)));
}

export async function requeuePreingestionOcrJob({
  jobId,
  tenantId = "",
  leaseOwner = "",
  error = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env) || !normalizeText(jobId) || !normalizeText(leaseOwner)) return false;
  const safeTenantId = requiredOcrTenantId(tenantId);
  const safeLeaseOwner = requiredOcrLeaseOwner(leaseOwner);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("job_id", `eq.${normalizeText(jobId)}`);
  endpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  endpoint.searchParams.set("status", "eq.running");
  endpoint.searchParams.set("lease_owner", `eq.${safeLeaseOwner}`);
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
    body: JSON.stringify({
      status: "queued",
      last_error: normalizeText(error).slice(0, 500) || "bundle_patch_write_failed",
      lease_owner: null,
      lease_expires_at: null
    })
  });
  return response.ok && Boolean(oneReturnedRow(await readResponseJson(response)));
}

export async function renewPreingestionOcrJobLease({
  jobId,
  tenantId = "",
  leaseOwner = "",
  leaseSeconds = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env) || !normalizeText(jobId) || !normalizeText(leaseOwner)) return false;
  const safeTenantId = requiredOcrTenantId(tenantId);
  const safeLeaseOwner = requiredOcrLeaseOwner(leaseOwner);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("job_id", `eq.${normalizeText(jobId)}`);
  endpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  endpoint.searchParams.set("status", "eq.running");
  endpoint.searchParams.set("lease_owner", `eq.${safeLeaseOwner}`);
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
    body: JSON.stringify({
      lease_expires_at: leaseExpiryIso(
        positiveInteger(leaseSeconds, preingestionOcrLeaseSeconds(env), 900)
      )
    })
  });
  return response.ok && Boolean(oneReturnedRow(await readResponseJson(response)));
}

function retryableOcrFailure(error = "") {
  const text = normalizeText(error?.message || error).toLowerCase();
  return error?.retryable === true
    || /timeout|timed out|network|http\s+(?:429|5\d\d)|connection|temporar|cold start/.test(text);
}

function safeOcrErrorCode(error = "") {
  const value = normalizeText(error?.code || error?.error_code || error?.message || error).toLowerCase();
  if (!value) return null;
  if (/timeout|timed out/.test(value)) return "OCR_TIMEOUT";
  if (/http\s*429|rate.?limit/.test(value)) return "OCR_RATE_LIMITED";
  if (/http\s*5\d\d|cold start|temporar|connection|network/.test(value)) return "OCR_WORKER_UNAVAILABLE";
  if (/source_object_path missing/.test(value)) return "OCR_SOURCE_PATH_MISSING";
  if (/bundle.*patch|supabase.*bundle/.test(value)) return "OCR_BUNDLE_PERSISTENCE_FAILED";
  if (/completion.*write/.test(value)) return "OCR_JOB_COMPLETION_WRITE_FAILED";
  return "OCR_FIELD_JOB_FAILED";
}

function cropRoleForJob(job = {}) {
  return normalizeText(job.payload?.crop?.role || job.payload?.crop?.crop_metadata?.crop_role) || null;
}

const ocrAnchorCropRoles = new Set([
  "card_code_crop",
  "serial_crop",
  "grade_label_crop"
]);

export function ocrStageLaneForJob(job = {}) {
  return ocrAnchorCropRoles.has(cropRoleForJob(job)) ? "anchor" : "detail";
}

export function fairOcrAnchorJobOrder(jobs = []) {
  const roleOrder = ["serial_crop", "grade_label_crop", "card_code_crop"];
  const buckets = new Map(roleOrder.map((role) => [role, []]));
  const remainder = [];
  for (const job of jobs) {
    const role = cropRoleForJob(job);
    if (buckets.has(role)) buckets.get(role).push(job);
    else remainder.push(job);
  }
  const ordered = [];
  while (roleOrder.some((role) => buckets.get(role).length)) {
    for (const role of roleOrder) {
      const job = buckets.get(role).shift();
      if (job) ordered.push(job);
    }
  }
  return [...ordered, ...remainder];
}

function quantileMs(values = [], q = 0.5) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined && value !== "" && typeof value !== "boolean")
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return Math.round(sorted[index]);
}

async function acquireOcrStageSlot({
  job,
  owner,
  plan,
  env,
  fetchImpl
} = {}) {
  if (!plan.capacity_control_enabled) {
    return { acquired: true, coordinated: false, slot: null, wait_ms: 0, attempts: 0, error: null };
  }
  const assetCapacityKey = normalizeText(job.asset_id || job.bundle_id);
  const assetStageId = assetCapacityKey
    ? `${plan.stage_id}:asset:${assetCapacityKey}`.slice(0, 80)
    : null;
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = null;
  let lastConfigured = true;
  do {
    attempts += 1;
    const assetCapacity = assetStageId
      ? await acquireListingStageCapacity({
        stageId: assetStageId,
        jobId: job.job_id,
        owner,
        capacity: plan.per_asset_capacity,
        leaseSeconds: plan.lease_seconds,
        env,
        fetchImpl
      })
      : { acquired: true, configured: true, slot: null, error: null };
    if (!assetCapacity.acquired) {
      lastConfigured = assetCapacity.configured !== false;
      lastError = assetCapacity.error || (lastConfigured ? "ocr_asset_capacity_busy" : "ocr_asset_capacity_unavailable");
      if (!lastConfigured || Date.now() - startedAt >= plan.capacity_wait_ms) break;
      await sleep(plan.capacity_poll_ms);
      continue;
    }

    const globalCapacity = await acquireListingStageCapacity({
      stageId: plan.stage_id,
      jobId: job.job_id,
      owner,
      capacity: plan.global_capacity,
      leaseSeconds: plan.lease_seconds,
      env,
      fetchImpl
    });
    if (globalCapacity.acquired) {
      return {
        ...globalCapacity,
        coordinated: true,
        stage_id: plan.stage_id,
        asset_stage_id: assetStageId,
        asset_slot: assetCapacity.slot,
        asset_capacity: plan.per_asset_capacity,
        wait_ms: Date.now() - startedAt,
        attempts
      };
    }
    if (assetStageId) {
      await releaseListingStageCapacity({
        stageId: assetStageId,
        jobId: job.job_id,
        owner,
        env,
        fetchImpl
      }).catch(() => {});
    }
    lastConfigured = globalCapacity.configured !== false;
    lastError = globalCapacity.error || (lastConfigured ? "ocr_global_capacity_busy" : "ocr_global_capacity_unavailable");
    if (!lastConfigured || Date.now() - startedAt >= plan.capacity_wait_ms) break;
    await sleep(plan.capacity_poll_ms);
  } while (Date.now() - startedAt < plan.capacity_wait_ms);

  return {
    acquired: false,
    coordinated: true,
    configured: lastConfigured,
    slot: null,
    stage_id: plan.stage_id,
    asset_stage_id: assetStageId,
    asset_slot: null,
    asset_capacity: plan.per_asset_capacity,
    wait_ms: Date.now() - startedAt,
    attempts,
    error: lastError
  };
}

export async function requeueRetryableFailedPreingestionOcrJobs({
  tenantId = "",
  assetId = "",
  bundleId = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) return { requeued: 0, configured: false };
  const scopedToAsset = Boolean(normalizeText(assetId) || normalizeText(bundleId));
  const safeTenantId = scopedToAsset
    ? requiredOcrTenantId(tenantId)
    : optionalOcrTenantId(tenantId);
  const maxAttempts = positiveInteger(env.PREINGESTION_OCR_MAX_ATTEMPTS, 3, 20);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("select", "tenant_id,job_id,job_key,attempts,max_attempts,last_error,lease_owner,lease_expires_at");
  endpoint.searchParams.set("status", "eq.failed");
  endpoint.searchParams.set("job_type", `eq.${preingestionOcrJobType}`);
  if (safeTenantId) endpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  if (normalizeText(assetId)) endpoint.searchParams.set("asset_id", `eq.${normalizeText(assetId)}`);
  if (normalizeText(bundleId)) endpoint.searchParams.set("bundle_id", `eq.${normalizeText(bundleId)}`);
  endpoint.searchParams.set("limit", "32");
  const response = await fetchImpl(endpoint, { headers: supabaseHeaders(serviceRoleKey) });
  if (!response.ok) return { requeued: 0, configured: true, reason: `failed_job_read_${response.status}` };
  const rows = (await readResponseJson(response)) || [];
  const retryable = rows.filter((row) => (
    (!safeTenantId || normalizeText(row.tenant_id) === safeTenantId)
    && normalizeText(row.job_key).startsWith(`ocr:${preingestionOcrJobVersion}:`)
    && Number(row.attempts || 0) < maxAttemptsForOcrJob(row, env)
    && !normalizeText(row.lease_owner)
    && !normalizeText(row.lease_expires_at)
    && retryableOcrFailure(row.last_error)
  ));
  let requeued = 0;
  for (const row of retryable) {
    const updateEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
    updateEndpoint.searchParams.set("job_id", `eq.${row.job_id}`);
    updateEndpoint.searchParams.set("tenant_id", `eq.${requiredOcrTenantId(row.tenant_id)}`);
    updateEndpoint.searchParams.set("status", "eq.failed");
    updateEndpoint.searchParams.set("attempts", `eq.${Number(row.attempts || 0)}`);
    updateEndpoint.searchParams.set("lease_owner", "is.null");
    updateEndpoint.searchParams.set("lease_expires_at", "is.null");
    const update = await fetchImpl(updateEndpoint, {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
      body: JSON.stringify({
        status: "queued",
        last_error: null,
        lease_owner: null,
        lease_expires_at: null
      })
    });
    if (!update.ok) continue;
    const updated = (await readResponseJson(update)) || [];
    if (Array.isArray(updated) && updated.length === 1) requeued += 1;
  }
  return { requeued, configured: true, max_attempts: maxAttempts };
}

export function ocrRequestForPreingestionJob(job = {}, { imageUrl = "" } = {}) {
  const crop = job.payload?.crop || {};
  const metadata = crop.crop_metadata || {};
  const pixelBounds = metadata.pixel_bounds && Number(metadata.pixel_bounds.width) > 0
    ? metadata.pixel_bounds
    : null;
  return {
    request_id: job.job_key || job.job_id || "",
    image_url: imageUrl,
    crop_type: crop.role || metadata.crop_role || "",
    expected_pattern: expectedPatternByCropRole[crop.role || metadata.crop_role] || "",
    crop_box: pixelBounds || metadata.normalized_bounds || crop.crop_region || null,
    metadata: {
      image_id: crop.source_image_id || metadata.source_image_id || null,
      crop_id: metadata.crop_id || null,
      source_region: crop.source_region || metadata.source_region || null,
      asset_id: job.asset_id || metadata.asset_id || null,
      bundle_id: job.bundle_id || null,
      // Serial and slab-label fallbacks execute inside the Recognition Worker
      // against the already downloaded image. Older workers ignore these
      // metadata fields; the Node compatibility fallback below remains active.
      inline_full_image_fallback: ["serial_crop", "grade_label_crop"].includes(crop.role || metadata.crop_role),
      grade_source_looks_like_slab: (crop.role || metadata.crop_role) === "grade_label_crop"
        ? gradeCropSourceLooksLikeSlab(job)
        : false
    }
  };
}

function fullImageSerialJob(job = {}) {
  const crop = job.payload?.crop || {};
  const metadata = crop.crop_metadata || {};
  return {
    ...job,
    job_key: `${job.job_key || job.job_id || "ocr"}:full-image`,
    payload: {
      ...job.payload,
      crop: {
        ...crop,
        source_region: "full_image_serial_scan",
        crop_metadata: {
          ...metadata,
          crop_id: `${metadata.crop_id || "serial"}__full_image`,
          source_region: "full_image_serial_scan",
          pixel_bounds: null,
          normalized_bounds: null
        }
      }
    }
  };
}

function fullImageGradeJob(job = {}) {
  const crop = job.payload?.crop || {};
  const metadata = crop.crop_metadata || {};
  return {
    ...job,
    job_key: `${job.job_key || job.job_id || "ocr"}:full-image-grade`,
    payload: {
      ...job.payload,
      crop: {
        ...crop,
        source_region: "full_image_grade_scan",
        crop_metadata: {
          ...metadata,
          crop_id: `${metadata.crop_id || "grade"}__full_image_grade`,
          source_region: "full_image_grade_scan",
          pixel_bounds: null,
          normalized_bounds: null
        }
      }
    }
  };
}

function resultHasPrintRunEvidence(ocrResult = {}) {
  const evidence = ocrResult.evidence_patch?.evidence || {};
  return Boolean(
    evidence.print_run_number?.value
    || evidence.print_run_numerator?.value
    || evidence.serial_number?.value
  );
}

function resultHasGradeEvidence(ocrResult = {}) {
  const evidence = ocrResult.evidence_patch?.evidence || {};
  const company = evidence.grade_company?.value;
  const score = evidence.card_grade?.value || evidence.grade?.value || evidence.auto_grade?.value;
  return Boolean(company && score);
}

function sourceDimensionsFromCrop(job = {}) {
  const metadata = job.payload?.crop?.crop_metadata || {};
  const normalized = metadata.normalized_bounds || {};
  const pixels = metadata.pixel_bounds || {};
  const explicitWidth = Number(metadata.source_width || metadata.sourceWidth);
  const explicitHeight = Number(metadata.source_height || metadata.sourceHeight);
  const inferredWidth = Number(pixels.width) / Number(normalized.width);
  const inferredHeight = Number(pixels.height) / Number(normalized.height);
  const width = Number.isFinite(explicitWidth) && explicitWidth > 0 ? explicitWidth : inferredWidth;
  const height = Number.isFinite(explicitHeight) && explicitHeight > 0 ? explicitHeight : inferredHeight;
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height }
    : null;
}

function gradeCropSourceLooksLikeSlab(job = {}) {
  const dimensions = sourceDimensionsFromCrop(job);
  if (!dimensions) return false;
  return Math.min(dimensions.width, dimensions.height) / Math.max(dimensions.width, dimensions.height) <= 0.64;
}

function gradeFullImageFallbackEnabled(env = process.env) {
  const value = normalizeText(env.ENABLE_PADDLE_OCR_GRADE_FULL_IMAGE_FALLBACK).toLowerCase();
  if (!value) return true;
  return !["0", "false", "no", "off"].includes(value);
}

async function verifyPreingestionJob(client, job, imageUrl, { env = process.env } = {}) {
  const request = ocrRequestForPreingestionJob(job, { imageUrl });
  const primary = await client.verifyCrop(request);
  // New workers perform the optional full-image pass in memory. Treat an
  // explicit evaluation flag as authoritative even when it found no field;
  // issuing a second HTTP call would only repeat the same computation.
  if (primary.inline_full_image_fallback_evaluated === true) {
    return [{ result: primary, job }];
  }
  if (request.crop_type === "serial_crop" && !resultHasPrintRunEvidence(primary)) {
    // Numbering can appear anywhere on a card. A fixed lower-corner crop is a
    // cheap first pass; when it contains no print-run evidence, let PaddleOCR's
    // text detector scan the full current image instead of guessing a numerator.
    const fallbackJob = fullImageSerialJob(job);
    const fallbackRequest = {
      ...ocrRequestForPreingestionJob(fallbackJob, { imageUrl }),
      crop_box: null
    };
    const fallback = await client.verifyCrop(fallbackRequest);
    return [
      { result: primary, job },
      { result: fallback, job: fallbackJob }
    ];
  }

  if (request.crop_type !== "grade_label_crop"
    || resultHasGradeEvidence(primary)
    || !gradeFullImageFallbackEnabled(env)) {
    return [{ result: primary, job }];
  }

  // Marketplace framing often moves a slab label outside the generic top band,
  // and source dimensions/slab hints are not guaranteed to survive ingestion.
  // Missing grade evidence therefore earns exactly one full-image OCR pass.
  const fallbackJob = fullImageGradeJob(job);
  const fallbackRequest = {
    ...ocrRequestForPreingestionJob(fallbackJob, { imageUrl }),
    crop_box: null
  };
  const fallback = await client.verifyCrop(fallbackRequest);
  return [
    { result: primary, job },
    { result: fallback, job: fallbackJob }
  ];
}

// Flatten the rich ocr-evidence-patch-v1 document into the per-field flat
// patches that preingestion_bundles.evidence_patches (and the title handler's
// preingestion evidence document) consume.
export function bundlePatchesFromOcrResult(ocrResult = {}, job = {}) {
  const ocrPatch = ocrResult.evidence_patch || {};
  const evidence = ocrPatch.evidence && typeof ocrPatch.evidence === "object" ? ocrPatch.evidence : {};
  const crop = job.payload?.crop || {};
  const metadata = crop.crop_metadata || {};
  const sourceImageId = crop.source_image_id || metadata.source_image_id || "bundle";
  const cropId = metadata.crop_id || null;

  const patches = [];
  for (const [field, evidenceField] of Object.entries(evidence)) {
    const value = normalizeText(evidenceField?.value ?? evidenceField?.normalized_value);
    if (!value) continue;
    const fieldConfidence = ocrConfidenceForFieldValue(ocrResult, value);
    const patch = normalizeEvidencePatch({
      field,
      value,
      raw_text: ocrPatch.raw_text || null,
      text_candidates: (ocrResult.text_candidates || []).map((candidate) => ({
        value: candidate.text || candidate.normalized_text || "",
        confidence: candidate.confidence ?? null
      })).filter((candidate) => candidate.value),
      source_type: "OCR",
      source_image_id: sourceImageId,
      crop_id: cropId,
      // A crop can contain several weak lines even when the exact field token
      // is read cleanly. Keep the matched line confidence instead of diluting
      // a hard-text field with the crop-wide average.
      confidence: fieldConfidence,
      provenance: {
        generated_by: "preingestion_ocr_worker",
        job_key: job.job_key || null,
        crop_type: ocrPatch.crop_type || null,
        source_region: crop.source_region || metadata.source_region || null,
        source_object_path: metadata.source_object_path || null,
        model_id: ocrResult.model_id || null,
        model_revision: ocrResult.model_revision || null
      }
    });
    if (patch) patches.push(patch);
  }
  return patches;
}

function dedupeFallbackEvidencePatches(patches = []) {
  const byFieldValue = new Map();
  for (const patch of patches) {
    const key = [patch.field, normalizedComparableText(patch.value), patch.source_image_id || ""].join("::");
    const current = byFieldValue.get(key);
    if (!current || Number(patch.confidence || 0) > Number(current.confidence || 0)) {
      byFieldValue.set(key, patch);
    }
  }
  return [...byFieldValue.values()];
}

export async function appendEvidencePatchesToBundle({
  bundleId,
  tenantId = "",
  patches = [],
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeBundleId = normalizeText(bundleId);
  if (!preingestionSupabaseConfigured(env) || !safeBundleId || !patches.length) {
    return { updated: false, appended: 0 };
  }
  const safeTenantId = requiredOcrTenantId(tenantId);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const readEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
    readEndpoint.searchParams.set("select", "bundle_id,evidence_patches,updated_at");
    readEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
    readEndpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
    readEndpoint.searchParams.set("limit", "1");
    const readResponse = await fetchImpl(readEndpoint, {
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
    });
    if (!readResponse.ok) {
      const message = await readResponse.text();
      throw new Error(`Supabase preingestion bundle read failed: ${readResponse.status} ${message.slice(0, 180)}`);
    }
    const rows = (await readResponseJson(readResponse)) || [];
    if (!rows.length) return { updated: false, appended: 0, reason: "bundle_not_found" };
    const current = rows[0];
    const existing = Array.isArray(current.evidence_patches) ? current.evidence_patches : [];
    const seen = new Set(existing.map((patch) => `${patch.field}::${patch.crop_id || ""}::${normalizeText(patch.value)}`));
    const additions = patches.filter((patch) => {
      const key = `${patch.field}::${patch.crop_id || ""}::${normalizeText(patch.value)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!additions.length) return { updated: false, appended: 0, reason: "no_new_patches" };

    const writeEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
    writeEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
    writeEndpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
    if (current.updated_at) writeEndpoint.searchParams.set("updated_at", `eq.${current.updated_at}`);
    const writeResponse = await fetchImpl(writeEndpoint, {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
      body: JSON.stringify({
        evidence_patches: [...existing, ...additions],
        updated_at: new Date().toISOString()
      })
    });
    if (!writeResponse.ok) {
      const message = await writeResponse.text();
      throw new Error(`Supabase preingestion bundle patch write failed: ${writeResponse.status} ${message.slice(0, 180)}`);
    }
    const updated = (await readResponseJson(writeResponse)) || [];
    if (!current.updated_at || (Array.isArray(updated) && updated.length === 1)) {
      return { updated: true, appended: additions.length, attempts: attempt };
    }
  }
  throw new Error("Supabase preingestion bundle patch write conflicted repeatedly.");
}

async function persistOcrExecutionSummary({
  bundleId,
  tenantId,
  summary,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeBundleId = normalizeText(bundleId);
  if (!preingestionSupabaseConfigured(env) || !safeBundleId || !summary) {
    return { saved: false, skipped: true, reason: "summary_not_persistable" };
  }
  if (Number(summary.claimed || 0) < 1) {
    return { saved: false, skipped: true, reason: "no_claimed_jobs" };
  }
  const safeTenantId = requiredOcrTenantId(tenantId);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const readEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
    readEndpoint.searchParams.set("select", "bundle_id,quality_summary,updated_at");
    readEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
    readEndpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
    readEndpoint.searchParams.set("limit", "1");
    const readResponse = await fetchImpl(readEndpoint, { headers: supabaseHeaders(serviceRoleKey) });
    if (!readResponse.ok) return { saved: false, reason: `summary_read_${readResponse.status}` };
    const rows = (await readResponseJson(readResponse)) || [];
    if (!rows.length) return { saved: false, reason: "bundle_not_found" };
    const current = rows[0];
    const writeEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
    writeEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
    writeEndpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
    if (current.updated_at) writeEndpoint.searchParams.set("updated_at", `eq.${current.updated_at}`);
    const updatedAt = new Date().toISOString();
    const writeResponse = await fetchImpl(writeEndpoint, {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
      body: JSON.stringify({
        quality_summary: {
          ...(current.quality_summary || {}),
          ocr_stage_execution: {
            ...summary,
            recorded_at: updatedAt
          }
        },
        updated_at: updatedAt
      })
    });
    if (!writeResponse.ok) return { saved: false, reason: `summary_write_${writeResponse.status}` };
    const updated = (await readResponseJson(writeResponse)) || [];
    if (!current.updated_at || (Array.isArray(updated) && updated.length === 1)) {
      return { saved: true, attempts: attempt };
    }
  }
  return { saved: false, reason: "summary_write_conflict" };
}

export async function readPreingestionOcrState({
  bundleId,
  tenantId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeBundleId = normalizeText(bundleId);
  if (!preingestionSupabaseConfigured(env) || !safeBundleId) {
    return { configured: false, terminal: false, job_count: 0, patch_count: 0, status_counts: {} };
  }
  const safeTenantId = requiredOcrTenantId(tenantId);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const jobsEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  jobsEndpoint.searchParams.set("select", "job_id,status,attempts,last_error,job_key,payload,created_at,updated_at");
  jobsEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
  jobsEndpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  jobsEndpoint.searchParams.set("job_type", `eq.${preingestionOcrJobType}`);
  const jobsResponse = await fetchImpl(jobsEndpoint, { headers: supabaseHeaders(serviceRoleKey) });
  if (!jobsResponse.ok) {
    const message = await jobsResponse.text();
    throw new Error(`Supabase preingestion job state read failed: ${jobsResponse.status} ${message.slice(0, 180)}`);
  }
  const allJobs = (await readResponseJson(jobsResponse)) || [];
  const currentVersionPrefix = `ocr:${preingestionOcrJobVersion}:`;
  const jobs = allJobs.filter((job) => normalizeText(job.job_key).startsWith(currentVersionPrefix));
  const historicalJobs = allJobs.filter((job) => !normalizeText(job.job_key).startsWith(currentVersionPrefix));

  const bundleEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
  bundleEndpoint.searchParams.set("select", "bundle_id,evidence_patches,quality_summary,updated_at");
  bundleEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
  bundleEndpoint.searchParams.set("tenant_id", `eq.${safeTenantId}`);
  bundleEndpoint.searchParams.set("limit", "1");
  const bundleResponse = await fetchImpl(bundleEndpoint, { headers: supabaseHeaders(serviceRoleKey) });
  if (!bundleResponse.ok) {
    const message = await bundleResponse.text();
    throw new Error(`Supabase preingestion bundle state read failed: ${bundleResponse.status} ${message.slice(0, 180)}`);
  }
  const bundleRows = (await readResponseJson(bundleResponse)) || [];
  const rawPatches = Array.isArray(bundleRows[0]?.evidence_patches) ? bundleRows[0].evidence_patches : [];
  const executionSummary = bundleRows[0]?.quality_summary?.ocr_stage_execution || null;
  const patches = currentPreingestionEvidencePatches(rawPatches);
  const statusCounts = jobs.reduce((counts, job) => {
    const status = normalizeText(job.status).toLowerCase() || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const activeCount = (statusCounts.queued || 0) + (statusCounts.running || 0);
  const serialPatches = patches.filter((patch) => [
    "print_run_number",
    "print_run_numerator",
    "serial_number",
    "numerical_rarity"
  ].includes(normalizeText(patch.field)));
  const verifiedSerial = verifiedSerialEvidenceFromPatches(patches);
  const verifiedSlabParallel = extractDirectSlabLabelParallel(patches);
  const serialJobs = jobs.filter((job) => jobHasCropRole(job, "serial_crop"));
  const gradeLabelJobs = jobs.filter((job) => jobHasCropRole(job, "grade_label_crop"));
  const cardCodeJobs = jobs.filter((job) => jobHasCropRole(job, "card_code_crop"));
  const activeJob = (job) => ["queued", "running"].includes(normalizeText(job.status).toLowerCase());
  const serialActiveCount = serialJobs.filter(activeJob).length;
  const gradeLabelActiveCount = gradeLabelJobs.filter((job) => ["queued", "running"].includes(normalizeText(job.status).toLowerCase())).length;
  const cardCodeActiveCount = cardCodeJobs.filter(activeJob).length;
  const gradeLabelSucceededCount = gradeLabelJobs.filter((job) => normalizeText(job.status).toLowerCase() === "succeeded").length;
  const criticalJobCount = serialJobs.length + gradeLabelJobs.length;
  const criticalActiveCount = serialActiveCount + gradeLabelActiveCount;
  const jobObservability = jobs.map((job) => {
    const createdAt = Date.parse(job.created_at || "");
    const updatedAt = Date.parse(job.updated_at || "");
    return {
      job_id: job.job_id || null,
      crop_role: cropRoleForJob(job),
      status: normalizeText(job.status).toUpperCase() || "UNKNOWN",
      attempts: Number(job.attempts || 0),
      lifecycle_ms: Number.isFinite(createdAt) && Number.isFinite(updatedAt)
        ? Math.max(0, updatedAt - createdAt)
        : null,
      error_code: safeOcrErrorCode(job.last_error)
    };
  });
  return {
    configured: true,
    job_version: preingestionOcrJobVersion,
    terminal: jobs.length > 0 && activeCount === 0,
    job_count: jobs.length,
    historical_job_count: historicalJobs.length,
    historical_failed_count: historicalJobs.filter((job) => normalizeText(job.status).toLowerCase() === "failed").length,
    active_count: activeCount,
    status_counts: statusCounts,
    patch_count: patches.length,
    raw_patch_count: rawPatches.length,
    evidence_patches: patches,
    historical_patch_count: rawPatches.length - patches.length,
    serial_patch_count: serialPatches.length,
    verified_serial_ready: verifiedSerial.verified,
    verified_serial_value: verifiedSerial.value,
    verified_serial_conflict: verifiedSerial.conflict,
    verified_serial_candidate_count: verifiedSerial.candidate_count,
    verified_slab_parallel_ready: verifiedSlabParallel.verified,
    verified_slab_parallel_value: verifiedSlabParallel.value,
    verified_slab_parallel_conflict: verifiedSlabParallel.conflict,
    critical_job_count: criticalJobCount,
    critical_active_count: criticalActiveCount,
    critical_fields_settled: criticalJobCount > 0 && criticalActiveCount === 0,
    serial_job_count: serialJobs.length,
    serial_active_count: serialActiveCount,
    grade_label_job_count: gradeLabelJobs.length,
    grade_label_active_count: gradeLabelActiveCount,
    grade_label_succeeded_count: gradeLabelSucceededCount,
    card_code_job_count: cardCodeJobs.length,
    card_code_active_count: cardCodeActiveCount,
    job_observability: jobObservability,
    patch_fields: [...new Set(patches.map((patch) => normalizeText(patch.field)).filter(Boolean))],
    failed_reasons: jobs.filter((job) => job.status === "failed" && job.last_error)
      .map((job) => normalizeText(job.last_error).slice(0, 160))
      .slice(0, 8),
    execution_summary: executionSummary
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizedOcrTargetFields(values = []) {
  const aliases = new Map([
    ["serial", "serial_number"],
    ["print_run", "serial_number"],
    ["print_run_number", "serial_number"],
    ["numerical_rarity", "serial_number"],
    ["grade_label", "grade"],
    ["grade_company", "grade"],
    ["card_grade", "grade"],
    ["collector_number", "card_code"],
    ["checklist_code", "card_code"],
    ["tcg_card_number", "card_code"]
  ]);
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value).toLowerCase())
    .map((value) => aliases.get(value) || value)
    .filter((value) => ["serial_number", "grade", "card_code"].includes(value)))];
}

function ocrCropRolesForTargetFields(values = []) {
  const roles = new Set();
  for (const field of normalizedOcrTargetFields(values)) {
    if (field === "serial_number") roles.add("serial_crop");
    if (field === "grade") roles.add("grade_label_crop");
    if (field === "card_code") roles.add("card_code_crop");
  }
  return roles;
}

function targetedOcrFieldsState(state = {}, targetFields = []) {
  const settledByField = {
    serial_number: Number(state.serial_active_count || 0) === 0,
    grade: Number(state.grade_label_active_count || 0) === 0,
    card_code: Number(state.card_code_active_count || 0) === 0
  };
  const settled = Object.fromEntries(targetFields.map((field) => [field, settledByField[field] === true]));
  return {
    target_fields: targetFields,
    target_fields_settled: targetFields.length > 0 && targetFields.every((field) => settled[field] === true),
    target_field_settled: settled
  };
}

export async function waitForPreingestionOcrEvidence({
  tenantId,
  assetId = "",
  bundleId = "",
  timeoutMs = 30_000,
  pollMs = 400,
  targetFields = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  triggerSweep = true,
  onState = null
} = {}) {
  const safeTenantId = requiredOcrTenantId(tenantId);
  const startedAt = Date.now();
  let sweepResult = null;
  const sweepPromise = triggerSweep
    ? processQueuedPreingestionOcrJobs({
      tenantId: safeTenantId,
      assetId,
      bundleId,
      limit: 6,
      anchorOnly: true,
      targetFields,
      env,
      fetchImpl
    }).catch((error) => ({
      ok: false,
      reason: normalizeText(error?.message || error).slice(0, 180)
    })).then((result) => {
      sweepResult = result;
      return result;
    })
    : Promise.resolve(null);
  let lastState = null;
  let stateReads = 0;
  const normalizedTargetFields = normalizedOcrTargetFields(targetFields);
  const publishState = (state) => {
    if (typeof onState !== "function") return;
    try {
      onState(state);
    } catch {
      // Diagnostics must never change OCR completion behavior.
    }
  };
  while (Date.now() - startedAt < Math.max(500, Number(timeoutMs) || 30_000)) {
    lastState = await readPreingestionOcrState({
      bundleId,
      tenantId: safeTenantId,
      env,
      fetchImpl
    });
    stateReads += 1;
    publishState(lastState);
    if (!lastState.configured) break;
    const targetedState = targetedOcrFieldsState(lastState, normalizedTargetFields);
    if (targetedState.target_fields_settled) {
      return {
        ...lastState,
        ...targetedState,
        status: "TARGET_FIELDS_SETTLED",
        waited_ms: Date.now() - startedAt,
        state_reads: stateReads,
        sweep: sweepResult
      };
    }
    const slabAuthoritySettled = lastState.verified_slab_parallel_ready
      || Number(lastState.grade_label_active_count || 0) === 0;
    if (lastState.verified_serial_ready && slabAuthoritySettled) {
      return {
        ...lastState,
        status: "EVIDENCE_READY",
        evidence_ready: true,
        waited_ms: Date.now() - startedAt,
        state_reads: stateReads,
        sweep: sweepResult
      };
    }
    if (lastState.critical_fields_settled) {
      return {
        ...lastState,
        status: "CRITICAL_FIELDS_SETTLED",
        critical_evidence_settled: true,
        waited_ms: Date.now() - startedAt,
        state_reads: stateReads,
        sweep: sweepResult
      };
    }
    if (lastState.terminal) {
      return {
        ...lastState,
        status: lastState.status_counts.failed ? "TERMINAL_WITH_FAILURES" : "TERMINAL",
        waited_ms: Date.now() - startedAt,
        state_reads: stateReads,
        sweep: sweepResult
      };
    }
    await sleep(Math.max(100, Math.min(2_000, Number(pollMs) || 400)));
  }
  return {
    ...(lastState || {}),
    ...targetedOcrFieldsState(lastState || {}, normalizedTargetFields),
    status: lastState?.configured === false ? "UNCONFIGURED" : "TIMEOUT",
    terminal: false,
    waited_ms: Date.now() - startedAt,
    state_reads: stateReads,
    sweep: sweepResult
  };
}

export async function processQueuedPreingestionOcrJobs({
  tenantId = "",
  assetId = "",
  bundleId = "",
  limit = 32,
  anchorOnly = false,
  targetFields = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  paddleClient = null,
  signedReadUrlFor = null
} = {}) {
  const client = paddleClient || createPaddleOcrClient({ env, fetchImpl });
  if (!client.configured) {
    return {
      ok: true,
      ocr_configured: false,
      reason: client.config?.reason || "paddle_ocr_not_configured",
      claimed: 0,
      succeeded: 0,
      failed: 0,
      patches_appended: 0
    };
  }
  if (!preingestionSupabaseConfigured(env)) {
    return { ok: false, ocr_configured: true, reason: "supabase_not_configured", claimed: 0, succeeded: 0, failed: 0, patches_appended: 0 };
  }

  const scopedToAsset = Boolean(normalizeText(assetId) || normalizeText(bundleId));
  const safeTenantId = scopedToAsset
    ? requiredOcrTenantId(tenantId)
    : optionalOcrTenantId(tenantId);
  const processOwner = createOcrLeaseOwner("ocr-dispatch");
  const leaseSeconds = preingestionOcrLeaseSeconds(env);

  const signedUrl = signedReadUrlFor || (async (objectPath, job = {}) => createListingImageSignedReadUrl({
    objectPath,
    tenantId: normalizeText(job.tenant_id || safeTenantId) || undefined,
    env,
    fetchImpl
  }));

  const staleRecovery = await recoverStalePreingestionOcrJobs({
    tenantId: safeTenantId,
    assetId,
    bundleId,
    env,
    fetchImpl
  }).catch(() => ({ recovered: 0, failed_final: 0, inspected: 0 }));
  const recoveredFailures = await requeueRetryableFailedPreingestionOcrJobs({
    tenantId: safeTenantId,
    assetId,
    bundleId,
    env,
    fetchImpl
  }).catch(() => ({ requeued: 0 }));
  const stagePlan = listingStageCapacityPlan(env).ocr;
  const requestedJobLimit = Math.max(1, Math.min(32, Number(limit) || 8));
  const effectiveClaimLimit = stagePlan.capacity_control_enabled
    ? Math.min(
      requestedJobLimit,
      scopedToAsset ? stagePlan.per_asset_batch_size : stagePlan.global_capacity
    )
    : requestedJobLimit;
  const jobs = await claimQueuedPreingestionOcrJobs({
    tenantId: safeTenantId,
    assetId,
    bundleId,
    limit: effectiveClaimLimit,
    anchorOnly,
    targetFields,
    leaseOwner: processOwner,
    leaseSeconds,
    env,
    fetchImpl
  });
  const anchorJobCount = jobs.filter((job) => ocrStageLaneForJob(job) === "anchor").length;
  const detailJobCount = jobs.length - anchorJobCount;
  const localPlan = scopedToAsset
    ? ocrPerAssetConcurrencyPlan(stagePlan, { anchorJobCount, detailJobCount })
    : {
      per_asset_capacity: null,
      ...ocrGlobalConcurrencyPlan(stagePlan, { anchorJobCount, detailJobCount })
    };
  const legacyConcurrency = positiveInteger(env.PREINGESTION_OCR_CONCURRENCY, 3, 6);
  const concurrency = stagePlan.capacity_control_enabled ? localPlan.local_concurrency : legacyConcurrency;
  let localActive = 0;
  let peakLocalActive = 0;

  const processJob = async (job) => {
    const startedAt = Date.now();
    const lane = ocrStageLaneForJob(job);
    const capacity = await acquireOcrStageSlot({
      job,
      owner: processOwner,
      plan: stagePlan,
      env,
      fetchImpl
    });
    if (!capacity.acquired) {
      const message = capacity.error || "ocr_stage_capacity_busy";
      const requeued = await requeuePreingestionOcrJob({
        jobId: job.job_id,
        tenantId: job.tenant_id,
        leaseOwner: job.lease_owner,
        error: message,
        env,
        fetchImpl
      }).catch(() => false);
      return {
        job,
        patches: [],
        status: requeued ? "deferred" : "lease_lost",
        error: message,
        error_code: requeued
          ? (capacity.configured === false ? "OCR_STAGE_CAPACITY_UNAVAILABLE" : "OCR_STAGE_CAPACITY_BUSY")
          : "OCR_LEASE_LOST",
        duration_ms: Date.now() - startedAt,
        stage_lane: lane,
        stage_capacity: capacity
      };
    }

    localActive += 1;
    peakLocalActive = Math.max(peakLocalActive, localActive);
    let patches = [];
    let verificationSummary = null;
    let outcome;
    try {
      const leaseRenewedBeforeProvider = await renewPreingestionOcrJobLease({
        jobId: job.job_id,
        tenantId: job.tenant_id,
        leaseOwner: job.lease_owner,
        leaseSeconds,
        env,
        fetchImpl
      });
      if (!leaseRenewedBeforeProvider) {
        throw Object.assign(new Error("preingestion_ocr_lease_lost_before_provider"), { code: "OCR_LEASE_LOST" });
      }
      const sourceObjectPath = job.payload?.crop?.crop_metadata?.source_object_path;
      if (!normalizeText(sourceObjectPath)) {
        throw new Error("crop source_object_path missing");
      }
      const imageUrl = await signedUrl(sourceObjectPath, job);
      const verified = await verifyPreingestionJob(client, job, imageUrl, { env });
      const leaseRenewedBeforePersistence = await renewPreingestionOcrJobLease({
        jobId: job.job_id,
        tenantId: job.tenant_id,
        leaseOwner: job.lease_owner,
        leaseSeconds,
        env,
        fetchImpl
      });
      if (!leaseRenewedBeforePersistence) {
        throw Object.assign(new Error("preingestion_ocr_lease_lost_before_persistence"), { code: "OCR_LEASE_LOST" });
      }
      patches = dedupeFallbackEvidencePatches(
        verified.flatMap((entry) => bundlePatchesFromOcrResult(entry.result, entry.job))
      );
      verificationSummary = {
        request_count: verified.length,
        grade_component_fallback_used: verified.some((entry) => (
          entry.result?.inline_grade_component_fallback_used === true
        )),
        grade_component_fallback_kind: verified
          .map((entry) => normalizeText(entry.result?.inline_grade_component_fallback_kind))
          .find(Boolean) || null,
        grade_component_fallback_target_found: verified.some((entry) => (
          entry.result?.inline_grade_component_fallback_target_found === true
        )),
        grade_component_fallback_latency_ms: verified.reduce((sum, entry) => (
          sum + Math.max(0, Number(entry.result?.inline_grade_component_fallback_latency_ms) || 0)
        ), 0),
        full_image_fallback_used: verified.length > 1
          || verified.some((entry) => entry.result?.inline_full_image_fallback_evaluated === true),
        full_image_fallback_network_request_count: Math.max(0, verified.length - 1),
        full_image_fallback_inline_count: verified.filter((entry) => (
          entry.result?.inline_full_image_fallback_evaluated === true
        )).length,
        full_image_fallback_target_found: verified.some((entry) => (
          entry.result?.inline_full_image_fallback_target_found === true
        )),
        full_image_fallback_kind: (verified.length > 1
          || verified.some((entry) => entry.result?.inline_full_image_fallback_evaluated === true))
          ? (cropRoleForJob(job) === "grade_label_crop" ? "grade" : "serial")
          : null,
        text_candidate_count: verified.reduce((sum, entry) => (
          sum + (Array.isArray(entry.result?.text_candidates) ? entry.result.text_candidates.length : 0)
        ), 0)
      };
    } catch (error) {
      const message = error?.message || String(error);
      const failed = await completePreingestionOcrJob({
        jobId: job.job_id,
        tenantId: job.tenant_id,
        leaseOwner: job.lease_owner,
        status: "failed",
        error: message,
        env,
        fetchImpl
      }).catch(() => false);
      outcome = {
        job,
        patches: [],
        status: failed ? "failed" : "lease_lost",
        error: message,
        error_code: failed ? safeOcrErrorCode(error) : "OCR_LEASE_LOST",
        duration_ms: Date.now() - startedAt
      };
      return { ...outcome, stage_lane: lane, stage_capacity: capacity };
    }

    let appendResult = { updated: false, appended: 0 };
    if (patches.length) {
      try {
        // Persist each completed field immediately. A slow card-code or grade
        // crop must not hold already verified serial evidence hostage. The
        // append helper uses updated_at as an optimistic CAS, so concurrent
        // crops for the same bundle remain lossless and idempotent.
        appendResult = await appendEvidencePatchesToBundle({
          bundleId: job.bundle_id,
          tenantId: job.tenant_id,
          patches,
          env,
          fetchImpl
        });
      } catch (error) {
        const message = error?.message || String(error);
        const requeued = await requeuePreingestionOcrJob({
          jobId: job.job_id,
          tenantId: job.tenant_id,
          leaseOwner: job.lease_owner,
          error: message,
          env,
          fetchImpl
        }).catch(() => false);
        outcome = {
          job,
          patches,
          status: requeued ? "requeued" : "lease_lost",
          error: message,
          error_code: requeued ? safeOcrErrorCode(error) : "OCR_LEASE_LOST",
          patches_appended: 0,
          duration_ms: Date.now() - startedAt
        };
        return { ...outcome, stage_lane: lane, stage_capacity: capacity };
      }
    }

    const completed = await completePreingestionOcrJob({
      jobId: job.job_id,
      tenantId: job.tenant_id,
      leaseOwner: job.lease_owner,
      status: "succeeded",
      env,
      fetchImpl
    }).catch(() => false);
    if (!completed) {
      const message = "preingestion_ocr_job_completion_write_failed";
      const requeued = await requeuePreingestionOcrJob({
        jobId: job.job_id,
        tenantId: job.tenant_id,
        leaseOwner: job.lease_owner,
        error: message,
        env,
        fetchImpl
      }).catch(() => false);
      outcome = {
        job,
        patches,
        status: requeued ? "requeued" : "lease_lost",
        error: message,
        error_code: requeued ? safeOcrErrorCode(message) : "OCR_LEASE_LOST",
        patches_appended: appendResult.appended || 0,
        bundle_updated: Boolean(appendResult.updated),
        duration_ms: Date.now() - startedAt
      };
      return { ...outcome, stage_lane: lane, stage_capacity: capacity };
    }
    outcome = {
      job,
      patches,
      status: "succeeded",
      patches_appended: appendResult.appended || 0,
      bundle_updated: Boolean(appendResult.updated),
      duration_ms: Date.now() - startedAt
    };
    outcome.verification_summary = verificationSummary;
    return { ...outcome, stage_lane: lane, stage_capacity: capacity };
  };

  const runJob = async (job) => {
    const outcome = await processJob(job);
    const capacity = outcome.stage_capacity;
    try {
      if (capacity?.acquired && capacity.coordinated) {
        const [globalRelease, assetRelease] = await Promise.all([
          releaseListingStageCapacity({
            stageId: stagePlan.stage_id,
            jobId: job.job_id,
            owner: processOwner,
            env,
            fetchImpl
          }),
          capacity.asset_stage_id
            ? releaseListingStageCapacity({
              stageId: capacity.asset_stage_id,
              jobId: job.job_id,
              owner: processOwner,
              env,
              fetchImpl
            })
            : Promise.resolve({ released: true, error: null })
        ]);
        outcome.stage_capacity = {
          ...capacity,
          released: globalRelease.released && assetRelease.released,
          global_released: globalRelease.released,
          asset_released: assetRelease.released,
          release_error: globalRelease.error || assetRelease.error || null
        };
      }
    } catch (error) {
      // The durable lease expires on its own. A transient release write must
      // not turn a completed OCR field into a failed recognition job.
      outcome.stage_capacity = {
        ...capacity,
        released: false,
        release_error: normalizeText(error?.message || error).slice(0, 160) || "stage_capacity_release_failed"
      };
    } finally {
      if (capacity?.acquired) localActive = Math.max(0, localActive - 1);
    }
    return { ...outcome, stage_lane: outcome.stage_lane || ocrStageLaneForJob(job) };
  };

  let outcomes;
  let scheduledFirstWaveJobs = [];
  if (stagePlan.capacity_control_enabled) {
    const anchorJobs = fairOcrAnchorJobOrder(jobs.filter((job) => ocrStageLaneForJob(job) === "anchor"));
    const detailJobs = jobs.filter((job) => ocrStageLaneForJob(job) === "detail");
    scheduledFirstWaveJobs = [
      ...anchorJobs.slice(0, localPlan.anchor_concurrency),
      ...detailJobs.slice(0, localPlan.detail_concurrency)
    ];
    const [anchorOutcomes, detailOutcomes] = await Promise.all([
      mapWithConcurrency(anchorJobs, localPlan.anchor_concurrency, runJob),
      mapWithConcurrency(detailJobs, localPlan.detail_concurrency, runJob)
    ]);
    const order = new Map(jobs.map((job, index) => [job.job_id, index]));
    outcomes = [...anchorOutcomes, ...detailOutcomes]
      .sort((left, right) => Number(order.get(left.job?.job_id)) - Number(order.get(right.job?.job_id)));
  } else {
    scheduledFirstWaveJobs = jobs.slice(0, concurrency);
    outcomes = await mapWithConcurrency(jobs, concurrency, runJob);
  }

  const succeeded = outcomes.filter((outcome) => outcome.status === "succeeded").length;
  const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
  const requeued = outcomes.filter((outcome) => outcome.status === "requeued").length;
  const deferred = outcomes.filter((outcome) => outcome.status === "deferred").length;
  const leaseLost = outcomes.filter((outcome) => outcome.status === "lease_lost").length;
  const patchesAppended = outcomes.reduce((sum, outcome) => sum + Number(outcome.patches_appended || 0), 0);
  const bundlesUpdated = new Set(outcomes
    .filter((outcome) => outcome.bundle_updated && outcome.job?.bundle_id)
    .map((outcome) => outcome.job.bundle_id));
  const assetKeyForJob = (job = {}) => normalizeText(job.asset_id || job.bundle_id || job.job_id) || null;
  const claimedJobsByAsset = new Map();
  for (const job of jobs) {
    const key = assetKeyForJob(job);
    if (!key) continue;
    claimedJobsByAsset.set(key, Number(claimedJobsByAsset.get(key) || 0) + 1);
  }
  const firstWaveAssetKeys = scheduledFirstWaveJobs.map(assetKeyForJob).filter(Boolean);
  const firstWaveDistinctAssetCount = new Set(firstWaveAssetKeys).size;
  const expectedFirstWaveDistinctAssetCount = scopedToAsset
    ? (firstWaveAssetKeys.length ? 1 : 0)
    : Math.min(claimedJobsByAsset.size, firstWaveAssetKeys.length);
  const laneCapacity = Number(localPlan.capacity ?? localPlan.global_capacity ?? localPlan.per_asset_capacity ?? 0);
  const laneConcurrency = Number(localPlan.anchor_concurrency || 0) + Number(localPlan.detail_concurrency || 0);
  const jobObservability = outcomes.map((outcome) => ({
    job_id: outcome.job?.job_id || null,
    crop_role: cropRoleForJob(outcome.job),
    status: normalizeText(outcome.status).toUpperCase() || "UNKNOWN",
    attempts: Number(outcome.job?.attempts || 0),
    duration_ms: Number.isFinite(Number(outcome.duration_ms)) ? Math.max(0, Math.round(Number(outcome.duration_ms))) : null,
    patch_count: Array.isArray(outcome.patches) ? outcome.patches.length : 0,
    patches_appended: Number(outcome.patches_appended || 0),
    bundle_updated: outcome.bundle_updated === true,
    error_code: outcome.error_code || null,
    request_count: Number(outcome.verification_summary?.request_count || 0) || null,
    grade_component_fallback_used: outcome.verification_summary?.grade_component_fallback_used === true,
    grade_component_fallback_kind: outcome.verification_summary?.grade_component_fallback_kind || null,
    grade_component_fallback_target_found: outcome.verification_summary?.grade_component_fallback_target_found === true,
    grade_component_fallback_latency_ms: Number(
      outcome.verification_summary?.grade_component_fallback_latency_ms || 0
    ),
    full_image_fallback_used: outcome.verification_summary?.full_image_fallback_used === true,
    full_image_fallback_kind: outcome.verification_summary?.full_image_fallback_kind || null,
    full_image_fallback_network_request_count: Number(
      outcome.verification_summary?.full_image_fallback_network_request_count || 0
    ),
    full_image_fallback_inline_count: Number(
      outcome.verification_summary?.full_image_fallback_inline_count || 0
    ),
    full_image_fallback_target_found: outcome.verification_summary?.full_image_fallback_target_found === true,
    text_candidate_count: Number(outcome.verification_summary?.text_candidate_count || 0),
    stage_lane: outcome.stage_lane || null,
    stage_capacity_slot: outcome.stage_capacity?.slot || null,
    asset_stage_capacity_slot: outcome.stage_capacity?.asset_slot || null,
    asset_stage_capacity: outcome.stage_capacity?.asset_capacity ?? null,
    stage_capacity_wait_ms: outcome.stage_capacity?.wait_ms ?? null,
    stage_capacity_attempts: outcome.stage_capacity?.attempts ?? null,
    stage_capacity_released: outcome.stage_capacity?.released ?? null
  }));

  const executionSummary = {
    anchor_only: anchorOnly === true,
    dispatch_scope: scopedToAsset ? "asset" : "global_sweep",
    capacity_control_enabled: stagePlan.capacity_control_enabled,
    global_capacity: stagePlan.global_capacity,
    per_asset_capacity: stagePlan.capacity_control_enabled ? localPlan.per_asset_capacity : null,
    per_asset_batch_size: stagePlan.capacity_control_enabled ? stagePlan.per_asset_batch_size : null,
    anchor_concurrency: stagePlan.capacity_control_enabled ? localPlan.anchor_concurrency : null,
    detail_concurrency: stagePlan.capacity_control_enabled ? localPlan.detail_concurrency : null,
    lane_capacity: stagePlan.capacity_control_enabled ? laneCapacity : null,
    lane_capacity_unused: stagePlan.capacity_control_enabled ? Math.max(0, laneCapacity - laneConcurrency) : null,
    lane_allocation_within_global_capacity: stagePlan.capacity_control_enabled
      ? laneConcurrency <= stagePlan.global_capacity && laneConcurrency <= laneCapacity
      : null,
    peak_local_active: peakLocalActive,
    requested_job_limit: requestedJobLimit,
    effective_claim_limit: effectiveClaimLimit,
    claim_limit_reduction: Math.max(0, requestedJobLimit - effectiveClaimLimit),
    capacity_wait_p50_ms: quantileMs(outcomes.map((outcome) => outcome.stage_capacity?.wait_ms), 0.5),
    capacity_wait_p95_ms: quantileMs(outcomes.map((outcome) => outcome.stage_capacity?.wait_ms), 0.95),
    capacity_acquire_attempt_count: outcomes.reduce((sum, outcome) => sum + Number(outcome.stage_capacity?.attempts || 0), 0),
    capacity_deferred_count: deferred,
    claimed: jobs.length,
    claimed_asset_count: claimedJobsByAsset.size,
    max_claimed_jobs_per_asset: claimedJobsByAsset.size
      ? Math.max(...claimedJobsByAsset.values())
      : 0,
    first_wave_job_count: scheduledFirstWaveJobs.length,
    first_wave_distinct_asset_count: firstWaveDistinctAssetCount,
    first_wave_expected_distinct_asset_count: expectedFirstWaveDistinctAssetCount,
    first_wave_fairness_satisfied: firstWaveDistinctAssetCount >= expectedFirstWaveDistinctAssetCount,
    succeeded,
    failed,
    requeued,
    deferred,
    lease_lost: leaseLost,
    stale_running_recovered: staleRecovery.recovered || 0,
    stale_running_failed_final: staleRecovery.failed_final || 0,
    anchor_job_count: outcomes.filter((outcome) => outcome.stage_lane === "anchor").length,
    detail_job_count: outcomes.filter((outcome) => outcome.stage_lane === "detail").length,
    duration_p50_ms: quantileMs(outcomes.map((outcome) => outcome.duration_ms), 0.5),
    duration_p95_ms: quantileMs(outcomes.map((outcome) => outcome.duration_ms), 0.95),
    timeout_count: outcomes.filter((outcome) => outcome.error_code === "OCR_TIMEOUT").length,
    grade_component_fallback_count: outcomes.filter((outcome) => (
      outcome.verification_summary?.grade_component_fallback_used === true
    )).length,
    grade_component_fallback_target_found_count: outcomes.filter((outcome) => (
      outcome.verification_summary?.grade_component_fallback_target_found === true
    )).length,
    grade_component_fallback_latency_ms: outcomes.reduce((sum, outcome) => (
      sum + Number(outcome.verification_summary?.grade_component_fallback_latency_ms || 0)
    ), 0),
    full_image_fallback_count: outcomes.filter((outcome) => outcome.verification_summary?.full_image_fallback_used === true).length,
    full_image_fallback_network_request_count: outcomes.reduce((sum, outcome) => (
      sum + Number(outcome.verification_summary?.full_image_fallback_network_request_count || 0)
    ), 0),
    full_image_fallback_inline_count: outcomes.reduce((sum, outcome) => (
      sum + Number(outcome.verification_summary?.full_image_fallback_inline_count || 0)
    ), 0),
    full_image_fallback_target_found_count: outcomes.filter((outcome) => (
      outcome.verification_summary?.full_image_fallback_target_found === true
    )).length
  };
  const executionSummaryPersistence = await persistOcrExecutionSummary({
    bundleId,
    tenantId: safeTenantId,
    summary: executionSummary,
    env,
    fetchImpl
  }).catch((error) => ({ saved: false, reason: normalizeText(error?.message || error).slice(0, 160) }));

  return {
    ok: true,
    ocr_configured: true,
    anchor_only: anchorOnly === true,
    dispatch_scope: scopedToAsset ? "asset" : "global_sweep",
    claimed: jobs.length,
    requested_job_limit: requestedJobLimit,
    effective_claim_limit: effectiveClaimLimit,
    concurrency,
    stage_capacity_control_enabled: stagePlan.capacity_control_enabled,
    stage_global_capacity: stagePlan.global_capacity,
    per_asset_capacity: stagePlan.capacity_control_enabled ? localPlan.per_asset_capacity : null,
    per_asset_batch_size: stagePlan.capacity_control_enabled ? stagePlan.per_asset_batch_size : null,
    anchor_concurrency: stagePlan.capacity_control_enabled ? localPlan.anchor_concurrency : null,
    detail_concurrency: stagePlan.capacity_control_enabled ? localPlan.detail_concurrency : null,
    peak_local_active: peakLocalActive,
    stage_capacity_wait_p50_ms: quantileMs(outcomes.map((outcome) => outcome.stage_capacity?.wait_ms), 0.5),
    stage_capacity_wait_p95_ms: quantileMs(outcomes.map((outcome) => outcome.stage_capacity?.wait_ms), 0.95),
    stage_capacity_acquire_attempt_count: outcomes.reduce((sum, outcome) => sum + Number(outcome.stage_capacity?.attempts || 0), 0),
    stage_capacity_deferred_count: deferred,
    execution_summary: executionSummary,
    execution_summary_persisted: executionSummaryPersistence.saved === true,
    execution_summary_persistence_reason: executionSummaryPersistence.reason || null,
    succeeded,
    failed,
    requeued,
    deferred,
    lease_lost: leaseLost,
    stale_running_recovered_before_claim: staleRecovery.recovered || 0,
    stale_running_failed_final_before_claim: staleRecovery.failed_final || 0,
    retryable_failures_requeued_before_claim: recoveredFailures.requeued || 0,
    patches_appended: patchesAppended,
    bundles_updated: bundlesUpdated.size,
    job_observability: jobObservability
  };
}
