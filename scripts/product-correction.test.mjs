import assert from "node:assert/strict";

import {
  buildCandidatePreApplicationEvidenceSnapshot,
  buildCandidateSelectionPass as buildCandidateSelectionPassImpl
} from "../lib/listing/candidates/candidate-selection-pass.mjs";
import { applyCandidateDecisionStage } from "../lib/listing/candidates/candidate-decision-stage.mjs";

const candidateTestImageContext = Object.freeze({
  tenant_id: "tenant_candidate_test",
  asset_id: "asset-candidate-test",
  image_generation_id: "asset-candidate-test",
  images: [{
    image_id: "front",
    object_path: "tenants/tenant_candidate_test/listing-assets/2026-07-30/asset-candidate-test/front.jpg",
    content_sha256: "1".repeat(64),
    tenant_id: "tenant_candidate_test",
    asset_id: "asset-candidate-test",
    image_generation_id: "asset-candidate-test",
    storage_verified: true
  }]
});

function buildCandidateSelectionPass(args = {}) {
  const result = args.result || {};
  const observed = result.raw_observed_fields
    || result.raw_provider_fields
    || result.resolved_fields
    || result.resolved
    || result.fields
    || {};
  const prepared = {
    ...result,
    current_image_context: result.current_image_context || candidateTestImageContext,
    evidence_schema_version: result.evidence_schema_version || "candidate-test-evidence-v1",
    raw_observed_fields: result.raw_observed_fields || observed,
    raw_provider_fields: result.raw_provider_fields || {},
    raw_provider_field_evidence: result.raw_provider_field_evidence || []
  };
  return buildCandidateSelectionPassImpl({
    ...args,
    result: {
      ...prepared,
      candidate_pre_application_evidence_snapshot:
        result.candidate_pre_application_evidence_snapshot
        || buildCandidatePreApplicationEvidenceSnapshot(prepared, prepared.current_image_context)
    }
  });
}

// Product correction is downstream field application. A catalog row retained
// only for trace/shadow must never bypass Candidate decision eligibility.

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

// 1. A generic official row that conflicts with the current-image product is
// retained for diagnosis, but cannot correct the product through a side door.
const observedMisread = { year: "2025", manufacturer: "Topps", product: "Topps Chrome Black Star Wars", players: ["Paul Kasey"], serial_number: "12/25" };
const smugglers = officialCandidate("smugglers", {
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Star Wars Smugglers Outpost",
  set: "Arbitrary First Candidate Set",
  insert: "Arbitrary First Candidate Insert",
  players: ["Paul Kasey"],
  expected_serial_denominator: "25"
});
const positive = correctionFor(observedMisread, [smugglers]);
assert.equal(positive.status, "not_applicable", "a decision-ineligible conflicting candidate must not correct Product");

const decided = applyCandidateDecisionStage({
  result: { resolved_fields: observedMisread, catalog_candidate_packet: packet([smugglers]), ...buildCandidateSelectionPass({ result: { resolved_fields: observedMisread, catalog_candidate_packet: packet([smugglers]) } }) },
  resolvedBefore: observedMisread
});
assert.equal(decided.resolved_after.product, "Topps Chrome Black Star Wars", "a rejected catalog row must not overwrite the observed product");
assert.equal(decided.resolved_after.manufacturer, "Topps");
assert.equal(decided.resolved_after.set, null, "product correction must not copy an arbitrary set from the first same-product row");
assert.equal(decided.resolved_after.insert, null, "product correction must not copy an arbitrary insert from the first same-product row");
assert.deepEqual(decided.field_application.product_correction_fields, []);

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

// 3. Safety — an exact code without subject agreement is not a complete
//    identity lock, so the observed product stays untouched.
const paniniLike = { year: "2024", product: "Panini Prizm", collector_number: "CPA-TP" };
assert.equal(
  correctionFor(paniniLike, [
    officialCandidate("tc", { year: "2024", manufacturer: "Topps", product: "Topps Chrome", players: ["Test Player"], collector_number: "CPA-TP" })
  ]).status,
  "not_applicable",
  "an exact-code match without subject agreement must not authorise a product correction"
);

// 4. Safety — the anchored candidates disagree on the product family (ambiguous).
const ambiguous = { year: "2025", product: "Fake Product", players: ["Paul Kasey"], serial_number: "12/25" };
assert.equal(
  correctionFor(ambiguous, [
    officialCandidate("a", { year: "2025", manufacturer: "Topps", product: "Topps Star Wars Smugglers Outpost", players: ["Paul Kasey"], expected_serial_denominator: "25" }),
    officialCandidate("b", { year: "2025", manufacturer: "Topps", product: "Topps Chrome", players: ["Paul Kasey"], expected_serial_denominator: "25" })
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
    fields: { year: "2025", product: "Topps Star Wars Smugglers Outpost", players: ["Paul Kasey"], expected_serial_denominator: "25" }
  }]).status,
  "not_applicable",
  "a low-trust source must not authorise a product correction"
);

// 6. Safety — no correction object leaks into a normal fill-missing decision.
const clean = { year: "2025", manufacturer: "Topps", product: "Star Wars Smugglers Outpost", players: ["Paul Kasey"], serial_number: "12/25" };
assert.equal(correctionFor(clean, [smugglers]).status, "not_applicable", "a matching observed product needs no correction");

// 7. Exact code remains retrieval/support evidence but cannot independently
// authorise replacement of a conflicting non-empty current-image Product.
const observedExactCode = {
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Chrome Black Star Wars",
  players: ["Paul Kasey"],
  checklist_code: "CB-PK"
};
const exactCodeSmugglers = officialCandidate("smugglers-code", {
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Star Wars Smugglers Outpost",
  players: ["Paul Kasey"],
  checklist_code: "CB-PK"
});
assert.equal(
  correctionFor(observedExactCode, [exactCodeSmugglers]).status,
  "not_applicable",
  "subject + year + exact checklist code must not independently authorise Product replacement"
);

// 8. Regression: an exact-code candidate can remain visible in trace while
// manufacturer/product conflicts make it ineligible. Product Correction must
// consume the same eligibility decision and Resolver must preserve observation.
const conflictingObserved = {
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Chrome",
  players: ["Jane Doe"],
  serial_number: "12/25",
  checklist_code: "JD-12"
};
const conflictingOfficial = officialCandidate("upper-deck-conflict", {
  year: "2025",
  manufacturer: "Upper Deck",
  product: "Series 1",
  players: ["Jane Doe"],
  expected_serial_denominator: "25",
  checklist_code: "JD-12"
});
const conflictingPass = buildCandidateSelectionPass({
  result: {
    resolved_fields: conflictingObserved,
    catalog_candidate_packet: packet([conflictingOfficial])
  }
});
assert.equal(conflictingPass.selected_candidate_decision.match_level, "NO_MATCH");
assert.equal(conflictingPass.selected_candidate_decision.selected_candidate_id, "");
assert.equal(conflictingPass.candidate_application_trace[0].decision_eligible, false);
assert.ok(conflictingPass.candidate_application_trace[0].blocked_fields.includes("manufacturer"));
assert.ok(conflictingPass.candidate_application_trace[0].blocked_fields.includes("product"));
assert.equal(conflictingPass.selected_candidate_product_correction.status, "not_applicable");
const conflictingDecision = applyCandidateDecisionStage({
  result: {
    resolved_fields: conflictingObserved,
    catalog_candidate_packet: packet([conflictingOfficial]),
    ...conflictingPass
  },
  resolvedBefore: conflictingObserved
});
assert.equal(conflictingDecision.resolved_after.manufacturer, "Topps");
assert.equal(conflictingDecision.resolved_after.product, "Topps Chrome");
assert.deepEqual(conflictingDecision.field_application.product_correction_fields, []);

console.log("product correction tests passed");
