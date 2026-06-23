const gradeCompanies = ["PSA", "BGS", "CGC", "SGC", "TAG"];

function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCompany(value) {
  const text = normalizedText(value).toUpperCase();
  return gradeCompanies.find((company) => text.includes(company)) || (text || null);
}

function normalizeGradeToken(value) {
  const text = normalizedText(value);
  if (/^(AUTH|AUTHENTIC)$/i.test(text)) return "Auth";
  if (/^ALTERED$/i.test(text)) return "Altered";
  const numeric = text.match(/\b\d+(?:\.\d+)?\b/);
  return numeric ? numeric[0] : text || null;
}

function parseGradeText(value) {
  const text = normalizedText(value);
  if (!text) return {};

  const company = normalizeCompany(text);
  const slash = text.match(/\b(?:PSA|BGS|CGC|SGC|TAG)?\s*(AUTH|AUTHENTIC|ALTERED|\d+(?:\.\d+)?)\s*\/\s*(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i);
  if (slash) {
    return {
      grade_company: company,
      card_grade: normalizeGradeToken(slash[1]),
      auto_grade: normalizeGradeToken(slash[2]),
      grade_type: "CARD_AND_AUTO"
    };
  }

  const autoOnly = text.match(/\b(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i);
  if (autoOnly && !/\b(?:PSA|BGS|CGC|SGC|TAG)\s+\d/i.test(text)) {
    return {
      grade_company: company,
      card_grade: null,
      auto_grade: normalizeGradeToken(autoOnly[1]),
      grade_type: "AUTO_ONLY"
    };
  }

  const cardGrade = text.match(/\b(?:PSA|BGS|CGC|SGC|TAG)?\s*(AUTH|AUTHENTIC|ALTERED|\d+(?:\.\d+)?)\b/i);
  if (cardGrade) {
    const normalized = normalizeGradeToken(cardGrade[1]);
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

  const autoGrade = text.match(/\b(?:PSA\/DNA\s+Cert\s+)?(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i);
  if (autoGrade) return normalizeGradeToken(autoGrade[1]);

  if (company && cardGrade) {
    const companyPattern = String(company).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const cardGradePattern = String(cardGrade).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const descriptorGrade = text.match(new RegExp(`\\b${companyPattern}\\s+${cardGradePattern}\\s+(?:GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\\s+(AUTH|AUTHENTIC|\\d+(?:\\.\\d+)?)\\b`, "i"));
    if (descriptorGrade) return normalizeGradeToken(descriptorGrade[1]);
  }

  return null;
}

export function resolveGradeFields({
  resolved = {},
  legacyFields = {}
} = {}) {
  const next = { ...resolved };
  const notes = [];
  const parsed = parseGradeText(`${legacyFields.grade_company || next.grade_company || ""} ${legacyFields.grade || next.card_grade || ""}`.trim());
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
    next.auto_grade = normalizeGradeToken(legacyFields.auto_grade);
    notes.push({ field: "auto_grade", action: "explicit_auto_grade", to: next.auto_grade });
  }

  if (next.card_grade && next.auto_grade) {
    next.grade_type = "CARD_AND_AUTO";
  } else if (next.auto_grade && !next.card_grade) {
    next.grade_type = "AUTO_ONLY";
  } else if (next.card_grade === "Auth") {
    next.grade_type = "AUTHENTIC";
  } else if (next.card_grade === "Altered") {
    next.grade_type = "ALTERED";
  } else if (next.card_grade) {
    next.grade_type = "CARD_ONLY";
  } else {
    next.grade_type = "UNKNOWN";
  }

  return {
    resolved: next,
    notes
  };
}
