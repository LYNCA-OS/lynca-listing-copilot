export function createRetrievalTraceEntry({
  query,
  providerId,
  status,
  startedAt,
  endedAt = Date.now(),
  candidateCount = 0,
  reason = null,
  error = null,
  cacheHit = false,
  metadata = null
} = {}) {
  const safeMetadata = metadata && typeof metadata === "object"
    ? Object.fromEntries(Object.entries(metadata)
      .filter(([key]) => !/(?:key|token|secret|authorization|password)/i.test(key))
      .map(([key, value]) => {
        if (value === null || value === undefined) return [key, null];
        if (["string", "number", "boolean"].includes(typeof value)) return [key, value];
        if (Array.isArray(value)) return [key, value.slice(0, 20)];
        if (typeof value === "object") return [key, Object.fromEntries(Object.entries(value).slice(0, 20))];
        return [key, String(value)];
      }))
    : null;
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
    cache_hit: Boolean(cacheHit),
    metadata: safeMetadata
  };
}
