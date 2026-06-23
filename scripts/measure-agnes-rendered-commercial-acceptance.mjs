import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCommercialAcceptanceRow } from "./measure-agnes-commercial-acceptance-proxy.mjs";
import { titleComparison } from "./evaluate-agnes-supabase-feedback.mjs";
import { renderResolvedTitle } from "../lib/listing/renderer/listing-renderer.mjs";

const schemaVersion = "agnes-rendered-commercial-acceptance-v1";
const defaultInputPath = "data/eval/agnes-supabase-feedback-latest.json";
const defaultOutPath = "data/eval/agnes-rendered-commercial-acceptance-latest.json";
const defaultMaxTitleLength = 80;
const defaultTargetAccuracy = 0.95;
const defaultMaxManualRate = 0.05;

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArg(argv, name, fallback) {
  const raw = argValue(argv, name, null);
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function sortedCounts(map) {
  return Object.fromEntries([...map.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  }));
}

function resultId(result = {}) {
  return normalizeText(result.source_feedback_id || result.candidate_id || result.asset_id);
}

export function renderedResult(result = {}, {
  maxTitleLength = defaultMaxTitleLength
} = {}) {
  if (result.status !== "evaluated") return result;
  if (result.identity_resolution_status === "ABSTAIN"
    || result.prediction?.identity_resolution_status === "ABSTAIN"
    || result.prediction?.title_render_source === "identity_resolution_abstain") {
    return {
      ...result,
      prediction: {
        ...(result.prediction || {}),
        model_title_suggestion_available: Boolean(result.prediction?.title),
        title: "",
        final_title: "",
        rendered_title: "",
        title_render_source: "identity_resolution_abstain"
      },
      corrected_title_comparison: titleComparison(result.corrected_title_reference || "", ""),
      rendered_title_policy: result.rendered_title_policy || null,
      rendered_title_renderer: result.rendered_title_renderer || null
    };
  }
  const fields = result.prediction?.fields || {};
  const rendered = renderResolvedTitle(fields, { maxLength: maxTitleLength });
  const renderedTitle = rendered.rendered_title || "";
  return {
    ...result,
    prediction: {
      ...(result.prediction || {}),
      model_title_suggestion_available: Boolean(result.prediction?.title),
      title: renderedTitle,
      final_title: renderedTitle,
      rendered_title: renderedTitle,
      title_render_source: "deterministic_renderer"
    },
    corrected_title_comparison: titleComparison(result.corrected_title_reference || "", renderedTitle),
    rendered_title_policy: rendered.title_length_policy || null,
    rendered_title_renderer: rendered.renderer || null
  };
}

function summarizeRows(rows = []) {
  const primaryFailureReasons = new Map();
  const allFailureReasons = new Map();
  const principleFailures = new Map();
  const fieldMismatches = new Map();
  const titleContentMismatches = new Map();
  const diagnostics = new Map();
  rows.forEach((row) => {
    if (!row.accepted) increment(primaryFailureReasons, row.primary_failure_reason || "unknown");
    row.failure_reasons.forEach((reason) => increment(allFailureReasons, reason));
    row.principle_failures.forEach((reason) => increment(principleFailures, reason));
    row.title_derived_field_mismatches.forEach((field) => increment(fieldMismatches, field));
    (row.title_content_mismatches || []).forEach((field) => increment(titleContentMismatches, field));
    row.diagnostic_reasons.forEach((reason) => increment(diagnostics, reason));
  });
  return {
    primary_failure_reasons: sortedCounts(primaryFailureReasons),
    all_failure_reasons: sortedCounts(allFailureReasons),
    principle_failures: sortedCounts(principleFailures),
    title_derived_field_mismatches: sortedCounts(fieldMismatches),
    title_content_mismatches: sortedCounts(titleContentMismatches),
    token_diagnostics: sortedCounts(diagnostics)
  };
}

function itemSummary(result, baseRow, renderedRow) {
  return {
    source_feedback_id: resultId(result),
    provider_status: result.status || "not_evaluated",
    base_accepted: baseRow.accepted,
    rendered_accepted: renderedRow.accepted,
    outcome: baseRow.accepted && renderedRow.accepted
      ? "already_accepted"
      : !baseRow.accepted && renderedRow.accepted
        ? "renderer_recovered"
        : baseRow.accepted && !renderedRow.accepted
          ? "renderer_regressed"
          : "still_failing",
    base_primary_failure_reason: baseRow.primary_failure_reason || "",
    rendered_primary_failure_reason: renderedRow.primary_failure_reason || "",
    base_failure_reasons: baseRow.failure_reasons,
    rendered_failure_reasons: renderedRow.failure_reasons,
    rendered_principle_failures: renderedRow.principle_failures,
    rendered_title_derived_field_mismatches: renderedRow.title_derived_field_mismatches,
    rendered_title_content_mismatches: renderedRow.title_content_mismatches || [],
    rendered_token_diagnostics: renderedRow.diagnostic_reasons
  };
}

export function measureAgnesRenderedCommercialAcceptance({
  report,
  maxTitleLength = defaultMaxTitleLength,
  targetAccuracy = defaultTargetAccuracy,
  maxManualRate = defaultMaxManualRate,
  now = () => new Date()
} = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const targetRows = report?.target_count ?? results.length;
  const targetCorrectCount = Math.ceil(targetRows * targetAccuracy);
  const maxManualCount = Math.floor(targetRows * maxManualRate);
  const baseRows = results.map((result) => evaluateCommercialAcceptanceRow(result));
  const renderedResults = results.map((result) => renderedResult(result, { maxTitleLength }));
  const renderedRows = renderedResults.map((result) => evaluateCommercialAcceptanceRow(result));
  const baseAccepted = baseRows.filter((row) => row.accepted).length;
  const renderedAccepted = renderedRows.filter((row) => row.accepted).length;
  const items = results.map((result, index) => itemSummary(result, baseRows[index], renderedRows[index]));
  const recovered = items.filter((item) => item.outcome === "renderer_recovered").length;
  const regressed = items.filter((item) => item.outcome === "renderer_regressed").length;
  const renderedManual = Math.max(0, targetRows - renderedAccepted);

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    status: "completed",
    source: {
      provider: report?.provider || "agnes",
      input_schema_version: report?.schema_version || null,
      target_rows: targetRows,
      evaluated_rows: report?.evaluated_count ?? results.filter((result) => result.status === "evaluated").length,
      provider_error_count: report?.provider_error_count ?? results.filter((result) => result.status === "provider_error").length
    },
    scope: {
      metric_type: "deterministic_renderer_final_title_commercial_acceptance_proxy",
      exact_title_match_required: false,
      word_order_required: false,
      token_similarity_is_diagnostic_only: true,
      field_ground_truth_available: false,
      corrected_title_reference_only: true,
      commercial_accuracy_claim_allowed: false,
      no_feedback_retention_side_effects: true,
      raw_titles_in_report: false
    },
    policy: {
      commercial_acceptance_policy: "principle-safe-title-content-v1",
      title_render_source: "deterministic_renderer",
      max_title_length: maxTitleLength,
      target_automated_accuracy: targetAccuracy,
      max_manual_rate: maxManualRate,
      target_auto_correct_count: targetCorrectCount,
      max_manual_count: maxManualCount
    },
    metrics: {
      base_provider_title_accepted_count: baseAccepted,
      rendered_title_accepted_count: renderedAccepted,
      renderer_recovered_count: recovered,
      renderer_regressed_count: regressed,
      rendered_manual_or_reject_count: renderedManual,
      target_rows: targetRows,
      base_provider_title_accepted_rate: rate(baseAccepted, targetRows),
      rendered_title_accepted_rate: rate(renderedAccepted, targetRows),
      rendered_manual_or_reject_rate: rate(renderedManual, targetRows),
      additional_auto_correct_needed_for_target: Math.max(0, targetCorrectCount - renderedAccepted),
      current_manual_over_budget_count: Math.max(0, renderedManual - maxManualCount)
    },
    rendered_failure_summary: summarizeRows(renderedRows),
    items
  };
}

export function formatAgnesRenderedCommercialAcceptanceSummary(report = {}) {
  const metrics = report.metrics || {};
  const policy = report.policy || {};
  return [
    `Agnes rendered commercial acceptance ${report.schema_version || "unknown"}`,
    `target_rows: ${metrics.target_rows ?? "n/a"}`,
    `max_title_length: ${policy.max_title_length ?? "n/a"}`,
    `base_provider_title_accepted: ${metrics.base_provider_title_accepted_count ?? "n/a"}/${metrics.target_rows ?? "n/a"} (${metrics.base_provider_title_accepted_rate ?? "n/a"})`,
    `rendered_title_accepted: ${metrics.rendered_title_accepted_count ?? "n/a"}/${metrics.target_rows ?? "n/a"} (${metrics.rendered_title_accepted_rate ?? "n/a"})`,
    `renderer_recovered: ${metrics.renderer_recovered_count ?? "n/a"}`,
    `renderer_regressed: ${metrics.renderer_regressed_count ?? "n/a"}`,
    `required_auto_correct: ${policy.target_auto_correct_count ?? "n/a"}/${metrics.target_rows ?? "n/a"} (${policy.target_automated_accuracy ?? "n/a"})`,
    `max_manual_count: ${policy.max_manual_count ?? "n/a"}/${metrics.target_rows ?? "n/a"} (${policy.max_manual_rate ?? "n/a"})`,
    `additional_auto_correct_needed_for_target: ${metrics.additional_auto_correct_needed_for_target ?? "n/a"}`,
    `current_manual_over_budget_count: ${metrics.current_manual_over_budget_count ?? "n/a"}`,
    `raw_titles_in_report: ${report.scope?.raw_titles_in_report === true}`
  ].join("\n");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv, env = process.env) {
  const inputPath = argValue(argv, "--input", env.AGNES_RENDERED_COMMERCIAL_INPUT || defaultInputPath);
  const outPath = argValue(argv, "--out", env.AGNES_RENDERED_COMMERCIAL_OUT || defaultOutPath);
  const maxTitleLength = numberArg(argv, "--max-title-length", Number(env.AGNES_RENDERED_MAX_TITLE_LENGTH || defaultMaxTitleLength));
  const targetAccuracy = numberArg(argv, "--target-accuracy", Number(env.AGNES_RENDERED_TARGET_ACCURACY || defaultTargetAccuracy));
  const maxManualRate = numberArg(argv, "--max-manual-rate", Number(env.AGNES_RENDERED_MAX_MANUAL_RATE || defaultMaxManualRate));
  const noWrite = hasFlag(argv, "--no-write");
  const input = await readJson(inputPath);
  const report = measureAgnesRenderedCommercialAcceptance({
    report: input,
    maxTitleLength,
    targetAccuracy,
    maxManualRate
  });
  if (outPath && !noWrite) await writeJson(outPath, report);
  process.stdout.write(`${formatAgnesRenderedCommercialAcceptanceSummary(report)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes rendered commercial acceptance failed: ${error.message}`);
    process.exit(1);
  }
}
