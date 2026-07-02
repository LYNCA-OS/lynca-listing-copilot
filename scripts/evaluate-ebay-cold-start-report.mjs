import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleTokens(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenRecall(reference = "", prediction = "") {
  const referenceTokens = titleTokens(reference);
  if (!referenceTokens.length) return null;
  const predicted = new Set(titleTokens(prediction));
  const matched = referenceTokens.filter((token) => predicted.has(token)).length;
  return Number((matched / referenceTokens.length).toFixed(6));
}

function readJsonl(text = "") {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readSealedLabels(path = "") {
  if (!path) return new Map();
  const resolved = resolve(path);
  if (!existsSync(resolved)) return new Map();
  const rows = readJsonl(await readFile(resolved, "utf8"));
  const map = new Map();
  rows.forEach((row) => {
    const keys = [
      row.case_id,
      row.asset_id,
      row.candidate_id,
      row.label_key,
      row.key
    ].map(normalizeText).filter(Boolean);
    keys.forEach((key) => map.set(key, row));
  });
  return map;
}

function sealedLabelForResult(result = {}, sealed = new Map()) {
  const keys = [
    result.candidate_id,
    result.asset_id,
    result.case_id,
    result.sealed_eval_label_ref?.key
  ].map(normalizeText).filter(Boolean);
  for (const key of keys) {
    if (sealed.has(key)) return sealed.get(key);
  }
  return null;
}

function rate(count, denominator) {
  return denominator ? Number((count / denominator).toFixed(6)) : null;
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(value));
  return numeric.length ? Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6)) : null;
}

function isSafeDraft(result = {}) {
  return result.cold_start_safe_draft?.safe_draft_ready === true || result.cold_start_status === "SAFE_DRAFT_READY";
}

function reviewRequired(result = {}) {
  return result.writer_action_required === true
    || ["WRITER_REVIEW_REQUIRED", "DEEP_RESEARCH_REQUIRED", "CATALOG_GAP_REQUIRED", "MARKETPLACE_HINTS_ONLY"].includes(result.cold_start_status);
}

function highRiskGuessFields(result = {}) {
  return Array.isArray(result.cold_start_analysis?.high_risk_guess_fields)
    ? result.cold_start_analysis.high_risk_guess_fields
    : [];
}

function coldStartRow(result = {}, sealedLabel = null) {
  const finalTitle = normalizeText(result.final_evaluated_title || result.scored_title || result.final_title || result.title);
  const sellerTitle = normalizeText(sealedLabel?.title || sealedLabel?.seller_title || "");
  const recall = sellerTitle ? tokenRecall(sellerTitle, finalTitle) : null;
  return {
    candidate_id: result.candidate_id || "",
    cold_start_status: result.cold_start_status || "",
    safe_draft_ready: isSafeDraft(result),
    writer_review_required: reviewRequired(result),
    no_approved_catalog_match: result.cold_start_analysis?.no_approved_catalog_match === true,
    final_title: finalTitle,
    sealed_marketplace_title_for_eval_only: sellerTitle,
    marketplace_title_used_as_truth: false,
    marketplace_title_sent_to_model: false,
    sealed_title_token_recall_proxy: recall,
    high_risk_guess_fields: highRiskGuessFields(result),
    high_risk_guess_removed: result.high_risk_guess_removed || [],
    unsupported_exact_parallel: result.cold_start_analysis?.unsupported_exact_parallel === true,
    unsupported_official_card_type: result.cold_start_analysis?.unsupported_official_card_type === true,
    serial_current_image_only: result.cold_start_analysis?.serial_current_image_only ?? null,
    grade_current_image_only: result.cold_start_analysis?.grade_current_image_only ?? null,
    external_retrieval_used: result.external_retrieval_used === true,
    external_retrieval_trace: result.external_retrieval_trace || [],
    focused_crop_metrics: result.focused_crop_metrics || null
  };
}

export async function buildEbayColdStartReport({
  reportPath,
  sealedLabelsPath = "",
  outPath = "",
  markdownOutPath = ""
} = {}) {
  if (!reportPath) throw new Error("--report is required");
  const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  const sealed = await readSealedLabels(sealedLabelsPath);
  const results = Array.isArray(report.results) ? report.results : [];
  const rows = results.map((result) => coldStartRow(result, sealedLabelForResult(result, sealed)));
  const recallValues = rows.map((row) => row.sealed_title_token_recall_proxy).filter((value) => Number.isFinite(value));
  const metrics = {
    attempted_count: rows.length,
    cold_start_safe_draft_count: rows.filter((row) => row.safe_draft_ready).length,
    cold_start_safe_draft_rate: rate(rows.filter((row) => row.safe_draft_ready).length, rows.length),
    critical_error_rate: rate(rows.filter((row) => row.high_risk_guess_fields.length > 0).length, rows.length),
    critical_error_rate_basis: "rule_proxy_high_risk_unsupported_identity_guess_without_reviewed_field_gt",
    high_risk_guess_count: rows.reduce((sum, row) => sum + row.high_risk_guess_fields.length, 0),
    high_risk_guess_removed_count: rows.reduce((sum, row) => sum + row.high_risk_guess_removed.length, 0),
    unsupported_exact_parallel_count: rows.filter((row) => row.unsupported_exact_parallel).length,
    unsupported_official_card_type_count: rows.filter((row) => row.unsupported_official_card_type).length,
    serial_current_image_only_rate: rate(rows.filter((row) => row.serial_current_image_only === true).length, rows.filter((row) => row.serial_current_image_only !== null).length),
    grade_current_image_only_rate: rate(rows.filter((row) => row.grade_current_image_only === true).length, rows.filter((row) => row.grade_current_image_only !== null).length),
    no_approved_catalog_match_count: rows.filter((row) => row.no_approved_catalog_match).length,
    catalog_gap_created_count: report.catalog_gap_created_count ?? report.catalog_gap_queue_candidate_count ?? rows.filter((row) => row.no_approved_catalog_match).length,
    external_retrieval_used_count: rows.filter((row) => row.external_retrieval_used).length,
    external_retrieval_recovery_count: report.external_retrieval_recovery_count ?? 0,
    external_retrieval_regression_count: report.external_retrieval_regression_count ?? 0,
    writer_review_required_rate: rate(rows.filter((row) => row.writer_review_required).length, rows.length),
    sealed_marketplace_title_token_recall_proxy_avg: average(recallValues),
    sealed_marketplace_title_proxy_policy: "weak_marketplace_label_for_post_prediction_eval_only_not_ground_truth"
  };
  const output = {
    schema_version: "ebay-cold-start-report-v1",
    generated_at: new Date().toISOString(),
    source_report_path: reportPath,
    sealed_labels_path: sealedLabelsPath || null,
    policy: {
      ebay_title_used_as_catalog: false,
      ebay_title_used_as_ground_truth: false,
      ebay_title_sent_to_model: false,
      manual_review_required_for_training: true
    },
    metrics,
    rows
  };
  if (outPath) await writeJson(outPath, output);
  if (markdownOutPath) await writeMarkdown(markdownOutPath, output);
  return output;
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeMarkdown(path, report) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  const metrics = report.metrics || {};
  const lines = [
    "# eBay Cold-Start Blind Report",
    "",
    "Policy: eBay seller title is sealed weak label only. It is not catalog truth, field GT, or prompt hint.",
    "",
    `- attempted_count: ${metrics.attempted_count}`,
    `- cold_start_safe_draft_rate: ${metrics.cold_start_safe_draft_rate}`,
    `- critical_error_rate: ${metrics.critical_error_rate}`,
    `- high_risk_guess_count: ${metrics.high_risk_guess_count}`,
    `- high_risk_guess_removed_count: ${metrics.high_risk_guess_removed_count}`,
    `- unsupported_exact_parallel_count: ${metrics.unsupported_exact_parallel_count}`,
    `- unsupported_official_card_type_count: ${metrics.unsupported_official_card_type_count}`,
    `- no_approved_catalog_match_count: ${metrics.no_approved_catalog_match_count}`,
    `- catalog_gap_created_count: ${metrics.catalog_gap_created_count}`,
    `- external_retrieval_used_count: ${metrics.external_retrieval_used_count}`,
    `- writer_review_required_rate: ${metrics.writer_review_required_rate}`,
    "",
    "## Gap To 85% Safe Draft",
    "",
    `Current safe draft rate is ${metrics.cold_start_safe_draft_rate ?? "n/a"}. Remaining gap is driven by cards without enough directly observed identity fields or with high-risk unsupported exact identity guesses.`,
    "",
    "## Per Card",
    "",
    "| candidate_id | status | safe | review | high_risk | final_title | sealed_proxy_recall |",
    "|---|---:|---:|---:|---:|---|---:|",
    ...report.rows.map((row) => `| ${row.candidate_id} | ${row.cold_start_status || ""} | ${row.safe_draft_ready ? "yes" : "no"} | ${row.writer_review_required ? "yes" : "no"} | ${row.high_risk_guess_fields.join(", ")} | ${row.final_title.replaceAll("|", "\\|")} | ${row.sealed_title_token_recall_proxy ?? ""} |`)
  ];
  await writeFile(resolved, `${lines.join("\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildEbayColdStartReport({
    reportPath: argValue(process.argv, "--report"),
    sealedLabelsPath: argValue(process.argv, "--sealed-labels", ""),
    outPath: argValue(process.argv, "--out", ""),
    markdownOutPath: argValue(process.argv, "--markdown-out", "")
  }).then((report) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      schema_version: report.schema_version,
      attempted_count: report.metrics.attempted_count,
      cold_start_safe_draft_rate: report.metrics.cold_start_safe_draft_rate,
      critical_error_rate: report.metrics.critical_error_rate
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
