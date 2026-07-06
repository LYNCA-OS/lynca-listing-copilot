import {
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields
} from "../evidence/evidence-schema.mjs";

const directFieldAliases = Object.freeze({
  subject: "players",
  player: "players",
  players: "players",
  multiCard: "multi_card",
  cardCount: "card_count",
  card_number: "collector_number",
  cardNumber: "collector_number",
  print_run_number: "print_run_number",
  print_run_numerator: "print_run_numerator",
  print_run_denominator: "print_run_denominator",
  numbered_to: "numbered_to",
  serial_number: "serial_number",
  serial_denominator: "serial_denominator",
  checklist: "checklist_code",
  checklistNumber: "checklist_code",
  checklist_number: "checklist_code",
  cardType: "card_type",
  grade: "card_grade",
  slab_grade: "card_grade",
  autograph_grade: "auto_grade"
});

const ignoredCompoundFields = new Set([
  "grade_label",
  "year_product",
  "back_text"
]);

const resolvedFieldNames = new Set(Object.keys(normalizeResolvedFields({})));

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function normalizeFieldName(field) {
  const raw = String(field || "").trim();
  if (!raw || ignoredCompoundFields.has(raw)) return null;
  const aliased = directFieldAliases[raw] || directFieldAliases[raw.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] || raw;
  return resolvedFieldNames.has(aliased) ? aliased : null;
}

function roleForItem(item = {}, imageById = new Map()) {
  const imageId = item.image_id || item.imageId || "";
  const image = imageById.get(imageId) || {};
  return normalizeText(item.role || item.capture_role || item.storage_role || image.role || image.storageRole || image.storage_role).toLowerCase();
}

function sideForItem(item = {}, role = "") {
  const side = normalizeText(item.side).toLowerCase();
  if (side === "front" || side === "back") return side;
  if (role.includes("back")) return "back";
  if (role.includes("front")) return "front";
  return null;
}

function sourceTypeForRecognitionItem(item = {}, field = "", imageById = new Map()) {
  const explicit = normalizeText(item.source_type || item.source).toUpperCase();
  if (["SLAB_LABEL", "CARD_FRONT", "CARD_BACK", "OCR"].includes(explicit)) return explicit;
  if (["OCR_FRONT", "FRONT_OCR", "CARD_FRONT_PRINTED_TEXT"].includes(explicit)) return "CARD_FRONT";
  if (["OCR_BACK", "BACK_OCR", "CARD_BACK_PRINTED_TEXT"].includes(explicit)) return "CARD_BACK";
  if (["VISUAL_GUESS", "IMAGE_STRUCTURE", "MULTI_CARD_DETECTOR"].includes(explicit)) return "VISUAL_GUESS";

  const role = roleForItem(item, imageById);
  const text = normalizeText(item.observed_text || item.text || item.value).toLowerCase();
  const gradeField = ["grade_company", "card_grade", "auto_grade", "grade_type"].includes(field);
  if (role.includes("grade_label") || role.includes("slab") || gradeField || /\b(?:psa|bgs|beckett|cgc|sgc)\b/.test(text)) {
    return "SLAB_LABEL";
  }
  if (role.includes("back") || normalizeText(item.side).toLowerCase() === "back") return "CARD_BACK";
  if (role.includes("front") || normalizeText(item.side).toLowerCase() === "front") return "CARD_FRONT";
  return "OCR";
}

function regionForItem(item = {}) {
  if (item.region) return item.region;
  if (item.region_id) return item.region_id;
  if (item.bbox) return { bbox: item.bbox };
  if (item.polygon) return { polygon: item.polygon };
  return null;
}

function confidenceForItem(item = {}, fallback = 0.68) {
  const value = Number(item.confidence ?? item.score ?? item.ocr_confidence ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function imageMap(images = []) {
  return new Map((images || []).map((image, index) => {
    const id = image.image_id || image.id || `image_${index + 1}`;
    return [id, image];
  }));
}

function sourceForEntry(item = {}, field = "", imagesById = new Map()) {
  const role = roleForItem(item, imagesById);
  const sourceType = sourceTypeForRecognitionItem(item, field, imagesById);
  const side = sideForItem(item, role);

  return createVisionSource({
    sourceType,
    imageId: item.image_id || item.imageId || null,
    side,
    captureRole: role || item.capture_role || null,
    region: regionForItem(item),
    observedText: normalizeText(item.observed_text || item.text || item.raw_text || item.value),
    glareOcclusion: item.glare_occlusion ?? item.glare_score ?? null,
    blurScore: item.blur_score ?? item.focus_score ?? null,
    trustTier: sourceType === "SLAB_LABEL" ? 1 : 2
  });
}

function fieldEntriesFromObject(fields = {}, item = {}, imagesById = new Map()) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.entries(fields).flatMap(([rawField, rawValue]) => {
    const field = normalizeFieldName(rawField);
    if (!field || !hasValue(rawValue)) return [];
    const source = sourceForEntry({
      ...item,
      observed_text: item.observed_text || item.text || rawValue
    }, field, imagesById);
    return [{
      field,
      value: rawValue,
      confidence: confidenceForItem(item),
      source
    }];
  });
}

function fieldEntriesFromItem(item = {}, imagesById = new Map()) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return [];

  const parsedEntries = [
    ...fieldEntriesFromObject(item.parsed_fields, item, imagesById),
    ...fieldEntriesFromObject(item.resolved_fields, item, imagesById),
    ...fieldEntriesFromObject(item.fields, item, imagesById)
  ];
  if (parsedEntries.length) return parsedEntries;

  const field = normalizeFieldName(item.field || item.field_name || item.name);
  if (!field) return [];

  const candidates = Array.isArray(item.candidates) && item.candidates.length
    ? item.candidates
    : [{ value: item.value ?? item.normalized_value ?? item.text ?? item.observed_text, confidence: confidenceForItem(item) }];

  return candidates.flatMap((candidate) => {
    const value = candidate?.value ?? candidate?.normalized_value ?? candidate?.text;
    if (!hasValue(value)) return [];
    const source = sourceForEntry({
      ...item,
      observed_text: item.observed_text || candidate?.observed_text || candidate?.text || value
    }, field, imagesById);
    return [{
      field,
      value,
      confidence: confidenceForItem(candidate, confidenceForItem(item)),
      source
    }];
  });
}

function entriesFromMultiCardDetection(response = {}) {
  const detection = response.multi_card_detection;
  if (!detection || typeof detection !== "object" || Array.isArray(detection)) return [];
  if (detection.status && detection.status !== "OK") return [];

  const cardCount = Number(detection.card_count_estimate ?? detection.card_count);
  const hasCount = Number.isInteger(cardCount) && cardCount >= 1;
  const multiCard = detection.multi_card === true || cardCount > 1;
  if (!multiCard) return [];

  const source = sourceForEntry({
    image_id: detection.image_id || (Array.isArray(detection.images) ? detection.images.find((item) => item?.image_id)?.image_id : null),
    role: detection.role || (Array.isArray(detection.images) ? detection.images.find((item) => item?.role)?.role : null),
    source_type: "VISUAL_GUESS",
    confidence: detection.confidence,
    observed_text: multiCard
      ? `multi-card detector estimated ${hasCount ? cardCount : "multiple"} cards`
      : "",
    region: {
      algorithm: detection.algorithm || "multi_card_detector",
      candidates: Array.isArray(detection.images)
        ? detection.images.flatMap((image) => Array.isArray(image?.candidates) ? image.candidates : []).slice(0, 8)
        : []
    }
  }, "multi_card");
  const confidence = confidenceForItem(detection, multiCard ? 0.72 : 0.55);
  const entries = [{
    field: "multi_card",
    value: multiCard,
    confidence,
    source
  }];

  if (hasCount) {
    entries.push({
      field: "card_count",
      value: cardCount,
      confidence,
      source
    });
  }

  if (multiCard) {
    entries.push({
      field: "lot_type",
      value: "multi_card_lot",
      confidence,
      source
    });
  }

  return entries;
}

function entriesFromRecognitionResponse(response = {}, images = []) {
  const imagesById = imageMap(images);
  const ocrItems = Array.isArray(response.ocr_evidence?.items) ? response.ocr_evidence.items : [];
  const fusedItems = Array.isArray(response.evidence_fusion?.items) ? response.evidence_fusion.items : [];
  const directItems = Array.isArray(response.evidence_items) ? response.evidence_items : [];
  const itemEntries = [...ocrItems, ...fusedItems, ...directItems].flatMap((item) => fieldEntriesFromItem(item, imagesById));
  const multiCardEntries = entriesFromMultiCardDetection(response);

  const resolvedEntries = fieldEntriesFromObject(
    response.resolved_fields || response.evidence_fusion?.resolved_fields || {},
    {
      source_type: "OCR",
      confidence: 0.62,
      observed_text: "recognition resolved fields"
    },
    imagesById
  );

  return [...multiCardEntries, ...itemEntries, ...resolvedEntries];
}

function candidateKey(field, value) {
  const text = Array.isArray(value) ? value.join(" / ") : value;
  return `${field}:${normalizeText(text).toLowerCase()}`;
}

function groupEntries(entries = []) {
  const grouped = new Map();
  entries.forEach((entry) => {
    if (!entry?.field || !hasValue(entry.value)) return;
    if (!grouped.has(entry.field)) grouped.set(entry.field, []);
    grouped.get(entry.field).push(entry);
  });
  return grouped;
}

function conflictItems(field, entries = []) {
  const values = [...new Set(entries.map((entry) => candidateKey(field, entry.value)))];
  if (values.length <= 1) return [];
  return [{
    field,
    conflict_type: "RECOGNITION_OCR_VALUE_CONFLICT",
    conflicting_values: entries.map((entry) => entry.value),
    severity: "MEDIUM",
    reason: "Recognition worker returned multiple OCR candidates for the same identity field."
  }];
}

function evidenceFieldFromEntries(field, entries = []) {
  const byCandidate = new Map();
  entries.forEach((entry) => {
    const key = candidateKey(field, entry.value);
    const existing = byCandidate.get(key);
    if (!existing || entry.confidence > existing.confidence) {
      byCandidate.set(key, {
        value: entry.value,
        confidence: entry.confidence,
        sources: [entry.source]
      });
    } else {
      existing.sources.push(entry.source);
    }
  });

  const candidates = [...byCandidate.values()]
    .sort((left, right) => right.confidence - left.confidence);
  const top = candidates[0] || null;
  const conflicts = conflictItems(field, entries);

  return createEvidenceField({
    value: top?.value ?? null,
    normalizedValue: top?.value ?? null,
    status: conflicts.length ? "CONFLICT" : top?.confidence >= 0.86 ? "CONFIRMED" : "REVIEW",
    confidence: top?.confidence ?? 0,
    candidates,
    sources: candidates.flatMap((candidate) => candidate.sources || []),
    conflicts,
    unresolvedReason: top ? null : "recognition_worker_no_candidate"
  });
}

function resolvedFromEvidence(evidence = {}) {
  const raw = {};
  Object.entries(evidence).forEach(([field, evidenceField]) => {
    if (!hasValue(evidenceField?.value)) return;
    raw[field] = evidenceField.value;
  });
  return normalizeResolvedFields(raw);
}

export function recognitionResponseToEvidenceDocument(response = {}, {
  images = []
} = {}) {
  const entries = entriesFromRecognitionResponse(response, images);
  const grouped = groupEntries(entries);
  const evidence = {};

  grouped.forEach((fieldEntries, field) => {
    evidence[field] = evidenceFieldFromEntries(field, fieldEntries);
  });

  return {
    evidence,
    resolved: resolvedFromEvidence(evidence),
    unresolved: response.unavailable
      ? [`recognition worker unavailable: ${response.reason || "unknown"}`]
      : entries.length
        ? []
        : ["recognition worker produced no field evidence"],
    recognition: {
      asset_id: response.asset_id || null,
      unavailable: response.unavailable === true,
      status: response.ocr_evidence?.status || response.processing?.status || null,
      pipeline_version: response.processing?.pipeline_version || null,
      latency_ms: response.processing?.latency_ms ?? null,
      visual_features: response.visual_features && typeof response.visual_features === "object"
        ? response.visual_features
        : {}
    },
    resolution_trace: [
      {
        phase: "recognition_worker",
        step: "normalize_recognition_evidence",
      input: {
        asset_id: response.asset_id || null,
        ocr_item_count: Array.isArray(response.ocr_evidence?.items) ? response.ocr_evidence.items.length : 0,
        direct_item_count: Array.isArray(response.evidence_items) ? response.evidence_items.length : 0,
        multi_card_detection_status: response.multi_card_detection?.status || null
      },
        output: {
          evidence_fields: Object.keys(evidence),
          unavailable: response.unavailable === true
        },
        decision: entries.length ? "emit_evidence_document" : "no_recognition_evidence",
        created_at: new Date().toISOString()
      }
    ],
    schema_version: "evidence-fields-v1"
  };
}

export function hasRecognitionEvidence(document = {}) {
  return Boolean(document && Object.keys(document.evidence || {}).length > 0);
}
