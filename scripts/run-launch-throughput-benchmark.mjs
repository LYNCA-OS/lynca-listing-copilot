#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchGateThresholds } from "../lib/listing/evaluation/launch-benchmark.mjs";
import { datasetItems, runV4MultiTenantSoak } from "./run-v4-multi-tenant-soak.mjs";
import { summarize } from "./v4-ebay-smoke.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function numberArg(argv, name, fallback) {
  const raw = argValue(argv, name, "");
  if (String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function levelsArg(argv) {
  const levels = argValue(argv, "--levels", launchGateThresholds.throughput_levels.join(","))
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(levels)].sort((left, right) => left - right);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function datasetItemId(item = {}) {
  return cleanText(
    item.asset_id
    || item.source_feedback_id
    || item.physical_card_id
    || item.identity_key
    || item.source_record?.sealed_eval_label_key
  );
}

export function assertLaunchDatasetCapacity(dataset = {}, levels = launchGateThresholds.throughput_levels) {
  const items = datasetItems(dataset);
  const required = Math.max(...levels);
  const ids = items.map(datasetItemId).filter(Boolean);
  const uniqueIds = new Set(ids);
  if (items.length < required) {
    throw new Error(`Launch benchmark requires ${required} real items; dataset contains ${items.length}.`);
  }
  if (ids.length < required || uniqueIds.size < required) {
    throw new Error(`Launch benchmark requires ${required} uniquely identified items; found ${uniqueIds.size}.`);
  }
  return {
    required_item_count: required,
    dataset_item_count: items.length,
    uniquely_identified_item_count: uniqueIds.size
  };
}

export function assertCheckpointWaveAlignment(levels = [], waveSize = 50) {
  const size = Math.max(1, Math.trunc(Number(waveSize) || 1));
  const misaligned = levels.filter((level) => level % size !== 0);
  if (misaligned.length) {
    throw new Error(`Throughput checkpoints ${misaligned.join(",")} must align to wave size ${size}.`);
  }
  return size;
}

export function deriveLaunchThroughputCheckpoint(fullReport = {}, level) {
  const target = Math.max(1, Math.trunc(Number(level) || 0));
  const results = Array.isArray(fullReport.results) ? fullReport.results.slice(0, target) : [];
  if (results.length !== target) {
    throw new Error(`Cannot derive ${target}-card checkpoint from ${results.length} result(s).`);
  }
  const wave = (fullReport.wave_reports || []).find(
    (row) => Number(row.cumulative_attempted_count || 0) === target
  );
  const elapsedMs = Number(wave?.soak_elapsed_ms || 0);
  if (!wave || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    throw new Error(`No exact elapsed-time boundary exists for ${target}-card checkpoint.`);
  }
  return {
    schema_version: "launch-throughput-checkpoint-v1",
    generated_at: new Date().toISOString(),
    benchmark_level: target,
    benchmark_purpose: "LAUNCH_THROUGHPUT",
    source_soak_run_id: fullReport.soak_run_id || null,
    source_wave_id: wave.wave_id || null,
    run_wall_ms: elapsedMs,
    summary: summarize(results, { runWallMs: elapsedMs }),
    evaluation_sample_policy: fullReport.evaluation_sample_policy || null
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const datasetPath = argValue(argv, "--dataset", env.V4_EBAY_SMOKE_DATASET || "");
  const sealedLabelsPath = argValue(argv, "--sealed-labels", env.V4_EBAY_SMOKE_SEALED_LABELS || "");
  const baseUrl = argValue(argv, "--base-url", env.V4_EBAY_SMOKE_BASE_URL || env.API_BASE_URL || "https://listing.lyncafei.team");
  const username = argValue(argv, "--username", env.METAVERSE_USERNAME || "");
  const password = argValue(argv, "--password", env.METAVERSE_PASSWORD || "");
  const concurrency = numberArg(argv, "--concurrency", 2);
  const tenantCount = numberArg(argv, "--tenant-count", 5);
  const waveSize = numberArg(argv, "--wave-size", 50);
  const thinkMs = numberArg(argv, "--think-ms", 0);
  const l2WaitMs = numberArg(argv, "--l2-wait-ms", 3_600_000);
  const requestTimeoutMs = numberArg(argv, "--request-timeout-ms", 120_000);
  const modelOverride = argValue(argv, "--model", "gpt-5-mini");
  const outDir = resolve(argValue(argv, "--out-dir", `data/eval/launch-benchmark/throughput-${Date.now()}`));
  const levels = levelsArg(argv);
  if (!datasetPath) throw new Error("--dataset is required");
  if (!levels.length || Math.max(...levels) < 1000) {
    throw new Error("launch throughput benchmark must include the 1000-card level");
  }
  assertCheckpointWaveAlignment(levels, waveSize);
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const datasetCapacity = assertLaunchDatasetCapacity(dataset, levels);
  await mkdir(outDir, { recursive: true });

  const maximumLevel = Math.max(...levels);
  const runId = `launch-throughput-${maximumLevel}-${Date.now()}`;
  const reliabilityPath = join(outDir, `reliability-${maximumLevel}.json`);
  const fullReport = await runV4MultiTenantSoak({
    datasetPath,
    sealedLabelsPath,
    baseUrl,
    username,
    password,
    limit: maximumLevel,
    waveSize,
    tenantCount,
    concurrency,
    submissionConcurrency: concurrency,
    modelOverride,
    thinkMs,
    l2WaitMs,
    requestTimeoutMs,
    outPath: reliabilityPath,
    stabilityOutPath: join(outDir, `reliability-${maximumLevel}-stability.json`),
    waveOutDir: join(outDir, `reliability-${maximumLevel}-waves`),
    runId,
    progress: !argv.includes("--quiet")
  });
  fullReport.benchmark_level = maximumLevel;
  fullReport.benchmark_purpose = "LAUNCH_RELIABILITY_AND_THROUGHPUT";
  await writeJson(reliabilityPath, fullReport);

  const reports = levels.map((level) => deriveLaunchThroughputCheckpoint(fullReport, level));
  for (const report of reports) {
    await writeJson(join(outDir, `throughput-${report.benchmark_level}.json`), report);
  }
  const index = {
    schema_version: "launch-throughput-benchmark-v2",
    generated_at: new Date().toISOString(),
    dataset_path: datasetPath,
    dataset_capacity: datasetCapacity,
    model: modelOverride,
    concurrency,
    tenant_count: tenantCount,
    wave_size: waveSize,
    levels,
    execution_policy: {
      one_sustained_run: true,
      checkpoints_derived_from_same_run: true,
      repeated_model_calls_for_smaller_levels: false
    },
    reliability_report_path: reliabilityPath,
    reports: reports.map((report) => ({
      benchmark_level: report.benchmark_level,
      attempted_count: report.summary?.attempted_count,
      completed_count: report.summary?.ok_count,
      completed_cards_per_minute: report.summary?.completed_cards_per_minute,
      report_path: join(outDir, `throughput-${report.benchmark_level}.json`)
    }))
  };
  await writeJson(join(outDir, "index.json"), index);
  console.log(JSON.stringify(index, null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Launch throughput benchmark failed: ${error.message}`);
    process.exitCode = 2;
  });
}
