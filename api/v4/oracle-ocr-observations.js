import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { createPaddleOcrClient } from "../../lib/listing/ocr/paddle-ocr-client.mjs";
import { ocrRequestForPreingestionJob } from "../../lib/listing/preingestion/preingestion-ocr-worker.mjs";
import { createListingImageSignedReadUrl } from "../../lib/listing/storage/supabase-image-storage.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { supabaseServiceHeaders } from "../../lib/supabase-service-headers.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../../lib/tenant/index.mjs";

export const config = { maxDuration: 120 };

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

function supabaseConfig(env = process.env) {
  const url = cleanText(env.SUPABASE_URL).replace(/\/+$/, "");
  const key = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  if (!url || !key) throw new Error("oracle_ocr_supabase_unconfigured");
  return { url, key };
}

async function jobsForAsset(assetId, tenantId, env = process.env) {
  const { url, key } = supabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("select", "job_id,job_key,asset_id,bundle_id,tenant_id,status,payload,updated_at");
  endpoint.searchParams.set("asset_id", `eq.${assetId}`);
  endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  endpoint.searchParams.set("job_type", "eq.ocr_crop_verification");
  endpoint.searchParams.set("status", "eq.succeeded");
  endpoint.searchParams.set("order", "updated_at.desc");
  const response = await fetch(endpoint, { headers: supabaseServiceHeaders(key) });
  if (!response.ok) throw new Error(`oracle_ocr_job_read_${response.status}`);
  const jobs = await response.json();
  const latestByRole = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const role = cleanText(job.payload?.crop?.role || job.payload?.crop?.crop_metadata?.crop_role);
    if (role && !latestByRole.has(role)) latestByRole.set(role, job);
  }
  return [...latestByRole.values()];
}

async function persistedAuditPatchesForAsset(assetId, tenantId, env = process.env) {
  const { url, key } = supabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
  endpoint.searchParams.set("select", "evidence_patches,updated_at");
  endpoint.searchParams.set("asset_id", `eq.${assetId}`);
  endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  endpoint.searchParams.set("order", "updated_at.desc");
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, { headers: supabaseServiceHeaders(key) });
  if (!response.ok) throw new Error(`oracle_ocr_bundle_read_${response.status}`);
  const rows = await response.json();
  const patches = Array.isArray(rows?.[0]?.evidence_patches) ? rows[0].evidence_patches : [];
  return patches.filter((patch) => patch?.field === "ocr_raw_observation");
}

function persistedObservation(patch = {}) {
  return {
    source: "PERSISTED_OCR_AUDIT",
    ocr_backend: null,
    model_id: cleanText(patch.provenance?.model_id) || null,
    crop_role: cleanText(patch.provenance?.crop_type || patch.provenance?.source_region),
    raw_text: cleanText(patch.raw_text || patch.value),
    fields: {},
    confidence: patch.confidence ?? null,
    text_candidate_count: Array.isArray(patch.text_candidates) ? patch.text_candidates.length : 0,
    text_candidates: Array.isArray(patch.text_candidates) ? patch.text_candidates.slice(0, 40) : [],
    vision_unit_count: Number(patch.provenance?.vision_unit_count || 0),
    vision_cost_estimate: 0,
    job_key: cleanText(patch.provenance?.job_key) || null
  };
}

function observation(result = {}, job = {}, requestedBackend = "") {
  const rawText = cleanText(result.raw_text || (result.text_candidates || []).map((row) => row.text).filter(Boolean).join(" "));
  const backend = cleanText(result.ocr_backend || requestedBackend).toLowerCase();
  return {
    source: backend.includes("google") || cleanText(result.model_id).toUpperCase().includes("GOOGLE")
      ? "GOOGLE_VISION_OCR"
      : "OCR_WORKER",
    ocr_backend: backend || null,
    model_id: cleanText(result.model_id) || null,
    crop_role: cleanText(job.payload?.crop?.role || job.payload?.crop?.crop_metadata?.crop_role),
    raw_text: rawText,
    fields: result.normalized_fields || {},
    confidence: result.confidence ?? null,
    text_candidate_count: Array.isArray(result.text_candidates) ? result.text_candidates.length : 0,
    // Oracle diagnostics must inspect what the chain actually consumed. Keep
    // the sample bounded and strip URLs/metadata; text, confidence, pass and
    // geometry are sufficient to diagnose evidence extraction loss.
    text_candidates: (Array.isArray(result.text_candidates) ? result.text_candidates : [])
      .slice(0, 40)
      .map((candidate) => ({
        text: cleanText(candidate?.text).slice(0, 160),
        confidence: candidate?.confidence ?? null,
        ocr_pass: cleanText(candidate?.ocr_pass || candidate?.ocrPass) || null,
        box: candidate?.box || null
      })),
    vision_unit_count: Number(result.vision_unit_count || 0),
    vision_cost_estimate: Number(result.vision_cost_estimate || 0)
  };
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/oracle-ocr-observations" });
  if (req.method !== "POST") return sendJson(res, 405, withV4Version({ ok: false, error: "method_not_allowed" }));
  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.CONFIGURE_TENANT });
    bindProductionRequestContext(res, context);
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
  }
  if (!enforceApiRateLimit(req, res, { scope: "v4_oracle_ocr_observations", limit: 3, windowMs: 60_000 })) return;
  let payload;
  try {
    payload = await readJsonPayload(req, { maxBytes: 32 * 1024 });
  } catch (error) {
    return sendJson(res, requestPayloadErrorStatus(error), withV4Version({ ok: false, error: "invalid_request" }));
  }
  const cards = Array.isArray(payload.cards) ? payload.cards.slice(0, 20) : [];
  if (!cards.length || cards.some((card) => !/^asset_[a-z0-9-]{8,80}$/i.test(cleanText(card.asset_id)))) {
    return sendJson(res, 400, withV4Version({ ok: false, error: "invalid_oracle_cards" }));
  }
  try {
    const client = createPaddleOcrClient({ env: process.env });
    if (!client.configured || !client.config?.enabled) throw new Error("oracle_ocr_worker_unconfigured");
    const output = await mapWithConcurrency(cards, 2, async (card) => {
      const jobs = await jobsForAsset(cleanText(card.asset_id), context.tenantId);
      const persisted = await persistedAuditPatchesForAsset(cleanText(card.asset_id), context.tenantId);
      if (persisted.length) {
        return {
          query_card_id: cleanText(card.query_card_id),
          observations: persisted.map(persistedObservation)
        };
      }
      const observations = await mapWithConcurrency(jobs, 2, async (job) => {
        const requestedBackend = "google_vision";
        const objectPath = cleanText(job.payload?.crop?.crop_metadata?.source_object_path);
        const signedUrl = await createListingImageSignedReadUrl({ objectPath, tenantId: context.tenantId });
        return observation(await client.verifyCrop({
          ...ocrRequestForPreingestionJob(job, { imageUrl: signedUrl }),
          ocr_backend: requestedBackend
        }), job, requestedBackend);
      });
      return { query_card_id: cleanText(card.query_card_id), observations };
    });
    return sendJson(res, 200, withV4Version({ ok: true, cards: output }));
  } catch (error) {
    return sendJson(res, 503, withV4Version({
      ok: false,
      error: "oracle_ocr_capture_failed",
      message: cleanText(error?.message).slice(0, 180)
    }));
  }
}
