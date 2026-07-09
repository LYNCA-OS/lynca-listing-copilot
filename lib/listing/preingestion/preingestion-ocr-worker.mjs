import { createPaddleOcrClient } from "../ocr/paddle-ocr-client.mjs";
import { createListingImageSignedReadUrl } from "../storage/supabase-image-storage.mjs";
import { normalizeEvidencePatch, preingestionSupabaseConfigured } from "./preingestion-bundle.mjs";

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

export async function claimQueuedPreingestionOcrJobs({
  assetId = "",
  bundleId = "",
  limit = 8,
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
      confidence: ocrPatch.confidence ?? ocrResult.confidence ?? null,
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

  const readEndpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
  readEndpoint.searchParams.set("select", "bundle_id,evidence_patches");
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
  const existing = Array.isArray(rows[0]?.evidence_patches) ? rows[0].evidence_patches : [];
  if (!rows.length) return { updated: false, appended: 0, reason: "bundle_not_found" };

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
  const writeResponse = await fetchImpl(writeEndpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=minimal" }),
    body: JSON.stringify({
      evidence_patches: [...existing, ...additions],
      updated_at: new Date().toISOString()
    })
  });
  if (!writeResponse.ok) {
    const message = await writeResponse.text();
    throw new Error(`Supabase preingestion bundle patch write failed: ${writeResponse.status} ${message.slice(0, 180)}`);
  }
  return { updated: true, appended: additions.length };
}

export async function processQueuedPreingestionOcrJobs({
  assetId = "",
  bundleId = "",
  limit = 8,
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

  const jobs = await claimQueuedPreingestionOcrJobs({ assetId, bundleId, limit, env, fetchImpl });
  const patchesByBundle = new Map();
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const sourceObjectPath = job.payload?.crop?.crop_metadata?.source_object_path;
      if (!normalizeText(sourceObjectPath)) {
        throw new Error("crop source_object_path missing");
      }
      const imageUrl = await signedUrl(sourceObjectPath, job);
      const request = ocrRequestForPreingestionJob(job, { imageUrl });
      const ocrResult = await client.verifyCrop(request);
      const patches = bundlePatchesFromOcrResult(ocrResult, job);
      if (job.bundle_id && patches.length) {
        const bucket = patchesByBundle.get(job.bundle_id) || [];
        bucket.push(...patches);
        patchesByBundle.set(job.bundle_id, bucket);
      }
      await completePreingestionOcrJob({ jobId: job.job_id, status: "succeeded", env, fetchImpl });
      succeeded += 1;
    } catch (error) {
      await completePreingestionOcrJob({
        jobId: job.job_id,
        status: "failed",
        error: error?.message || String(error),
        env,
        fetchImpl
      }).catch(() => {});
      failed += 1;
    }
  }

  let patchesAppended = 0;
  for (const [jobBundleId, patches] of patchesByBundle) {
    try {
      const appendResult = await appendEvidencePatchesToBundle({ bundleId: jobBundleId, patches, env, fetchImpl });
      patchesAppended += appendResult.appended || 0;
    } catch {
      // Bundle write failure must not fail the whole sweep; jobs stay
      // succeeded and the patches will be regenerated on a future re-enqueue.
    }
  }

  return {
    ok: true,
    ocr_configured: true,
    claimed: jobs.length,
    succeeded,
    failed,
    patches_appended: patchesAppended,
    bundles_updated: patchesByBundle.size
  };
}
