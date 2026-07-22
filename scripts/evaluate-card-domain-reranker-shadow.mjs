import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";
import { scoreReviewedTitleSemProjection } from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";
import { rankCardDomainCandidates } from "../lib/listing/retrieval/card-domain-reranker.mjs";

const { values: args } = parseArgs({
  options: {
    report: { type: "string" },
    dataset: { type: "string", default: "data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json" },
    out: { type: "string" }
  }
});

if (!args.report) throw new Error("--report is required");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function selectedIdentityId(value = "") {
  return cleanText(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

function average(values = []) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(6)) : null;
}

const reportPath = path.resolve(args.report);
const datasetPath = path.resolve(args.dataset);
const [report, dataset] = await Promise.all([
  fs.readFile(reportPath, "utf8").then(JSON.parse),
  fs.readFile(datasetPath, "utf8").then(JSON.parse)
]);
const seedItems = Array.isArray(dataset.items) ? dataset.items : [];
const byFeedbackId = new Map(seedItems.map((item) => [cleanText(item.source_feedback_id), item]));
const retrievalCandidates = seedItems.map((item) => ({
  candidate_id: cleanText(item.source_feedback_id),
  candidate_identity_id: cleanText(item.source_feedback_id),
  source_type: "INTERNAL_APPROVED_HISTORY",
  source_trust: "REVIEWED_INTERNAL",
  __decision_eligible: true,
  fields: parseReviewedTitleFields(item.source_titles?.corrected_title || "")
}));

const rows = (Array.isArray(report.results) ? report.results : []).map((row) => {
  const sourceItem = byFeedbackId.get(cleanText(row.source_feedback_id));
  const referenceTitle = cleanText(sourceItem?.source_titles?.corrected_title || row.seller_title);
  const observedFields = {
    ...(row.resolved_fields || {}),
    ...(row.l2_candidate_debug?.candidate_observation_snapshot || {})
  };
  const baselineId = selectedIdentityId(row.l2_candidate_debug?.selected_candidate_id);
  const domain = rankCardDomainCandidates(retrievalCandidates, observedFields, {
    baselineSelectedCandidateId: baselineId,
    limit: 3
  });
  const domainItem = byFeedbackId.get(domain.top_decision_eligible_candidate_id);
  const baselineItem = byFeedbackId.get(baselineId);
  const domainTitle = cleanText(domainItem?.source_titles?.corrected_title);
  const baselineTitle = cleanText(baselineItem?.source_titles?.corrected_title);
  const domainSem = referenceTitle && domainTitle
    ? scoreReviewedTitleSemProjection({ referenceTitle, finalTitle: domainTitle })
    : null;
  const baselineSem = referenceTitle && baselineTitle
    ? scoreReviewedTitleSemProjection({ referenceTitle, finalTitle: baselineTitle })
    : null;
  return {
    source_feedback_id: cleanText(row.source_feedback_id),
    reference_title: referenceTitle,
    observed_fields: observedFields,
    baseline_candidate_id: baselineId,
    baseline_candidate_title: baselineTitle,
    baseline_sem_weighted_accuracy: baselineSem?.weighted_accuracy ?? null,
    domain_candidate_id: domain.top_decision_eligible_candidate_id,
    domain_candidate_title: domainTitle,
    domain_sem_weighted_accuracy: domainSem?.weighted_accuracy ?? null,
    domain_sem_accepted: domainSem?.accepted === true,
    exact_source_identity_match: domain.top_decision_eligible_candidate_id === cleanText(row.source_feedback_id),
    would_change_decision: domain.would_change_decision,
    domain_shadow: domain
  };
});

const comparable = rows.filter((row) => Number.isFinite(row.baseline_sem_weighted_accuracy) && Number.isFinite(row.domain_sem_weighted_accuracy));
const output = {
  schema_version: "card-domain-reranker-offline-shadow-eval-v1",
  generated_at: new Date().toISOString(),
  evidence_scope: "offline diagnostic only; reviewed titles are title-level references and are not promoted to runtime field ground truth",
  report_path: reportPath,
  dataset_path: datasetPath,
  summary: {
    row_count: rows.length,
    comparable_baseline_row_count: comparable.length,
    domain_exact_source_identity_count: rows.filter((row) => row.exact_source_identity_match).length,
    domain_sem_accepted_count: rows.filter((row) => row.domain_sem_accepted).length,
    domain_would_change_count: rows.filter((row) => row.would_change_decision).length,
    baseline_sem_weighted_accuracy_avg: average(comparable.map((row) => row.baseline_sem_weighted_accuracy)),
    domain_sem_weighted_accuracy_avg: average(rows.map((row) => row.domain_sem_weighted_accuracy)),
    comparable_domain_sem_weighted_accuracy_avg: average(comparable.map((row) => row.domain_sem_weighted_accuracy)),
    comparable_improved_count: comparable.filter((row) => row.domain_sem_weighted_accuracy > row.baseline_sem_weighted_accuracy).length,
    comparable_tied_count: comparable.filter((row) => row.domain_sem_weighted_accuracy === row.baseline_sem_weighted_accuracy).length,
    comparable_regressed_count: comparable.filter((row) => row.domain_sem_weighted_accuracy < row.baseline_sem_weighted_accuracy).length
  },
  rows
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (args.out) await fs.writeFile(path.resolve(args.out), serialized, "utf8");
process.stdout.write(`${JSON.stringify(output.summary, null, 2)}\n`);
