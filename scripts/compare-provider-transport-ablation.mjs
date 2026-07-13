#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const comparedFieldNames = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "players",
  "card_name",
  "release_variant",
  "surface_color",
  "parallel",
  "collector_number",
  "checklist_code",
  "card_number",
  "tcg_card_number",
  "print_run_number",
  "print_run_denominator",
  "grade_company",
  "card_grade",
  "auto_grade"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values = [], fraction = 0.5) {
  const sorted = values.map(finiteNumber).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function normalizedValue(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).sort().join("|").toLowerCase();
  if (typeof value === "boolean") return value ? "true" : "false";
  return cleanText(value).toLowerCase();
}

function changedFields(left = {}, right = {}) {
  return comparedFieldNames.filter((field) => normalizedValue(left?.[field]) !== normalizedValue(right?.[field]));
}

function weakPolicyScore(row = {}) {
  return finiteNumber(row.final_scoring?.policy_fair_token_recall);
}

function capacityRefillFromRow(row = {}) {
  return row.writer_ready_capacity_refill || row.writer_ready_capacity_release?.refill || null;
}

function transportSummary(report = {}, rows = []) {
  const provider = report.summary?.provider_diagnostics || {};
  const nodeObservability = report.summary?.pipeline_node_observability || {};
  const fieldQualityCheckIds = new Set([
    "critical_field_flow_has_no_silent_drop",
    "field_flow_has_no_cross_bracket_composite_migration"
  ]);
  const observedAnomalies = (Array.isArray(nodeObservability.anomaly_examples)
    ? nodeObservability.anomaly_examples
    : []).flatMap((example) => Array.isArray(example.anomalies) ? example.anomalies : []);
  const errorAnomalies = observedAnomalies.filter((anomaly) => anomaly?.severity === "ERROR");
  const unclassifiedErrorCount = Math.max(0, Number(nodeObservability.error_count || 0) - errorAnomalies.length);
  const runWallMs = finiteNumber(report.summary?.run_wall_ms);
  return {
    attempted_count: rows.length,
    completed_count: rows.filter((row) => row.ok === true && row.l2_ready === true).length,
    technical_failure_count: rows.filter((row) => row.ok !== true || row.l2_ready !== true).length,
    run_wall_ms: runWallMs,
    completed_cards_per_minute: runWallMs && runWallMs > 0
      ? (rows.filter((row) => row.ok === true && row.l2_ready === true).length * 60_000) / runWallMs
      : null,
    writer_ready_p50_ms: percentile(rows.map((row) => row.time_to_writer_ready_ms), 0.5),
    writer_ready_p95_ms: percentile(rows.map((row) => row.time_to_writer_ready_ms), 0.95),
    scheduler_queue_wait_p50_ms: percentile(rows.map((row) => row.scheduler_queue_wait_ms), 0.5),
    scheduler_queue_wait_p95_ms: percentile(rows.map((row) => row.scheduler_queue_wait_ms), 0.95),
    provider_latency_p50_ms: percentile(rows.map((row) => row.provider_latency_ms), 0.5),
    provider_latency_p95_ms: percentile(rows.map((row) => row.provider_latency_ms), 0.95),
    input_tokens_total: rows.reduce((sum, row) => sum + (finiteNumber(row.input_tokens) || 0), 0),
    output_tokens_total: rows.reduce((sum, row) => sum + (finiteNumber(row.output_tokens) || 0), 0),
    total_tokens_total: rows.reduce((sum, row) => sum + (finiteNumber(row.total_tokens) || 0), 0),
    weak_policy_score_avg: (() => {
      const values = rows.map(weakPolicyScore).filter((value) => value !== null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    })(),
    node_error_count: nodeObservability.error_count ?? null,
    transport_node_error_count: errorAnomalies.filter((anomaly) => !fieldQualityCheckIds.has(anomaly.check_id)).length + unclassifiedErrorCount,
    field_quality_error_count: errorAnomalies.filter((anomaly) => fieldQualityCheckIds.has(anomaly.check_id)).length,
    identity_cache_hit_count: rows.filter((row) => row.identity_cache_hit === true).length,
    identity_cache_bypassed_count: rows.filter((row) => row.identity_cache_read_bypassed === true).length,
    provider_done_capacity_release_count: rows.filter((row) => (
      row.writer_ready_capacity_release?.released === true
      && row.writer_ready_capacity_release_mode === "provider_done"
    )).length,
    writer_ready_atomic_capacity_release_count: rows.filter((row) => (
      row.writer_ready_capacity_release?.released === true
      && row.writer_ready_capacity_release_mode === "writer_ready_atomic"
    )).length,
    capacity_refill_triggered_count: rows.filter((row) => capacityRefillFromRow(row)?.triggered === true).length,
    capacity_refill_missing_count: rows.filter((row) => (
      row.writer_ready_capacity_release?.released === true
      && capacityRefillFromRow(row)?.triggered !== true
    )).length,
    response_profile_breakdown: provider.response_profile_breakdown || {},
    prompt_mode_breakdown: provider.prompt_mode_breakdown || {},
    image_detail_breakdown: provider.image_detail_breakdown || {},
    text_verbosity_breakdown: provider.text_verbosity_breakdown || {},
    requested_service_tier_breakdown: provider.requested_service_tier_breakdown || {},
    service_tier_breakdown: provider.service_tier_breakdown || {},
    prompt_chars_p50: provider.prompt_chars_p50 ?? null,
    prompt_chars_p95: provider.prompt_chars_p95 ?? null
  };
}

function deltaPercent(before, after) {
  const left = finiteNumber(before);
  const right = finiteNumber(after);
  if (left === null || right === null || left === 0) return null;
  return (right - left) / left;
}

export function compareProviderTransportReports(baseline = {}, compact = {}) {
  const baselineRows = Array.isArray(baseline.results) ? baseline.results : [];
  const compactRows = Array.isArray(compact.results) ? compact.results : [];
  const compactByAsset = new Map(compactRows.map((row) => [cleanText(row.asset_id), row]));
  const pairs = baselineRows.map((baselineRow) => {
    const compactRow = compactByAsset.get(cleanText(baselineRow.asset_id)) || null;
    const baselineScore = weakPolicyScore(baselineRow);
    const compactScore = weakPolicyScore(compactRow || {});
    const scoreDelta = baselineScore === null || compactScore === null ? null : compactScore - baselineScore;
    return {
      asset_id: cleanText(baselineRow.asset_id),
      baseline_completed: baselineRow.ok === true && baselineRow.l2_ready === true,
      compact_completed: compactRow?.ok === true && compactRow?.l2_ready === true,
      baseline_title: cleanText(baselineRow.final_title),
      compact_title: cleanText(compactRow?.final_title),
      title_exact_match: cleanText(baselineRow.final_title) === cleanText(compactRow?.final_title),
      changed_fields: changedFields(baselineRow.resolved_fields || {}, compactRow?.resolved_fields || {}),
      baseline_writer_ready_ms: finiteNumber(baselineRow.time_to_writer_ready_ms),
      compact_writer_ready_ms: finiteNumber(compactRow?.time_to_writer_ready_ms),
      baseline_provider_latency_ms: finiteNumber(baselineRow.provider_latency_ms),
      compact_provider_latency_ms: finiteNumber(compactRow?.provider_latency_ms),
      baseline_input_tokens: finiteNumber(baselineRow.input_tokens),
      compact_input_tokens: finiteNumber(compactRow?.input_tokens),
      baseline_output_tokens: finiteNumber(baselineRow.output_tokens),
      compact_output_tokens: finiteNumber(compactRow?.output_tokens),
      baseline_weak_policy_score: baselineScore,
      compact_weak_policy_score: compactScore,
      weak_policy_score_delta: scoreDelta,
      weak_proxy_outcome: scoreDelta === null || Math.abs(scoreDelta) < 1e-9
        ? "NO_CHANGE"
        : scoreDelta > 0 ? "RECOVERY" : "REGRESSION",
      seller_title_weak_label: cleanText(compactRow?.seller_title || baselineRow.seller_title),
      baseline_error: baselineRow.error || null,
      compact_error: compactRow?.error || null
    };
  });
  const pairedRows = pairs.filter((pair) => compactByAsset.has(pair.asset_id));
  const baselineSummary = transportSummary(baseline, baselineRows);
  const compactSummary = transportSummary(compact, compactRows);
  const completePairs = pairedRows.filter((pair) => pair.baseline_completed && pair.compact_completed);

  return {
    schema_version: "provider-transport-ablation-v1",
    generated_at: new Date().toISOString(),
    comparison_policy: {
      same_images: true,
      same_model_required: true,
      identity_cache_disabled_required: true,
      seller_title_visible_to_model: false,
      seller_title_is_ground_truth: false,
      weak_policy_score_is_diagnostic_only: true
    },
    paired_count: pairedRows.length,
    complete_pair_count: completePairs.length,
    baseline: baselineSummary,
    compact: compactSummary,
    deltas: {
      writer_ready_p50_fraction: deltaPercent(baselineSummary.writer_ready_p50_ms, compactSummary.writer_ready_p50_ms),
      writer_ready_p95_fraction: deltaPercent(baselineSummary.writer_ready_p95_ms, compactSummary.writer_ready_p95_ms),
      scheduler_queue_wait_p50_fraction: deltaPercent(baselineSummary.scheduler_queue_wait_p50_ms, compactSummary.scheduler_queue_wait_p50_ms),
      scheduler_queue_wait_p95_fraction: deltaPercent(baselineSummary.scheduler_queue_wait_p95_ms, compactSummary.scheduler_queue_wait_p95_ms),
      completed_cards_per_minute_fraction: deltaPercent(baselineSummary.completed_cards_per_minute, compactSummary.completed_cards_per_minute),
      provider_latency_p50_fraction: deltaPercent(baselineSummary.provider_latency_p50_ms, compactSummary.provider_latency_p50_ms),
      provider_latency_p95_fraction: deltaPercent(baselineSummary.provider_latency_p95_ms, compactSummary.provider_latency_p95_ms),
      input_tokens_fraction: deltaPercent(baselineSummary.input_tokens_total, compactSummary.input_tokens_total),
      output_tokens_fraction: deltaPercent(baselineSummary.output_tokens_total, compactSummary.output_tokens_total),
      weak_policy_score: baselineSummary.weak_policy_score_avg === null || compactSummary.weak_policy_score_avg === null
        ? null
        : compactSummary.weak_policy_score_avg - baselineSummary.weak_policy_score_avg
    },
    title_exact_match_count: completePairs.filter((pair) => pair.title_exact_match).length,
    recovery_count: completePairs.filter((pair) => pair.weak_proxy_outcome === "RECOVERY").length,
    regression_count: completePairs.filter((pair) => pair.weak_proxy_outcome === "REGRESSION").length,
    no_change_count: completePairs.filter((pair) => pair.weak_proxy_outcome === "NO_CHANGE").length,
    pairs
  };
}

function argValue(argv, flag, fallback = "") {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function main(argv = process.argv) {
  const baselinePath = argValue(argv, "--baseline");
  const compactPath = argValue(argv, "--compact");
  const outPath = argValue(argv, "--out", "/tmp/provider-transport-ablation.json");
  if (!baselinePath || !compactPath) throw new Error("--baseline and --compact are required");
  const baseline = JSON.parse(await readFile(resolve(baselinePath), "utf8"));
  const compact = JSON.parse(await readFile(resolve(compactPath), "utf8"));
  const report = compareProviderTransportReports(baseline, compact);
  await writeFile(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    paired_count: report.paired_count,
    complete_pair_count: report.complete_pair_count,
    baseline: report.baseline,
    compact: report.compact,
    deltas: report.deltas,
    recovery_count: report.recovery_count,
    regression_count: report.regression_count
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
