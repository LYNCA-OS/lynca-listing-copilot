import assert from "node:assert/strict";
import {
  applyIndependentIdentityLabels,
  auditIndependentIdentityReviewPacket,
  buildIndependentIdentityReviewPacket,
  validateIndependentIdentityLabel
} from "../lib/listing/evaluation/independent-identity-truth.mjs";

const item = {
  item_id: "item-1",
  source_feedback_id: "feedback-1",
  parser_suggestion: { fields: { year: "2025", manufacturer: "Topps", product: "Topps Chrome", subject: ["Jane Doe"] } },
  retrieval_ground_truth: { retrieval_evaluable: true, accepted_candidate_ids: ["official-1"] }
};
const official = {
  id: "official-1",
  season_year: "2025",
  manufacturer: "Topps",
  product: "Topps Chrome",
  players: ["Jane Doe"],
  source: { id: "source-1", source_type: "TOPPS_OFFICIAL_CHECKLIST", source_metadata: {} }
};
const self = {
  ...official,
  id: "self-1",
  source: { id: "self-source", source_type: "INTERNAL_CORRECTED_TITLE", source_metadata: {
    writer_title_batch_id: "batch", source_feedback_id: "feedback-1"
  } }
};
const packet = buildIndependentIdentityReviewPacket(
  { generated_at: "2026-07-23T00:00:00.000Z", items: [item] },
  { partitions: { development: ["item-1"], validation: [], holdout: [] } },
  { schema_version: "catalog-v1", cards: [official, self] },
  { generatedAt: "2026-07-23T00:00:00.000Z" }
);
assert.equal(packet.items.length, 1);
assert.equal(packet.items[0].label.status, "CONFIRMED");
assert.equal(packet.items[0].label.source_candidate_id, "official-1");
assert.match(packet.items[0].label.canonical_identity_id, /^card_identity:[a-f0-9]{64}$/);
assert.equal(packet.items[0].candidate_proposals.some((candidate) => candidate.source_candidate_id === "self-1"), false);
assert.equal(packet.policy.holdout_excluded, true);
const audit = auditIndependentIdentityReviewPacket(packet, { cards: [official, self] });
assert.equal(audit.counts.development.valid, 1);
assert.equal(audit.gate.passed, false);
const labeled = applyIndependentIdentityLabels({ items: [item] }, packet, { cards: [official, self] });
assert.equal(labeled.items.length, 1);
assert.equal(labeled.items[0].retrieval_ground_truth.retrieval_evaluable, true);
assert.deepEqual(labeled.items[0].retrieval_ground_truth.accepted_candidate_ids, ["official-1"]);
assert.deepEqual(labeled.items[0].retrieval_ground_truth.accepted_identity_ids, [packet.items[0].label.canonical_identity_id]);
const invalidSelf = validateIndependentIdentityLabel({
  ...packet.items[0].label,
  source_candidate_id: "self-1",
  source: { ...packet.items[0].label.source, source_id: "self-source" }
}, { item, catalogById: new Map([["self-1", self]]) });
assert.equal(invalidSelf.valid, false);
assert(invalidSelf.errors.includes("SAME_FEEDBACK_SELF_CORROBORATION"));
console.log("independent identity truth tests passed");
