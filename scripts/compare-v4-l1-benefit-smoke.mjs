#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runV4EbaySmoke } from "./v4-ebay-smoke.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function metric(summary = {}, path = []) {
  let cursor = summary;
  for (const key of path) cursor = cursor?.[key];
  return Number.isFinite(Number(cursor)) ? Number(cursor) : null;
}

function delta(hidden, direct, path = []) {
  const hiddenValue = metric(hidden, path);
  const directValue = metric(direct, path);
  if (hiddenValue === null || directValue === null) return null;
  return Number((hiddenValue - directValue).toFixed(6));
}

function byAsset(report = {}) {
  return new Map((report.results || []).map((row) => [row.asset_id, row]));
}

function comparePerCard({ directReport, hiddenReport } = {}) {
  const direct = byAsset(directReport);
  return (hiddenReport.results || []).map((hidden) => {
    const baseline = direct.get(hidden.asset_id) || {};
    const hiddenScore = Number(hidden.final_scoring?.policy_fair_token_recall);
    const directScore = Number(baseline.final_scoring?.policy_fair_token_recall);
    const scoreDelta = Number.isFinite(hiddenScore) && Number.isFinite(directScore)
      ? Number((hiddenScore - directScore).toFixed(6))
      : null;
    const timeDelta = Number.isFinite(Number(hidden.time_to_writer_ready_ms)) && Number.isFinite(Number(baseline.time_to_writer_ready_ms))
      ? Number(hidden.time_to_writer_ready_ms) - Number(baseline.time_to_writer_ready_ms)
      : null;
    return {
      asset_id: hidden.asset_id,
      direct_l2_title: baseline.final_title || "",
      hidden_l1_l2_title: hidden.final_title || "",
      seller_title: hidden.seller_title || baseline.seller_title || "",
      direct_policy_fair: Number.isFinite(directScore) ? directScore : null,
      hidden_policy_fair: Number.isFinite(hiddenScore) ? hiddenScore : null,
      policy_fair_delta: scoreDelta,
      direct_writer_ready_ms: baseline.time_to_writer_ready_ms ?? null,
      hidden_writer_ready_ms: hidden.time_to_writer_ready_ms ?? null,
      writer_ready_delta_ms: timeDelta,
      direct_l2_ready: baseline.l2_ready === true,
      hidden_l2_ready: hidden.l2_ready === true,
      direct_catalog_prompt: baseline.l2_catalog_prompt_candidate_count ?? baseline.catalog_prompt_candidate_count ?? null,
      hidden_catalog_prompt: hidden.l2_catalog_prompt_candidate_count ?? hidden.catalog_prompt_candidate_count ?? null,
      direct_vector_prompt: baseline.l2_vector_prompt_candidate_count ?? baseline.vector_prompt_candidate_count ?? null,
      hidden_vector_prompt: hidden.l2_vector_prompt_candidate_count ?? hidden.vector_prompt_candidate_count ?? null,
      outcome: scoreDelta === null
        ? "unknown"
        : scoreDelta > 0.000001
          ? "l1_improved"
          : scoreDelta < -0.000001
            ? "l1_regressed"
            : "no_score_change"
    };
  });
}

function assessL1Benefit({ directReport, hiddenReport } = {}) {
  const direct = directReport.summary || {};
  const hidden = hiddenReport.summary || {};
  const deltas = {
    ok_count: delta(hidden, direct, ["ok_count"]),
    l2_ready_count: delta(hidden, direct, ["l2_ready_count"]),
    writer_ready_p50_ms: delta(hidden, direct, ["writer_ready_p50_ms"]),
    writer_ready_p95_ms: delta(hidden, direct, ["writer_ready_p95_ms"]),
    policy_fair_avg: delta(hidden, direct, ["final_accuracy_proxy", "policy_fair_token_recall_avg"]),
    policy_fair_pass_at_0_72: delta(hidden, direct, ["final_accuracy_proxy", "policy_fair_pass_at_0_72"]),
    policy_fair_pass_at_0_80: delta(hidden, direct, ["final_accuracy_proxy", "policy_fair_pass_at_0_80"])
  };
  const l2ReadyNotWorse = deltas.l2_ready_count === null || deltas.l2_ready_count >= 0;
  const policyAvgDelta = deltas.policy_fair_avg ?? 0;
  const pass72Delta = deltas.policy_fair_pass_at_0_72 ?? 0;
  const pass80Delta = deltas.policy_fair_pass_at_0_80 ?? 0;
  const accuracyNotWorse = pass72Delta >= 0 && pass80Delta >= 0 && policyAvgDelta >= -0.01;
  const latencyImproved = deltas.writer_ready_p50_ms !== null && deltas.writer_ready_p50_ms < 0;
  const accuracyImproved = pass72Delta > 0 || pass80Delta > 0 || policyAvgDelta > 0.01;
  const hasProductionSafeBenefit = l2ReadyNotWorse && accuracyNotWorse && (latencyImproved || accuracyImproved);
  const hasExplorationSignal = l2ReadyNotWorse && (latencyImproved || accuracyImproved);
  return {
    conclusion: hasProductionSafeBenefit
      ? "KEEP_L1_INTERNAL_PRODUCTION_ELIGIBLE"
      : hasExplorationSignal
        ? "KEEP_L1_SHADOW_NOT_PRODUCTION_DEFAULT_YET"
        : "KEEP_L1_EXPERIMENT_OFF_UNTIL_NEW_SIGNAL",
    reason: hasProductionSafeBenefit
      ? "Hidden L1 improved writer-ready latency or final title quality without reducing L2 readiness or title-quality guardrails."
      : hasExplorationSignal
        ? "Hidden L1 has exploratory value, but current quality regression means it should stay shadow/controlled-experiment only and not become the production default yet."
        : "Hidden L1 did not show enough latency or quality upside in this run; keep it available for future experiments, but do not spend production traffic on it by default.",
    quality_guard: {
      policy_fair_avg_delta_min: -0.01,
      require_pass_at_0_72_not_worse: true,
      require_pass_at_0_80_not_worse: true,
      l2_ready_not_worse,
      accuracy_not_worse: accuracyNotWorse,
      latency_improved: latencyImproved,
      accuracy_improved: accuracyImproved,
      exploration_signal: hasExplorationSignal
    },
    production_default_env: hasProductionSafeBenefit ? "V4_QUEUE_DEFAULT_CREATE_L1=true" : "V4_QUEUE_DEFAULT_CREATE_L1=false",
    controlled_experiment_env: "V4_QUEUE_DEFAULT_CREATE_L1=true or per-job create_l1_job=true",
    deltas
  };
}

export async function runV4L1BenefitComparison({
  datasetPath,
  sealedLabelsPath,
  baseUrl,
  username,
  password,
  limit = 10,
  offset = 0,
  modelOverride = "",
  prewarm = false,
  l2WaitMs = 120000,
  requestTimeoutMs = 180000,
  outDir = `data/eval/workflow-sidecar-smoke/l1-benefit-${nowStamp()}`,
  progress = true
} = {}) {
  const directOut = `${outDir}/direct-l2.json`;
  const hiddenOut = `${outDir}/hidden-l1-l2.json`;
  if (progress) process.stderr.write("L1 benefit A/B: running direct L2 baseline\n");
  const directReport = await runV4EbaySmoke({
    datasetPath,
    sealedLabelsPath,
    baseUrl,
    username,
    password,
    limit,
    offset,
    prewarm,
    forceL2Direct: true,
    modelOverride,
    l2WaitMs,
    requestTimeoutMs,
    outPath: directOut,
    progress
  });
  if (progress) process.stderr.write("L1 benefit A/B: running hidden L1 -> L2 variant\n");
  const hiddenReport = await runV4EbaySmoke({
    datasetPath,
    sealedLabelsPath,
    baseUrl,
    username,
    password,
    limit,
    offset,
    prewarm,
    forceL2Direct: false,
    modelOverride,
    l2WaitMs,
    requestTimeoutMs,
    outPath: hiddenOut,
    progress
  });
  const comparison = {
    schema_version: "v4-l1-benefit-comparison-v1",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    dataset_path: datasetPath,
    sealed_labels_path: sealedLabelsPath,
    limit,
    offset,
    model_override: modelOverride || null,
    blind_policy: {
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: true
    },
    direct_l2_summary: directReport.summary,
    hidden_l1_l2_summary: hiddenReport.summary,
    assessment: assessL1Benefit({ directReport, hiddenReport }),
    per_card: comparePerCard({ directReport, hiddenReport }),
    report_paths: {
      direct_l2_json: resolve(directOut),
      hidden_l1_l2_json: resolve(hiddenOut)
    }
  };
  const comparisonOut = `${outDir}/comparison.json`;
  await writeJson(comparisonOut, comparison);
  return { comparison, comparisonOut, directReport, hiddenReport };
}

export async function main(argv = process.argv, env = process.env) {
  const outDir = argValue(argv, "--out-dir", `data/eval/workflow-sidecar-smoke/l1-benefit-${nowStamp()}`);
  const { comparison, comparisonOut } = await runV4L1BenefitComparison({
    datasetPath: argValue(argv, "--dataset", env.V4_EBAY_SMOKE_DATASET || "data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json"),
    sealedLabelsPath: argValue(argv, "--sealed-labels", env.V4_EBAY_SMOKE_SEALED_LABELS || "data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl"),
    baseUrl: cleanText(argValue(argv, "--base-url", env.V4_EBAY_SMOKE_BASE_URL || env.API_BASE_URL || "https://listing.lyncafei.team")).replace(/\/+$/, ""),
    username: cleanText(argValue(argv, "--username", env.METAVERSE_USERNAME || "metaverse")),
    password: cleanText(argValue(argv, "--password", env.METAVERSE_PASSWORD || "mtv")),
    limit: Math.max(1, Math.trunc(numberArg(argv, "--limit", 10))),
    offset: Math.max(0, Math.trunc(numberArg(argv, "--offset", 0))),
    modelOverride: cleanText(argValue(argv, "--model", env.V4_EBAY_SMOKE_MODEL_OVERRIDE || "")),
    prewarm: hasFlag(argv, "--prewarm"),
    l2WaitMs: Math.max(0, Math.trunc(numberArg(argv, "--l2-wait-ms", 120000))),
    requestTimeoutMs: Math.max(10000, Math.trunc(numberArg(argv, "--request-timeout-ms", 180000))),
    outDir,
    progress: !hasFlag(argv, "--quiet")
  });
  const deltas = comparison.assessment.deltas;
  process.stdout.write([
    "v4 L1 benefit comparison completed",
    `comparison_json: ${resolve(comparisonOut)}`,
    `conclusion: ${comparison.assessment.conclusion}`,
    `reason: ${comparison.assessment.reason}`,
    `direct_writer_ready_p50_ms: ${comparison.direct_l2_summary.writer_ready_p50_ms}`,
    `hidden_writer_ready_p50_ms: ${comparison.hidden_l1_l2_summary.writer_ready_p50_ms}`,
    `delta_writer_ready_p50_ms: ${deltas.writer_ready_p50_ms}`,
    `direct_policy_fair_avg: ${comparison.direct_l2_summary.final_accuracy_proxy.policy_fair_token_recall_avg}`,
    `hidden_policy_fair_avg: ${comparison.hidden_l1_l2_summary.final_accuracy_proxy.policy_fair_token_recall_avg}`,
    `delta_policy_fair_avg: ${deltas.policy_fair_avg}`,
    `direct_pass@0.72: ${comparison.direct_l2_summary.final_accuracy_proxy.policy_fair_pass_at_0_72}/${comparison.direct_l2_summary.attempted_count}`,
    `hidden_pass@0.72: ${comparison.hidden_l1_l2_summary.final_accuracy_proxy.policy_fair_pass_at_0_72}/${comparison.hidden_l1_l2_summary.attempted_count}`
  ].join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`v4 L1 benefit comparison failed: ${error.message}`);
    process.exit(1);
  });
}
