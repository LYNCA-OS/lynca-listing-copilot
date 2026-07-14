function candidateMergeKey(candidate = {}, index = 0) {
  return String(candidate.candidate_identity_id
    || candidate.identity_id
    || candidate.candidate_id
    || `${candidate.provider_id || candidate.source_type || "catalog"}:${candidate.reference_title || candidate.title || index}`
  ).trim();
}

function candidateMergeScore(candidate = {}) {
  for (const field of ["rerank_score", "match_score", "rank_fusion_score", "normalized_score", "raw_score", "similarity"]) {
    const value = Number(candidate?.[field]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function mergeCandidateRows(contexts = []) {
  const candidates = contexts.flatMap((context) => (
    Array.isArray(context?.retrieval?.sources) ? context.retrieval.sources : []
  ));
  const merged = new Map();
  candidates.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return;
    const key = candidateMergeKey(candidate, index);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      return;
    }
    const preferred = candidateMergeScore(candidate) > candidateMergeScore(existing)
      ? candidate
      : existing;
    const other = preferred === candidate ? existing : candidate;
    merged.set(key, {
      ...other,
      ...preferred,
      supporting_fields: [...new Set([
        ...(Array.isArray(existing.supporting_fields) ? existing.supporting_fields : []),
        ...(Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : [])
      ])],
      matched_fields: [...new Set([
        ...(Array.isArray(existing.matched_fields) ? existing.matched_fields : []),
        ...(Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
      ])],
      conflicting_fields: [...new Set([
        ...(Array.isArray(existing.conflicting_fields) ? existing.conflicting_fields : []),
        ...(Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : [])
      ])],
      direct_evidence_conflicts: [...new Set([
        ...(Array.isArray(existing.direct_evidence_conflicts) ? existing.direct_evidence_conflicts : []),
        ...(Array.isArray(candidate.direct_evidence_conflicts) ? candidate.direct_evidence_conflicts : [])
      ])],
      channel_support: {
        ...(existing.channel_support && typeof existing.channel_support === "object" ? existing.channel_support : {}),
        ...(candidate.channel_support && typeof candidate.channel_support === "object" ? candidate.channel_support : {})
      }
    });
  });
  return [...merged.values()].sort((left, right) => (
    candidateMergeScore(right) - candidateMergeScore(left)
  ));
}

function telemetryRowKey(row, index, field) {
  if (!row || typeof row !== "object") return `${field}:${index}:${String(row)}`;
  try {
    return `${field}:${JSON.stringify(row)}`;
  } catch {
    return `${field}:${index}`;
  }
}

function uniqueTelemetryRows(contexts = [], field) {
  const rows = contexts.flatMap((context) => (
    Array.isArray(context?.retrieval?.[field]) ? context.retrieval[field] : []
  ));
  const seen = new Set();
  return rows.filter((row, index) => {
    const key = telemetryRowKey(row, index, field);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeCatalogCandidateContexts(...values) {
  const contexts = values.flat().filter((context) => context && typeof context === "object");
  const retrievalContexts = contexts.filter((context) => context.retrieval && typeof context.retrieval === "object");
  if (!retrievalContexts.length) return contexts.at(-1) || null;
  if (retrievalContexts.length === 1) return retrievalContexts[0];

  const latest = retrievalContexts.at(-1);
  const sources = mergeCandidateRows(retrievalContexts);
  const scoreAt = (index) => candidateMergeScore(sources[index] || {});
  const candidateMargin = sources.length > 1 ? Math.max(0, scoreAt(0) - scoreAt(1)) : null;
  const retrieval = {
    ...latest.retrieval,
    providers_used: [...new Set(retrievalContexts.flatMap((context) => context.retrieval.providers_used || []))],
    queries: uniqueTelemetryRows(retrievalContexts, "queries"),
    sources,
    selected_candidate: sources[0] || null,
    candidate_margin: candidateMargin,
    conflicts: uniqueTelemetryRows(retrievalContexts, "conflicts"),
    unavailable: uniqueTelemetryRows(retrievalContexts, "unavailable"),
    trace: uniqueTelemetryRows(retrievalContexts, "trace"),
    catalog_candidate_merge: {
      phase_count: retrievalContexts.length,
      source_counts: retrievalContexts.map((context) => context.retrieval.sources?.length || 0),
      merged_source_count: sources.length
    }
  };
  return {
    ...latest,
    retrieval,
    retrieval_phase: "pre_and_post_provider_catalog_merge",
    catalog_context_merge: retrieval.catalog_candidate_merge
  };
}
