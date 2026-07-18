function normalizedText(value) {
  if (typeof value === "boolean") return "";
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const emptyCompanyPattern = /^(?:true|false|null|none|unknown|n\/?a|na|graded|ungraded|card|auto|grade)$/i;
const nonCompanyPattern = /\b(?:gem|mint|mt|pristine|auth|auto|sig|grade)\b|\d/i;

// This is the single canonical owner for grading-company aliases. A company
// may include grading vocabulary in its legal name, so aliases must be
// recognized before generic grade-text rejection.
export function normalizeGradeCompanyValue(value) {
  const text = normalizedText(value);
  if (!text || emptyCompanyPattern.test(text)) return null;
  if (/\bpsa\s*\/?\s*dna\b/i.test(text)) return "PSA/DNA";
  if (/\bpsa\b/i.test(text)) return "PSA";
  if (/\b(?:beckett|bgs)\b/i.test(text)) return "BGS";
  if (/\bsgc\b/i.test(text)) return "SGC";
  if (/\b(?:cgc|csg)\b/i.test(text)) return "CGC";
  if (/\btag\b/i.test(text)) return "TAG";
  if (/\b(?:scd|sports\s+collectors\s+digest)\b/i.test(text)) return "SCD";

  const knownMinor = text.match(/\b(CCIC|GTBC|BGN|HGA|ISA|GMA|KSA|ACE)\b/i)?.[1];
  if (knownMinor) return knownMinor.toUpperCase();
  if (nonCompanyPattern.test(text)) return null;
  return text;
}
