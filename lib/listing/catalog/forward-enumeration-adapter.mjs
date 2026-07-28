import { buildForwardEnumerationCandidatePacket, outcomes } from "./constraint-enumerator.mjs";

export const forwardEnumerationAdapterVersion = "forward-enumeration-adapter-v1";

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function observedClaim(result = {}) {
  const sources = [
    result.raw_observed_fields,
    result.candidate_observation_snapshot,
    result.raw_provider_fields,
    result.resolved_fields,
    result.resolved
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const merged = Object.assign({}, ...sources.reverse());
  return {
    year: merged.year,
    sport: merged.ip_sport || merged.sport,
    players: merged.players || merged.subjects,
    player: merged.player || merged.subject,
    set: merged.set || merged.subset || merged.insert,
    card_name: merged.card_name
  };
}

function identityEvidenceItems(packet = {}) {
  return packet.trace
    .filter((row) => row.status === outcomes.VALUE && present(row.value))
    .map((row) => ({
      field: row.field,
      value: row.value,
      source: "STRUCTURED_DATABASE",
      confidence: 0.72,
      metadata: {
        candidate_id: packet.candidates.find((candidate) => candidate.derived_field === row.field)?.id || null,
        retrieval_application_decision: "SUPPORT",
        retrieval_application_reason: "forward_constraint_value_candidate",
        candidate_is_evidence_not_truth: true,
        derived_fact_status: row.status,
        derived_fact_candidates: row.candidates,
        provenance: row.provenance,
        adapter_version: forwardEnumerationAdapterVersion
      }
    }));
}

// Shadow is the default and changes no resolver input. Active mode is intended
// only for deterministic replay/canary: it adds evidence to the existing
// application packet and still leaves the final choice to Identity Resolver.
export function attachForwardEnumerationCandidates(result = {}, model = null, { shadow = true } = {}) {
  const packet = buildForwardEnumerationCandidatePacket(observedClaim(result), model);
  const evidenceItems = identityEvidenceItems(packet);
  const patch = {
    ...result,
    forward_enumeration_candidate_packet: packet,
    forward_enumeration_trace: packet.trace,
    forward_enumeration_shadow: {
      schema_version: forwardEnumerationAdapterVersion,
      candidate_count: packet.candidates.length,
      identity_evidence_count: evidenceItems.length,
      identity_evidence_items: evidenceItems,
      title_changed: false
    }
  };
  if (shadow) return patch;
  const current = result.retrieval_application && typeof result.retrieval_application === "object"
    ? result.retrieval_application
    : {};
  return {
    ...patch,
    retrieval_application: {
      ...current,
      enabled: true,
      owns_candidate_application: true,
      identity_evidence_items: [
        ...(Array.isArray(current.identity_evidence_items) ? current.identity_evidence_items : []),
        ...evidenceItems
      ],
      forward_enumeration_adapter_version: forwardEnumerationAdapterVersion
    }
  };
}
