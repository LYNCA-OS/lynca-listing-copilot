import assert from "node:assert/strict";

import { buildCandidateSelectionPass } from "../lib/listing/candidates/candidate-selection-pass.mjs";
import { applyCandidateDecisionStage } from "../lib/listing/candidates/candidate-decision-stage.mjs";

// Layer B: a high-trust OFFICIAL_CHECKLIST catalog candidate may CORRECT a
// mis-identified product ("Chrome Black" for a Cardsmiths Smugglers card), but
// only under collision-proof conditions that anchor agreement alone cannot
// provide (two genuinely different products can share subject + year + serial):
//   (1) the observed product has no catalog support, and
//   (2) the anchored high-trust candidates map to a single product family.

function packet(candidates = []) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates,
      assist_filter: {
        raw_candidate_count: candidates.length,
        approved_candidate_count: candidates.length,
        prompt_candidate_count: candidates.length,
        prompt_candidate_ids: candidates.map((candidate) => candidate.candidate_id)
      }
    }
  };
}

function officialCandidate(id, fields) {
  return {
    candidate_id: id,
    candidate_identity_id: `${id}-identity`,
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "OFFICIAL_CHECKLIST",
    match_score: 0.9,
    fields
  };
}

function correctionFor(observed, candidates) {
  return buildCandidateSelectionPass({
    result: { resolved_fields: observed, catalog_candidate_packet: packet(candidates) }
  }).selected_candidate_product_correction;
}

// 1. Positive: provider mis-reads the product but reads player + serial + year
//    correctly; the official Smugglers row is anchored and unique → correct it.
const observedMisread = { year: "2023", product: "Chrome Black", players: ["Paul Kasey"], serial_number: "12/25" };
const smugglers = officialCandidate("smugglers", {
  year: "2023",
  manufacturer: "Cardsmiths",
  product: "Cardsmiths Smugglers",
  players: ["Paul Kasey"],
  expected_serial_denominator: "25"
});
const positive = correctionFor(observedMisread, [smugglers]);
assert.equal(positive.status, "ready_product_correction", "an unsupported observed product with a single anchored family must be corrected");
assert.equal(positive.candidate_id, "smugglers");
assert.equal(positive.product_fields.product, "Cardsmiths Smugglers");

const decided = applyCandidateDecisionStage({
  result: { resolved_fields: observedMisread, catalog_candidate_packet: packet([smugglers]), ...buildCandidateSelectionPass({ result: { resolved_fields: observedMisread, catalog_candidate_packet: packet([smugglers]) } }) },
  resolvedBefore: observedMisread
});
assert.equal(decided.resolved_after.product, "Cardsmiths Smugglers", "the mis-identified product must be overwritten in the resolved fields");
assert.equal(decided.resolved_after.manufacturer, "Cardsmiths");
assert.ok(decided.field_application.product_correction_fields.includes("product"));
assert.equal(decided.field_application.reason_per_field.product, "trusted_official_checklist_product_correction_replace");

// 2. Safety — observed product IS real (supported) and two families exist. A
//    player can own both a Topps Chrome /50 and a Bowman Chrome Sapphire /50 in
//    the same season: the observed "Topps Chrome" must never be overwritten.
const wemby = { year: "2025-26", product: "Topps Chrome", players: ["Victor Wembanyama"], serial_number: "10/50" };
assert.equal(
  correctionFor(wemby, [
    officialCandidate("tc", { year: "2025-26", manufacturer: "Topps", product: "Topps Chrome", players: ["Victor Wembanyama"], expected_serial_denominator: "50" }),
    officialCandidate("bcs", { year: "2025-26", manufacturer: "Topps", product: "Bowman Chrome Sapphire", players: ["Victor Wembanyama"], expected_serial_denominator: "50" })
  ]).status,
  "not_applicable",
  "a supported observed product with multiple anchored families must not be corrected"
);

// 3. Safety — no serial agreement (exact code alone is collision-prone). The
//    candidate is not anchored, so the observed product stays untouched.
const paniniLike = { year: "2024", product: "Panini Prizm", players: ["Test Player"], collector_number: "CPA-TP" };
assert.equal(
  correctionFor(paniniLike, [
    officialCandidate("tc", { year: "2024", manufacturer: "Topps", product: "Topps Chrome", players: ["Test Player"], collector_number: "CPA-TP" })
  ]).status,
  "not_applicable",
  "an exact-code match without serial agreement must not authorise a product correction"
);

// 4. Safety — the anchored candidates disagree on the product family (ambiguous).
const ambiguous = { year: "2023", product: "Fake Product", players: ["Paul Kasey"], serial_number: "12/25" };
assert.equal(
  correctionFor(ambiguous, [
    officialCandidate("a", { year: "2023", manufacturer: "Cardsmiths", product: "Cardsmiths Smugglers", players: ["Paul Kasey"], expected_serial_denominator: "25" }),
    officialCandidate("b", { year: "2023", manufacturer: "Topps", product: "Topps Chrome", players: ["Paul Kasey"], expected_serial_denominator: "25" })
  ]).status,
  "not_applicable",
  "ambiguous anchored product families must not be corrected"
);

// 5. Safety — a low-trust (marketplace) source can never drive a correction.
assert.equal(
  correctionFor(observedMisread, [{
    candidate_id: "mk",
    source_type: "MARKETPLACE",
    source_trust: "MARKETPLACE",
    match_score: 0.9,
    fields: { year: "2023", product: "Cardsmiths Smugglers", players: ["Paul Kasey"], expected_serial_denominator: "25" }
  }]).status,
  "not_applicable",
  "a low-trust source must not authorise a product correction"
);

// 6. Safety — no correction object leaks into a normal fill-missing decision.
const clean = { year: "2023", product: "Cardsmiths Smugglers", players: ["Paul Kasey"], serial_number: "12/25" };
assert.equal(correctionFor(clean, [smugglers]).status, "not_applicable", "a matching observed product needs no correction");

console.log("product correction tests passed");
