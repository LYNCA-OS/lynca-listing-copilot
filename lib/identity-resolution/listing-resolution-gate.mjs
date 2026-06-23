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
  "parallel",
  "card_type",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
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
          metadata: sourceMetadata(source)
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
    ...(evidenceFields.has("year") || hasValue(normalized.year, "year") ? ["year"] : []),
    ...(evidenceFields.has("product") || hasValue(normalized.product, "product") ? ["product"] : []),
    subjectField,
    ...criticalOptionalFields.filter((field) => evidenceFields.has(field) || hasValue(normalized[field], field))
  ]);
}

function unresolvedFromIdentityResolution(identityResolution = {}, criticalFields = []) {
  const critical = new Set(criticalFields);
  return (identityResolution.field_states || [])
    .filter((fieldState) => {
      return critical.has(fieldState.field)
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
  const identity = identityResolution.identity;
  const presentation = renderListingPresentation({
    resolved: identity,
    evidence: result.evidence || {},
    maxLength
  });
  const titlePolicy = presentation.title_length_policy || {};
  const blockedRequiredTitleTerms = Array.isArray(titlePolicy.blocked_required_terms)
    ? titlePolicy.blocked_required_terms
    : [];
  const titleLanguageBlocked = blockedRequiredTitleTerms.length > 0
    || containsNonEnglishTitleScript(presentation.final_title);
  const canRenderFinalTitle = identityResolution.status !== identityStatuses.ABSTAIN
    && Boolean(presentation.final_title)
    && !titleLanguageBlocked;
  const unresolved = unique([
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    ...unresolvedFromIdentityResolution(identityResolution, criticalFields),
    ...(titleLanguageBlocked ? ["title blocked: required identity text is not English"] : []),
    ...(!canRenderFinalTitle ? ["identity resolution abstain"] : [])
  ]).slice(0, 16);
  const finalTitle = canRenderFinalTitle ? presentation.final_title : "";

  return {
    ...result,
    title: finalTitle,
    final_title: finalTitle,
    rendered_title: presentation.rendered_title || "",
    title_render_source: canRenderFinalTitle ? "identity_resolution_deterministic_renderer" : "identity_resolution_abstain",
    confidence: canRenderFinalTitle ? confidenceForIdentityStatus(identityResolution.status) : "LOW",
    reason: mergeReason(resolutionReason(identityResolution), result.reason),
    fields: publicLegacyFields(identity, result.fields || {}),
    resolved: identity,
    identity_resolution_status: identityResolution.status,
    ambiguity_status: identityResolution.ambiguity_status,
    identity_resolution: identityResolution,
    field_states: identityResolution.field_states,
    conflict_graph: identityResolution.conflict_graph,
    conflict_map: identityResolution.conflict_map,
    confidence_report: identityResolution.confidence_report,
    unresolved,
    modules: canRenderFinalTitle ? presentation.modules : result.modules,
    module_order: canRenderFinalTitle ? presentation.module_order : result.module_order,
    renderer: canRenderFinalTitle ? presentation.renderer : result.renderer,
    renderer_version: canRenderFinalTitle ? presentation.renderer_version : result.renderer_version,
    title_length_policy: presentation.title_length_policy || result.title_length_policy,
    resolution_trace: [
      ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
      ...(Array.isArray(identityResolution.resolution_trace) ? identityResolution.resolution_trace : [])
    ]
  };
}
