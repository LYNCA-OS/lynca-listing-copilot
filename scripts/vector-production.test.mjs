import assert from "node:assert/strict";
import {
  buildVectorCandidateAssistPacket,
  buildVectorCandidatePacket,
  candidateConflictFields,
  vectorCandidatePacketAssistEligibility,
  vectorCandidatePacketHasAssistEligibleCandidates,
  vectorCandidatePacketHasPromptContent
} from "../lib/listing/retrieval/vector-candidate-packet.mjs";
import { vectorRetrievalConfig, vectorRetrievalModes } from "../lib/listing/retrieval/vector-feature-flags.mjs";
import { defaultVisualEmbeddingModelRevision } from "../lib/listing/retrieval/vector-model-defaults.mjs";
import { embedImagesWithVectorWorker } from "../lib/listing/retrieval/vector-worker-client.mjs";
import { recordVectorRetrievalTelemetry } from "../lib/listing/retrieval/vector-telemetry.mjs";
import { visualVectorProvider } from "../lib/listing/retrieval/visual-vector-provider.mjs";
import { openAiProviderResponseSchema } from "../lib/listing/providers/openai-emergency-provider.mjs";
import { validateProviderEvidencePayload } from "../lib/listing/providers/provider-response-normalizer.mjs";
import { evidenceSourceTypes } from "../lib/listing/evidence/evidence-schema.mjs";

function eligibilityStableShape(eligibility = {}) {
  const {
    field_support_count: _fieldSupportCount,
    field_support_fields: _fieldSupportFields,
    ...rest
  } = eligibility;
  return rest;
}

const baseVectorEnv = {
  ENABLE_VECTOR_RETRIEVAL: "true",
  VECTOR_RETRIEVAL_MODE: "assist",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  VECTOR_EMBEDDING_MODEL: "google/siglip2-base-patch16-384",
  VECTOR_EMBEDDING_MODEL_REVISION: defaultVisualEmbeddingModelRevision,
  VECTOR_PREPROCESSING_VERSION: "card-rectification-v1",
  VECTOR_QUERY_TIMEOUT_MS: "1000"
};

assert.equal(vectorRetrievalConfig({}, {}).enabled, false);
assert.equal(vectorRetrievalConfig({}, {}).mode, vectorRetrievalModes.OFF);
assert.equal(vectorRetrievalConfig(baseVectorEnv, {}).mode, vectorRetrievalModes.ASSIST);
assert.equal(vectorRetrievalConfig(baseVectorEnv, { vector_retrieval_mode: "shadow" }).mode, vectorRetrievalModes.SHADOW);

assert.ok(evidenceSourceTypes.includes("VECTOR_APPROVED_REFERENCE"));

const packet = buildVectorCandidatePacket({
  sources: [
    {
      candidate_id: "front-candidate",
      candidate_identity_id: "identity-1",
      source_type: "VISUAL_VECTOR",
      title: "2024 Topps Chrome Tester Gold Refractor 31/50 PSA 10",
      visual_similarity: 0.93,
      match_score: 0.93,
      embedding_role: "front_global",
      reference_image_id: "ref-front",
      embedding_id: "emb-front",
      fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Test Player"],
        parallel_exact: "Gold Refractor",
        serial_number: "31/50",
        grade_company: "PSA",
        card_grade: "10",
        cert_number: "12345678",
        collector_number: "136",
        checklist_code: "TC-136"
      }
    },
    {
      candidate_id: "back-candidate",
      candidate_identity_id: "identity-1",
      source_type: "VISUAL_VECTOR",
      visual_similarity: 0.89,
      match_score: 0.89,
      embedding_role: "back_global",
      reference_image_id: "ref-back",
      embedding_id: "emb-back",
      fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Test Player"],
        serial_number: "12/50",
        collector_number: "136"
      }
    }
  ],
  unavailable: []
}, { limit: 5 });

assert.equal(packet.vector_retrieval.status, "COMPLETED");
assert.equal(packet.vector_retrieval.candidates.length, 1);
assert.equal(packet.vector_retrieval.candidates[0].reference_count, 2);
assert.equal(packet.vector_retrieval.candidates[0].fields.expected_serial_denominator, "50");
assert.equal(packet.vector_retrieval.candidates[0].reference_title, "2024 Topps Chrome Tester Gold Refractor");
assert.equal(packet.vector_retrieval.candidates[0].fields.serial_number, undefined, "reference serial numerator must not enter GPT packet");
assert.equal(packet.vector_retrieval.candidates[0].fields.grade_company, undefined, "reference grade must not enter GPT packet");
assert.equal(packet.vector_retrieval.candidates[0].source_trust, "REFERENCE_CANDIDATE", "visual neighbors are not approved identity candidates by default");
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(packet), false);
assert.deepEqual(eligibilityStableShape(vectorCandidatePacketAssistEligibility(packet)), {
  eligible: false,
  reason: "no_approved_identity_candidate",
  raw_candidate_count: 1,
  approved_candidate_count: 0,
  conflict_blocked_count: 0,
  prompt_candidate_count: 0,
  prompt_candidate_ids: [],
  eligible_candidate_count: 0,
  blocked_candidate_count: 0
});
assert.doesNotMatch(JSON.stringify(packet), /PSA 10|31\/50|12345678|seller|corrected_title/i);

const approvedPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "approved-front",
    candidate_identity_id: "identity-approved",
    source_type: "VISUAL_VECTOR",
    visual_similarity: 0.91,
    match_score: 0.91,
    embedding_role: "front_global",
    reference_image_id: "ref-approved-front",
    embedding_id: "emb-approved-front",
    reference_metadata: { reference_status: "APPROVED" },
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      parallel_exact: "Gold Refractor",
      serial_number: "31/50"
    }
  }]
}, { limit: 5 });
assert.equal(approvedPacket.vector_retrieval.candidates[0].source_trust, "APPROVED_REFERENCE");
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(approvedPacket), true);
assert.equal(vectorCandidatePacketAssistEligibility(approvedPacket).reason, "approved_identity_candidate_available");
assert.deepEqual(buildVectorCandidateAssistPacket(approvedPacket).vector_retrieval.candidates.map((candidate) => candidate.candidate_identity_id), ["identity-approved"]);

const catalogApprovedPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-approved-1",
    candidate_identity_id: "identity-catalog-approved",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_url: "supabase://catalog-cards/identity-catalog-approved",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    supporting_fields: ["subjects", "year", "product", "collector_number", "serial_denominator"],
    matched_fields: ["subjects", "year", "product", "collector_number", "serial_denominator"],
    normalized_score: 0.82,
    fields: {
      year: "2025",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "136",
      serial_number: "31/50",
      grade_company: "PSA",
      card_grade: "10"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Test Player"],
    collector_number: "136",
    serial_number: "12/50"
  }
});
assert.equal(catalogApprovedPacket.vector_retrieval.retrieval_strategy, "catalog_exact_anchor");
assert.equal(catalogApprovedPacket.vector_retrieval.candidates.length, 1);
assert.equal(catalogApprovedPacket.vector_retrieval.candidates[0].source_trust, "APPROVED_REFERENCE");
assert.equal(catalogApprovedPacket.vector_retrieval.candidates[0].fields.expected_serial_denominator, "50");
assert.equal(catalogApprovedPacket.vector_retrieval.candidates[0].fields.serial_number, undefined, "catalog prompt packet must not copy reference serial numerator");
assert.equal(catalogApprovedPacket.vector_retrieval.candidates[0].fields.grade_company, undefined, "catalog prompt packet must not copy reference grade company");
assert.equal(catalogApprovedPacket.vector_retrieval.candidates[0].fields.card_grade, undefined, "catalog prompt packet must not copy reference card grade");
assert.equal(vectorCandidatePacketAssistEligibility(catalogApprovedPacket).prompt_candidate_count, 1);
assert.deepEqual(buildVectorCandidateAssistPacket(catalogApprovedPacket).vector_retrieval.candidates.map((candidate) => candidate.candidate_identity_id), ["identity-catalog-approved"]);

const catalogHierarchySoftConflictPacket = buildVectorCandidatePacket({
  sources: [
    {
      candidate_id: "catalog-hierarchy-soft-1",
      candidate_identity_id: "identity-catalog-hierarchy-soft",
      provider_id: "catalog",
      source_type: "STRUCTURED_DATABASE",
      source_url: "supabase://catalog-cards/identity-catalog-hierarchy-soft",
      source_trust: "APPROVED_REFERENCE",
      supporting_fields: ["players", "year", "product", "serial_denominator"],
      conflicting_fields: ["serial_number", "product"],
      fields: {
        year: "2025-26",
        manufacturer: "Panini",
        product: "Panini Prizm FIFA Soccer",
        set: "Club Legends",
        players: ["Lionel Messi"],
        serial_number: "/199"
      }
    },
    {
      candidate_id: "catalog-hierarchy-soft-duplicate",
      candidate_identity_id: "identity-catalog-hierarchy-soft",
      provider_id: "catalog",
      source_type: "STRUCTURED_DATABASE",
      source_trust: "APPROVED_REFERENCE",
      supporting_fields: ["players", "year", "product", "serial_denominator"],
      fields: {
        year: "2025-26",
        manufacturer: "Panini",
        product: "Panini Prizm FIFA Soccer",
        set: "Club Legends",
        players: ["Lionel Messi"],
        serial_number: "/199"
      }
    }
  ]
}, {
  limit: 5,
  queryFields: {
    year: "2025-26",
    manufacturer: "Panini",
    product: "Prizm FIFA Soccer",
    set: "Club Legends",
    players: ["Lionel Messi"],
    serial_number: "029/199"
  }
});
assert.deepEqual(catalogHierarchySoftConflictPacket.vector_retrieval.candidates[0].conflicting_fields, []);
assert.deepEqual(catalogHierarchySoftConflictPacket.vector_retrieval.candidates[1].conflicting_fields, []);
assert.equal(vectorCandidatePacketAssistEligibility(catalogHierarchySoftConflictPacket).prompt_candidate_count, 1, "duplicate same identity should count as one prompt candidate");
assert.equal(buildVectorCandidateAssistPacket(catalogHierarchySoftConflictPacket).vector_retrieval.candidates.length, 1);

const catalogSeasonYearSoftPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-season-year-soft",
    candidate_identity_id: "identity-catalog-season-year-soft",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    supporting_fields: ["players", "product", "serial_denominator"],
    conflicting_fields: ["year"],
    fields: {
      year: "2025-26",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Victor Wembanyama Spurs"],
      surface_color: "Gold",
      serial_number: "/50"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2024-25",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Victor Wembanyama"],
    surface_color: "Gold",
    serial_number: "17/50"
  }
});
assert.deepEqual(catalogSeasonYearSoftPacket.vector_retrieval.candidates[0].conflicting_fields, []);
assert.deepEqual(catalogSeasonYearSoftPacket.vector_retrieval.candidates[0].soft_conflicting_fields, ["year"]);
assert.equal(vectorCandidatePacketAssistEligibility(catalogSeasonYearSoftPacket).prompt_candidate_count, 0);

const catalogWeakYearConflictPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-weak-year-conflict",
    candidate_identity_id: "identity-catalog-weak-year-conflict",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    supporting_fields: ["product"],
    conflicting_fields: ["year"],
    fields: {
      year: "2025-26",
      product: "Topps Chrome",
      players: ["Wrong Player"],
      serial_number: "/50"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2024-25",
    product: "Topps Chrome",
    players: ["Victor Wembanyama"],
    serial_number: "17/50"
  }
});
assert.deepEqual(catalogWeakYearConflictPacket.vector_retrieval.candidates[0].conflicting_fields.sort(), ["players", "year"]);
assert.equal(vectorCandidatePacketAssistEligibility(catalogWeakYearConflictPacket).reason, "approved_identity_candidate_direct_conflict");

const catalogTemporaryGtPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-temporary-gt",
    candidate_identity_id: "identity-catalog-temporary-gt",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_url: "supabase://catalog-cards/identity-catalog-temporary-gt",
    reference_metadata: {
      retrieval_status: "",
      source_type: "INTERNAL_CORRECTED_TITLE",
      corrected_title_as_temporary_gt: true
    },
    field_derivation: {
      corrected_title_as_temporary_gt: true,
      corrected_title_is_reviewed_title_ground_truth: true,
      title_derived_fields_are_ground_truth: false
    },
    supporting_fields: ["subjects", "year", "product", "collector_number"],
    fields: {
      year: "2025",
      product: "Topps Chrome",
      players: ["Temporary Player"],
      collector_number: "24"
    }
  }]
}, { limit: 5 });
assert.equal(catalogTemporaryGtPacket.vector_retrieval.candidates[0].source_trust, "APPROVED_REFERENCE");
assert.equal(vectorCandidatePacketAssistEligibility(catalogTemporaryGtPacket).prompt_candidate_count, 1);

const catalogCandidateOnlyPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-candidate-only",
    candidate_identity_id: "identity-catalog-candidate-only",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    reference_metadata: { retrieval_status: "candidate" },
    supporting_fields: ["subjects", "year", "product"],
    fields: { year: "2025", product: "Topps Chrome", players: ["Candidate Only"] }
  }]
}, { limit: 5 });
assert.equal(vectorCandidatePacketAssistEligibility(catalogCandidateOnlyPacket).reason, "no_approved_identity_candidate");
assert.equal(buildVectorCandidateAssistPacket(catalogCandidateOnlyPacket).vector_retrieval.candidates.length, 0);

const catalogWeakAnchorApprovedPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-approved-weak-anchor",
    candidate_identity_id: "identity-catalog-approved-weak-anchor",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    supporting_fields: ["year", "brand", "manufacturer"],
    matched_fields: ["year", "brand", "manufacturer"],
    fields: {
      year: "2018-19",
      manufacturer: "Panini",
      product: "Panini Threads",
      players: ["Wrong Player"]
    }
  }]
}, { limit: 5 });
const weakAnchorEligibility = vectorCandidatePacketAssistEligibility(catalogWeakAnchorApprovedPacket);
assert.equal(weakAnchorEligibility.reason, "approved_identity_candidate_missing_identity_anchor");
assert.equal(weakAnchorEligibility.approved_candidate_count, 1);
assert.equal(weakAnchorEligibility.prompt_candidate_count, 0);
assert.equal(buildVectorCandidateAssistPacket(catalogWeakAnchorApprovedPacket).vector_retrieval.candidates.length, 0);

const catalogCollectorSoftConflictPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-collector-soft-conflict",
    candidate_identity_id: "identity-catalog-collector-soft-conflict",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    supporting_fields: ["subjects", "year", "product", "collector_number"],
    matched_fields: ["subjects", "year", "product"],
    fields: {
      year: "2025",
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      collector_number: "BCP-50"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2025",
    product: "Bowman Chrome",
    players: ["Jesus Made"],
    collector_number: "BS-4"
  }
});
// An exact printed-code mismatch is proof of a different card: never soft,
// never in the prompt (anchor hard filter keeps it shadow-only).
assert.deepEqual(catalogCollectorSoftConflictPacket.vector_retrieval.candidates[0].conflicting_fields, ["collector_number"]);
assert.deepEqual(catalogCollectorSoftConflictPacket.vector_retrieval.candidates[0].soft_conflicting_fields, []);
assert.equal(catalogCollectorSoftConflictPacket.vector_retrieval.candidates[0].anchor_agreement.prompt_hard_filter_pass, false);
assert.equal(vectorCandidatePacketAssistEligibility(catalogCollectorSoftConflictPacket).prompt_candidate_count, 0);

const catalogCardNumberSoftConflictPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-card-number-soft-conflict",
    candidate_identity_id: "identity-catalog-card-number-soft-conflict",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    conflicting_fields: ["card_number"],
    supporting_fields: ["subject", "year", "product", "card_number"],
    matched_fields: ["subject", "year", "product"],
    fields: {
      year: "2025",
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      collector_number: "BCP-50"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2025",
    product: "Bowman Chrome",
    players: ["Jesus Made"],
    collector_number: "BS-4"
  }
});
assert.deepEqual(catalogCardNumberSoftConflictPacket.vector_retrieval.candidates[0].conflicting_fields.sort(), ["card_number", "collector_number"]);
assert.deepEqual(catalogCardNumberSoftConflictPacket.vector_retrieval.candidates[0].soft_conflicting_fields, []);
assert.equal(vectorCandidatePacketAssistEligibility(catalogCardNumberSoftConflictPacket).prompt_candidate_count, 0);

// Anchor hard filter: a similar card from the same product line (subject
// agrees, year and serial denominator contradict) must stay shadow-only.
const catalogSimilarCardPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-similar-card",
    candidate_identity_id: "identity-catalog-similar-card",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    supporting_fields: ["subjects", "product"],
    matched_fields: ["subjects", "product"],
    fields: {
      year: "2023-24",
      product: "Panini Prizm",
      players: ["Trae Young"],
      serial_number: "/99"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2018-19",
    product: "Panini Prizm",
    players: ["Trae Young"],
    serial_number: "17/50"
  }
});
const similarCardRow = catalogSimilarCardPacket.vector_retrieval.candidates[0];
assert.equal(similarCardRow.anchor_agreement.prompt_hard_filter_pass, false);
assert.ok(similarCardRow.anchor_agreement.contradicted.includes("year"));
assert.ok(similarCardRow.anchor_agreement.contradicted.includes("serial_denominator"));
assert.equal(vectorCandidatePacketAssistEligibility(catalogSimilarCardPacket).prompt_candidate_count, 0);

// Anchor hard filter: exact printed-code agreement with zero contradictions
// admits the candidate even when only one other anchor dimension overlaps.
const catalogExactCodePacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-exact-code",
    candidate_identity_id: "identity-catalog-exact-code",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    supporting_fields: ["subjects", "collector_number"],
    matched_fields: ["subjects", "collector_number"],
    fields: {
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      collector_number: "BS-4"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    players: ["Jesus Made"],
    collector_number: "BS-4"
  }
});
const exactCodeRow = catalogExactCodePacket.vector_retrieval.candidates[0];
assert.equal(exactCodeRow.anchor_agreement.exact_code_match, true);
assert.equal(exactCodeRow.anchor_agreement.prompt_hard_filter_pass, true);
assert.equal(vectorCandidatePacketAssistEligibility(catalogExactCodePacket).prompt_candidate_count, 1);

const tcgPartialCodePacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "ygopro-partial-code",
    candidate_identity_id: "identity-dark-magician-ct14",
    provider_id: "catalog",
    source_type: "YGOPRODECK_COMMUNITY_API",
    source_trust: "REFERENCE_CANDIDATE",
    reference_metadata: { source_type: "YGOPRODECK_COMMUNITY_API" },
    supporting_fields: ["subjects", "collector_number"],
    matched_fields: ["subjects"],
    fields: {
      product: "Mega-Tins",
      players: ["Dark Magician"],
      collector_number: "CT14-EN001"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    players: ["Dark Magician"],
    collector_number: "EN001"
  }
});
const partialCodeRow = tcgPartialCodePacket.vector_retrieval.candidates[0];
assert.equal(partialCodeRow.anchor_agreement.exact_code_match, false, "TCG suffix match must not become an exact printed-code anchor");
assert.equal(partialCodeRow.anchor_agreement.prompt_hard_filter_pass, false);
assert.ok(partialCodeRow.anchor_agreement.contradicted.includes("collector_number"));
assert.ok(partialCodeRow.conflicting_fields.includes("collector_number"));
assert.equal(vectorCandidatePacketAssistEligibility(tcgPartialCodePacket).prompt_candidate_count, 0);

const catalogManufacturerBrandSoftConflictPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-manufacturer-brand-soft-conflict",
    candidate_identity_id: "identity-catalog-manufacturer-brand-soft-conflict",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    supporting_fields: ["subject", "year", "product", "brand"],
    matched_fields: ["subject", "year", "product", "brand"],
    fields: {
      year: "2025",
      manufacturer: "Bowman",
      product: "Bowman Chrome",
      players: ["Jesus Made"]
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2025",
    manufacturer: "Topps",
    product: "Bowman Chrome",
    players: ["Jesus Made"]
  }
});
assert.equal(catalogManufacturerBrandSoftConflictPacket.vector_retrieval.candidates[0].conflicting_fields.length, 0);
assert.deepEqual(catalogManufacturerBrandSoftConflictPacket.vector_retrieval.candidates[0].soft_conflicting_fields, ["manufacturer"]);
assert.equal(vectorCandidatePacketAssistEligibility(catalogManufacturerBrandSoftConflictPacket).prompt_candidate_count, 0);

const catalogSerialNumeratorSoftConflictPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-serial-numerator-soft-conflict",
    candidate_identity_id: "identity-catalog-serial-numerator-soft-conflict",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
    conflicting_fields: ["serial_number"],
    supporting_fields: ["subjects", "year", "product", "serial_denominator"],
    matched_fields: ["subjects", "year", "product", "serial_denominator"],
    fields: {
      year: "2024",
      product: "Bowman Chrome",
      players: ["Yoshinobu Yamamoto"],
      serial_number: "34/50"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2024",
    product: "Bowman Chrome",
    players: ["Yoshinobu Yamamoto"],
    serial_number: "17/50"
  }
});
assert.equal(catalogSerialNumeratorSoftConflictPacket.vector_retrieval.candidates[0].conflicting_fields.length, 0);
assert.deepEqual(catalogSerialNumeratorSoftConflictPacket.vector_retrieval.candidates[0].soft_conflicting_fields, ["serial_number"]);
assert.equal(vectorCandidatePacketAssistEligibility(catalogSerialNumeratorSoftConflictPacket).prompt_candidate_count, 0);

const marketplaceWeakPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "ebay-weak-title",
    candidate_identity_id: "identity-ebay-weak-title",
    provider_id: "catalog",
    source_type: "MARKETPLACE_REFERENCE",
    source_url: "https://www.ebay.com/itm/123",
    title: "2025 Topps Chrome Seller Title 20/99 PSA 10",
    reference_metadata: {
      retrieval_status: "approved",
      corrected_title_as_temporary_gt: true,
      source_type: "MARKETPLACE_REFERENCE",
      source_provider: "ebay"
    },
    field_derivation: {
      corrected_title_as_temporary_gt: true
    },
    supporting_fields: ["subjects", "year", "product"],
    fields: {
      year: "2025",
      product: "Topps Chrome",
      players: ["Seller Title Player"],
      serial_number: "20/99",
      grade_company: "PSA",
      card_grade: "10"
    }
  }]
}, { limit: 5 });
assert.equal(marketplaceWeakPacket.vector_retrieval.candidates[0].source_trust, "REFERENCE_CANDIDATE");
assert.equal(vectorCandidatePacketAssistEligibility(marketplaceWeakPacket).prompt_candidate_count, 0);
assert.equal(vectorCandidatePacketAssistEligibility(marketplaceWeakPacket).field_support_count, 0);
assert.equal(buildVectorCandidateAssistPacket(marketplaceWeakPacket).vector_retrieval.candidates.length, 0);
assert.equal(vectorCandidatePacketHasPromptContent(buildVectorCandidateAssistPacket(marketplaceWeakPacket)), false);

const communityCatalogFieldSupportPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "pokemon-community-support",
    candidate_identity_id: "pokemon-community-alakazam",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    reference_metadata: {
      retrieval_status: "candidate",
      source_type: "POKEMON_TCG_COMMUNITY_API",
      source_status: "COMMUNITY_API_CANDIDATE"
    },
    supporting_fields: ["year", "product", "players", "collector_number", "rarity"],
    fields: {
      year: "2006",
      manufacturer: "Pokemon",
      product: "Pokemon EX Crystal Guardians",
      players: ["Alakazam"],
      collector_number: "99",
      rarity: "Holo Rare"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2006",
    manufacturer: "Pokemon",
    product: "Pokemon EX Crystal Guardians",
    players: ["Alakazam"],
    collector_number: "99"
  }
});
const communitySupportEligibility = vectorCandidatePacketAssistEligibility(communityCatalogFieldSupportPacket);
assert.equal(communitySupportEligibility.prompt_candidate_count, 0, "community catalog rows must not become approved identity candidates");
assert.equal(communitySupportEligibility.field_support_fields.includes("product"), true);
assert.equal(communitySupportEligibility.field_support_fields.includes("collector_number"), true);
const communityAssistPacket = buildVectorCandidateAssistPacket(communityCatalogFieldSupportPacket);
assert.equal(communityAssistPacket.vector_retrieval.candidates.length, 0);
assert.equal(communityAssistPacket.vector_retrieval.field_support.some((row) => row.source_trust === "CATALOG_FIELD_SUPPORT"), true);
assert.equal(communityAssistPacket.vector_retrieval.field_support.some((row) => row.source_type === "POKEMON_TCG_COMMUNITY_API"), true);

const externalWeakNormalizedPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "external-weak-normalized",
    candidate_identity_id: "external-weak-normalized",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    reference_metadata: {
      retrieval_status: "candidate",
      source_type: "EXTERNAL_DIRECTORY_WEAK"
    },
    supporting_fields: ["year", "product", "players"],
    fields: {
      year: "2006",
      manufacturer: "Pokemon",
      product: "Pokemon EX Crystal Guardians",
      players: ["Alakazam"]
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2006",
    manufacturer: "Pokemon",
    product: "Pokemon EX Crystal Guardians",
    players: ["Alakazam"]
  }
});
assert.equal(vectorCandidatePacketAssistEligibility(externalWeakNormalizedPacket).field_support_count, 0, "EXTERNAL_DIRECTORY_WEAK must fail closed even after source type normalization");
assert.equal(buildVectorCandidateAssistPacket(externalWeakNormalizedPacket).vector_retrieval.field_support.length, 0);

const catalogFieldSupportOnlyPacket = buildVectorCandidatePacket({
  open_set_decision: "LOW_MARGIN_MATCH",
  open_set_reason: "similar catalog family but no exact identity lock",
  sources: [{
    candidate_id: "catalog-field-support-only",
    candidate_identity_id: "identity-field-support-only",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    supporting_fields: ["players", "year", "product", "card_name"],
    fields: {
      year: "2024-25",
      manufacturer: "Panini",
      product: "Panini Encased",
      card_name: "Rookie Endorsements",
      players: ["Field Support Player"]
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2024-25",
    manufacturer: "Panini",
    players: ["Field Support Player"]
  }
});
const fieldSupportEligibility = vectorCandidatePacketAssistEligibility(catalogFieldSupportOnlyPacket);
assert.equal(fieldSupportEligibility.prompt_candidate_count, 0, "low margin identity candidate must not enter prompt");
assert.equal(fieldSupportEligibility.field_support_fields.includes("product"), true, "zero-conflict catalog rows should provide product vocabulary support");
assert.equal(fieldSupportEligibility.field_support_fields.includes("card_name"), true, "zero-conflict catalog rows should provide card-name vocabulary support");
const fieldSupportAssistPacket = buildVectorCandidateAssistPacket(catalogFieldSupportOnlyPacket);
assert.equal(fieldSupportAssistPacket.vector_retrieval.candidates.length, 0);
assert.equal(fieldSupportAssistPacket.vector_retrieval.status_code, "VECTOR_ASSIST_FIELD_SUPPORT_AVAILABLE");
assert.equal(vectorCandidatePacketHasPromptContent(fieldSupportAssistPacket), true);
assert.deepEqual(
  fieldSupportAssistPacket.vector_retrieval.field_support.map((row) => row.field).filter((field) => ["product", "card_name"].includes(field)),
  ["product", "card_name"]
);

const productVocabularyDifferentSubjectPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-product-vocabulary-different-subject",
    candidate_identity_id: "identity-panini-status-shai",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    supporting_fields: ["year", "product", "card_name"],
    fields: {
      year: "2018-19",
      manufacturer: "Panini",
      product: "Panini Status",
      card_name: "New Breed",
      players: ["Shai Gilgeous-Alexander"],
      collector_number: "106"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2018-19",
    manufacturer: "Panini",
    product: "Panini Status",
    card_name: "New Breed",
    players: ["Trae Young"],
    collector_number: "NB-TYG"
  }
});
const differentSubjectEligibility = vectorCandidatePacketAssistEligibility(productVocabularyDifferentSubjectPacket);
assert.equal(differentSubjectEligibility.prompt_candidate_count, 0, "different subject catalog row must not become an identity prompt candidate");
assert.equal(differentSubjectEligibility.field_support_fields.includes("product"), true, "field-level support can keep matching product vocabulary even when subject conflicts");
assert.equal(differentSubjectEligibility.field_support_fields.includes("card_name"), true, "field-level support can keep matching card-name vocabulary even when subject conflicts");
assert.equal(differentSubjectEligibility.field_support_fields.includes("collector_number"), false, "conflicting printed codes must not support collector number");

const broadProductFamilyPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-broad-product-family",
    candidate_identity_id: "identity-broad-product-family",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    supporting_fields: ["year", "product"],
    fields: {
      year: "2006",
      manufacturer: "Pokemon",
      product: "Pokemon",
      players: ["Alakazam"]
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2006",
    manufacturer: "Pokemon",
    product: "Pokemon EX Crystal Guardians",
    players: ["Alakazam"]
  }
});
const broadFamilyRow = broadProductFamilyPacket.vector_retrieval.candidates[0];
assert.equal(broadFamilyRow.anchor_agreement.agreed.includes("product_hierarchy"), false, "generic product family must not count as specific set/product agreement");
assert.equal(broadFamilyRow.anchor_agreement.contradicted.includes("product_hierarchy"), true);
assert.equal(vectorCandidatePacketAssistEligibility(broadProductFamilyPacket).prompt_candidate_count, 0);
assert.equal(vectorCandidatePacketAssistEligibility(broadProductFamilyPacket).field_support_fields.includes("product"), false);

const narrowProductHierarchyPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "catalog-narrow-product-hierarchy",
    candidate_identity_id: "identity-narrow-product-hierarchy",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    supporting_fields: ["year", "product", "players"],
    fields: {
      year: "2023",
      manufacturer: "Bandai",
      product: "Romance Dawn",
      players: ["Luffy"]
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2023",
    manufacturer: "Bandai",
    product: "One Piece Romance Dawn",
    players: ["Luffy"]
  }
});
const narrowHierarchyRow = narrowProductHierarchyPacket.vector_retrieval.candidates[0];
assert.equal(narrowHierarchyRow.anchor_agreement.agreed.includes("product_hierarchy"), true, "specific product hierarchy should survive family-token normalization");

const queryConflictPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "approved-wrong-neighbor",
    candidate_identity_id: "identity-approved-wrong-neighbor",
    source_type: "VISUAL_VECTOR",
    visual_similarity: 0.93,
    match_score: 0.93,
    embedding_role: "front_global",
    reference_metadata: { reference_status: "APPROVED", retrieval_status: "approved" },
    fields: {
      year: "2025",
      product: "Topps Chrome Platinum",
      players: ["Spencer Schwellenbach"],
      surface_color: "Blue",
      serial_number: "55/99"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2026",
    product: "Topps Chrome",
    players: ["Lionel Messi"],
    surface_color: "Blue",
    serial_number: "/10"
  }
});
const queryConflictFields = queryConflictPacket.vector_retrieval.candidates[0].conflicting_fields.sort();
assert.deepEqual(queryConflictFields, ["players", "serial_number", "year"]);
assert.deepEqual(queryConflictPacket.vector_retrieval.candidates[0].soft_conflicting_fields, ["product"]);
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(queryConflictPacket), false);
assert.deepEqual(eligibilityStableShape(vectorCandidatePacketAssistEligibility(queryConflictPacket)), {
  eligible: false,
  reason: "approved_identity_candidate_direct_conflict",
  raw_candidate_count: 1,
  approved_candidate_count: 1,
  conflict_blocked_count: 1,
  prompt_candidate_count: 0,
  prompt_candidate_ids: [],
  eligible_candidate_count: 0,
  blocked_candidate_count: 1
});
assert.equal(buildVectorCandidateAssistPacket(queryConflictPacket).vector_retrieval.candidates.length, 0);

const compatibleSeasonPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "approved-compatible-season",
    candidate_identity_id: "identity-approved-compatible-season",
    source_type: "VISUAL_VECTOR",
    visual_similarity: 0.93,
    match_score: 0.93,
    embedding_role: "front_global",
    reference_metadata: { reference_status: "APPROVED", retrieval_status: "approved" },
    fields: {
      year: "2025-26",
      product: "Panini Noir Road to FIFA World Cup",
      players: ["Bukayo Saka"],
      serial_number: "08/25"
    }
  }]
}, {
  limit: 5,
  queryFields: {
    year: "2026",
    product: "Panini Noir Road to FIFA World Cup 26",
    players: ["Bukayo Saka"],
    serial_number: "08/25"
  }
});
assert.deepEqual(compatibleSeasonPacket.vector_retrieval.candidates[0].conflicting_fields, []);
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(compatibleSeasonPacket), true);

const lowMarginOpenSetPacket = buildVectorCandidatePacket({
  open_set_decision: "LOW_MARGIN_MATCH",
  open_set_reason: "top_candidate_margin_below_threshold",
  sources: [{
    candidate_id: "approved-low-margin",
    candidate_identity_id: "identity-approved-low-margin",
    source_type: "VISUAL_VECTOR",
    visual_similarity: 0.93,
    match_score: 0.93,
    embedding_role: "front_global",
    reference_metadata: { reference_status: "APPROVED", retrieval_status: "approved" },
    fields: {
      year: "2025",
      product: "Topps Chrome",
      players: ["Low Margin Player"]
    }
  }]
}, { limit: 5 });
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(lowMarginOpenSetPacket), false);
assert.deepEqual(eligibilityStableShape(vectorCandidatePacketAssistEligibility(lowMarginOpenSetPacket)), {
  eligible: false,
  reason: "open_set_low_margin_match_not_prompt_safe",
  raw_candidate_count: 1,
  approved_candidate_count: 1,
  conflict_blocked_count: 0,
  prompt_candidate_count: 0,
  prompt_candidate_ids: [],
  eligible_candidate_count: 0,
  blocked_candidate_count: 1
});
assert.equal(vectorCandidatePacketAssistEligibility(lowMarginOpenSetPacket).field_support_count, 0, "open-set blocked candidates must not leak field support into prompt");
assert.equal(buildVectorCandidateAssistPacket(lowMarginOpenSetPacket).vector_retrieval.candidates.length, 0);

const lowMarginHardConstraintPacket = buildVectorCandidatePacket({
  open_set_decision: "LOW_MARGIN_MATCH",
  open_set_reason: "top_candidate_margin_below_threshold",
  sources: [{
    candidate_id: "approved-low-margin-hard-lock",
    candidate_identity_id: "identity-approved-low-margin-hard-lock",
    source_type: "VISUAL_VECTOR",
    source_trust: "APPROVED_REFERENCE",
    hard_constraint_eligible: true,
    visual_similarity: 0.93,
    match_score: 0.93,
    embedding_role: "front_global",
    reference_metadata: { reference_status: "APPROVED", retrieval_status: "approved" },
    fields: {
      year: "2025",
      product: "Topps Chrome",
      players: ["Hard Lock Player"],
      collector_number: "136"
    }
  }]
}, { limit: 5 });
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(lowMarginHardConstraintPacket), true);
assert.deepEqual(eligibilityStableShape(vectorCandidatePacketAssistEligibility(lowMarginHardConstraintPacket)), {
  eligible: true,
  reason: "approved_identity_candidate_available",
  raw_candidate_count: 1,
  approved_candidate_count: 1,
  conflict_blocked_count: 0,
  prompt_candidate_count: 1,
  prompt_candidate_ids: ["identity-approved-low-margin-hard-lock"],
  eligible_candidate_count: 1,
  blocked_candidate_count: 0
});
assert.equal(buildVectorCandidateAssistPacket(lowMarginHardConstraintPacket).vector_retrieval.candidates.length, 1);

const conflictingApprovedPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "approved-conflict",
    candidate_identity_id: "identity-conflict",
    source_type: "VISUAL_VECTOR",
    visual_similarity: 0.91,
    match_score: 0.91,
    embedding_role: "front_global",
    reference_image_id: "ref-conflict-front",
    embedding_id: "emb-conflict-front",
    reference_metadata: { reference_status: "APPROVED" },
    conflicting_fields: ["year"],
    fields: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"]
    }
  }]
}, { limit: 5 });
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(conflictingApprovedPacket), false);
assert.deepEqual(eligibilityStableShape(vectorCandidatePacketAssistEligibility(conflictingApprovedPacket)), {
  eligible: false,
  reason: "approved_identity_candidate_direct_conflict",
  raw_candidate_count: 1,
  approved_candidate_count: 1,
  conflict_blocked_count: 1,
  prompt_candidate_count: 0,
  prompt_candidate_ids: [],
  eligible_candidate_count: 0,
  blocked_candidate_count: 1
});
assert.equal(buildVectorCandidateAssistPacket(conflictingApprovedPacket).vector_retrieval.candidates.length, 0);

const mixedAssistPacket = buildVectorCandidatePacket({
  sources: [
    {
      candidate_id: "approved-clean",
      candidate_identity_id: "identity-approved-clean",
      source_type: "VISUAL_VECTOR",
      visual_similarity: 0.95,
      match_score: 0.95,
      embedding_role: "front_global",
      reference_metadata: { reference_status: "APPROVED", retrieval_status: "approved" },
      fields: { year: "2025", product: "Topps Chrome", players: ["Clean Player"] }
    },
    {
      candidate_id: "candidate-only",
      candidate_identity_id: "identity-candidate-only",
      source_type: "VISUAL_VECTOR",
      visual_similarity: 0.94,
      match_score: 0.94,
      embedding_role: "front_global",
      reference_metadata: { retrieval_status: "candidate" },
      fields: { year: "2025", product: "Topps Chrome", players: ["Candidate Player"] }
    },
    {
      candidate_id: "approved-conflict-rich",
      candidate_identity_id: "identity-approved-conflict-rich",
      source_type: "VISUAL_VECTOR",
      visual_similarity: 0.93,
      match_score: 0.93,
      embedding_role: "front_global",
      reference_metadata: { reference_status: "APPROVED", retrieval_status: "approved" },
      direct_evidence_conflicts: [{ field: "year" }],
      conflicts: [{ name: "product" }],
      fields: { year: "2024", product: "Topps Finest", players: ["Conflict Player"] }
    }
  ]
}, { limit: 5 });
const mixedEligibility = vectorCandidatePacketAssistEligibility(mixedAssistPacket);
assert.equal(mixedAssistPacket.vector_retrieval.candidates.length, 3, "raw packet should preserve every candidate for telemetry");
assert.deepEqual(eligibilityStableShape(mixedEligibility), {
  eligible: true,
  reason: "approved_identity_candidate_available",
  raw_candidate_count: 3,
  approved_candidate_count: 2,
  conflict_blocked_count: 1,
  prompt_candidate_count: 1,
  prompt_candidate_ids: ["identity-approved-clean"],
  eligible_candidate_count: 1,
  blocked_candidate_count: 1
});
const promptMixedPacket = buildVectorCandidateAssistPacket(mixedAssistPacket);
assert.equal(promptMixedPacket.vector_retrieval.candidates.length, 1);
assert.equal(promptMixedPacket.vector_retrieval.candidates[0].candidate_identity_id, "identity-approved-clean");
assert.doesNotMatch(JSON.stringify(promptMixedPacket), /identity-candidate-only|identity-approved-conflict-rich/);

const candidateOnlyPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "candidate-only-2",
    candidate_identity_id: "identity-candidate-only-2",
    source_type: "VISUAL_VECTOR",
    visual_similarity: 0.91,
    match_score: 0.91,
    embedding_role: "front_global",
    reference_metadata: { retrieval_status: "candidate" },
    fields: { year: "2025", product: "Panini Prizm", players: ["Candidate Only"] }
  }]
}, { limit: 5 });
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(candidateOnlyPacket), false);
assert.deepEqual(eligibilityStableShape(vectorCandidatePacketAssistEligibility(candidateOnlyPacket)), {
  eligible: false,
  reason: "no_approved_identity_candidate",
  raw_candidate_count: 1,
  approved_candidate_count: 0,
  conflict_blocked_count: 0,
  prompt_candidate_count: 0,
  prompt_candidate_ids: [],
  eligible_candidate_count: 0,
  blocked_candidate_count: 0
});
assert.equal(buildVectorCandidateAssistPacket(candidateOnlyPacket).vector_retrieval.candidates.length, 0);

const approvedConflictOnlyPacket = buildVectorCandidatePacket({
  sources: [{
    candidate_id: "approved-conflict-only",
    candidate_identity_id: "identity-approved-conflict-only",
    source_type: "VISUAL_VECTOR",
    visual_similarity: 0.91,
    match_score: 0.91,
    embedding_role: "front_global",
    reference_metadata: { retrieval_status: "approved" },
    direct_evidence_conflicts: ["serial_number"],
    fields: { year: "2025", product: "Panini Prizm", players: ["Conflict Only"] }
  }]
}, { limit: 5 });
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(approvedConflictOnlyPacket), false);
assert.deepEqual(eligibilityStableShape(vectorCandidatePacketAssistEligibility(approvedConflictOnlyPacket)), {
  eligible: false,
  reason: "approved_identity_candidate_direct_conflict",
  raw_candidate_count: 1,
  approved_candidate_count: 1,
  conflict_blocked_count: 1,
  prompt_candidate_count: 0,
  prompt_candidate_ids: [],
  eligible_candidate_count: 0,
  blocked_candidate_count: 1
});
assert.equal(buildVectorCandidateAssistPacket(approvedConflictOnlyPacket).vector_retrieval.candidates.length, 0);

const hybridPacket = buildVectorCandidatePacket({
  hybrid_ranker: { enabled: true },
  candidate_margin: 0.2,
  sources: [{
    candidate_id: "hybrid-1",
    candidate_identity_id: "identity-hybrid",
    source_trust: "APPROVED_REFERENCE",
    rerank_score: 0.92,
    rank_fusion_score: 0.88,
    fields: { year: "2025", product: "Topps Chrome", players: ["Hybrid Player"] },
    conflicting_fields: ["year"],
    direct_evidence_conflicts: [{ field: "serial_number" }],
    conflicts: [{ conflicting_field: "parallel_exact" }]
  }]
}, { limit: 5 });
assert.deepEqual(hybridPacket.vector_retrieval.candidates[0].conflicting_fields.sort(), ["parallel_exact", "serial_number", "year"]);
assert.deepEqual(candidateConflictFields(hybridPacket.vector_retrieval.candidates[0]).sort(), ["parallel_exact", "serial_number", "year"]);

const schema = openAiProviderResponseSchema();
assert.ok(schema.required.includes("vector_candidate_decision"));
assert.equal(schema.properties.vector_candidate_decision.properties.decision.enum.includes("NOT_AVAILABLE"), true);

const validatedDecision = validateProviderEvidencePayload("openai_legacy", {
  fields: { year: "2024" },
  unresolved: [],
  vector_candidate_decision: {
    selected_candidate_id: null,
    decision: "NOT_AVAILABLE",
    supported_fields: [],
    rejected_fields: [],
    conflicts: []
  }
});
assert.equal(validatedDecision.vector_candidate_decision.decision, "NOT_AVAILABLE");
assert.throws(() => validateProviderEvidencePayload("openai_legacy", {
  fields: { year: "2024" },
  unresolved: [],
  vector_candidate_decision: {
    selected_candidate_id: null,
    decision: "MAYBE",
    supported_fields: [],
    rejected_fields: [],
    conflicts: []
  }
}), /schema validation failed/i);

const workerMissing = await embedImagesWithVectorWorker({
  images: [],
  env: {},
  fetchImpl: async () => {
    throw new Error("should not call network");
  }
});
assert.equal(workerMissing.status, "VECTOR_RETRIEVAL_UNAVAILABLE");
assert.equal(workerMissing.reason, "vector_worker_not_configured");

const workerCalls = [];
const worker = await embedImagesWithVectorWorker({
  images: [{
    image_id: "front",
    role: "front_original",
    signedUrl: "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
    contentSha256: "a".repeat(64)
  }],
  env: {
    ...baseVectorEnv,
    VECTOR_WORKER_URL: "https://worker.test",
    VECTOR_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async (url, options) => {
    workerCalls.push({ url: String(url), body: JSON.parse(options.body), headers: options.headers });
    return new Response(JSON.stringify({
      request_id: "req",
      status: "completed",
      model_id: "google/siglip2-base-patch16-384",
      model_revision: defaultVisualEmbeddingModelRevision,
      preprocessing_version: "card-rectification-v1",
      latency_ms: 12,
      embeddings: [{
        image_id: "front",
        role: "front_global",
        embedding: [1, ...Array.from({ length: 767 }, () => 0)],
        dimensions: 768,
        normalized: true,
        content_sha256: "a".repeat(64)
      }]
    }), { status: 200 });
  }
});
assert.equal(worker.status, "OK");
assert.equal(worker.features[0].embedding_role, "front_global");
assert.equal(worker.features[0].content_sha256, "a".repeat(64));
assert.equal(workerCalls[0].body.images[0].role, "front_global");
assert.doesNotMatch(JSON.stringify(worker), /token=secret|worker-token/);

const provider = visualVectorProvider({
  env: baseVectorEnv,
  fetchImpl: async (url, options) => {
    assert.match(String(url), /rpc\/match_card_image_embeddings/);
    assert.equal(JSON.parse(options.body).match_count, 30);
    return new Response(JSON.stringify([
      {
        identity_id: "self",
        reference_image_id: "ref-self",
        embedding_id: "emb-self",
        image_role: "front_original",
        embedding_role: "front_global",
        model_id: "google/siglip2-base-patch16-384",
        model_revision: defaultVisualEmbeddingModelRevision,
        preprocessing_version: "card-rectification-v1",
        similarity: 0.99,
        fields: { year: "2024", product: "Self" },
        reference_metadata: { content_sha256: "same-hash" },
        embedding_metadata: {}
      },
      {
        identity_id: "other",
        reference_image_id: "ref-other",
        embedding_id: "emb-other",
        image_role: "front_original",
        embedding_role: "front_global",
        model_id: "google/siglip2-base-patch16-384",
        model_revision: defaultVisualEmbeddingModelRevision,
        preprocessing_version: "card-rectification-v1",
        similarity: 0.88,
        retrieval_status: "approved",
        reference_status: "approved",
        fields: { year: "2024", product: "Other", players: ["Player"] },
        reference_metadata: { content_sha256: "other-hash" },
        embedding_metadata: {}
      }
    ]), { status: 200 });
  }
});
const retrieval = await provider.search({
  query: {
    embedding: [1, ...Array.from({ length: 767 }, () => 0)],
    embedding_role: "front_global",
    model_id: "google/siglip2-base-patch16-384",
    model_revision: defaultVisualEmbeddingModelRevision,
    preprocessing_version: "card-rectification-v1",
    content_sha256: "same-hash"
  },
  resolved: {}
});
assert.equal(retrieval.candidates.length, 1);
assert.equal(retrieval.candidates[0].candidate_identity_id, "other");
assert.equal(retrieval.candidates[0].reference_metadata.retrieval_status, "approved");

const failClosedProvider = visualVectorProvider({
  env: baseVectorEnv,
  fetchImpl: async () => new Response(JSON.stringify([{
    identity_id: "missing-status",
    reference_image_id: "ref-missing-status",
    embedding_id: "emb-missing-status",
    image_role: "front_original",
    embedding_role: "front_global",
    model_id: "google/siglip2-base-patch16-384",
    model_revision: defaultVisualEmbeddingModelRevision,
    preprocessing_version: "card-rectification-v1",
    similarity: 0.9,
    fields: { year: "2024", product: "Missing Status", players: ["Player"] },
    reference_metadata: {},
    embedding_metadata: {}
  }]), { status: 200 })
});
const failClosedRetrieval = await failClosedProvider.search({
  query: {
    embedding: [1, ...Array.from({ length: 767 }, () => 0)],
    embedding_role: "front_global",
    model_id: "google/siglip2-base-patch16-384",
    model_revision: defaultVisualEmbeddingModelRevision,
    preprocessing_version: "card-rectification-v1"
  },
  resolved: {}
});
assert.equal(failClosedRetrieval.candidates[0].reference_metadata.retrieval_status, "");
const failClosedPacket = buildVectorCandidatePacket({ sources: failClosedRetrieval.candidates }, { limit: 5 });
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(failClosedPacket), false);
assert.equal(vectorCandidatePacketAssistEligibility(failClosedPacket).reason, "no_approved_identity_candidate");

const correctedTitleGtProvider = visualVectorProvider({
  env: {
    ...baseVectorEnv,
    VECTOR_CORRECTED_TITLE_AS_TEMPORARY_GT: "true"
  },
  fetchImpl: async () => new Response(JSON.stringify([{
    identity_id: "corrected-title-identity",
    reference_image_id: "ref-corrected-title",
    embedding_id: "emb-corrected-title",
    image_role: "front_original",
    embedding_role: "front_global",
    model_id: "google/siglip2-base-patch16-384",
    model_revision: defaultVisualEmbeddingModelRevision,
    preprocessing_version: "card-rectification-v1",
    similarity: 0.93,
    canonical_title: "2025 Topps Chrome Corrected Player Gold #136",
    fields: {},
    reference_metadata: {},
    embedding_metadata: {}
  }]), { status: 200 })
});
const correctedTitleGtRetrieval = await correctedTitleGtProvider.search({
  query: {
    embedding: [1, ...Array.from({ length: 767 }, () => 0)],
    embedding_role: "front_global",
    model_id: "google/siglip2-base-patch16-384",
    model_revision: defaultVisualEmbeddingModelRevision,
    preprocessing_version: "card-rectification-v1"
  },
  resolved: {}
});
assert.equal(correctedTitleGtRetrieval.candidates[0].reference_metadata.retrieval_status, "");
assert.equal(correctedTitleGtRetrieval.candidates[0].reference_metadata.reference_status, "");
assert.equal(correctedTitleGtRetrieval.candidates[0].source_trust, "APPROVED_REFERENCE");
assert.equal(correctedTitleGtRetrieval.candidates[0].field_derivation.corrected_title_is_reviewed_title_ground_truth, true);
assert.equal(correctedTitleGtRetrieval.candidates[0].field_derivation.title_derived_fields_are_ground_truth, false);
const correctedTitleGtPacket = buildVectorCandidatePacket({ sources: correctedTitleGtRetrieval.candidates }, { limit: 5 });
assert.equal(correctedTitleGtPacket.vector_retrieval.candidates[0].source_trust, "APPROVED_REFERENCE");
assert.equal(correctedTitleGtPacket.vector_retrieval.candidates[0].reference_title, "2025 Topps Chrome Corrected Player Gold #136");
assert.equal(vectorCandidatePacketHasAssistEligibleCandidates(correctedTitleGtPacket), true);
assert.equal(vectorCandidatePacketAssistEligibility(correctedTitleGtPacket).prompt_candidate_count, 1);

const rejectedCorrectedTitleProvider = visualVectorProvider({
  env: {
    ...baseVectorEnv,
    VECTOR_CORRECTED_TITLE_AS_TEMPORARY_GT: "true"
  },
  fetchImpl: async () => new Response(JSON.stringify([{
    identity_id: "rejected-corrected-title",
    reference_image_id: "ref-rejected-corrected-title",
    embedding_id: "emb-rejected-corrected-title",
    image_role: "front_original",
    embedding_role: "front_global",
    model_id: "google/siglip2-base-patch16-384",
    model_revision: defaultVisualEmbeddingModelRevision,
    preprocessing_version: "card-rectification-v1",
    similarity: 0.93,
    canonical_title: "2025 Topps Chrome Rejected Player Gold #136",
    retrieval_status: "rejected",
    fields: {},
    reference_metadata: {},
    embedding_metadata: {}
  }]), { status: 200 })
});
const rejectedCorrectedTitleRetrieval = await rejectedCorrectedTitleProvider.search({
  query: {
    embedding: [1, ...Array.from({ length: 767 }, () => 0)],
    embedding_role: "front_global",
    model_id: "google/siglip2-base-patch16-384",
    model_revision: defaultVisualEmbeddingModelRevision,
    preprocessing_version: "card-rectification-v1"
  },
  resolved: {}
});
assert.equal(rejectedCorrectedTitleRetrieval.candidates[0].reference_metadata.retrieval_status, "rejected");
assert.equal(rejectedCorrectedTitleRetrieval.candidates[0].field_derivation.title_derived_fields_are_ground_truth, false);

const telemetryMissingConfig = await recordVectorRetrievalTelemetry({
  env: {},
  fetchImpl: async () => {
    throw new Error("should not call network");
  }
});
assert.equal(telemetryMissingConfig.saved, false);
assert.equal(telemetryMissingConfig.reason, "supabase_not_configured");

const telemetryCalls = [];
const telemetry = await recordVectorRetrievalTelemetry({
  visualFeatures: {
    status: "OK",
    source: "vector_worker",
    latency_ms: 15,
    features: [{
      image_id: "front",
      embedding_role: "front_global",
      model_id: "google/siglip2-base-patch16-384",
      model_revision: defaultVisualEmbeddingModelRevision,
      preprocessing_version: "card-rectification-v1",
      dimensions: 768,
      embedding: [1, ...Array.from({ length: 767 }, () => 0)],
      content_sha256: "b".repeat(64),
      cache_hit: true
    }]
  },
  packet: {
    vector_retrieval: {
      status: "COMPLETED",
      status_code: "VECTOR_RETRIEVAL_COMPLETED",
      candidates: [{
        rank: 1,
        candidate_id: "not-a-uuid",
        candidate_identity_id: "11111111-1111-4111-8111-111111111111",
        similarity: 0.91,
        combined_score: 0.9,
        top1_top2_margin: 0.07,
        reference_count: 2,
        fields: {
          year: "2024",
          product: "Topps Chrome",
          players: ["Test Player"],
          serial_number: "31/50",
          grade_company: "PSA",
          card_grade: "10",
          title: "seller title should not persist",
          corrected_title: "review helper should not persist"
        }
      }],
      unavailable: []
    }
  },
  mode: "assist",
  retrievalConfig: {
    modelId: "google/siglip2-base-patch16-384",
    modelRevision: defaultVisualEmbeddingModelRevision,
    preprocessingVersion: "card-rectification-v1",
    topK: 10,
    internalTopN: 30
  },
  context: {
    analysisRunId: "analysis-1",
    assetId: "asset-1"
  },
  retrievalLatencyMs: 22,
  env: baseVectorEnv,
  fetchImpl: async (url, options) => {
    const table = String(url).split("/rest/v1/")[1];
    const body = JSON.parse(options.body);
    telemetryCalls.push({ table, body, headers: options.headers });
    if (table === "vector_query_logs") {
      assert.equal(body[0].searchable, false);
      assert.equal(body[0].status, "QUERY_ONLY");
      assert.equal(body[0].image_role, "front_global");
      assert.equal(body[0].metadata.signed_url_persisted, false);
      assert.doesNotMatch(JSON.stringify(body), /token=|https?:\/\/|seller title|corrected_title/i);
      return new Response(JSON.stringify([{ query_log_id: "22222222-2222-4222-8222-222222222222" }]), { status: 201 });
    }
    if (table === "vector_retrieval_runs") {
      assert.equal(body[0].query_log_id, "22222222-2222-4222-8222-222222222222");
      assert.equal(body[0].status, "VECTOR_RETRIEVAL_COMPLETED");
      assert.equal(body[0].mode, "assist");
      return new Response(JSON.stringify([{ retrieval_run_id: "33333333-3333-4333-8333-333333333333" }]), { status: 201 });
    }
    if (table === "vector_retrieval_candidates") {
      assert.equal(body[0].retrieval_run_id, "33333333-3333-4333-8333-333333333333");
      assert.equal(body[0].candidate_identity_id, "11111111-1111-4111-8111-111111111111");
      assert.equal(body[0].candidate_fields.year, "2024");
      assert.equal(body[0].candidate_fields.serial_number, undefined);
      assert.equal(body[0].candidate_fields.grade_company, undefined);
      assert.doesNotMatch(JSON.stringify(body), /31\/50|PSA|seller title|corrected_title/i);
      return new Response(JSON.stringify([{ retrieval_candidate_id: "44444444-4444-4444-8444-444444444444" }]), { status: 201 });
    }
    throw new Error(`unexpected table ${table}`);
  }
});
assert.equal(telemetry.saved, true);
assert.equal(telemetry.query_log_count, 1);
assert.equal(telemetry.candidate_count, 1);
assert.deepEqual(telemetryCalls.map((call) => call.table), [
  "vector_query_logs",
  "vector_retrieval_runs",
  "vector_retrieval_candidates"
]);

const telemetryFailure = await recordVectorRetrievalTelemetry({
  visualFeatures: {
    features: [{
      image_id: "front",
      embedding_role: "front_global",
      embedding: [1, ...Array.from({ length: 767 }, () => 0)]
    }]
  },
  packet,
  mode: "shadow",
  retrievalConfig: {},
  env: baseVectorEnv,
  fetchImpl: async () => new Response(JSON.stringify({ message: "missing table" }), { status: 404 })
});
assert.equal(telemetryFailure.saved, false);
assert.equal(telemetryFailure.reason, "vector_telemetry_write_failed");

console.log("vector production tests passed");
