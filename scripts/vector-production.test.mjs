import assert from "node:assert/strict";
import {
  buildVectorCandidateAssistPacket,
  buildVectorCandidatePacket,
  candidateConflictFields,
  vectorCandidatePacketAssistEligibility,
  vectorCandidatePacketHasAssistEligibleCandidates
} from "../lib/listing/retrieval/vector-candidate-packet.mjs";
import { vectorRetrievalConfig, vectorRetrievalModes } from "../lib/listing/retrieval/vector-feature-flags.mjs";
import { defaultVisualEmbeddingModelRevision } from "../lib/listing/retrieval/vector-model-defaults.mjs";
import { embedImagesWithVectorWorker } from "../lib/listing/retrieval/vector-worker-client.mjs";
import { recordVectorRetrievalTelemetry } from "../lib/listing/retrieval/vector-telemetry.mjs";
import { visualVectorProvider } from "../lib/listing/retrieval/visual-vector-provider.mjs";
import { openAiProviderResponseSchema } from "../lib/listing/providers/openai-emergency-provider.mjs";
import { validateProviderEvidencePayload } from "../lib/listing/providers/provider-response-normalizer.mjs";
import { evidenceSourceTypes } from "../lib/listing/evidence/evidence-schema.mjs";

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
assert.deepEqual(vectorCandidatePacketAssistEligibility(packet), {
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
assert.deepEqual(vectorCandidatePacketAssistEligibility(conflictingApprovedPacket), {
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
assert.deepEqual(mixedEligibility, {
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
assert.deepEqual(vectorCandidatePacketAssistEligibility(candidateOnlyPacket), {
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
assert.deepEqual(vectorCandidatePacketAssistEligibility(approvedConflictOnlyPacket), {
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
assert.equal(correctedTitleGtRetrieval.candidates[0].reference_metadata.retrieval_status, "approved");
assert.equal(correctedTitleGtRetrieval.candidates[0].reference_metadata.reference_status, "APPROVED");
assert.equal(correctedTitleGtRetrieval.candidates[0].field_derivation.title_derived_fields_are_ground_truth, true);
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
