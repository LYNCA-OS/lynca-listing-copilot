#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessLaunchBenchmark,
  launchGateThresholds
} from "../lib/listing/evaluation/launch-benchmark.mjs";

function argValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith(`${name}=`)) values.push(argument.slice(name.length + 1));
    else if (argument === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values.filter(Boolean);
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

async function readJson(path, label) {
  const target = resolve(path);
  if (!existsSync(target)) throw new Error(`${label} not found: ${target}`);
  return JSON.parse(await readFile(target, "utf8"));
}

function markdown(report = {}) {
  const accuracy = report.dimensions.accuracy;
  const reliability = report.dimensions.reliability;
  const lines = [
    "# LYNCA Launch Gate",
    "",
    `- Verdict: **${report.launch_verdict}**`,
    `- SEM Card-Exact: ${accuracy.value ?? "n/a"} / target ${accuracy.target}`,
    `- Reliability: ${reliability.technical_availability ?? "n/a"} / target ${reliability.target}`,
    `- Reliability sample: ${reliability.attempted_count}/${reliability.minimum_cards}`,
    "",
    "## Throughput",
    "",
    "| Level | Cards/min | Availability | Verdict |",
    "| ---: | ---: | ---: | :--- |",
    ...report.dimensions.throughput.levels.map((row) => (
      `| ${row.benchmark_level} | ${row.completed_cards_per_minute ?? "n/a"} | ${row.technical_availability ?? "n/a"} | ${row.verdict} |`
    )),
    "",
    "## Blocking Reasons",
    "",
    ...Object.entries(report.dimensions).flatMap(([dimension, row]) => [
      ...row.failure_reasons.map((reason) => `- ${dimension}: ${reason}`),
      ...row.evidence_shortfall_reasons.map((reason) => `- ${dimension}: ${reason}`)
    ])
  ];
  if (lines.at(-1) === "") lines.push("- none");
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const accuracyPath = argValue(argv, "--accuracy");
  const throughputPaths = argValues(argv, "--throughput");
  const reliabilityPath = argValue(argv, "--reliability");
  const outPath = resolve(argValue(argv, "--out", "data/eval/launch-benchmark/launch-gate.json"));
  if (!accuracyPath || !reliabilityPath || !throughputPaths.length) {
    throw new Error("--accuracy, three --throughput reports, and --reliability are required");
  }
  const report = assessLaunchBenchmark({
    accuracyReport: await readJson(accuracyPath, "accuracy report"),
    throughputReports: await Promise.all(throughputPaths.map((path) => readJson(path, "throughput report"))),
    reliabilityReport: await readJson(reliabilityPath, "reliability report"),
    thresholds: launchGateThresholds
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(outPath.replace(/\.json$/i, ".md"), markdown(report));
  console.log(JSON.stringify({
    output: outPath,
    launch_verdict: report.launch_verdict,
    launch_ready: report.launch_ready,
    failed_dimensions: report.failed_dimensions,
    inconclusive_dimensions: report.inconclusive_dimensions,
    next_bottleneck: report.next_bottleneck
  }, null, 2));
  return report.launch_ready ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Launch gate assessment failed: ${error.message}`);
    process.exitCode = 2;
  });
}
