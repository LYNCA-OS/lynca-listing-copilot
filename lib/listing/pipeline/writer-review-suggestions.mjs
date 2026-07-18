import { createEvidenceField, createVisionSource } from "../evidence/evidence-schema.mjs";

const visualSourceTypes = new Set(["VISION_MODEL", "VISION_ONLY", "VISUAL_GUESS"]);
const opticalParallelPattern = /\b(?:cracked\s+ice|disco|geometric|holo(?:graphic)?|lava|mojo|prism|prizm|refractor|sapphire|shimmer|sparkle|speckle|tiger(?:\s+stripe)?|velocity|vinyl|wave|x[-\s]?fractor)\b/i;
const parallelFieldNames = new Set(["parallel_exact", "parallel_family", "parallel"]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function comparable(value) {
  return normalizeText(value).toLowerCase();
}

function numericConfidence(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function conflictsField(conflict, fieldName) {
  const conflictField = normalizeText(
    typeof conflict === "string"
      ? conflict
      : conflict?.field || conflict?.field_name || conflict?.name || conflict?.conflicting_field
  ).toLowerCase();
  return conflictField === fieldName || (fieldName === "parallel_exact" && conflictField === "parallel");
}

function matchingVisualEvidence(fieldEvidence = [], value = "") {
  const expected = comparable(value);
  if (!expected) return null;

  return (Array.isArray(fieldEvidence) ? fieldEvidence : []).find((entry) => {
    const fieldName = normalizeText(entry?.field).toLowerCase();
    const sourceType = normalizeText(entry?.source_type || entry?.source).toUpperCase();
    const entryValue = comparable(entry?.value);
    return parallelFieldNames.has(fieldName)
      && visualSourceTypes.has(sourceType)
      && entryValue === expected
      && entry?.review_required === true
      && (entry?.direct_observation === true || entry?.directly_observed === true);
  }) || null;
}

export function visualParallelWriterSuggestion({
  rawFields = {},
  resolved = {},
  fieldEvidence = [],
  conflicts = [],
  minimumConfidence = 0.8
} = {}) {
  const value = normalizeText(
    rawFields.parallel_exact
    || rawFields.parallel_family
    || rawFields.parallel
  );
  if (!value || !opticalParallelPattern.test(value)) return null;
  if (!normalizeText(rawFields.product || rawFields.set || resolved.product || resolved.set)) return null;
  if ((Array.isArray(conflicts) ? conflicts : []).some((conflict) => conflictsField(conflict, "parallel_exact"))) return null;

  const evidence = matchingVisualEvidence(fieldEvidence, value);
  if (!evidence) return null;
  const confidence = numericConfidence(evidence.confidence);
  if (confidence === null || confidence < minimumConfidence) return null;

  return {
    field: "parallel_exact",
    value,
    confidence,
    source_type: normalizeText(evidence.source_type || evidence.source).toUpperCase(),
    source_image_id: normalizeText(evidence.source_image_id || evidence.image_id) || null,
    source_region: normalizeText(evidence.source_region || evidence.region) || "parallel_surface",
    visible_text: normalizeText(evidence.visible_text || evidence.raw_text) || value,
    review_required: true,
    identity_application: "BLOCKED_PENDING_WRITER_CONFIRMATION",
    presentation_application: "WRITER_REVIEW_SUGGESTION"
  };
}

export function writerSuggestionEvidenceNode(suggestion = null) {
  if (!suggestion?.value) return null;
  const source = createVisionSource({
    sourceType: "VISION_MODEL",
    imageId: suggestion.source_image_id || null,
    region: suggestion.source_region || "parallel_surface",
    observedText: suggestion.visible_text || suggestion.value,
    rawText: suggestion.visible_text || suggestion.value,
    sourceInferenceMethod: "current_image_visual_hypothesis",
    trustTier: 3
  });
  source.direct_observation = true;
  source.text_visible = false;

  return createEvidenceField({
    value: suggestion.value,
    normalizedValue: suggestion.value,
    status: "REVIEW",
    confidence: suggestion.confidence,
    candidates: [{
      value: suggestion.value,
      confidence: suggestion.confidence,
      sources: [source]
    }],
    sources: [source],
    conflicts: [],
    unresolvedReason: "visual_parallel_writer_confirmation_required"
  });
}
