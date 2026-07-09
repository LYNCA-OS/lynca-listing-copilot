import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { cookieName, parseCookies, readSignedSession } from "../../lib/listing-session.mjs";
import { processQueuedPreingestionOcrJobs } from "../../lib/listing/preingestion/preingestion-ocr-worker.mjs";
import { isV4WorkerRequest } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

// Sweep endpoint for queued `ocr_crop_verification` preingestion jobs.
// The primary consumer is the in-process waitUntil dispatch inside
// api/listing-preingest.js; this endpoint exists to re-sweep jobs that
// survived a cold start or a failed dispatch.
export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionAuthorized = Boolean(readSignedSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET));
  if (!sessionAuthorized && !isV4WorkerRequest(req, process.env)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_preingest_worker",
    limit: 120,
    windowMs: 60_000,
    message: "Too many pre-ingestion worker sweeps. Please try again shortly."
  })) return;

  const payload = req.method === "POST" ? await readJsonPayload(req) : {};

  try {
    const result = await processQueuedPreingestionOcrJobs({
      assetId: payload.asset_id || payload.assetId || "",
      bundleId: payload.bundle_id || payload.bundleId || "",
      limit: payload.limit,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    sendJson(res, result.ok ? 200 : 503, withV4Version(result));
  } catch (error) {
    sendJson(res, 500, withV4Version({
      ok: false,
      code: "preingestion_worker_failed",
      message: String(error?.message || "Pre-ingestion worker sweep failed.").slice(0, 240)
    }));
  }
}
