export const recognitionBenchmarkProfileIds = Object.freeze({
  COLD_ALGORITHM: "cold_algorithm_benchmark",
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
      disable_nonessential_evaluation_writes: true,
      trace_level: "evaluation"
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
      disable_recognition_worker_fast_final: true,
      disable_nonessential_evaluation_writes: true
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
  const value = Number(result.usage?.provider_calls ?? result.provider_result_summary?.provider_calls ?? result.provider_calls);
  return Number.isFinite(value) ? value : null;
}

function resolverSnapshot(result = {}) {
  return JSON.stringify({
    identity_resolution_status: result.identity_resolution_status ?? null,
    ambiguity_status: result.ambiguity_status ?? null,
    resolved: result.resolved ?? result.resolved_fields ?? {},
    field_states: result.field_states ?? {}
  });
}

function cacheTelemetry(result = {}) {
  return {
    cache_hit: result.identity_cache?.cache_hit === true || result.identity_cache_hit === true,
    provider_call_skipped: result.identity_cache?.provider_call_skipped === true || result.provider_call_skipped === true,
    cached_result_version_match: result.identity_cache?.cached_result_version_match
      ?? result.cached_result_version_match
      ?? null
  };
}

export function assertColdAlgorithmBenchmarkResult(result = {}) {
  const cache = cacheTelemetry(result);
  if (cache.cache_hit) throw new Error("cold_algorithm_identity_cache_hit");
  if (cache.provider_call_skipped) throw new Error("cold_algorithm_provider_call_skipped");
  if (providerCalls(result) !== 1) throw new Error(`cold_algorithm_provider_calls_expected_1_received_${providerCalls(result)}`);
  return true;
}

export function assertExactReplayBenchmarkPair(cold = {}, replay = {}) {
  assertColdAlgorithmBenchmarkResult(cold);
  const cache = cacheTelemetry(replay);
  if (providerCalls(replay) !== 0) throw new Error(`exact_replay_provider_calls_expected_0_received_${providerCalls(replay)}`);
  if (!cache.cache_hit) throw new Error("exact_replay_identity_cache_hit_expected_true");
  if (!cache.provider_call_skipped) throw new Error("exact_replay_provider_call_skipped_expected_true");
  if (cache.cached_result_version_match !== true) throw new Error("exact_replay_cached_result_version_match_expected_true");
  if (String(cold.final_title || cold.title || "") !== String(replay.final_title || replay.title || "")) {
    throw new Error("exact_replay_title_mismatch");
  }
  if (resolverSnapshot(cold) !== resolverSnapshot(replay)) throw new Error("exact_replay_resolver_state_mismatch");
  return true;
}

export function summarizeProductionWorkloadBenchmark(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const hits = rows.filter((result) => cacheTelemetry(result).cache_hit).length;
  return {
    profile: recognitionBenchmarkProfileIds.PRODUCTION_WORKLOAD,
    sample_count: rows.length,
    identity_cache_hit_count: hits,
    identity_cache_hit_rate: rows.length ? hits / rows.length : null,
    provider_calls: rows.reduce((sum, result) => sum + (providerCalls(result) || 0), 0)
  };
}

export const __recognitionBenchmarkProfileTestHooks = Object.freeze({ providerCalls, resolverSnapshot, cacheTelemetry });
