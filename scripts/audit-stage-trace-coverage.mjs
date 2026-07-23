#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditStageTraceCoverage } from "../lib/listing/evaluation/stage-trace-coverage.mjs";

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

async function json(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = arg(argv, "--dataset");
  const tracePath = arg(argv, "--trace");
  const outputPath = resolve(arg(argv, "--out", ".local/oracle/stage-trace-coverage.json"));
  if (!datasetPath || !tracePath) throw new Error("--dataset and --trace are required");
  const report = auditStageTraceCoverage({
    dataset: await json(datasetPath),
    trace: await json(tracePath),
    minimumCoverage: Number(arg(argv, "--minimum-coverage", "0.99"))
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: outputPath, gate: report.gate, failures_by_reason: report.failures_by_reason }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
