// Text matching primitives — extracted from the v2 monolith (R1).
// Copied verbatim; behavior must stay bit-identical.
import {
  hasComplexVisualParallelRisk,
  resolveKnowledgeEntry,
  resolveKnowledgeFromFields
} from "../../listing-knowledge-registry.mjs";
import { serialLimitText } from "../renderer/title-cleanup.mjs";

export function normalizeSerialText(value) {
  return String(value || "")
    .replace(/\b(?:Serial|Numbered)\s*#?\s*(\d{1,4}\s*\/\s*\d{1,4})\b/gi, "$1")
    .replace(/#(\d{1,4})\s*\/\s*(\d{1,4})\b/g, "$1/$2")
    .replace(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function serialLimitForTitle(value, fields = {}) {
  return serialLimitText({
    ...fields,
    print_run_number: fields.print_run_number || value,
    numerical_rarity: value || fields.numerical_rarity
  }, { oneOfOne: fields.one_of_one });
}

export function stripChecklistCardNumbers(title, fields = {}) {
  let cleaned = String(title || "");
  const serial = normalizeSerialText(fields.serial_number || "");

  cleaned = cleaned.replace(/#(?!(?:\d{1,4}\s*\/\s*\d{1,4})\b)[A-Z]{1,8}[- ][A-Z0-9]{1,12}\b/gi, " ");
  cleaned = cleaned.replace(/\b(?:TCAR|PRP|SR|DRL)[- ][A-Z0-9]{1,12}\b/gi, " ");

  const cardNumber = String(fields.card_number || "").replace(/^#/, "").trim();
  if (cardNumber && cardNumber !== serial && !/^\d{1,4}\s*\/\s*\d{1,4}$/.test(cardNumber)) {
    cleaned = stripLiteralPhrase(cleaned, `#${cardNumber}`);
    cleaned = stripLiteralPhrase(cleaned, cardNumber);
  }

  return normalizeSerialText(cleaned).replace(/\s+/g, " ").trim();
}

export function stripLiteralPhrase(value, phrase) {
  const text = String(value || "");
  const needle = String(phrase || "").trim();
  if (!needle) return text;

  return text
    .replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rawIncludes(value, needle) {
  return String(value || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

export function titleIncludesSerial(title, fields) {
  const serial = normalizeSerialText(fields.numerical_rarity);
  const limit = serialLimitForTitle(fields.numerical_rarity, fields);
  const normalizedTitle = normalizeSerialText(title);
  return Boolean(serial && rawIncludes(normalizedTitle, serial))
    || Boolean(limit && rawIncludes(normalizedTitle, limit));
}

export function searchable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleIncludes(titleText, value) {
  const normalizedValue = searchable(value);
  if (!normalizedValue) return true;
  const parts = normalizedValue
    .split(" ")
    .filter((part) => part && part !== "/")
    .filter(Boolean);

  return parts.every((part) => titleText.includes(part));
}

export function subjectIncluded(titleText, value) {
  if (!value) return true;
  if (titleIncludes(titleText, value)) return true;

  const parts = searchable(value)
    .split(" ")
    .filter((part) => part && part !== "/");
  const meaningfulParts = parts.filter((part) => part.length > 2);
  const lastPart = meaningfulParts.at(-1);

  return Boolean(lastPart && titleText.includes(lastPart));
}

export function titleIncludesAny(titleText, values) {
  return values.some((value) => titleText.includes(value));
}

export function commerciallyRequiresCardNumber(fields) {
  if (!fields.card_number) return false;
  if (resolveKnowledgeEntry(fields.card_number)) return false;
  if (/^(?:TCAR|PRP|SR|DRL)[- ]/i.test(String(fields.card_number))) return false;
  return false;
}

export function gradeIncluded(titleText, grade) {
  if (!grade) return true;
  if (titleIncludes(titleText, grade)) return true;

  const numericGrade = String(grade).match(/\b\d+(?:\.\d+)?\b/);
  return Boolean(numericGrade && titleText.includes(numericGrade[0]));
}

export function yearConflict(titleText, fieldYear) {
  if (!fieldYear) return false;
  const titleYears = titleText.match(/\b20\d{2}(?:-\d{2})?\b/g) || [];
  return titleYears.length > 0 && !titleYears.some((year) => year === fieldYear || year.startsWith(`${fieldYear}-`));
}

export function textMentionsAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function hasStrongEvidence(reasonText) {
  if (textMentionsAny(reasonText, [
    "not label-backed",
    "not label backed",
    "no label",
    "without label",
    "not supported by label",
    "not confirmed"
  ])) {
    return false;
  }

  return textMentionsAny(reasonText, [
    "psa",
    "bgs",
    "beckett",
    "cgc",
    "label",
    "card text",
    "back text",
    "back-side",
    "back side",
    "reverse text",
    "printed",
    "states",
    "explicit"
  ]);
}

export function auditParallelText(fields = {}) {
  return searchable([
    fields.parallel_exact,
    fields.parallel,
    fields.variation,
    fields.surface_color,
    fields.parallel_family
  ].filter(Boolean).join(" "));
}
