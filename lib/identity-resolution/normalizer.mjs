import { normalizeResolvedFields } from "../listing/evidence/evidence-schema.mjs";
import { clamp01, identityFieldNames, sourceRank } from "./types.mjs";

const booleanFields = new Set([
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "jersey",
  "sketch",
  "redemption",
  "one_of_one",
  "multi_card"
]);

const arrayFields = new Set(["players", "attributes", "observable_components"]);

const fieldAliases = Object.freeze({
  player: "players",
  subject: "players",
  cardNumber: "collector_number",
  card_number: "collector_number",
  checklist: "checklist_code",
  checklistNumber: "checklist_code",
  checklist_number: "checklist_code",
  multiCard: "multi_card",
  multi_card: "multi_card",
  cardCount: "card_count",
  card_count: "card_count",
  cardName: "card_name",
  card_name: "card_name",
  name: "card_name",
  lotType: "lot_type",
  lot_type: "lot_type",
  cardType: "card_type",
  card_type: "card_type",
  officialCardType: "official_card_type",
  official_card_type: "official_card_type",
  observableComponents: "observable_components",
  observable_components: "observable_components",
  surfaceColor: "surface_color",
  surface_color: "surface_color",
  color: "surface_color",
  parallelFamily: "parallel_family",
  parallel_family: "parallel_family",
  parallelExact: "parallel_exact",
  parallel_exact: "parallel_exact",
  exactParallel: "parallel_exact",
  exact_parallel: "parallel_exact",
  grade: "card_grade",
  slab_grade: "card_grade",
  autograph_grade: "auto_grade"
});

const sourceAliases = Object.freeze({
  OCR_FRONT: "CARD_FRONT_PRINTED_TEXT",
  FRONT_OCR: "CARD_FRONT_PRINTED_TEXT",
  CARD_FRONT: "CARD_FRONT_PRINTED_TEXT",
  CARD_FRONT_PRINTED_TEXT: "CARD_FRONT_PRINTED_TEXT",
  OCR_BACK: "CARD_BACK_PRINTED_TEXT",
  BACK_OCR: "CARD_BACK_PRINTED_TEXT",
  CARD_BACK: "CARD_BACK_PRINTED_TEXT",
  CARD_BACK_PRINTED_TEXT: "CARD_BACK_PRINTED_TEXT",
  SLAB: "SLAB_LABEL",
  SLAB_LABEL: "SLAB_LABEL",
  GRADED_SLAB: "SLAB_LABEL",
  INTERNAL_APPROVED_HISTORY: "INTERNAL_APPROVED_HISTORY",
  APPROVED_HISTORY: "INTERNAL_APPROVED_HISTORY",
  REGISTRY: "STRUCTURED_DATABASE",
  INTERNAL_REGISTRY: "STRUCTURED_DATABASE",
  STRUCTURED_DATABASE: "STRUCTURED_DATABASE",
  VECTOR_APPROVED_REFERENCE: "VECTOR_APPROVED_REFERENCE",
  VISUAL_VECTOR: "VECTOR_APPROVED_REFERENCE",
  OFFICIAL_CHECKLIST: "OFFICIAL_CHECKLIST",
  OFFICIAL_PRODUCT_PAGE: "OFFICIAL_CHECKLIST",
  OFFICIAL_GRADING_DATA: "STRUCTURED_DATABASE",
  MODEL_INFERENCE: "MODEL_INFERENCE",
  LLM_INFERENCE: "MODEL_INFERENCE",
  PROVIDER_INFERENCE: "MODEL_INFERENCE",
  PRIMARY_FAST_VISION: "PRIMARY_FAST_VISION",
  GPT_PRIMARY_FAST_VISION: "PRIMARY_FAST_VISION",
  OPENAI: "PRIMARY_FAST_VISION",
  OPENAI_LEGACY: "PRIMARY_FAST_VISION",
  OPENAI_VECTOR: "PRIMARY_FAST_VISION",
  GPT: "PRIMARY_FAST_VISION",
  GPT_4_1_MINI: "PRIMARY_FAST_VISION",
  VISION_MODEL: "PRIMARY_FAST_VISION",
  OCR: "OCR_ONLY",
  OCR_ONLY: "OCR_ONLY",
  MARKETPLACE: "MARKETPLACE",
  OPEN_WEB: "MARKETPLACE",
  VISUAL: "VISUAL_GUESS",
  VISUAL_GUESS: "VISUAL_GUESS",
  GUESS: "VISUAL_GUESS"
});

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSourceText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

export function normalizeSource(source) {
  const key = normalizeSourceText(source || "VISUAL_GUESS");
  return sourceAliases[key] || "VISUAL_GUESS";
}

export function normalizeFieldName(field) {
  const raw = String(field || "").trim();
  const aliased = fieldAliases[raw] || fieldAliases[raw.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] || raw;
  return identityFieldNames.includes(aliased) ? aliased : null;
}

export function normalizeSerial(value) {
  const text = normalizeText(value).replace(/^#/, "").replace(/\s*\/\s*/g, "/");
  if (/^1\/1$/i.test(text)) return "1/1";
  if (/^\d{1,5}\/\d{1,5}$/.test(text)) return text;
  if (/^\/\d{1,5}$/.test(text)) return text;
  return null;
}

export function parseSerial(value) {
  const text = normalizeSerial(value);
  const match = text?.match(/^(\d{1,5})\/(\d{1,5})$/);
  if (!match) return { serial: text, valid: Boolean(text), numerator: null, denominator: null };

  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return {
    serial: text,
    valid: denominator > 0 && numerator <= denominator,
    numerator,
    denominator
  };
}

export function normalizeChecklistCode(value) {
  const text = normalizeText(value).replace(/^#/, "");
  return text ? text.replace(/\s+/g, "-").toUpperCase() : null;
}

export function normalizeGradeToken(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^(AUTH|AUTHENTIC)$/i.test(text)) return "Auth";
  if (/^ALTERED$/i.test(text)) return "Altered";
  const numeric = text.match(/\b\d+(?:\.\d+)?\b/);
  return numeric ? numeric[0] : null;
}

export function normalizeGradeCompany(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/\bpsa\s*\/?\s*dna\b/i.test(text)) return "PSA/DNA";
  if (/\bpsa\b/i.test(text)) return "PSA";
  if (/\b(?:beckett|bgs)\b/i.test(text)) return "BGS";
  if (/\bsgc\b/i.test(text)) return "SGC";
  if (/\b(?:cgc|csg)\b/i.test(text)) return "CGC";
  if (/\btag\b/i.test(text)) return "TAG";
  if (/\b(?:hga|isa|gma|ksa|ace)\b/i.test(text)) return text.toUpperCase();
  if (/\b(?:gem|mint|mt|pristine|auth|auto|sig|grade)\b|\d/.test(text.toLowerCase())) return null;
  return text;
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined || value === "") return false;
  return /^(true|yes|y|1|rc|rc logo|rookie|rookie card|rookie logo|rookie ticket|rated rookie|1st bowman|first bowman|auto|autograph|ssp|case hit|patch|relic|jersey|sketch|redemption|1\/1)$/i.test(normalizeText(value));
}

function normalizePositiveInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

export function isMissingValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value === false) return true;
  return value === null || value === undefined || value === "";
}

export function normalizeFieldValue(field, value) {
  if (!field) return null;

  if (arrayFields.has(field)) return normalizeStringArray(value);
  if (booleanFields.has(field)) return normalizeBoolean(value);

  if (field === "serial_number") return normalizeSerial(value);
  if (field === "card_count") return normalizePositiveInteger(value);
  if (field === "multi_card") return normalizeBoolean(value);
  if (field === "collector_number") return normalizeText(value).replace(/^#/, "") || null;
  if (field === "checklist_code") return normalizeChecklistCode(value);
  if (field === "grade_company") return normalizeGradeCompany(value);
  if (field === "card_grade" || field === "auto_grade") return normalizeGradeToken(value);
  if (field === "grade_type") {
    const text = normalizeText(value).toUpperCase();
    return ["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN"].includes(text) ? text : "UNKNOWN";
  }

  return normalizeText(value) || null;
}

export function canonicalValueKey(field, value) {
  const normalized = normalizeFieldValue(field, value);
  if (Array.isArray(normalized)) {
    return normalized.map((item) => normalizeText(item).toLowerCase()).filter(Boolean).sort().join("|");
  }
  if (typeof normalized === "boolean") return normalized ? "true" : "false";
  return normalizeText(normalized).toLowerCase().replace(/[^\p{L}\p{N}/]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function normalizeEvidenceItem(item = {}) {
  const field = normalizeFieldName(item.field);
  if (!field) return null;

  const value = normalizeFieldValue(field, item.value);
  if (isMissingValue(value)) return null;

  const metadata = item.metadata && typeof item.metadata === "object" ? { ...item.metadata } : {};
  const source = normalizeSource(item.source || item.source_type || metadata.source_type);

  return {
    field,
    value,
    source,
    confidence: clamp01(item.confidence, 0.5),
    image_id: item.image_id || item.imageId || null,
    region: item.region || null,
    metadata: {
      ...metadata,
      original_source: item.source || item.source_type || metadata.source_type || null
    }
  };
}

export function normalizeResolvedHint(resolvedHint = {}) {
  return normalizeResolvedFields(resolvedHint || {});
}

export function sourceIsOcr(source) {
  return ["CARD_BACK_PRINTED_TEXT", "CARD_FRONT_PRINTED_TEXT", "OCR_ONLY"].includes(normalizeSource(source));
}

export function sourceIsCardDesign(source) {
  return ["CARD_BACK_PRINTED_TEXT", "CARD_FRONT_PRINTED_TEXT"].includes(normalizeSource(source));
}

export function sourceIsSlab(source) {
  return normalizeSource(source) === "SLAB_LABEL";
}

export function sourceIsRegistry(source) {
  return ["INTERNAL_APPROVED_HISTORY", "OFFICIAL_CHECKLIST", "STRUCTURED_DATABASE"].includes(normalizeSource(source));
}

export function sourceIsRetrieval(source) {
  return ["INTERNAL_APPROVED_HISTORY", "OFFICIAL_CHECKLIST", "STRUCTURED_DATABASE", "MARKETPLACE"].includes(normalizeSource(source));
}

export function sourceIsMarketplace(source) {
  return normalizeSource(source) === "MARKETPLACE";
}

export function sourceIsGroundTruthEligible(source) {
  const normalized = normalizeSource(source);
  return !["MARKETPLACE", "VISUAL_GUESS", "MODEL_INFERENCE", "PRIMARY_FAST_VISION"].includes(normalized);
}

export function bestSource(sources = []) {
  return [...sources].map(normalizeSource).sort((left, right) => sourceRank(left) - sourceRank(right))[0] || "VISUAL_GUESS";
}
