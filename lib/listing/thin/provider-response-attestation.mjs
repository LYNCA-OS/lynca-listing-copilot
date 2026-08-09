function normalizedEffort(value) {
  if (typeof value !== "string") return null;
  const effort = value.trim().toLowerCase();
  return effort || null;
}

function normalizedText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Requested reasoning is an input. Only a non-empty provider response echo is
// evidence of what was actually served; absence must remain UNKNOWN.
export function providerReasoningEffortReceipt(body = {}) {
  const topLevel = normalizedEffort(body?.reasoning_effort);
  const nested = normalizedEffort(body?.reasoning?.effort);
  const conflict = Boolean(topLevel && nested && topLevel !== nested);
  const servedEffort = conflict ? null : topLevel || nested;
  return {
    served_effort: servedEffort,
    served_effort_attested: servedEffort !== null,
    served_effort_conflict: conflict
  };
}

export function providerResponseAttestation(body = {}) {
  const servedModel = normalizedText(body?.model);
  const responseStatus = normalizedText(body?.status)?.toLowerCase() || null;
  return {
    served_model: servedModel,
    served_model_attested: servedModel !== null,
    provider_response_status: responseStatus,
    provider_response_status_attested: responseStatus !== null,
    provider_response_incomplete: body?.incomplete_details != null
  };
}

export function providerUsageReceipt(body = {}) {
  const usage = body?.usage && typeof body.usage === "object" ? body.usage : {};
  return {
    input_tokens: nonNegativeInteger(usage.input_tokens),
    cached_input_tokens: nonNegativeInteger(usage?.input_tokens_details?.cached_tokens),
    output_tokens: nonNegativeInteger(usage.output_tokens),
    reasoning_tokens: nonNegativeInteger(usage?.output_tokens_details?.reasoning_tokens),
    total_tokens: nonNegativeInteger(usage.total_tokens)
  };
}

// Durable checkpoints predating the attestation bit may contain a copied
// requested value in `served_effort`. Never upgrade that legacy value merely
// because it looks plausible.
export function durableReasoningEffortReceipt(result = {}) {
  const servedEffort = result?.served_effort_attested === true
    ? normalizedEffort(result?.served_effort)
    : null;
  return {
    reasoning_effort: servedEffort,
    reasoning_effort_attested: servedEffort !== null
  };
}
