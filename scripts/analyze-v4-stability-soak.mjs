#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeV4StabilityEnvelope } from "../lib/listing/v4/jobs/stability-envelope.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
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

function boolArg(argv, name, fallback = false) {
  if (argv.includes(name)) return true;
  if (argv.includes(`--no-${name.replace(/^--/, "")}`)) return false;
  return fallback;
}

function reportPaths(argv = []) {
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report" && argv[index + 1]) paths.push(argv[index + 1]);
    else if (argument.startsWith("--report=")) paths.push(argument.slice("--report=".length));
  }
  const commaSeparated = argValue(argv, "--reports", "");
  if (commaSeparated) paths.push(...commaSeparated.split(",").map((path) => path.trim()).filter(Boolean));
  return [...new Set(paths)];
}

async function writeJson(path, value) {
  const output = resolve(path);
  if (!existsSync(dirname(output))) await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

export async function analyzeV4StabilitySoak({ paths = [], options = {}, outPath = "" } = {}) {
  if (!paths.length) throw new Error("At least one --report is required.");
  const reports = [];
  for (const path of paths) reports.push(JSON.parse(await readFile(resolve(path), "utf8")));
  const analysis = analyzeV4StabilityEnvelope(reports, options);
  if (outPath) await writeJson(outPath, analysis);
  return analysis;
}

export async function main(argv = process.argv) {
  const analysis = await analyzeV4StabilitySoak({
    paths: reportPaths(argv),
    outPath: argValue(argv, "--out", ""),
    options: {
      minimumWaves: numberArg(argv, "--minimum-waves", 3),
      minimumCards: numberArg(argv, "--minimum-cards", 50),
      minimumTenants: numberArg(argv, "--minimum-tenants", 3),
      minimumTechnicalAvailability: numberArg(argv, "--minimum-availability", 1),
      maximumWriterP95Ms: numberArg(argv, "--maximum-writer-p95-ms", 120000),
      maximumQueueWaitMs: numberArg(argv, "--maximum-queue-wait-ms", 180000),
      maximumTenantQueueP95SpreadMs: numberArg(argv, "--maximum-tenant-queue-p95-spread-ms", 60000),
      minimumTenantCompletionFairness: numberArg(argv, "--minimum-tenant-fairness", 0.95),
      maximumRecoveredRetryRate: numberArg(argv, "--maximum-recovered-retry-rate", 0.05),
      maximumLeaseRecoveryRate: numberArg(argv, "--maximum-lease-recovery-rate", 0.02),
      maximumThroughputCv: numberArg(argv, "--maximum-throughput-cv", 0.25),
      maximumWriterP95Cv: numberArg(argv, "--maximum-writer-p95-cv", 0.35),
      maximumLastWaveP95Regression: numberArg(argv, "--maximum-last-wave-p95-regression", 0.5),
      requireFreshSamples: boolArg(argv, "--require-fresh-samples", true)
    }
  });
  console.log(JSON.stringify(analysis, null, 2));
  return analysis.pass ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`V4 stability soak analysis failed: ${error.message}`);
    process.exitCode = 2;
  });
}
