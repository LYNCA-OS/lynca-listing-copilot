import { normalizeResolvedFields } from "../listing/evidence/evidence-schema.mjs";
import { resolvedFieldsToLegacyFields } from "../listing/evidence/provider-evidence-normalizer.mjs";
import { renderListingPresentation } from "../listing/renderer/listing-renderer.mjs";
import { containsNonEnglishTitleScript } from "../listing/renderer/title-cleanup.mjs";
import { resolveIdentity } from "./solver.mjs";
import { identityStatuses } from "./types.mjs";

const criticalOptionalFields = Object.freeze([
  "serial_number",
  "collector_number",
  "checklist_code",
  "multi_card",
  "card_count",
  "lot_type",
  "card_type",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

const colorDescriptorFields = Object.freeze([
  "set",
  "subset",
  "insert"
]);

const colorTokens = Object.freeze([
  "black",
  "blue",
  "bronze",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow"
]);

function hasValue(value, fieldName = "") {
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptorColorTokens(value) {
  const tokens = new Set(canonicalText(Array.isArray(value) ? value.join(" ") : value).split(" ").filter(Boolean));
  return colorTokens.filter((token) => tokens.has(token));
}

function sourceTypeForIdentity(source = {}, providerId = "") {
  const type = source.source_type || source.source || "";
  if (type === "VISION_MODEL") {
    return providerId === "openai_legacy" ? "VISUAL_GUESS" : "AGNES_INFERENCE";
  }
  return type || "VISUAL_GUESS";
}

function evidenceCandidates(field = {}) {
  if (Array.isArray(field.candidates) && field.candidates.length) {
    return field.candidates.filter((candidate) => hasValue(candidate?.value));
  }
  return hasValue(field.value) ? [{ value: field.value, confidence: field.confidence }] : [];
}

function evidenceSources(field = {}, candidate = {}) {
  if (Array.isArray(candidate.sources) && candidate.sources.length) return candidate.sources;
  return Array.isArray(field.sources) && field.sources.length ? field.sources : [{}];
}

function sourceMetadata(source = {}) {
  return {
    original_source: source.source_type || source.source || null,
    side: source.side || null,
    capture_role: source.capture_role || null,
    region: source.region || null,
    observed_text: source.observed_text || null,
    glare_occlusion: source.glare_occlusion ?? null,
    glare_score: source.glare_occlusion ?? null,
    blur_score: source.blur_score ?? null,
    trust_tier: source.trust_tier ?? null
  };
}

export function evidenceDocumentToIdentityEvidenceItems(evidenceDocument = {}, {
  providerId = ""
} = {}) {
  const evidence = evidenceDocument?.evidence && typeof evidenceDocument.evidence === "object"
    ? evidenceDocument.evidence
    : {};
  const items = [];

  Object.entries(evidence).forEach(([fieldName, field]) => {
    if (!field || typeof field !== "object") return;
    const candidates = evidenceCandidates(field);

    candidates.forEach((candidate) => {
      evidenceSources(field, candidate).forEach((source) => {
        items.push({
          field: fieldName,
          value: candidate.value,
          source: sourceTypeForIdentity(source, providerId),
          confidence: Number(candidate.confidence ?? field.confidence ?? 0.5),
          image_id: source.image_id || source.imageId || null,
          region: source.region || null,
          metadata: {
            ...sourceMetadata(source),
            field_status: field.status || null,
            field_unresolved_reason: field.unresolved_reason || null
          }
        });
      });
    });
  });

  return items;
}

export function criticalFieldsForIdentityResolution(resolved = {}, evidenceItems = []) {
  const normalized = normalizeResolvedFields(resolved);
  const evidenceFields = new Set(evidenceItems.map((item) => item.field).filter(Boolean));
  const subjectField = hasValue(normalized.players, "players")
    ? "players"
    : hasValue(normalized.character, "character")
      ? "character"
      : "players";

  return unique([
    "year",
    "product",
    subjectField,
    ...criticalOptionalFields.filter((field) => evidenceFields.has(field) || hasValue(normalized[field], field))
  ]);
}

function unresolvedFromIdentityResolution(identityResolution = {}, criticalFields = []) {
  const critical = new Set(criticalFields);
  return (identityResolution.field_states || [])
    .filter((fieldState) => {
      return critical.has(fieldState.field)
        && fieldState.decision_route !== "DROP"
        && (fieldState.decision_route === "ABSTAIN" || fieldState.ambiguity || !hasValue(fieldState.resolved_value, fieldState.field));
    })
    .map((fieldState) => `identity ${fieldState.field}: ${fieldState.resolution_reason || "unresolved"}`);
}

function publicLegacyFields(identity = {}, existingFields = {}) {
  const legacy = resolvedFieldsToLegacyFields(identity);
  return {
    ...existingFields,
    ...Object.fromEntries(Object.entries(legacy).filter(([, value]) => value !== null && value !== undefined))
  };
}

function confidenceForIdentityStatus(status) {
  if (status === identityStatuses.CONFIRMED) return "HIGH";
  if (status === identityStatuses.RESOLVED) return "MEDIUM";
  return "LOW";
}

function resolutionReason(identityResolution = {}) {
  if (identityResolution.status === identityStatuses.CONFIRMED) {
    return "Identity resolution confirmed critical fields from grounded evidence.";
  }
  if (identityResolution.status === identityStatuses.RESOLVED) {
    return "Identity resolution resolved conflicts with traceable evidence.";
  }
  return "Identity resolution abstained because grounded evidence is missing, conflicting, or too uncertain.";
}

function mergeReason(identityReason, existingReason) {
  const base = String(identityReason || "").trim();
  const existing = String(existingReason || "").trim();
  if (!existing) return base;
  if (!base) return existing;
  if (existing.toLowerCase().includes(base.toLowerCase())) return existing;
  return `${base} ${existing}`.trim();
}

function parseCardCount(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function multiCardLotGuardInfo({
  identity = {},
  resolved = {},
  fields = {},
  unresolved = [],
  reason = ""
} = {}) {
  const cardCount = parseCardCount(identity.card_count ?? resolved.card_count ?? fields.card_count ?? fields.cardCount);
  const lotText = [
    identity.lot_type,
    resolved.lot_type,
    fields.lot_type,
    fields.lotType,
    reason,
    ...unresolved
  ].filter(Boolean).join(" ");
  const textIndicatesLot = /\b(?:multi[-\s]?card|multiple cards|card lot|lot of cards|bundle of cards)\b/i.test(lotText)
    || /套卡|多张卡|多卡/.test(lotText);
  const detected = identity.multi_card === true
    || resolved.multi_card === true
    || fields.multi_card === true
    || fields.multiCard === true
    || Number(cardCount || 0) > 1
    || textIndicatesLot;

  return {
    detected,
    card_count: cardCount,
    lot_type: identity.lot_type || resolved.lot_type || fields.lot_type || fields.lotType || (textIndicatesLot ? "multi_card_lot" : null)
  };
}

function applyMultiCardLotGuard(identityResolution = {}, lotGuard = {}) {
  if (!lotGuard.detected) return identityResolution;

  const conflict = {
    field: "multi_card",
    conflict_type: "MULTI_CARD_LOT_REQUIRES_SINGLE_CARD_SPLIT",
    conflicting_values: [lotGuard.card_count ? `${lotGuard.card_count} cards` : "multiple cards"],
    severity: "HIGH",
    reason: "multiple-card or lot image cannot be resolved as one card identity",
    resolved: false
  };
  const trace = {
    field: "multi_card",
    step: "lot_guard",
    input: {
      multi_card: true,
      card_count: lotGuard.card_count,
      lot_type: lotGuard.lot_type
    },
    output: {
      status: identityStatuses.ABSTAIN,
      route: "NON_STANDARD_MANUAL"
    },
    decision: "multi_card_lot_requires_operator_review",
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    status: identityStatuses.ABSTAIN,
    ambiguity_status: "AMBIGUOUS",
    conflict_map: [...(identityResolution.conflict_map || []), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), trace],
    identity_state: identityResolution.identity_state
      ? {
          ...identityResolution.identity_state,
          status: identityStatuses.ABSTAIN,
          conflict_graph: identityResolution.identity_state.conflict_graph || []
        }
      : identityResolution.identity_state
  };
}

function updateIdentityState(identityResolution = {}, patch = {}) {
  return identityResolution.identity_state
    ? {
        ...identityResolution.identity_state,
        ...patch,
        status: patch.status || identityResolution.identity_state.status,
        fields: patch.fields || identityResolution.identity_state.fields
      }
    : identityResolution.identity_state;
}

function appendAbstainConflict(identityResolution = {}, {
  field,
  conflictType,
  value,
  reason,
  decision
} = {}) {
  const conflict = {
    field,
    conflict_type: conflictType,
    conflicting_values: [value].filter((item) => hasValue(item, field)),
    severity: "HIGH",
    reason,
    resolved: false
  };
  const guardTrace = {
    field,
    step: "commercial_publish_guard",
    input: { value },
    output: {
      status: identityStatuses.ABSTAIN,
      route: "MANUAL_REQUIRED"
    },
    decision,
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    status: identityStatuses.ABSTAIN,
    ambiguity_status: "AMBIGUOUS",
    conflict_map: [...(identityResolution.conflict_map || []), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), guardTrace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (fieldState.field !== field) return fieldState;
      return {
        ...fieldState,
        decision_route: "ABSTAIN",
        ambiguity: true,
        conflicts: true,
        resolution_reason: decision,
        conflict_items: [...(fieldState.conflict_items || []), conflict]
      };
    }),
    identity_state: updateIdentityState(identityResolution, { status: identityStatuses.ABSTAIN })
  };
}

function applyCriticalFieldConfidenceGuard(identityResolution = {}, criticalFields = [], {
  minConfidence = 0.74
} = {}) {
  const critical = new Set(criticalFields);
  const risky = (identityResolution.field_states || []).find((fieldState) => {
    return critical.has(fieldState.field)
      && hasValue(fieldState.resolved_value, fieldState.field)
      && Number(fieldState.resolution_confidence || 0) < minConfidence;
  });
  if (!risky) return identityResolution;

  return appendAbstainConflict(identityResolution, {
    field: risky.field,
    conflictType: "CRITICAL_FIELD_BELOW_PUBLISH_CONFIDENCE",
    value: risky.resolved_value,
    reason: `${risky.field} confidence is below the commercial auto-publish threshold`,
    decision: "critical_field_requires_operator_review_below_publish_confidence"
  });
}

function sourceSummaryOnly(fieldState = {}, allowedSources = []) {
  const summaries = Array.isArray(fieldState.source_summary) ? fieldState.source_summary : [];
  return summaries.length > 0 && summaries.every((summary) => allowedSources.includes(summary.source));
}

function maxResolvedEvidenceConfidence(fieldState = {}) {
  const support = Array.isArray(fieldState.supporting_sources) ? fieldState.supporting_sources : [];
  const supportScores = support
    .map((source) => Number(source.confidence))
    .filter((score) => Number.isFinite(score));
  if (supportScores.length) return Math.max(...supportScores);

  const candidateScores = (Array.isArray(fieldState.candidates) ? fieldState.candidates : [])
    .flatMap((candidate) => Array.isArray(candidate.evidence_items) ? candidate.evidence_items : [])
    .map((item) => Number(item.confidence))
    .filter((score) => Number.isFinite(score));
  return candidateScores.length ? Math.max(...candidateScores) : 0;
}

function applyWeakOcrOnlyOptionalCodeDrop(identityResolution = {}, {
  minConfidence = 0.74
} = {}) {
  const drops = (identityResolution.field_states || []).filter((fieldState) => {
    return fieldState.field === "checklist_code"
      && hasValue(fieldState.resolved_value, fieldState.field)
      && maxResolvedEvidenceConfidence(fieldState) < minConfidence
      && sourceSummaryOnly(fieldState, ["OCR_ONLY"]);
  });
  if (!drops.length) return identityResolution;

  const nextIdentity = { ...(identityResolution.identity || {}) };
  const conflicts = drops.map((fieldState) => {
    nextIdentity[fieldState.field] = null;
    return {
      field: fieldState.field,
      conflict_type: "WEAK_OCR_ONLY_OPTIONAL_CODE_DROPPED",
      conflicting_values: [fieldState.resolved_value],
      severity: "MEDIUM",
      reason: `${fieldState.field} came only from low-confidence OCR text and is not safe to publish as identity`,
      resolved: true,
      resolution: "dropped_weak_ocr_only_optional_code_before_publish",
      selected_value: null
    };
  });
  const droppedFields = new Set(drops.map((fieldState) => fieldState.field));
  const trace = drops.map((fieldState) => ({
    field: fieldState.field,
    step: "commercial_publish_guard",
    input: {
      value: fieldState.resolved_value,
      resolution_confidence: fieldState.resolution_confidence,
      source_summary: fieldState.source_summary || []
    },
    output: {
      resolved_value: null,
      status: identityStatuses.RESOLVED
    },
    decision: "dropped_weak_ocr_only_optional_code_before_publish",
    created_at: new Date().toISOString()
  }));
  const status = identityResolution.status === identityStatuses.CONFIRMED
    ? identityStatuses.RESOLVED
    : identityResolution.status;

  return {
    ...identityResolution,
    identity: nextIdentity,
    resolved_identity: nextIdentity,
    fields: nextIdentity,
    status,
    ambiguity_status: identityResolution.ambiguity_status === "CONFIRMED" ? "RESOLVED" : identityResolution.ambiguity_status,
    conflict_map: [...(identityResolution.conflict_map || []), ...conflicts],
    global_conflicts: [...(identityResolution.global_conflicts || []), ...conflicts],
    resolution_trace: [...(identityResolution.resolution_trace || []), ...trace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (!droppedFields.has(fieldState.field)) return fieldState;
      const conflict = conflicts.find((item) => item.field === fieldState.field);
      return {
        ...fieldState,
        resolved_value: null,
        decision_route: "DROP",
        ambiguity: false,
        conflicts: true,
        resolution_confidence: 0,
        resolution_reason: "dropped_weak_ocr_only_optional_code_before_publish",
        conflict_items: [...(fieldState.conflict_items || []), conflict].filter(Boolean)
      };
    }),
    identity_state: updateIdentityState(identityResolution, {
      status,
      fields: nextIdentity
    })
  };
}

function descriptorHasStrongConfirmation(fieldState = {}) {
  const summaries = Array.isArray(fieldState.source_summary) ? fieldState.source_summary : [];
  return summaries.some((summary) => {
    return [
      "SLAB_LABEL",
      "CARD_BACK_PRINTED_TEXT",
      "INTERNAL_APPROVED_HISTORY",
      "OFFICIAL_CHECKLIST",
      "STRUCTURED_DATABASE"
    ].includes(summary.source) || Number(summary.count || 0) >= 2;
  });
}

function applyOptionalColorDescriptorDrop(identityResolution = {}) {
  const drops = (identityResolution.field_states || []).filter((fieldState) => {
    return colorDescriptorFields.includes(fieldState.field)
      && hasValue(fieldState.resolved_value, fieldState.field)
      && descriptorColorTokens(fieldState.resolved_value).length > 0
      && !descriptorHasStrongConfirmation(fieldState);
  });
  if (!drops.length) return identityResolution;

  const nextIdentity = { ...(identityResolution.identity || {}) };
  const conflicts = drops.map((fieldState) => {
    nextIdentity[fieldState.field] = null;
    return {
      field: fieldState.field,
      conflict_type: "OPTIONAL_COLOR_DESCRIPTOR_REQUIRES_STRONG_CONFIRMATION",
      conflicting_values: [fieldState.resolved_value],
      severity: "MEDIUM",
      reason: `${fieldState.field} contains color wording but lacks independent printed back, registry, slab, or multi-source confirmation`,
      resolved: true,
      resolution: "dropped_optional_color_descriptor_before_render",
      selected_value: null
    };
  });
  const droppedFields = new Set(drops.map((fieldState) => fieldState.field));
  const trace = drops.map((fieldState) => ({
    field: fieldState.field,
    step: "commercial_publish_guard",
    input: {
      value: fieldState.resolved_value,
      color_tokens: descriptorColorTokens(fieldState.resolved_value)
    },
    output: {
      resolved_value: null,
      status: identityStatuses.RESOLVED
    },
    decision: "dropped_optional_color_descriptor_without_strong_confirmation",
    created_at: new Date().toISOString()
  }));
  const status = identityResolution.status === identityStatuses.CONFIRMED
    ? identityStatuses.RESOLVED
    : identityResolution.status;

  return {
    ...identityResolution,
    identity: nextIdentity,
    resolved_identity: nextIdentity,
    fields: nextIdentity,
    status,
    ambiguity_status: identityResolution.ambiguity_status === "CONFIRMED" ? "RESOLVED" : identityResolution.ambiguity_status,
    conflict_map: [...(identityResolution.conflict_map || []), ...conflicts],
    global_conflicts: [...(identityResolution.global_conflicts || []), ...conflicts],
    resolution_trace: [...(identityResolution.resolution_trace || []), ...trace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (!droppedFields.has(fieldState.field)) return fieldState;
      const conflict = conflicts.find((item) => item.field === fieldState.field);
      return {
        ...fieldState,
        resolved_value: null,
        decision_route: "DROP",
        ambiguity: false,
        conflicts: true,
        resolution_confidence: 0,
        resolution_reason: "dropped_optional_color_descriptor_without_strong_confirmation",
        conflict_items: [...(fieldState.conflict_items || []), conflict].filter(Boolean)
      };
    }),
    identity_state: updateIdentityState(identityResolution, {
      status,
      fields: nextIdentity
    })
  };
}

function focusedSerialVerificationFailed(trace = []) {
  return (Array.isArray(trace) ? trace : []).some((entry) => {
    return entry?.action === "CROP_AND_READ_SERIAL"
      && ["no_information", "error", "unavailable"].includes(entry?.status);
  });
}

function focusedSerialVerificationAttempted(trace = []) {
  return (Array.isArray(trace) ? trace : []).some((entry) => entry?.action === "CROP_AND_READ_SERIAL");
}

function focusedSerialVerificationConfirmed(trace = []) {
  return (Array.isArray(trace) ? trace : []).some((entry) => {
    const focused = entry?.output?.focused_vision || {};
    return entry?.action === "CROP_AND_READ_SERIAL"
      && entry?.status === "executed"
      && Array.isArray(focused.updated_fields)
      && focused.updated_fields.includes("serial_number")
      && !(Array.isArray(focused.conflicting_fields) && focused.conflicting_fields.includes("serial_number"));
  });
}

function serialHasStrongConfirmation(identityResolution = {}) {
  const serialState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "serial_number");
  const summaries = Array.isArray(serialState?.source_summary) ? serialState.source_summary : [];
  return summaries.some((summary) => {
    return [
      "SLAB_LABEL",
      "CARD_BACK_PRINTED_TEXT",
      "INTERNAL_APPROVED_HISTORY",
      "OFFICIAL_CHECKLIST",
      "STRUCTURED_DATABASE"
    ].includes(summary.source);
  });
}

function applyHighRiskVerificationGuard(identityResolution = {}, {
  identity = {},
  trace = []
} = {}) {
  if (!hasValue(identity.serial_number, "serial_number")) return identityResolution;
  const failedFocusedSerial = focusedSerialVerificationFailed(trace);
  const attemptedFocusedSerial = focusedSerialVerificationAttempted(trace);
  const confirmedFocusedSerial = focusedSerialVerificationConfirmed(trace);
  const lacksStrongSerialConfirmation = attemptedFocusedSerial
    && !confirmedFocusedSerial
    && !serialHasStrongConfirmation(identityResolution);
  if (!failedFocusedSerial && !lacksStrongSerialConfirmation) return identityResolution;

  const conflict = {
    field: "serial_number",
    conflict_type: failedFocusedSerial
      ? "SERIAL_FOCUSED_VERIFICATION_FAILED"
      : "SERIAL_REQUIRES_STRONG_CONFIRMATION",
    conflicting_values: [identity.serial_number],
    severity: "HIGH",
    reason: failedFocusedSerial
      ? "serial_number was present, but focused serial reread could not verify it"
      : "serial_number has only single front-image confirmation after focused reread",
    resolved: false
  };
  const guardTrace = {
    field: "serial_number",
    step: "high_risk_verification_guard",
    input: {
      serial_number: identity.serial_number,
      focused_action: "CROP_AND_READ_SERIAL"
    },
    output: {
      status: identityStatuses.ABSTAIN,
      route: "MANUAL_REQUIRED"
    },
    decision: failedFocusedSerial
      ? "serial_number_requires_operator_review_after_failed_focused_reread"
      : "serial_number_requires_operator_review_without_strong_confirmation",
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    status: identityStatuses.ABSTAIN,
    ambiguity_status: "AMBIGUOUS",
    conflict_map: [...(identityResolution.conflict_map || []), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), guardTrace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (fieldState.field !== "serial_number") return fieldState;
      return {
        ...fieldState,
        decision_route: "ABSTAIN",
        ambiguity: true,
        conflicts: true,
        resolution_reason: guardTrace.decision,
        conflict_items: [...(fieldState.conflict_items || []), conflict]
      };
    }),
    identity_state: identityResolution.identity_state
      ? {
          ...identityResolution.identity_state,
          status: identityStatuses.ABSTAIN,
          conflict_graph: identityResolution.identity_state.conflict_graph || []
        }
      : identityResolution.identity_state
  };
}

export function applyIdentityResolutionGate(result = {}, {
  maxLength = 80,
  providerId = result.provider || result.source || "",
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = []
} = {}) {
  const evidenceDocument = {
    evidence: result.evidence || {},
    resolved: result.resolved || {},
    unresolved: result.unresolved || []
  };
  const evidenceItems = evidenceDocumentToIdentityEvidenceItems(evidenceDocument, { providerId });
  const criticalFields = criticalFieldsForIdentityResolution(evidenceDocument.resolved, evidenceItems);
  const identityResolution = resolveIdentity({
    evidenceItems,
    resolvedHint: evidenceDocument.resolved,
    retrievalCandidates,
    registryRecords,
    productSchemas,
    options: {
      includeResolvedHint: evidenceItems.length === 0,
      criticalFields
    }
  });
  const optionalCodeGuardedIdentityResolution = applyWeakOcrOnlyOptionalCodeDrop(identityResolution);
  const confidenceGuardedIdentityResolution = applyCriticalFieldConfidenceGuard(optionalCodeGuardedIdentityResolution, criticalFields);
  const descriptorGuardedIdentityResolution = applyOptionalColorDescriptorDrop(confidenceGuardedIdentityResolution);
  const identity = descriptorGuardedIdentityResolution.identity;
  const highRiskGuardedIdentityResolution = applyHighRiskVerificationGuard(descriptorGuardedIdentityResolution, {
    identity,
    trace: result.resolution_trace || []
  });
  const lotGuard = multiCardLotGuardInfo({
    identity,
    resolved: evidenceDocument.resolved,
    fields: result.fields || {},
    unresolved: evidenceDocument.unresolved || [],
    reason: result.reason
  });
  const gatedIdentityResolution = applyMultiCardLotGuard(highRiskGuardedIdentityResolution, lotGuard);
  const convergenceReport = result.convergence_report || null;
  const finalIdentity = gatedIdentityResolution.identity || identity;
  const presentation = renderListingPresentation({
    resolved: finalIdentity,
    evidence: result.evidence || {},
    maxLength
  });
  const titlePolicy = presentation.title_length_policy || {};
  const blockedRequiredTitleTerms = Array.isArray(titlePolicy.blocked_required_terms)
    ? titlePolicy.blocked_required_terms
    : [];
  const titleLanguageBlocked = blockedRequiredTitleTerms.length > 0
    || containsNonEnglishTitleScript(presentation.final_title);
  const canRenderFinalTitle = gatedIdentityResolution.status !== identityStatuses.ABSTAIN
    && Boolean(presentation.final_title)
    && !titleLanguageBlocked;
  const unresolved = unique([
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    ...unresolvedFromIdentityResolution(gatedIdentityResolution, criticalFields),
    ...(titleLanguageBlocked ? ["title blocked: required identity text is not English"] : []),
    ...(lotGuard.detected ? ["multi-card lot requires single-card split or manual lot workflow"] : []),
    ...(!canRenderFinalTitle ? ["identity resolution abstain"] : [])
  ]).slice(0, 16);
  const finalTitle = canRenderFinalTitle ? presentation.final_title : "";

  return {
    ...result,
    title: finalTitle,
    final_title: finalTitle,
    rendered_title: presentation.rendered_title || "",
    title_render_source: canRenderFinalTitle ? "identity_resolution_deterministic_renderer" : "identity_resolution_abstain",
    confidence: canRenderFinalTitle ? confidenceForIdentityStatus(gatedIdentityResolution.status) : "LOW",
    reason: mergeReason(resolutionReason(gatedIdentityResolution), result.reason),
    fields: publicLegacyFields(finalIdentity, result.fields || {}),
    resolved: finalIdentity,
    route: lotGuard.detected ? "NON_STANDARD_MANUAL" : result.route,
    route_reason: lotGuard.detected ? "Multiple cards or lot image cannot be published as one resolved card identity." : result.route_reason,
    identity_resolution_status: gatedIdentityResolution.status,
    ambiguity_status: gatedIdentityResolution.ambiguity_status,
    identity_resolution: {
      ...gatedIdentityResolution,
      convergence_report: convergenceReport
    },
    convergence_report: convergenceReport,
    field_states: gatedIdentityResolution.field_states,
    conflict_graph: gatedIdentityResolution.conflict_graph,
    conflict_map: gatedIdentityResolution.conflict_map,
    confidence_report: gatedIdentityResolution.confidence_report,
    unresolved,
    modules: canRenderFinalTitle ? presentation.modules : result.modules,
    module_order: canRenderFinalTitle ? presentation.module_order : result.module_order,
    renderer: canRenderFinalTitle ? presentation.renderer : result.renderer,
    renderer_version: canRenderFinalTitle ? presentation.renderer_version : result.renderer_version,
    title_length_policy: presentation.title_length_policy || result.title_length_policy,
    resolution_trace: [
      ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
      ...(Array.isArray(gatedIdentityResolution.resolution_trace) ? gatedIdentityResolution.resolution_trace : [])
    ]
  };
}
