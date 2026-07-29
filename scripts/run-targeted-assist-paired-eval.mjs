#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { analyzeTargetedAssistPairs } from "./analyze-targeted-assist-paired20.mjs";
import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import { evaluationItemSetSha256 } from "../lib/listing/evaluation/sample-policy.mjs";

export const TARGETED_ASSIST_PAIRED_COHORT_SIZE = 10;
export const TARGETED_ASSIST_PAIRED_COHORT_SHA256 = Object.freeze({
  FAMILIAR: "e280a121c50060918fbc0ea3ba27f755d3c8421f2db66a49cdeccb467253fefe",
  UNSEEN: "6f27384f23163f6e40c544271ff01575272fcd4b9c42080408bc866e652b6300"
});
export const TARGETED_ASSIST_PAIRED_LABEL_SHA256 = Object.freeze({
  FAMILIAR: "21b094c004a1f25ef5c15a6c62720c8f33a04ec472d91e00d63d797fb2db3599",
  UNSEEN: "b105810bc7dc94bfddb2469d54edb51cc9a4dce7d2f58f8b4a8bfef80d3cb74f"
});
export const TARGETED_ASSIST_PAIRED_PARTITION = "development";
export const TARGETED_ASSIST_FIXED20_READY_DECISION = "READY_FOR_ONE_FIXED20";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function datasetItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

function evaluationItemId(item = {}) {
  return cleanText(
    item.source_feedback_id
    || item.source_record?.sealed_eval_label_key
    || item.sealed_eval_label_ref?.key
    || item.asset_id
    || item.physical_card_id
    || item.id
  );
}

function labelItemId(label = {}) {
  return cleanText(label.source_feedback_id || label.item_id || label.key || label.asset_id);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function targetedAssistSealedLabelsSha256(labels = []) {
  const ordered = [...labels].sort((left, right) => labelItemId(left).localeCompare(labelItemId(right)));
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(ordered))).digest("hex");
}

async function readJsonl(path) {
  const text = await readFile(resolve(path), "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`targeted_paired_invalid_jsonl_${path}_${index + 1}:${error.message}`);
    }
  });
}

export function assertTargetedAssistPairedCohortSize(value) {
  const count = Math.trunc(Number(value));
  if (count !== TARGETED_ASSIST_PAIRED_COHORT_SIZE) {
    throw new Error(`targeted_paired_cohort_size_expected_10_received_${Number.isFinite(count) ? count : "invalid"}`);
  }
  return count;
}

export async function assertFrozenTargetedAssistCohort({
  cohort,
  datasetPath,
  sealedLabelsPath,
  expectedSha256,
  expectedLabelsSha256,
  expectedPartition = TARGETED_ASSIST_PAIRED_PARTITION
} = {}) {
  const normalizedCohort = cleanText(cohort).toUpperCase();
  if (!datasetPath || !sealedLabelsPath || !expectedSha256) {
    throw new Error(`targeted_paired_${normalizedCohort || "UNKNOWN"}_contract_inputs_missing`);
  }
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  if (cleanText(dataset.evaluation_partition).toLowerCase() !== expectedPartition
    || dataset.data_policy?.threshold_tuning_eligible !== true
    || dataset.data_policy?.frozen_holdout !== false) {
    throw new Error(`targeted_paired_${normalizedCohort}_development_partition_proof_missing`);
  }
  const items = datasetItems(dataset);
  assertTargetedAssistPairedCohortSize(items.length);
  if (Number(dataset.item_count) !== TARGETED_ASSIST_PAIRED_COHORT_SIZE) {
    throw new Error(`targeted_paired_${normalizedCohort}_declared_item_count_mismatch`);
  }
  const policy = dataset.evaluation_sample_policy || {};
  if (cleanText(policy.mode).toUpperCase() !== "PAIRED_ABLATION") {
    throw new Error(`targeted_paired_${normalizedCohort}_sample_mode_mismatch`);
  }
  if (
    policy.sample_reuse_permitted !== true
    || policy.same_sample_required !== true
    || policy.reuse_policy_complete !== true
    || !cleanText(policy.reuse_reason)
    || !cleanText(policy.reuse_scope_id)
  ) {
    throw new Error(`targeted_paired_${normalizedCohort}_reuse_policy_incomplete`);
  }
  if (Number(policy.selected_item_count) !== TARGETED_ASSIST_PAIRED_COHORT_SIZE) {
    throw new Error(`targeted_paired_${normalizedCohort}_policy_item_count_mismatch`);
  }
  const itemIds = items.map(evaluationItemId);
  if (itemIds.some((itemId) => !itemId) || new Set(itemIds).size !== itemIds.length) {
    throw new Error(`targeted_paired_${normalizedCohort}_item_ids_invalid`);
  }
  const actualSha256 = evaluationItemSetSha256(itemIds);
  if (actualSha256 !== expectedSha256 || cleanText(policy.selected_item_ids_sha256) !== expectedSha256) {
    throw new Error(`targeted_paired_${normalizedCohort}_item_set_sha_mismatch_${actualSha256}`);
  }
  const labels = await readJsonl(sealedLabelsPath);
  assertTargetedAssistPairedCohortSize(labels.length);
  const labelIds = labels.map(labelItemId);
  if (labelIds.some((itemId) => !itemId) || new Set(labelIds).size !== labelIds.length) {
    throw new Error(`targeted_paired_${normalizedCohort}_label_ids_invalid`);
  }
  const itemIdSet = new Set(itemIds);
  if (labelIds.some((itemId) => !itemIdSet.has(itemId))) {
    throw new Error(`targeted_paired_${normalizedCohort}_label_coverage_mismatch`);
  }
  const labelsSha256 = targetedAssistSealedLabelsSha256(labels);
  if (!expectedLabelsSha256 || labelsSha256 !== expectedLabelsSha256) {
    throw new Error(`targeted_paired_${normalizedCohort}_sealed_labels_sha_mismatch_${labelsSha256}`);
  }
  return Object.freeze({
    cohort: normalizedCohort,
    item_count: items.length,
    selected_item_ids_sha256: actualSha256,
    sealed_labels_sha256: labelsSha256,
    evaluation_partition: expectedPartition
  });
}

export async function assertFrozenTargetedAssistPaired20({
  familiarDataset,
  familiarLabels,
  unseenDataset,
  unseenLabels,
  familiarSha256 = TARGETED_ASSIST_PAIRED_COHORT_SHA256.FAMILIAR,
  unseenSha256 = TARGETED_ASSIST_PAIRED_COHORT_SHA256.UNSEEN,
  familiarLabelsSha256 = TARGETED_ASSIST_PAIRED_LABEL_SHA256.FAMILIAR,
  unseenLabelsSha256 = TARGETED_ASSIST_PAIRED_LABEL_SHA256.UNSEEN
} = {}) {
  const familiar = await assertFrozenTargetedAssistCohort({
    cohort: "FAMILIAR",
    datasetPath: familiarDataset,
    sealedLabelsPath: familiarLabels,
    expectedSha256: familiarSha256,
    expectedLabelsSha256: familiarLabelsSha256
  });
  const unseen = await assertFrozenTargetedAssistCohort({
    cohort: "UNSEEN",
    datasetPath: unseenDataset,
    sealedLabelsPath: unseenLabels,
    expectedSha256: unseenSha256,
    expectedLabelsSha256: unseenLabelsSha256
  });
  return Object.freeze({ familiar, unseen });
}

export function pairedArmOrder(index = 0) {
  return Number(index) % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
}

export function targetedPairedSmokeArgs({
  baseUrl,
  dataset,
  sealedLabels,
  outPath,
  offset,
  arm,
  model = "gpt-5-mini",
  l2WaitMs = 30_000,
  verifiedAssetCachePath
} = {}) {
  const profile = arm === "candidate"
    ? recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST
    : recognitionBenchmarkProfileIds.COLD_ALGORITHM;
  return [
    "--use-env-proxy",
    "scripts/v4-ebay-smoke.mjs",
    "--base-url", baseUrl,
    "--model", model,
    "--queue",
    "--speculative",
    "--use-preingestion",
    "--read-only-provider-contract",
    "--benchmark-profile", profile,
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
    "--out", outPath
  ];
}

function runSmoke(args, { spawnImpl = spawn } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawnImpl(process.execPath, args, {
      stdio: ["ignore", "ignore", "inherit"],
      env: process.env
    });
    child.on("error", rejectRun);
    child.on("close", (code) => (
      code === 0 ? resolveRun() : rejectRun(new Error(`targeted paired smoke exited ${code}`))
    ));
  });
}

async function oneResult(path) {
  const report = JSON.parse(await readFile(path, "utf8"));
  const rows = Array.isArray(report.results) ? report.results : [];
  if (rows.length !== 1) throw new Error(`paired arm expected one result, received ${rows.length}`);
  return { row: rows[0], report };
}

export function assertTargetedAssistPairedArmPreparation(row = {}, {
  cohort = "UNKNOWN",
  index = 0,
  arm = "unknown"
} = {}) {
  const diagnostics = row?.preparation_diagnostics || {};
  const normalizedCohort = cleanText(cohort).toUpperCase() || "UNKNOWN";
  const itemNumber = Math.max(1, Math.trunc(Number(index) || 0) + 1);
  const normalizedArm = cleanText(arm).toLowerCase() || "unknown";
  if (diagnostics.asset_cache_hit !== true) {
    throw new Error(`targeted_paired_asset_cache_miss:${normalizedCohort}:${itemNumber}:${normalizedArm}`);
  }
  if (diagnostics.upload_skipped_due_to_verified_asset_cache !== true) {
    throw new Error(`targeted_paired_upload_not_skipped:${normalizedCohort}:${itemNumber}:${normalizedArm}`);
  }
  return Object.freeze({
    asset_cache_hit: true,
    upload_skipped_due_to_verified_asset_cache: true
  });
}

export function assertTargetedAssistPairedArmDeployment(row = {}, {
  expectedGitSha = "",
  cohort = "UNKNOWN",
  index = 0,
  arm = "unknown"
} = {}) {
  const expected = cleanText(expectedGitSha).toLowerCase();
  const actual = cleanText(row?.evaluation_decision_trace_packet?.deployment_git_sha).toLowerCase();
  const normalizedCohort = cleanText(cohort).toUpperCase() || "UNKNOWN";
  const itemNumber = Math.max(1, Math.trunc(Number(index) || 0) + 1);
  const normalizedArm = cleanText(arm).toLowerCase() || "unknown";
  if (!/^[0-9a-f]{40}$/.test(expected) || actual !== expected) {
    throw new Error(`targeted_paired_deployment_git_sha_mismatch:${normalizedCohort}:${itemNumber}:${normalizedArm}`);
  }
  return actual;
}

export function assertTargetedAssistPairPreparation(pair = {}, context = {}) {
  return Object.freeze({
    baseline: assertTargetedAssistPairedArmPreparation(pair.baseline, { ...context, arm: "baseline" }),
    candidate: assertTargetedAssistPairedArmPreparation(pair.candidate, { ...context, arm: "candidate" })
  });
}

export async function runTargetedCohort({
  cohort,
  dataset,
  sealedLabels,
  baselineUrl,
  candidateUrl,
  outDir,
  verifiedAssetCachePath,
  limit = 10,
  model = "gpt-5-mini",
  l2WaitMs = 30_000,
  expectedGitSha = "",
  spawnImpl = spawn
} = {}) {
  const fixedLimit = assertTargetedAssistPairedCohortSize(limit);
  const cohortDir = resolve(outDir, cleanText(cohort).toLowerCase());
  await mkdir(cohortDir, { recursive: true });
  const pairs = [];
  for (let index = 0; index < fixedLimit; index += 1) {
    const pair = {};
    for (const arm of pairedArmOrder(index)) {
      const outPath = resolve(cohortDir, `${String(index + 1).padStart(2, "0")}-${arm}.json`);
      const args = targetedPairedSmokeArgs({
        baseUrl: arm === "baseline" ? baselineUrl : candidateUrl,
        dataset,
        sealedLabels,
        outPath,
        offset: index,
        arm,
        model,
        l2WaitMs,
        verifiedAssetCachePath
      });
      process.stderr.write(`${cohort} ${index + 1}/${fixedLimit} ${arm}\n`);
      await runSmoke(args, { spawnImpl });
      const row = (await oneResult(outPath)).row;
      assertTargetedAssistPairedArmPreparation(row, { cohort, index, arm });
      assertTargetedAssistPairedArmDeployment(row, { expectedGitSha, cohort, index, arm });
      pair[arm] = row;
    }
    assertTargetedAssistPairPreparation(pair, { cohort, index });
    pairs.push(pair);
  }
  const report = analyzeTargetedAssistPairs(pairs, { cohort });
  await writeFile(resolve(cohortDir, "pairs.json"), `${JSON.stringify({ cohort, pairs }, null, 2)}\n`, "utf8");
  await writeFile(resolve(cohortDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const baselineUrl = cleanText(argValue(argv, "--baseline-url", "https://listing.lyncafei.team")).replace(/\/+$/, "");
  const candidateUrl = cleanText(argValue(argv, "--candidate-url")).replace(/\/+$/, "");
  const familiarDataset = argValue(argv, "--familiar-dataset");
  const familiarLabels = argValue(argv, "--familiar-labels");
  const unseenDataset = argValue(argv, "--unseen-dataset");
  const unseenLabels = argValue(argv, "--unseen-labels");
  const verifiedAssetCachePath = argValue(argv, "--verified-asset-cache");
  const expectedGitSha = cleanText(argValue(argv, "--expected-git-sha")).toLowerCase();
  const workflowRunId = cleanText(argValue(argv, "--workflow-run-id"));
  const outDir = resolve(argValue(argv, "--out-dir", "artifacts/smoke/targeted-assist-paired20"));
  const limit = assertTargetedAssistPairedCohortSize(argValue(
    argv,
    "--limit-per-cohort",
    String(TARGETED_ASSIST_PAIRED_COHORT_SIZE)
  ));
  const l2WaitMs = Math.max(18_000, Math.trunc(Number(argValue(argv, "--l2-wait-ms", "30000")) || 30_000));
  const model = cleanText(argValue(argv, "--model", "gpt-5-mini")) || "gpt-5-mini";
  if (!candidateUrl) throw new Error("--candidate-url is required");
  if (!familiarDataset || !familiarLabels || !unseenDataset || !unseenLabels) {
    throw new Error("familiar and unseen dataset plus sealed-label paths are required");
  }
  if (!verifiedAssetCachePath) {
    throw new Error("--verified-asset-cache is required so upload reuse cannot confound Provider timing");
  }
  if (baselineUrl !== candidateUrl) {
    throw new Error("targeted paired benchmark requires the same deployed URL for both profiles");
  }
  if (!/^[0-9a-f]{40}$/.test(expectedGitSha) || !/^\d+$/.test(workflowRunId)) {
    throw new Error("--expected-git-sha and --workflow-run-id are required as a full Git SHA and numeric Actions run id");
  }
  await assertFrozenTargetedAssistPaired20({
    familiarDataset,
    familiarLabels,
    unseenDataset,
    unseenLabels
  });
  await mkdir(outDir, { recursive: true });
  const familiar = await runTargetedCohort({
    cohort: "FAMILIAR",
    dataset: familiarDataset,
    sealedLabels: familiarLabels,
    baselineUrl,
    candidateUrl,
    outDir,
    verifiedAssetCachePath,
    limit,
    model,
    l2WaitMs,
    expectedGitSha
  });
  const unseen = await runTargetedCohort({
    cohort: "UNSEEN",
    dataset: unseenDataset,
    sealedLabels: unseenLabels,
    baselineUrl,
    candidateUrl,
    outDir,
    verifiedAssetCachePath,
    limit,
    model,
    l2WaitMs,
    expectedGitSha
  });
  const gate = {
    schema_version: "targeted-assist-two-scoreboard-gate-v1",
    provenance: {
      expected_git_sha: expectedGitSha || null,
      workflow_run_id: workflowRunId || null
    },
    familiar,
    unseen,
    decision: familiar.gate.decision === "PASS_COHORT_ONLY" && unseen.gate.decision === "PASS_COHORT_ONLY"
      ? TARGETED_ASSIST_FIXED20_READY_DECISION
      : "NO_GO"
  };
  await writeFile(resolve(outDir, "gate.json"), `${JSON.stringify(gate, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function targetedAssistPairedGateExitCode(gate = {}) {
  return gate.decision === TARGETED_ASSIST_FIXED20_READY_DECISION ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((gate) => {
      process.exitCode = targetedAssistPairedGateExitCode(gate);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
