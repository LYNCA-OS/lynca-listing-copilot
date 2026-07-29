import {
  classifyAnchorText,
  normalizeGrader
} from "./anchor-classifier.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function clamp01(value, fallback = 0.78) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function list(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return hasValue(value) ? [cleanText(value)] : [];
}

const directCurrentImageSources = new Set([
  "OCR",
  "CARD_FRONT",
  "CARD_BACK",
  "SLAB_LABEL",
  "OPERATOR"
]);

function evidenceMap(document = {}) {
  const hard = document.evidence && typeof document.evidence === "object" && !Array.isArray(document.evidence)
    ? document.evidence
    : {};
  const retrievalContext = document.retrieval_context_evidence
    && typeof document.retrieval_context_evidence === "object"
    && !Array.isArray(document.retrieval_context_evidence)
    ? document.retrieval_context_evidence
    : {};
  return { ...retrievalContext, ...hard };
}

function evidenceFieldValue(field = {}) {
  return field.normalized_value ?? field.normalizedValue ?? field.value ?? null;
}

function evidenceFieldSources(field = {}) {
  const value = evidenceFieldValue(field);
  const candidates = Array.isArray(field.candidates) ? field.candidates : [];
  const matchingCandidate = candidates.find((candidate) => cleanText(candidate?.value) === cleanText(value));
  const sources = [
    ...(Array.isArray(matchingCandidate?.sources) ? matchingCandidate.sources : []),
    ...(Array.isArray(field.sources) ? field.sources : [])
  ].filter((source) => source && typeof source === "object" && !Array.isArray(source));
  const seen = new Set();
  return sources.filter((source) => {
    const key = JSON.stringify([
      source.source_type || null,
      source.image_id || null,
      source.source_crop_id || null,
      source.raw_text || null,
      source.observed_text || null
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceType(source = {}) {
  return cleanText(source.source_type || source.sourceType).toUpperCase();
}

function bestEvidenceSource(field = {}) {
  const sources = evidenceFieldSources(field);
  return sources.find((source) => directCurrentImageSources.has(sourceType(source))) || sources[0] || {};
}

function evidenceFieldIsDirect(field = {}) {
  const status = cleanText(field.status).toUpperCase();
  const conflicts = Array.isArray(field.conflicts) ? field.conflicts : [];
  return ["CONFIRMED", "MANUAL_CONFIRMED"].includes(status)
    && conflicts.length === 0
    && evidenceFieldSources(field).some((source) => directCurrentImageSources.has(sourceType(source)));
}

function addCandidate(target, value, evidenceField = {}, fallbackConfidence = 0.78) {
  const normalized = cleanText(value);
  if (!normalized) return;
  const source = bestEvidenceSource(evidenceField);
  target.push({
    value: normalized,
    confidence: clamp01(evidenceField.confidence, fallbackConfidence),
    source_type: sourceType(source) || "CANONICAL_EVIDENCE",
    source_image_id: cleanText(source.image_id || source.imageId),
    crop_type: cleanText(source.region || source.source_crop_id || source.sourceCropId),
    raw_text: cleanText(source.raw_text || source.rawText || source.observed_text || source.observedText),
    evidence_status: cleanText(evidenceField.status).toUpperCase(),
    conflicts: Array.isArray(evidenceField.conflicts) ? evidenceField.conflicts : [],
    direct: evidenceFieldIsDirect(evidenceField)
  });
}

function best(candidates = []) {
  return [...candidates].sort((left, right) => (
    Number(right.direct === true) - Number(left.direct === true)
    || Number(right.confidence || 0) - Number(left.confidence || 0)
  ))[0] || null;
}

function dedupeAnchors(anchors = []) {
  const seen = new Set();
  return anchors.filter((anchor) => {
    const key = `${anchor.anchor_type}:${anchor.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function anchorCandidateBuckets(anchors = []) {
  const rows = (type) => anchors
    .filter((anchor) => anchor.anchor_type === type)
    .map((anchor) => ({
      value: anchor.normalized,
      confidence: anchor.confidence,
      direct: anchor.direct === true,
      source_type: anchor.source_type,
      source_field: anchor.source_field,
      grader: anchor.grader || undefined
    }));
  return {
    tcg_code: rows("tcg_card_code"),
    card_number: [...rows("checklist_code"), ...rows("collector_number")],
    checklist_code: rows("checklist_code"),
    collector_number: rows("collector_number"),
    product_code: rows("product_code"),
    barcode: rows("barcode_candidate"),
    cert_number: rows("cert_number"),
    numerical_rarity: rows("numerical_rarity")
  };
}

export function extractAnchorDossier(evidenceDocument = {}) {
  const evidence = evidenceMap(evidenceDocument);
  const contextCandidates = {
    year: [],
    product: [],
    subjects: [],
    grader: []
  };

  const addContextField = (target, fieldName, transform = (value) => value) => {
    const field = evidence[fieldName];
    if (!field || typeof field !== "object") return;
    list(transform(evidenceFieldValue(field))).forEach((value) => addCandidate(target, value, field));
  };
  addContextField(contextCandidates.year, "year");
  addContextField(contextCandidates.product, "product");
  addContextField(contextCandidates.product, "set");
  addContextField(contextCandidates.subjects, "players");
  addContextField(contextCandidates.subjects, "character");
  addContextField(contextCandidates.grader, "grade_company", normalizeGrader);

  const evidenceAnchors = [];
  const resolvedGrader = normalizeGrader(best(contextCandidates.grader)?.value);
  for (const [fieldName, evidenceField] of Object.entries(evidence)) {
    if (!evidenceField || typeof evidenceField !== "object" || Array.isArray(evidenceField)) continue;
    const field = cleanText(fieldName).toLowerCase();
    const value = evidenceFieldValue(evidenceField);
    const confidence = clamp01(evidenceField.confidence, 0.78);
    const source = bestEvidenceSource(evidenceField);
    const cropHint = cleanText(source.region || source.source_crop_id || source.sourceCropId);
    if (!hasValue(value)) continue;

    const anchor = classifyAnchorText(value, {
      graderHint: resolvedGrader,
      fieldHint: field,
      cropHint
    });
    if (!anchor || anchor.anchor_type === "unknown") continue;
    evidenceAnchors.push({
      ...anchor,
      confidence,
      source_field: field,
      source_type: sourceType(source) || "CANONICAL_EVIDENCE",
      source_image_id: cleanText(source.image_id || source.imageId),
      crop_type: cropHint,
      raw_text: cleanText(source.raw_text || source.rawText || source.observed_text || source.observedText),
      evidence_status: cleanText(evidenceField.status).toUpperCase(),
      conflicts: Array.isArray(evidenceField.conflicts) ? evidenceField.conflicts : [],
      direct: evidenceFieldIsDirect(evidenceField),
      provenance: {
        source_crop_id: cleanText(source.source_crop_id || source.sourceCropId),
        source_inference_method: cleanText(source.source_inference_method || source.sourceInferenceMethod),
        source_object_path: cleanText(source.source_object_path || source.sourceObjectPath),
        derived_object_path: cleanText(source.derived_object_path || source.derivedObjectPath)
      }
    });
  }
  const anchors = dedupeAnchors(evidenceAnchors).map((anchor) => (
    anchor.anchor_type === "cert_number" && !anchor.grader && resolvedGrader
      ? { ...anchor, grader: resolvedGrader }
      : anchor
  ));
  const year = best(contextCandidates.year);
  const product = best(contextCandidates.product);
  const subjects = contextCandidates.subjects
    .sort((left, right) => Number(right.direct === true) - Number(left.direct === true) || right.confidence - left.confidence)
    .filter((entry, index, all) => all.findIndex((other) => other.value.toLowerCase() === entry.value.toLowerCase()) === index)
    .slice(0, 4);
  const grader = best(contextCandidates.grader);

  return {
    schema_version: "v4-anchor-dossier-v2",
    source_document_schema_version: cleanText(evidenceDocument.schema_version),
    anchors,
    anchor_candidates: anchorCandidateBuckets(anchors),
    context: {
      year: year?.value || "",
      year_confidence: year?.confidence ?? null,
      year_direct: year?.direct === true,
      manufacturer: cleanText(evidenceFieldValue(evidence.manufacturer || evidence.brand || {})),
      product: product?.value || "",
      product_confidence: product?.confidence ?? null,
      product_direct: product?.direct === true,
      set: cleanText(evidenceFieldValue(evidence.set || {})),
      subjects: subjects.map((entry) => entry.value),
      subject_confidence: subjects[0]?.confidence ?? null,
      subject_direct: subjects.some((entry) => entry.direct === true),
      grader: normalizeGrader(grader?.value || evidenceFieldValue(evidence.grade_company || {}))
    },
    patch_count: Number(evidenceDocument.resolution_trace?.[0]?.input?.patch_count || Object.keys(evidence).length),
    evidence_field_count: Object.keys(evidence).length,
    conflicted_field_count: Object.values(evidence).filter((field) => Array.isArray(field?.conflicts) && field.conflicts.length > 0).length,
    direct_anchor_count: anchors.filter((anchor) => anchor.direct === true).length,
    rejected_fields: Array.isArray(evidenceDocument.resolution_trace?.[0]?.output?.skipped_fields)
      ? evidenceDocument.resolution_trace[0].output.skipped_fields
      : []
  };
}

export function resolvedHintFromAnchorDossier(dossier = {}) {
  const context = dossier.context || {};
  const tcg = dossier.anchors?.find((anchor) => anchor.anchor_type === "tcg_card_code");
  const checklist = dossier.anchors?.find((anchor) => anchor.anchor_type === "checklist_code");
  const collector = dossier.anchors?.find((anchor) => anchor.anchor_type === "collector_number");
  return Object.fromEntries(Object.entries({
    year: context.year,
    manufacturer: context.manufacturer,
    product: context.product,
    set: context.set,
    players: context.subjects?.length ? context.subjects : undefined,
    tcg_card_number: tcg?.normalized,
    checklist_code: checklist?.normalized,
    collector_number: collector?.normalized
  }).filter(([, value]) => hasValue(value)));
}
