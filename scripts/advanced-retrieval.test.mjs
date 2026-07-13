import assert from "node:assert/strict";
import {
  advancedRetrievalAblationSteps,
  annRecallAtK,
  summarizeAblationDelta,
  summarizeAnnRecallAudit
} from "../lib/listing/retrieval/advanced-retrieval-eval.mjs";
import { buildCandidateContextSummary } from "../lib/listing/retrieval/candidate-context-summary.mjs";
import {
  extractQueryExpansionFields,
  hybridChannelIds,
  openSetDecisions,
  rankHybridRetrievalCandidates,
  reciprocalRankFusion
} from "../lib/listing/retrieval/hybrid-reranker.mjs";
import {
  colorMomentDistance,
  colorMomentHashFromMoments,
  fingerprintsLikelySameImage,
  geometricSupportScore,
  hammingDistance
} from "../lib/listing/retrieval/visual-fingerprint.mjs";
import { buildVectorCandidatePacket } from "../lib/listing/retrieval/vector-candidate-packet.mjs";

const rrf = reciprocalRankFusion(new Map([
  [hybridChannelIds.FRONT_IMAGE_VECTOR, [
    { candidate_identity_id: "identity-a", rank: 1, raw_score: 0.99, normalized_score: 0.99, provider: "front", supporting_fields: ["visual_vector"] },
    { candidate_identity_id: "identity-c", rank: 2, raw_score: 0.2, normalized_score: 0.2, provider: "front", supporting_fields: ["visual_vector"] }
  ]],
  [hybridChannelIds.BACK_IMAGE_VECTOR, [
    { candidate_identity_id: "identity-c", rank: 1, raw_score: 0.1, normalized_score: 0.1, provider: "back", supporting_fields: ["visual_vector"] },
    { candidate_identity_id: "identity-b", rank: 2, raw_score: 0.98, normalized_score: 0.98, provider: "back", supporting_fields: ["visual_vector"] }
  ]]
]), { k: 60 });

assert.equal(rrf[0].candidate_identity_id, "identity-c", "RRF should reward repeated independent ranks instead of summing raw scores");
assert.equal(rrf[0].channel_support[hybridChannelIds.FRONT_IMAGE_VECTOR].raw_score, 0.2);
assert.equal(rrf[0].channel_support[hybridChannelIds.BACK_IMAGE_VECTOR].raw_score, 0.1);

const exactRanked = rankHybridRetrievalCandidates([
  {
    candidate_id: "id-1-front",
    candidate_identity_id: "identity-1",
    provider_id: "visual_vector",
    source_type: "VISUAL_VECTOR",
    embedding_role: "front_global",
    visual_similarity: 0.9,
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "136",
      checklist_code: "TC-136",
      serial_number: "10/50"
    },
    reference_image_id: "front-ref"
  },
  {
    candidate_id: "id-1-back",
    candidate_identity_id: "identity-1",
    provider_id: "visual_vector",
    source_type: "VISUAL_VECTOR",
    embedding_role: "back_global",
    visual_similarity: 0.88,
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "136",
      checklist_code: "TC-136"
    },
    reference_image_id: "back-ref"
  },
  {
    candidate_id: "id-2-postgres",
    candidate_identity_id: "identity-2",
    provider_id: "postgres_hybrid",
    query_family: "SEARCH_POSTGRES_HYBRID",
    channel_id: "postgres_full_text",
    normalized_score: 0.71,
    fields: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Other Player"],
      collector_number: "136"
    }
  }
], {
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"],
  collector_number: "136",
  checklist_code: "TC-136",
  serial_number: "31/50"
});

assert.equal(exactRanked.open_set_decision, openSetDecisions.EXACT_CANDIDATE);
assert.equal(exactRanked.selected_candidate.candidate_identity_id, "identity-1");
assert.equal(exactRanked.retrieval_metrics.front_back_identity_agreement, true);
assert.equal(exactRanked.candidates[0].supporting_fields.includes("serial_denominator"), true);
assert.equal(exactRanked.channels[hybridChannelIds.FRONT_IMAGE_VECTOR][0].candidate_identity_id, "identity-1");

const noCandidate = rankHybridRetrievalCandidates([], { year: "2024" });
assert.equal(noCandidate.open_set_decision, openSetDecisions.NONE_OF_THE_ABOVE);

const conflictRanked = rankHybridRetrievalCandidates([
  {
    candidate_id: "conflict",
    candidate_identity_id: "identity-conflict",
    provider_id: "visual_vector",
    source_type: "VISUAL_VECTOR",
    embedding_role: "front_global",
    visual_similarity: 0.99,
    fields: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "136"
    }
  }
], {
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"],
  collector_number: "136"
});
assert.equal(conflictRanked.open_set_decision, openSetDecisions.NO_EXACT_MATCH);
assert.equal(conflictRanked.selected_candidate, null);

const familyOnly = rankHybridRetrievalCandidates([
  {
    candidate_id: "family",
    candidate_identity_id: "identity-family",
    provider_id: "visual_vector",
    source_type: "VISUAL_VECTOR",
    embedding_role: "front_global",
    visual_similarity: 0.92,
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"]
    }
  }
], {
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"]
});
assert.equal(familyOnly.open_set_decision, openSetDecisions.FAMILY_ONLY_MATCH);

const lowMarginCatalogConstraint = rankHybridRetrievalCandidates([
  {
    candidate_id: "catalog-correct",
    candidate_identity_id: "identity-correct",
    provider_id: "postgres_hybrid",
    query_family: "SEARCH_POSTGRES_HYBRID",
    source_type: "STRUCTURED_DATABASE",
    channel_id: "postgres_full_text",
    normalized_score: 0.82,
    trust_tier: 4,
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "136"
    }
  },
  {
    candidate_id: "catalog-near",
    candidate_identity_id: "identity-near",
    provider_id: "postgres_hybrid",
    query_family: "SEARCH_POSTGRES_HYBRID",
    source_type: "STRUCTURED_DATABASE",
    channel_id: "structured_metadata",
    normalized_score: 0.81,
    trust_tier: 4,
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "137"
    }
  }
], {
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"],
  collector_number: "136"
}, {
  lowMarginThreshold: 0.9
});
assert.equal(lowMarginCatalogConstraint.open_set_decision, openSetDecisions.EXACT_CANDIDATE);
assert.equal(lowMarginCatalogConstraint.open_set_reason, "catalog_hard_constraint_exact_anchor_overrode_low_margin");
assert.equal(lowMarginCatalogConstraint.selected_candidate.candidate_identity_id, "identity-correct");
assert.equal(lowMarginCatalogConstraint.selected_candidate.hard_constraint_eligible, true);
assert.ok(lowMarginCatalogConstraint.selected_candidate.field_match_score > 0);
assert.ok(lowMarginCatalogConstraint.selected_candidate.evidence_strength_score > 0);
assert.equal(lowMarginCatalogConstraint.selected_candidate.conflict_penalty_score, 0);

const hardNegativeRanked = rankHybridRetrievalCandidates([
  {
    candidate_id: "hard-negative",
    candidate_identity_id: "identity-hard",
    provider_id: "postgres_hybrid",
    channel_id: "structured_metadata",
    normalized_score: 0.98,
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "136",
      checklist_code: "TC-136"
    }
  }
], {
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"],
  collector_number: "136",
  checklist_code: "TC-136"
}, {
  hardNegatives: [{
    wrong_candidate_identity_id: "identity-hard",
    error_type: "same_design_different_subject",
    conflicting_fields: ["players"]
  }]
});
assert.equal(hardNegativeRanked.candidates[0].hard_negative.error_type, "same_design_different_subject");
assert.ok(hardNegativeRanked.candidates[0].rerank_score < exactRanked.candidates[0].rerank_score);

const packet = buildVectorCandidatePacket({
  hybrid_ranker: { algorithm: "test" },
  open_set_decision: "EXACT_CANDIDATE",
  retrieval_metrics: { top1_similarity: 0.9 },
  sources: [{
    candidate_id: "hybrid-candidate",
    candidate_identity_id: "identity-1",
    source_type: "STRUCTURED_DATABASE",
    rerank_score: 0.91,
    rank_fusion_score: 0.03,
    reference_count: 2,
    front_similarity: 0.9,
    back_similarity: 0.88,
    channel_support: {
      front_image_vector: {
        provider: "visual_vector",
        rank: 1,
        raw_score: 0.9,
        normalized_score: 0.9,
        supporting_fields: ["visual_vector"]
      }
    },
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      serial_number: "31/50",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678",
      collector_number: "136",
      checklist_code: "TC-136"
    }
  }]
});

assert.equal(packet.vector_retrieval.retrieval_strategy, "hybrid_rrf_structured_rerank");
assert.equal(packet.vector_retrieval.candidates[0].fields.expected_serial_denominator, "50");
assert.equal(packet.vector_retrieval.candidates[0].fields.serial_number, undefined);
assert.equal(packet.vector_retrieval.candidates[0].fields.grade_company, undefined);
assert.doesNotMatch(JSON.stringify(packet), /31\/50|PSA|12345678|corrected_title/i);

const expanded = extractQueryExpansionFields({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Test Player"],
    serial_number: "31/50"
  },
  evidence: {
    corrected_title: "2020 Hidden Ground Truth",
    reviewed_fields: {
      year: "2020"
    }
  }
});
assert.equal(expanded.year, "2024");
assert.equal(expanded.serial_denominator, "50");
assert.doesNotMatch(JSON.stringify(expanded), /2020|Hidden Ground Truth/i);

assert.equal(hammingDistance("abc", "adc"), 1);
const colorA = colorMomentHashFromMoments([0.2, 0.3, 0.4]);
const colorB = colorMomentHashFromMoments([0.21, 0.3, 0.39]);
assert.ok(colorMomentDistance(colorA, colorB) < 0.02);
assert.equal(fingerprintsLikelySameImage({
  perceptual_hash: "aaaaaaaaaaaaaaaa",
  color_moment_hash: colorA
}, {
  perceptual_hash: "aaaaaaaaaaaaaaab",
  color_moment_hash: colorB
}).match, true);
const geometry = geometricSupportScore({
  keypoint_match_count: 20,
  inlier_count: 12,
  inlier_ratio: 0.6,
  homography_valid: true
});
assert.ok(geometry > 0.5);

assert.equal(annRecallAtK({
  annResults: [{ identity_id: "a" }, { identity_id: "b" }],
  exactResults: [{ identity_id: "a" }, { identity_id: "c" }],
  k: 2
}), 0.5);

const audit = summarizeAnnRecallAudit({
  hnswResults: [{ identity_id: "a" }, { identity_id: "b" }],
  exactResults: [{ identity_id: "a" }, { identity_id: "c" }],
  indexLatencyMs: 8,
  exactLatencyMs: 38
});
assert.equal(audit.ann_recall_at_1, 1);
assert.equal(audit.ann_recall_at_5, 0.5);
assert.equal(audit.index_latency_ms, 8);

const delta = summarizeAblationDelta({
  baselineItems: [{ query_id: "1", correct: false }, { query_id: "2", correct: true }],
  candidateItems: [{ query_id: "1", correct: true }, { query_id: "2", correct: false }]
});
assert.equal(delta.recovery, 1);
assert.equal(delta.regression, 1);
assert.equal(delta.net_benefit, 0);
assert.equal(delta.default_enable_allowed, false);

assert.deepEqual(advancedRetrievalAblationSteps.map((step) => step.step), ["A", "B", "C", "D", "E", "F", "G"]);

const candidateContext = buildCandidateContextSummary({
  openSetReadiness: {
    status: "APPROVED_CANDIDATE_CONFLICT_REVIEW",
    assist_enabled: true,
    raw_candidate_count: 4,
    approved_candidate_count: 1,
    conflict_blocked_count: 1,
    prompt_candidate_ids: ["catalog-ok"]
  },
  catalogContext: {
    catalog_assist_eligibility: {
      raw_candidate_count: 2,
      approved_candidate_count: 1,
      conflict_blocked_count: 1,
      prompt_candidate_count: 1,
      prompt_candidate_ids: ["catalog-ok"]
    },
    promptPacket: true,
    assistPacket: {
      vector_retrieval: {
        candidates: [{ candidate_identity_id: "catalog-ok" }]
      }
    },
    exact_anchor_fast_lane_shadow: {
      exact_anchor_fast_lane_eligible: true,
      exact_anchor_candidate_id: "catalog-ok"
    }
  },
  vectorContext: {
    packet: {
      vector_retrieval: {
        status: "OK",
        candidates: [
          { candidate_identity_id: "vector-raw-conflict" },
          { candidate_identity_id: "vector-raw-shadow" }
        ]
      }
    },
    assistPacket: {
      vector_retrieval: {
        candidates: [],
        assist_filter: {
          raw_candidate_count: 2,
          approved_candidate_count: 0,
          conflict_blocked_count: 2,
          prompt_candidate_count: 0,
          prompt_candidate_ids: []
        }
      }
    },
    vector_assist_eligibility: {
      raw_candidate_count: 2,
      approved_candidate_count: 0,
      conflict_blocked_count: 2,
      prompt_candidate_count: 0,
      prompt_candidate_ids: []
    },
    worker: {
      status: "OK",
      latency_ms: 12,
      attempt_count: 2,
      features: [{ image_id: "front" }],
      stage_capacity: {
        coordinated: true,
        acquired: true,
        released: true,
        slot: 2
      }
    },
    promptPacket: false
  },
  env: {
    VERCEL_REGION: "syd1",
    SUPABASE_REGION: "ap-southeast-2"
  }
});
assert.equal(candidateContext.compute_region, "syd1");
assert.equal(candidateContext.storage_region, "ap-southeast-2");
assert.equal(candidateContext.raw_candidate_count, 4);
assert.equal(candidateContext.catalog.prompt_candidate_count, 1);
assert.deepEqual(candidateContext.prompt_candidate_ids, ["catalog-ok"]);
assert.equal(candidateContext.vector.raw_candidate_count, 2);
assert.equal(candidateContext.vector.prompt_candidate_count, 0);
assert.equal(candidateContext.vector.conflict_blocked_count, 2);
assert.equal(candidateContext.vector.worker_attempt_count, 2);
assert.equal(candidateContext.vector.stage_capacity.slot, 2);
assert.equal(candidateContext.invariants.raw_vector_candidates_are_shadow_until_prompt_safe, true);

console.log("advanced retrieval tests passed");
