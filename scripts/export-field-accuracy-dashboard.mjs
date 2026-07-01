import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";

const fields = Object.freeze([
  "subject",
  "year",
  "product_or_set",
  "card_type",
  "variant_or_parallel",
  "collector_number",
  "serial_number",
  "serial_denominator",
  "grade"
]);

function argValues(argv, name) {
  const values = [];
  argv.forEach((value, index) => {
    if (value === name && argv[index + 1]) values.push(argv[index + 1]);
    else if (value.startsWith(`${name}=`)) values.push(value.slice(name.length + 1));
  });
  return values;
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSet(values = []) {
  return [...new Set(values.map(normalizeToken).filter(Boolean))].sort();
}

function isKnown(value) {
  if (Array.isArray(value)) return value.length > 0;
  const text = cleanText(value);
  return Boolean(text) && !/^(?:unknown|not_applicable|n\/a|null)$/i.test(text);
}

function subjectValues(parsed = {}) {
  return [
    ...(Array.isArray(parsed.players) ? parsed.players : []),
    ...(Array.isArray(parsed.subjects) ? parsed.subjects : []),
    parsed.player,
    parsed.subject,
    parsed.character
  ].map(cleanText).filter(Boolean);
}

function serialDenominator(value = "") {
  return cleanText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || "";
}

function fieldValue(parsed = {}, field = "") {
  if (field === "subject") return normalizeSet(subjectValues(parsed));
  if (field === "product_or_set") return normalizeSet([parsed.manufacturer, parsed.product, parsed.set].filter(Boolean));
  if (field === "card_type") return normalizeSet([parsed.official_card_type, parsed.card_type, parsed.card_name].filter(Boolean));
  if (field === "variant_or_parallel") return normalizeSet([parsed.parallel_exact, parsed.parallel, parsed.surface_color, parsed.variation, parsed.insert].filter(Boolean));
  if (field === "serial_number") return cleanText(parsed.serial_number);
  if (field === "serial_denominator") return parsed.serial_denominator ? `/${parsed.serial_denominator}` : serialDenominator(parsed.title) ? `/${serialDenominator(parsed.title)}` : "";
  if (field === "grade") return normalizeSet([parsed.grade_company, parsed.card_grade, parsed.auto_grade].filter(Boolean));
  return cleanText(parsed[field]);
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? left : normalizeSet([left]);
    const b = Array.isArray(right) ? right : normalizeSet([right]);
    if (!a.length || !b.length) return null;
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  if (!a || !b) return null;
  if (/^\/\d+$/.test(a) || /^\/\d+$/.test(b)) return a === b;
  return a === b;
}

function finalTitle(result = {}) {
  return cleanText(result.final_evaluated_title || result.final_title || result.title || result.rendered_fields?.title || result.rendered_fields?.rendered_title);
}

function referenceTitle(result = {}) {
  return cleanText(result.corrected_title_reference || result.corrected_title || result.reviewed_ground_truth?.title || result.reference_title);
}

function modules(result = {}) {
  const value = result.rendered_fields?.modules;
  if (!value || typeof value !== "object") return {};
  return value;
}

const fieldModuleHints = Object.freeze({
  subject: ["subject"],
  year: ["year"],
  product_or_set: ["product_identity"],
  card_type: ["card_name", "search_optimization"],
  variant_or_parallel: ["release_variant", "print_finish"],
  collector_number: ["card_number"],
  serial_number: [],
  serial_denominator: ["numerical_rarity"],
  grade: ["grading"]
});

function displayStatus(result = {}, field = "", predictionKnown = false) {
  const moduleMap = modules(result);
  const statuses = (fieldModuleHints[field] || [])
    .map((key) => moduleMap[key]?.status)
    .filter(Boolean);
  if (statuses.includes("CONFLICT")) return "CONFLICT";
  if (statuses.includes("REVIEW") || statuses.includes("MISSING")) return "REVIEW";
  if (statuses.includes("CONFIRMED") || statuses.includes("MANUAL_CONFIRMED")) return "NORMAL";
  return predictionKnown ? "REVIEW" : "UNKNOWN";
}

function groupKey(result = {}) {
  const knownCatalog = Boolean(
    result.known_catalog_candidate_available
    || result.correct_catalog_identity_available
    || result.correct_catalog_candidate_rank
    || result.catalog_prompt_candidate_count
  );
  const parts = {
    provider_mode: cleanText(result.requested_cloud_provider || result.provider_mode || result.provider || "unknown"),
    catalog_assist: Boolean(result.catalog_prompt_assist_used || result.catalog_prompt_candidate_count),
    vector_lazy_skip: Boolean(result.vector_lazy_skip),
    retrieval_title_assist_used: Boolean(result.retrieval_title_assist_used),
    known_catalog: knownCatalog,
    cold_start: !knownCatalog
  };
  return {
    key: Object.entries(parts).map(([name, value]) => `${name}=${value}`).join("|"),
    dimensions: parts
  };
}

function blankFieldStats(field) {
  return {
    field,
    evaluated_count: 0,
    correct_count: 0,
    incorrect_count: 0,
    auto_accept_count: 0,
    review_count: 0,
    false_accept_count: 0,
    false_reject_count: 0,
    field_accuracy: null,
    auto_accept_rate: null,
    review_rate: null,
    error_examples: []
  };
}

function updateRates(stats) {
  stats.field_accuracy = stats.evaluated_count ? Number((stats.correct_count / stats.evaluated_count).toFixed(6)) : null;
  stats.auto_accept_rate = stats.evaluated_count ? Number((stats.auto_accept_count / stats.evaluated_count).toFixed(6)) : null;
  stats.review_rate = stats.evaluated_count ? Number((stats.review_count / stats.evaluated_count).toFixed(6)) : null;
  return stats;
}

function addExample(stats, example) {
  if (stats.error_examples.length < 8) stats.error_examples.push(example);
}

function evaluateResultField(result = {}, field = "") {
  const gtTitle = referenceTitle(result);
  const predictedTitle = finalTitle(result);
  const gtParsed = parseReviewedTitleFields(gtTitle);
  const predictedParsed = parseReviewedTitleFields(predictedTitle);
  gtParsed.title = gtTitle;
  predictedParsed.title = predictedTitle;
  const groundTruth = fieldValue(gtParsed, field);
  if (!isKnown(groundTruth)) return null;
  const prediction = fieldValue(predictedParsed, field);
  const predictionKnown = isKnown(prediction);
  const correct = valuesEqual(groundTruth, prediction) === true;
  const status = displayStatus(result, field, predictionKnown);
  return {
    field,
    query_card_id: cleanText(result.candidate_id || result.query_card_id || result.asset_id),
    ground_truth: groundTruth,
    prediction,
    display_status: status,
    is_correct: correct,
    final_title: predictedTitle,
    corrected_title: gtTitle
  };
}

function aggregateFieldRows(rows = []) {
  const statsByField = Object.fromEntries(fields.map((field) => [field, blankFieldStats(field)]));
  rows.forEach((row) => {
    const stats = statsByField[row.field] || blankFieldStats(row.field);
    stats.evaluated_count += 1;
    if (row.is_correct) stats.correct_count += 1;
    else {
      stats.incorrect_count += 1;
      addExample(stats, row);
    }
    if (row.display_status === "NORMAL") stats.auto_accept_count += 1;
    if (row.display_status === "REVIEW" || row.display_status === "CONFLICT") stats.review_count += 1;
    if (row.display_status === "NORMAL" && !row.is_correct) stats.false_accept_count += 1;
    if ((row.display_status === "REVIEW" || row.display_status === "CONFLICT") && row.is_correct) stats.false_reject_count += 1;
    statsByField[row.field] = stats;
  });
  Object.values(statsByField).forEach(updateRates);
  return statsByField;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function markdownDashboard(report = {}) {
  const lines = [
    "# Field Accuracy Dashboard",
    "",
    "Generated from saved eval reports only. corrected_title/reviewed title is treated as title-level proxy GT when no field GT exists.",
    "",
    "## Overall Fields",
    ""
  ];
  Object.values(report.fields || {}).forEach((stats) => {
    lines.push(`- ${stats.field}: accuracy=${stats.field_accuracy ?? "n/a"}, auto_accept=${stats.auto_accept_rate ?? "n/a"}, review=${stats.review_rate ?? "n/a"}, false_accept=${stats.false_accept_count}, false_reject=${stats.false_reject_count}`);
  });
  lines.push("", "## Groups", "");
  Object.entries(report.groups || {}).forEach(([key, group]) => {
    lines.push(`### ${key}`, "");
    Object.values(group.fields || {}).forEach((stats) => {
      lines.push(`- ${stats.field}: accuracy=${stats.field_accuracy ?? "n/a"}, false_accept=${stats.false_accept_count}, false_reject=${stats.false_reject_count}`);
    });
    lines.push("");
  });
  return lines.join("\n") + "\n";
}

async function writeText(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, value);
}

export async function exportFieldAccuracyDashboard({
  inputPaths = [],
  outPath = "",
  markdownPath = ""
} = {}) {
  if (!inputPaths.length) throw new Error("At least one --input report path is required.");
  const reports = await Promise.all(inputPaths.map(readJson));
  const fieldRows = [];
  const groups = {};
  reports.forEach((report) => {
    (Array.isArray(report.results) ? report.results : []).forEach((result) => {
      const { key, dimensions } = groupKey(result);
      const resultRows = fields.map((field) => evaluateResultField(result, field)).filter(Boolean);
      fieldRows.push(...resultRows);
      groups[key] ||= { dimensions, rows: [] };
      groups[key].rows.push(...resultRows);
    });
  });
  const output = {
    schema_version: "field-accuracy-dashboard-v1",
    generated_at: new Date().toISOString(),
    input_report_count: reports.length,
    evaluated_field_row_count: fieldRows.length,
    fields: aggregateFieldRows(fieldRows),
    groups: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, {
      dimensions: group.dimensions,
      fields: aggregateFieldRows(group.rows)
    }]))
  };
  if (outPath) await writeJson(outPath, output);
  if (markdownPath) await writeText(markdownPath, markdownDashboard(output));
  return output;
}

export async function main(argv = process.argv) {
  const inputPaths = argValues(argv, "--input");
  const outPath = argValue(argv, "--out", "data/eval/decision-learning/field-accuracy-dashboard.json");
  const markdownPath = argValue(argv, "--markdown-out", "data/eval/decision-learning/field-accuracy-dashboard.md");
  const report = await exportFieldAccuracyDashboard({ inputPaths, outPath, markdownPath });
  process.stdout.write([
    "field accuracy dashboard exported",
    `input_report_count: ${report.input_report_count}`,
    `evaluated_field_row_count: ${report.evaluated_field_row_count}`,
    `out: ${outPath || "n/a"}`,
    `markdown_out: ${markdownPath || "n/a"}`
  ].join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Field accuracy dashboard export failed: ${error.message}`);
    process.exit(1);
  }
}
