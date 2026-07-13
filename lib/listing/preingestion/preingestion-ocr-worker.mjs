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
    values.set(parsed.print_run_number, Math.max(confidence, values.get(parsed.print_run_number) || 0));
  }
  const candidates = [...values.entries()]
    .map(([value, confidence]) => ({ value, confidence }))
    .sort((left, right) => right.confidence - left.confidence);
  return {
    verified: candidates.length === 1,
    conflict: candidates.length > 1,
    value: candidates.length === 1 ? candidates[0].value : null,
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

async function mapWithConcurrency(items = [], concurrency = 1, worker) {
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

export async function claimQueuedPreingestionOcrJobs({
  assetId = "",
  bundleId = "",
  limit = 32,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) return [];
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);

  const listEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  listEndpoint.searchParams.set("select", "job_id,job_key,asset_id,bundle_id,payload,attempts");
  listEndpoint.searchParams.set("status", "eq.queued");
  listEndpoint.searchParams.set("job_type", `eq.${preingestionOcrJobType}`);
  if (normalizeText(assetId)) listEndpoint.searchParams.set("asset_id", `eq.${normalizeText(assetId)}`);
  if (normalizeText(bundleId)) listEndpoint.searchParams.set("bundle_id", `eq.${normalizeText(bundleId)}`);
  listEndpoint.searchParams.set("order", "priority.asc,created_at.asc");
  listEndpoint.searchParams.set("limit", String(Math.max(1, Math.min(32, Number(limit) || 8))));

  const listResponse = await fetchImpl(listEndpoint, {
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
  });
  if (!listResponse.ok) {
    const message = await listResponse.text();
    throw new Error(`Supabase preingestion job list failed: ${listResponse.status} ${message.slice(0, 180)}`);
  }
  const rows = (await readResponseJson(listResponse)) || [];

  const claimed = [];
  for (const row of rows) {
    // Conditional update on status=queued makes the claim atomic per row:
    // a concurrent worker's PATCH matches zero rows and returns empty.
    const claimEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
    claimEndpoint.searchParams.set("job_id", `eq.${row.job_id}`);
    claimEndpoint.searchParams.set("status", "eq.queued");
    const claimResponse = await fetchImpl(claimEndpoint, {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
      body: JSON.stringify({
        status: "running",
        attempts: (Number(row.attempts) || 0) + 1
      })
    });
    if (!claimResponse.ok) continue;
    const updated = (await readResponseJson(claimResponse)) || [];
    if (Array.isArray(updated) && updated.length === 1) {
      claimed.push({ ...row, ...updated[0] });
    }
  }
  return claimed;
}

export async function completePreingestionOcrJob({
  jobId,
  status = "succeeded",
  error = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env) || !normalizeText(jobId)) return false;
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("job_id", `eq.${normalizeText(jobId)}`);
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=minimal" }),
    body: JSON.stringify({
      status: status === "failed" ? "failed" : "succeeded",
      last_error: normalizeText(error).slice(0, 500) || null
    })
  });
  return response.ok;
}

export async function requeuePreingestionOcrJob({
  jobId,
  error = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env) || !normalizeText(jobId)) return false;
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("job_id", `eq.${normalizeText(jobId)}`);
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=minimal" }),
    body: JSON.stringify({
      status: "queued",
      last_error: normalizeText(error).slice(0, 500) || "bundle_patch_write_failed"
    })
  });
  return response.ok;
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
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = null;
  do {
    attempts += 1;
    const capacity = await acquireListingStageCapacity({
      stageId: plan.stage_id,
      jobId: job.job_id,
      owner,
      capacity: plan.global_capacity,
      leaseSeconds: plan.lease_seconds,
      env,
      fetchImpl
    });
    if (capacity.acquired) {
      return {
        ...capacity,
        coordinated: true,
        wait_ms: Date.now() - startedAt,
        attempts
      };
    }
    lastError = capacity.error || (capacity.configured ? "stage_capacity_busy" : "stage_capacity_unavailable");
    if (!capacity.configured || Date.now() - startedAt >= plan.capacity_wait_ms) break;
    await sleep(plan.capacity_poll_ms);
  } while (Date.now() - startedAt < plan.capacity_wait_ms);

  return {
    acquired: false,
    coordinated: true,
    slot: null,
    wait_ms: Date.now() - startedAt,
    attempts,
    error: lastError
  };
}

export async function requeueRetryableFailedPreingestionOcrJobs({
  assetId = "",
  bundleId = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) return { requeued: 0, configured: false };
  const maxAttempts = positiveInteger(env.PREINGESTION_OCR_MAX_ATTEMPTS, 3, 6);
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("select", "job_id,job_key,attempts,last_error");
  endpoint.searchParams.set("status", "eq.failed");
  endpoint.searchParams.set("job_type", `eq.${preingestionOcrJobType}`);
  if (normalizeText(assetId)) endpoint.searchParams.set("asset_id", `eq.${normalizeText(assetId)}`);
  if (normalizeText(bundleId)) endpoint.searchParams.set("bundle_id", `eq.${normalizeText(bundleId)}`);
  endpoint.searchParams.set("limit", "32");
  const response = await fetchImpl(endpoint, { headers: supabaseHeaders(serviceRoleKey) });
  if (!response.ok) return { requeued: 0, configured: true, reason: `failed_job_read_${response.status}` };
  const rows = (await readResponseJson(response)) || [];
  const retryable = rows.filter((row) => (
    normalizeText(row.job_key).startsWith(`ocr:${preingestionOcrJobVersion}:`)
    && Number(row.attempts || 0) < maxAttempts
    && retryableOcrFailure(row.last_error)
  ));
  let requeued = 0;
  for (const row of retryable) {
    const updateEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
    updateEndpoint.searchParams.set("job_id", `eq.${row.job_id}`);
    updateEndpoint.searchParams.set("status", "eq.failed");
    updateEndpoint.searchParams.set("attempts", `eq.${Number(row.attempts || 0)}`);
    const update = await fetchImpl(updateEndpoint, {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" }),
      body: JSON.stringify({ status: "queued", last_error: null })
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
      bundle_id: job.bundle_id || null
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

function resultHasPrintRunEvidence(ocrResult = {}) {
  const evidence = ocrResult.evidence_patch?.evidence || {};
  return Boolean(
    evidence.print_run_number?.value
    || evidence.print_run_numerator?.value
    || evidence.serial_number?.value
  );
}

async function verifyPreingestionJob(client, job, imageUrl) {
  const request = ocrRequestForPreingestionJob(job, { imageUrl });
  const primary = await client.verifyCrop(request);
  if (request.crop_type !== "serial_crop" || resultHasPrintRunEvidence(primary)) {
    return [{ result: primary, job }];
  }

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

export async function appendEvidencePatchesToBundle({
  bundleId,
  patches = [],
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeBundleId = normalizeText(bundleId);
  if (!preingestionSupabaseConfigured(env) || !safeBundleId || !patches.length) {
    return { updated: false, appended: 0 };
  }
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const readEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
    readEndpoint.searchParams.set("select", "bundle_id,evidence_patches,updated_at");
    readEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
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
  summary,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeBundleId = normalizeText(bundleId);
  if (!preingestionSupabaseConfigured(env) || !safeBundleId || !summary) {
    return { saved: false, skipped: true, reason: "summary_not_persistable" };
  }
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const readEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
    readEndpoint.searchParams.set("select", "bundle_id,quality_summary,updated_at");
    readEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
    readEndpoint.searchParams.set("limit", "1");
    const readResponse = await fetchImpl(readEndpoint, { headers: supabaseHeaders(serviceRoleKey) });
    if (!readResponse.ok) return { saved: false, reason: `summary_read_${readResponse.status}` };
    const rows = (await readResponseJson(readResponse)) || [];
    if (!rows.length) return { saved: false, reason: "bundle_not_found" };
    const current = rows[0];
    const writeEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
    writeEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
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
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeBundleId = normalizeText(bundleId);
  if (!preingestionSupabaseConfigured(env) || !safeBundleId) {
    return { configured: false, terminal: false, job_count: 0, patch_count: 0, status_counts: {} };
  }
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const jobsEndpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  jobsEndpoint.searchParams.set("select", "job_id,status,attempts,last_error,job_key,payload,created_at,updated_at");
  jobsEndpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
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
  const startedAt = Date.now();
  let sweepResult = null;
  const sweepPromise = triggerSweep
    ? processQueuedPreingestionOcrJobs({ assetId, bundleId, limit: 32, env, fetchImpl }).catch((error) => ({
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
    lastState = await readPreingestionOcrState({ bundleId, env, fetchImpl });
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
  assetId = "",
  bundleId = "",
  limit = 32,
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

  const signedUrl = signedReadUrlFor || (async (objectPath) => createListingImageSignedReadUrl({
    objectPath,
    env,
    fetchImpl
  }));

  const recoveredFailures = await requeueRetryableFailedPreingestionOcrJobs({
    assetId,
    bundleId,
    env,
    fetchImpl
  }).catch(() => ({ requeued: 0 }));
  const jobs = await claimQueuedPreingestionOcrJobs({ assetId, bundleId, limit, env, fetchImpl });
  const stagePlan = listingStageCapacityPlan(env).ocr;
  const legacyConcurrency = positiveInteger(env.PREINGESTION_OCR_CONCURRENCY, 3, 6);
  const concurrency = stagePlan.capacity_control_enabled ? stagePlan.local_concurrency : legacyConcurrency;
  const processOwner = `ocr-dispatch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      await requeuePreingestionOcrJob({
        jobId: job.job_id,
        error: message,
        env,
        fetchImpl
      }).catch(() => {});
      return {
        job,
        patches: [],
        status: "deferred",
        error: message,
        error_code: capacity.configured === false ? "OCR_STAGE_CAPACITY_UNAVAILABLE" : "OCR_STAGE_CAPACITY_BUSY",
        duration_ms: Date.now() - startedAt,
        stage_lane: lane,
        stage_capacity: capacity
      };
    }

    localActive += 1;
    peakLocalActive = Math.max(peakLocalActive, localActive);
    let patches = [];
    let outcome;
    try {
      const sourceObjectPath = job.payload?.crop?.crop_metadata?.source_object_path;
      if (!normalizeText(sourceObjectPath)) {
        throw new Error("crop source_object_path missing");
      }
      const imageUrl = await signedUrl(sourceObjectPath, job);
      const verified = await verifyPreingestionJob(client, job, imageUrl);
      patches = verified.flatMap((entry) => bundlePatchesFromOcrResult(entry.result, entry.job));
    } catch (error) {
      const message = error?.message || String(error);
      await completePreingestionOcrJob({
        jobId: job.job_id,
        status: "failed",
        error: message,
        env,
        fetchImpl
      }).catch(() => {});
      outcome = {
        job,
        patches: [],
        status: "failed",
        error: message,
        error_code: safeOcrErrorCode(error),
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
          patches,
          env,
          fetchImpl
        });
      } catch (error) {
        const message = error?.message || String(error);
        await requeuePreingestionOcrJob({
          jobId: job.job_id,
          error: message,
          env,
          fetchImpl
        }).catch(() => {});
        outcome = {
          job,
          patches,
          status: "requeued",
          error: message,
          error_code: safeOcrErrorCode(error),
          patches_appended: 0,
          duration_ms: Date.now() - startedAt
        };
        return { ...outcome, stage_lane: lane, stage_capacity: capacity };
      }
    }

    const completed = await completePreingestionOcrJob({
      jobId: job.job_id,
      status: "succeeded",
      env,
      fetchImpl
    }).catch(() => false);
    if (!completed) {
      const message = "preingestion_ocr_job_completion_write_failed";
      await requeuePreingestionOcrJob({
        jobId: job.job_id,
        error: message,
        env,
        fetchImpl
      }).catch(() => {});
      outcome = {
        job,
        patches,
        status: "requeued",
        error: message,
        error_code: safeOcrErrorCode(message),
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
    return { ...outcome, stage_lane: lane, stage_capacity: capacity };
  };

  const runJob = async (job) => {
    const outcome = await processJob(job);
    const capacity = outcome.stage_capacity;
    try {
      if (capacity?.acquired && capacity.coordinated) {
        const released = await releaseListingStageCapacity({
          stageId: stagePlan.stage_id,
          jobId: job.job_id,
          owner: processOwner,
          env,
          fetchImpl
        });
        outcome.stage_capacity = { ...capacity, released: released.released, release_error: released.error || null };
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
  if (stagePlan.capacity_control_enabled) {
    const anchorJobs = jobs.filter((job) => ocrStageLaneForJob(job) === "anchor");
    const detailJobs = jobs.filter((job) => ocrStageLaneForJob(job) === "detail");
    const [anchorOutcomes, detailOutcomes] = await Promise.all([
      mapWithConcurrency(anchorJobs, stagePlan.anchor_concurrency, runJob),
      mapWithConcurrency(detailJobs, stagePlan.detail_concurrency, runJob)
    ]);
    const order = new Map(jobs.map((job, index) => [job.job_id, index]));
    outcomes = [...anchorOutcomes, ...detailOutcomes]
      .sort((left, right) => Number(order.get(left.job?.job_id)) - Number(order.get(right.job?.job_id)));
  } else {
    outcomes = await mapWithConcurrency(jobs, concurrency, runJob);
  }

  const succeeded = outcomes.filter((outcome) => outcome.status === "succeeded").length;
  const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
  const requeued = outcomes.filter((outcome) => outcome.status === "requeued").length;
  const deferred = outcomes.filter((outcome) => outcome.status === "deferred").length;
  const patchesAppended = outcomes.reduce((sum, outcome) => sum + Number(outcome.patches_appended || 0), 0);
  const bundlesUpdated = new Set(outcomes
    .filter((outcome) => outcome.bundle_updated && outcome.job?.bundle_id)
    .map((outcome) => outcome.job.bundle_id));
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
    stage_lane: outcome.stage_lane || null,
    stage_capacity_slot: outcome.stage_capacity?.slot || null,
    stage_capacity_wait_ms: outcome.stage_capacity?.wait_ms ?? null,
    stage_capacity_attempts: outcome.stage_capacity?.attempts ?? null,
    stage_capacity_released: outcome.stage_capacity?.released ?? null
  }));

  const executionSummary = {
    capacity_control_enabled: stagePlan.capacity_control_enabled,
    global_capacity: stagePlan.global_capacity,
    anchor_concurrency: stagePlan.capacity_control_enabled ? stagePlan.anchor_concurrency : null,
    detail_concurrency: stagePlan.capacity_control_enabled ? stagePlan.detail_concurrency : null,
    peak_local_active: peakLocalActive,
    capacity_wait_p50_ms: quantileMs(outcomes.map((outcome) => outcome.stage_capacity?.wait_ms), 0.5),
    capacity_wait_p95_ms: quantileMs(outcomes.map((outcome) => outcome.stage_capacity?.wait_ms), 0.95),
    capacity_acquire_attempt_count: outcomes.reduce((sum, outcome) => sum + Number(outcome.stage_capacity?.attempts || 0), 0),
    capacity_deferred_count: deferred,
    claimed: jobs.length,
    succeeded,
    failed,
    requeued,
    deferred,
    anchor_job_count: outcomes.filter((outcome) => outcome.stage_lane === "anchor").length,
    detail_job_count: outcomes.filter((outcome) => outcome.stage_lane === "detail").length,
    duration_p50_ms: quantileMs(outcomes.map((outcome) => outcome.duration_ms), 0.5),
    duration_p95_ms: quantileMs(outcomes.map((outcome) => outcome.duration_ms), 0.95),
    timeout_count: outcomes.filter((outcome) => outcome.error_code === "OCR_TIMEOUT").length
  };
  const executionSummaryPersistence = await persistOcrExecutionSummary({
    bundleId,
    summary: executionSummary,
    env,
    fetchImpl
  }).catch((error) => ({ saved: false, reason: normalizeText(error?.message || error).slice(0, 160) }));

  return {
    ok: true,
    ocr_configured: true,
    claimed: jobs.length,
    concurrency,
    stage_capacity_control_enabled: stagePlan.capacity_control_enabled,
    stage_global_capacity: stagePlan.global_capacity,
    anchor_concurrency: stagePlan.capacity_control_enabled ? stagePlan.anchor_concurrency : null,
    detail_concurrency: stagePlan.capacity_control_enabled ? stagePlan.detail_concurrency : null,
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
    retryable_failures_requeued_before_claim: recoveredFailures.requeued || 0,
    patches_appended: patchesAppended,
    bundles_updated: bundlesUpdated.size,
    job_observability: jobObservability
  };
}
