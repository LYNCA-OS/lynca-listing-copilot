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
const defaultEnforceTokenGate = false;
const sensitivityThresholds = [0.65, 0.7, 0.72, 0.75, 0.8];
const commercialTitleColorTokens = new Set([
  "black",
  "blue",
  "bronze",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow"
]);

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

function canonicalText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function words(value) {
  return canonicalText(value).split(" ").filter(Boolean);
}

function intersects(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function yearsFromText(text) {
  return unique((canonicalText(text).match(/\b\d{4}(?:\s\d{2})?\b/g) || [])
    .map((value) => value.replace(/\s/g, "-")));
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function serialsFromText(text) {
  return unique((String(text || "").match(/\b\d+\s*\/\s*\d+\b/g) || []).map(normalizeSerial));
}

function gradeTokensFromText(text) {
  const source = canonicalText(text).toUpperCase();
  return unique((source.match(/\b(?:PSA|BGS|SGC|CGC)\s+(?:AUTO\s+)?\d+(?:\.\d+)?\b/g) || [])
    .map((value) => value.replace(/\s+/g, " ").trim()));
}

function colorsFromText(text) {
  const tokenSet = new Set(words(text));
  return [...commercialTitleColorTokens].filter((token) => tokenSet.has(token));
}

function hasAuto(text) {
  return /\b(auto|autograph|signed|signature)\b/i.test(String(text || ""));
}

function hasRookie(text) {
  return /\b(rc|rookie)\b/i.test(String(text || ""));
}

function titleContentCheck(field, expected, predicted, matched, evidence) {
  return {
    field,
    expected_count: Array.isArray(expected) ? expected.length : expected ? 1 : 0,
    predicted_count: Array.isArray(predicted) ? predicted.length : predicted ? 1 : 0,
    matched: Boolean(matched),
    evidence
  };
}

function titleContentChecks(result = {}) {
  const referenceTitle = correctedReferenceTitle(result);
  const title = predictedTitle(result);
  const checks = [];

  const referenceYears = yearsFromText(referenceTitle);
  if (referenceYears.length) {
    const titleYears = yearsFromText(title);
    checks.push(titleContentCheck("year", referenceYears, titleYears, intersects(referenceYears, titleYears), "final_title_year"));
  }

  const referenceSerials = serialsFromText(referenceTitle);
  if (referenceSerials.length) {
    const titleSerials = serialsFromText(title);
    checks.push(titleContentCheck("serial_number", referenceSerials, titleSerials, intersects(referenceSerials, titleSerials), "final_title_serial"));
  }

  const referenceGrades = gradeTokensFromText(referenceTitle);
  if (referenceGrades.length) {
    const titleGrades = gradeTokensFromText(title);
    checks.push(titleContentCheck("grade", referenceGrades, titleGrades, intersects(referenceGrades, titleGrades), "final_title_grade"));
  }

  const referenceColors = colorsFromText(referenceTitle);
  if (referenceColors.length) {
    const titleColors = colorsFromText(title);
    checks.push(titleContentCheck("color", referenceColors, titleColors, intersects(referenceColors, titleColors), "final_title_color"));
  }

  if (hasAuto(referenceTitle)) {
    checks.push(titleContentCheck("auto", true, hasAuto(title), hasAuto(title), "final_title_auto"));
  }

  if (hasRookie(referenceTitle)) {
    checks.push(titleContentCheck("rc", true, hasRookie(title), hasRookie(title), "final_title_rc"));
  }

  return checks;
}

const entityStopwords = new Set([
  "a",
  "an",
  "and",
  "base",
  "card",
  "edition",
  "of",
  "the",
  "trading",
  "with"
]);

function entityTokens(value) {
  return canonicalText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !entityStopwords.has(token));
}

function tokenOverlapRatio(tokens = [], text = "") {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  if (!uniqueTokens.length) return null;
  const textTokens = new Set(canonicalText(text).split(" ").filter(Boolean));
  const matched = uniqueTokens.filter((token) => textTokens.has(token)).length;
  return matched / uniqueTokens.length;
}

function predictedFields(result = {}) {
  return result.prediction?.fields || {};
}

function predictedTitle(result = {}) {
  return result.prediction?.title || "";
}

function correctedReferenceTitle(result = {}) {
  return result.corrected_title_reference || "";
}

function predictedEntityPrincipleFailures(result = {}) {
  const failures = [];
  const fields = predictedFields(result);
  const referenceTitle = correctedReferenceTitle(result);
  const players = Array.isArray(fields.players) ? fields.players : [];
  const wrongPlayer = players.some((player) => {
    const tokens = entityTokens(player);
    return tokens.length >= 2 && tokenOverlapRatio(tokens, referenceTitle) < 0.75;
  });
  if (wrongPlayer) failures.push("wrong_player");

  const productTokens = entityTokens(fields.product);
  if (productTokens.length >= 2 && tokenOverlapRatio(productTokens, referenceTitle) < 0.5) {
    failures.push("wrong_product");
  }
  return failures;
}

function predictedEntityContentMismatches(result = {}) {
  const mismatches = [];
  const fields = predictedFields(result);
  const title = predictedTitle(result);
  const players = Array.isArray(fields.players) ? fields.players : [];
  const playerMissingFromTitle = players.some((player) => {
    const tokens = entityTokens(player);
    return tokens.length >= 2 && tokenOverlapRatio(tokens, title) < 0.75;
  });
  if (playerMissingFromTitle) mismatches.push("players");

  const productTokens = entityTokens(fields.product);
  if (productTokens.length >= 2 && tokenOverlapRatio(productTokens, title) < 0.5) {
    mismatches.push("product");
  }
  return mismatches;
}

function principleFailures(comparison = {}, result = {}) {
  const failures = [];
  if (comparison.wrong_year) failures.push("wrong_year");
  if (comparison.wrong_serial) failures.push("wrong_serial");
  if (comparison.wrong_grade) failures.push("wrong_grade");
  if (comparison.unexpected_color) failures.push("unexpected_color");
  return [...failures, ...predictedEntityPrincipleFailures(result)];
}

function statusFailure(result = {}) {
  if (result.status === "evaluated") return "";
  if (result.status === "provider_error") return "provider_error";
  if (result.status === "invalid_candidate") return "invalid_candidate";
  return "not_evaluated";
}

export function evaluateCommercialAcceptanceRow(result = {}, {
  minTokenRecall = defaultMinTokenRecall,
  minTokenPrecision = defaultMinTokenPrecision,
  enforceTokenGate = defaultEnforceTokenGate
} = {}) {
  const statusReason = statusFailure(result);
  if (statusReason) {
    return {
      accepted: false,
      primary_failure_reason: statusReason,
      failure_reasons: [statusReason],
      derivable_field_count: 0,
      title_derived_field_mismatches: [],
      title_content_mismatches: [],
      principle_failures: [],
      diagnostic_reasons: [],
      token_recall: null,
      token_precision: null
    };
  }

  const checks = titleDerivedChecks(result);
  const titleChecks = titleContentChecks(result);
  const comparison = result.corrected_title_comparison || {};
  const principle = principleFailures(comparison, result);
  const fieldMismatches = checks
    .filter((check) => !check.matched)
    .map((check) => check.field);
  const titleMismatches = titleChecks
    .filter((check) => !check.matched)
    .map((check) => check.field);
  const entityMismatches = predictedEntityContentMismatches(result);
  const tokenRecall = Number(comparison.token_recall);
  const tokenPrecision = Number(comparison.token_precision);
  const failureReasons = [];
  const diagnosticReasons = [];

  if (!checks.length) failureReasons.push("no_title_derived_reference_fields");
  if (principle.length) failureReasons.push("principle_error");
  const allMismatches = [...new Set([...fieldMismatches, ...titleMismatches, ...entityMismatches])];
  if (allMismatches.length) failureReasons.push("title_derived_field_mismatch");
  if (!Number.isFinite(tokenRecall) || tokenRecall < minTokenRecall) diagnosticReasons.push("low_token_recall");
  if (!Number.isFinite(tokenPrecision) || tokenPrecision < minTokenPrecision) diagnosticReasons.push("low_token_precision");
  if (enforceTokenGate) failureReasons.push(...diagnosticReasons);

  return {
    accepted: failureReasons.length === 0,
    primary_failure_reason: failureReasons[0] || "",
    failure_reasons: failureReasons,
    derivable_field_count: titleChecks.length,
    title_derived_field_mismatches: allMismatches,
    title_content_mismatches: [...new Set(titleMismatches)],
    principle_failures: principle,
    diagnostic_reasons: diagnosticReasons,
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
      minTokenPrecision: threshold,
      enforceTokenGate: true
    });
    const accepted = rows.filter((row) => row.accepted).length;
    return {
      min_token_recall: threshold,
      min_token_precision: threshold,
      diagnostic_if_token_gate_enforced: true,
      accepted_count: accepted,
      accepted_rate_over_target: rate(accepted, results.length)
    };
  });
}

export function measureAgnesCommercialAcceptanceProxy({
  report,
  minTokenRecall = defaultMinTokenRecall,
  minTokenPrecision = defaultMinTokenPrecision,
  enforceTokenGate = defaultEnforceTokenGate,
  now = () => new Date()
} = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const targetCount = report?.target_count ?? results.length;
  const rows = summarizeRows(results, {
    minTokenRecall,
    minTokenPrecision,
    enforceTokenGate
  });
  const evaluatedRows = results.filter((result) => result.status === "evaluated").length;
  const acceptedRows = rows.filter((row) => row.accepted).length;
  const reviewRows = Math.max(0, targetCount - acceptedRows);
  const failureReasonCounts = new Map();
  const primaryFailureReasonCounts = new Map();
  const fieldMismatchCounts = new Map();
  const principleFailureCounts = new Map();
  const diagnosticReasonCounts = new Map();
  const titleContentMismatchCounts = new Map();

  for (const row of rows) {
    if (!row.accepted) increment(primaryFailureReasonCounts, row.primary_failure_reason || "unknown");
    for (const reason of row.failure_reasons) increment(failureReasonCounts, reason);
    for (const field of row.title_derived_field_mismatches) increment(fieldMismatchCounts, field);
    for (const field of row.title_content_mismatches || []) increment(titleContentMismatchCounts, field);
    for (const reason of row.principle_failures) increment(principleFailureCounts, reason);
    for (const reason of row.diagnostic_reasons) increment(diagnosticReasonCounts, reason);
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
      name: enforceTokenGate
        ? "title-derived-critical-facts-plus-token-gate-v1"
        : "principle-safe-title-content-v1",
      minimum_token_recall_diagnostic: minTokenRecall,
      minimum_token_precision_diagnostic: minTokenPrecision,
      token_gate_enforced: enforceTokenGate,
      token_recall_is_diagnostic_only: !enforceTokenGate,
      token_precision_is_diagnostic_only: !enforceTokenGate,
      provider_error_counts_as_failure: true,
      require_all_title_derived_fields: true,
      fail_on_wrong_year: true,
      fail_on_wrong_serial: true,
      fail_on_wrong_grade: true,
      fail_on_unexpected_color: true,
      fail_on_low_token_recall: enforceTokenGate,
      fail_on_low_token_precision: enforceTokenGate
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
      token_diagnostics: sortedCounts(diagnosticReasonCounts),
      principle_failures: sortedCounts(principleFailureCounts),
      title_derived_field_mismatches: sortedCounts(fieldMismatchCounts),
      title_content_mismatches: sortedCounts(titleContentMismatchCounts)
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
    `policy: ${report.policy?.name || "n/a"}`,
    `token_gate_enforced: ${report.policy?.token_gate_enforced === true}`,
    `minimum_token_recall_diagnostic: ${report.policy?.minimum_token_recall_diagnostic ?? "n/a"}`,
    `minimum_token_precision_diagnostic: ${report.policy?.minimum_token_precision_diagnostic ?? "n/a"}`,
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
  const enforceTokenGate = hasFlag(argv, "--enforce-token-gate") || env.AGNES_COMMERCIAL_ENFORCE_TOKEN_GATE === "1";
  const noWrite = hasFlag(argv, "--no-write");
  const input = await readJson(inputPath);
  const proxy = measureAgnesCommercialAcceptanceProxy({
    report: input,
    minTokenRecall,
    minTokenPrecision,
    enforceTokenGate
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
