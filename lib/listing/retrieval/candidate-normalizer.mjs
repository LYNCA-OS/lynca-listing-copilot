import { retrievalSourceTypes } from "./retrieval-contract.mjs";
import { classifySourceUrl, defaultSourcePolicy } from "./source-policy.mjs";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function candidateId(queryId, index) {
  return `${queryId || "query"}_candidate_${index + 1}`;
}

export function normalizeRetrievalCandidate(raw = {}, {
  query = {},
  index = 0,
  policy = defaultSourcePolicy()
} = {}) {
  const sourceUrl = raw.source_url || raw.url || raw.link || "";
  const rawSourceType = raw.source_type || null;
  const classified = classifySourceUrl(sourceUrl || raw.domain || "", {
    sourceType: rawSourceType && rawSourceType !== retrievalSourceTypes.OPEN_WEB ? rawSourceType : null,
    policy
  });
  const sourceType = rawSourceType === retrievalSourceTypes.OPEN_WEB
    ? classified.source_type
    : rawSourceType || classified.source_type || retrievalSourceTypes.OPEN_WEB;

  return {
    candidate_id: raw.candidate_id || candidateId(query.query_id, index),
    query_id: raw.query_id || query.query_id || "",
    query_family: raw.query_family || query.family || "",
    provider_id: raw.provider_id || raw.retrieval_provider_id || query.provider_id || "",
    channel_id: raw.channel_id || "",
    channel_rank: Number.isFinite(Number(raw.channel_rank || raw.rank)) ? Number(raw.channel_rank || raw.rank) : null,
    source_url: sourceUrl,
    domain: raw.domain || classified.domain,
    source_type: sourceType,
    trust_tier: Number(raw.trust_tier || classified.trust_tier || 9),
    retrieved_at: raw.retrieved_at || new Date().toISOString(),
    title: normalizeText(raw.title),
    evidence_excerpt: normalizeText(raw.evidence_excerpt || raw.snippet || raw.description),
    fields: raw.fields && typeof raw.fields === "object" ? raw.fields : {},
    matched_fields: Array.isArray(raw.matched_fields) ? raw.matched_fields : [],
    supporting_fields: Array.isArray(raw.supporting_fields) ? raw.supporting_fields : [],
    conflicting_fields: Array.isArray(raw.conflicting_fields) ? raw.conflicting_fields : [],
    raw_score: Number.isFinite(Number(raw.raw_score)) ? Number(raw.raw_score) : null,
    normalized_score: Number.isFinite(Number(raw.normalized_score)) ? Number(raw.normalized_score) : null,
    match_score: Number(raw.match_score || 0),
    selected: raw.selected === true,
    rejection_reason: raw.rejection_reason || null,
    visual_similarity: Number.isFinite(Number(raw.visual_similarity)) ? Number(raw.visual_similarity) : null,
    visual_distance: Number.isFinite(Number(raw.visual_distance)) ? Number(raw.visual_distance) : null,
    visual_margin_to_next: Number.isFinite(Number(raw.visual_margin_to_next)) ? Number(raw.visual_margin_to_next) : null,
    candidate_identity_id: raw.candidate_identity_id || raw.identity_id || null,
    reference_image_id: raw.reference_image_id || null,
    embedding_id: raw.embedding_id || null,
    image_role: raw.image_role || "",
    embedding_role: raw.embedding_role || "",
    model_id: raw.model_id || "",
    model_revision: raw.model_revision || "",
    preprocessing_version: raw.preprocessing_version || "",
    reference_metadata: raw.reference_metadata && typeof raw.reference_metadata === "object" ? raw.reference_metadata : {},
    embedding_metadata: raw.embedding_metadata && typeof raw.embedding_metadata === "object" ? raw.embedding_metadata : {},
    field_derivation: raw.field_derivation && typeof raw.field_derivation === "object" ? raw.field_derivation : null
  };
}

export function normalizeRetrievalCandidates(rawCandidates = [], options = {}) {
  return rawCandidates.map((candidate, index) => normalizeRetrievalCandidate(candidate, {
    ...options,
    index
  }));
}
