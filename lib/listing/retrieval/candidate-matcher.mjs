import { normalizeResolvedFields, resolvedFieldNames } from "../evidence/evidence-schema.mjs";

export const defaultCandidateSelectionMargin = 0.12;

const visualVectorSelectionAnchorFields = Object.freeze([
  "year",
  "product",
  "set",
  "players",
  "character",
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade_company",
  "card_grade",
  "parallel_exact",
  "parallel"
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludes(haystack, needle) {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  return normalizeText(haystack).includes(normalizedNeedle);
}

function serialDenominator(value) {
  return String(value || "").match(/\/\s*(\d{1,4})\b/)?.[1] || "";
}

function candidateSerialDenominator(candidate = {}) {
  return serialDenominator(candidate.fields?.serial_number)
    || String(candidate.fields?.serial_denominator || "").replace(/[^0-9]/g, "")
    || String(candidate.fields?.expected_serial_denominator || "").replace(/[^0-9]/g, "")
    || String(candidate.reference_metadata?.expected_serial_denominator || "").replace(/[^0-9]/g, "");
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function textIncludesSerial(text, serialNumber) {
  const normalizedSerial = normalizeSerial(serialNumber);
  if (!normalizedSerial) return false;
  return (String(text || "").match(/\b\d+\s*\/\s*\d+\b/g) || [])
    .some((candidate) => normalizeSerial(candidate) === normalizedSerial);
}

function candidateText(candidate = {}) {
  return [
    candidate.title,
    candidate.evidence_excerpt,
    ...Object.values(candidate.fields || {})
  ].filter(Boolean).join(" ");
}

function subjectValues(resolved = {}) {
  return [
    ...(Array.isArray(resolved.players) ? resolved.players : []),
    resolved.character
  ].filter(Boolean);
}

function addMatch(result, field, weight) {
  result.score += weight;
  if (!result.matched_fields.includes(field)) result.matched_fields.push(field);
}

function addConflict(result, field, reason) {
  if (!result.conflicting_fields.includes(field)) result.conflicting_fields.push(field);
  result.conflicts.push({ field, reason });
  result.score -= 0.16;
}

function boundedSimilarity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function addVisualSimilaritySignal(result, candidate = {}) {
  const similarity = boundedSimilarity(candidate.visual_similarity);
  if (similarity === null) return;

  const boost = Math.min(0.18, Math.max(0, (similarity - 0.5) * 0.36));
  if (boost <= 0) return;

  result.score += boost;
  if (!result.matched_fields.includes("visual_vector")) result.matched_fields.push("visual_vector");

  const margin = Number(candidate.visual_margin_to_next);
  if (Number.isFinite(margin) && margin >= defaultCandidateSelectionMargin) {
    result.score += 0.03;
    if (!result.matched_fields.includes("visual_vector_margin")) result.matched_fields.push("visual_vector_margin");
  }
}

function normalizeComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).sort().join("|");
  }
  if (typeof value === "boolean") return value ? "true" : "";
  return normalizeText(value);
}

function comparableFieldValue(field, value) {
  if (field === "serial_number") return normalizeSerial(value) || normalizeComparableValue(value);
  if (["grade_company", "brand", "manufacturer"].includes(field)) return normalizeComparableValue(value).toUpperCase();
  return normalizeComparableValue(value);
}

function fieldValuesCompatible(field, left, right) {
  const leftValue = comparableFieldValue(field, left);
  const rightValue = comparableFieldValue(field, right);
  if (!leftValue || !rightValue) return true;
  if (leftValue === rightValue) return true;
  if (["product", "set", "subset", "card_type", "insert", "surface_color", "parallel_family", "parallel_exact", "parallel", "variation"].includes(field)) {
    return leftValue.includes(rightValue) || rightValue.includes(leftValue);
  }
  return false;
}

function addCandidateFieldConflicts(result, fields = {}, candidateFields = {}) {
  const normalizedCandidateFields = normalizeResolvedFields(candidateFields);
  [
    "year",
    "product",
    "set",
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "parallel",
    "variation",
    "serial_number",
    "collector_number",
    "checklist_code",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type"
  ].forEach((field) => {
    if (field === "grade_type" && (!fields[field] || fields[field] === "UNKNOWN")) return;
    if (field === "grade_type" && (!normalizedCandidateFields[field] || normalizedCandidateFields[field] === "UNKNOWN")) return;
    if (!fields[field] || !normalizedCandidateFields[field]) return;
    if (fieldValuesCompatible(field, fields[field], normalizedCandidateFields[field])) return;
    addConflict(result, field, `candidate ${field} conflicts with resolved ${field}`);
  });
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isVisualVectorCandidate(candidate = {}) {
  const sourceType = String(candidate.source_type || candidate.source || "").trim().toUpperCase();
  const matchedFields = Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [];
  return sourceType === "VISUAL_VECTOR" || matchedFields.includes("visual_vector");
}

function structuredSelectionAnchorCount(candidate = {}) {
  const fields = normalizeResolvedFields(candidate.fields || {});
  return visualVectorSelectionAnchorFields
    .filter((field) => valuePresent(fields[field]))
    .length;
}

function visualVectorSelectionRejectionReason(candidate = {}) {
  if (!isVisualVectorCandidate(candidate)) return "";
  return structuredSelectionAnchorCount(candidate) >= 2
    ? ""
    : "visual_vector_missing_structured_field_anchors";
}

function comparableCandidateFields(candidate = {}) {
  const rawFields = candidate.fields && typeof candidate.fields === "object"
    ? candidate.fields
    : {};
  const normalizedFields = normalizeResolvedFields(rawFields);
  const aliases = {
    player: "players",
    cardType: "card_type",
    surfaceColor: "surface_color",
    parallelFamily: "parallel_family",
    parallelExact: "parallel_exact"
  };
  const fieldNames = new Set(
    Object.keys(rawFields)
      .map((fieldName) => aliases[fieldName] || fieldName)
      .filter((fieldName) => resolvedFieldNames.includes(fieldName))
  );
  const comparable = {};

  fieldNames.forEach((fieldName) => {
    const value = normalizeComparableValue(normalizedFields[fieldName]);
    if (!value || value === "unknown") return;
    comparable[fieldName] = value;
  });

  return comparable;
}

function differingCandidateFields(left = {}, right = {}) {
  const leftFields = comparableCandidateFields(left);
  const rightFields = comparableCandidateFields(right);

  return Object.keys(leftFields)
    .filter((fieldName) => rightFields[fieldName] && leftFields[fieldName] !== rightFields[fieldName])
    .sort();
}

function candidateSummary(candidate = {}) {
  return {
    candidate_id: candidate.candidate_id || null,
    title: candidate.title || "",
    source_url: candidate.source_url || "",
    source_type: candidate.source_type || "",
    trust_tier: Number(candidate.trust_tier || 9),
    match_score: Number(candidate.match_score || 0),
    visual_similarity: boundedSimilarity(candidate.visual_similarity)
  };
}

function createLowMarginConflict({
  top,
  second,
  candidateMargin,
  threshold
}) {
  const conflictingFields = differingCandidateFields(top, second);

  return {
    type: "LOW_MARGIN_CANDIDATE_CONFLICT",
    reason: "candidate_margin_below_selection_threshold",
    candidate_margin: candidateMargin,
    threshold,
    conflicting_fields: conflictingFields,
    candidate_ids: [
      top.candidate_id || null,
      second.candidate_id || null
    ].filter(Boolean),
    candidates: [
      candidateSummary(top),
      candidateSummary(second)
    ]
  };
}

export function scoreRetrievalCandidate(candidate = {}, resolved = {}) {
  const fields = normalizeResolvedFields(resolved);
  const result = {
    score: 0,
    matched_fields: [],
    conflicting_fields: [],
    conflicts: []
  };
  const text = candidateText(candidate);
  const candidateFields = candidate.fields || {};

  addCandidateFieldConflicts(result, fields, candidateFields);
  const queryDenom = serialDenominator(fields.serial_number);
  const candidateDenom = candidateSerialDenominator(candidate);
  if (queryDenom && candidateDenom && queryDenom !== candidateDenom) {
    addConflict(result, "serial_number", "candidate expected serial denominator conflicts with resolved serial denominator");
  }
  addVisualSimilaritySignal(result, candidate);

  if (fields.checklist_code) {
    if (textIncludes(text, fields.checklist_code) || textIncludes(candidateFields.checklist_code, fields.checklist_code)) {
      addMatch(result, "checklist_code", 0.32);
    }
  }

  if (fields.collector_number) {
    if (textIncludes(text, fields.collector_number) || textIncludes(candidateFields.collector_number, fields.collector_number)) {
      addMatch(result, "collector_number", 0.18);
    }
  }

  const subjects = subjectValues(fields);
  if (subjects.length) {
    const matches = subjects.filter((subject) => textIncludes(text, subject) || textIncludes(candidateFields.player || candidateFields.character, subject));
    if (matches.length === subjects.length) {
      addMatch(result, "players", 0.2);
    } else if (matches.length > 0) {
      addMatch(result, "players", 0.1);
      addConflict(result, "players", "candidate matched only part of a multi-subject card");
    }
  }

  if (fields.year) {
    if (textIncludes(text, fields.year) || textIncludes(candidateFields.year, fields.year)) {
      addMatch(result, "year", 0.12);
    }
  }

  ["brand", "manufacturer", "product", "set", "official_card_type", "card_type", "insert", "surface_color", "parallel_family", "parallel_exact", "parallel"].forEach((field) => {
    if (!fields[field]) return;
    if (textIncludes(text, fields[field]) || textIncludes(candidateFields[field], fields[field])) {
      addMatch(result, field, ["parallel", "parallel_exact", "parallel_family", "surface_color"].includes(field) ? 0.08 : 0.1);
    }
  });

  const serialDenom = queryDenom;
  if (fields.serial_number && (textIncludesSerial(text, fields.serial_number) || textIncludesSerial(candidateFields.serial_number, fields.serial_number))) {
    addMatch(result, "serial_number", 0.28);
  } else if (serialDenom) {
    if (textIncludes(text, `/${serialDenom}`) || textIncludes(candidateFields.serial_number, `/${serialDenom}`) || candidateSerialDenominator(candidate) === serialDenom) {
      addMatch(result, "serial_number", 0.1);
    }
  }

  if (fields.grade_company) {
    if (textIncludes(text, fields.grade_company) || textIncludes(candidateFields.grade_company, fields.grade_company)) {
      addMatch(result, "grade_company", 0.04);
    }
  }

  if (fields.card_grade) {
    const gradePhrase = [fields.grade_company, fields.card_grade].filter(Boolean).join(" ");
    if (gradePhrase && textIncludes(text, gradePhrase)) {
      addMatch(result, "card_grade", 0.04);
    } else if (textIncludes(candidateFields.card_grade, fields.card_grade)) {
      addMatch(result, "card_grade", 0.03);
    }
  }

  const trustBoost = Math.max(0, (10 - Number(candidate.trust_tier || 9)) * 0.015);
  result.score = Math.max(0, Math.min(1, result.score + trustBoost));

  return {
    ...candidate,
    match_score: Number(result.score.toFixed(4)),
    matched_fields: [...new Set([...(candidate.matched_fields || []), ...result.matched_fields])],
    conflicting_fields: [...new Set([...(candidate.conflicting_fields || []), ...result.conflicting_fields])],
    conflicts: result.conflicts
  };
}

export function rankRetrievalCandidates(candidates = [], resolved = {}, {
  selectionMargin = defaultCandidateSelectionMargin
} = {}) {
  const scored = candidates
    .map((candidate) => scoreRetrievalCandidate(candidate, resolved))
    .sort((a, b) => b.match_score - a.match_score || a.trust_tier - b.trust_tier);
  const top = scored[0] || null;
  const second = scored[1] || null;
  const candidate_margin = top ? Number((top.match_score - (second?.match_score || 0)).toFixed(4)) : 0;
  const lowMarginConflict = top && second && candidate_margin < selectionMargin
    ? createLowMarginConflict({
      top,
      second,
      candidateMargin: candidate_margin,
      threshold: selectionMargin
    })
    : null;
  const visualVectorRejectionReason = top ? visualVectorSelectionRejectionReason(top) : "";
  const topRejectionReason = top?.conflicting_fields?.length
    ? "candidate_has_conflicting_fields"
    : visualVectorRejectionReason
      ? visualVectorRejectionReason
    : lowMarginConflict
      ? "candidate_margin_below_selection_threshold"
      : top && candidate_margin < selectionMargin
        ? "candidate_score_below_selection_threshold"
        : null;

  return {
    candidates: scored.map((candidate, index) => ({
      ...candidate,
      selected: index === 0 && !topRejectionReason,
      rejection_reason: index === 0 ? topRejectionReason : candidate.rejection_reason || "lower_match_score"
    })),
    selected_candidate: top && !topRejectionReason ? top : null,
    candidate_margin,
    candidate_selection_threshold: selectionMargin,
    low_margin_conflict: lowMarginConflict
  };
}
