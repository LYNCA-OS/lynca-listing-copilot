import assert from "node:assert/strict";
import { buildEvidenceFailureTaxonomy } from "../lib/listing/evaluation/evidence-failure-taxonomy.mjs";

const dataset = { items: [{ id: "one", category: "sports" }] };
const audit = { cards: [{ query_card_id: "one", fields: {
  product: { truth: "Topps Chrome UFC", evidence_seen: false },
  subject: { truth: ["Patrick Mix"], evidence_seen: false },
  print_finish: { truth: "X-Fractor", evidence_seen: false }
} }] };
const trace = { cards: [{ query_card_id: "one", recognition_ok: true, evidence_observations: [
  { source: "GPT_5_MINI_OBSERVATION", fields: {} },
  { source: "GOOGLE_VISION_OCR", raw_text: "Topps Chrome UFC" }
] }] };
const smoke = { results: [{ source_feedback_id: "one", ok: true, preingestion_ocr_rendezvous: {
  job_observability: [{ status: "SUCCEEDED", crop_role: "subject_crop" }],
  raw_ocr_observations: [{ raw_text: "Topps Chrome UFC" }]
} }] };

smoke.results.unshift({
  source_feedback_id: "one",
  ok: true,
  l2_candidate_debug: {
    selected_candidate_id: "selected-1",
    candidate_application_trace: [{ candidate_id: "selected-1" }]
  }
});
trace.cards[0].selected_candidate_id = "selected-1";
trace.cards[0].retrieval_candidates = [{ candidate_id: "selected-1" }];

const report = buildEvidenceFailureTaxonomy({ dataset, audit, trace, smoke, generatedAt: "2026-07-23T00:00:00.000Z" });
assert.equal(report.summary.missing_field_count, 3);
assert.equal(report.failures.find((row) => row.field === "product").category, "NORMALIZATION_DROPPED");
assert.equal(report.failures.find((row) => row.field === "subject").category, "OCR_MISSED");
assert.equal(report.failures.find((row) => row.field === "print_finish").category, "VISION_OBSERVATION_MISSED");
assert.equal(report.policy.holdout_is_read_only, true);
console.log("evidence failure taxonomy tests passed");
