import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function parseReportArgs(argv = []) {
  return argv
    .filter((arg) => arg.startsWith("--report="))
    .map((arg) => arg.slice("--report=".length))
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) throw new Error(`Invalid --report value: ${entry}. Expected concurrency:path.`);
      return {
        concurrency: Number(entry.slice(0, separator)),
        path: entry.slice(separator + 1)
      };
    })
    .filter((entry) => Number.isFinite(entry.concurrency) && entry.concurrency > 0 && entry.path);
}

function metricRow(report = {}, path = "") {
  const concurrency = Number(report.configured_concurrency || 0);
  return {
    path,
    concurrency,
    attempted_count: Number(report.attempted_count || 0),
    provider_success_count: Number(report.provider_success_count || 0),
    provider_error_count: Number(report.provider_error_count || 0),
    technical_failure_count: Number(report.technical_failure_count || 0),
    provider_error_retry_count: Number(report.provider_error_retry_count || 0),
    provider_error_recovered_count: Number(report.provider_error_recovered_count || 0),
    reviewed_title_token_recall_avg: numberOrNull(report.reviewed_title_token_recall_avg ?? report.corrected_title_token_recall_avg),
    raw_reviewed_title_token_recall_avg: numberOrNull(report.raw_corrected_title_token_recall_avg),
    numerical_rarity_title_token_recall_avg: numberOrNull(report.numerical_rarity_title_token_recall_avg),
    pass_at_0_72_count: Number(report.pass_at_0_72_count || 0),
    pass_at_0_80_count: Number(report.pass_at_0_80_count || 0),
    attempted_cards_per_minute: numberOrNull(report.attempted_cards_per_minute),
    evaluated_cards_per_minute: numberOrNull(report.evaluated_cards_per_minute),
    p50_ms: numberOrNull(report.per_card_latency_ms?.p50),
    p95_ms: numberOrNull(report.per_card_latency_ms?.p95),
    input_tokens: numberOrNull(report.usage_totals?.input_tokens),
    output_tokens: numberOrNull(report.usage_totals?.output_tokens),
    total_tokens: numberOrNull(report.usage_totals?.total_tokens),
    vector_lazy_skip_count: Number(report.vector_lazy_skip_count || 0),
    vector_prompt_candidate_count: Number(report.vector_prompt_candidate_count || 0),
    catalog_prompt_candidate_count: Number(report.catalog_prompt_candidate_count || 0),
    copied_serial_grade_cert_from_reference_count: Number(report.copied_serial_grade_cert_from_reference_count || 0),
    base_without_catalog_support_count: Number(report.base_without_catalog_support_count || 0),
    base_in_resolved_fields_count: Number(report.base_in_resolved_fields_count || 0),
    base_in_rendered_title_count: Number(report.base_in_rendered_title_count || 0),
    serial_reference_count: Number(report.serial_number_title_analysis?.reference_serial_count || 0),
    serial_exact_match_count: Number(report.serial_number_title_analysis?.exact_match_count || 0),
    serial_denominator_match_count: Number(report.serial_number_title_analysis?.denominator_match_count || 0),
    serial_numerator_omission_count: Number(report.serial_number_title_analysis?.numerator_omission_count || 0),
    open_set_status_counts: report.open_set_status_counts || {}
  };
}

function passCount(row = {}, key = "") {
  return Number(row[key] || 0);
}

function rejectionReasons(row = {}, baseline = {}) {
  const reasons = [];
  if (row.attempted_count !== baseline.attempted_count) reasons.push("DIFFERENT_SAMPLE_COUNT");
  if (row.provider_success_count !== row.attempted_count) reasons.push("PROVIDER_SUCCESS_NOT_100_PERCENT");
  if (row.provider_error_count > 0) reasons.push("PROVIDER_ERROR");
  if (row.technical_failure_count > 0) reasons.push("TECHNICAL_FAILURE");
  if (row.provider_error_retry_count > 0) reasons.push("PROVIDER_RETRY");
  if (row.copied_serial_grade_cert_from_reference_count > 0) reasons.push("COPIED_REFERENCE_INSTANCE_FIELD");
  if (row.base_without_catalog_support_count > 0 || row.base_in_resolved_fields_count > 0 || row.base_in_rendered_title_count > 0) {
    reasons.push("BASE_POLLUTION");
  }
  if (passCount(row, "pass_at_0_72_count") < passCount(baseline, "pass_at_0_72_count")) reasons.push("PASS_0_72_REGRESSION");
  if (passCount(row, "pass_at_0_80_count") < passCount(baseline, "pass_at_0_80_count")) reasons.push("PASS_0_80_REGRESSION");
  const recall = numberOrNull(row.reviewed_title_token_recall_avg);
  const baselineRecall = numberOrNull(baseline.reviewed_title_token_recall_avg);
  if (recall !== null && baselineRecall !== null && recall < baselineRecall - 0.001) reasons.push("TITLE_RECALL_REGRESSION");
  return reasons;
}

function compareRows(left = {}, right = {}) {
  const leftRate = numberOrNull(left.evaluated_cards_per_minute ?? left.attempted_cards_per_minute) ?? -1;
  const rightRate = numberOrNull(right.evaluated_cards_per_minute ?? right.attempted_cards_per_minute) ?? -1;
  if (rightRate !== leftRate) return rightRate - leftRate;
  const leftP95 = numberOrNull(left.p95_ms) ?? Number.POSITIVE_INFINITY;
  const rightP95 = numberOrNull(right.p95_ms) ?? Number.POSITIVE_INFINITY;
  if (leftP95 !== rightP95) return leftP95 - rightP95;
  return Number(left.concurrency || 0) - Number(right.concurrency || 0);
}

export async function compareConcurrencySweep({
  reports = [],
  outPath = ""
} = {}) {
  if (!reports.length) throw new Error("At least one --report=concurrency:path is required.");
  const rows = [];
  for (const report of reports) {
    const data = await readJson(report.path);
    rows.push(metricRow({
      ...data,
      configured_concurrency: report.concurrency || data.configured_concurrency
    }, report.path));
  }
  rows.sort((left, right) => left.concurrency - right.concurrency);
  const baseline = rows.find((row) => row.concurrency === 1) || rows[0];
  const evaluated = rows.map((row) => ({
    ...row,
    stable: rejectionReasons(row, baseline).length === 0,
    rejection_reasons: rejectionReasons(row, baseline)
  }));
  const stableRows = evaluated.filter((row) => row.stable);
  const recommended = [...stableRows].sort(compareRows)[0] || evaluated[0] || null;
  const report = {
    schema_version: "concurrency-sweep-comparison-v1",
    generated_at: new Date().toISOString(),
    baseline_concurrency: baseline?.concurrency ?? null,
    recommended_concurrency: recommended?.concurrency ?? null,
    recommendation_reason: recommended
      ? "highest stable evaluated cards per minute without quality or stability regression"
      : "no stable concurrency found",
    rows: evaluated
  };
  if (outPath) await writeJson(outPath, report);
  return report;
}

export async function main(argv = process.argv) {
  const reports = parseReportArgs(argv);
  const outPath = argValue(argv, "--out", "");
  const report = await compareConcurrencySweep({ reports, outPath });
  process.stdout.write([
    `concurrency sweep recommendation: ${report.recommended_concurrency ?? "n/a"}`,
    `baseline_concurrency: ${report.baseline_concurrency ?? "n/a"}`,
    ...report.rows.map((row) => [
      `c${row.concurrency}`,
      `stable=${row.stable}`,
      `cards_per_min=${row.evaluated_cards_per_minute ?? row.attempted_cards_per_minute ?? "n/a"}`,
      `recall=${row.reviewed_title_token_recall_avg ?? "n/a"}`,
      `pass@0.80=${row.pass_at_0_80_count}/${row.attempted_count}`,
      `p95=${row.p95_ms ?? "n/a"}ms`,
      `reasons=${row.rejection_reasons.join("|") || "n/a"}`
    ].join(" "))
  ].join("\n") + "\n");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Concurrency sweep comparison failed: ${error.message}`);
    process.exit(1);
  }
}
