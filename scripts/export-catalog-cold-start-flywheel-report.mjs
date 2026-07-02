import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogFlywheelTrustMetrics,
  normalizedEditDistance
} from "../lib/listing/cold-start/catalog-flywheel.mjs";
import {
  isExternalDirectoryTrust,
  normalizeSourceTrust
} from "../lib/listing/external/external-candidate-contract.mjs";

const defaultOutPath = "data/eval/catalog-flywheel/catalog-cold-start-flywheel-report.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJson(path = "") {
  if (!path) return null;
  const resolved = resolve(path);
  if (!existsSync(resolved)) return null;
  return JSON.parse(await readFile(resolved, "utf8"));
}

function rowsFromReport(report = {}) {
  if (Array.isArray(report)) return report;
  if (Array.isArray(report.rows)) return report.rows;
  if (Array.isArray(report.items)) return report.items;
  if (Array.isArray(report.results)) return report.results;
  return [];
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(6)) : null;
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(value));
  return numeric.length ? Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6)) : null;
}

function unique(values = []) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function rowKeys(row = {}) {
  return unique([
    row.client_gap_key,
    row.gap_id,
    row.asset_id,
    row.source_feedback_id
  ]);
}

function sameLogicalRow(left = {}, right = {}) {
  const leftKeys = new Set(rowKeys(left));
  return rowKeys(right).some((key) => leftKeys.has(key));
}

function reviewedFieldCount(rows = []) {
  return rows.reduce((sum, row) => {
    const fields = row.writer_confirmed_fields || {};
    return sum + Object.keys(fields).filter((field) => fields[field] !== null && fields[field] !== undefined && normalizeText(fields[field]) !== "").length;
  }, 0);
}

function allCandidates(row = {}) {
  return [
    ...(Array.isArray(row.internal_candidates) ? row.internal_candidates : []),
    ...(Array.isArray(row.official_candidates) ? row.official_candidates : []),
    ...(Array.isArray(row.external_candidates) ? row.external_candidates : []),
    ...(Array.isArray(row.marketplace_hints) ? row.marketplace_hints : [])
  ];
}

function selectedCandidate(row = {}) {
  const selectedId = normalizeText(row.selected_candidate_id);
  if (!selectedId) return null;
  return allCandidates(row).find((candidate) => {
    return [
      candidate.candidate_id,
      candidate.external_card_id,
      candidate.external_set_id,
      candidate.title
    ].map(normalizeText).includes(selectedId);
  }) || null;
}

function externalPromotionCount(rows = []) {
  return rows.filter((row) => {
    const candidate = selectedCandidate(row);
    return row.promotion_status === "promoted"
      && candidate
      && isExternalDirectoryTrust(candidate.source_trust);
  }).length;
}

function referenceImageCount(rows = []) {
  return rows.reduce((sum, row) => {
    const ids = Array.isArray(row.image_ids) ? row.image_ids : Array.isArray(row.query_image_ids) ? row.query_image_ids : [];
    return sum + ids.length;
  }, 0);
}

function repeatMatchCount(rows = []) {
  return rows.filter((row) => row.cold_start_status === "EXACT_INTERNAL_MATCH").length;
}

function hardNegativeRows(report = {}) {
  return [
    ...(Array.isArray(report.hard_negatives) ? report.hard_negatives : []),
    ...rowsFromReport(report).flatMap((row) => Array.isArray(row.hard_negatives) ? row.hard_negatives : [])
  ];
}

function externalMetrics(report = {}) {
  const metrics = report?.metrics || {};
  return {
    external_candidate_recall_at_1: metrics.external_candidate_recall_at_1 ?? null,
    external_candidate_recall_at_3: metrics.external_candidate_recall_at_3 ?? null,
    external_candidate_recall_at_5: metrics.external_candidate_recall_at_5 ?? null,
    external_recovery_count: metrics.cardsight_recovery_count ?? metrics.external_recovery_count ?? 0,
    external_regression_count: metrics.cardsight_regression_count ?? metrics.external_regression_count ?? 0
  };
}

export async function buildCatalogColdStartFlywheelReport({
  gapQueuePath = "",
  coldStartReportPath = "",
  externalReportPath = "",
  writerConfirmationsPath = "",
  outPath = "",
  markdownOutPath = "",
  now = new Date()
} = {}) {
  if (!gapQueuePath) throw new Error("--gap-queue is required");
  const gapReport = await readJson(gapQueuePath);
  if (!gapReport) throw new Error(`Gap queue report not found: ${gapQueuePath}`);
  const coldStartReport = await readJson(coldStartReportPath) || {};
  const externalReport = await readJson(externalReportPath) || {};
  const writerReport = await readJson(writerConfirmationsPath) || {};
  const rows = rowsFromReport(gapReport);
  const writerRows = rowsFromReport(writerReport);
  const mergedRows = rows.map((row) => {
    const writer = writerRows.find((entry) => sameLogicalRow(entry, row));
    return writer ? { ...row, ...writer } : row;
  });
  const confirmedRows = mergedRows.filter((row) => Boolean(row.writer_final_title) || row.promotion_status === "promoted");
  const editDistances = confirmedRows.map((row) => normalizedEditDistance(row.ai_draft_title || "", row.writer_final_title || ""));
  const trustMetrics = catalogFlywheelTrustMetrics(mergedRows);
  const external = externalMetrics(externalReport);
  const coldMetrics = coldStartReport.metrics || {};
  const metrics = {
    cold_start_safe_draft_rate: coldMetrics.cold_start_safe_draft_rate ?? rate(rows.filter((row) => row.cold_start_status === "SAFE_DRAFT_READY").length, rows.length),
    external_candidate_recall_at_1: external.external_candidate_recall_at_1,
    external_candidate_recall_at_3: external.external_candidate_recall_at_3,
    external_candidate_recall_at_5: external.external_candidate_recall_at_5,
    external_recovery_count: external.external_recovery_count,
    external_regression_count: external.external_regression_count,
    catalog_gap_created_count: rows.length,
    writer_confirm_rate: rate(confirmedRows.length, rows.length),
    edit_distance_before_after: average(editDistances),
    critical_error_rate: coldMetrics.critical_error_rate ?? rate(mergedRows.filter((row) => (row.high_risk_fields || []).length > 0).length, mergedRows.length),
    high_risk_guess_count: coldMetrics.high_risk_guess_count ?? mergedRows.reduce((sum, row) => sum + (row.high_risk_fields || []).length, 0),
    internal_catalog_identity_count: unique(mergedRows.map((row) => row.promoted_catalog_identity_id)).length,
    reviewed_field_count: reviewedFieldCount(mergedRows),
    reference_image_count: referenceImageCount(confirmedRows),
    hard_negative_count: hardNegativeRows(writerReport).length,
    external_to_internal_promotion_count: externalPromotionCount(mergedRows),
    repeat_match_rate: rate(repeatMatchCount(mergedRows), mergedRows.length),
    source_trust_breakdown: trustMetrics.source_trust_breakdown,
    forbidden_usage_violation_count: trustMetrics.forbidden_usage_violation_count,
    serial_grade_cert_copy_violation_count: trustMetrics.serial_grade_cert_copy_violation_count,
    marketplace_pollution_count: trustMetrics.marketplace_pollution_count
  };

  const report = {
    schema_version: "catalog-cold-start-flywheel-report-v0",
    generated_at: now.toISOString(),
    inputs: {
      gap_queue_path: gapQueuePath,
      cold_start_report_path: coldStartReportPath || null,
      external_report_path: externalReportPath || null,
      writer_confirmations_path: writerConfirmationsPath || null
    },
    policy: {
      external_directories_used_as_truth: false,
      ebay_titles_used_as_ground_truth: false,
      ebay_titles_sent_to_prompt: false,
      renderer_still_generates_final_title: true,
      writer_review_required_for_internal_catalog_promotion: true,
      serial_grade_cert_external_copy_allowed: false
    },
    metrics,
    rows: mergedRows.map((row) => ({
      client_gap_key: row.client_gap_key || "",
      asset_id: row.asset_id || "",
      cold_start_status: row.cold_start_status || "",
      ai_draft_title: row.ai_draft_title || "",
      writer_final_title: row.writer_final_title || null,
      promotion_status: row.promotion_status || "pending",
      selected_candidate_id: row.selected_candidate_id || null,
      selected_candidate_source_trust: normalizeSourceTrust(selectedCandidate(row)?.source_trust || "", ""),
      external_candidate_count: (row.external_candidates || []).length,
      marketplace_hint_count: (row.marketplace_hints || []).length,
      high_risk_fields: row.high_risk_fields || [],
      field_diff_count: (row.field_diff || []).length
    }))
  };
  if (outPath) await writeJson(outPath, report);
  if (markdownOutPath) await writeMarkdown(markdownOutPath, report);
  return report;
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeMarkdown(path, report) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  const lines = [
    "# Catalog Cold-Start Flywheel Report",
    "",
    "Policy: external directories and marketplace data are candidate/reference signals only. Internal catalog promotion requires writer review.",
    "",
    ...Object.entries(report.metrics).map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`),
    "",
    "## Per Gap",
    "",
    "| asset_id | status | external candidates | selected trust | promotion | field diffs |",
    "|---|---|---:|---|---|---:|",
    ...report.rows.map((row) => `| ${row.asset_id} | ${row.cold_start_status} | ${row.external_candidate_count} | ${row.selected_candidate_source_trust || ""} | ${row.promotion_status} | ${row.field_diff_count} |`)
  ];
  await writeFile(resolved, `${lines.join("\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildCatalogColdStartFlywheelReport({
    gapQueuePath: argValue(process.argv, "--gap-queue"),
    coldStartReportPath: argValue(process.argv, "--cold-start-report", ""),
    externalReportPath: argValue(process.argv, "--external-report", ""),
    writerConfirmationsPath: argValue(process.argv, "--writer-confirmations", ""),
    outPath: argValue(process.argv, "--out", defaultOutPath),
    markdownOutPath: argValue(process.argv, "--markdown-out", "")
  }).then((report) => {
    process.stdout.write(`${JSON.stringify(report.metrics, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
