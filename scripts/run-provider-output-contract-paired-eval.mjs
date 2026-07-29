#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import {
  TARGETED_ASSIST_PAIRED_COHORT_SIZE,
  assertFrozenTargetedAssistPaired20,
  assertTargetedAssistPairedArmDeployment,
  assertTargetedAssistPairedArmPreparation,
  createPairedSessionCookieFile,
  pairedArmOrder
} from "./run-targeted-assist-paired-eval.mjs";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values = []) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function mean(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function runSmoke(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "ignore", "inherit"],
      env: process.env
    });
    child.on("error", rejectRun);
    child.on("close", (code) => (
      code === 0 ? resolveRun() : rejectRun(new Error(`provider contract paired smoke exited ${code}`))
    ));
  });
}

function smokeArgs({
  baseUrl,
  dataset,
  sealedLabels,
  verifiedAssetCachePath,
  sessionCookieFile,
  outPath,
  offset,
  candidate,
  model,
  l2WaitMs
}) {
  const args = [
    "--use-env-proxy",
    "scripts/v4-ebay-smoke.mjs",
    "--base-url", baseUrl,
    "--model", model,
    "--queue",
    "--speculative",
    "--use-preingestion",
    "--benchmark-profile", recognitionBenchmarkProfileIds.COLD_ALGORITHM,
    "--sample-mode", "PAIRED_ABLATION",
    "--dataset", dataset,
    "--sealed-labels", sealedLabels,
    "--offset", String(offset),
    "--limit", "1",
    "--l2-wait-ms", String(l2WaitMs),
    "--concurrency", "1",
    "--preparation-concurrency", "1",
    "--submission-concurrency", "1",
    "--verified-asset-cache", verifiedAssetCachePath,
    "--verified-asset-cache-mode", "reuse",
    "--session-cookie-file", sessionCookieFile,
    "--out", outPath
  ];
  if (candidate) args.push("--read-only-provider-contract");
  return args;
}

async function oneRow(path) {
  const report = JSON.parse(await readFile(path, "utf8"));
  const rows = Array.isArray(report.results) ? report.results : [];
  if (rows.length !== 1) throw new Error(`provider contract arm expected one row, received ${rows.length}`);
  return rows[0];
}

export function expectedProviderContractArm(arm = "") {
  if (arm === "candidate") {
    return {
      response_profile: "read_only_sparse_v3",
      prompt_mode: "v4_read_only_surface"
    };
  }
  if (arm === "baseline") {
    return {
      // The control is the exact production contract, not the legacy full
      // response schema. Production already uses the compact L2 transport.
      response_profile: "compact_sparse_v1",
      prompt_mode: "v4_ultra_fast_l2"
    };
  }
  throw new Error(`unknown_provider_contract_arm:${arm || "missing"}`);
}

function assertColdArm(row = {}, { cohort, index, arm } = {}) {
  const prefix = `${cohort}:${index + 1}:${arm}`;
  if (row.ok !== true || row.l2_ready !== true || row.writer_ready !== true || row.error) {
    throw new Error(`provider_contract_incomplete_arm:${prefix}`);
  }
  if (row.identity_cache_hit === true || row.provider_call_skipped === true || Number(row.provider_calls) !== 1) {
    throw new Error(`provider_contract_not_cold:${prefix}`);
  }
  if (!Number.isFinite(row.final_scoring?.policy_fair_token_recall)) {
    throw new Error(`provider_contract_score_missing:${prefix}`);
  }
  const expected = expectedProviderContractArm(arm);
  if (clean(row.provider_response_profile) !== expected.response_profile) {
    throw new Error(`provider_contract_profile_mismatch:${prefix}:${row.provider_response_profile || "missing"}`);
  }
  if (clean(row.provider_prompt_mode) !== expected.prompt_mode) {
    throw new Error(`provider_contract_prompt_mode_mismatch:${prefix}:${row.provider_prompt_mode || "missing"}`);
  }
}

function armMetrics(rows = []) {
  const visibleTokens = rows.map((row) => finite(row.visible_output_tokens));
  const totalOutputTokens = rows.map((row) => finite(row.output_tokens));
  const latencies = rows.map((row) => finite(row.provider_latency_ms));
  const recalls = rows.map((row) => finite(row.final_scoring?.policy_fair_token_recall));
  return {
    count: rows.length,
    policy_fair_token_recall: mean(recalls),
    provider_latency_p50_ms: median(latencies),
    provider_latency_max_ms: latencies.filter(Number.isFinite).sort((a, b) => a - b).at(-1) ?? null,
    visible_output_tokens_p50: median(visibleTokens),
    visible_output_tokens_max: visibleTokens.filter(Number.isFinite).sort((a, b) => a - b).at(-1) ?? null,
    output_tokens_p50: median(totalOutputTokens),
    output_tokens_max: totalOutputTokens.filter(Number.isFinite).sort((a, b) => a - b).at(-1) ?? null,
    visible_output_token_coverage: visibleTokens.filter(Number.isFinite).length,
    technical_failure_count: rows.filter((row) => row.ok !== true || Boolean(row.error)).length
  };
}

function analyzePairs(pairs = [], { cohort = "UNKNOWN" } = {}) {
  const baselineRows = pairs.map((pair) => pair.baseline);
  const candidateRows = pairs.map((pair) => pair.candidate);
  const baseline = armMetrics(baselineRows);
  const candidate = armMetrics(candidateRows);
  const recallDelta = candidate.policy_fair_token_recall - baseline.policy_fair_token_recall;
  const regressions = pairs.filter((pair) => (
    pair.candidate.final_scoring.policy_fair_token_recall + 1e-9
      < pair.baseline.final_scoring.policy_fair_token_recall
  )).length;
  return {
    schema_version: "provider-output-contract-paired-cohort-v1",
    cohort,
    pair_count: pairs.length,
    baseline,
    candidate,
    deltas: {
      policy_fair_token_recall: Number(recallDelta.toFixed(6)),
      provider_latency_p50_ms: candidate.provider_latency_p50_ms - baseline.provider_latency_p50_ms
    },
    pair_recall_regression_count: regressions,
    gate: {
      replay_contract: "deterministic_replay_passed_before_paid_calls",
      visible_output_tokens_observed_for_all: candidate.visible_output_token_coverage === pairs.length,
      visible_output_tokens_max_lte_150: candidate.visible_output_tokens_max !== null
        && candidate.visible_output_tokens_max <= 150,
      provider_latency_p50_lte_5000: candidate.provider_latency_p50_ms !== null
        && candidate.provider_latency_p50_ms <= 5000,
      policy_fair_token_recall_not_regressed: recallDelta >= -1e-9,
      technical_failures_zero: baseline.technical_failure_count === 0 && candidate.technical_failure_count === 0
    }
  };
}

async function runCohort({
  cohort,
  dataset,
  sealedLabels,
  baseUrl,
  verifiedAssetCachePath,
  sessionCookieFile,
  expectedGitSha,
  outDir,
  model,
  l2WaitMs
}) {
  const cohortDir = resolve(outDir, cohort.toLowerCase());
  await mkdir(cohortDir, { recursive: true });
  const pairs = [];
  for (let index = 0; index < TARGETED_ASSIST_PAIRED_COHORT_SIZE; index += 1) {
    const pair = {};
    for (const arm of pairedArmOrder(index)) {
      const outPath = resolve(cohortDir, `${String(index + 1).padStart(2, "0")}-${arm}.json`);
      process.stderr.write(`${cohort} ${index + 1}/${TARGETED_ASSIST_PAIRED_COHORT_SIZE} ${arm}\n`);
      await runSmoke(smokeArgs({
        baseUrl,
        dataset,
        sealedLabels,
        verifiedAssetCachePath,
        sessionCookieFile,
        outPath,
        offset: index,
        candidate: arm === "candidate",
        model,
        l2WaitMs
      }));
      const row = await oneRow(outPath);
      assertTargetedAssistPairedArmPreparation(row, { cohort, index, arm });
      assertTargetedAssistPairedArmDeployment(row, { expectedGitSha, cohort, index, arm });
      assertColdArm(row, { cohort, index, arm });
      pair[arm] = row;
    }
    pairs.push(pair);
  }
  const report = analyzePairs(pairs, { cohort });
  await writeFile(resolve(cohortDir, "pairs.json"), `${JSON.stringify({ cohort, pairs }, null, 2)}\n`);
  await writeFile(resolve(cohortDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const baseUrl = clean(argValue(argv, "--base-url", "https://listing.lyncafei.team")).replace(/\/+$/, "");
  const familiarDataset = argValue(argv, "--familiar-dataset");
  const familiarLabels = argValue(argv, "--familiar-labels");
  const unseenDataset = argValue(argv, "--unseen-dataset");
  const unseenLabels = argValue(argv, "--unseen-labels");
  const verifiedAssetCachePath = argValue(argv, "--verified-asset-cache");
  const expectedGitSha = clean(argValue(argv, "--expected-git-sha")).toLowerCase();
  const workflowRunId = clean(argValue(argv, "--workflow-run-id"));
  const outDir = resolve(argValue(argv, "--out-dir", "artifacts/smoke/provider-output-contract-paired20"));
  const model = clean(argValue(argv, "--model", "gpt-5-mini")) || "gpt-5-mini";
  const l2WaitMs = Math.max(18_000, Number(argValue(argv, "--l2-wait-ms", "360000")) || 360_000);
  if (!familiarDataset || !familiarLabels || !unseenDataset || !unseenLabels || !verifiedAssetCachePath) {
    throw new Error("provider contract paired datasets, labels, and verified asset cache are required");
  }
  if (!/^[0-9a-f]{40}$/.test(expectedGitSha) || !/^\d+$/.test(workflowRunId)) {
    throw new Error("provider contract paired exact SHA and Actions run id are required");
  }
  await assertFrozenTargetedAssistPaired20({ familiarDataset, familiarLabels, unseenDataset, unseenLabels });
  await mkdir(outDir, { recursive: true });
  const sessionCookieFile = await createPairedSessionCookieFile({ baseUrl });
  let familiar;
  let unseen;
  try {
    await writeFile(resolve(outDir, "authentication.json"), `${JSON.stringify({
      schema_version: "provider-output-contract-paired-auth-v1",
      login_attempt_count: 1,
      session_reused_across_arm_count: 40,
      session_cookie_persisted_in_artifact: false
    }, null, 2)}\n`);
    familiar = await runCohort({
      cohort: "FAMILIAR", dataset: familiarDataset, sealedLabels: familiarLabels,
      baseUrl, verifiedAssetCachePath, sessionCookieFile, expectedGitSha, outDir, model, l2WaitMs
    });
    unseen = await runCohort({
      cohort: "UNSEEN", dataset: unseenDataset, sealedLabels: unseenLabels,
      baseUrl, verifiedAssetCachePath, sessionCookieFile, expectedGitSha, outDir, model, l2WaitMs
    });
  } finally {
    await unlink(sessionCookieFile).catch(() => {});
  }
  const allGates = [...Object.values(familiar.gate), ...Object.values(unseen.gate)];
  const gate = {
    schema_version: "provider-output-contract-two-scoreboard-gate-v1",
    expected_git_sha: expectedGitSha,
    workflow_run_id: workflowRunId,
    familiar,
    unseen,
    decision: allGates.every((value) => value === true || typeof value === "string") ? "TASK_A_PASS" : "TASK_A_NO_GO"
  };
  await writeFile(resolve(outDir, "gate.json"), `${JSON.stringify(gate, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((gate) => {
    process.exitCode = gate.decision === "TASK_A_PASS" ? 0 : 2;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
