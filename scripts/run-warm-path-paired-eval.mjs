#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertExactReplayBenchmarkPair } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import { resolveListingEvalCredentials } from "./listing-eval-credentials.mjs";
import { preflightArm } from "./run-paired-eval.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values = []) {
  const rows = values.map(finite).filter((value) => value !== null);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

function quantile(values = [], percentile = 0.5) {
  const rows = values.map(finite).filter((value) => value !== null).sort((left, right) => left - right);
  if (!rows.length) return null;
  const index = Math.max(0, Math.min(rows.length - 1, Math.ceil(percentile * rows.length) - 1));
  return rows[index];
}

function identityKey(row = {}, index = 0) {
  return row.identity_cache_image_generation_hash
    || row.source_asset_id
    || row.source_feedback_id
    || row.physical_card_id
    || row.asset_id
    || `row-${index}`;
}

function requireComplete(row = {}, phase = "unknown") {
  if (row.ok !== true || row.l2_ready !== true || row.writer_ready !== true || row.error) {
    throw new Error(`${phase}_result_not_writer_ready:${row.job_id || row.asset_id || "unknown"}`);
  }
}

export function validateWarmPairReports(coldReport = {}, replayReport = {}, { expectedCount } = {}) {
  const coldRows = Array.isArray(coldReport.results) ? coldReport.results : [];
  const replayRows = Array.isArray(replayReport.results) ? replayReport.results : [];
  if (coldRows.length !== expectedCount || replayRows.length !== expectedCount) {
    throw new Error(
      `warm_pair_count_mismatch:expected=${expectedCount},cold=${coldRows.length},replay=${replayRows.length}`
    );
  }

  const pairs = coldRows.map((cold, index) => {
    const replay = replayRows[index];
    requireComplete(cold, "cold");
    requireComplete(replay, "replay");
    const coldKey = identityKey(cold, index);
    const replayKey = identityKey(replay, index);
    if (coldKey !== replayKey) throw new Error(`warm_pair_identity_mismatch:${coldKey}:${replayKey}`);
    assertExactReplayBenchmarkPair(cold, replay);
    if (cold.identity_cache_version_fingerprint
      && replay.identity_cache_version_fingerprint
      && cold.identity_cache_version_fingerprint !== replay.identity_cache_version_fingerprint) {
      throw new Error(`warm_pair_fingerprint_mismatch:${coldKey}`);
    }
    return { cold, replay, identity_key: coldKey };
  });

  const coldScores = pairs.map(({ cold }) => cold.final_scoring?.policy_fair_token_recall);
  const replayScores = pairs.map(({ replay }) => replay.final_scoring?.policy_fair_token_recall);
  const hitCount = pairs.filter(({ replay }) => replay.identity_cache_hit === true).length;
  const skippedCount = pairs.filter(({ replay }) => replay.provider_call_skipped === true).length;
  const versionMatchCount = pairs.filter(({ replay }) => replay.cached_result_version_match === true).length;
  return {
    sample_count: pairs.length,
    cold_accuracy: average(coldScores),
    replay_accuracy: average(replayScores),
    accuracy_delta: average(replayScores) === null || average(coldScores) === null
      ? null
      : average(replayScores) - average(coldScores),
    identity_cache_hit_count: hitCount,
    identity_cache_hit_rate: pairs.length ? hitCount / pairs.length : null,
    provider_call_skipped_count: skippedCount,
    cached_result_version_match_count: versionMatchCount,
    cold_provider_calls: pairs.reduce((sum, { cold }) => sum + Number(cold.provider_calls || 0), 0),
    replay_provider_calls: pairs.reduce((sum, { replay }) => sum + Number(replay.provider_calls || 0), 0),
    cold_writer_visible_p50_ms: quantile(pairs.map(({ cold }) => cold.writer_visible_recognition_ms), 0.5),
    cold_writer_visible_p95_ms: quantile(pairs.map(({ cold }) => cold.writer_visible_recognition_ms), 0.95),
    replay_writer_visible_p50_ms: quantile(pairs.map(({ replay }) => replay.writer_visible_recognition_ms), 0.5),
    replay_writer_visible_p95_ms: quantile(pairs.map(({ replay }) => replay.writer_visible_recognition_ms), 0.95),
    cold_writer_ready_p50_ms: quantile(pairs.map(({ cold }) => cold.time_to_writer_ready_ms), 0.5),
    cold_writer_ready_p95_ms: quantile(pairs.map(({ cold }) => cold.time_to_writer_ready_ms), 0.95),
    replay_writer_ready_p50_ms: quantile(pairs.map(({ replay }) => replay.time_to_writer_ready_ms), 0.5),
    replay_writer_ready_p95_ms: quantile(pairs.map(({ replay }) => replay.time_to_writer_ready_ms), 0.95)
  };
}

async function readReport(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function runSmoke({ baseUrl, dataset, sealedLabels, outPath, assetCachePath, model, limit, l2WaitMs, phase, env }) {
  const args = [
    "--use-env-proxy",
    "scripts/v4-ebay-smoke.mjs",
    "--base-url", baseUrl,
    "--model", model,
    "--queue", "--speculative", "--use-preingestion",
    "--ultra-image-detail", "high",
    "--concurrency", "2", "--preparation-concurrency", "2", "--submission-concurrency", "2",
    "--abort-on-preparation-failure",
    "--benchmark-profile", "exact-replay",
    "--benchmark-phase", phase,
    "--sample-mode", "PAIRED_ABLATION",
    "--dataset", dataset,
    "--sealed-labels", sealedLabels,
    "--limit", String(limit),
    "--l2-wait-ms", String(l2WaitMs),
    "--verified-asset-cache", assetCachePath,
    "--verified-asset-cache-mode", "reuse",
    "--out", outPath
  ];
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"], env });
    child.on("error", rejectRun);
    child.on("close", (code) => (code === 0
      ? resolveRun()
      : rejectRun(new Error(`warm ${phase} smoke exited ${code}`))));
  });
}

export async function main(argv = process.argv.slice(2)) {
  const baselineUrl = argValue(argv, "--baseline-url", "https://listing.lyncafei.team");
  const candidateUrl = argValue(argv, "--candidate-url", "");
  const dataset = argValue(argv, "--dataset", "artifacts/smoke/cold20.json");
  const sealedLabels = argValue(argv, "--sealed-labels", "artifacts/smoke/cold20-labels.jsonl");
  const model = argValue(argv, "--model", "gpt-5-mini");
  const limit = Math.max(1, Number(argValue(argv, "--limit", "20")) || 20);
  const rounds = Math.max(1, Number(argValue(argv, "--rounds", "1")) || 1);
  const l2WaitMs = Math.max(18_000, Number(argValue(argv, "--l2-wait-ms", "18000")) || 18_000);
  const outDir = resolve(argValue(argv, "--out-dir", "artifacts/smoke/warm-path-paired-eval"));
  const label = argValue(argv, "--label", "warm-path");
  if (!candidateUrl) throw new Error("--candidate-url is required");
  const credentials = resolveListingEvalCredentials(process.env);
  if (!credentials.username || !credentials.password) throw new Error("listing evaluation credentials are missing");
  await mkdir(outDir, { recursive: true });

  const arms = {
    baseline: { base_url: baselineUrl, rounds: [] },
    candidate: { base_url: candidateUrl, rounds: [] }
  };
  for (let round = 1; round <= rounds; round += 1) {
    const order = round % 2 === 1 ? ["baseline", "candidate"] : ["candidate", "baseline"];
    for (const armName of order) {
      const arm = arms[armName];
      process.stderr.write(`round ${round}/${rounds} ${armName} preflight\n`);
      const preflight = await preflightArm({
        baseUrl: arm.base_url,
        username: credentials.username,
        password: credentials.password,
        env: credentials.env
      });
      const runEnv = { ...credentials.env, LISTING_EVAL_SESSION_COOKIE: preflight.cookie };
      const prefix = resolve(outDir, `${label}-${armName}-r${round}`);
      const coldPath = `${prefix}-cold.json`;
      const replayPath = `${prefix}-replay.json`;
      const assetCachePath = resolve(outDir, `${label}-${armName}-verified-assets.json`);
      await runSmoke({
        baseUrl: arm.base_url, dataset, sealedLabels, outPath: coldPath,
        assetCachePath, model, limit, l2WaitMs, phase: "cold", env: runEnv
      });
      await runSmoke({
        baseUrl: arm.base_url, dataset, sealedLabels, outPath: replayPath,
        assetCachePath, model, limit, l2WaitMs, phase: "replay", env: runEnv
      });
      const metrics = validateWarmPairReports(
        await readReport(coldPath),
        await readReport(replayPath),
        { expectedCount: limit }
      );
      arm.rounds.push({ round, cold_report: coldPath, replay_report: replayPath, metrics });
      process.stderr.write(
        `  ${armName} warm hit=${(metrics.identity_cache_hit_rate * 100).toFixed(1)}%`
        + ` provider=${metrics.cold_provider_calls}->${metrics.replay_provider_calls}`
        + ` writer-ready-p95=${metrics.cold_writer_ready_p95_ms}->${metrics.replay_writer_ready_p95_ms}ms\n`
      );
    }
  }

  const summary = {
    schema_version: "warm-path-paired-eval-v1",
    generated_at: new Date().toISOString(),
    label,
    dataset,
    sealed_labels: sealedLabels,
    limit,
    rounds_completed: rounds,
    exact_replay_gate: {
      identity_cache_hit_rate_required: 1,
      provider_calls_required: "1_to_0_per_card",
      title_and_resolver_exact_match_required: true,
      cached_result_version_match_required: true
    },
    arms
  };
  const summaryPath = resolve(outDir, `${label}.json`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${summaryPath}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
