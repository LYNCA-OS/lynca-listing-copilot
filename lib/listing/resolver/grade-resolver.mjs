import { gradeTypeForValues, normalizeAutoGradeValue, normalizeGradeValue, sanitizeGradeFields } from "../grade/grade-value.mjs";

const gradeCompanies = ["PSA", "BGS", "CGC", "SGC", "TAG"];

function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCompany(value) {
  const text = normalizedText(value).toUpperCase();
  if (/\bBECKETT\b/.test(text)) return "BGS";
  if (/\bPSA\s*\/?\s*DNA\b/.test(text)) return "PSA/DNA";
  return gradeCompanies.find((company) => text.includes(company)) || (text || null);
}

function normalizeGradeToken(value) {
  return normalizeGradeValue(value);
}

function normalizeAutoGradeToken(value) {
  return normalizeAutoGradeValue(value);
}

function validGradeToken(value) {
  const token = normalizeGradeToken(value);
  if (!token) return false;
  if (/^(?:Auth|Altered)$/i.test(token)) return true;
  const numeric = Number(token);
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 10;
}

function parseGradeText(value) {
  const text = normalizedText(value);
  if (!text) return {};
  const gradeText = text.replace(/\s*[-_]\s*/g, " ");

  const company = normalizeCompany(gradeText);
  const slash = gradeText.match(/\b(?:PSA|BGS|BECKETT|CGC|CSG|SGC|TAG|PSA\/?DNA)?\s*(AUTH|AUTHENTIC|ALTERED|\d+(?:\.\d+)?)\s*\/\s*(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i);
  if (slash && validGradeToken(slash[1]) && validGradeToken(slash[2])) {
    return {
      grade_company: company,
      card_grade: normalizeGradeToken(slash[1]),
      auto_grade: normalizeGradeToken(slash[2]),
      grade_type: "CARD_AND_AUTO"
    };
  }

  const labeledCardAndAutoGrade = gradeText.match(/\b(?:PSA|BGS|BECKETT|CGC|CSG|SGC|TAG|PSA\/?DNA)\s+(?:GEM\s+MT|GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)?\s*(AUTH|AUTHENTIC|ALTERED|\d+(?:\.\d+)?)\s+(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i);
  if (labeledCardAndAutoGrade && validGradeToken(labeledCardAndAutoGrade[1]) && validGradeToken(labeledCardAndAutoGrade[2])) {
    return {
      grade_company: company,
      card_grade: normalizeGradeToken(labeledCardAndAutoGrade[1]),
      auto_grade: normalizeGradeToken(labeledCardAndAutoGrade[2]),
      grade_type: "CARD_AND_AUTO"
    };
  }

  const autoOnly = gradeText.match(/\b(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i);
  if (autoOnly && validGradeToken(autoOnly[1]) && !/\b(?:PSA|BGS|BECKETT|CGC|CSG|SGC|TAG)\s+\d/i.test(gradeText)) {
    return {
      grade_company: company,
      card_grade: null,
      auto_grade: normalizeGradeToken(autoOnly[1]),
      grade_type: "AUTO_ONLY"
    };
  }

  const labeledCardGrade = gradeText.match(/\b(?:PSA|BGS|BECKETT|CGC|CSG|SGC|TAG|PSA\/?DNA)\s+(?:GEM\s+MT|GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)?\s*(AUTH|AUTHENTIC|ALTERED|\d+(?:\.\d+)?)\b/i);
  const descriptorCardGrade = gradeText.match(/\b(?:GEM\s+MT|GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\s+(\d+(?:\.\d+)?)\b/i);
  const cardGrade = labeledCardGrade || descriptorCardGrade;
  if (cardGrade) {
    const normalized = normalizeGradeToken(cardGrade[1]);
    if (!validGradeToken(normalized)) return {};
    return {
      grade_company: company,
      card_grade: normalized,
      auto_grade: null,
      grade_type: normalized === "Auth" ? "AUTHENTIC" : normalized === "Altered" ? "ALTERED" : "CARD_ONLY"
    };
  }

  return {};
}

function parseAutoGradeFromText(value, {
  company = null,
  cardGrade = null
} = {}) {
  const text = normalizedText(value);
  if (!text) return null;

  const autoGrade = text.match(/\b(?:PSA\/DNA\s+Cert\s+)?(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)(?!\s*\/)\b/i);
  if (autoGrade && validGradeToken(autoGrade[1])) return normalizeGradeToken(autoGrade[1]);

  if (company && cardGrade) {
    const companyPattern = String(company).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const cardGradePattern = String(cardGrade).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const descriptorGrade = text.match(new RegExp(`\\b${companyPattern}\\s+${cardGradePattern}\\s+(?:GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\\s+(AUTH|AUTHENTIC|\\d+(?:\\.\\d+)?)\\b`, "i"));
    if (descriptorGrade && validGradeToken(descriptorGrade[1])) return normalizeGradeToken(descriptorGrade[1]);
  }

  return null;
}

export function resolveGradeFields({
  resolved = {},
  legacyFields = {}
} = {}) {
  const next = sanitizeGradeFields(resolved);
  const notes = [];
  const parsed = [
    `${legacyFields.grade_company || next.grade_company || ""} ${legacyFields.grade || legacyFields.card_grade || next.card_grade || ""}`.trim(),
    legacyFields.grade,
    legacyFields.card_grade,
    legacyFields.checklist_code,
    legacyFields.card_number
  ]
    .map(parseGradeText)
    .find((candidate) => candidate.grade_company || candidate.card_grade || candidate.auto_grade) || {};
  const autoGradeFromTitle = parseAutoGradeFromText(legacyFields.title || legacyFields.model_title_suggestion || "", {
    company: parsed.grade_company || next.grade_company,
    cardGrade: parsed.card_grade || next.card_grade
  });

  if (!next.grade_company && parsed.grade_company) {
    next.grade_company = parsed.grade_company;
    notes.push({ field: "grade_company", action: "parsed_grade_company", to: parsed.grade_company });
  }

  if (parsed.card_grade && next.card_grade !== parsed.card_grade) {
    next.card_grade = parsed.card_grade;
    notes.push({ field: "card_grade", action: "parsed_card_grade", to: parsed.card_grade });
  }

  if (parsed.auto_grade && next.auto_grade !== parsed.auto_grade) {
    next.auto_grade = parsed.auto_grade;
    notes.push({ field: "auto_grade", action: "parsed_auto_grade", to: parsed.auto_grade });
  }

  if (!next.auto_grade && autoGradeFromTitle) {
    next.auto_grade = autoGradeFromTitle;
    notes.push({ field: "auto_grade", action: "parsed_title_auto_grade", to: next.auto_grade });
  }

  if (!next.auto_grade && legacyFields.auto_grade) {
    const explicitAutoGrade = normalizeAutoGradeToken(legacyFields.auto_grade);
    if (explicitAutoGrade) {
      next.auto_grade = explicitAutoGrade;
      notes.push({ field: "auto_grade", action: "explicit_auto_grade", to: next.auto_grade });
    }
  }

  next.grade_type = gradeTypeForValues(next.card_grade, next.auto_grade);

  return {
    resolved: next,
    notes
  };
}
