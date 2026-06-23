export function createRetrievalTraceEntry({
  query,
  providerId,
  status,
  startedAt,
  endedAt = Date.now(),
  candidateCount = 0,
  reason = null,
  error = null,
  cacheHit = false
} = {}) {
  return {
    query_id: query?.query_id || null,
    family: query?.family || null,
    provider_id: providerId || query?.provider_id || null,
    query: query?.query || null,
    status,
    reason,
    error_code: error?.code || null,
    error_message: error?.message ? String(error.message).slice(0, 180) : null,
    candidate_count: candidateCount,
    latency_ms: Math.max(0, endedAt - startedAt),
    cache_hit: Boolean(cacheHit)
  };
}
