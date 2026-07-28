#!/usr/bin/env node
// Run two deployments against the same dataset, alternating, until the
// difference between them is decidable or the run budget is spent.
//
//   node scripts/run-paired-eval.mjs --baseline-url https://... \
//     --candidate-url https://... --rounds 10 \
//     --dataset artifacts/smoke/cold20.json \
//     --sealed-labels artifacts/smoke/cold20-labels.jsonl
//
// run-eval-repeats.mjs measures one arm at a time, which is fine when both arms
// are the same code and only the change under test differs. It is not fine
// across a gap of hours: today's first comparison put a baseline measured last
// night against a candidate measured this afternoon, and everything that moved
// in between -- provider drift, a database outage, a catalog import -- landed
// entirely on one arm.
//
// So the arms are interleaved: baseline, candidate, baseline, candidate. Any
// drift is then shared by both arms instead of being confounded with the
// change. Scores are reported after every round so a decisive result can stop
// the run early rather than burning the whole budget.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateChange, formatDecision, mean, median, stdDev } from "./eval-decision.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

export function buildSmokeArgs({
  baseUrl,
  dataset,
  sealedLabels,
  outPath,
  model,
  limit,
  l2WaitMs,
  readOnlyProviderContract = false,
  worldKnowledgeProposals = false,
  verifiedAssetCachePath = "",
  verifiedAssetCacheMode = "disabled"
}) {
  const args = [
    "--use-env-proxy",
    "scripts/v4-ebay-smoke.mjs",
    "--base-url", baseUrl,
    "--model", model,
    "--queue", "--speculative", "--use-preingestion",
    "--ultra-image-detail", "high",
    "--concurrency", "2", "--preparation-concurrency", "2", "--submission-concurrency", "2",
    "--benchmark-profile", "cold_algorithm_benchmark",
    "--sample-mode", "UNSPECIFIED",
    "--dataset", dataset,
    "--sealed-labels", sealedLabels,
    "--limit", String(limit),
    "--l2-wait-ms", String(l2WaitMs),
    "--out", outPath
  ];
  if (readOnlyProviderContract) args.push("--read-only-provider-contract");
  if (worldKnowledgeProposals) args.push("--world-knowledge-proposals");
  if (verifiedAssetCachePath) args.push("--verified-asset-cache", verifiedAssetCachePath);
  args.push("--verified-asset-cache-mode", verifiedAssetCacheMode);
  return args;
}

function runSmoke(options) {
  const args = buildSmokeArgs(options);
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", rejectRun);
    child.on("close", (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`smoke exited ${code}`))));
  });
}

export function scoreFromReportData(report = {}, { expectedCount } = {}) {
  const results = Array.isArray(report.results) ? report.results : [];
  if (results.length !== expectedCount) {
    throw new Error(`invalid paired round: expected ${expectedCount} rows, received ${results.length}`);
  }
  const invalidRows = results.filter((row) => (
    row?.ok !== true
    || row?.l2_ready !== true
    || row?.writer_ready !== true
    || Boolean(row?.error)
    || row?.identity_cache_hit === true
    || row?.provider_call_skipped === true
    || Number(row?.provider_calls) !== 1
    || !Number.isFinite(row?.final_scoring?.policy_fair_token_recall)
  ));
  if (invalidRows.length) {
    const reasons = invalidRows.slice(0, 3).map((row) => (
      `${row?.job_id || row?.asset_id || "unknown"}:`
      + `${row?.error || row?.job_status || row?.l2_status || "invalid_cold_result"}`
    ));
    throw new Error(
      `invalid paired round: ${invalidRows.length}/${expectedCount} rows are not complete cold results (${reasons.join(", ")})`
    );
  }
  const scores = results.map((row) => row.final_scoring.policy_fair_token_recall);
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

async function scoreFromReport(path, { expectedCount }) {
  const report = JSON.parse(await readFile(path, "utf8"));
  return scoreFromReportData(report, { expectedCount });
}

export async function main(argv = process.argv.slice(2)) {
  const baselineUrl = argValue(argv, "--baseline-url", "https://listing.lyncafei.team");
  const candidateUrl = argValue(argv, "--candidate-url", "");
  const rounds = Math.max(1, Number(argValue(argv, "--rounds", "10")) || 10);
  const dataset = argValue(argv, "--dataset", "artifacts/smoke/cold20.json");
  const sealedLabels = argValue(argv, "--sealed-labels", "artifacts/smoke/cold20-labels.jsonl");
  const model = argValue(argv, "--model", "gpt-5-mini");
  const limit = Number(argValue(argv, "--limit", "20")) || 20;
  const l2WaitMs = Math.max(18_000, Number(argValue(argv, "--l2-wait-ms", "18000")) || 18_000);
  const outDir = resolve(argValue(argv, "--out-dir", "artifacts/smoke/paired-eval"));
  const label = argValue(argv, "--label", "paired");
  const candidateReadOnlyProviderContract = argv.includes("--candidate-read-only-provider-contract");
  const baselineReadOnlyProviderContract = argv.includes("--baseline-read-only-provider-contract")
    || argv.includes("--both-read-only-provider-contract");
  const bothReadOnlyProviderContract = argv.includes("--both-read-only-provider-contract");
  const candidateWorldKnowledgeProposals = argv.includes("--candidate-world-knowledge-proposals");
  const verifiedAssetCachePath = argValue(argv, "--verified-asset-cache", "");
  const verifiedAssetCacheMode = argValue(argv, "--verified-asset-cache-mode", verifiedAssetCachePath ? "reuse" : "disabled");
  const reportOnly = argv.includes("--report-only");
  if (!candidateUrl) throw new Error("--candidate-url is required");

  await mkdir(outDir, { recursive: true });
  const baselineScores = [];
  const candidateScores = [];

  for (let round = 1; round <= rounds; round += 1) {
    for (const arm of ["baseline", "candidate"]) {
      const baseUrl = arm === "baseline" ? baselineUrl : candidateUrl;
      const outPath = resolve(outDir, `${label}-${arm}-r${round}.json`);
      process.stderr.write(`round ${round}/${rounds} ${arm}\n`);
      await runSmoke({
        baseUrl,
        dataset,
        sealedLabels,
        outPath,
        model,
        limit,
        l2WaitMs,
        readOnlyProviderContract: arm === "baseline"
          ? baselineReadOnlyProviderContract
          : candidateReadOnlyProviderContract || bothReadOnlyProviderContract,
        worldKnowledgeProposals: arm === "candidate" && candidateWorldKnowledgeProposals,
        verifiedAssetCachePath,
        verifiedAssetCacheMode
      });
      const score = await scoreFromReport(outPath, { expectedCount: limit });
      (arm === "baseline" ? baselineScores : candidateScores).push(score);
      process.stderr.write(`  ${arm} score=${score.toFixed(6)}\n`);
    }

    const decision = evaluateChange({ baselineScores, candidateScores });
    process.stderr.write(
      `  after ${round}: baseline median=${median(baselineScores).toFixed(4)}`
      + ` candidate median=${median(candidateScores).toFixed(4)}`
      + ` -> ${decision.verdict}\n`
    );
    // A decisive verdict costs nothing more to confirm, so stop paying for runs.
    if (round >= 3 && decision.verdict !== "NOT_PROVEN") {
      process.stderr.write(`  decisive after ${round} rounds; stopping early\n`);
      break;
    }
  }

  const decision = evaluateChange({ baselineScores, candidateScores });
  const summary = {
    schema_version: "paired-eval-v1",
    label,
    generated_at: new Date().toISOString(),
    dataset,
    limit,
    baseline_url: baselineUrl,
    candidate_url: candidateUrl,
    candidate_read_only_provider_contract: candidateReadOnlyProviderContract,
    baseline_read_only_provider_contract: baselineReadOnlyProviderContract,
    both_read_only_provider_contract: bothReadOnlyProviderContract,
    candidate_world_knowledge_proposals: candidateWorldKnowledgeProposals,
    verified_asset_cache_path: verifiedAssetCachePath || null,
    verified_asset_cache_mode: verifiedAssetCacheMode,
    report_only: reportOnly,
    rounds_completed: baselineScores.length,
    baseline: {
      scores: baselineScores, mean: mean(baselineScores), median: median(baselineScores), sd: stdDev(baselineScores)
    },
    candidate: {
      scores: candidateScores, mean: mean(candidateScores), median: median(candidateScores), sd: stdDev(candidateScores)
    },
    decision
  };
  const summaryPath = resolve(outDir, `${label}.json`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`\nbaseline  n=${baselineScores.length} median=${median(baselineScores).toFixed(6)} mean=${mean(baselineScores).toFixed(6)} sd=${stdDev(baselineScores)?.toFixed(6) ?? "n/a"}`);
  console.log(`candidate n=${candidateScores.length} median=${median(candidateScores).toFixed(6)} mean=${mean(candidateScores).toFixed(6)} sd=${stdDev(candidateScores)?.toFixed(6) ?? "n/a"}`);
  console.log(`\n${formatDecision(decision)}`);
  console.log(`  written: ${summaryPath}`);
  return reportOnly || decision.verdict === "IMPROVED" ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
