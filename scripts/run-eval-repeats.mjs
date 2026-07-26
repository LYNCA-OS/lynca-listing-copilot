#!/usr/bin/env node
// Run the same smoke configuration N times and report the noise floor, or
// compare a candidate against a recorded baseline and return a keep/revert
// verdict.
//
//   node scripts/run-eval-repeats.mjs --label baseline --runs 3 \
//     --dataset artifacts/smoke/cold20.json \
//     --sealed-labels artifacts/smoke/cold20-labels.jsonl
//
//   node scripts/run-eval-repeats.mjs --label candidate --runs 3 ... \
//     --compare artifacts/smoke/eval-runs/baseline.json
//
// Exit code is 1 when the verdict is not IMPROVED, so CI can gate on it.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateChange, formatDecision, mean, median, stdDev } from "./eval-decision.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function runOnce({ dataset, sealedLabels, outPath, baseUrl, model, limit }) {
  const args = [
    "scripts/v4-ebay-smoke.mjs",
    "--base-url", baseUrl,
    "--model", model,
    "--queue", "--speculative", "--use-preingestion",
    "--ultra-image-detail", "high",
    "--concurrency", "2", "--preparation-concurrency", "2", "--submission-concurrency", "2",
    "--disable-identity-cache",
    "--sample-mode", "UNSPECIFIED",
    "--dataset", dataset,
    "--sealed-labels", sealedLabels,
    "--limit", String(limit),
    "--out", outPath
  ];
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("node", args, { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", rejectRun);
    child.on("close", (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`smoke exited ${code}`))));
  });
}

async function scoreFromReport(path) {
  const report = JSON.parse(await readFile(path, "utf8"));
  const scores = (report.results || [])
    .map((row) => row?.final_scoring?.policy_fair_token_recall)
    .filter((value) => Number.isFinite(value));
  if (!scores.length) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

export async function main(argv = process.argv.slice(2)) {
  const label = argValue(argv, "--label", "run");
  const runs = Math.max(1, Number(argValue(argv, "--runs", "3")) || 3);
  const dataset = argValue(argv, "--dataset", "artifacts/smoke/cold20.json");
  const sealedLabels = argValue(argv, "--sealed-labels", "artifacts/smoke/cold20-labels.jsonl");
  const baseUrl = argValue(argv, "--base-url", "https://listing.lyncafei.team");
  const model = argValue(argv, "--model", "gpt-5-mini");
  const limit = Number(argValue(argv, "--limit", "20")) || 20;
  const comparePath = argValue(argv, "--compare", "");
  const outDir = resolve(argValue(argv, "--out-dir", "artifacts/smoke/eval-runs"));

  await mkdir(outDir, { recursive: true });
  const scores = [];
  for (let index = 1; index <= runs; index += 1) {
    const outPath = resolve(outDir, `${label}-run${index}.json`);
    process.stderr.write(`eval-repeats ${label} run ${index}/${runs}\n`);
    await runOnce({ dataset, sealedLabels, outPath, baseUrl, model, limit });
    const score = await scoreFromReport(outPath);
    if (score === null) throw new Error(`run ${index} produced no scored rows`);
    scores.push(score);
    process.stderr.write(`  score=${score.toFixed(6)}\n`);
  }

  const summary = {
    schema_version: "eval-repeats-v1",
    label,
    generated_at: new Date().toISOString(),
    dataset,
    limit,
    runs: scores.length,
    scores,
    mean: mean(scores),
    median: median(scores),
    sd: stdDev(scores)
  };
  const summaryPath = resolve(outDir, `${label}.json`);
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`\n${label}: median=${summary.median?.toFixed(6)} mean=${summary.mean?.toFixed(6)} sd=${summary.sd?.toFixed(6) ?? "n/a"} n=${summary.runs}`);
  console.log(`  scores: ${scores.map((value) => value.toFixed(6)).join(", ")}`);
  console.log(`  written: ${summaryPath}`);

  if (!comparePath) {
    // Without a comparison this run *is* the noise measurement.
    if (summary.sd !== null) {
      console.log(`\nnoise floor: a change must exceed ~${(2 * summary.sd).toFixed(4)} to be distinguishable at this sample size.`);
    }
    return 0;
  }

  const baseline = JSON.parse(await readFile(resolve(comparePath), "utf8"));
  const decision = evaluateChange({
    baselineScores: baseline.scores || [],
    candidateScores: scores
  });
  console.log(`\n${formatDecision(decision)}`);
  if (decision.keep !== true) {
    console.log("\nVerdict is not IMPROVED — revert the change rather than keeping it on an unproven average.");
  }
  return decision.keep === true ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
