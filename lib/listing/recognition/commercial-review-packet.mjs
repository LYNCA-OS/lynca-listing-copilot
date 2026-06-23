import {
  recognitionDatasetStats,
  recognitionMetricFields,
  stableManifestHash,
  validateRecognitionDataset
} from "./recognition-dataset.mjs";

export const commercialReviewPacketSchemaVersion = "commercial-review-packet-v1";
export const reviewedRecognitionExportSchemaVersion = "recognition-candidate-export-v1";

const reviewedStatuses = new Set(["SINGLE_REVIEWED", "DOUBLE_REVIEWED", "ARBITRATED"]);
const allowedGroundTruthSourceTypes = new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "SLAB_LABEL",
  "OCR_REVIEW",
  "OPERATOR",
  "OFFICIAL_CHECKLIST",
  "INTERNAL_REGISTRY",
  "APPROVED_HISTORY",
  "UNKNOWN"
]);
const defaultRequiredCriticalFields = Object.freeze(["year", "product", "players"]);
const correctedTitleSuggestionSourceType = "CORRECTED_TITLE_PARSE_HINT";
const correctedTitleSuggestionPolicy = Object.freeze({
  source_type: correctedTitleSuggestionSourceType,
  title_language: "en",
  can_be_used_as_ground_truth: false,
  evidence_weight: 0,
  requires_operator_evidence: true
});

const productTitleHints = Object.freeze([
  { manufacturer: "Topps", product: "Topps Chrome Sapphire", aliases: ["Topps Chrome Sapphire"] },
  { manufacturer: "Topps", product: "Topps Cosmic Chrome", aliases: ["Topps Cosmic Chrome", "Topps Chrome Cosmic"] },
  { manufacturer: "Topps", product: "Topps Crystal Premium", aliases: ["Topps Crystal Premium"] },
  { manufacturer: "Topps", product: "Topps Heritage High Number", aliases: ["Topps Heritage High Number"] },
  { manufacturer: "Topps", product: "Topps Stadium Club", aliases: ["Topps Stadium Club"] },
  { manufacturer: "Topps", product: "Topps Signature Class", aliases: ["Topps Signature Class"] },
  { manufacturer: "Topps", product: "Topps Dynasty", aliases: ["Topps Dynasty"] },
  { manufacturer: "Topps", product: "Topps Definitive", aliases: ["Topps Definitive"] },
  { manufacturer: "Topps", product: "Topps Reverence", aliases: ["Topps Reverence"] },
  { manufacturer: "Topps", product: "Topps Tier One", aliases: ["Topps Tier One"] },
  { manufacturer: "Topps", product: "Topps Finest", aliases: ["Topps Finest"] },
  { manufacturer: "Topps", product: "Topps Chrome", aliases: ["Topps Chrome"] },
  { manufacturer: "Topps", product: "Topps Three", aliases: ["Topps Three"] },
  { manufacturer: "Topps", product: "Topps", aliases: ["Topps"] },
  { manufacturer: "Bowman", product: "Bowman Sapphire", aliases: ["Bowman Sapphire"] },
  { manufacturer: "Bowman", product: "Bowman Draft", aliases: ["Bowman Draft"] },
  { manufacturer: "Bowman", product: "Bowman Chrome", aliases: ["Bowman Chrome"] },
  { manufacturer: "Bowman", product: "Bowman Mega Box", aliases: ["Bowman Mega Box"] },
  { manufacturer: "Bowman", product: "Bowman", aliases: ["Bowman"] },
  { manufacturer: "Panini", product: "Panini Contenders Optic", aliases: ["Panini Contenders Optic", "Contenders Optic"] },
  { manufacturer: "Panini", product: "Panini Donruss Optic", aliases: ["Panini Donruss Optic", "Donruss Optic"] },
  { manufacturer: "Panini", product: "Panini Gold Standard", aliases: ["Panini Gold Standard"] },
  { manufacturer: "Panini", product: "Panini Impeccable", aliases: ["Panini Impeccable"] },
  { manufacturer: "Panini", product: "Panini Chronicles", aliases: ["Panini Chronicles"] },
  { manufacturer: "Panini", product: "Panini Certified", aliases: ["Panini Certified"] },
  { manufacturer: "Panini", product: "Panini Absolute", aliases: ["Panini Absolute"] },
  { manufacturer: "Panini", product: "Panini Flawless", aliases: ["Panini Flawless"] },
  { manufacturer: "Panini", product: "Panini Obsidian", aliases: ["Panini Obsidian"] },
  { manufacturer: "Panini", product: "Panini Spectra", aliases: ["Panini Spectra"] },
  { manufacturer: "Panini", product: "Panini Mosaic", aliases: ["Panini Mosaic"] },
  { manufacturer: "Panini", product: "Panini Prizm", aliases: ["Panini Prizm"] },
  { manufacturer: "Panini", product: "Panini Donruss", aliases: ["Panini Donruss"] },
  { manufacturer: "Panini", product: "Panini Hoops", aliases: ["Panini Hoops"] },
  { manufacturer: "Panini", product: "Panini Black", aliases: ["Panini Black"] },
  { manufacturer: "Panini", product: "Panini", aliases: ["Panini"] },
  { manufacturer: "Upper Deck", product: "Upper Deck Sweet Shot", aliases: ["Upper Deck Sweet Shot"] },
  { manufacturer: "Upper Deck", product: "Upper Deck", aliases: ["Upper Deck"] },
  { manufacturer: "Fleer", product: "Fleer Greats of the Game", aliases: ["Fleer Greats of the Game"] },
  { manufacturer: "Fleer", product: "Fleer Legacy", aliases: ["Fleer Legacy"] },
  { manufacturer: "Fleer", product: "Fleer ProCards", aliases: ["Fleer ProCards"] },
  { manufacturer: "Fleer", product: "Fleer", aliases: ["Fleer"] },
  { manufacturer: "Leaf", product: "Leaf Metal Draft", aliases: ["Leaf Metal Draft"] },
  { manufacturer: "Leaf", product: "Leaf Optichrome", aliases: ["Leaf Optichrome"] },
  { manufacturer: "Leaf", product: "Leaf Eclectic", aliases: ["Leaf Eclectic"] },
  { manufacturer: "Leaf", product: "Leaf Metal", aliases: ["Leaf Metal"] },
  { manufacturer: "Leaf", product: "Leaf", aliases: ["Leaf"] },
  { manufacturer: "Wild Card", product: "Wild Card Wildchrome Draft", aliases: ["Wild Card Wildchrome Draft", "Wildchrome Draft"] },
  { manufacturer: "Goodwin", product: "Goodwin Champions", aliases: ["Goodwin Champions"] },
  { manufacturer: "Futera", product: "Futera Unique", aliases: ["Futera Unique"] },
  { manufacturer: "Cardsmiths", product: "Cardsmiths Street Fighter Alpha", aliases: ["Cardsmiths Street Fighter Alpha"] },
  { manufacturer: "Pokemon", product: "Pokemon SWSH Lost Origin", aliases: ["Pokemon EN SWSH Lost Origin", "Pokemon SWSH Lost Origin"] },
  { manufacturer: "BBM", product: "BBM", aliases: ["BBM"] },
  { manufacturer: "Star", product: "Star", aliases: ["Star"] }
]);

const parallelTitleHints = Object.freeze([
  "Black Pandora",
  "Gold Vinyl",
  "Gold Wave Refractor",
  "Blue Wave Refractor",
  "Green Geometric Refractor",
  "Yellow Geometric",
  "Common Geometric Refractor",
  "Red & Blue Refractor",
  "Red Yellow",
  "Blue Cracked Ice",
  "Blue Hyper Prizm",
  "Blue Hyper",
  "Blue Shimmer",
  "Super Gold",
  "Gold Refractor",
  "Red Refractor",
  "Green Refractor",
  "Pulsar Refractor",
  "Mojo Refractor",
  "X-Fractor",
  "Holo Prizm",
  "White Prizm",
  "Silver Prizm",
  "Blue Prizm",
  "Red Prizm",
  "Gold Prizm",
  "Orange Refractor",
  "Chrome Refractor",
  "Violet Speckle Refractor",
  "Teal Refractor",
  "Dark Blue Bordered",
  "Refractor",
  "Silver"
]);

const gradeCompanyPattern = "(?:PSA|BGS|CGC|SGC|TAG|SCD)";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTitleForMatching(value) {
  return normalizeText(value)
    .replace(/[’']/g, "'")
    .replace(/[-–—]+/g, " ");
}

function normalizeGradeToken(value) {
  const text = normalizeText(value);
  if (/^(?:AUTH|AUTHENTIC)$/i.test(text)) return "Auth";
  if (/^ALTERED$/i.test(text)) return "Altered";
  const numeric = text.match(/\b\d+(?:\.\d+)?\b/);
  return numeric ? numeric[0] : text || null;
}

function normalizeSlashNumber(numerator, denominator) {
  const left = String(Number(numerator));
  const right = String(Number(denominator));
  return left && right ? `${left}/${right}` : null;
}

function extractTitleYear(text) {
  const match = normalizeText(text).match(/^(19\d{2}|20\d{2})(?:-(\d{2}))?\b/);
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

function extractProductHint(text) {
  const normalized = normalizeTitleForMatching(text);
  const sorted = productTitleHints
    .flatMap((hint) => hint.aliases.map((alias) => ({ ...hint, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const hint of sorted) {
    const pattern = new RegExp(`\\b${escapeRegExp(hint.alias).replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(normalized)) {
      return {
        manufacturer: hint.manufacturer,
        product: hint.product
      };
    }
  }

  return {};
}

function slashNumberIsGrade(text, index) {
  const prefix = text.slice(Math.max(0, index - 24), index);
  return new RegExp(`\\b${gradeCompanyPattern}\\s+(?:AUTH|AUTHENTIC|ALTERED|\\d+(?:\\.\\d+)?)\\s*$`, "i").test(prefix);
}

function extractSerialNumber(text) {
  const normalized = normalizeTitleForMatching(text);
  const pattern = /(?:^|[^\d.])#?(\d{1,4})\s*\/\s*(\d{1,4})(?!\d)/g;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    const slashIndex = match.index + match[0].indexOf(match[1]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator < 1) continue;
    if (numerator > denominator) continue;
    if (slashNumberIsGrade(normalized, slashIndex)) continue;
    return normalizeSlashNumber(match[1], match[2]);
  }

  return null;
}

function extractChecklistCode(text) {
  const normalized = normalizeTitleForMatching(text);
  const match = normalized.match(/\b#?([A-Z]{2,10}-[A-Z0-9]{1,16})\b/i);
  return match ? match[1].replace(/\s+/g, "-").toUpperCase() : null;
}

function extractParallel(text) {
  const normalized = normalizeTitleForMatching(text);
  const sorted = [...parallelTitleHints].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const pattern = new RegExp(`\\b${escapeRegExp(term).replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(normalized)) return term;
  }
  return null;
}

function applyGradeMatch(fields, match, {
  companyIndex = 1,
  cardIndex = 2,
  autoIndex = 3
} = {}) {
  fields.grade_company = String(match[companyIndex] || "").toUpperCase();
  fields.card_grade = match[cardIndex] ? normalizeGradeToken(match[cardIndex]) : null;
  fields.auto_grade = match[autoIndex] ? normalizeGradeToken(match[autoIndex]) : null;
  if (fields.card_grade && fields.auto_grade) fields.grade_type = "CARD_AND_AUTO";
  else if (fields.auto_grade) fields.grade_type = "AUTO_ONLY";
  else if (fields.card_grade === "Auth") fields.grade_type = "AUTHENTIC";
  else if (fields.card_grade === "Altered") fields.grade_type = "ALTERED";
  else if (fields.card_grade) fields.grade_type = "CARD_ONLY";
}

function extractGradeFields(text) {
  const normalized = normalizeTitleForMatching(text);
  const fields = {};
  const gradeToken = "(AUTH|AUTHENTIC|ALTERED|\\d+(?:\\.\\d+)?)";
  const autoToken = "(AUTH|AUTHENTIC|\\d+(?:\\.\\d+)?)";
  const authAuto = normalized.match(new RegExp(`\\b(${gradeCompanyPattern})\\s+(AUTH|AUTHENTIC|ALTERED)\\s+(?:AUTO|AUTOGRAPH)\\s+${autoToken}\\b`, "i"));
  if (authAuto) {
    applyGradeMatch(fields, authAuto, { companyIndex: 1, cardIndex: 2, autoIndex: 3 });
    return fields;
  }

  const autoOnly = normalized.match(new RegExp(`\\b(${gradeCompanyPattern})(?:\\/DNA\\s+Cert)?\\s+(?:AUTO|AUTOGRAPH)\\s+${autoToken}\\b`, "i"));
  if (autoOnly) {
    fields.grade_company = String(autoOnly[1]).toUpperCase();
    fields.card_grade = null;
    fields.auto_grade = normalizeGradeToken(autoOnly[2]);
    fields.grade_type = "AUTO_ONLY";
    return fields;
  }

  const slash = normalized.match(new RegExp(`\\b(${gradeCompanyPattern})\\s+${gradeToken}\\s*\\/\\s*${autoToken}\\b`, "i"));
  if (slash) {
    applyGradeMatch(fields, slash, { companyIndex: 1, cardIndex: 2, autoIndex: 3 });
    return fields;
  }

  const card = normalized.match(new RegExp(`\\b(${gradeCompanyPattern})\\s+${gradeToken}\\b`, "i"));
  if (card) {
    applyGradeMatch(fields, card, { companyIndex: 1, cardIndex: 2 });
    const suffix = normalized.slice(card.index + card[0].length);
    const trailingAuto = suffix.match(/\b(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i);
    if (trailingAuto) {
      fields.auto_grade = normalizeGradeToken(trailingAuto[1]);
      fields.grade_type = "CARD_AND_AUTO";
    }
  }

  return fields;
}

function buildAttributes(fields) {
  const attributes = [];
  if (fields.rc) attributes.push("RC");
  if (fields.first_bowman) attributes.push("1st Bowman");
  if (fields.ssp) attributes.push("SSP");
  if (fields.case_hit) attributes.push("Case Hit");
  if (fields.auto) attributes.push("Auto");
  if (fields.patch) attributes.push("Patch");
  if (fields.relic) attributes.push("Relic");
  if (fields.one_of_one) attributes.push("1/1");
  return attributes;
}

function suggestedFieldEntries(fields = {}) {
  return Object.entries(fields).filter(([field, value]) => {
    if (field === "attributes") return Array.isArray(value) && value.length > 0;
    if (field === "grade_type") return value && value !== "UNKNOWN";
    return valuePresent(value);
  });
}

function buildSuggestionSources(fields = {}) {
  return suggestedFieldEntries(fields).map(([field, value]) => ({
    field,
    value,
    source_type: correctedTitleSuggestionSourceType,
    source_ref: "source_titles.corrected_title",
    evidence_weight: 0,
    can_be_used_as_ground_truth: false,
    requires_operator_evidence: true
  }));
}

function suggestedFieldCounts(tasks = []) {
  return tasks.reduce((counts, task) => {
    suggestedFieldEntries(task.suggested_fields || {}).forEach(([field]) => {
      counts[field] = (counts[field] || 0) + 1;
    });
    return counts;
  }, {});
}

export function suggestRecognitionFieldsFromEnglishTitle(title) {
  const text = normalizeText(title);
  const suggested = emptyRecognitionGroundTruth();
  if (!text) return suggested;

  suggested.year = extractTitleYear(text);
  const productHint = extractProductHint(text);
  suggested.manufacturer = productHint.manufacturer || null;
  suggested.product = productHint.product || null;
  suggested.serial_number = extractSerialNumber(text);
  suggested.checklist_code = extractChecklistCode(text);
  suggested.parallel = extractParallel(text);

  const gradeFields = extractGradeFields(text);
  suggested.grade_company = gradeFields.grade_company || null;
  suggested.card_grade = gradeFields.card_grade || null;
  suggested.auto_grade = gradeFields.auto_grade || null;
  suggested.grade_type = gradeFields.grade_type || "UNKNOWN";

  suggested.rc = /\b(?:RC|ROOKIE|RATED\s+ROOKIE)\b/i.test(text);
  suggested.first_bowman = /\b(?:1ST|FIRST)\s+BOWMAN\b/i.test(text) || /\bBOWMAN\b.*\b(?:1ST|FIRST)\b/i.test(text);
  suggested.auto = /\b(?:AUTO|AUTOGRAPH|AUTOGRAPHS|SIGNATURES?|SIGNED)\b/i.test(text);
  suggested.patch = /\b(?:PATCH|RPA|LOGOMAN|MAJESTIC\s+TAG|LAUNDRY\s+TAG|NFL\s+SHIELD|NBA\s+LOGOMAN)\b/i.test(text);
  suggested.relic = /\b(?:RELIC|JERSEY|MEMORABILIA|FABRIC|MATERIAL)\b/i.test(text);
  suggested.ssp = /\b(?:SSP|SUPER\s+SHORT\s+PRINT)\b/i.test(text);
  suggested.case_hit = /\b(?:CASE\s+HIT|KABOOM!?|DOWNTOWN!?|COLOR\s+BLAST|STAINED\s+GLASS|MANGA)\b/i.test(text);
  suggested.one_of_one = /\b(?:1\s*\/\s*1|01\s*\/\s*01|ONE\s+OF\s+ONE)\b/i.test(text);
  if (suggested.one_of_one && !suggested.serial_number) suggested.serial_number = "1/1";
  suggested.attributes = buildAttributes(suggested);

  return normalizeRecognitionGroundTruth(suggested);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

function normalizeBoolean(value) {
  return value === true;
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function readItems(input = {}) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.items)) return input.items;
  return [];
}

export function emptyRecognitionGroundTruth() {
  return {
    year: null,
    manufacturer: null,
    product: null,
    set: null,
    players: [],
    card_type: null,
    insert: null,
    parallel: null,
    variation: null,
    serial_number: null,
    collector_number: null,
    checklist_code: null,
    attributes: [],
    rc: false,
    first_bowman: false,
    auto: false,
    patch: false,
    relic: false,
    ssp: false,
    case_hit: false,
    one_of_one: false,
    grade_company: null,
    card_grade: null,
    auto_grade: null,
    grade_type: "UNKNOWN"
  };
}

export function normalizeRecognitionGroundTruth(fields = {}) {
  const base = emptyRecognitionGroundTruth();
  return {
    ...base,
    year: normalizeText(fields.year) || null,
    manufacturer: normalizeText(fields.manufacturer) || null,
    product: normalizeText(fields.product) || null,
    set: normalizeText(fields.set) || null,
    players: normalizeArray(fields.players ?? fields.player),
    card_type: normalizeText(fields.card_type) || null,
    insert: normalizeText(fields.insert) || null,
    parallel: normalizeText(fields.parallel) || null,
    variation: normalizeText(fields.variation) || null,
    serial_number: normalizeText(fields.serial_number) || null,
    collector_number: normalizeText(fields.collector_number) || null,
    checklist_code: normalizeText(fields.checklist_code) || null,
    attributes: normalizeArray(fields.attributes),
    rc: normalizeBoolean(fields.rc),
    first_bowman: normalizeBoolean(fields.first_bowman),
    auto: normalizeBoolean(fields.auto),
    patch: normalizeBoolean(fields.patch),
    relic: normalizeBoolean(fields.relic),
    ssp: normalizeBoolean(fields.ssp),
    case_hit: normalizeBoolean(fields.case_hit),
    one_of_one: normalizeBoolean(fields.one_of_one),
    grade_company: normalizeText(fields.grade_company) || null,
    card_grade: normalizeText(fields.card_grade) || null,
    auto_grade: normalizeText(fields.auto_grade) || null,
    grade_type: ["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN"].includes(fields.grade_type)
      ? fields.grade_type
      : "UNKNOWN"
  };
}

function normalizedSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .map((source) => ({
      field: normalizeText(source?.field),
      source_type: allowedGroundTruthSourceTypes.has(source?.source_type) ? source.source_type : "UNKNOWN",
      source_ref: normalizeText(source?.source_ref) || null,
      confidence: Number.isFinite(Number(source?.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : null,
      notes: normalizeText(source?.notes) || null
    }))
    .filter((source) => source.field);
}

function criticalFieldsFromGroundTruth(groundTruth = {}, requiredFields = defaultRequiredCriticalFields) {
  return [...new Set([
    ...requiredFields,
    ...recognitionMetricFields.filter((field) => valuePresent(groundTruth[field]))
  ])].filter((field) => recognitionMetricFields.includes(field));
}

function taskSourceTitles(item = {}) {
  const sourceTitles = item.source_titles && typeof item.source_titles === "object" ? item.source_titles : {};
  return {
    generated_title: normalizeText(sourceTitles.generated_title) || null,
    corrected_title: normalizeText(sourceTitles.corrected_title) || null
  };
}

export function createCommercialReviewPacket(candidateManifest = {}, {
  now = () => new Date(),
  limit = 0,
  requiredCriticalFields = defaultRequiredCriticalFields
} = {}) {
  const sourceItems = readItems(candidateManifest);
  const selectedItems = limit > 0 ? sourceItems.slice(0, limit) : sourceItems;
  const tasks = selectedItems.map((item) => {
    const sourceTitles = taskSourceTitles(item);
    const suggestedFields = suggestRecognitionFieldsFromEnglishTitle(sourceTitles.corrected_title);
    const suggestionSources = buildSuggestionSources(suggestedFields);
    return {
      asset_id: item.asset_id,
      source_feedback_id: item.source_feedback_id || null,
      physical_card_id: item.physical_card_id || null,
      capture_session_id: item.capture_session_id || null,
      category: item.category || "sports_card",
      images: Array.isArray(item.images) ? item.images : [],
      source_titles: sourceTitles,
      corrected_title_hint: sourceTitles.corrected_title,
      generated_title_hint: sourceTitles.generated_title,
      corrected_title_used_as_ground_truth: false,
      suggested_fields: suggestedFields,
      suggestion_sources: suggestionSources,
      suggestion_policy: correctedTitleSuggestionPolicy,
      required_critical_fields: [...requiredCriticalFields],
      reviewed_ground_truth: emptyRecognitionGroundTruth(),
      critical_fields: [...requiredCriticalFields],
      ground_truth_sources: [],
      reviewed_by: [],
      review_status: "NEEDS_REVIEW",
      difficulty_tags: Array.isArray(item.difficulty_tags) ? item.difficulty_tags : [],
      review_notes: "Fill reviewed_ground_truth from image/card/official evidence. suggested_fields are English corrected-title hints only and are not ground truth."
    };
  });
  const fieldCounts = suggestedFieldCounts(tasks);

  return {
    schema_version: commercialReviewPacketSchemaVersion,
    generated_at: now().toISOString(),
    source: {
      provider: "recognition_candidate_manifest",
      manifest_hash: candidateManifest.manifest_hash || candidateManifest.summary?.manifest_hash || null,
      source_item_count: sourceItems.length
    },
    summary: {
      task_count: tasks.length,
      corrected_title_hint_count: tasks.filter((task) => task.corrected_title_hint).length,
      corrected_title_used_as_ground_truth: false,
      suggested_field_task_count: tasks.filter((task) => suggestedFieldEntries(task.suggested_fields || {}).length > 0).length,
      suggested_field_counts: fieldCounts,
      suggested_fields_are_ground_truth: false,
      suggestion_source_type: correctedTitleSuggestionSourceType,
      required_critical_fields: [...requiredCriticalFields]
    },
    tasks
  };
}

function reject(index, task, reasons) {
  return {
    index,
    asset_id: task?.asset_id || null,
    source_feedback_id: task?.source_feedback_id || null,
    reasons
  };
}

function validateReviewedTask(task = {}, index = 0, {
  requireDoubleReview = false,
  requiredCriticalFields = defaultRequiredCriticalFields
} = {}) {
  const reasons = [];
  const status = normalizeText(task.review_status).toUpperCase();
  const reviewers = normalizeArray(task.reviewed_by);
  const groundTruth = normalizeRecognitionGroundTruth(task.reviewed_ground_truth || task.ground_truth || {});
  const criticalFields = normalizeArray(task.critical_fields).length
    ? normalizeArray(task.critical_fields)
    : criticalFieldsFromGroundTruth(groundTruth, requiredCriticalFields);
  const sources = normalizedSources(task.ground_truth_sources);

  if (!normalizeText(task.asset_id)) reasons.push("missing asset_id");
  if (!Array.isArray(task.images) || task.images.length < 1) reasons.push("missing images");
  if (!reviewedStatuses.has(status)) reasons.push("review_status must be SINGLE_REVIEWED, DOUBLE_REVIEWED, or ARBITRATED");
  if (reviewers.length < 1) reasons.push("reviewed_by is required");
  if ((status === "DOUBLE_REVIEWED" || requireDoubleReview) && reviewers.length < 2) {
    reasons.push("double review requires at least two reviewers");
  }
  if (task.corrected_title_used_as_ground_truth === true) {
    reasons.push("corrected_title cannot be used as field-level ground truth");
  }

  requiredCriticalFields.forEach((field) => {
    if (!valuePresent(groundTruth[field])) reasons.push(`missing required ground_truth.${field}`);
    if (!criticalFields.includes(field)) reasons.push(`critical_fields must include ${field}`);
  });

  criticalFields.forEach((field) => {
    if (!recognitionMetricFields.includes(field)) reasons.push(`unknown critical field ${field}`);
    if (!valuePresent(groundTruth[field])) reasons.push(`critical field ${field} lacks reviewed ground truth`);
    if (!sources.some((source) => source.field === field)) {
      reasons.push(`critical field ${field} lacks ground_truth_sources evidence`);
    }
  });

  return {
    ok: reasons.length === 0,
    rejected: reject(index, task, reasons),
    normalized: {
      ...task,
      review_status: status,
      reviewed_by: reviewers,
      reviewed_ground_truth: groundTruth,
      critical_fields: criticalFields,
      ground_truth_sources: sources
    }
  };
}

export function reviewPacketToRecognitionDataset(reviewPacket = {}, {
  split = "held_out_commercial",
  requireDoubleReview = false,
  requiredCriticalFields = defaultRequiredCriticalFields
} = {}) {
  const tasks = Array.isArray(reviewPacket.tasks) ? reviewPacket.tasks : [];
  const items = [];
  const rejected_tasks = [];

  tasks.forEach((task, index) => {
    const validation = validateReviewedTask(task, index, {
      requireDoubleReview,
      requiredCriticalFields
    });

    if (!validation.ok) {
      rejected_tasks.push(validation.rejected);
      return;
    }

    const normalized = validation.normalized;
    items.push({
      asset_id: normalized.asset_id,
      physical_card_id: normalized.physical_card_id || `reviewed_${normalized.asset_id}`,
      capture_session_id: normalized.capture_session_id || `reviewed_${normalized.asset_id}`,
      source_feedback_id: normalized.source_feedback_id || null,
      split,
      images: normalized.images,
      category: normalized.category || "sports_card",
      ground_truth: normalized.reviewed_ground_truth,
      critical_fields: normalized.critical_fields,
      difficulty_tags: [...new Set([...(Array.isArray(normalized.difficulty_tags) ? normalized.difficulty_tags : []), "commercial_reviewed"])],
      ground_truth_sources: normalized.ground_truth_sources,
      reviewed_by: normalized.reviewed_by,
      review_status: normalized.review_status,
      notes: normalizeText(normalized.review_notes) || "Imported from commercial field-level review packet.",
      source_titles: taskSourceTitles(normalized),
      created_at: normalized.created_at || reviewPacket.generated_at || null,
      updated_at: normalized.updated_at || reviewPacket.generated_at || null
    });
  });

  const validationErrors = validateRecognitionDataset(items);
  return {
    items,
    rejected_tasks,
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors
    },
    dataset_stats: recognitionDatasetStats(items)
  };
}

export function reviewedRecognitionExportPayload({
  items = [],
  rejectedTasks = [],
  sourcePacket = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const validationErrors = validateRecognitionDataset(items);
  return {
    schema_version: reviewedRecognitionExportSchemaVersion,
    source: {
      provider: "commercial_review_packet",
      packet_schema_version: sourcePacket.schema_version || null,
      packet_generated_at: sourcePacket.generated_at || null,
      source_task_count: Array.isArray(sourcePacket.tasks) ? sourcePacket.tasks.length : 0
    },
    generated_at: generatedAt,
    manifest_hash: stableManifestHash(items),
    summary: {
      item_count: items.length,
      rejected_task_count: rejectedTasks.length,
      review_status: "FIELD_REVIEWED",
      corrected_title_used_as_ground_truth: false,
      validation_error_count: validationErrors.length
    },
    items
  };
}
