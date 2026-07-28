import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  assertExactReplayBenchmarkPair,
  exactReplayPhases,
  recognitionBenchmarkProfileIds
} from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";

function cleanText(value) {
  return String(value ?? "").trim();
}

function reportRows(report = {}) {
  return Array.isArray(report.results) ? report.results : [];
}

function benchmarkPhase(report = {}) {
  return cleanText(
    report?.summary?.recognition_benchmark_phase
    || report?.recognition_benchmark_phase
  ).toLowerCase();
}

function benchmarkProfile(report = {}) {
  return cleanText(
    report?.summary?.recognition_benchmark_profile
    || report?.recognition_benchmark_profile
  ).toLowerCase();
}

function cacheIdentity(row = {}) {
  return {
    cache_key: row.identity_cache_key || row.identity_cache?.cache_key || null,
    image_generation_hash: row.identity_cache_image_generation_hash
      || row.identity_cache?.image_generation_hash
      || null,
    recognition_pipeline_fingerprint: row.identity_cache_version_fingerprint
      || row.identity_cache?.recognition_pipeline_fingerprint
      || row.identity_cache?.version_fingerprint
      || null
  };
}

function benchmarkResult(row = {}) {
  const identity = cacheIdentity(row);
  return {
    ...row,
    identity_cache: {
      ...(row.identity_cache || {}),
      ...identity,
      cache_hit: row.identity_cache_hit ?? row.identity_cache?.cache_hit ?? false,
      provider_call_skipped: row.provider_call_skipped ?? row.identity_cache?.provider_call_skipped ?? false,
      cached_result_version_match: row.cached_result_version_match
        ?? row.identity_cache?.cached_result_version_match
        ?? null,
      write_saved: row.identity_cache_write_saved ?? row.identity_cache?.write_saved ?? null
    },
    usage: {
      ...(row.usage || {}),
      provider_calls: row.provider_calls ?? row.usage?.provider_calls ?? null
    },
    resolver_replay_snapshot: row.resolver_replay_snapshot || null
  };
}

function pairKey(row = {}) {
  const identity = cacheIdentity(row);
  return cleanText(identity.cache_key || identity.image_generation_hash);
}

export function verifyExactReplayBenchmarkReports(coldReport = {}, replayReport = {}) {
  for (const [label, report, phase] of [
    ["cold", coldReport, exactReplayPhases.COLD],
    ["replay", replayReport, exactReplayPhases.REPLAY]
  ]) {
    if (benchmarkProfile(report) !== recognitionBenchmarkProfileIds.EXACT_REPLAY) {
      throw new Error(`exact_replay_${label}_report_profile_invalid`);
    }
    if (benchmarkPhase(report) !== phase) {
      throw new Error(`exact_replay_${label}_report_phase_invalid`);
    }
  }

  const coldRows = reportRows(coldReport);
  const replayRows = reportRows(replayReport);
  if (!coldRows.length || coldRows.length !== replayRows.length) {
    throw new Error("exact_replay_report_cardinality_mismatch");
  }
  const replayByKey = new Map();
  for (const row of replayRows) {
    const key = pairKey(row);
    if (!key || replayByKey.has(key)) throw new Error("exact_replay_replay_identity_not_unique");
    replayByKey.set(key, row);
  }
  for (const coldRow of coldRows) {
    const key = pairKey(coldRow);
    if (!key) throw new Error("exact_replay_cold_identity_missing");
    const replayRow = replayByKey.get(key);
    if (!replayRow) throw new Error("exact_replay_pair_missing");
    assertExactReplayBenchmarkPair(benchmarkResult(coldRow), benchmarkResult(replayRow));
    replayByKey.delete(key);
  }
  if (replayByKey.size) throw new Error("exact_replay_unpaired_replay_rows");
  return {
    ok: true,
    profile: recognitionBenchmarkProfileIds.EXACT_REPLAY,
    pair_count: coldRows.length
  };
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? cleanText(argv[index + 1]) : "";
}

export async function main(argv = process.argv.slice(2)) {
  const coldPath = argValue(argv, "--cold");
  const replayPath = argValue(argv, "--replay");
  if (!coldPath || !replayPath) throw new Error("Usage: --cold <report.json> --replay <report.json>");
  const [coldReport, replayReport] = await Promise.all([
    readFile(coldPath, "utf8").then(JSON.parse),
    readFile(replayPath, "utf8").then(JSON.parse)
  ]);
  const result = verifyExactReplayBenchmarkReports(coldReport, replayReport);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
