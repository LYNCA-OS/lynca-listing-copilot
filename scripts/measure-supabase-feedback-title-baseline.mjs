import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "supabase-feedback-title-baseline-v1";
const defaultInputPath = "data/recognition/reports/supabase-feedback-rows-all-mcp.json";
const defaultOutPath = "data/eval/supabase-feedback-title-baseline-latest.json";
const colorTokens = new Set([
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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
  return normalizeText(value)
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

function titleTokens(title) {
  return unique(words(title).filter((token) => token.length > 1));
}

function overlap(leftValues = [], rightValues = []) {
  const right = new Set(rightValues);
  return leftValues.filter((value) => right.has(value));
}

function tokenRate(matches, denominator) {
  if (!denominator) return null;
  return Number((matches / denominator).toFixed(6));
}

function yearsFromTitle(title) {
  return unique((canonicalText(title).match(/\b\d{4}(?:\s\d{2})?\b/g) || []).map((value) => value.replace(/\s/g, "-")));
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function serialsFromTitle(title) {
  return unique((String(title || "").match(/\b\d+\s*\/\s*\d+\b/g) || []).map(normalizeSerial));
}

function gradesFromTitle(title) {
  const source = canonicalText(title).toUpperCase();
  return unique((source.match(/\b(?:PSA|BGS|SGC|CGC)\s+(?:AUTO\s+)?\d+(?:\.\d+)?\b/g) || [])
    .map((value) => value.replace(/\s+/g, " ").trim()));
}

function colorsFromTitle(title) {
  const tokenSet = new Set(words(title));
  return [...colorTokens].filter((token) => tokenSet.has(token));
}

function titleComparison(referenceTitle, predictedTitle) {
  const referenceCanonical = canonicalText(referenceTitle);
  const predictedCanonical = canonicalText(predictedTitle);
  const referenceTokens = titleTokens(referenceTitle);
  const predictedTokens = titleTokens(predictedTitle);
  const recallMatches = overlap(referenceTokens, predictedTokens).length;
  const precisionMatches = overlap(predictedTokens, referenceTokens).length;
  const referenceYears = yearsFromTitle(referenceTitle);
  const predictedYears = yearsFromTitle(predictedTitle);
  const referenceSerials = serialsFromTitle(referenceTitle);
  const predictedSerials = serialsFromTitle(predictedTitle);
  const referenceGrades = gradesFromTitle(referenceTitle);
  const predictedGrades = gradesFromTitle(predictedTitle);
  const referenceColors = colorsFromTitle(referenceTitle);
  const predictedColors = colorsFromTitle(predictedTitle);
  const unexpectedColors = predictedColors.filter((token) => !referenceColors.includes(token));
  const yearOverlap = overlap(referenceYears, predictedYears);
  const serialOverlap = overlap(referenceSerials, predictedSerials);
  const gradeOverlap = overlap(referenceGrades, predictedGrades);
  const wrongYear = referenceYears.length > 0 && predictedYears.length > 0 && yearOverlap.length === 0;
  const wrongSerial = referenceSerials.length > 0 && predictedSerials.length > 0 && serialOverlap.length === 0;
  const wrongGrade = referenceGrades.length > 0 && predictedGrades.length > 0 && gradeOverlap.length === 0;
  const unexpectedColor = unexpectedColors.length > 0;

  return {
    raw_exact: normalizeText(referenceTitle) === normalizeText(predictedTitle),
    normalized_exact: Boolean(referenceCanonical && predictedCanonical && referenceCanonical === predictedCanonical),
    token_recall: tokenRate(recallMatches, referenceTokens.length),
    token_precision: tokenRate(precisionMatches, predictedTokens.length),
    reference_token_count: referenceTokens.length,
    predicted_token_count: predictedTokens.length,
    wrong_year: wrongYear,
    wrong_serial: wrongSerial,
    wrong_grade: wrongGrade,
    unexpected_color: unexpectedColor,
    critical_title_error: wrongYear || wrongSerial || wrongGrade || unexpectedColor
  };
}

function firstJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

function parseJsonish(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.rows)) return value.rows;
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.result)) return value.result;
    if (Array.isArray(value.items)) return value.items.map(rowFromRecognitionItem);
    if (typeof value.result === "string") return parseJsonish(value.result);
  }
  if (typeof value !== "string") {
    throw new Error("Feedback title baseline input must be a row array, recognition candidate manifest, { rows }, { data }, or MCP { result } payload.");
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    return parseJsonish(JSON.parse(trimmed));
  } catch {
    const fenced = trimmed.match(/<untrusted-data-[^>]+>\s*([\s\S]*?)\s*<\/untrusted-data-[^>]+>/);
    const candidate = fenced?.[1] || firstJsonArray(trimmed);
    if (!candidate) {
      throw new Error("Could not find a JSON feedback row array in title baseline input.");
    }
    return parseJsonish(JSON.parse(candidate));
  }
}

function rowFromRecognitionItem(item = {}) {
  const titles = item.source_titles || {};
  return {
    id: item.source_feedback_id || item.asset_id || item.physical_card_id,
    generated_title: titles.generated_title || item.generated_title,
    corrected_title: titles.corrected_title || item.corrected_title,
    created_at: item.created_at,
    image_backed: Array.isArray(item.images) && item.images.length > 0
  };
}

function rowsFromInputPayload(payload) {
  const rows = parseJsonish(payload);
  if (!Array.isArray(rows)) {
    throw new Error("Parsed feedback title baseline input did not produce a row array.");
  }
  return rows;
}

function hasImage(row = {}) {
  if (row.image_backed === true) return true;
  return Boolean(
    normalizeText(row.front_image_url)
    || normalizeText(row.back_image_url)
    || normalizeText(row.front_object_path)
    || normalizeText(row.back_object_path)
    || (Array.isArray(row.images) && row.images.length > 0)
  );
}

function comparableRow(row = {}) {
  return Boolean(normalizeText(row.generated_title) && normalizeText(row.corrected_title));
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6));
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

function summarizeRows(rows = [], cohort) {
  const comparable = rows.filter(comparableRow);
  const comparisons = comparable.map((row) => titleComparison(row.corrected_title, row.generated_title));
  const count = (field) => comparisons.filter((item) => item[field] === true).length;
  const total = comparisons.length;
  const rawExact = count("raw_exact");
  const normalizedExact = count("normalized_exact");
  const criticalErrors = count("critical_title_error");
  const wrongYear = count("wrong_year");
  const wrongSerial = count("wrong_serial");
  const wrongGrade = count("wrong_grade");
  const unexpectedColor = count("unexpected_color");
  const humanCorrectedProxy = total - normalizedExact;

  return {
    cohort,
    source_rows: rows.length,
    comparable_rows: total,
    image_backed_rows: rows.filter(hasImage).length,
    raw_exact_count: rawExact,
    raw_exact_rate: rate(rawExact, total),
    normalized_exact_count: normalizedExact,
    normalized_exact_rate: rate(normalizedExact, total),
    human_corrected_proxy_count: humanCorrectedProxy,
    human_correction_proxy_rate: rate(humanCorrectedProxy, total),
    corrected_title_token_recall_avg: average(comparisons.map((item) => item.token_recall)),
    corrected_title_token_precision_avg: average(comparisons.map((item) => item.token_precision)),
    critical_title_error_count: criticalErrors,
    critical_title_error_rate: rate(criticalErrors, total),
    wrong_year_count: wrongYear,
    wrong_serial_count: wrongSerial,
    wrong_grade_count: wrongGrade,
    unexpected_color_count: unexpectedColor,
    confidence_intervals: {
      normalized_exact_rate: wilsonInterval(normalizedExact, total),
      human_correction_proxy_rate: wilsonInterval(humanCorrectedProxy, total),
      critical_title_error_rate: wilsonInterval(criticalErrors, total),
      wrong_year_rate: wilsonInterval(wrongYear, total),
      wrong_serial_rate: wilsonInterval(wrongSerial, total),
      wrong_grade_rate: wilsonInterval(wrongGrade, total),
      unexpected_color_rate: wilsonInterval(unexpectedColor, total)
    }
  };
}

function createdAtBounds(rows = []) {
  let first = null;
  let last = null;
  let firstTime = Infinity;
  let lastTime = -Infinity;
  for (const row of rows) {
    const time = Date.parse(String(row?.created_at || ""));
    if (!Number.isFinite(time)) continue;
    if (time < firstTime) {
      firstTime = time;
      first = row.created_at;
    }
    if (time > lastTime) {
      lastTime = time;
      last = row.created_at;
    }
  }
  return { first, last };
}

export function measureSupabaseFeedbackTitleBaseline({
  rows,
  source = {},
  now = () => new Date()
} = {}) {
  const allRows = Array.isArray(rows) ? rows : [];
  const imageRows = allRows.filter(hasImage);
  const noImageRows = allRows.filter((row) => !hasImage(row));
  const bounds = createdAtBounds(allRows);

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    source: {
      table: "listing_title_feedback",
      ...source,
      row_count: allRows.length,
      image_backed_row_count: imageRows.length,
      no_image_row_count: noImageRows.length,
      first_created_at: bounds.first,
      last_created_at: bounds.last
    },
    scope: {
      metric_type: "historical_generated_title_vs_human_corrected_title",
      corrected_title_reference_only: true,
      field_ground_truth_available: false,
      image_level_provider_eval: false,
      no_feedback_retention_side_effects: true,
      raw_titles_in_report: false,
      commercial_accuracy_claim_allowed: false,
      commercial_proxy_metric_available: true
    },
    cohorts: [
      summarizeRows(allRows, "all_feedback_rows"),
      summarizeRows(imageRows, "image_backed_rows"),
      summarizeRows(noImageRows, "no_image_rows")
    ]
  };
}

export function formatSupabaseFeedbackTitleBaselineSummary(report = {}) {
  const lines = [
    `Supabase feedback title baseline ${report.schema_version || "unknown"}`,
    `source_rows: ${report.source?.row_count ?? "n/a"}`,
    `image_backed_rows: ${report.source?.image_backed_row_count ?? "n/a"}`,
    `no_image_rows: ${report.source?.no_image_row_count ?? "n/a"}`,
    `corrected_title_reference_only: ${report.scope?.corrected_title_reference_only === true}`,
    `commercial_accuracy_claim_allowed: ${report.scope?.commercial_accuracy_claim_allowed === true}`,
    `raw_titles_in_report: ${report.scope?.raw_titles_in_report === true}`
  ];

  for (const cohort of report.cohorts || []) {
    const exactCi = cohort.confidence_intervals?.normalized_exact_rate || {};
    const criticalCi = cohort.confidence_intervals?.critical_title_error_rate || {};
    lines.push(
      `${cohort.cohort}: comparable=${cohort.comparable_rows} normalized_exact=${cohort.normalized_exact_count}/${cohort.comparable_rows} (${cohort.normalized_exact_rate ?? "n/a"}) ci95=${exactCi.lower ?? "n/a"}..${exactCi.upper ?? "n/a"} critical_title_errors=${cohort.critical_title_error_count}/${cohort.comparable_rows} (${cohort.critical_title_error_rate ?? "n/a"}) ci95=${criticalCi.lower ?? "n/a"}..${criticalCi.upper ?? "n/a"} token_recall_avg=${cohort.corrected_title_token_recall_avg ?? "n/a"} token_precision_avg=${cohort.corrected_title_token_precision_avg ?? "n/a"}`
    );
  }

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
  const inputPath = argValue(argv, "--input", env.SUPABASE_FEEDBACK_TITLE_BASELINE_INPUT || defaultInputPath);
  const outPath = argValue(argv, "--out", env.SUPABASE_FEEDBACK_TITLE_BASELINE_OUT || defaultOutPath);
  const noWrite = hasFlag(argv, "--no-write");
  const input = await readJson(inputPath);
  const rows = rowsFromInputPayload(input);
  const report = measureSupabaseFeedbackTitleBaseline({
    rows,
    source: {
      input_path: inputPath,
      provider: input?.source?.provider || "local_json_export",
      manifest_hash: input?.manifest_hash || null
    }
  });

  if (outPath && !noWrite) await writeJson(outPath, report);
  process.stdout.write(`${formatSupabaseFeedbackTitleBaselineSummary(report)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Supabase feedback title baseline failed: ${error.message}`);
    process.exit(1);
  }
}
