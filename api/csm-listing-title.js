// Direct CSM thin path. No queue, Cloud Run, vector service, OCR sidecar, web
// search, or second model round participates in this request.

import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { instrumentProductionRequest, bindProductionRequestContext } from "../lib/observability/production-events.mjs";
import { readCanonicalListingImageReferences } from "../lib/listing/storage/canonical-image-references.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import { createV4RecognitionSession, createV4SessionId } from "../lib/listing/v4/session/session-store.mjs";
import { runPersistedCanonicalListingPath } from "../lib/listing/thin/csm-orchestration.mjs";
import { checkCsmPersistenceReadiness } from "../lib/listing/thin/csm-supabase-writer.mjs";
import { publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { readJsonPayload, sendJson } from "../lib/listing/v4/session/http-handler-utils.mjs";

const MODEL = "gpt-5.6-luna";
const EFFORT = "none";

function providerCaller(env = process.env, fetchImpl = globalThis.fetch) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("openai_api_key_unconfigured");
  return (request) => fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function runDirectCsmAsset({
  tenantId, userId, assetId, imageDetail = "high", env = process.env,
  fetchImpl = globalThis.fetch, callProvider = null, dependencies = {}
} = {}) {
  const checkReadiness = dependencies.checkReadiness || checkCsmPersistenceReadiness;
  const readImages = dependencies.readImages || readCanonicalListingImageReferences;
  const signImage = dependencies.signImage || createListingImageSignedReadUrl;
  const createSessionId = dependencies.createSessionId || createV4SessionId;
  const createSession = dependencies.createSession || createV4RecognitionSession;
  const runPath = dependencies.runPath || runPersistedCanonicalListingPath;

  // Fail before the paid provider boundary if the replay trace cannot be
  // stored. A usable title without its CSM lineage is not an acceptable new
  // production asset.
  const readiness = await checkReadiness({ env, fetchImpl });
  if (!readiness.ready) throw Object.assign(new Error(`csm_persistence_not_ready:${readiness.reason}`), { statusCode: 503 });

  const canonical = await readImages({ tenantId, assetId, env, fetchImpl });
  const originals = canonical.images.filter((image) => image.derived !== true).slice(0, 2);
  const imageUrls = await Promise.all(originals.map((image) => signImage({
    objectPath: image.objectPath,
    bucket: image.bucket,
    tenantId,
    env,
    fetchImpl
  })));
  if (!imageUrls.length) throw Object.assign(new Error("canonical_original_image_missing"), { statusCode: 409 });

  const sessionId = createSessionId("csmsess");
  const session = await createSession({
    sessionId,
    tenantId,
    userId,
    operatorId: userId,
    payload: {
      asset_id: canonical.asset_id,
      client_asset_ref: canonical.asset_id,
      images: canonical.image_references,
      provider: MODEL,
      mode: "csm_thin_direct"
    },
    routePlan: { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" },
    env,
    fetchImpl
  });
  if (session.persistence?.recognition_session?.saved !== true) {
    throw Object.assign(new Error("csm_recognition_session_not_persisted"), { statusCode: 503 });
  }

  const result = await runPath({
    tenantId,
    recognitionSessionId: sessionId,
    imageUrls,
    imageDetail,
    model: MODEL,
    effort: EFFORT,
    callProvider: callProvider || providerCaller(env, fetchImpl),
    env,
    fetchImpl
  });
  if (result?.csm_persistence?.ok !== true
      || result?.csm_persistence?.atomic !== true
      || result?.csm_persistence?.session?.saved !== true) {
    const code = result?.csm_persistence?.ok === true
      ? "csm_persistence_incomplete"
      : String(result?.csm_persistence?.code || "csm_persistence_failed");
    throw Object.assign(new Error(code), {
      code,
      statusCode: result?.csm_persistence?.ok === true
        ? 503
        : Number(result?.csm_persistence?.statusCode || 503)
    });
  }
  return result;
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/csm-listing-title" });
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, message: "Method not allowed" });
  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.CREATE_JOB });
    bindProductionRequestContext(res, context);
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 503), publicTenantAuthError(error));
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "csm_listing_title", limit: 60, windowMs: 60_000,
    message: "Too many recognition requests. Please try again shortly."
  })) return;

  try {
    const payload = await readJsonPayload(req, { maxBytes: 16 * 1024 });
    const result = await runDirectCsmAsset({
      tenantId: context.tenantId,
      userId: context.userId,
      assetId: payload.asset_id || payload.assetId,
      imageDetail: payload.image_detail || "high"
    });
    return sendJson(res, 200, {
      ok: true,
      route: "CSM_THIN_DIRECT",
      cloud_run_calls: 0,
      vector_calls: 0,
      recognition_session_id: result.csm_rows.resolution.recognition_session_id,
      trace_status: "PERSISTED",
      ...result
    });
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 503), {
      ok: false,
      code: String(error?.message || "csm_thin_path_failed").split(":")[0],
      retryable: Number(error?.statusCode || 503) >= 500,
      message: String(error?.message || "CSM thin path failed").slice(0, 240)
    });
  }
}
