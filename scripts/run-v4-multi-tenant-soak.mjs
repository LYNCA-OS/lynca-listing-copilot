#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeV4StabilityEnvelope } from "../lib/listing/v4/jobs/stability-envelope.mjs";
import { normalizeEvaluationSampleMode } from "../lib/listing/evaluation/sample-policy.mjs";
import { perCardTsv, runV4EbaySmoke, summarize } from "./v4-ebay-smoke.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

export function numberArg(argv, name, fallback) {
  const rawValue = argValue(argv, name, "");
  if (String(rawValue).trim() === "") return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function writeJson(path, value) {
  const output = resolve(path);
  if (!existsSync(dirname(output))) await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, value) {
  const output = resolve(path);
  if (!existsSync(dirname(output))) await mkdir(dirname(output), { recursive: true });
  await writeFile(output, value);
}

export function datasetItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || dataset.cards || [];
}

export function soakSamplePolicy(dataset = {}) {
  const source = !Array.isArray(dataset) && dataset.evaluation_sample_policy
    ? dataset.evaluation_sample_policy
    : {};
  const mode = normalizeEvaluationSampleMode(source.mode || "UNSPECIFIED");
  return {
    ...source,
    mode,
    sample_reuse_permitted: source.sample_reuse_permitted === true,
    generalization_claim_permitted: source.generalization_claim_permitted === true,
    same_sample_required: source.same_sample_required === true,
    cross_wave_overlap_permitted: false
  };
}

export function buildV4SoakWavePlan({ totalItems = 0, limit = 100, waveSize = 20 } = {}) {
  const available = Math.max(0, Math.trunc(Number(totalItems) || 0));
  const requested = Math.max(1, Math.trunc(Number(limit) || 1));
  const size = Math.max(1, Math.trunc(Number(waveSize) || 1));
  const count = Math.min(available, requested);
  const waves = [];
  for (let offset = 0; offset < count; offset += size) {
    waves.push({
      wave_index: waves.length,
      wave_id: `wave-${waves.length + 1}`,
      offset,
      limit: Math.min(size, count - offset)
    });
  }
  return waves;
}

export async function runV4MultiTenantSoak({
  datasetPath,
  sealedLabelsPath,
  baseUrl,
  username,
  password,
  limit = 100,
  waveSize = 20,
  tenantCount = 5,
  concurrency = 2,
  submissionConcurrency = null,
  modelOverride = "gpt-5-mini",
  thinkMs = 5000,
  l2WaitMs = 3_600_000,
  requestTimeoutMs = 120_000,
  coldStartBlind = false,
  outPath = "",
  stabilityOutPath = "",
  waveOutDir = "",
  runId = `v4-soak-${Date.now()}`,
  progress = true
} = {}) {
  if (!datasetPath) throw new Error("--dataset is required");
  const normalizedColdStartBlind = coldStartBlind === true;
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const datasetPolicy = soakSamplePolicy(dataset);
  const reviewedTitleGroundTruth = !Array.isArray(dataset)
    && dataset.accuracy_policy?.corrected_title_is_reviewed_title_ground_truth === true;
  const plan = buildV4SoakWavePlan({
    totalItems: datasetItems(dataset).length,
    limit,
    waveSize
  });
  if (!plan.length) throw new Error("dataset has no items for the requested soak");
  const outputDirectory = resolve(waveOutDir || `${dirname(resolve(outPath || "data/eval/v4-stability-soak.json"))}/${runId}-waves`);
  await mkdir(outputDirectory, { recursive: true });
  const reports = [];
  const startedAt = Date.now();
  for (const wave of plan) {
    if (progress) process.stderr.write(`v4 stability soak ${wave.wave_id}/${plan.length} offset=${wave.offset} limit=${wave.limit}\n`);
    const report = await runV4EbaySmoke({
      datasetPath,
      sealedLabelsPath,
      baseUrl,
      username,
      password,
      limit: wave.limit,
      offset: wave.offset,
      prewarm: true,
      prewarmCacheOnly: true,
      queueMode: true,
      forceL2Direct: true,
      modelOverride,
      enableL1: false,
      disableIdentityCache: true,
      coldStartBlind: normalizedColdStartBlind,
      usePreingestion: true,
      preingestionSource: "v4_multi_tenant_stability_soak",
      speculative: true,
      thinkMs,
      l2WaitMs,
      requestTimeoutMs,
      concurrency,
      submissionConcurrency,
      tenantCount,
      tenantPrefix: `${runId}-client`,
      batchPoll: true,
      evaluationSampleMode: datasetPolicy.mode,
      progress
    });
    const soakElapsedMs = Date.now() - startedAt;
    const cumulativeAttemptedCount = reports.reduce(
      (sum, prior) => sum + Number(prior.summary?.attempted_count || prior.results?.length || 0),
      0
    ) + Number(report.summary?.attempted_count || report.results?.length || 0);
    const waveReport = {
      ...report,
      wave_id: wave.wave_id,
      soak_run_id: runId,
      wave_index: wave.wave_index,
      wave_plan: wave,
      soak_elapsed_ms: soakElapsedMs,
      cumulative_attempted_count: cumulativeAttemptedCount
    };
    reports.push(waveReport);
    await writeJson(`${outputDirectory}/${wave.wave_id}.json`, waveReport);
    await writeText(`${outputDirectory}/${wave.wave_id}.tsv`, perCardTsv(waveReport.results || []));
  }
  const totalWallMs = Date.now() - startedAt;
  const allResults = reports.flatMap((report) => report.results || []);
  const stability = analyzeV4StabilityEnvelope(reports, {
    minimumWaves: 3,
    minimumCards: 50,
    minimumTenants: 3,
    requireFreshSamples: ["FRESH_GENERALIZATION", "CONCURRENCY_FRESH"].includes(datasetPolicy.mode)
  });
  const aggregate = {
    schema_version: "v4-multi-tenant-soak-v1",
    generated_at: new Date().toISOString(),
    soak_run_id: runId,
    base_url: baseUrl,
    dataset_path: datasetPath,
    sealed_labels_path: sealedLabelsPath || null,
    model_override: modelOverride || null,
    configured_concurrency: concurrency,
    configured_submission_concurrency: submissionConcurrency ?? concurrency,
    cold_start_blind: normalizedColdStartBlind,
    tenant_count: tenantCount,
    wave_size: waveSize,
    wave_count: reports.length,
    run_wall_ms: totalWallMs,
    evaluation_sample_policy: {
      ...datasetPolicy,
      cold_start_blind: normalizedColdStartBlind,
      evaluated_item_count: allResults.length
    },
    blind_policy: {
      cold_start_blind: normalizedColdStartBlind,
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: !reviewedTitleGroundTruth,
      seller_title_is_ground_truth: false,
      reviewed_title_visible_to_model: false,
      reviewed_title_used_for_local_eval_only: reviewedTitleGroundTruth,
      reviewed_title_is_title_ground_truth: reviewedTitleGroundTruth,
      reviewed_title_is_field_ground_truth: false,
      predictions_frozen_before_scoring: true
    },
    wave_reports: reports.map((report) => ({
      wave_id: report.wave_id,
      offset: report.offset,
      limit: report.limit,
      shared_batch_id: report.shared_batch_id,
      run_wall_ms: report.run_wall_ms,
      soak_elapsed_ms: report.soak_elapsed_ms,
      cumulative_attempted_count: report.cumulative_attempted_count,
      attempted_count: report.summary?.attempted_count,
      ok_count: report.summary?.ok_count,
      report_path: `${outputDirectory}/${report.wave_id}.json`
    })),
    summary: summarize(allResults, { runWallMs: totalWallMs }),
    stability_envelope: stability,
    results: allResults
  };
  if (outPath) {
    await writeJson(outPath, aggregate);
    await writeText(outPath.replace(/\.json$/i, ".tsv"), perCardTsv(allResults));
  }
  if (stabilityOutPath) await writeJson(stabilityOutPath, stability);
  return aggregate;
}

export async function main(argv = process.argv, env = process.env) {
  const outPath = argValue(argv, "--out", "data/eval/v4-stability-soak/latest.json");
  const report = await runV4MultiTenantSoak({
    datasetPath: argValue(argv, "--dataset", env.V4_EBAY_SMOKE_DATASET || ""),
    sealedLabelsPath: argValue(argv, "--sealed-labels", env.V4_EBAY_SMOKE_SEALED_LABELS || ""),
    baseUrl: cleanText(argValue(argv, "--base-url", env.V4_EBAY_SMOKE_BASE_URL || env.API_BASE_URL || "https://listing.lyncafei.team")).replace(/\/+$/, ""),
    username: cleanText(argValue(argv, "--username", env.METAVERSE_USERNAME || "")),
    password: cleanText(argValue(argv, "--password", env.METAVERSE_PASSWORD || "")),
    limit: numberArg(argv, "--limit", 100),
    waveSize: numberArg(argv, "--wave-size", 20),
    tenantCount: numberArg(argv, "--tenant-count", 5),
    concurrency: numberArg(argv, "--concurrency", 2),
    submissionConcurrency: argv.some((argument) => argument === "--submission-concurrency" || argument.startsWith("--submission-concurrency="))
      ? numberArg(argv, "--submission-concurrency", 2)
      : null,
    modelOverride: cleanText(argValue(argv, "--model", "gpt-5-mini")),
    thinkMs: numberArg(argv, "--think-ms", 5000),
    l2WaitMs: numberArg(argv, "--l2-wait-ms", 3_600_000),
    requestTimeoutMs: numberArg(argv, "--request-timeout-ms", 120_000),
    coldStartBlind: argv.includes("--cold-start-blind"),
    outPath,
    stabilityOutPath: argValue(argv, "--stability-out", outPath.replace(/\.json$/i, "-stability.json")),
    waveOutDir: argValue(argv, "--wave-out-dir", ""),
    runId: cleanText(argValue(argv, "--run-id", `v4-soak-${Date.now()}`)),
    progress: !argv.includes("--quiet")
  });
  console.log(JSON.stringify({
    report: resolve(outPath),
    attempted: report.summary.attempted_count,
    completed: report.summary.ok_count,
    waves: report.wave_count,
    tenants: report.tenant_count,
    cold_start_blind: report.cold_start_blind,
    cards_per_minute: report.summary.completed_cards_per_minute,
    writer_p95_ms: report.summary.writer_ready_p95_ms,
    stability_pass: report.stability_envelope.pass,
    stability_rejections: report.stability_envelope.rejection_reasons
  }, null, 2));
  return report.stability_envelope.pass ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`V4 multi-tenant soak failed: ${error.message}`);
    process.exitCode = 2;
  });
}
