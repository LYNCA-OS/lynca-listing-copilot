import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest } from "../../lib/listing-session.mjs";
import { runV4FastScoutObservation } from "../../lib/listing/v4/fast-scout/fast-scout-observation.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  if (!getSessionFromRequest(req)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
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
    const result = await runV4FastScoutObservation({
      payload,
      env: process.env,
      fetchImpl: globalThis.fetch,
      cacheWriteMode: "await",
      allowProviderCall: payload.v4_fast_scout_cache_only !== true
    });
    const scout = result.fast_scout || {};
    sendJson(res, 200, withV4Version({
      ok: true,
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
