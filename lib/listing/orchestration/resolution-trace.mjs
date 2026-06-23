function sanitizeText(value, maxLength = 320) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function createCompletionTraceEntry({
  round = 0,
  action = null,
  status = "planned",
  reason = "",
  input = {},
  output = {},
  startedAt = Date.now(),
  endedAt = Date.now()
} = {}) {
  return {
    phase: "evidence_completion",
    round,
    action,
    status,
    reason: sanitizeText(reason),
    input,
    output,
    duration_ms: Math.max(0, endedAt - startedAt),
    created_at: new Date(endedAt).toISOString()
  };
}

export function completionAttemptFromTrace(entry = {}) {
  return {
    action: entry.action,
    status: entry.status,
    reason: entry.reason,
    duration_ms: entry.duration_ms,
    query_ids: Array.isArray(entry.output?.query_ids) ? entry.output.query_ids : [],
    provider_ids: Array.isArray(entry.output?.provider_ids) ? entry.output.provider_ids : [],
    candidate_count: Number(entry.output?.candidate_count || 0)
  };
}
