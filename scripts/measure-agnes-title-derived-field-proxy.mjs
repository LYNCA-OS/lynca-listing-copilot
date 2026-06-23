import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "agnes-title-derived-field-proxy-v1";
const defaultInputPath = "data/eval/agnes-supabase-feedback-latest.json";
const defaultOutPath = "data/eval/agnes-title-derived-field-proxy-latest.json";

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

function yearsFromText(text) {
  return unique((canonicalText(text).match(/\b\d{4}(?:\s\d{2})?\b/g) || [])
    .map((value) => value.replace(/\s/g, "-")));
}

function yearParts(value) {
  const match = String(value || "").match(/\b(\d{4})(?:-\d{2})?\b/);
  if (!match) return [];
  const start = Number(match[1]);
  const suffixMatch = String(value || "").match(/\b\d{4}-(\d{2})\b/);
  if (!suffixMatch) return [String(start)];
  const suffix = Number(suffixMatch[1]);
  const century = Math.floor(start / 100) * 100;
  let end = century + suffix;
  if (end < start) end += 100;
  return [String(start), String(end)];
}

function yearsIntersect(left = [], right = []) {
  return left.some((leftValue) => {
    const leftParts = yearParts(leftValue);
    return right.some((rightValue) => {
      if (leftValue === rightValue) return true;
      const rightParts = yearParts(rightValue);
      return leftParts.some((part) => rightParts.includes(part));
    });
  });
}

function normalizeYear(value) {
  const text = canonicalText(value).replace(/\s+/g, "-");
  const range = text.match(/\b(\d{4})-(\d{2})\b/);
  if (range) return `${range[1]}-${range[2]}`;
  const year = text.match(/\b\d{4}\b/);
  return year ? year[0] : "";
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function serialMatchIsGradePair(source, index) {
  const before = String(source || "").slice(Math.max(0, index - 18), index).toUpperCase();
  return /\b(?:PSA|BGS|SGC|CGC)\b[^/]{0,12}$/.test(before);
}

function serialsFromText(text) {
  const source = String(text || "");
  return unique([...source.matchAll(/\b\d+\s*\/\s*\d+\b/g)]
    .filter((match) => !serialMatchIsGradePair(source, match.index || 0))
    .map((match) => normalizeSerial(match[0])));
}

function gradeTokensFromText(text) {
  const source = canonicalText(text).toUpperCase();
  return unique((source.match(/\b(?:PSA|BGS|SGC|CGC)\s+(?:AUTO\s+)?\d+(?:\.\d+)?\b/g) || [])
    .map((value) => value.replace(/\s+/g, " ").trim()));
}

function gradeTokenFromFields(fields = {}) {
  const company = normalizeText(fields.grade_company || fields.grading_company).toUpperCase();
  const grade = normalizeText(fields.card_grade || fields.grade);
  if (!company || !grade) return "";
  return `${company} ${grade}`.replace(/\s+/g, " ").trim();
}

function colorsFromText(text) {
  const tokenSet = new Set(words(text));
  return [...colorTokens].filter((token) => tokenSet.has(token));
}

function colorsFromFields(fields = {}, title = "") {
  return unique([
    ...colorsFromText(fields.parallel),
    ...colorsFromText(fields.variation),
    ...colorsFromText(fields.subset),
    ...colorsFromText(fields.card_type),
    ...colorsFromText(fields.insert),
    ...colorsFromText(fields.set),
    ...colorsFromText(fields.product),
    ...(Array.isArray(fields.attributes) ? fields.attributes.flatMap(colorsFromText) : []),
    ...colorsFromText(title)
  ]);
}

function hasAuto(text) {
  return /\b(auto|autograph|signed|signature)\b/i.test(String(text || ""));
}

function hasRookie(text) {
  return /\b(rc|rookie)\b/i.test(String(text || ""));
}

function predictedAuto(fields = {}, title = "") {
  return fields.auto === true || hasAuto(title) || hasAuto(fields.card_type) || hasAuto(fields.insert);
}

function predictedRookie(fields = {}, title = "") {
  return fields.rc === true || hasRookie(title) || hasRookie(fields.card_type) || hasRookie(fields.insert);
}

function intersects(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function fieldCheck(field, expected, predicted, matched, evidence) {
  return {
    field,
    expected_count: Array.isArray(expected) ? expected.length : expected ? 1 : 0,
    predicted_count: Array.isArray(predicted) ? predicted.length : predicted ? 1 : 0,
    matched: Boolean(matched),
    evidence
  };
}

export function titleDerivedChecks(result = {}) {
  const referenceTitle = result.corrected_title_reference || "";
  const prediction = result.prediction || {};
  const fields = prediction.fields || {};
  const predictedTitle = prediction.title || "";
  const checks = [];

  const referenceYears = yearsFromText(referenceTitle);
  if (referenceYears.length) {
    const predictedYears = unique([
      normalizeYear(fields.year),
      normalizeYear(fields.season),
      ...yearsFromText(predictedTitle)
    ]);
    checks.push(fieldCheck("year", referenceYears, predictedYears, yearsIntersect(referenceYears, predictedYears), "corrected_title_year"));
  }

  const referenceSerials = serialsFromText(referenceTitle);
  if (referenceSerials.length) {
    const predictedSerials = unique([
      normalizeSerial(fields.serial_number),
      ...serialsFromText(predictedTitle)
    ]);
    checks.push(fieldCheck("serial_number", referenceSerials, predictedSerials, intersects(referenceSerials, predictedSerials), "corrected_title_serial"));
  }

  const referenceGrades = gradeTokensFromText(referenceTitle);
  if (referenceGrades.length) {
    const predictedGrades = unique([
      gradeTokenFromFields(fields),
      ...gradeTokensFromText(predictedTitle)
    ]);
    checks.push(fieldCheck("grade", referenceGrades, predictedGrades, intersects(referenceGrades, predictedGrades), "corrected_title_grade"));
  }

  const referenceColors = colorsFromText(referenceTitle);
  if (referenceColors.length) {
    const predictedColors = colorsFromFields(fields, predictedTitle);
    checks.push(fieldCheck("color", referenceColors, predictedColors, intersects(referenceColors, predictedColors), "corrected_title_color"));
  }

  if (hasAuto(referenceTitle)) {
    checks.push(fieldCheck("auto", true, predictedAuto(fields, predictedTitle), predictedAuto(fields, predictedTitle), "corrected_title_auto"));
  }

  if (hasRookie(referenceTitle)) {
    checks.push(fieldCheck("rc", true, predictedRookie(fields, predictedTitle), predictedRookie(fields, predictedTitle), "corrected_title_rc"));
  }

  return checks;
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

function fieldBreakdown(rows = []) {
  const byField = new Map();
  for (const row of rows) {
    for (const check of row.checks || []) {
      const current = byField.get(check.field) || {
        field: check.field,
        denominator: 0,
        correct: 0,
        incorrect: 0
      };
      current.denominator += 1;
      if (check.matched) current.correct += 1;
      else current.incorrect += 1;
      byField.set(check.field, current);
    }
  }

  return Object.fromEntries([...byField.values()]
    .sort((left, right) => left.field.localeCompare(right.field))
    .map((item) => [item.field, {
      ...item,
      accuracy: rate(item.correct, item.denominator),
      error_rate: rate(item.incorrect, item.denominator),
      confidence_interval: wilsonInterval(item.correct, item.denominator)
    }]));
}

export function measureAgnesTitleDerivedFieldProxy({
  report,
  now = () => new Date()
} = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const evaluated = results.filter((item) => item.status === "evaluated");
  const rows = evaluated.map((item) => {
    const checks = titleDerivedChecks(item);
    const correct = checks.filter((check) => check.matched).length;
    return {
      candidate_id: item.candidate_id || null,
      derivable_field_count: checks.length,
      correct_field_count: correct,
      incorrect_field_count: checks.length - correct,
      title_derived_exact: checks.length > 0 && correct === checks.length,
      checks
    };
  });
  const derivableRows = rows.filter((row) => row.derivable_field_count > 0);
  const totalFieldChecks = rows.reduce((sum, row) => sum + row.derivable_field_count, 0);
  const correctFieldChecks = rows.reduce((sum, row) => sum + row.correct_field_count, 0);
  const incorrectFieldChecks = totalFieldChecks - correctFieldChecks;
  const exactRows = derivableRows.filter((row) => row.title_derived_exact).length;

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    source: {
      provider: report?.provider || "agnes",
      input_schema_version: report?.schema_version || null,
      target_count: report?.target_count ?? results.length,
      attempted_count: report?.attempted_count ?? results.length,
      evaluated_count: evaluated.length,
      provider_error_count: report?.provider_error_count ?? results.filter((item) => item.status === "provider_error").length
    },
    scope: {
      metric_type: "agnes_prediction_fields_vs_corrected_title_derived_fields",
      corrected_title_reference_only: true,
      title_derived_fields_are_partial: true,
      field_ground_truth_available: false,
      commercial_accuracy_claim_allowed: false,
      raw_titles_in_report: false,
      no_feedback_retention_side_effects: true
    },
    metrics: {
      evaluated_rows: evaluated.length,
      derivable_rows: derivableRows.length,
      rows_without_derivable_fields: rows.length - derivableRows.length,
      total_field_checks: totalFieldChecks,
      correct_field_checks: correctFieldChecks,
      incorrect_field_checks: incorrectFieldChecks,
      field_level_proxy_accuracy: rate(correctFieldChecks, totalFieldChecks),
      field_level_proxy_error_rate: rate(incorrectFieldChecks, totalFieldChecks),
      card_level_title_derived_exact_count: exactRows,
      card_level_title_derived_exact_rate: rate(exactRows, derivableRows.length),
      average_derivable_fields_per_evaluated_row: average(rows.map((row) => row.derivable_field_count)),
      confidence_intervals: {
        field_level_proxy_accuracy: wilsonInterval(correctFieldChecks, totalFieldChecks),
        card_level_title_derived_exact_rate: wilsonInterval(exactRows, derivableRows.length)
      }
    },
    field_breakdown: fieldBreakdown(rows)
  };
}

export function formatAgnesTitleDerivedFieldProxySummary(report = {}) {
  const metrics = report.metrics || {};
  const lines = [
    `Agnes title-derived field proxy ${report.schema_version || "unknown"}`,
    `evaluated_rows: ${metrics.evaluated_rows ?? "n/a"}`,
    `derivable_rows: ${metrics.derivable_rows ?? "n/a"}`,
    `total_field_checks: ${metrics.total_field_checks ?? "n/a"}`,
    `field_level_proxy_accuracy: ${metrics.correct_field_checks ?? "n/a"}/${metrics.total_field_checks ?? "n/a"} (${metrics.field_level_proxy_accuracy ?? "n/a"})`,
    `card_level_title_derived_exact: ${metrics.card_level_title_derived_exact_count ?? "n/a"}/${metrics.derivable_rows ?? "n/a"} (${metrics.card_level_title_derived_exact_rate ?? "n/a"})`,
    `commercial_accuracy_claim_allowed: ${report.scope?.commercial_accuracy_claim_allowed === true}`,
    `raw_titles_in_report: ${report.scope?.raw_titles_in_report === true}`
  ];

  const fieldSummary = Object.values(report.field_breakdown || {})
    .map((item) => `${item.field}=${item.correct}/${item.denominator}(${item.accuracy})`)
    .join(" ");
  if (fieldSummary) lines.push(`field_breakdown: ${fieldSummary}`);
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
  const inputPath = argValue(argv, "--input", env.AGNES_TITLE_DERIVED_FIELD_PROXY_INPUT || defaultInputPath);
  const outPath = argValue(argv, "--out", env.AGNES_TITLE_DERIVED_FIELD_PROXY_OUT || defaultOutPath);
  const noWrite = hasFlag(argv, "--no-write");
  const input = await readJson(inputPath);
  const proxy = measureAgnesTitleDerivedFieldProxy({ report: input });
  if (outPath && !noWrite) await writeJson(outPath, proxy);
  process.stdout.write(`${formatAgnesTitleDerivedFieldProxySummary(proxy)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes title-derived field proxy failed: ${error.message}`);
    process.exit(1);
  }
}
