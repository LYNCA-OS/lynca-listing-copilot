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
    source_url: sourceUrl,
    domain: raw.domain || classified.domain,
    source_type: sourceType,
    trust_tier: Number(raw.trust_tier || classified.trust_tier || 9),
    retrieved_at: raw.retrieved_at || new Date().toISOString(),
    title: normalizeText(raw.title),
    evidence_excerpt: normalizeText(raw.evidence_excerpt || raw.snippet || raw.description),
    fields: raw.fields && typeof raw.fields === "object" ? raw.fields : {},
    matched_fields: Array.isArray(raw.matched_fields) ? raw.matched_fields : [],
    conflicting_fields: Array.isArray(raw.conflicting_fields) ? raw.conflicting_fields : [],
    match_score: Number(raw.match_score || 0),
    selected: raw.selected === true,
    rejection_reason: raw.rejection_reason || null
  };
}

export function normalizeRetrievalCandidates(rawCandidates = [], options = {}) {
  return rawCandidates.map((candidate, index) => normalizeRetrievalCandidate(candidate, {
    ...options,
    index
  }));
}
