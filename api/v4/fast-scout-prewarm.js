import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { runV4FastScoutObservation } from "../../lib/listing/v4/fast-scout/fast-scout-observation.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/fast-scout-prewarm" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
    requirePermission(context, TENANT_PERMISSIONS.CREATE_JOB);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "v4_fast_scout_prewarm",
    limit: 240,
    windowMs: 60_000,
    message: "Too many V4 fast scout prewarm requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  try {
    const startedAt = Date.now();
    const trustedPayload = {
      ...payload,
      tenant_id: context.tenantId,
      tenantId: context.tenantId,
      operator_id: context.userId,
      operatorId: context.userId,
      created_by_user_id: context.userId,
      assigned_to_user_id: context.userId
    };
    const result = await runV4FastScoutObservation({
      payload: trustedPayload,
      env: process.env,
      fetchImpl: globalThis.fetch,
      cacheWriteMode: "await",
      requestContext: {
        request_id: context.requestId,
        tenant_id: context.tenantId,
        user_id: context.userId
      },
      // Commercial requests may inspect an existing prewarm cache only. Any
      // paid scout must be a durable FAST_SCOUT_DRAFT queue job so provider
      // capacity, retries, cost and production events share one state machine.
      allowProviderCall: false
    });
    const scout = result.fast_scout || {};
    sendJson(res, 200, withV4Version({
      ok: true,
      tenant_id: context.tenantId,
      prewarm_status: scout.status || "READY",
      fast_scout_cache_hit: Boolean(scout.cache_hit),
      fast_scout_cache_status: scout.cache_status || (scout.cache_hit ? "HIT" : "MISS"),
      fast_scout_prewarmer_used: Boolean(scout.prewarmer_used),
      fast_scout_blocking_call_used: scout.blocking_call_used !== false,
      cache_id: scout.cache_id || null,
      prewarm_latency_ms: Date.now() - startedAt,
      provider_latency_ms: result.provider_latency_ms || scout.latency_ms || null,
      input_image_count: scout.input_image_count || 0,
      scout_fields: scout.fields || {},
      review_fields: scout.review_fields || [],
      confidence: scout.confidence ?? result.confidence_score ?? null
    }));
  } catch (error) {
    if (error?.code === "FAST_SCOUT_CACHE_MISS_PROVIDER_DISABLED") {
      sendJson(res, 200, withV4Version({
        ok: true,
        tenant_id: context.tenantId,
        prewarm_status: "CACHE_MISS",
        fast_scout_cache_hit: false,
        fast_scout_cache_status: "MISS_CACHE_ONLY",
        fast_scout_prewarmer_used: false,
        fast_scout_blocking_call_used: false,
        provider_latency_ms: null,
        cache_only: true
      }));
      return;
    }
    sendJson(res, 502, withV4Version({
      ok: false,
      prewarm_status: "FAILED",
      error_type: "FAST_SCOUT_PREWARM_FAILED",
      message: String(error?.message || error || "").slice(0, 240)
    }));
  }
}
