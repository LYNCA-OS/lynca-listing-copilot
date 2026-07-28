// Server-owned route policy for the model-as-assistant architecture.
//
// The model is never the title owner and a complete full-card observation is
// never a required route. Canonical evidence and deterministic knowledge run
// first; the model may only propose values for explicitly UNKNOWN fields.

// This policy is shadow-only until a paired evaluation proves that the
// targeted routes preserve accuracy. Keeping the decision pure makes it
// replayable without Provider, Queue, Storage, or UI dependencies.

import { decisiveTeamValueContract } from "../../catalog/constraint-enumerator.mjs";

export const knowledgeFirstRoutePolicy = Object.freeze({
  policy_id: "knowledge-first-model-assist-route",
  policy_version: "2026-07-28.4",
  schema_version: "knowledge-first-route-decision-v1"
});

export const knowledgeFirstRoutes = Object.freeze({
  HIGHER_AUTHORITY_FINAL: "HIGHER_AUTHORITY_FINAL",
  DETERMINISTIC_FINAL: "DETERMINISTIC_FINAL",
  TARGETED_VISUAL_ASSIST: "TARGETED_VISUAL_ASSIST",
  KNOWLEDGE_ASSIST: "KNOWLEDGE_ASSIST",
  TARGETED_VISUAL_AND_KNOWLEDGE: "TARGETED_VISUAL_AND_KNOWLEDGE",
  WRITER_REVIEW: "WRITER_REVIEW"
});

const visualFieldTargets = Object.freeze([
  "year",
  "manufacturer",
  "players",
  "card_name_or_insert_or_code"
]);
const knowledgeFieldTargets = Object.freeze(["product", "team"]);
const forwardEnumerationStatuses = new Set(["VALUE", "EMPTY", "UNKNOWN"]);
const decisiveEnumerationTrust = new Set(["OFFICIAL_FACT", "REVIEWED_INTERNAL_FACT", "CONSENSUS_FACT"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const publishableEvidenceStatuses = new Set(["CONFIRMED", "MANUAL_CONFIRMED"]);
const blockingEvidenceStatuses = new Set(["CONFLICT", "NOT_APPLICABLE"]);
const conflictOverridingReplayAuthorities = new Set([
  "WRITER_FINAL_REPLAY",
  "APPROVED_IDENTITY_MEMORY",
  "AI_TERMINAL_L2_REPLAY"
]);
const publishableEvidenceSources = new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "CARD_FRONT_PRINTED_TEXT",
  "CARD_BACK_PRINTED_TEXT",
  "SLAB_LABEL",
  "OCR",
  "OCR_ONLY",
  "OPERATOR",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_REGISTRY",
  "STRUCTURED_DATABASE"
]);

function present(value) {
  if (Array.isArray(value)) return value.some(present);
  if (typeof value === "boolean") return value === true;
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text !== "" && text.toUpperCase() !== "UNKNOWN";
}

function trustedEvidenceSource(source = {}) {
  return publishableEvidenceSources.has(
    String(source?.source_type || source?.source || "").trim().toUpperCase()
  );
}

function sourceSupportsEvidenceValue(source = {}, value = null) {
  if (!trustedEvidenceSource(source)) return false;
  const rawSourceValue = source.normalized_value
    ?? source.value
    ?? source.observed_text
    ?? source.visible_text
    ?? source.raw_text;
  if (!present(rawSourceValue) || !present(value)) return false;
  if (enumerationValueKey(rawSourceValue) === enumerationValueKey(value)) return true;
  const sourceText = String(rawSourceValue).replace(/\s+/g, " ").trim().toLowerCase();
  const expectedValues = (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const hasBoundedValue = (item) => {
    const escaped = item
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(sourceText);
  };
  return expectedValues.length > 0 && expectedValues.every(hasBoundedValue);
}

function hasPublishableProvenance(entry = {}) {
  const resolvedValue = entry.normalized_value ?? entry.value;
  const resolvedKey = JSON.stringify(Array.isArray(resolvedValue)
    ? resolvedValue.map((value) => String(value).trim()).sort()
    : resolvedValue);
  const candidates = Array.isArray(entry.candidates) ? entry.candidates : [];
  const attributedCandidates = candidates.filter((candidate) => (
    Array.isArray(candidate?.sources) && candidate.sources.length
  ));
  if (attributedCandidates.length) return attributedCandidates.some((candidate) => {
    const candidateValue = candidate?.normalized_value ?? candidate?.value;
    const candidateKey = JSON.stringify(Array.isArray(candidateValue)
      ? candidateValue.map((value) => String(value).trim()).sort()
      : candidateValue);
    return candidateKey === resolvedKey
      && (Array.isArray(candidate?.sources) ? candidate.sources : [])
        .some((source) => sourceSupportsEvidenceValue(source, candidateValue));
  });
  const unattributedCandidateKeys = new Set(candidates.map((candidate) => {
    const candidateValue = candidate?.normalized_value ?? candidate?.value;
    return JSON.stringify(Array.isArray(candidateValue)
      ? candidateValue.map((value) => String(value).trim()).sort()
      : candidateValue);
  }));
  if (unattributedCandidateKeys.size > 1 || (unattributedCandidateKeys.size === 1 && !unattributedCandidateKeys.has(resolvedKey))) {
    return false;
  }
  // createEvidenceField emits a source-free default candidate and keeps its
  // actual attribution at entry level. That single matching shape is safe to
  // bind; mergeEvidenceField's attributed candidates still take the branch above.
  return (Array.isArray(entry.sources) ? entry.sources : [])
    .some((source) => sourceSupportsEvidenceValue(source, resolvedValue));
}

function canonicalFieldState(evidenceDocument = {}, aliases = []) {
  const resolved = object(evidenceDocument.resolved);
  const evidence = object(evidenceDocument.evidence);
  const entries = aliases
    .map((field) => ({ field, entry: object(evidence[field]) }))
    .filter(({ entry }) => Object.keys(entry).length > 0);
  const statuses = entries.map(({ entry }) => String(entry.status || "").trim().toUpperCase());

  // Resolver output is not independent provenance: current evidence
  // normalizers can retain the leading candidate in `resolved` even when the
  // evidence state is CONFLICT. A model-free final therefore requires an
  // explicitly publishable evidence state, not merely a non-empty value.
  const blockingIndex = statuses.findIndex((status) => blockingEvidenceStatuses.has(status));
  if (blockingIndex >= 0) {
    return {
      value: null,
      state: statuses[blockingIndex],
      source_field: entries[blockingIndex].field,
      evidence_statuses: statuses
    };
  }

  const confirmed = entries.find(({ entry }) => (
    publishableEvidenceStatuses.has(String(entry.status || "").trim().toUpperCase())
    && hasPublishableProvenance(entry)
    && present(entry.normalized_value ?? entry.value)
  ));
  if (confirmed) {
    return {
      value: confirmed.entry.normalized_value ?? confirmed.entry.value,
      state: "PUBLISHABLE",
      source_field: confirmed.field,
      evidence_statuses: statuses
    };
  }

  const unsourcedResolvedField = aliases.find((field) => present(resolved[field]));
  const hasConfirmedWithoutTrustedProvenance = entries.some(({ entry }) => (
    publishableEvidenceStatuses.has(String(entry.status || "").trim().toUpperCase())
    && present(entry.normalized_value ?? entry.value)
  ));
  return {
    value: null,
    state: entries.length
      ? hasConfirmedWithoutTrustedProvenance
        ? "UNTRUSTED_PROVENANCE"
        : "UNPUBLISHABLE"
      : unsourcedResolvedField
        ? "UNSOURCED"
        : "UNKNOWN",
    source_field: unsourcedResolvedField || null,
    evidence_statuses: statuses
  };
}

function canonicalSnapshot(evidenceDocument = {}) {
  const requiredIdentityFields = new Set(["year", "manufacturer", "players", "literal_identity", "product"]);
  const states = {
    year: canonicalFieldState(evidenceDocument, ["year"]),
    manufacturer: canonicalFieldState(evidenceDocument, ["manufacturer", "brand"]),
    players: canonicalFieldState(evidenceDocument, ["players", "player", "subjects", "subject", "character"]),
    literal_identity: canonicalFieldState(evidenceDocument, [
      "card_name",
      "insert",
      "set",
      "collector_number",
      "checklist_code",
      "tcg_card_number",
      "card_number"
    ]),
    product: canonicalFieldState(evidenceDocument, ["product"]),
    team: canonicalFieldState(evidenceDocument, ["team"]),
    set: canonicalFieldState(evidenceDocument, ["set"]),
    surface_color: canonicalFieldState(evidenceDocument, ["surface_color"]),
    parallel_exact: canonicalFieldState(evidenceDocument, ["parallel_exact"])
  };
  return {
    ...Object.fromEntries(Object.entries(states).map(([field, state]) => [field, state.value])),
    field_states: Object.freeze(Object.fromEntries(Object.entries(states).map(([field, state]) => [field, state.state]))),
    blocked_fields: Object.freeze(Object.entries(states)
      .filter(([field, state]) => (
        state.state === "CONFLICT"
        || (state.state === "NOT_APPLICABLE" && requiredIdentityFields.has(field))
      ))
      .map(([field]) => field)),
    unpublishable_fields: Object.freeze(Object.entries(states)
      .filter(([, state]) => ["UNPUBLISHABLE", "UNSOURCED", "UNTRUSTED_PROVENANCE"].includes(state.state))
      .map(([field]) => field))
  };
}

export function publishableForwardEnumerationClaim(evidenceDocument = {}) {
  const states = {
    year: canonicalFieldState(evidenceDocument, ["year"]),
    manufacturer: canonicalFieldState(evidenceDocument, ["manufacturer", "brand"]),
    sport: canonicalFieldState(evidenceDocument, ["ip_sport", "sport"]),
    players: canonicalFieldState(evidenceDocument, ["players", "player", "subjects", "subject", "character"]),
    set: canonicalFieldState(evidenceDocument, ["set", "subset", "insert"]),
    card_name: canonicalFieldState(evidenceDocument, ["card_name"])
  };
  return Object.freeze(Object.fromEntries(Object.entries(states)
    .filter(([, state]) => state.state === "PUBLISHABLE" && present(state.value))
    .map(([field, state]) => [field, state.value])));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function enumerationValueKey(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(enumerationValueKey).sort());
  return JSON.stringify(String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase());
}

function validForwardEnumerationRow(row = {}, field = "", status = "") {
  const value = row?.value ?? null;
  const candidates = Array.isArray(row?.candidates) ? row.candidates : [];
  const provenance = row?.provenance && typeof row.provenance === "object" ? row.provenance : {};
  const provenanceComplete = String(provenance.source || "").trim() === "CATALOG_CONSTRAINT_SNAPSHOT"
    && decisiveEnumerationTrust.has(String(provenance.trust || "").trim().toUpperCase())
    && present(provenance.version)
    && present(provenance.rule_id);
  if (!provenanceComplete) return false;
  if (status === "VALUE") {
    const valueKey = enumerationValueKey(value);
    return present(value)
      && candidates.some((candidate) => enumerationValueKey(candidate) === valueKey)
      && (field !== "team" || provenance.team_value_contract === decisiveTeamValueContract);
  }
  if (status === "EMPTY") {
    return field === "team"
      && !present(value)
      && candidates.length === 0
      && String(row?.reason || "").trim() === "sport_has_no_teams";
  }
  return status === "UNKNOWN" && !present(value);
}

function normalizeForwardEnumerationTrace(trace = []) {
  const rows = Array.isArray(trace) ? trace : [];
  const normalizedRows = rows.flatMap((row) => {
    const field = String(row?.field || "").trim().toLowerCase();
    const status = String(row?.status || "").trim().toUpperCase();
    if (!knowledgeFieldTargets.includes(field)
      || !forwardEnumerationStatuses.has(status)
      || !validForwardEnumerationRow(row, field, status)) {
      return [];
    }
    return [Object.freeze({
      field,
      status,
      value: status === "VALUE" ? row?.value ?? null : null,
      candidates: Object.freeze(Array.isArray(row?.candidates) ? [...row.candidates] : []),
      reason: String(row?.reason || "").trim() || null,
      provenance: row?.provenance && typeof row.provenance === "object"
        ? Object.freeze({ ...row.provenance })
        : null
    })];
  });
  // A typed enumerator owns exactly one outcome per field. Conflicting or
  // duplicated rows are not ordered evidence; fail them closed as missing so
  // the route can never choose whichever row happened to arrive first.
  const fieldCounts = new Map(knowledgeFieldTargets.map((field) => [
    field,
    normalizedRows.filter((row) => row.field === field).length
  ]));
  return Object.freeze(normalizedRows.filter((row) => fieldCounts.get(row.field) === 1));
}

function forwardEnumerationRow(trace = [], field = "") {
  return trace.find((row) => row.field === field) || null;
}

function visualTargetsFor(snapshot = {}) {
  return visualFieldTargets.filter((field) => {
    if (field === "players") return !present(snapshot.players);
    if (field === "card_name_or_insert_or_code") return !present(snapshot.literal_identity);
    return !present(snapshot[field]);
  });
}

function knowledgeTargetsFor(snapshot = {}, forwardEnumerationTrace = []) {
  return knowledgeFieldTargets.filter((field) => (
    !present(snapshot[field])
    && forwardEnumerationRow(forwardEnumerationTrace, field)?.status === "UNKNOWN"
  ));
}

function fieldsMissingForwardEnumeration(snapshot = {}, forwardEnumerationTrace = []) {
  return knowledgeFieldTargets.filter((field) => (
    !present(snapshot[field])
    && !forwardEnumerationRow(forwardEnumerationTrace, field)
  ));
}

function decision({
  route,
  reasonCodes = [],
  visualTargets = [],
  knowledgeTargets = [],
  imagePolicy = "NONE",
  modelCallBudget = 0,
  higherAuthorityRoute = null,
  evidenceSnapshot = {},
  forwardEnumerationTrace = []
} = {}) {
  return Object.freeze({
    schema_version: knowledgeFirstRoutePolicy.schema_version,
    policy_id: knowledgeFirstRoutePolicy.policy_id,
    policy_version: knowledgeFirstRoutePolicy.policy_version,
    production_effect: "SHADOW_ONLY",
    // The deployed executor still runs the full Provider. Keeping that action
    // explicit prevents a counterfactual route decision from being mistaken
    // for an activated fast path in reports or launch gates.
    production_action: "RUN_FULL_PROVIDER",
    counterfactual_action: route,
    route,
    reason_codes: Object.freeze(unique(reasonCodes)),
    higher_authority_route: higherAuthorityRoute || null,
    full_provider_required: false,
    full_provider_allowed_as_default: false,
    complete_title_output_allowed: false,
    model_role: modelCallBudget > 0 ? "UNKNOWN_FIELD_PROPOSER" : "NOT_REQUIRED",
    model_call_budget: modelCallBudget,
    visual_field_targets: Object.freeze(unique(visualTargets)),
    knowledge_field_targets: Object.freeze(unique(knowledgeTargets)),
    image_policy: imagePolicy,
    field_application_owner: "IDENTITY_RESOLVER",
    fallback: "ABSTAIN_OR_WRITER_REVIEW",
    evidence_snapshot: Object.freeze({ ...evidenceSnapshot }),
    forward_enumeration_trace: forwardEnumerationTrace
  });
}

export function planKnowledgeFirstRecognition({
  evidenceDocument = {},
  forwardEnumerationTrace = [],
  usableImageCount = 0,
  exactAnchorShadow = null,
  higherAuthorityRoute = ""
} = {}) {
  const authority = String(higherAuthorityRoute || "").trim();
  const snapshot = canonicalSnapshot(evidenceDocument);
  const typedForwardEnumeration = normalizeForwardEnumerationTrace(forwardEnumerationTrace);

  if (authority === "PRE_PROVIDER_RESCAN") {
    return decision({
      route: knowledgeFirstRoutes.WRITER_REVIEW,
      reasonCodes: ["PRE_PROVIDER_RESCAN_REQUIRED"],
      higherAuthorityRoute: authority,
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  if (conflictOverridingReplayAuthorities.has(authority)) {
    return decision({
      route: knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL,
      reasonCodes: ["HIGHER_AUTHORITY_RESULT_AVAILABLE"],
      higherAuthorityRoute: authority,
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  // A writer/cache replay is already a higher-authority terminal result, but
  // an exact-anchor eligibility decision is only a preflight hypothesis. Late
  // current-image conflicts must be able to revoke it.
  if (snapshot.blocked_fields.length) {
    return decision({
      route: knowledgeFirstRoutes.WRITER_REVIEW,
      reasonCodes: [
        "EVIDENCE_CONFLICT_OR_NOT_APPLICABLE",
        ...snapshot.blocked_fields.map((field) => `BLOCKED_${field}`)
      ],
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  if (authority) {
    return decision({
      route: knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL,
      reasonCodes: ["HIGHER_AUTHORITY_RESULT_AVAILABLE"],
      higherAuthorityRoute: authority,
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  if (exactAnchorShadow?.eligible === true) {
    return decision({
      route: knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL,
      reasonCodes: ["UNIQUE_EXACT_ANCHOR_ELIGIBLE"],
      higherAuthorityRoute: "EXACT_ANCHOR_FINAL",
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  if (Number(usableImageCount || 0) < 1) {
    return decision({
      route: knowledgeFirstRoutes.WRITER_REVIEW,
      reasonCodes: ["NO_USABLE_IMAGE", "MODEL_CANNOT_REPAIR_MISSING_INPUT"],
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  const visualTargets = visualTargetsFor(snapshot);
  const knowledgeTargets = knowledgeTargetsFor(snapshot, typedForwardEnumeration);
  const missingEnumerationFields = fieldsMissingForwardEnumeration(snapshot, typedForwardEnumeration);

  if (!visualTargets.length && !knowledgeTargets.length && missingEnumerationFields.length) {
    return decision({
      route: knowledgeFirstRoutes.WRITER_REVIEW,
      reasonCodes: [
        "FORWARD_ENUMERATION_REQUIRED",
        ...missingEnumerationFields.map((field) => `ENUMERATION_MISSING_${field}`)
      ],
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  if (!visualTargets.length && !knowledgeTargets.length) {
    return decision({
      route: knowledgeFirstRoutes.DETERMINISTIC_FINAL,
      reasonCodes: ["PUBLISHABLE_CANONICAL_EVIDENCE_SUFFICIENT", "FORWARD_ENUMERATION_DECISIVE"],
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  if (visualTargets.length && knowledgeTargets.length) {
    return decision({
      route: knowledgeFirstRoutes.TARGETED_VISUAL_AND_KNOWLEDGE,
      reasonCodes: [
        "VISIBLE_FIELDS_UNKNOWN",
        "KNOWLEDGE_FIELDS_UNKNOWN",
        ...(missingEnumerationFields.length ? ["FORWARD_ENUMERATION_REQUIRED"] : [])
      ],
      visualTargets,
      knowledgeTargets,
      imagePolicy: "PRIMARY_PLUS_RELEVANT_CROPS_ONLY",
      modelCallBudget: 1,
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  if (visualTargets.length) {
    return decision({
      route: knowledgeFirstRoutes.TARGETED_VISUAL_ASSIST,
      reasonCodes: [
        "VISIBLE_FIELDS_UNKNOWN",
        ...(missingEnumerationFields.length ? ["FORWARD_ENUMERATION_REQUIRED"] : [])
      ],
      visualTargets,
      imagePolicy: "RELEVANT_CROPS_ONLY",
      modelCallBudget: 1,
      evidenceSnapshot: snapshot,
      forwardEnumerationTrace: typedForwardEnumeration
    });
  }

  return decision({
    route: knowledgeFirstRoutes.KNOWLEDGE_ASSIST,
    reasonCodes: ["KNOWLEDGE_FIELDS_UNKNOWN"],
    knowledgeTargets,
    imagePolicy: "NONE",
    modelCallBudget: 1,
    evidenceSnapshot: snapshot,
    forwardEnumerationTrace: typedForwardEnumeration
  });
}
