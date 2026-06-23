import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "agnes-supabase-feedback-eval-v1";
const defaultOutPath = "data/eval/agnes-supabase-feedback-latest.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function repeatedArgValues(argv, name) {
  const values = [];
  argv.forEach((arg, index) => {
    if (arg === name && argv[index + 1]) values.push(argv[index + 1]);
  });
  return values;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resultId(result = {}) {
  return normalizeText(result.candidate_id || result.source_feedback_id || result.asset_id);
}

function itemId(item = {}) {
  return normalizeText(item.source_feedback_id || item.candidate_id || item.asset_id);
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!numeric.length) return null;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6));
}

function sumUsage(results = []) {
  return results.reduce((usage, result) => {
    const current = result.usage || {};
    usage.prompt_tokens += Number(current.prompt_tokens || 0);
    usage.completion_tokens += Number(current.completion_tokens || 0);
    usage.total_tokens += Number(current.total_tokens || 0);
    usage.estimated_cost_usd = Number((usage.estimated_cost_usd + Number(current.estimated_cost_usd || 0)).toFixed(6));
    usage.image_count += Number(current.image_count || 0);
    usage.latency_ms += Number(current.latency_ms || 0);
    return usage;
  }, {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    image_count: 0,
    latency_ms: 0
  });
}

function summarize(results = []) {
  const attempted = results.length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const invalid = results.filter((item) => item.status === "invalid_candidate").length;
  const providerErrors = results.filter((item) => item.status === "provider_error").length;
  const comparisons = results.map((item) => item.corrected_title_comparison).filter(Boolean);
  const exact = comparisons.filter((item) => item.corrected_title_exact).length;
  const criticalTitleErrors = comparisons.filter((item) => item.critical_title_error).length;
  const wrongYear = comparisons.filter((item) => item.wrong_year).length;
  const wrongSerial = comparisons.filter((item) => item.wrong_serial).length;
  const wrongGrade = comparisons.filter((item) => item.wrong_grade).length;
  const unexpectedColor = comparisons.filter((item) => item.unexpected_color).length;

  return {
    attempted_count: attempted,
    evaluated_count: evaluated,
    invalid_candidate_count: invalid,
    provider_error_count: providerErrors,
    corrected_title_exact_count: exact,
    corrected_title_exact_rate: rate(exact, attempted),
    corrected_title_token_recall_avg: average(comparisons.map((item) => item.token_recall)),
    corrected_title_token_precision_avg: average(comparisons.map((item) => item.token_precision)),
    critical_title_error_count: criticalTitleErrors,
    critical_title_error_rate: rate(criticalTitleErrors, attempted),
    wrong_year_count: wrongYear,
    wrong_serial_count: wrongSerial,
    wrong_grade_count: wrongGrade,
    unexpected_color_count: unexpectedColor,
    parsed_success_rate: rate(evaluated, attempted),
    usage: sumUsage(results)
  };
}

function statusRank(result = {}) {
  return {
    evaluated: 4,
    invalid_candidate: 3,
    provider_error: 2
  }[result.status] || 1;
}

function chooseResult(current, next) {
  if (!current) return next;
  const currentRank = statusRank(current);
  const nextRank = statusRank(next);
  if (nextRank !== currentRank) return nextRank > currentRank ? next : current;
  return next;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, payload) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

async function reportPathsFromInputDir(inputDir) {
  if (!inputDir) return [];
  const resolved = resolve(inputDir);
  const entries = await readdir(resolved);
  return entries
    .filter((entry) => /^report-\d+\.json$/.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((entry) => join(resolved, entry));
}

function imageBackedItems(dataset = {}) {
  return (Array.isArray(dataset.items) ? dataset.items : [])
    .filter((item) => Array.isArray(item.images) && item.images.some((image) => image?.bucket && image?.object_path));
}

export async function mergeAgnesSupabaseFeedbackReports({
  reports = [],
  dataset = null,
  now = () => new Date()
} = {}) {
  const selectedItems = dataset ? imageBackedItems(dataset) : [];
  const selectedIds = selectedItems.map(itemId).filter(Boolean);
  const resultMap = new Map();

  for (const report of reports) {
    for (const result of Array.isArray(report.results) ? report.results : []) {
      const id = resultId(result);
      if (!id) continue;
      resultMap.set(id, chooseResult(resultMap.get(id), result));
    }
  }

  const orderedResults = selectedIds.length
    ? [
        ...selectedIds.map((id) => resultMap.get(id)).filter(Boolean),
        ...[...resultMap.entries()]
          .filter(([id]) => !selectedIds.includes(id))
          .map(([, result]) => result)
      ]
    : [...resultMap.values()];
  const targetCount = selectedIds.length || Math.max(
    orderedResults.length,
    ...reports.map((report) => Number(report.target_count || 0))
  );
  const fullSampleEvaluation = targetCount > 0 && orderedResults.length >= targetCount;
  const startedValues = reports.map((report) => report.started_at).filter(Boolean).sort();
  const firstReport = reports[0] || {};
  const latestReport = reports[reports.length - 1] || {};

  return {
    schema_version: schemaVersion,
    status: fullSampleEvaluation ? "completed" : "partial",
    generated_at: now().toISOString(),
    started_at: startedValues[0] || latestReport.started_at || now().toISOString(),
    provider: "agnes",
    identity_resolution_enabled: reports.some((report) => report.identity_resolution_enabled === true),
    internal_memory_self_exclusion_enabled: reports.some((report) => report.internal_memory_self_exclusion_enabled === true),
    source_dataset_schema_version: dataset?.schema_version || firstReport.source_dataset_schema_version || null,
    source_manifest_hash: dataset?.manifest_hash || firstReport.source_manifest_hash || null,
    source_provider: dataset?.source?.provider || firstReport.source_provider || null,
    source_table: dataset?.source?.table || firstReport.source_table || null,
    source_row_count: dataset?.source?.source_row_count ?? firstReport.source_row_count ?? null,
    image_backed_row_count: dataset?.source?.image_backed_row_count ?? dataset?.summary?.item_count ?? firstReport.image_backed_row_count ?? targetCount,
    corrected_title_reference_only: true,
    field_ground_truth_available: false,
    commercial_accuracy_claim_allowed: false,
    commercial_accuracy_eval_eligible: false,
    field_ground_truth_required_for_commercial: true,
    no_feedback_retention_side_effects: true,
    full_sample_evaluation: fullSampleEvaluation,
    target_count: targetCount,
    merged_from_reports: reports.map((report) => ({
      status: report.status || "",
      target_count: report.target_count ?? null,
      attempted_count: report.attempted_count ?? null,
      evaluated_count: report.evaluated_count ?? null,
      provider_error_count: report.provider_error_count ?? null
    })),
    missing_result_count: Math.max(0, targetCount - orderedResults.length),
    ...summarize(orderedResults),
    results: orderedResults
  };
}

export function formatMergedSummary(report = {}) {
  return [
    `Merged Agnes Supabase feedback ${report.schema_version || "unknown"}`,
    `status: ${report.status || "unknown"}`,
    `target_count: ${report.target_count ?? "n/a"}`,
    `attempted_count: ${report.attempted_count ?? "n/a"}`,
    `evaluated_count: ${report.evaluated_count ?? "n/a"}`,
    `provider_error_count: ${report.provider_error_count ?? "n/a"}`,
    `missing_result_count: ${report.missing_result_count ?? "n/a"}`,
    `critical_title_errors: ${report.critical_title_error_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.critical_title_error_rate ?? "n/a"})`,
    `full_sample_evaluation: ${report.full_sample_evaluation === true}`,
    `commercial_accuracy_claim_allowed: false`
  ].join("\n");
}

export async function main(argv = process.argv) {
  const datasetPath = argValue(argv, "--dataset", "");
  const inputDir = argValue(argv, "--input-dir", "");
  const reportPaths = [
    ...repeatedArgValues(argv, "--report"),
    ...await reportPathsFromInputDir(inputDir)
  ];
  const outPath = argValue(argv, "--out", process.env.AGNES_SUPABASE_FEEDBACK_MERGED_OUT || defaultOutPath);
  const noWrite = hasFlag(argv, "--no-write");

  if (!reportPaths.length) {
    throw new Error("Provide --input-dir <dir> or one or more --report <report.json>.");
  }

  const [dataset, ...reports] = await Promise.all([
    datasetPath ? readJson(datasetPath) : Promise.resolve(null),
    ...reportPaths.map(readJson)
  ]);
  const merged = await mergeAgnesSupabaseFeedbackReports({ reports, dataset });
  if (outPath && !noWrite) await writeJson(outPath, merged);
  process.stdout.write(`${formatMergedSummary(merged)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Agnes Supabase feedback merge failed: ${error.message}`);
    process.exit(1);
  });
}
