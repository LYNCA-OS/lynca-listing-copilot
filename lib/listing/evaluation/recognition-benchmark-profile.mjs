import {
  buildAuthoritativeResolverReplaySnapshot,
  identityCacheResolverSnapshotVersion
} from "../cache/identity-result-cache.mjs";

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
  const raw = result.usage?.provider_calls ?? result.provider_result_summary?.provider_calls;
  if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function resolverSnapshot(result = {}) {
  const snapshot = result.resolver_replay_snapshot?.snapshot_version === identityCacheResolverSnapshotVersion
    ? result.resolver_replay_snapshot
    : buildAuthoritativeResolverReplaySnapshot(result);
  return JSON.stringify(snapshot);
}

function requiredCacheIdentity(result = {}, phase = "") {
  const cache = result.identity_cache || {};
  const required = {
    cache_key: cache.cache_key,
    image_generation_hash: cache.image_generation_hash,
    recognition_pipeline_fingerprint: cache.recognition_pipeline_fingerprint || cache.version_fingerprint
  };
  for (const [field, value] of Object.entries(required)) {
    if (!String(value || "").trim()) throw new Error(`exact_replay_${phase}_${field}_required`);
  }
  return required;
}

export function assertColdAlgorithmBenchmarkResult(result = {}) {
  if (result.identity_cache?.cache_hit === true) throw new Error("cold_algorithm_identity_cache_hit");
  if (result.identity_cache?.provider_call_skipped === true) throw new Error("cold_algorithm_provider_call_skipped");
  if (providerCalls(result) !== 1) throw new Error(`cold_algorithm_provider_calls_expected_1_received_${providerCalls(result)}`);
  return true;
}

export function assertExactReplayBenchmarkPhaseResult(result = {}, phase = "") {
  if (phase === exactReplayPhases.COLD) {
    assertColdAlgorithmBenchmarkResult(result);
    if (result.identity_cache?.write_saved !== true) throw new Error("exact_replay_cold_cache_write_required");
    requiredCacheIdentity(result, "cold");
    return true;
  }
  if (phase === exactReplayPhases.REPLAY) {
    if (providerCalls(result) !== 0) {
      throw new Error(`exact_replay_provider_calls_expected_0_received_${providerCalls(result)}`);
    }
    if (result.identity_cache?.cache_hit !== true) throw new Error("exact_replay_cache_hit_required");
    if (result.identity_cache?.provider_call_skipped !== true) throw new Error("exact_replay_provider_call_skipped_required");
    if (result.identity_cache?.cached_result_version_match !== true) throw new Error("exact_replay_version_match_required");
    requiredCacheIdentity(result, "replay");
    return true;
  }
  throw new Error(`exact_replay_phase_invalid_${String(phase || "missing")}`);
}

export function assertExactReplayBenchmarkPair(cold = {}, replay = {}) {
  assertExactReplayBenchmarkPhaseResult(cold, exactReplayPhases.COLD);
  const coldIdentity = requiredCacheIdentity(cold, "cold");
  assertExactReplayBenchmarkPhaseResult(replay, exactReplayPhases.REPLAY);
  const replayIdentity = requiredCacheIdentity(replay, "replay");
  for (const field of Object.keys(coldIdentity)) {
    if (coldIdentity[field] !== replayIdentity[field]) throw new Error(`exact_replay_${field}_mismatch`);
  }
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
