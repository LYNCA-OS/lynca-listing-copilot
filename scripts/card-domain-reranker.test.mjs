import assert from "node:assert/strict";
import {
  buildCardDomainEmbedding,
  cardDomainEmbeddingSimilarity,
  cardDomainRerankerContract,
  rankCardDomainCandidates
} from "../lib/listing/retrieval/card-domain-reranker.mjs";
import {
  buildCandidatePreApplicationEvidenceSnapshot,
  buildCandidateSelectionPass as buildCandidateSelectionPassImpl
} from "../lib/listing/candidates/candidate-selection-pass.mjs";
import { buildV4CandidateControlPlaneTrace } from "../lib/listing/v4/candidates/control-plane-adapter.mjs";

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
  const current = result.raw_observed_fields
    || result.raw_provider_fields
    || result.resolved_fields
    || result.resolved
    || result.fields
    || {};
  const prepared = {
    ...result,
    current_image_context: result.current_image_context || candidateTestImageContext,
    evidence_schema_version: result.evidence_schema_version || "candidate-test-evidence-v1",
    raw_observed_fields: result.raw_observed_fields || current,
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

const observed = {
  year: "2024",
  manufacturer: "Topps",
  product: "Topps Chrome",
  players: ["Shohei Ohtani"],
  checklist_code: "TC-136",
  serial_denominator: "50",
  surface_color: "sparkling gold"
};

const candidates = [
  {
    candidate_id: "visual-lookalike",
    candidate_identity_id: "wrong-card",
    source_type: "VISUAL_VECTOR",
    source_trust: "VISUAL_ONLY",
    similarity: 0.995,
    __decision_eligible: true,
    fields: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Mike Trout"],
      checklist_code: "TC-136",
      serial_denominator: "25",
      surface_color: "gold"
    }
  },
  {
    candidate_id: "catalog-identity",
    candidate_identity_id: "correct-card",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    similarity: 0.62,
    __decision_eligible: true,
    anchor_agreement: {
      agreed: ["year", "subjects", "product_hierarchy", "checklist_code", "serial_denominator"],
      contradicted: [],
      exact_code_match: true
    },
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Shohei Ohtani"],
      checklist_code: "TC-136",
      serial_denominator: "50",
      surface_color: "gold"
    }
  }
];

const ranked = rankCardDomainCandidates(candidates, observed, {
  baselineSelectedCandidateId: "visual-lookalike"
});
assert.equal(ranked.schema_version, cardDomainRerankerContract.version);
assert.equal(ranked.mode, "shadow_only");
assert.equal(ranked.top_candidate_id, "catalog-identity");
assert.equal(ranked.top_decision_eligible_candidate_id, "catalog-identity");
assert.equal(ranked.would_change_decision, true);
assert.ok(ranked.ranked_candidates[0].embedding_similarity > ranked.ranked_candidates[1].embedding_similarity);
assert.deepEqual(
  new Set(ranked.ranked_candidates[1].conflicting_fields),
  new Set(["serial_denominator", "subjects", "year"])
);

const gold = buildCardDomainEmbedding({ surface_color: "sparkling gold" });
const plainGold = buildCardDomainEmbedding({ surface_color: "gold" });
assert.equal(cardDomainEmbeddingSimilarity(gold, plainGold), 1, "decorative color adjectives must collapse to the basic color");

const sameDenominator = rankCardDomainCandidates([{
  candidate_id: "same-denominator",
  source_type: "OFFICIAL_CHECKLIST",
  source_trust: "OFFICIAL_CHECKLIST",
  __decision_eligible: true,
  fields: { serial_denominator: "50" }
}], { serial_number: "12/50" });
assert.equal(sameDenominator.ranked_candidates[0].conflicting_fields.length, 0);
assert.ok(sameDenominator.ranked_candidates[0].exact_anchor_score > 0);

const missingQueryFields = rankCardDomainCandidates([{
  candidate_id: "candidate-with-extra-fields",
  source_type: "OFFICIAL_CHECKLIST",
  source_trust: "OFFICIAL_CHECKLIST",
  __decision_eligible: true,
  fields: { year: "2024", product: "Topps Chrome", players: ["Shohei Ohtani"] }
}], { year: "2024" });
assert.deepEqual(missingQueryFields.ranked_candidates[0].conflicting_fields, [], "missing query fields must not manufacture conflicts");

const lowCoverageAnchorConsensus = rankCardDomainCandidates([{
  candidate_id: "trusted-low-coverage",
  source_type: "INTERNAL_APPROVED_HISTORY",
  source_trust: "APPROVED_REFERENCE",
  __decision_eligible: true,
  anchor_agreement: {
    agreed: ["year", "subjects", "manufacturer", "product_hierarchy"],
    contradicted: []
  },
  fields: { year: "2024", product: "Topps", players: ["Test Player"] }
}], {
  year: "2024",
  product: "Topps Chrome Sapphire Update",
  set: "Rookie Autographs",
  players: ["Test Player"],
  manufacturer: "Topps",
  surface_color: "Orange"
});
assert.equal(lowCoverageAnchorConsensus.top_decision_eligible_candidate_id, "trusted-low-coverage", "four trusted agreeing anchors must waive sparse query coverage");

const authoritativeIdentity = rankCardDomainCandidates([
  {
    candidate_id: "higher-soft-score",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    __decision_eligible: true,
    similarity: 0.99,
    anchor_agreement: { agreed: ["year", "subjects", "manufacturer", "product_hierarchy"], contradicted: [] },
    fields: { year: "2024", product: "Topps Chrome", players: ["Test Player"] }
  },
  {
    candidate_id: "reviewed-current-source",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    __decision_eligible: true,
    anchor_agreement: {
      agreed: ["year", "subjects", "manufacturer", "product_hierarchy"],
      contradicted: [],
      authoritative_overrides: ["reviewed_current_source_identity_match"]
    },
    fields: { year: "2024", product: "Topps", players: ["Test Player"] }
  }
], { year: "2024", product: "Topps Chrome", players: ["Test Player"] });
assert.equal(authoritativeIdentity.top_decision_eligible_candidate_id, "reviewed-current-source", "reviewed current-source identity must outrank a soft similarity lead");

const authoritativeObservationCorrection = rankCardDomainCandidates([
  {
    candidate_id: "reviewed-corrects-observation",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    __decision_eligible: true,
    anchor_agreement: {
      agreed: ["subjects", "manufacturer", "product_hierarchy", "serial_denominator", "year"],
      contradicted: [],
      authoritative_overrides: ["reviewed_current_source_identity_match"]
    },
    fields: {
      year: "2024-25",
      product: "Topps Chrome",
      players: ["Victor Wembanyama"],
      serial_denominator: "50",
      parallel_exact: "Gold Refractor"
    }
  },
  {
    candidate_id: "soft-observation-match",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    __decision_eligible: true,
    anchor_agreement: {
      agreed: ["year", "subjects", "manufacturer", "product_hierarchy"],
      contradicted: []
    },
    fields: { year: "2025", product: "Topps Chrome", players: ["Victor Wembanyama"], collector_number: "RS-2" }
  }
], {
  year: "2025-26",
  product: "Topps Chrome",
  players: ["Victor Wembanyama"],
  serial_denominator: "50",
  parallel_exact: "Gold Refractor"
});
assert.equal(
  authoritativeObservationCorrection.top_decision_eligible_candidate_id,
  "reviewed-corrects-observation",
  "reviewed current-source identity may correct a conflicting raw observation when no direct evidence conflict exists"
);
assert.equal(authoritativeObservationCorrection.ranked_candidates[0].authoritative_observation_correction, true);

const authoritativeDirectConflict = rankCardDomainCandidates([{
  candidate_id: "reviewed-with-direct-conflict",
  source_type: "INTERNAL_APPROVED_HISTORY",
  source_trust: "APPROVED_REFERENCE",
  __decision_eligible: true,
  conflicting_fields: ["serial_denominator"],
  anchor_agreement: {
    agreed: ["subjects", "manufacturer", "product_hierarchy"],
    contradicted: ["serial_denominator"],
    authoritative_overrides: ["reviewed_current_source_identity_match"]
  },
  fields: { year: "2024", product: "Topps Chrome", players: ["Test Player"], serial_denominator: "25" }
}], { year: "2025", product: "Topps Chrome", players: ["Test Player"], serial_denominator: "50" });
assert.equal(authoritativeDirectConflict.top_decision_eligible_candidate_id, "", "direct evidence conflicts must not be waived by authority");

const marketplace = rankCardDomainCandidates([
  {
    candidate_id: "marketplace",
    source_type: "MARKETPLACE",
    source_trust: "MARKETPLACE",
    __decision_eligible: true,
    fields: observed
  },
  {
    candidate_id: "official",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "OFFICIAL_CHECKLIST",
    __decision_eligible: true,
    fields: observed
  }
], observed);
assert.equal(marketplace.top_candidate_id, "official");

function packet(rows, promptIds) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates: rows,
      assist_filter: {
        raw_candidate_count: rows.length,
        approved_candidate_count: rows.length,
        prompt_candidate_count: promptIds.length,
        prompt_candidate_ids: promptIds
      }
    }
  };
}

const baselineCandidate = {
  ...candidates[1],
  candidate_id: "baseline-catalog",
  match_score: 0.8
};
const selection = buildCandidateSelectionPass({
  result: {
    resolved_fields: observed,
    catalog_candidate_packet: packet([baselineCandidate], ["baseline-catalog"]),
    vector_candidate_packet: packet([candidates[0]], ["visual-lookalike"])
  }
});
assert.equal(selection.selected_candidate_decision.selected_candidate_id, "baseline-catalog");
assert.equal(selection.card_domain_reranker_shadow.mode, "shadow_only");
assert.equal(selection.card_domain_reranker_shadow.baseline_selected_candidate_id, "baseline-catalog");
assert.equal(selection.card_domain_reranker_shadow.top_decision_eligible_candidate_id, "baseline-catalog");
const v4Trace = buildV4CandidateControlPlaneTrace(selection);
assert.equal(v4Trace.shadow_reranker, null, "the domain shadow must not overwrite the existing learned-shadow telemetry slot");
assert.equal(v4Trace.card_domain_reranker.model_id, cardDomainRerankerContract.embedding);
assert.equal(v4Trace.card_domain_reranker.selected_candidate_id, "baseline-catalog");
assert.equal(v4Trace.card_domain_reranker.production_decision_affected, false);

console.log("card domain reranker tests passed");
