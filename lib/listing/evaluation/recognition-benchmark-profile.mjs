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
      disable_identity_inflight_replay: true
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
      disable_identity_inflight_replay: true
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
  const value = Number(result.usage?.provider_calls ?? result.provider_result_summary?.provider_calls);
  return Number.isFinite(value) ? value : null;
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
  if (result.identity_cache?.cache_hit === true) throw new Error("cold_algorithm_identity_cache_hit");
  if (result.identity_cache?.provider_call_skipped === true) throw new Error("cold_algorithm_provider_call_skipped");
  if (providerCalls(result) !== 1) throw new Error(`cold_algorithm_provider_calls_expected_1_received_${providerCalls(result)}`);
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
  const hits = rows.filter((result) => result.identity_cache?.cache_hit === true).length;
  return {
    profile: recognitionBenchmarkProfileIds.PRODUCTION_WORKLOAD,
    sample_count: rows.length,
    identity_cache_hit_count: hits,
    identity_cache_hit_rate: rows.length ? hits / rows.length : null,
    provider_calls: rows.reduce((sum, result) => sum + (providerCalls(result) || 0), 0)
  };
}

export const __recognitionBenchmarkProfileTestHooks = Object.freeze({ providerCalls, resolverSnapshot });
