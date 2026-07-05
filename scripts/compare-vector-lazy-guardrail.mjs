import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resultMap(report = {}) {
  return new Map((Array.isArray(report.results) ? report.results : [])
    .map((item) => [normalizeText(item.candidate_id), item])
    .filter(([id]) => Boolean(id)));
}

function titleTokens(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenRecall(referenceTitle = "", predictionTitle = "") {
  const reference = new Set(titleTokens(referenceTitle));
  const predicted = new Set(titleTokens(predictionTitle));
  if (!reference.size) return null;
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return Number((overlap / reference.size).toFixed(6));
}

function resultTitle(item = {}) {
  return normalizeText(item.final_evaluated_title || item.scored_title || item.title || item.final_title || item.rendered_title || "");
}

function resultRecall(item = {}) {
  const explicit = Number(item.corrected_title_comparison?.token_recall);
  if (Number.isFinite(explicit)) return explicit;
  return tokenRecall(item.corrected_title_reference || "", resultTitle(item));
}

function pass(item = {}, threshold = 0.72) {
  return Number(resultRecall(item) || 0) >= threshold;
}

function delta(left, right) {
  const leftValue = Number(resultRecall(left) || 0);
  const rightValue = Number(resultRecall(right) || 0);
  return Number((rightValue - leftValue).toFixed(6));
}

function copiedReferenceCount(report = {}) {
  return (Array.isArray(report.results) ? report.results : [])
    .filter((item) => item.copied_serial_grade_cert_from_reference === true).length;
}

function countWhere(items = [], predicate) {
  return items.filter(predicate).length;
}

function rate(count, denominator) {
  return denominator ? Number((count / denominator).toFixed(6)) : null;
}

function latency(report = {}) {
  return report.per_card_latency_ms || {};
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latencyDelta(noLazy = {}, lazy = {}, key = "") {
  const before = finiteNumber(latency(noLazy)[key]);
  const after = finiteNumber(latency(lazy)[key]);
  return before !== null && after !== null ? after - before : null;
}

function countReportFlag(report = {}, key = "") {
  return (Array.isArray(report.results) ? report.results : [])
    .filter((item) => item?.[key] === true).length;
}

export async function compareVectorLazyGuardrail({
  noLazyPath,
  lazyPath,
  threshold = 0.72,
  minRegressionDelta = -0.015,
  requiredLazySkipCount = 1,
  substantialTimingImprovementMs = 100,
  allowedTimingRegressionMs = 250
} = {}) {
  if (!noLazyPath || !lazyPath) throw new Error("noLazyPath and lazyPath are required.");
  const [noLazy, lazy] = await Promise.all([readJson(noLazyPath), readJson(lazyPath)]);
  const noLazyMap = resultMap(noLazy);
  const lazyMap = resultMap(lazy);
  const ids = [...new Set([...noLazyMap.keys(), ...lazyMap.keys()])];
  const trace = ids.map((candidateId) => {
    const before = noLazyMap.get(candidateId) || {};
    const after = lazyMap.get(candidateId) || {};
    const beforePass = pass(before, threshold);
    const afterPass = pass(after, threshold);
    const recallDelta = delta(before, after);
    const regression = (beforePass && !afterPass) || recallDelta < minRegressionDelta;
    const recovery = !beforePass && afterPass;
    return {
      candidate_id: candidateId,
      no_lazy_title: resultTitle(before),
      lazy_title: resultTitle(after),
      corrected_title: normalizeText(before.corrected_title_reference || after.corrected_title_reference || ""),
      no_lazy_recall: resultRecall(before),
      lazy_recall: resultRecall(after),
      recall_delta: recallDelta,
      vector_lazy_skip: after.vector_lazy_skip === true,
      vector_lazy_skip_reason: after.vector_lazy_skip_reason || null,
      retrieval_title_assist_used: {
        no_lazy: before.retrieval_title_assist_used === true,
        lazy: after.retrieval_title_assist_used === true
      },
      catalog_selected_candidate_id: {
        no_lazy: before.catalog_selected_candidate_id || "",
        lazy: after.catalog_selected_candidate_id || ""
      },
      vector_selected_candidate_id: {
        no_lazy: before.vector_selected_candidate_id || "",
        lazy: after.vector_selected_candidate_id || ""
      },
      candidate_recall_at_1: {
        no_lazy: before.correct_candidate_recall_at_1 === true,
        lazy: after.correct_candidate_recall_at_1 === true
      },
      candidate_recall_at_3: {
        no_lazy: before.correct_candidate_recall_at_3 === true,
        lazy: after.correct_candidate_recall_at_3 === true
      },
      candidate_recall_at_5: {
        no_lazy: before.correct_candidate_recall_at_5 === true,
        lazy: after.correct_candidate_recall_at_5 === true
      },
      catalog_prompt_candidate_count: {
        no_lazy: Number(before.catalog_prompt_candidate_count || 0),
        lazy: Number(after.catalog_prompt_candidate_count || 0)
      },
      vector_prompt_candidate_count: {
        no_lazy: Number(before.vector_prompt_candidate_count || 0),
        lazy: Number(after.vector_prompt_candidate_count || 0)
      },
      copied_serial_grade_cert_from_reference: {
        no_lazy: before.copied_serial_grade_cert_from_reference === true,
        lazy: after.copied_serial_grade_cert_from_reference === true
      },
      change: recovery ? "recovery" : regression ? "regression" : "no_change"
    };
  });

  const regressionCount = countWhere(trace, (item) => item.change === "regression");
  const recoveryCount = countWhere(trace, (item) => item.change === "recovery");
  const lazySkipRegressionCount = countWhere(trace, (item) => item.vector_lazy_skip === true && item.change === "regression");
  const lazySkipCount = countWhere(trace, (item) => item.vector_lazy_skip === true);
  const lazyCopiedCount = copiedReferenceCount(lazy);
  const catalogRecoveryNotDown = Number(lazy.catalog_recovery_count || 0) >= Number(noLazy.catalog_recovery_count || 0);
  const p50DeltaMs = latencyDelta(noLazy, lazy, "p50");
  const p95DeltaMs = latencyDelta(noLazy, lazy, "p95");
  const p50Improved = p50DeltaMs !== null && p50DeltaMs <= -Math.abs(substantialTimingImprovementMs);
  const p95Improved = p95DeltaMs !== null && p95DeltaMs <= -Math.abs(substantialTimingImprovementMs);
  const p50NotWorse = p50DeltaMs !== null && p50DeltaMs <= Math.abs(allowedTimingRegressionMs);
  const p95NotWorse = p95DeltaMs !== null && p95DeltaMs <= Math.abs(allowedTimingRegressionMs);
  const timingImproved = (p50Improved || p95Improved) && p50NotWorse && p95NotWorse;
  const enoughLazySkipSamples = lazySkipCount >= Math.max(0, Number(requiredLazySkipCount) || 0);
  const failReasons = [
    enoughLazySkipSamples ? "" : "NO_VECTOR_LAZY_SKIP_SAMPLES",
    regressionCount === 0 ? "" : "OVERALL_TITLE_REGRESSION",
    lazySkipRegressionCount === 0 ? "" : "VECTOR_LAZY_SKIP_TITLE_REGRESSION",
    lazyCopiedCount === 0 ? "" : "COPIED_REFERENCE_INSTANCE_FIELD",
    catalogRecoveryNotDown ? "" : "CATALOG_RECOVERY_DOWN",
    timingImproved ? "" : "TIMING_NOT_IMPROVED"
  ].filter(Boolean);
  const guardrailPassed = enoughLazySkipSamples
    && regressionCount === 0
    && lazySkipRegressionCount === 0
    && lazyCopiedCount === 0
    && catalogRecoveryNotDown
    && timingImproved;

  return {
    schema_version: "vector-lazy-guardrail-v1",
    status: guardrailPassed ? "passed" : "failed",
    generated_at: new Date().toISOString(),
    inputs: {
      no_lazy: noLazyPath,
      lazy: lazyPath
    },
    threshold,
    min_regression_delta: minRegressionDelta,
    required_lazy_skip_count: requiredLazySkipCount,
    substantial_timing_improvement_ms: substantialTimingImprovementMs,
    allowed_timing_regression_ms: allowedTimingRegressionMs,
    summary: {
      compared_count: trace.length,
      overall_recovery_count: recoveryCount,
      overall_regression_count: regressionCount,
      recovery_count: recoveryCount,
      regression_count: regressionCount,
      net_benefit: recoveryCount - regressionCount,
      vector_lazy_skip_count: lazySkipCount,
      vector_lazy_skip_rate: rate(lazySkipCount, trace.length),
      vector_lazy_skip_sample_requirement_met: enoughLazySkipSamples,
      vector_lazy_skip_regression_count: lazySkipRegressionCount,
      copied_serial_grade_cert_from_reference_count: {
        no_lazy: copiedReferenceCount(noLazy),
        lazy: lazyCopiedCount
      },
      card_type_default_base_count: {
        no_lazy: countReportFlag(noLazy, "card_type_default_base"),
        lazy: countReportFlag(lazy, "card_type_default_base")
      },
      base_without_catalog_support_count: {
        no_lazy: countReportFlag(noLazy, "base_without_catalog_support"),
        lazy: countReportFlag(lazy, "base_without_catalog_support")
      },
      base_in_resolved_fields_count: {
        no_lazy: countReportFlag(noLazy, "base_in_resolved_fields"),
        lazy: countReportFlag(lazy, "base_in_resolved_fields")
      },
      base_in_rendered_title_count: {
        no_lazy: countReportFlag(noLazy, "base_in_rendered_title"),
        lazy: countReportFlag(lazy, "base_in_rendered_title")
      },
      raw_blind_output_accuracy: {
        no_lazy: noLazy.raw_blind_output_accuracy || null,
        lazy: lazy.raw_blind_output_accuracy || null
      },
      candidate_recall_at_1: {
        no_lazy: noLazy.candidate_recall_at_1 || null,
        lazy: lazy.candidate_recall_at_1 || null
      },
      candidate_recall_at_3: {
        no_lazy: noLazy.candidate_recall_at_3 || null,
        lazy: lazy.candidate_recall_at_3 || null
      },
      candidate_recall_at_5: {
        no_lazy: noLazy.candidate_recall_at_5 || null,
        lazy: lazy.candidate_recall_at_5 || null
      },
      catalog_recovery_count: {
        no_lazy: noLazy.catalog_recovery_count ?? null,
        lazy: lazy.catalog_recovery_count ?? null,
        not_down: catalogRecoveryNotDown
      },
      catalog_regression_count: {
        no_lazy: noLazy.catalog_regression_count ?? null,
        lazy: lazy.catalog_regression_count ?? null
      },
      vector_regression_count: regressionCount,
      latency_ms: {
        no_lazy: latency(noLazy),
        lazy: latency(lazy)
      },
      p50_delta_ms: p50DeltaMs,
      p95_delta_ms: p95DeltaMs,
      p50_improved: p50Improved,
      p95_improved: p95Improved,
      p50_not_worse: p50NotWorse,
      p95_not_worse: p95NotWorse,
      timing_improved: timingImproved,
      fail_reasons: failReasons,
      guardrail_passed: guardrailPassed
    },
    per_card: trace
  };
}

export async function main(argv = process.argv) {
  const noLazyPath = argValue(argv, "--no-lazy", "");
  const lazyPath = argValue(argv, "--lazy", "");
  const outPath = argValue(argv, "--out", "");
  const threshold = Number(argValue(argv, "--threshold", "0.72")) || 0.72;
  const substantialTimingImprovementMs = Number(argValue(argv, "--substantial-timing-improvement-ms", "100")) || 100;
  const allowedTimingRegressionMs = Number(argValue(argv, "--allowed-timing-regression-ms", "250")) || 250;
  const report = await compareVectorLazyGuardrail({
    noLazyPath,
    lazyPath,
    threshold,
    substantialTimingImprovementMs,
    allowedTimingRegressionMs
  });
  if (outPath) await writeJson(outPath, report);
  process.stdout.write([
    `vector lazy guardrail ${report.status}`,
    `compared_count: ${report.summary.compared_count}`,
    `vector_lazy_skip_count: ${report.summary.vector_lazy_skip_count}`,
    `vector_lazy_skip_sample_requirement_met: ${report.summary.vector_lazy_skip_sample_requirement_met}`,
    `vector_lazy_skip_regression_count: ${report.summary.vector_lazy_skip_regression_count}`,
    `regression_count: ${report.summary.regression_count}`,
    `recovery_count: ${report.summary.recovery_count}`,
    `net_benefit: ${report.summary.net_benefit}`,
    `copied_serial_grade_cert_from_reference_count: ${JSON.stringify(report.summary.copied_serial_grade_cert_from_reference_count)}`,
    `base_without_catalog_support_count: ${JSON.stringify(report.summary.base_without_catalog_support_count)}`,
    `p50_delta_ms: ${report.summary.p50_delta_ms ?? "n/a"}`,
    `p95_delta_ms: ${report.summary.p95_delta_ms ?? "n/a"}`,
    `p50_improved: ${report.summary.p50_improved}`,
    `p95_improved: ${report.summary.p95_improved}`,
    `p50_not_worse: ${report.summary.p50_not_worse}`,
    `p95_not_worse: ${report.summary.p95_not_worse}`,
    `fail_reasons: ${(report.summary.fail_reasons || []).join(",") || "n/a"}`
  ].join("\n") + "\n");
  return report.status === "passed" ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Vector lazy guardrail failed: ${error.message}`);
    process.exit(1);
  }
}
