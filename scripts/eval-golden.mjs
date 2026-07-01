import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateGoldenDataset } from "../lib/listing/evaluation/golden-dataset.mjs";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const datasetPath = resolve(argValue("--dataset", process.env.GOLDEN_DATASET_PATH || "data/golden-dataset.json"));
const reportPath = argValue("--report", process.env.GOLDEN_EVAL_REPORT_PATH || "");

if (!existsSync(datasetPath)) {
  console.error(`Golden dataset not found: ${datasetPath}`);
  process.exit(1);
}

let dataset;
try {
  dataset = JSON.parse(await readFile(datasetPath, "utf8"));
} catch (error) {
  console.error(`Golden dataset is not valid JSON: ${error.message}`);
  process.exit(1);
}

const report = evaluateGoldenDataset(dataset);
if (!report.ok) {
  console.error("Golden dataset validation failed:");
  report.validation.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

function formatBreakdown(breakdown = {}) {
  const entries = Object.entries(breakdown).sort(([leftKey, leftMetric], [rightKey, rightMetric]) => {
    const totalDelta = Number(rightMetric.total_assets || 0) - Number(leftMetric.total_assets || 0);
    if (totalDelta !== 0) return totalDelta;
    return leftKey.localeCompare(rightKey);
  });

  if (!entries.length) return "n/a";

  return entries.map(([key, metric]) => {
    const total = Number(metric.total_assets || 0);
    const exact = Number(metric.exact_assets || 0);
    const rate = metric.rate ?? "n/a";
    return `${key}=${exact}/${total}(${rate})`;
  }).join(", ");
}

function formatConfidenceInterval(interval = {}) {
  if (interval.lower === null || interval.upper === null) return "n/a";
  return `${interval.lower}..${interval.upper}`;
}

function formatFailureRootCauses(rootCauses = {}) {
  const entries = Object.entries(rootCauses);
  if (!entries.length) return "none";

  return entries.map(([cause, metric]) => {
    return `${cause}=${metric.assets}/${report.dataset.total_assets}(${metric.asset_rate ?? "n/a"})`;
  }).join(", ");
}

function formatFieldErrors(fieldErrors = {}) {
  const entries = Object.entries(fieldErrors)
    .filter(([, metric]) => Number(metric.incorrect || 0) > 0);
  if (!entries.length) return "none";

  return entries.map(([field, metric]) => {
    return `${field}=${metric.incorrect}/${metric.total}(${metric.error_rate ?? "n/a"})`;
  }).join(", ");
}

function formatRetrievalProviderGains(gains = {}) {
  const entries = Object.entries(gains);
  if (!entries.length) return "none";

  return entries.map(([provider, metric]) => {
    return [
      `${provider}=used:${metric.used_assets}/${report.dataset.total_assets}(${metric.usage_rate ?? "n/a"})`,
      `recovered:${metric.recovered_assets}/${metric.used_assets}(${metric.recovery_rate ?? "n/a"})`,
      `reference:${metric.reference_helped_assets}/${metric.used_assets}(${metric.reference_helped_rate ?? "n/a"})`,
      `exact_when_used:${metric.exact_assets_when_used}/${metric.used_assets}(${metric.exact_when_used_rate ?? "n/a"})`
    ].join(" ");
  }).join(", ");
}

function formatVisionProviderComparison(comparison = {}) {
  const entries = Object.entries(comparison.providers || {});
  if (!entries.length) return "none";

  return entries.map(([provider, metric]) => {
    return [
      `${provider}=exact:${metric.exact_assets}/${metric.total_assets}(${metric.exact_rate ?? "n/a"})`,
      `ai_complete_precision:${metric.ai_complete_exact_assets}/${metric.ai_complete_assets}(${metric.ai_complete_precision ?? "n/a"})`,
      `false_ai_complete:${metric.false_ai_complete_assets}`,
      `technical_failure:${metric.technical_failure_assets}/${metric.total_assets}(${metric.technical_failure_rate ?? "n/a"})`,
      `accepted_critical_error:${metric.accepted_critical_error_assets}/${metric.total_assets}(${metric.accepted_critical_error_rate ?? "n/a"})`
    ].join(" ");
  }).join(", ");
}

function formatAcceptanceGate(gate = {}) {
  return [
    `scope:${gate.metric_scope || "n/a"}`,
    `eligible:${gate.eligible === true}`,
    `passed:${gate.passed === true}`,
    `minimum_held_out_assets:${gate.minimum_held_out_assets ?? "n/a"}`
  ].join(" ");
}

function formatGlareImpact(glare = {}) {
  return [
    `glare_assets:${glare.glare_assets}/${report.dataset.total_assets}(${glare.glare_asset_rate ?? "n/a"})`,
    `exact:${glare.exact_assets}/${glare.glare_assets}(${glare.exact_rate ?? "n/a"})`,
    `non_glare_exact:${glare.non_glare_exact_rate ?? "n/a"}`,
    `delta:${glare.exact_rate_delta_vs_non_glare ?? "n/a"}`,
    `human_critical:${glare.human_critical_resolution_assets}/${glare.glare_assets}(${glare.human_critical_resolution_rate ?? "n/a"})`,
    `accepted_critical_error:${glare.accepted_critical_error_assets}/${glare.glare_assets}(${glare.accepted_critical_error_rate ?? "n/a"})`,
    `technical_failure:${glare.technical_failure_assets}/${glare.glare_assets}(${glare.technical_failure_rate ?? "n/a"})`,
    `recovered:${glare.recovered_assets}/${glare.recovery_attempted_assets}(${glare.recovery_rate ?? "n/a"})`,
    `final_approved:${glare.final_approved_exact_assets}/${glare.final_approved_assets}(${glare.final_approved_publish_accuracy ?? "n/a"})`
  ].join(" ");
}

if (reportPath) {
  await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
}

console.log("Golden dataset evaluation complete");
console.log(`dataset: ${datasetPath}`);
console.log(`total_assets: ${report.dataset.total_assets}`);
console.log(`evaluated_assets: ${report.dataset.evaluated_assets}`);
console.log(`legacy_metric_scope: ${report.dataset.legacy_metric_scope}`);
console.log(`commercial_metric_scope: ${report.dataset.commercial_metric_scope}`);
console.log(`held_out_commercial_assets: ${report.held_out_commercial_evidence.total_assets}`);
console.log(`held_out_commercial_evaluated_assets: ${report.held_out_commercial_evidence.evaluated_assets}`);
console.log(`commercial_acceptance_gate: ${formatAcceptanceGate(report.commercial_acceptance_gate)}`);
console.log(`commercial_acceptance_reasons: ${report.commercial_acceptance_gate.reasons.length ? report.commercial_acceptance_gate.reasons.join("; ") : "none"}`);
console.log(`ai_overall_exact_resolution_rate: ${report.commercial_metrics.ai_overall_exact_resolution_rate ?? "n/a"}`);
console.log(`card_level_exact_accuracy: ${report.commercial_metrics.card_level_exact_accuracy ?? "n/a"}`);
console.log(`field_level_accuracy: ${report.commercial_metrics.field_level_accuracy ?? "n/a"}`);
console.log(`human_authored_critical_resolution_rate: ${report.commercial_metrics.human_authored_critical_resolution_rate ?? "n/a"}`);
console.log(`accepted_critical_error_rate: ${report.commercial_metrics.accepted_critical_error_rate ?? "n/a"}`);
console.log(`ai_complete_result_precision: ${report.commercial_metrics.ai_complete_result_precision ?? "n/a"}`);
console.log(`final_approved_publish_accuracy: ${report.commercial_metrics.final_approved_publish_accuracy ?? "n/a"}`);
console.log(`technical_failure_rate: ${report.commercial_metrics.technical_failure_rate ?? "n/a"}`);
console.log(`false_ai_complete_assets: ${report.counts.false_ai_complete_assets}`);
console.log(`routing_accuracy: ${report.commercial_metrics.routing_accuracy ?? "n/a"}`);
console.log(`non_standard_recall: ${report.commercial_metrics.non_standard_recall ?? "n/a"}`);
console.log(`retrieval_recovery_rate: ${report.commercial_metrics.retrieval_recovery_rate.rate ?? "n/a"}`);
console.log(`focused_reread_recovery_rate: ${report.commercial_metrics.focused_reread_recovery_rate.rate ?? "n/a"}`);
console.log(`targeted_rescan_recovery_rate: ${report.commercial_metrics.targeted_rescan_recovery_rate.rate ?? "n/a"}`);
console.log(`glare_recovery_rate: ${report.commercial_metrics.glare_recovery_rate.rate ?? "n/a"}`);
console.log(`held_out_ai_overall_exact_resolution_rate: ${report.held_out_commercial_evidence.commercial_metrics.ai_overall_exact_resolution_rate ?? "n/a"}`);
console.log(`held_out_ai_complete_result_precision: ${report.held_out_commercial_evidence.commercial_metrics.ai_complete_result_precision ?? "n/a"}`);
console.log(`held_out_accepted_critical_error_rate: ${report.held_out_commercial_evidence.commercial_metrics.accepted_critical_error_rate ?? "n/a"}`);
console.log(`held_out_human_authored_critical_resolution_rate: ${report.held_out_commercial_evidence.commercial_metrics.human_authored_critical_resolution_rate ?? "n/a"}`);
console.log(`average_review_duration_ms: ${report.operational_metrics.average_review_duration_ms ?? "n/a"}`);
console.log(`average_provider_calls: ${report.operational_metrics.average_provider_calls ?? "n/a"}`);
console.log(`average_retrieval_rounds: ${report.operational_metrics.average_retrieval_rounds ?? "n/a"}`);
console.log(`cost_per_asset: ${report.operational_metrics.cost_per_asset ?? "n/a"}`);
console.log(`provider_breakdown: ${formatBreakdown(report.breakdowns.provider)}`);
console.log(`category_breakdown: ${formatBreakdown(report.breakdowns.category)}`);
console.log(`difficulty_breakdown: ${formatBreakdown(report.breakdowns.difficulty)}`);
console.log(`confidence_interval_method: ${report.confidence_intervals.method}`);
console.log(`ai_overall_exact_resolution_rate_ci95: ${formatConfidenceInterval(report.confidence_intervals.ai_overall_exact_resolution_rate)}`);
console.log(`ai_complete_result_precision_ci95: ${formatConfidenceInterval(report.confidence_intervals.ai_complete_result_precision)}`);
console.log(`accepted_critical_error_rate_ci95: ${formatConfidenceInterval(report.confidence_intervals.accepted_critical_error_rate)}`);
console.log(`final_approved_publish_accuracy_ci95: ${formatConfidenceInterval(report.confidence_intervals.final_approved_publish_accuracy)}`);
console.log(`failure_root_causes: ${formatFailureRootCauses(report.failure_analysis.root_causes)}`);
console.log(`field_error_distribution: ${formatFieldErrors(report.failure_analysis.field_error_distribution)}`);
console.log(`glare_impact: ${formatGlareImpact(report.glare_impact)}`);
console.log(`retrieval_provider_gains: ${formatRetrievalProviderGains(report.retrieval_provider_gains)}`);
console.log(`vision_provider_comparison: ${formatVisionProviderComparison(report.vision_provider_comparison)}`);
report.warnings.forEach((warning) => console.log(`warning: ${warning}`));
