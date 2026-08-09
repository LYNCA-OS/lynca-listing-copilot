function normalizedEffort(value) {
  if (typeof value !== "string") return null;
  const effort = value.trim().toLowerCase();
  return effort || null;
}

// Requested reasoning is an input. Only a non-empty provider response echo is
// evidence of what was actually served; absence must remain UNKNOWN.
export function providerReasoningEffortReceipt(body = {}) {
  const servedEffort = normalizedEffort(body?.reasoning?.effort);
  return {
    served_effort: servedEffort,
    served_effort_attested: servedEffort !== null
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
