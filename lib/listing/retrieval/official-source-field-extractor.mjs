import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";

const labeledFields = [
  ["year", ["year", "season"]],
  ["manufacturer", ["manufacturer"]],
  ["brand", ["brand"]],
  ["product", ["product", "product name"]],
  ["set", ["set", "set name"]],
  ["subset", ["subset"]],
  ["players", ["player", "players", "subject", "athlete"]],
  ["character", ["character"]],
  ["team", ["team"]],
  ["card_type", ["card type", "type"]],
  ["insert", ["insert"]],
  ["parallel", ["parallel"]],
  ["variation", ["variation"]],
  ["collector_number", ["collector number", "collector no", "collector no.", "card number", "card no", "card no.", "card #"]],
  ["checklist_code", ["checklist code", "card code", "checklist id", "code"]],
  ["serial_number", ["serial number", "serial no", "serial no.", "serial", "numbered"]],
  ["grade_company", ["grade company", "grading company", "grader"]],
  ["card_grade", ["card grade", "grade"]],
  ["auto_grade", ["auto grade", "autograph grade"]]
];

const booleanSignals = {
  rc: /\b(?:rc|rookie card|rookie)\b/i,
  first_bowman: /\b1st\s+bowman\b|\bfirst\s+bowman\b/i,
  ssp: /\bssp\b|\bsuper\s+short\s+print\b/i,
  case_hit: /\bcase\s+hit\b/i,
  auto: /\b(?:auto|autograph|autographed|signature)\b/i,
  patch: /\bpatch\b/i,
  relic: /\b(?:relic|memorabilia|material)\b/i,
  sketch: /\bsketch\b/i,
  redemption: /\bredemption\b/i,
  one_of_one: /\b(?:1\s*\/\s*1|one\s+of\s+one)\b/i
};

const labelAlternation = labeledFields
  .flatMap(([, labels]) => labels)
  .sort((left, right) => right.length - left.length)
  .map(escapeRegex)
  .join("|");

const labelValuePattern = new RegExp(
  `(?:^|\\s)(${labelAlternation})\\s*(?:[:#-]|is|=)\\s*(.*?)\\s*(?=(?:${labelAlternation})\\s*(?:[:#-]|is|=)|$)`,
  "gi"
);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function comparable(value) {
  return normalizeText(value).toLowerCase();
}

function textContainsValue(text, value) {
  const needle = comparable(value);
  if (!needle) return false;
  return comparable(text).includes(needle);
}

function cleanLabelValue(value) {
  return normalizeText(value)
    .replace(/^[#:\s-]+/, "")
    .replace(/[|•]+$/g, "")
    .replace(/\s+(?:official|checklist|details?|card details?)$/i, "")
    .trim();
}

function labelToField(label) {
  const normalized = comparable(label);
  const match = labeledFields.find(([, labels]) => labels.some((item) => comparable(item) === normalized));
  return match?.[0] || null;
}

function firstCodeLikeToken(text) {
  const matches = [...String(text || "").matchAll(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*-)[A-Z0-9]{1,8}-[A-Z0-9]{1,12}\b/g)]
    .map((match) => match[0]);
  return [...new Set(matches)][0] || null;
}

function firstFullSerial(text) {
  const match = String(text || "").match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/);
  return match ? match[0].replace(/\s+/g, "") : null;
}

function firstSeasonValue(text) {
  return String(text || "").match(/\b(?:19|20)\d{2}(?:-\d{2})?\b/)?.[0] || null;
}

function normalizeCollectorNumber(value) {
  const cleaned = cleanLabelValue(value).replace(/^#\s*/, "");
  if (!cleaned || cleaned.includes("-")) return null;
  return cleaned.match(/^[A-Z0-9]{1,8}(?:\/[A-Z0-9]{1,8})?$/i) ? cleaned : null;
}

function addStringField(fields, fieldName, value) {
  const cleaned = cleanLabelValue(value);
  if (!cleaned) return;
  fields[fieldName] = cleaned;
}

function addLabeledValue(fields, fieldName, value) {
  const cleaned = cleanLabelValue(value);
  if (!cleaned) return;

  if (fieldName === "players") {
    const players = cleaned
      .split(/\s*(?:,|\/|&|\band\b)\s*/i)
      .map(cleanLabelValue)
      .filter(Boolean);
    if (players.length) fields.players = players;
    return;
  }

  if (fieldName === "checklist_code") {
    const code = firstCodeLikeToken(cleaned);
    if (code) fields.checklist_code = code;
    return;
  }

  if (fieldName === "collector_number") {
    const collectorNumber = normalizeCollectorNumber(cleaned);
    if (collectorNumber) fields.collector_number = collectorNumber;
    return;
  }

  if (fieldName === "serial_number") {
    const serial = firstFullSerial(cleaned);
    if (serial) fields.serial_number = serial;
    return;
  }

  if (fieldName === "year") {
    const year = firstSeasonValue(cleaned);
    if (year) fields.year = year;
    return;
  }

  addStringField(fields, fieldName, cleaned);
}

function fieldsFromLabels(text) {
  const fields = {};
  labelValuePattern.lastIndex = 0;

  for (const match of text.matchAll(labelValuePattern)) {
    const fieldName = labelToField(match[1]);
    if (!fieldName) continue;
    addLabeledValue(fields, fieldName, match[2]);
  }

  const code = fields.checklist_code || firstCodeLikeToken(text);
  if (code) fields.checklist_code = code;

  return fields;
}

function fieldsEchoedFromResolved(text, resolved = {}) {
  const normalized = normalizeResolvedFields(resolved);
  const fields = {};

  [
    "year",
    "manufacturer",
    "brand",
    "product",
    "set",
    "subset",
    "character",
    "team",
    "artist",
    "card_type",
    "insert",
    "parallel",
    "variation",
    "serial_number",
    "collector_number",
    "checklist_code",
    "grade_company",
    "card_grade",
    "auto_grade"
  ].forEach((fieldName) => {
    const value = normalized[fieldName];
    if (value && textContainsValue(text, value)) fields[fieldName] = value;
  });

  const echoedPlayers = normalized.players.filter((player) => textContainsValue(text, player));
  if (echoedPlayers.length) fields.players = echoedPlayers;

  Object.entries(booleanSignals).forEach(([fieldName, pattern]) => {
    if (normalized[fieldName] === true && pattern.test(text)) {
      fields[fieldName] = true;
    }
    pattern.lastIndex = 0;
  });

  if (normalized.grade_type && normalized.grade_type !== "UNKNOWN" && textContainsValue(text, normalized.grade_type.replace(/_/g, " "))) {
    fields.grade_type = normalized.grade_type;
  }

  return fields;
}

function explicitBooleanFields(text) {
  const fields = {};
  Object.entries(booleanSignals).forEach(([fieldName, pattern]) => {
    if (pattern.test(text)) fields[fieldName] = true;
    pattern.lastIndex = 0;
  });
  return fields;
}

function compactFields(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  const compacted = {};

  Object.entries(normalized).forEach(([fieldName, value]) => {
    if (fieldName === "grade_type") {
      if (value && value !== "UNKNOWN") compacted.grade_type = value;
      return;
    }

    if (Array.isArray(value)) {
      if (value.length) compacted[fieldName] = value;
      return;
    }

    if (typeof value === "boolean") {
      if (value) compacted[fieldName] = value;
      return;
    }

    if (value !== null && value !== undefined && value !== "") {
      compacted[fieldName] = value;
    }
  });

  return compacted;
}

export function extractOfficialSourceFields({
  text = "",
  resolved = {}
} = {}) {
  const cleanText = normalizeText(text);
  if (!cleanText) return {};

  return compactFields({
    ...fieldsFromLabels(cleanText),
    ...fieldsEchoedFromResolved(cleanText, resolved),
    ...explicitBooleanFields(cleanText)
  });
}
