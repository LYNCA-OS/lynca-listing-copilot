function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeGradeValue(value) {
  const text = normalizedText(value);
  if (!text) return null;
  if (/^(?:AUTH|AUTHENTIC)$/i.test(text)) return "Auth";
  if (/^ALTERED$/i.test(text)) return "Altered";
  const canonical = text.match(/^(10(?:\.0)?|[1-9](?:\.\d)?)$/)?.[1] || null;
  const anchored = canonical || [
    /\b(?:PSA(?:\s*\/\s*DNA)?|BGS|BECKETT|CGC|CSG|SGC|TAG)\s+(?:(?:GEM\s+(?:MT|MINT)|MINT|NM-MT|NM|EX-MT|EX)\s+)?(10(?:\.0)?|[1-9](?:\.\d)?)\b/i,
    /\b(?:CARD\s+GRADE|GRADE|GEM\s+(?:MT|MINT)|MINT|NM-MT|NM|EX-MT|EX)\s*[:=-]?\s*(10(?:\.0)?|[1-9](?:\.\d)?)\b/i,
    /\b(10(?:\.0)?|[1-9](?:\.\d)?)\s+(?:GEM\s+(?:MT|MINT)|MINT|NM-MT|NM|EX-MT|EX)\b/i
  ].map((pattern) => text.match(pattern)?.[1] || null).find(Boolean);
  if (!anchored) {
    if (/\b(?:PSA(?:\s*\/\s*DNA)?|BGS|BECKETT|CGC|CSG|SGC|TAG)\b.*\b(?:AUTH|AUTHENTIC)\b/i.test(text)) return "Auth";
    if (/\b(?:PSA|BGS|BECKETT|CGC|CSG|SGC|TAG)\b.*\bALTERED\b/i.test(text)) return "Altered";
    return null;
  }
  const numeric = Number(anchored);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 10) return null;
  return String(numeric);
}

export function normalizeAutoGradeValue(value) {
  const text = normalizedText(value);
  if (!text) return null;
  if (/^(?:AUTH|AUTHENTIC)$/i.test(text)) return "Auth";
  const canonical = text.match(/^(10(?:\.0)?|[1-9](?:\.\d)?)$/)?.[1] || null;
  const anchored = canonical || [
    /\b(?:AUTO|AUTOGRAPH)\s*[:=-]?\s*(10(?:\.0)?|[1-9](?:\.\d)?)\b/i,
    /\b(10(?:\.0)?|[1-9](?:\.\d)?)\s+(?:AUTO|AUTOGRAPH)\b/i
  ].map((pattern) => text.match(pattern)?.[1] || null).find(Boolean);
  if (!anchored) {
    if (/\b(?:AUTO|AUTOGRAPH)\b.*\b(?:AUTH|AUTHENTIC)\b/i.test(text)) return "Auth";
    return null;
  }
  const numeric = Number(anchored);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 10) return null;
  return String(numeric);
}

const gradeTypes = new Set(["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN"]);

export function normalizeGradeType(value) {
  const normalized = normalizedText(value).toUpperCase();
  return gradeTypes.has(normalized) ? normalized : "UNKNOWN";
}

export function gradeTypeForValues(cardGrade, autoGrade, fallback = "UNKNOWN") {
  const normalizedCardGrade = normalizeGradeValue(cardGrade);
  const normalizedAutoGrade = normalizeAutoGradeValue(autoGrade);
  if (normalizedCardGrade && normalizedAutoGrade) return "CARD_AND_AUTO";
  if (normalizedAutoGrade) return "AUTO_ONLY";
  if (normalizedCardGrade === "Auth") return "AUTHENTIC";
  if (normalizedCardGrade === "Altered") return "ALTERED";
  if (normalizedCardGrade) return "CARD_ONLY";
  return normalizeGradeType(fallback);
}

export function sanitizeGradeFields(fields = {}) {
  const output = { ...fields };
  const hasCardGrade = Object.hasOwn(output, "card_grade") || Object.hasOwn(output, "grade");
  const hasAutoGrade = Object.hasOwn(output, "auto_grade");
  const hasGradeType = Object.hasOwn(output, "grade_type");
  if (!hasCardGrade && !hasAutoGrade && !hasGradeType) return output;
  const cardGrade = normalizeGradeValue(output.card_grade ?? output.grade);
  const autoGrade = normalizeAutoGradeValue(output.auto_grade);
  if (hasCardGrade) output.card_grade = cardGrade;
  if (Object.hasOwn(output, "grade")) output.grade = cardGrade;
  if (hasAutoGrade) output.auto_grade = autoGrade;
  output.grade_type = gradeTypeForValues(cardGrade, autoGrade, output.grade_type);
  return output;
}

export function gradeAtomicCompleteness(fields = {}) {
  const sanitized = sanitizeGradeFields(fields);
  const gradeCompany = normalizedText(sanitized.grade_company);
  const cardGrade = normalizeGradeValue(sanitized.card_grade ?? sanitized.grade);
  const autoGrade = normalizeAutoGradeValue(sanitized.auto_grade);
  const hasScore = Boolean(cardGrade || autoGrade);
  const hasCompany = Boolean(gradeCompany);
  const hasAnyGradeValue = hasCompany || hasScore;
  return {
    grade_company: gradeCompany || null,
    card_grade: cardGrade,
    auto_grade: autoGrade,
    has_company: hasCompany,
    has_score: hasScore,
    has_any_grade_value: hasAnyGradeValue,
    complete: !hasAnyGradeValue || (hasCompany && hasScore),
    incomplete_score_without_company: hasScore && !hasCompany,
    incomplete_company_without_score: hasCompany && !hasScore
  };
}

// A grading score identifies a physical slab instance only together with the
// grading company. Keeping a bare `10` lets catalog/reference data masquerade
// as current-image evidence and also creates an unrenderable half-state.
export function enforceAtomicGradeFields(fields = {}) {
  const output = sanitizeGradeFields(fields);
  const atomic = gradeAtomicCompleteness(output);
  if (!atomic.incomplete_score_without_company) return output;

  if (Object.hasOwn(output, "grade")) output.grade = null;
  output.card_grade = null;
  output.auto_grade = null;
  output.grade_type = "UNKNOWN";
  return output;
}
