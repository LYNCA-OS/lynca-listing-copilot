#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoldenSemAccuracy } from "../lib/listing/evaluation/golden-sem-accuracy.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

async function readJson(path, label) {
  const target = resolve(path);
  if (!existsSync(target)) throw new Error(`${label} not found: ${target}`);
  return JSON.parse(await readFile(target, "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = argValue(argv, "--dataset");
  const predictionsPath = argValue(argv, "--predictions");
  const outPath = resolve(argValue(argv, "--out", "data/eval/launch-benchmark/sem-accuracy.json"));
  if (!datasetPath || !predictionsPath) throw new Error("--dataset and --predictions are required");
  const report = evaluateGoldenSemAccuracy({
    dataset: await readJson(datasetPath, "Golden SEM dataset"),
    predictions: await readJson(predictionsPath, "prediction report")
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    output: outPath,
    status: report.status,
    partition: report.source.partition,
    evaluated_cards: report.summary.evaluated_card_count,
    sem_card_exact_accuracy: report.metrics.sem_card_exact_accuracy.rate,
    sem_field_exact_accuracy: report.metrics.sem_field_exact_accuracy.rate,
    missing_predictions: report.summary.missing_prediction_count
  }, null, 2));
  return report.status === "COMPLETED" ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Golden SEM evaluation failed: ${error.message}`);
    process.exitCode = 2;
  });
}
