import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { processQueuedPreingestionOcrJobs } from "../../lib/listing/preingestion/preingestion-ocr-worker.mjs";
import { reconcilePreingestionRecognitionCommitIntents } from "../../lib/listing/preingestion/recognition-commit.mjs";
import { isV4CronRequest, isV4WorkerRequest } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

// Sweep endpoint for queued `ocr_crop_verification` preingestion jobs.
// Browser pre-ingestion persists jobs and sends an authenticated wake here;
// this independent endpoint owns leases, execution and scheduled recovery.
export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-preingest-worker" });
  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  const internalAuthorized = isV4WorkerRequest(req, process.env) || isV4CronRequest(req, process.env);
  if (!internalAuthorized) {
    sendJson(res, 401, withV4Version({
      ok: false,
      retryable: false,
      code: "preingestion_worker_auth_required",
      message: "Internal worker or cron authentication is required."
    }));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_preingest_worker",
    limit: 120,
    windowMs: 60_000,
    message: "Too many pre-ingestion worker sweeps. Please try again shortly."
  })) return;

  let payload = {};
  try {
    payload = req.method === "POST" ? await readJsonPayload(req, { maxBytes: 32 * 1024 }) : {};
  } catch (error) {
    const status = requestPayloadErrorStatus(error);
    sendJson(res, status, withV4Version({
      ok: false,
      retryable: false,
      code: status === 413 ? "preingestion_worker_request_too_large" : "preingestion_worker_invalid_request"
    }));
    return;
  }
  const includeDetail = payload.include_detail === true || payload.includeDetail === true;

  try {
    // Recognition enqueue persists an outbox row in the same database
    // transaction. Every direct wake and the independent minute cron first
    // reconciles those intents, so a lost waitUntil cannot lose OCR work.
    const recognitionCommit = await reconcilePreingestionRecognitionCommitIntents({
      tenantId: payload.tenant_id || payload.tenantId || "",
      assetId: payload.asset_id || payload.assetId || "",
      limit: payload.commit_limit || payload.commitLimit || payload.limit,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const result = await processQueuedPreingestionOcrJobs({
      tenantId: payload.tenant_id || payload.tenantId || "",
      assetId: payload.asset_id || payload.assetId || "",
      bundleId: payload.bundle_id || payload.bundleId || "",
      limit: payload.limit,
      // Scheduled recovery keeps the scarce OCR pool on serial, grade and
      // printed card codes. Detail crops require an explicit maintenance call.
      anchorOnly: includeDetail
        ? false
        : payload.anchor_only !== false && payload.anchorOnly !== false,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const ok = recognitionCommit.ok === true && result.ok === true;
    sendJson(res, ok ? 200 : 503, withV4Version({
      ...result,
      ok,
      recognition_commit_reconciliation: recognitionCommit
    }));
  } catch (error) {
    sendJson(res, 500, withV4Version({
      ok: false,
      code: "preingestion_worker_failed",
      message: String(error?.message || "Pre-ingestion worker sweep failed.").slice(0, 240)
    }));
  }
}
