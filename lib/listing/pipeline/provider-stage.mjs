// Provider call stage — extracted from the v2 monolith (R1).
// Copied verbatim; behavior must stay bit-identical.
import { runWithProviderConcurrency } from "../providers/provider-concurrency.mjs";
import { addTiming, timeAsync } from "./timing.mjs";

export function openAiRequestContextFromPayload(payload = {}, {
  providerCallPurpose = "listing_full_provider",
  titleStage = ""
} = {}) {
  return {
    job_id: payload.v4_queue_job_id || payload.job_id || payload.jobId || "",
    job_type: payload.v4_queue_job_type || payload.job_type || "",
    lane: payload.v4_queue_lane || payload.lane || "",
    recognition_session_id: payload.recognition_session_id || "",
    asset_id: payload.asset_id || payload.assetId || "",
    worker_id: payload.worker_id || payload.workerId || "",
    title_stage: titleStage || payload.v4_title_stage_target || "",
    provider_call_purpose: providerCallPurpose,
    v4_force_l2_direct: payload.v4_force_l2_direct === true,
    disable_fast_scout_l1: payload.disable_fast_scout_l1 === true,
    v4_queue_l1_only: payload.v4_queue_l1_only === true
  };
}

export async function runTimedProviderCall(providerId, timingContext, work) {
  const queued = await runWithProviderConcurrency({
    providerId,
    work: () => timeAsync(timingContext, "provider_total_ms", work)
  });
  addTiming(timingContext, "server_queue_ms", queued.queue_ms);
  if (!queued.result || typeof queued.result !== "object" || Array.isArray(queued.result)) return queued.result;
  return {
    ...queued.result,
    provider_slot_timing: {
      queued_at: new Date(queued.queued_at_ms).toISOString(),
      started_at: new Date(queued.started_at_ms).toISOString(),
      completed_at: new Date(queued.completed_at_ms).toISOString(),
      queue_ms: queued.queue_ms,
      execution_ms: queued.execution_ms,
      active_at_start: queued.active_at_start,
      local_concurrency_limit: queued.limit
    }
  };
}
