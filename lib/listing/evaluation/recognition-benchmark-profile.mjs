export const recognitionBenchmarkProfileIds = Object.freeze({
  COLD_ALGORITHM: "cold_algorithm_benchmark",
  COLD_TARGETED_ASSIST: "cold_targeted_assist_benchmark",
  EXACT_REPLAY: "exact_replay_benchmark",
  PRODUCTION_WORKLOAD: "production_workload_benchmark"
});

export const exactReplayPhases = Object.freeze({ COLD: "cold", REPLAY: "replay" });

function optionsFor(profile, phase) {
  if (profile === recognitionBenchmarkProfileIds.COLD_ALGORITHM) {
    return {
      disable_identity_result_cache_read: true,
      disable_identity_result_cache_write: true,
      disable_approved_identity_memory: true,
      disable_writer_final_replay: true,
      disable_identity_inflight_replay: true,
      exact_anchor_fast_final_shadow_only: true,
      disable_recognition_worker_fast_final: true,
      recognition_worker_preflight_shadow_only: true,
      trace_level: "evaluation"
    };
  }
  if (profile === recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST) {
    return {
      disable_identity_result_cache_read: true,
      disable_identity_result_cache_write: true,
      disable_approved_identity_memory: true,
      disable_writer_final_replay: true,
      disable_identity_inflight_replay: true,
      exact_anchor_fast_final_shadow_only: true,
      disable_recognition_worker_fast_final: true,
      recognition_worker_preflight_shadow_only: true,
      trace_level: "evaluation",
      enable_targeted_visual_assist_candidate: true,
      enable_world_knowledge_assist_candidate: false,
      targeted_assist_variant: "VISUAL_ONLY"
    };
  }
  if (profile === recognitionBenchmarkProfileIds.EXACT_REPLAY) {
    if (![exactReplayPhases.COLD, exactReplayPhases.REPLAY].includes(phase)) {
      throw new Error("Exact Replay Benchmark requires phase=cold or phase=replay.");
    }
    return {
      disable_identity_result_cache_read: phase === exactReplayPhases.COLD,
      disable_identity_result_cache_write: phase === exactReplayPhases.REPLAY,
      disable_approved_identity_memory: true,
      disable_writer_final_replay: true,
      disable_identity_inflight_replay: true,
      exact_anchor_fast_final_shadow_only: true,
      disable_recognition_worker_fast_final: true
    };
  }
  if (profile === recognitionBenchmarkProfileIds.PRODUCTION_WORKLOAD) return {};
  throw new Error(`Unknown recognition benchmark profile: ${profile}`);
}

export function applyRecognitionBenchmarkProfile(providerOptions = {}, { profile, phase = null } = {}) {
  return {
    ...providerOptions,
    ...optionsFor(profile, phase),
    recognition_benchmark_profile: profile,
    recognition_benchmark_phase: phase
  };
}

function providerCalls(result = {}) {
  const value = Number(
    result.provider_calls
    ?? result.usage?.provider_calls
    ?? result.provider_result_summary?.provider_calls
  );
  return Number.isFinite(value) ? value : null;
}

function identityCacheHit(result = {}) {
  return result.identity_cache_hit === true || result.identity_cache?.cache_hit === true;
}

function providerCallSkipped(result = {}) {
  return result.provider_call_skipped === true || result.identity_cache?.provider_call_skipped === true;
}

function implicitProviderRetryAttempted(result = {}) {
  return result.provider_transient_retry_attempted === true
    || result.provider_output_cap_downgrade_attempted === true
    || result.provider_truncation_retry_attempted === true
    || result.provider_key_rotation_attempted === true
    || result.gpt5_empty_result_retry_attempted === true;
}

function assertNoWholeJobRetry(result = {}, profile = "cold_algorithm") {
  const attemptCount = Number(result.attempt_count);
  if (!Number.isInteger(attemptCount) || attemptCount !== 1) {
    throw new Error(`${profile}_job_attempt_count_expected_1_received_${Number.isFinite(attemptCount) ? attemptCount : "missing"}`);
  }
  if (!Array.isArray(result.retry_attempt_history) || !Array.isArray(result.retry_error_codes)) {
    throw new Error(`${profile}_job_retry_trace_required`);
  }
  if (result.retry_attempt_history.length > 0 || result.retry_error_codes.length > 0) {
    throw new Error(`${profile}_whole_job_retry_forbidden`);
  }
}

function resolverSnapshot(result = {}) {
  return JSON.stringify({
    identity_resolution_status: result.identity_resolution_status ?? null,
    ambiguity_status: result.ambiguity_status ?? null,
    resolved: result.resolved ?? {},
    field_states: result.field_states ?? {}
  });
}

export function assertColdAlgorithmBenchmarkResult(result = {}) {
  assertNoWholeJobRetry(result, "cold_algorithm");
  if (identityCacheHit(result)) throw new Error("cold_algorithm_identity_cache_hit");
  if (providerCallSkipped(result)) throw new Error("cold_algorithm_provider_call_skipped");
  if (providerCalls(result) !== 1) throw new Error(`cold_algorithm_provider_calls_expected_1_received_${providerCalls(result)}`);
  if (implicitProviderRetryAttempted(result)) {
    throw new Error("cold_algorithm_implicit_provider_retry_forbidden");
  }
  return true;
}

function targetedCallLedger(result = {}) {
  const direct = result.provider_call_ledger;
  const nested = result.targeted_assist_execution?.provider_call_ledger;
  return Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : [];
}

function resultBenchmarkProfile(result = {}) {
  return String(
    result.recognition_benchmark_profile
    || result.provider_options?.recognition_benchmark_profile
    || result.providerOptions?.recognition_benchmark_profile
    || ""
  ).trim();
}

function ledgerProviderCalls(ledger = []) {
  return ledger.reduce((sum, row) => sum + Math.max(0, Number(row?.provider_calls || 0)), 0);
}

function stageLedgerRows(ledger = [], stage = "") {
  return ledger.filter((row) => String(row?.logical_stage || "") === stage);
}

export function assertColdTargetedAssistBenchmarkResult(result = {}) {
  if (resultBenchmarkProfile(result) !== recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST) {
    throw new Error("cold_targeted_assist_profile_mismatch");
  }
  assertNoWholeJobRetry(result, "cold_targeted_assist");
  if (identityCacheHit(result)) throw new Error("cold_targeted_assist_identity_cache_hit");
  if (providerCallSkipped(result)) throw new Error("cold_targeted_assist_provider_call_skipped");
  const ledger = targetedCallLedger(result);
  const stages = ledger.map((row) => String(row?.logical_stage || ""));
  const sequence = stages.join("->");
  const allowed = new Set([
    "FULL_PROVIDER_OBSERVATION",
    "TARGETED_VISUAL_OBSERVATION",
    "TARGETED_VISUAL_OBSERVATION->FULL_PROVIDER_OBSERVATION"
  ]);
  if (!allowed.has(sequence)) throw new Error(`cold_targeted_assist_invalid_call_sequence_${sequence || "empty"}`);
  if (stages.includes("WORLD_KNOWLEDGE_ASSIST")) throw new Error("cold_targeted_assist_world_knowledge_call_forbidden");
  if (ledgerProviderCalls(ledger) !== providerCalls(result)) {
    throw new Error(`cold_targeted_assist_call_ledger_mismatch_${ledgerProviderCalls(ledger)}_${providerCalls(result)}`);
  }
  if (ledger.some((row) => row?.attempt !== 1)) throw new Error("cold_targeted_assist_retry_forbidden");
  if (ledger.some((row) => (
    !String(row?.started_at || "").trim()
    || !String(row?.completed_at || "").trim()
    || !Number.isFinite(Date.parse(row.started_at))
    || !Number.isFinite(Date.parse(row.completed_at))
    || Date.parse(row.started_at) > Date.parse(row.completed_at)
    || row?.latency_ms === null
    || row?.latency_ms === undefined
    || row?.latency_ms === ""
    || !Number.isFinite(Number(row?.latency_ms))
    || Number(row.latency_ms) < 0
    || !["COMPLETED", "FAILED"].includes(String(row?.status || ""))
  ))) throw new Error("cold_targeted_assist_call_ledger_incomplete");
  const targetedRows = stageLedgerRows(ledger, "TARGETED_VISUAL_OBSERVATION");
  const fullRows = stageLedgerRows(ledger, "FULL_PROVIDER_OBSERVATION");
  if (targetedRows.some((row) => (
    !String(row?.prompt_revision || "").trim()
    || !String(row?.schema_revision || "").trim()
    || ![0, 1].includes(Number(row?.provider_calls))
  ))) throw new Error("cold_targeted_assist_targeted_ledger_contract_incomplete");
  if (fullRows.some((row) => Number(row?.provider_calls) !== 1)) {
    throw new Error("cold_targeted_assist_full_provider_call_count_invalid");
  }
  const execution = result.targeted_assist_execution || {};
  if (sequence === "TARGETED_VISUAL_OBSERVATION" && execution.final_observation_owner !== "TARGETED_VISUAL_OBSERVATION") {
    throw new Error("cold_targeted_assist_targeted_owner_mismatch");
  }
  if (sequence === "TARGETED_VISUAL_OBSERVATION"
    && (Number(targetedRows[0]?.provider_calls) !== 1 || targetedRows[0]?.status !== "COMPLETED")) {
    throw new Error("cold_targeted_assist_targeted_success_not_paid_completed");
  }
  if (sequence.endsWith("FULL_PROVIDER_OBSERVATION") && execution.final_observation_owner !== "FULL_PROVIDER_OBSERVATION") {
    throw new Error("cold_targeted_assist_full_owner_mismatch");
  }
  if (sequence.includes("->") && !String(execution.fallback_reason_code || "").trim()) {
    throw new Error("cold_targeted_assist_fallback_reason_missing");
  }
  if (ledger.length === 2) {
    const targetedCompleted = Date.parse(ledger[0]?.completed_at || "");
    const fullStarted = Date.parse(ledger[1]?.started_at || "");
    if (!Number.isFinite(targetedCompleted) || !Number.isFinite(fullStarted) || targetedCompleted > fullStarted) {
      throw new Error("cold_targeted_assist_fallback_order_invalid");
    }
  }
  if (implicitProviderRetryAttempted(result)) {
    throw new Error("cold_targeted_assist_implicit_provider_retry_forbidden");
  }
  if ("provider_raw_response" in result || "provider_content" in result) {
    throw new Error("cold_targeted_assist_raw_response_forbidden");
  }
  return true;
}

export function assertExactReplayBenchmarkPair(cold = {}, replay = {}) {
  assertColdAlgorithmBenchmarkResult(cold);
  if (providerCalls(replay) !== 0) throw new Error(`exact_replay_provider_calls_expected_0_received_${providerCalls(replay)}`);
  if (String(cold.final_title || cold.title || "") !== String(replay.final_title || replay.title || "")) {
    throw new Error("exact_replay_title_mismatch");
  }
  if (resolverSnapshot(cold) !== resolverSnapshot(replay)) throw new Error("exact_replay_resolver_state_mismatch");
  return true;
}

export function summarizeProductionWorkloadBenchmark(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const hits = rows.filter(identityCacheHit).length;
  return {
    profile: recognitionBenchmarkProfileIds.PRODUCTION_WORKLOAD,
    sample_count: rows.length,
    identity_cache_hit_count: hits,
    identity_cache_hit_rate: rows.length ? hits / rows.length : null,
    provider_calls: rows.reduce((sum, result) => sum + (providerCalls(result) || 0), 0)
  };
}

export const __recognitionBenchmarkProfileTestHooks = Object.freeze({
  assertNoWholeJobRetry,
  identityCacheHit,
  implicitProviderRetryAttempted,
  ledgerProviderCalls,
  providerCalls,
  providerCallSkipped,
  resolverSnapshot,
  resultBenchmarkProfile,
  stageLedgerRows,
  targetedCallLedger
});
