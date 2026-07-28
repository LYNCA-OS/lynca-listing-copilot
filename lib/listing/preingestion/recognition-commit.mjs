import crypto from "node:crypto";
import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";
import { paddleOcrConfig } from "../ocr/paddle-ocr-client.mjs";
import {
  buildPreingestionWorkerJobs,
  fetchPreingestionSupabase,
  preingestionSupabaseConfigured,
  readLatestPreIngestionBundleByAssetStrict
} from "./preingestion-bundle.mjs";
import { invokeTrustedPreingestionOcrWorker } from "./internal-ocr-wake.mjs";
import { readIdentityResultCacheRecord } from "../cache/identity-result-cache.mjs";
import { readWriterFinalReplayRecord } from "../cache/writer-final-replay.mjs";
import { callV4Rpc } from "../v4/session/supabase-rest.mjs";

export const preingestionRecognitionCommitOutboxContractVersion = "preingestion-recognition-commit-outbox-v1";

export async function enqueueRecognitionPreingestionOcrJobs({
  jobs = [],
  authorizedRetryLineageId = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const source = Array.isArray(jobs) ? jobs : [];
  if (!source.length) {
    return { durable: preingestionSupabaseConfigured(env), attempted: 0, enqueued: 0 };
  }
  const rpc = await callV4Rpc({
    fn: "enqueue_recognition_preingestion_ocr_jobs",
    payload: {
      p_jobs: source,
      p_authorized_retry_lineage_id: String(authorizedRetryLineageId || "").trim() || null
    },
    env,
    fetchImpl
  });
  if (!rpc.ok) {
    return {
      durable: false,
      attempted: source.length,
      enqueued: 0,
      reason: `recognition_ocr_enqueue_rpc_failed:${String(rpc.error || "unknown_error")}`
    };
  }
  const result = rpc.rows?.[0] && typeof rpc.rows[0] === "object" ? rpc.rows[0] : {};
  const inserted = Number(result.inserted_count || 0);
  const requeued = Number(result.requeued_count || 0);
  return {
    durable: result.saved === true,
    attempted: Number(result.attempted_count || source.length),
    enqueued: inserted + requeued,
    inserted,
    requeued,
    runnable: Number(result.runnable_count || 0),
    succeeded: Number(result.succeeded_count || 0),
    blocked_terminal: Number(result.blocked_terminal_count || 0),
    authorized_retry_lineage_applied: result.authorized_retry_lineage_applied === true,
    reason: result.saved === true ? null : String(result.reason || "recognition_ocr_enqueue_not_executable")
  };
}

function boundedInteger(value, fallback, { min = 1, max = 20 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function outboxConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function claimPreingestionRecognitionCommitIntents({
  tenantId = "",
  assetId = "",
  limit = 4,
  leaseOwner = `precommit_${crypto.randomUUID()}`,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) {
    return { ok: false, rows: [], reason: "supabase_not_configured", lease_owner: leaseOwner };
  }
  const { url, key } = outboxConfig(env);
  const endpoint = new URL(`${url}/rest/v1/rpc/claim_preingestion_recognition_commit_outbox`);
  const response = await fetchPreingestionSupabase(endpoint, {
    method: "POST",
    headers: supabaseServiceHeaders(key, { "content-type": "application/json" }),
    body: JSON.stringify({
      p_limit: boundedInteger(limit, 4),
      p_lease_owner: leaseOwner,
      p_tenant_id: String(tenantId || "").trim() || null,
      p_asset_id: String(assetId || "").trim() || null
    })
  }, { env, fetchImpl, read: false });
  const body = await responseJson(response);
  if (!response.ok) {
    return {
      ok: false,
      rows: [],
      reason: `outbox_claim_http_${Number(response.status) || 0}`,
      lease_owner: leaseOwner
    };
  }
  return {
    ok: true,
    rows: Array.isArray(body) ? body : [],
    reason: null,
    lease_owner: leaseOwner
  };
}

export async function settlePreingestionRecognitionCommitIntent({
  outboxId,
  leaseOwner,
  completed,
  error = "",
  retryAfterSeconds = 5,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) {
    return { ok: false, settled: false, reason: "supabase_not_configured" };
  }
  const { url, key } = outboxConfig(env);
  const endpoint = new URL(`${url}/rest/v1/rpc/settle_preingestion_recognition_commit_outbox`);
  const response = await fetchPreingestionSupabase(endpoint, {
    method: "POST",
    headers: supabaseServiceHeaders(key, { "content-type": "application/json" }),
    body: JSON.stringify({
      p_outbox_id: Number(outboxId),
      p_lease_owner: String(leaseOwner || "").trim(),
      p_completed: completed === true,
      p_error: String(error || "").slice(0, 500) || null,
      p_retry_after_seconds: boundedInteger(retryAfterSeconds, 5, { min: 1, max: 3600 })
    })
  }, { env, fetchImpl, read: false });
  const body = await responseJson(response);
  return response.ok
    ? { ok: true, ...(body && typeof body === "object" ? body : {}) }
    : { ok: false, settled: false, reason: `outbox_settle_http_${Number(response.status) || 0}` };
}

// Paid pre-ingestion work is a consequence of the writer's durable recognition
// enqueue. The browser may prepare canonical metadata before the click, but it
// cannot enable, disable or configure OCR jobs.
export async function commitPreingestionWorkForRecognition({
  tenantId,
  assetId,
  expectedImageSetSha256 = "",
  identityResultCacheKey = "",
  identityCacheImageGenerationHash = "",
  identityCacheReadAllowed = true,
  writerFinalReplayAllowed = true,
  authorizedRetryOfJobId = "",
  wakeWorker = true,
  env = process.env,
  fetchImpl = globalThis.fetch,
  readLatest = readLatestPreIngestionBundleByAssetStrict,
  enqueueJobs = enqueueRecognitionPreingestionOcrJobs,
  invokeWorker = invokeTrustedPreingestionOcrWorker,
  readIdentityCache = readIdentityResultCacheRecord,
  readWriterFinal = readWriterFinalReplayRecord
} = {}) {
  const cacheKey = String(identityResultCacheKey || "").trim().toLowerCase();
  const cacheGenerationHash = String(identityCacheImageGenerationHash || "").trim().toLowerCase();
  const replayProbes = [];
  if (writerFinalReplayAllowed === true && /^[0-9a-f]{64}$/.test(cacheGenerationHash)) {
    replayProbes.push(Promise.resolve(readWriterFinal({
      tenantId,
      imageGenerationHash: cacheGenerationHash,
      env,
      fetchImpl
    })).then((result) => ({ source: "WRITER_FINAL_REPLAY", ...result })).catch(() => ({
      source: "WRITER_FINAL_REPLAY",
      hit: false,
      reason: "writer_final_probe_failed"
    })));
  }
  if (identityCacheReadAllowed === true && /^[0-9a-f]{64}$/.test(cacheKey)) {
    replayProbes.push(Promise.resolve(readIdentityCache({
      cacheKey,
      imageGenerationHash: cacheGenerationHash,
      env,
      fetchImpl
    })).then((result) => ({ source: "AI_TERMINAL_L2_REPLAY", ...result })).catch(() => ({
      source: "AI_TERMINAL_L2_REPLAY",
      hit: false,
      reason: "identity_cache_probe_failed"
    })));
  }
  if (replayProbes.length) {
    const replay = (await Promise.all(replayProbes)).find((probe) => probe?.hit === true);
    if (replay) {
      return {
        committed: false,
        reason: "terminal_replay_available",
        replay_class: replay.source,
        provider_call_skipped: true,
        enqueued: 0
      };
    }
  }

  const bundle = await readLatest({ tenantId, assetId, env, fetchImpl });
  if (!bundle?.bundle_id) {
    return { committed: false, reason: "preingestion_bundle_not_found", enqueued: 0 };
  }

  const expectedHash = String(expectedImageSetSha256 || "").trim().toLowerCase();
  if (expectedHash) {
    const bundleHash = String(
      bundle?.quality_summary?.capture_quality?.image_generation_hash || ""
    ).trim().toLowerCase();
    if (!bundleHash) {
      return { committed: false, reason: "preingestion_bundle_generation_not_ready", enqueued: 0 };
    }
    if (bundleHash !== expectedHash) {
      return { committed: false, reason: "preingestion_bundle_generation_superseded", enqueued: 0 };
    }
  }

  const ocr = paddleOcrConfig(env);
  if (ocr.enabled !== true) {
    return { committed: false, reason: "ocr_feature_disabled", enqueued: 0 };
  }
  const ocrReady = ocr.enabled === true
    && ocr.configured === true
    && Boolean(ocr.token)
    && Boolean(ocr.worker_revision);
  if (!ocrReady) {
    return { committed: false, reason: "ocr_runtime_not_ready", enqueued: 0 };
  }

  const jobs = buildPreingestionWorkerJobs({
    bundle,
    enableOcr: true,
    ocrWorkerRevision: ocr.worker_revision,
    enableOcrDetail: false,
    enableEmbeddings: false,
    enableSurface: false,
    enableQuality: false
  });
  const queued = await enqueueJobs({
    jobs,
    authorizedRetryLineageId: authorizedRetryOfJobId,
    env,
    fetchImpl
  });
  const wake = jobs.length && wakeWorker
    ? await invokeWorker({
      tenantId,
      assetId,
      bundleId: bundle.bundle_id,
      limit: 3,
      env,
      fetchImpl
    })
    : {
      invoked: false,
      ok: true,
      error: null,
      reason: jobs.length ? "current_worker_sweep_owns_processing" : "no_ocr_jobs"
    };
  return {
    committed: queued.durable === true,
    reason: queued.durable === true ? null : queued.reason || "ocr_enqueue_not_durable",
    attempted: Number(queued.attempted || jobs.length),
    enqueued: Number(queued.enqueued || 0),
    bundle_id: bundle.bundle_id,
    wake
  };
}

function retryDelayForCommitReason(reason = "") {
  if (reason === "preingestion_bundle_not_found") return 5;
  if (reason === "preingestion_bundle_generation_not_ready") return 5;
  if (reason === "ocr_runtime_not_ready") return 15;
  if (reason === "ocr_enqueue_not_durable") return 10;
  if (reason === "recognition_ocr_enqueue_rpc_failed") return 10;
  return 15;
}

export async function reconcilePreingestionRecognitionCommitIntents({
  tenantId = "",
  assetId = "",
  limit = 4,
  env = process.env,
  fetchImpl = globalThis.fetch,
  claim = claimPreingestionRecognitionCommitIntents,
  commit = commitPreingestionWorkForRecognition,
  settle = settlePreingestionRecognitionCommitIntent
} = {}) {
  const claimed = await claim({ tenantId, assetId, limit, env, fetchImpl });
  if (!claimed?.ok) {
    return {
      ok: false,
      claimed: 0,
      completed: 0,
      retry_scheduled: 0,
      reason: claimed?.reason || "outbox_claim_failed",
      results: []
    };
  }
  const rows = Array.isArray(claimed.rows) ? claimed.rows : [];
  const results = [];
  // Commit only persists idempotent OCR jobs; keep concurrency low so a cron
  // sweep cannot burst the OCR/storage control plane.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      let outcome;
      try {
        outcome = await commit({
          tenantId: row.tenant_id,
          assetId: row.asset_id,
          expectedImageSetSha256: row.image_set_sha256,
          identityResultCacheKey: row.identity_result_cache_key,
          identityCacheImageGenerationHash: row.identity_cache_image_generation_hash,
          identityCacheReadAllowed: row.identity_cache_read_allowed !== false,
          writerFinalReplayAllowed: row.writer_final_replay_allowed !== false,
          authorizedRetryOfJobId: row.authorized_retry_of_job_id,
          wakeWorker: false,
          env,
          fetchImpl
        });
      } catch (error) {
        outcome = {
          committed: false,
          reason: "preingestion_commit_transient_error",
          error: String(error?.message || "preingestion commit failed").slice(0, 300)
        };
      }
      const completed = outcome?.committed === true
        || outcome?.reason === "ocr_feature_disabled"
        || outcome?.reason === "preingestion_bundle_generation_superseded"
        || outcome?.reason === "terminal_replay_available"
        || outcome?.reason === "ocr_terminal_retry_authorization_required"
        || outcome?.reason === "ocr_authorized_retry_lineage_exhausted";
      const error = completed
        ? outcome?.reason || ""
        : outcome?.error || outcome?.reason || "preingestion_commit_not_durable";
      let settlement;
      try {
        settlement = await settle({
          outboxId: row.outbox_id,
          leaseOwner: claimed.lease_owner,
          completed,
          error,
          retryAfterSeconds: retryDelayForCommitReason(outcome?.reason),
          env,
          fetchImpl
        });
      } catch (settleError) {
        settlement = {
          ok: false,
          settled: false,
          reason: String(settleError?.message || "outbox_settle_failed").slice(0, 240)
        };
      }
      results[index] = {
        outbox_id: row.outbox_id,
        tenant_id: row.tenant_id,
        asset_id: row.asset_id,
        committed: outcome?.committed === true,
        provider_call_skipped: outcome?.provider_call_skipped === true,
        replay_class: outcome?.replay_class || null,
        ocr_enqueued_count: Number(outcome?.enqueued || 0),
        completion_reason: completed ? outcome?.reason || null : null,
        retry_reason: completed ? null : error,
        settled: settlement?.settled === true,
        settlement_status: settlement?.status || null,
        settlement_error: settlement?.ok === false ? settlement.reason || "outbox_settle_failed" : null
      };
    }
  });
  await Promise.all(workers);
  return {
    ok: results.every((item) => item?.settled === true),
    claimed: rows.length,
    completed: results.filter((item) => item?.committed === true || Boolean(item?.completion_reason)).length,
    retry_scheduled: results.filter((item) => item?.retry_reason && item?.settled === true).length,
    settlement_failed: results.filter((item) => item?.settled !== true).length,
    results
  };
}
