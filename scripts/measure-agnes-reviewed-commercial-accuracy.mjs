import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateTitleAcceptance } from "../lib/listing/evaluation/title-acceptance-policy.mjs";

const schemaVersion = "agnes-reviewed-commercial-accuracy-v1";
const defaultAgnesPath = "data/eval/agnes-supabase-feedback-latest.json";
const defaultReviewedPath = "data/recognition/manifests/supabase-feedback-reviewed.json";
const defaultOutPath = "data/eval/agnes-reviewed-commercial-accuracy-latest.json";
const defaultMinimumReviewedItems = 100;
const defaultRequiredFields = Object.freeze(["year", "product", "players"]);

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

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable).filter(Boolean).sort().join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return normalizeText(value).toLowerCase();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== undefined && value !== null && value !== "";
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
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

function normalizeSerial(value) {
  const match = normalizeText(value).match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return normalizeText(value);
  return `${Number(match[1])}/${Number(match[2])}`;
}

function fieldComparable(field, value) {
  if (field === "serial_number") return normalizeSerial(value).toLowerCase();
  return comparable(value);
}

function fieldsMatch(field, expected, actual) {
  if (!valuePresent(expected)) return null;
  return fieldComparable(field, expected) === fieldComparable(field, actual);
}

function agnesResultId(result = {}) {
  return normalizeText(result.source_feedback_id || result.candidate_id || result.asset_id);
}

function reviewedItemId(item = {}) {
  return normalizeText(item.source_feedback_id || item.asset_id || item.physical_card_id);
}

function predictionFields(result = {}) {
  return result.prediction?.fields || {};
}

function resultRoute(result = {}) {
  if (result.status === "evaluated") return "AI_COMPLETE_REVIEW";
  if (result.status === "provider_error") return "PROVIDER_ERROR";
  if (result.status === "invalid_candidate") return "INVALID_CANDIDATE";
  return "NOT_EVALUATED";
}

function reviewedItemsFromManifest(manifest = {}) {
  return Array.isArray(manifest?.items) ? manifest.items : [];
}

function requiredCoverageOk(items = [], requiredFields = defaultRequiredFields) {
  return requiredFields.every((field) => items.every((item) => valuePresent(item.ground_truth?.[field])));
}

function fieldStatsInit(field) {
  return {
    field,
    total: 0,
    correct: 0,
    incorrect: 0,
    accuracy: null,
    confidence_interval: wilsonInterval(0, 0)
  };
}

function finalFieldStats(stats) {
  return Object.fromEntries([...stats.values()]
    .sort((left, right) => left.field.localeCompare(right.field))
    .map((item) => [item.field, {
      ...item,
      accuracy: rate(item.correct, item.total),
      confidence_interval: wilsonInterval(item.correct, item.total)
    }]));
}

function evaluateReviewedItem(item = {}, result = null) {
  const groundTruth = item.ground_truth || {};
  const criticalFields = Array.isArray(item.critical_fields) && item.critical_fields.length
    ? item.critical_fields
    : defaultRequiredFields;
  const predicted = result ? predictionFields(result) : {};
  const field_checks = criticalFields
    .filter((field) => valuePresent(groundTruth[field]))
    .map((field) => ({
      field,
      matched: result?.status === "evaluated" ? fieldsMatch(field, groundTruth[field], predicted[field]) === true : false
    }));
  const missingPrediction = !result;
  const providerFailure = Boolean(result && result.status !== "evaluated");
  const criticalExact = field_checks.length > 0 && field_checks.every((check) => check.matched);
  const titleAcceptance = result?.status === "evaluated"
    ? evaluateTitleAcceptance({
      title: result.prediction?.title || "",
      groundTruthFields: groundTruth,
      predictedFields: predicted,
      criticalFields
    })
    : null;

  return {
    evaluated: Boolean(result),
    provider_failure: providerFailure,
    missing_prediction: missingPrediction,
    critical_field_count: field_checks.length,
    critical_field_exact: criticalExact,
    title_accepted: titleAcceptance?.accepted === true,
    title_acceptance_evaluated: Boolean(titleAcceptance),
    field_checks
  };
}

function blockedReport({
  reason,
  details = {},
  agnesReport = null,
  reviewedManifest = null,
  now = () => new Date()
} = {}) {
  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    status: "blocked",
    blocked_reason: reason,
    details,
    source: {
      agnes_provider: agnesReport?.provider || "agnes",
      agnes_target_count: agnesReport?.target_count ?? null,
      agnes_evaluated_count: agnesReport?.evaluated_count ?? null,
      reviewed_manifest_schema_version: reviewedManifest?.schema_version || null,
      reviewed_item_count: Array.isArray(reviewedManifest?.items) ? reviewedManifest.items.length : 0
    },
    scope: {
      metric_type: "agnes_vs_reviewed_field_level_commercial_ground_truth",
      field_ground_truth_available: false,
      commercial_accuracy_claim_allowed: false,
      raw_titles_in_report: false,
      no_feedback_retention_side_effects: true
    }
  };
}

export function measureAgnesReviewedCommercialAccuracy({
  agnesReport,
  reviewedManifest,
  minimumReviewedItems = defaultMinimumReviewedItems,
  requiredFields = defaultRequiredFields,
  now = () => new Date()
} = {}) {
  const reviewedItems = reviewedItemsFromManifest(reviewedManifest);
  if (!reviewedItems.length) {
    return blockedReport({
      reason: "reviewed_field_ground_truth_missing",
      details: {
        reviewed_item_count: 0,
        minimum_reviewed_items: minimumReviewedItems,
        required_fields: requiredFields
      },
      agnesReport,
      reviewedManifest,
      now
    });
  }
  if (reviewedItems.length < minimumReviewedItems) {
    return blockedReport({
      reason: "insufficient_reviewed_items",
      details: {
        reviewed_item_count: reviewedItems.length,
        minimum_reviewed_items: minimumReviewedItems,
        required_fields: requiredFields
      },
      agnesReport,
      reviewedManifest,
      now
    });
  }
  if (!requiredCoverageOk(reviewedItems, requiredFields)) {
    return blockedReport({
      reason: "required_ground_truth_field_coverage_missing",
      details: {
        reviewed_item_count: reviewedItems.length,
        minimum_reviewed_items: minimumReviewedItems,
        required_fields: requiredFields
      },
      agnesReport,
      reviewedManifest,
      now
    });
  }

  const agnesResults = Array.isArray(agnesReport?.results) ? agnesReport.results : [];
  const agnesById = new Map(agnesResults.map((result) => [agnesResultId(result), result]));
  const rows = reviewedItems.map((item) => evaluateReviewedItem(item, agnesById.get(reviewedItemId(item))));
  const fieldStats = new Map();
  for (const row of rows) {
    for (const check of row.field_checks) {
      const current = fieldStats.get(check.field) || fieldStatsInit(check.field);
      current.total += 1;
      if (check.matched) current.correct += 1;
      else current.incorrect += 1;
      fieldStats.set(check.field, current);
    }
  }

  const totalFields = [...fieldStats.values()].reduce((sum, item) => sum + item.total, 0);
  const correctFields = [...fieldStats.values()].reduce((sum, item) => sum + item.correct, 0);
  const cardExact = rows.filter((row) => row.critical_field_exact).length;
  const titleAccepted = rows.filter((row) => row.title_accepted).length;
  const titleAcceptanceEvaluated = rows.filter((row) => row.title_acceptance_evaluated).length;
  const providerFailures = rows.filter((row) => row.provider_failure).length;
  const missingPredictions = rows.filter((row) => row.missing_prediction).length;

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    status: "completed",
    source: {
      agnes_provider: agnesReport?.provider || "agnes",
      agnes_schema_version: agnesReport?.schema_version || null,
      agnes_target_count: agnesReport?.target_count ?? agnesResults.length,
      agnes_evaluated_count: agnesReport?.evaluated_count ?? agnesResults.filter((result) => result.status === "evaluated").length,
      reviewed_manifest_schema_version: reviewedManifest?.schema_version || null,
      reviewed_manifest_hash: reviewedManifest?.manifest_hash || null,
      reviewed_item_count: reviewedItems.length
    },
    scope: {
      metric_type: "agnes_vs_reviewed_field_level_commercial_ground_truth",
      field_ground_truth_available: true,
      commercial_accuracy_claim_allowed: reviewedItems.length >= minimumReviewedItems,
      corrected_title_used_as_ground_truth: reviewedManifest?.summary?.corrected_title_used_as_ground_truth === true,
      raw_titles_in_report: false,
      no_feedback_retention_side_effects: true
    },
    policy: {
      minimum_reviewed_items: minimumReviewedItems,
      required_fields: requiredFields,
      provider_error_counts_as_failure: true,
      missing_prediction_counts_as_failure: true,
      title_acceptance_policy: "critical-facts-title-acceptance-v1"
    },
    metrics: {
      reviewed_items: reviewedItems.length,
      matched_predictions: rows.filter((row) => row.evaluated).length,
      provider_failure_count: providerFailures,
      missing_prediction_count: missingPredictions,
      total_field_checks: totalFields,
      correct_field_checks: correctFields,
      field_level_accuracy: rate(correctFields, totalFields),
      card_level_critical_exact_count: cardExact,
      card_level_critical_exact_accuracy: rate(cardExact, reviewedItems.length),
      title_acceptance_evaluated_count: titleAcceptanceEvaluated,
      title_accepted_count: titleAccepted,
      title_acceptance_rate: rate(titleAccepted, reviewedItems.length),
      confidence_intervals: {
        field_level_accuracy: wilsonInterval(correctFields, totalFields),
        card_level_critical_exact_accuracy: wilsonInterval(cardExact, reviewedItems.length),
        title_acceptance_rate: wilsonInterval(titleAccepted, reviewedItems.length)
      }
    },
    field_breakdown: finalFieldStats(fieldStats)
  };
}

export function formatAgnesReviewedCommercialAccuracySummary(report = {}) {
  if (report.status === "blocked") {
    return [
      `Agnes reviewed commercial accuracy ${report.status}`,
      `blocked_reason: ${report.blocked_reason || "unknown"}`,
      `reviewed_item_count: ${report.source?.reviewed_item_count ?? "n/a"}`,
      `commercial_accuracy_claim_allowed: false`
    ].join("\n");
  }

  const metrics = report.metrics || {};
  return [
    `Agnes reviewed commercial accuracy ${report.status || "unknown"}`,
    `reviewed_items: ${metrics.reviewed_items ?? "n/a"}`,
    `card_level_critical_exact: ${metrics.card_level_critical_exact_count ?? "n/a"}/${metrics.reviewed_items ?? "n/a"} (${metrics.card_level_critical_exact_accuracy ?? "n/a"})`,
    `field_level_accuracy: ${metrics.correct_field_checks ?? "n/a"}/${metrics.total_field_checks ?? "n/a"} (${metrics.field_level_accuracy ?? "n/a"})`,
    `title_acceptance: ${metrics.title_accepted_count ?? "n/a"}/${metrics.reviewed_items ?? "n/a"} (${metrics.title_acceptance_rate ?? "n/a"})`,
    `provider_failures: ${metrics.provider_failure_count ?? "n/a"}`,
    `missing_predictions: ${metrics.missing_prediction_count ?? "n/a"}`,
    `commercial_accuracy_claim_allowed: ${report.scope?.commercial_accuracy_claim_allowed === true}`,
    `raw_titles_in_report: ${report.scope?.raw_titles_in_report === true}`
  ].join("\n");
}

async function readJsonIfExists(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return null;
  return JSON.parse(await readFile(resolved, "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv, env = process.env) {
  const agnesPath = argValue(argv, "--agnes", env.AGNES_REVIEWED_COMMERCIAL_ACCURACY_AGNES || defaultAgnesPath);
  const reviewedPath = argValue(argv, "--reviewed", env.AGNES_REVIEWED_COMMERCIAL_ACCURACY_REVIEWED || defaultReviewedPath);
  const outPath = argValue(argv, "--out", env.AGNES_REVIEWED_COMMERCIAL_ACCURACY_OUT || defaultOutPath);
  const noWrite = hasFlag(argv, "--no-write");
  const minimumReviewedItems = numberArg(argv, "--minimum-reviewed-items", Number(env.AGNES_REVIEWED_COMMERCIAL_MIN_ITEMS || defaultMinimumReviewedItems));
  const agnesReport = await readJsonIfExists(agnesPath);
  if (!agnesReport) throw new Error(`Agnes report not found: ${resolve(agnesPath)}`);
  const reviewedManifest = await readJsonIfExists(reviewedPath);
  const report = measureAgnesReviewedCommercialAccuracy({
    agnesReport,
    reviewedManifest,
    minimumReviewedItems
  });
  if (outPath && !noWrite) await writeJson(outPath, report);
  process.stdout.write(`${formatAgnesReviewedCommercialAccuracySummary(report)}\n`);
  return report.status === "blocked" && hasFlag(argv, "--require-complete") ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes reviewed commercial accuracy failed: ${error.message}`);
    process.exit(1);
  }
}
