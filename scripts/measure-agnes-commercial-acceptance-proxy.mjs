import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { titleDerivedChecks } from "./measure-agnes-title-derived-field-proxy.mjs";

const schemaVersion = "agnes-commercial-acceptance-proxy-v1";
const defaultInputPath = "data/eval/agnes-supabase-feedback-latest.json";
const defaultOutPath = "data/eval/agnes-commercial-acceptance-proxy-latest.json";
const defaultMinTokenRecall = 0.7;
const defaultMinTokenPrecision = 0.7;
const sensitivityThresholds = [0.65, 0.7, 0.72, 0.75, 0.8];

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

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6));
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) {
    return {
      method: "wilson_score",
      confidence_level: 0.95,
      successes,
      total,
      lower: null,
      upper: null
    };
  }

  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denom;
  return {
    method: "wilson_score",
    confidence_level: 0.95,
    successes,
    total,
    lower: Number(Math.max(0, center - half).toFixed(6)),
    upper: Number(Math.min(1, center + half).toFixed(6))
  };
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

function principleFailures(comparison = {}) {
  const failures = [];
  if (comparison.wrong_year) failures.push("wrong_year");
  if (comparison.wrong_serial) failures.push("wrong_serial");
  if (comparison.wrong_grade) failures.push("wrong_grade");
  if (comparison.unexpected_color) failures.push("unexpected_color");
  return failures;
}

function statusFailure(result = {}) {
  if (result.status === "evaluated") return "";
  if (result.status === "provider_error") return "provider_error";
  if (result.status === "invalid_candidate") return "invalid_candidate";
  return "not_evaluated";
}

function evaluateCommercialAcceptanceRow(result = {}, {
  minTokenRecall = defaultMinTokenRecall,
  minTokenPrecision = defaultMinTokenPrecision
} = {}) {
  const statusReason = statusFailure(result);
  if (statusReason) {
    return {
      accepted: false,
      primary_failure_reason: statusReason,
      failure_reasons: [statusReason],
      derivable_field_count: 0,
      title_derived_field_mismatches: [],
      principle_failures: [],
      token_recall: null,
      token_precision: null
    };
  }

  const checks = titleDerivedChecks(result);
  const comparison = result.corrected_title_comparison || {};
  const principle = principleFailures(comparison);
  const mismatches = checks
    .filter((check) => !check.matched)
    .map((check) => check.field);
  const tokenRecall = Number(comparison.token_recall);
  const tokenPrecision = Number(comparison.token_precision);
  const failureReasons = [];

  if (!checks.length) failureReasons.push("no_title_derived_reference_fields");
  if (principle.length) failureReasons.push("principle_error");
  if (mismatches.length) failureReasons.push("title_derived_field_mismatch");
  if (!Number.isFinite(tokenRecall) || tokenRecall < minTokenRecall) failureReasons.push("low_token_recall");
  if (!Number.isFinite(tokenPrecision) || tokenPrecision < minTokenPrecision) failureReasons.push("low_token_precision");

  return {
    accepted: failureReasons.length === 0,
    primary_failure_reason: failureReasons[0] || "",
    failure_reasons: failureReasons,
    derivable_field_count: checks.length,
    title_derived_field_mismatches: mismatches,
    principle_failures: principle,
    token_recall: Number.isFinite(tokenRecall) ? tokenRecall : null,
    token_precision: Number.isFinite(tokenPrecision) ? tokenPrecision : null
  };
}

function summarizeRows(results, options) {
  return results.map((result) => evaluateCommercialAcceptanceRow(result, options));
}

function sensitivity(results = []) {
  return sensitivityThresholds.map((threshold) => {
    const rows = summarizeRows(results, {
      minTokenRecall: threshold,
      minTokenPrecision: threshold
    });
    const accepted = rows.filter((row) => row.accepted).length;
    return {
      min_token_recall: threshold,
      min_token_precision: threshold,
      accepted_count: accepted,
      accepted_rate_over_target: rate(accepted, results.length)
    };
  });
}

export function measureAgnesCommercialAcceptanceProxy({
  report,
  minTokenRecall = defaultMinTokenRecall,
  minTokenPrecision = defaultMinTokenPrecision,
  now = () => new Date()
} = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const targetCount = report?.target_count ?? results.length;
  const rows = summarizeRows(results, {
    minTokenRecall,
    minTokenPrecision
  });
  const evaluatedRows = results.filter((result) => result.status === "evaluated").length;
  const acceptedRows = rows.filter((row) => row.accepted).length;
  const reviewRows = Math.max(0, targetCount - acceptedRows);
  const failureReasonCounts = new Map();
  const primaryFailureReasonCounts = new Map();
  const fieldMismatchCounts = new Map();
  const principleFailureCounts = new Map();

  for (const row of rows) {
    if (!row.accepted) increment(primaryFailureReasonCounts, row.primary_failure_reason || "unknown");
    for (const reason of row.failure_reasons) increment(failureReasonCounts, reason);
    for (const field of row.title_derived_field_mismatches) increment(fieldMismatchCounts, field);
    for (const reason of row.principle_failures) increment(principleFailureCounts, reason);
  }

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    source: {
      provider: report?.provider || "agnes",
      input_schema_version: report?.schema_version || null,
      target_count: targetCount,
      attempted_count: report?.attempted_count ?? results.length,
      evaluated_count: evaluatedRows,
      provider_error_count: report?.provider_error_count ?? results.filter((result) => result.status === "provider_error").length
    },
    scope: {
      metric_type: "commercial_acceptance_proxy_from_corrected_title",
      corrected_title_reference_only: true,
      title_derived_fields_are_partial: true,
      field_ground_truth_available: false,
      commercial_accuracy_claim_allowed: false,
      commercial_acceptance_proxy_available: true,
      raw_titles_in_report: false,
      no_feedback_retention_side_effects: true
    },
    policy: {
      name: "title-derived-critical-facts-plus-token-gate-v1",
      minimum_token_recall: minTokenRecall,
      minimum_token_precision: minTokenPrecision,
      provider_error_counts_as_failure: true,
      require_all_title_derived_fields: true,
      fail_on_wrong_year: true,
      fail_on_wrong_serial: true,
      fail_on_wrong_grade: true,
      fail_on_unexpected_color: true
    },
    metrics: {
      accepted_count: acceptedRows,
      manual_review_or_reject_count: reviewRows,
      evaluated_rows: evaluatedRows,
      target_rows: targetCount,
      accepted_rate_over_target: rate(acceptedRows, targetCount),
      accepted_rate_over_evaluated: rate(acceptedRows, evaluatedRows),
      manual_review_or_reject_rate: rate(reviewRows, targetCount),
      average_token_recall_evaluated: average(rows.map((row) => row.token_recall)),
      average_token_precision_evaluated: average(rows.map((row) => row.token_precision)),
      confidence_intervals: {
        accepted_rate_over_target: wilsonInterval(acceptedRows, targetCount),
        accepted_rate_over_evaluated: wilsonInterval(acceptedRows, evaluatedRows)
      }
    },
    failure_summary: {
      primary_failure_reasons: sortedCounts(primaryFailureReasonCounts),
      all_failure_reasons: sortedCounts(failureReasonCounts),
      principle_failures: sortedCounts(principleFailureCounts),
      title_derived_field_mismatches: sortedCounts(fieldMismatchCounts)
    },
    sensitivity: sensitivity(results)
  };
}

export function formatAgnesCommercialAcceptanceProxySummary(report = {}) {
  const metrics = report.metrics || {};
  const lines = [
    `Agnes commercial acceptance proxy ${report.schema_version || "unknown"}`,
    `target_rows: ${metrics.target_rows ?? "n/a"}`,
    `evaluated_rows: ${metrics.evaluated_rows ?? "n/a"}`,
    `accepted: ${metrics.accepted_count ?? "n/a"}/${metrics.target_rows ?? "n/a"} (${metrics.accepted_rate_over_target ?? "n/a"})`,
    `accepted_over_evaluated: ${metrics.accepted_count ?? "n/a"}/${metrics.evaluated_rows ?? "n/a"} (${metrics.accepted_rate_over_evaluated ?? "n/a"})`,
    `manual_review_or_reject: ${metrics.manual_review_or_reject_count ?? "n/a"}/${metrics.target_rows ?? "n/a"} (${metrics.manual_review_or_reject_rate ?? "n/a"})`,
    `minimum_token_recall: ${report.policy?.minimum_token_recall ?? "n/a"}`,
    `minimum_token_precision: ${report.policy?.minimum_token_precision ?? "n/a"}`,
    `commercial_accuracy_claim_allowed: ${report.scope?.commercial_accuracy_claim_allowed === true}`,
    `raw_titles_in_report: ${report.scope?.raw_titles_in_report === true}`
  ];

  const primary = Object.entries(report.failure_summary?.primary_failure_reasons || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  if (primary) lines.push(`primary_failure_reasons: ${primary}`);
  return lines.join("\n");
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
  const inputPath = argValue(argv, "--input", env.AGNES_COMMERCIAL_ACCEPTANCE_PROXY_INPUT || defaultInputPath);
  const outPath = argValue(argv, "--out", env.AGNES_COMMERCIAL_ACCEPTANCE_PROXY_OUT || defaultOutPath);
  const minTokenRecall = numberArg(argv, "--min-token-recall", Number(env.AGNES_COMMERCIAL_MIN_TOKEN_RECALL || defaultMinTokenRecall));
  const minTokenPrecision = numberArg(argv, "--min-token-precision", Number(env.AGNES_COMMERCIAL_MIN_TOKEN_PRECISION || defaultMinTokenPrecision));
  const noWrite = hasFlag(argv, "--no-write");
  const input = await readJson(inputPath);
  const proxy = measureAgnesCommercialAcceptanceProxy({
    report: input,
    minTokenRecall,
    minTokenPrecision
  });
  if (outPath && !noWrite) await writeJson(outPath, proxy);
  process.stdout.write(`${formatAgnesCommercialAcceptanceProxySummary(proxy)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes commercial acceptance proxy failed: ${error.message}`);
    process.exit(1);
  }
}
