#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runV4MultiTenantSoak } from "./run-v4-multi-tenant-soak.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function numberArg(argv, name, fallback) {
  const parsed = Number(argValue(argv, name, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function levelsArg(argv) {
  const levels = argValue(argv, "--levels", "100,500,1000")
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(levels)].sort((left, right) => left - right);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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
  const modelOverride = argValue(argv, "--model", "gpt-5-mini");
  const outDir = resolve(argValue(argv, "--out-dir", `data/eval/launch-benchmark/throughput-${Date.now()}`));
  const levels = levelsArg(argv);
  if (!datasetPath) throw new Error("--dataset is required");
  if (Math.max(...levels) < 1000) throw new Error("launch throughput benchmark must include the 1000-card level");
  await mkdir(outDir, { recursive: true });
  const reports = [];
  for (const level of levels) {
    const runId = `launch-throughput-${level}-${Date.now()}`;
    const outPath = join(outDir, `throughput-${level}.json`);
    const report = await runV4MultiTenantSoak({
      datasetPath,
      sealedLabelsPath,
      baseUrl,
      username,
      password,
      limit: level,
      waveSize,
      tenantCount,
      concurrency,
      submissionConcurrency: concurrency,
      modelOverride,
      outPath,
      stabilityOutPath: join(outDir, `throughput-${level}-stability.json`),
      waveOutDir: join(outDir, `throughput-${level}-waves`),
      runId,
      progress: !argv.includes("--quiet")
    });
    report.benchmark_level = level;
    report.benchmark_purpose = "LAUNCH_THROUGHPUT";
    await writeJson(outPath, report);
    reports.push(report);
  }
  const index = {
    schema_version: "launch-throughput-benchmark-v1",
    generated_at: new Date().toISOString(),
    dataset_path: datasetPath,
    model: modelOverride,
    concurrency,
    tenant_count: tenantCount,
    levels,
    reports: reports.map((report) => ({
      benchmark_level: report.benchmark_level,
      attempted_count: report.summary?.attempted_count,
      completed_count: report.summary?.ok_count,
      completed_cards_per_minute: report.summary?.completed_cards_per_minute,
      technical_availability: report.stability_envelope?.aggregate?.technical_availability,
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
