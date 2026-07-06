#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function countBy(rows = [], fn = () => "") {
  return rows.reduce((counts, row) => {
    const key = cleanText(fn(row)) || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function topEntries(counts = {}, limit = 12) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function traceRows(item = []) {
  return Array.isArray(item.candidate_application_trace) ? item.candidate_application_trace : [];
}

function fieldEvidenceRows(item = []) {
  return Array.isArray(item.candidate_field_evidence) ? item.candidate_field_evidence : [];
}

function blockedReasons(item = {}) {
  return (Array.isArray(item.selected_candidate_decision?.rejected_candidate_reasons)
    ? item.selected_candidate_decision.rejected_candidate_reasons
    : [])
    .flatMap((row) => Array.isArray(row.reasons) ? row.reasons : [])
    .map(cleanText)
    .filter(Boolean);
}

function selectedCandidateId(item = {}) {
  return cleanText(item.selected_candidate_decision?.selected_candidate_id || "");
}

function candidateRawCount(item = {}) {
  return Number(item.catalog_activation_funnel?.raw_candidate_count || 0)
    + Number(item.vector_activation_funnel?.raw_candidate_count || 0);
}

function candidateApprovedCount(item = {}) {
  return Number(item.catalog_activation_funnel?.approved_candidate_count || 0)
    + Number(item.vector_activation_funnel?.approved_candidate_count || 0);
}

function candidatePromptCount(item = {}) {
  return Number(item.catalog_activation_funnel?.prompt_candidate_count || 0)
    + Number(item.vector_activation_funnel?.prompt_candidate_count || 0);
}

function appliedFieldCount(item = {}) {
  return Number(item.candidate_activation_funnel?.applied_field_count || 0);
}

export function analyzeCandidateActivationFunnel(report = {}) {
  const results = Array.isArray(report.results) ? report.results : [];
  const allTraceRows = results.flatMap(traceRows);
  const allEvidenceRows = results.flatMap(fieldEvidenceRows);
  const reasonCounts = results.flatMap(blockedReasons).reduce((counts, reason) => {
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  const participationLevelDistribution = report.participation_level_counts
    || countBy(results, (item) => item.participation_level || "UNKNOWN");
  const selectedMatchLevelDistribution = report.selected_candidate_match_level_counts
    || countBy(results, (item) => item.selected_candidate_decision?.match_level || "UNKNOWN");

  const perCard = results.map((item) => ({
    candidate_id: item.candidate_id,
    participation_level: item.participation_level || "",
    selected_candidate_id: selectedCandidateId(item),
    selected_match_level: item.selected_candidate_decision?.match_level || "",
    selection_confidence: item.selected_candidate_decision?.selection_confidence ?? null,
    selection_margin: item.selected_candidate_decision?.selection_margin ?? null,
    raw_candidate_count: candidateRawCount(item),
    approved_candidate_count: candidateApprovedCount(item),
    prompt_candidate_count: candidatePromptCount(item),
    evidence_field_count: fieldEvidenceRows(item).length,
    applied_field_count: appliedFieldCount(item),
    catalog_raw_candidate_count: Number(item.catalog_activation_funnel?.raw_candidate_count || 0),
    catalog_prompt_candidate_count: Number(item.catalog_activation_funnel?.prompt_candidate_count || 0),
    vector_raw_candidate_count: Number(item.vector_activation_funnel?.raw_candidate_count || 0),
    vector_prompt_candidate_count: Number(item.vector_activation_funnel?.prompt_candidate_count || 0),
    pre_observation_candidate_count: Number(item.pre_observation_candidate_count || 0),
    post_observation_candidate_count: Number(item.post_observation_candidate_count || 0),
    post_observation_selected_candidate_id: item.post_observation_selected_candidate_id || "",
    blocked_reasons: [...new Set(blockedReasons(item))],
    final_title: item.final_evaluated_title || item.scored_title || item.title || "",
    reference_title: item.corrected_title_reference || "",
    token_recall: item.corrected_title_comparison?.token_recall ?? null
  }));

  return {
    report_path: report.__path || "",
    generated_at: new Date().toISOString(),
    source_report_generated_at: report.generated_at || "",
    base_url: report.base_url || "",
    provider: report.provider || "",
    target_count: report.target_count ?? results.length,
    evaluated_count: report.evaluated_count ?? results.length,
    participation_level_distribution: participationLevelDistribution,
    selected_match_level_distribution: selectedMatchLevelDistribution,
    raw_but_no_approved_count: results.filter((item) => candidateRawCount(item) > 0 && candidateApprovedCount(item) === 0).length,
    approved_but_no_prompt_count: results.filter((item) => candidateApprovedCount(item) > 0 && candidatePromptCount(item) === 0).length,
    prompt_but_no_application_count: results.filter((item) => candidatePromptCount(item) > 0 && appliedFieldCount(item) === 0).length,
    application_but_no_title_change_count: results.filter((item) => appliedFieldCount(item) > 0 && item.candidate_activation_funnel?.title_changed !== true).length,
    selected_candidate_count: results.filter((item) => selectedCandidateId(item)).length,
    candidate_application_trace_count: allTraceRows.length,
    candidate_field_evidence_count: allEvidenceRows.length,
    can_apply_evidence_count: allEvidenceRows.filter((row) => row.permission === "can_apply").length,
    support_only_evidence_count: allEvidenceRows.filter((row) => row.permission === "support_only").length,
    suggest_only_evidence_count: allEvidenceRows.filter((row) => row.permission === "suggest_only").length,
    post_observation_retrieval_gain: {
      post_observation_candidate_count: results.reduce((sum, item) => sum + Number(item.post_observation_candidate_count || 0), 0),
      post_observation_selected_candidate_count: results.filter((item) => cleanText(item.post_observation_selected_candidate_id)).length,
      retrieval_used_observation_fields: [...new Set(results.flatMap((item) => (
        Array.isArray(item.retrieval_used_observation_fields) ? item.retrieval_used_observation_fields : []
      )))]
    },
    vector_lazy_skip_regression_candidates: results
      .filter((item) => item.vector_lazy_skip === true && Number(item.corrected_title_comparison?.token_recall || 0) < Number(item.raw_corrected_title_comparison?.token_recall || 0))
      .map((item) => item.candidate_id),
    most_common_blocked_reasons: topEntries(reasonCounts),
    per_card: perCard
  };
}

async function main(argv = process.argv) {
  const reportPath = argv[2] || "";
  if (!reportPath) throw new Error("Usage: node scripts/analyze-candidate-activation-funnel.mjs <cloud-eval-report.json>");
  const report = await readJson(reportPath);
  report.__path = reportPath;
  const analysis = analyzeCandidateActivationFunnel(report);
  process.stdout.write(JSON.stringify(analysis, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`candidate activation funnel analysis failed: ${error.message}`);
    process.exit(1);
  });
}

