#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countSuccessfulResults(report = {}) {
  if (!Array.isArray(report.results)) return null;
  return report.results.filter((row) => row?.ok === true && row?.writer_ready !== false).length;
}

function wilsonLowerBound(successes, total, z = 1.96) {
  if (!(total > 0)) return null;
  const p = successes / total;
  const z2 = z ** 2;
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total))
    / (1 + z2 / total);
}

export function normalizeHistoricalRecognitionRun({ path = "", report = {} } = {}) {
  const summary = report.summary && typeof report.summary === "object" ? report.summary : {};
  const accuracy = summary.final_accuracy_proxy && typeof summary.final_accuracy_proxy === "object"
    ? summary.final_accuracy_proxy
    : {};
  const attempted = finiteNumber(summary.attempted_count, finiteNumber(report.limit, report.results?.length || 0));
  const successful = finiteNumber(summary.ok_count, countSuccessfulResults(report) ?? 0);
  const policyPassCount = finiteNumber(accuracy.policy_fair_pass_at_0_72, null);
  const providerDiagnostics = summary.provider_diagnostics && typeof summary.provider_diagnostics === "object"
    ? summary.provider_diagnostics
    : {};
  return {
    run_id: basename(path || cleanText(report.generated_at) || "historical-run"),
    path: cleanText(path) || null,
    generated_at: cleanText(report.generated_at) || null,
    schema_version: cleanText(report.schema_version) || null,
    sample_count: attempted,
    technical_success_count: successful,
    technical_failure_count: Math.max(0, attempted - successful),
    technical_success_rate: attempted > 0 ? successful / attempted : null,
    technical_success_wilson_lower_95: wilsonLowerBound(successful, attempted),
    writer_ready_p50_ms: finiteNumber(summary.writer_ready_p50_ms, finiteNumber(summary.l1_p50_ms, null)),
    writer_ready_p95_ms: finiteNumber(summary.writer_ready_p95_ms, finiteNumber(summary.l1_p95_ms, null)),
    perceived_title_p50_ms: finiteNumber(summary.perceived_title_p50_ms, null),
    policy_fair_title_proxy_avg: finiteNumber(accuracy.policy_fair_token_recall_avg, null),
    policy_fair_pass_at_0_72_count: policyPassCount,
    policy_fair_pass_at_0_72_rate: attempted > 0 && policyPassCount !== null ? policyPassCount / attempted : null,
    provider_latency_p50_ms: finiteNumber(providerDiagnostics.provider_latency_p50_ms, null),
    provider_latency_p95_ms: finiteNumber(providerDiagnostics.provider_latency_p95_ms, null),
    observed_configuration: {
      model_override: cleanText(report.model_override) || null,
      queue_mode: report.queue_mode === true,
      speculative_mode: report.speculative_mode === true,
      force_l2_direct: report.force_l2_direct === true,
      prewarm_enabled: report.prewarm_enabled === true,
      preingestion_enabled: report.preingestion_enabled === true
        || finiteNumber(summary.preingestion_used_count, 0) > 0,
      think_ms: finiteNumber(report.think_ms, null)
    },
    proxy_only: true,
    commercial_accuracy_claim_eligible: false
  };
}

function compareNullableDescending(left, right, key) {
  return (right[key] ?? -Infinity) - (left[key] ?? -Infinity);
}

function compareNullableAscending(left, right, key) {
  return (left[key] ?? Infinity) - (right[key] ?? Infinity);
}

export function auditHistoricalRecognitionRuns(runsInput = [], {
  minimumSampleCount = 10,
  minimumCompleteRunRate = 0.999
} = {}) {
  const runs = runsInput.map((row) => row?.sample_count !== undefined
    ? row
    : normalizeHistoricalRecognitionRun(row));
  const eligible = runs.filter((run) => run.sample_count >= minimumSampleCount);
  const complete = eligible.filter((run) => run.technical_success_rate >= minimumCompleteRunRate);
  const accuracyChampion = [...complete]
    .filter((run) => run.policy_fair_title_proxy_avg !== null)
    .sort((left, right) => compareNullableDescending(left, right, "policy_fair_title_proxy_avg")
      || compareNullableDescending(left, right, "policy_fair_pass_at_0_72_rate")
      || compareNullableAscending(left, right, "writer_ready_p95_ms"))[0] || null;
  const speedChampion = [...complete]
    .filter((run) => run.writer_ready_p50_ms !== null)
    .sort((left, right) => compareNullableAscending(left, right, "writer_ready_p50_ms")
      || compareNullableAscending(left, right, "writer_ready_p95_ms")
      || compareNullableDescending(left, right, "policy_fair_title_proxy_avg"))[0] || null;
  const stabilityChampion = [...eligible]
    .sort((left, right) => compareNullableDescending(left, right, "technical_success_wilson_lower_95")
      || compareNullableDescending(left, right, "sample_count")
      || compareNullableAscending(left, right, "writer_ready_p95_ms")
      || compareNullableAscending(left, right, "writer_ready_p50_ms"))[0] || null;
  const excludedSmallRuns = runs.filter((run) => run.sample_count < minimumSampleCount);
  return {
    schema_version: "v4-historical-recognition-champions-v1",
    generated_at: new Date().toISOString(),
    metric_contract: {
      accuracy_metric: "policy_fair_title_proxy_avg",
      accuracy_is_sem: false,
      stability_metric: "technical_success_wilson_lower_95",
      speed_metric: "writer_ready_p50_ms",
      minimum_sample_count: minimumSampleCount,
      minimum_complete_run_rate: minimumCompleteRunRate
    },
    audited_run_count: runs.length,
    eligible_run_count: eligible.length,
    excluded_small_run_count: excludedSmallRuns.length,
    champions: {
      accuracy: accuracyChampion,
      speed: speedChampion,
      stability: stabilityChampion
    },
    excluded_small_runs: excludedSmallRuns.map((run) => ({
      run_id: run.run_id,
      sample_count: run.sample_count,
      policy_fair_title_proxy_avg: run.policy_fair_title_proxy_avg
    })),
    unified_strategy_constraints: [
      "KEEP_ONE_V4_LIFECYCLE",
      "PORT_ACTIONS_NOT_ENDPOINTS",
      "PREINGESTION_BEFORE_EXPENSIVE_PROVIDER_WHEN_REUSED",
      "EXACT_ANCHOR_EARLY_STOP_ONLY_AFTER_HARD_INVARIANTS",
      "SPECULATION_MAY_HIDE_LATENCY_BUT_CANNOT_REDEFINE_ACTIVE_LATENCY",
      "BOUNDED_RETRY_AND_TERMINAL_JOB_STATES",
      "PROXY_TITLE_SCORE_CANNOT_PROMOTE_POLICY"
    ],
    candidate_principles_to_revalidate: {
      accuracy: [
        "HIGH_INFORMATION_GPT_FIELD_OBSERVATION",
        "PREINGESTION_EVIDENCE_REUSE",
        "DETERMINISTIC_CSM_SERIALIZATION"
      ],
      speed: [
        "PREINGESTION_BEFORE_PROVIDER",
        "EXACT_ANCHOR_EARLY_STOP",
        "REMOVE_NON_INFORMATIONAL_ACTIONS_FROM_CRITICAL_PATH"
      ],
      stability: [
        "IMMUTABLE_ASSET_GENERATION",
        "BOUNDED_RETRY",
        "IDEMPOTENT_QUEUE_EXECUTION",
        "EXPLICIT_TERMINAL_STATE"
      ]
    },
    runs: eligible
  };
}

function milliseconds(value) {
  return value === null || value === undefined ? "n/a" : `${Math.round(value)}ms`;
}

function percentage(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

export function renderHistoricalChampionReport(audit) {
  const lines = [
    "# Historical Recognition Champions Audit",
    "",
    `Eligible runs: ${audit.eligible_run_count}/${audit.audited_run_count}; minimum sample: ${audit.metric_contract.minimum_sample_count}`,
    "",
    "> Accuracy below is the historical policy-fair title proxy, not reviewed SEM accuracy.",
    ""
  ];
  for (const role of ["accuracy", "speed", "stability"]) {
    const run = audit.champions[role];
    lines.push(`## ${role[0].toUpperCase()}${role.slice(1)}`, "");
    if (!run) {
      lines.push("No eligible run.", "");
      continue;
    }
    lines.push(
      `- Run: ${run.run_id}`,
      `- n=${run.sample_count}; technical success=${percentage(run.technical_success_rate)}; Wilson lower 95%=${percentage(run.technical_success_wilson_lower_95)}`,
      `- policy-fair proxy=${percentage(run.policy_fair_title_proxy_avg)}; pass@0.72=${percentage(run.policy_fair_pass_at_0_72_rate)}`,
      `- writer-ready p50/p95=${milliseconds(run.writer_ready_p50_ms)} / ${milliseconds(run.writer_ready_p95_ms)}`,
      `- configuration=${JSON.stringify(run.observed_configuration)}`,
      ""
    );
  }
  lines.push(
    "## Fusion Boundary",
    "",
    "- Import actions and invariants into the single V4 lifecycle; do not restore historical endpoints.",
    "- Small high-scoring runs stay mechanism evidence and cannot win the >=10-card audit.",
    "- All champion principles must pass fixed reviewed SEM, throughput, and reliability gates before production execution.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

export async function auditHistoricalRecognitionDirectory({ inputDir, jsonOut, markdownOut, minimumSampleCount = 10 }) {
  const names = (await readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
  const rows = [];
  for (const name of names) {
    try {
      const path = resolve(inputDir, name);
      rows.push(normalizeHistoricalRecognitionRun({ path, report: JSON.parse(await readFile(path, "utf8")) }));
    } catch {
      // A corrupt historical artifact is excluded rather than weakening the audit contract.
    }
  }
  const audit = auditHistoricalRecognitionRuns(rows, { minimumSampleCount });
  await Promise.all([
    mkdir(dirname(jsonOut), { recursive: true }).then(() => writeFile(jsonOut, `${JSON.stringify(audit, null, 2)}\n`, "utf8")),
    mkdir(dirname(markdownOut), { recursive: true }).then(() => writeFile(markdownOut, renderHistoricalChampionReport(audit), "utf8"))
  ]);
  return audit;
}

async function main() {
  const argv = process.argv.slice(2);
  const value = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const inputDir = resolve(value("--input-dir", "data/eval/workflow-sidecar-smoke"));
  const outputDir = resolve(value("--output-dir", "data/eval/optimal-policy/historical-champions"));
  const audit = await auditHistoricalRecognitionDirectory({
    inputDir,
    jsonOut: resolve(outputDir, "historical-three-champions.json"),
    markdownOut: resolve(outputDir, "historical-three-champions.md"),
    minimumSampleCount: finiteNumber(value("--minimum-sample-count", "10"), 10)
  });
  console.log(JSON.stringify({
    audited_run_count: audit.audited_run_count,
    eligible_run_count: audit.eligible_run_count,
    champions: Object.fromEntries(Object.entries(audit.champions).map(([role, run]) => [role, run?.run_id || null])),
    output_dir: outputDir
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
