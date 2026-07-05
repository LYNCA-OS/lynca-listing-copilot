function sanitize(value, maxLength = 600) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
      .slice(0, maxLength);
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, maxLength));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, maxLength)]));
  }
  return value;
}

export function createTraceEntry({
  field = null,
  step,
  input = {},
  output = {},
  weight_update = null,
  decision = null
} = {}) {
  return {
    phase: "identity_resolution",
    field,
    step,
    input: sanitize(input),
    output: sanitize(output),
    weight_update: sanitize(weight_update),
    decision: sanitize(decision),
    created_at: new Date().toISOString()
  };
}

export function appendTrace(trace, entry) {
  trace.push(createTraceEntry(entry));
  return trace;
}

export function candidateTraceSummary(candidates = []) {
  return candidates.map((candidate) => ({
    value: candidate.value,
    score: candidate.score ?? null,
    sources: candidate.sources || [],
    valid: candidate.constraint_result?.valid !== false,
    score_components: candidate.score_components || {}
  }));
}
