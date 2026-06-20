import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hasComplexVisualParallelRisk,
  highValueInsertTerms,
  registryPromptSummary,
  resolveKnowledgeEntry,
  resolveKnowledgeFromFields
} from "../lib/listing-knowledge-registry.mjs";

const cookieName = "lynca_metaverse_session";
const defaultModel = "gpt-4.1-mini";
const maxFallbackTitleLength = 80;
const promptRoot = join(process.cwd(), "prompts");
const promptFiles = [
  "listing-intelligence-v1.md",
  "examples/sports.md",
  "examples/pokemon.md",
  "examples/marvel.md",
  "examples/sketch.md",
  "examples/redemption.md"
];
let promptCache;

const defaultFields = {
  year: null,
  brand: null,
  product: null,
  set: null,
  subset: null,
  insert: null,
  parallel: null,
  player: null,
  character: null,
  artist: null,
  team: null,
  card_number: null,
  serial_number: null,
  grade_company: null,
  grade: null,
  auto: false,
  relic: false,
  patch: false,
  sketch: false,
  redemption: false,
  one_of_one: false
};
const backgroundTerms = [
  "Metaverse Cards",
  "LYNCA",
  "CardLadder",
  "eBay UI",
  "table mat",
  "watermark",
  "seller branding"
];
const backgroundTermPatterns = backgroundTerms.map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"));
const highValueInsertPatterns = highValueInsertTerms.map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function isValidSession(cookie, secret) {
  if (!cookie || !secret) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload, secret)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function normalizeTitle(title, maxLength) {
  const normalized = String(title || "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

function normalizeRookieMarker(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return /^(?:RC|Rookie|Rookie Card|Rated Rookie)$/i.test(normalized) ? "RC" : normalized;
}

function normalizeSerialText(value) {
  return String(value || "")
    .replace(/\b(?:Serial|Numbered)\s*#?\s*(\d{1,4}\s*\/\s*\d{1,4})\b/gi, "$1")
    .replace(/#(\d{1,4})\s*\/\s*(\d{1,4})\b/g, "$1/$2")
    .replace(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}

function stripChecklistCardNumbers(title, fields = {}) {
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

function cleanupTitleWording(title, maxLength) {
  const cleaned = suppressDuplicateAutoTerms(normalizePsaGradeDisplay(normalizeSerialText(title)
    .replace(/\bTopps\s+Chrome\s+Autograph\s+Card\b/gi, "Topps Chrome Auto")
    .replace(/\bChrome\s+Autograph\s+Card\b/gi, "Chrome Auto")
    .replace(/\bChrome\s+Autograph\b/gi, "Chrome Auto")
    .replace(/\b(?:Certified\s+)?(?:On[- ]?card\s+|Sticker\s+)?Autograph\b/gi, "Auto")
    .replace(/\bDual\s+Auto\b/gi, "Dual Auto")
    .replace(/\bTriple\s+Auto\b/gi, "Triple Auto")
    .replace(/\bOne\s+of\s+One\b/gi, "1/1")
    .replace(/\bOne\b(?=\s*$)/gi, "1/1")
    .replace(/\bRated\s+Rookie\b/gi, "RC")
    .replace(/\bRookie\s+Card\b/gi, "RC")
    .replace(/\bRookie\s+RC\s+Card\b/gi, "RC")
    .replace(/\bRookie\s+RC\b/gi, "RC")
    .replace(/\bRC\s+Card\b/gi, "RC")
    .replace(/\bRookie\b(?!\s+(?:Refresh|Auto))/gi, "RC")
    .replace(/\bAutograph\s+Auto\b/gi, "Auto")
    .replace(/\bRefractor\s+Parallel\b/gi, "Refractor")
    .replace(/\bCard\s+Card\b/gi, "Card")
    .replace(/\bRC\s+RC\b/gi, "RC")
    .replace(/\bTopps\s+Chrome\s+Chrome\s+Auto\b/gi, "Topps Chrome Auto")
    .replace(/\bChrome\s+Chrome\s+Auto\b/gi, "Chrome Auto")
    .replace(/\s+/g, " ")
    .trim()));

  return normalizeTitle(cleaned, maxLength);
}

function normalizePsaGradeDisplay(title) {
  return String(title || "")
    .replace(/\bPSA\s+(AUTH|AUTHENTIC)\s+Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA Auth/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(\d+(?:\.\d+)?)\s+(?:GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)?\s*Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(\d+(?:\.\d+)?)\s+(?:GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(AUTH|AUTHENTIC)\b/gi, "PSA Auth")
    .replace(/\bPSA\s+Auto\s+(AUTH|AUTHENTIC)\b/gi, "PSA AUTO Auth")
    .replace(/\bPSA\s+AUTO\s+(AUTH|AUTHENTIC)\b/gi, "PSA AUTO Auth");
}

function normalizePsaGradeToken(value) {
  const token = String(value || "").trim();
  return /^(?:AUTH|AUTHENTIC)$/i.test(token) ? "Auth" : token;
}

function suppressDuplicateAutoTerms(title) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const protectedAutoPhrases = [
    "Chrome Rookie Auto",
    "Chrome Auto",
    "Dual Signatures Auto"
  ];
  const placeholder = "__AUTO__";

  protectedAutoPhrases.forEach((phrase) => {
    cleaned = cleaned.replace(new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi"), phrase.replace(/\bAuto\b/i, placeholder));
  });

  const autoMatches = cleaned.match(/\bAuto\b/gi) || [];
  const hasProtectedAuto = cleaned.includes(placeholder);
  if (autoMatches.length <= 1 && !hasProtectedAuto) return cleaned;
  if (autoMatches.length === 0) {
    return cleaned.replace(new RegExp(placeholder, "g"), "Auto");
  }

  if (hasProtectedAuto) {
    cleaned = cleaned
      .replace(/\bRC\s+Auto\b/gi, "RC")
      .replace(/\bRookie\s+Auto\b/gi, "Rookie")
      .replace(/\bAuto\b/gi, " ");
  } else {
    let seenAuto = false;
    cleaned = cleaned.replace(/\bAuto\b/gi, (match) => {
      if (seenAuto) return " ";
      seenAuto = true;
      return match;
    });
  }

  cleaned = cleaned
    .replace(new RegExp(placeholder, "g"), "Auto")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function moveLeadingGradeToEnd(title, maxLength) {
  const normalized = String(title || "").replace(/\s+/g, " ").trim();
  const leadingGrade = normalized.match(/^(PSA|BGS|CGC)\s+(?:GEM\s+MINT\s+|MINT\s+|PRISTINE\s+)?(\d+(?:\.\d+)?)\s+(.+)$/i);
  if (!leadingGrade) return cleanupTitleWording(normalized, maxLength);

  const [, company, grade, rest] = leadingGrade;
  return cleanupTitleWording(`${rest} ${company.toUpperCase()} ${grade}`, maxLength);
}

function stripBackgroundTerms(value) {
  return backgroundTermPatterns.reduce(
    (text, pattern) => text.replace(pattern, " "),
    String(value || "")
  ).replace(/\s+/g, " ").trim();
}

function stripLiteralPhrase(value, phrase) {
  const text = String(value || "");
  const needle = String(phrase || "").trim();
  if (!needle) return text;

  return text
    .replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rawIncludes(value, needle) {
  return String(value || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function titleIncludesSerial(title, fields) {
  return Boolean(fields.serial_number && rawIncludes(normalizeSerialText(title), normalizeSerialText(fields.serial_number)));
}

function ensureTitleTerm(title, term) {
  if (!term || rawIncludes(title, term)) return title;
  return `${title} ${term}`.replace(/\s+/g, " ").trim();
}

function ensureTitleTerms(title, terms) {
  return terms.reduce((currentTitle, term) => ensureTitleTerm(currentTitle, term), title);
}

function compactLowPriorityTitleTerms(title, fields, maxLength) {
  if (String(title || "").length <= maxLength) return title;

  const lowPriorityTerms = [
    fields.team,
    fields.position,
    "NBA",
    "NFL",
    "MLB",
    "NHL",
    "UFC",
    "Golden State Warriors",
    "Oklahoma City Thunder",
    "Thunder",
    "Jersey No.",
    "Collection",
    "RC Card",
    "Card"
  ].filter(Boolean);

  return lowPriorityTerms.reduce(
    (currentTitle, term) => stripLiteralPhrase(currentTitle, term),
    title
  ).replace(/\s+/g, " ").trim();
}

function fitRequiredTitleTerms(title, requiredTerms, fields, maxLength) {
  let currentTitle = ensureTitleTerms(title, requiredTerms);
  let normalizedTitle = normalizeTitle(currentTitle, maxLength);

  if (requiredTerms.every((term) => rawIncludes(normalizedTitle, term))) {
    return currentTitle;
  }

  const removableTerms = [
    fields.team,
    fields.brand,
    fields.product,
    "Golden State Warriors",
    "Oklahoma City Thunder",
    "Thunder",
    "Immaculate Collection",
    "Collection",
    "Jersey No.",
    "RC Card",
    "Card"
  ].filter(Boolean);

  for (const term of removableTerms) {
    currentTitle = stripLiteralPhrase(currentTitle, term);
    currentTitle = ensureTitleTerms(currentTitle, requiredTerms);
    normalizedTitle = normalizeTitle(currentTitle, maxLength);

    if (requiredTerms.every((requiredTerm) => rawIncludes(normalizedTitle, requiredTerm))) {
      return currentTitle;
    }
  }

  return currentTitle;
}

function containsBackgroundTerm(value) {
  return backgroundTermPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(value || ""));
  });
}

function extractHighValueInsert(value) {
  const text = String(value || "");
  const index = highValueInsertPatterns.findIndex((pattern) => pattern.test(text));
  return index === -1 ? null : highValueInsertTerms[index];
}

function compactFileName(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolutionHints(resolutionMap) {
  return Object.entries(resolutionMap || {})
    .map(([code, label]) => `${code}: ${label}`)
    .join("\n");
}

function findResolutionLabel(text, resolutionMap) {
  const upperText = text.toUpperCase();
  const match = Object.entries(resolutionMap || {}).find(([code]) => upperText.includes(code.toUpperCase()));
  return match ? match : [];
}

async function loadPrompt() {
  if (promptCache) return promptCache;

  const sections = await Promise.all(promptFiles.map(async (file) => {
    const content = await readFile(join(promptRoot, file), "utf8");
    return `--- ${file} ---\n${content.trim()}`;
  }));

  promptCache = sections.join("\n\n");
  return promptCache;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeFields(fields = {}) {
  const normalized = {
    year: normalizeStringOrNull(fields.year),
    brand: normalizeStringOrNull(fields.brand),
    product: normalizeStringOrNull(fields.product),
    set: normalizeStringOrNull(fields.set),
    subset: normalizeStringOrNull(normalizeRookieMarker(fields.subset)),
    insert: normalizeStringOrNull(fields.insert),
    parallel: normalizeStringOrNull(fields.parallel),
    player: normalizeStringOrNull(fields.player),
    character: normalizeStringOrNull(fields.character),
    artist: normalizeStringOrNull(fields.artist),
    team: normalizeStringOrNull(fields.team),
    card_number: normalizeStringOrNull(fields.card_number),
    serial_number: normalizeStringOrNull(fields.serial_number),
    grade_company: normalizeStringOrNull(fields.grade_company),
    grade: normalizeStringOrNull(fields.grade),
    auto: normalizeBoolean(fields.auto),
    relic: normalizeBoolean(fields.relic),
    patch: normalizeBoolean(fields.patch),
    sketch: normalizeBoolean(fields.sketch),
    redemption: normalizeBoolean(fields.redemption),
    one_of_one: normalizeBoolean(fields.one_of_one)
  };

  Object.keys(normalized).forEach((key) => {
    if (typeof normalized[key] === "string" && containsBackgroundTerm(normalized[key])) {
      normalized[key] = null;
    }
  });

  const explicitInsertEntry = resolveKnowledgeEntry(normalized.insert);
  if (explicitInsertEntry) {
    normalized.insert = explicitInsertEntry.label;
  }

  const registryInsert = resolveKnowledgeFromFields(normalized);
  if (registryInsert && !normalized.insert) {
    normalized.insert = registryInsert.label;
  }

  if (/^TCAR[- ]/i.test(normalized.card_number || "")) {
    normalized.insert = "Chrome Rookie Auto";
    normalized.auto = true;
  }

  if (/^SR[- ]/i.test(normalized.card_number || "")) {
    normalized.insert = "Star Swatch Signatures";
  }

  if (/cosmic chrome/i.test(`${normalized.brand || ""} ${normalized.product || ""} ${normalized.set || ""}`)) {
    normalized.product = "Topps Cosmic Chrome";
    if (normalized.brand && /topps/i.test(normalized.brand)) normalized.brand = "Topps";
  }

  if (/red propulsion/i.test(`${normalized.insert || ""} ${normalized.parallel || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Red Propulsion";
    normalized.parallel = null;
  }

  if (/dual signatures/i.test(`${normalized.insert || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Dual Signatures";
  }

  if (/duo logoman|dual rookie logoman/i.test(`${normalized.insert || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Duo Logoman Autographs";
    normalized.auto = true;
  }

  const parallelInsert = resolveKnowledgeEntry(normalized.parallel) || (
    extractHighValueInsert(normalized.parallel)
      ? { label: extractHighValueInsert(normalized.parallel) }
      : null
  );
  if (parallelInsert && normalized.insert === parallelInsert.label) {
    normalized.parallel = null;
  }

  return normalized;
}

function normalizeUnresolved(unresolved, fields = {}) {
  const candidates = Array.isArray(unresolved)
    ? unresolved
    : Array.isArray(fields.unresolvedFields)
      ? fields.unresolvedFields
      : [];

  return candidates
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function searchable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleIncludes(titleText, value) {
  const normalizedValue = searchable(value);
  if (!normalizedValue) return true;
  const parts = normalizedValue
    .split(" ")
    .filter((part) => part && part !== "/")
    .filter(Boolean);

  return parts.every((part) => titleText.includes(part));
}

function subjectIncluded(titleText, value) {
  if (!value) return true;
  if (titleIncludes(titleText, value)) return true;

  const parts = searchable(value)
    .split(" ")
    .filter((part) => part && part !== "/");
  const meaningfulParts = parts.filter((part) => part.length > 2);
  const lastPart = meaningfulParts.at(-1);

  return Boolean(lastPart && titleText.includes(lastPart));
}

function titleIncludesAny(titleText, values) {
  return values.some((value) => titleText.includes(value));
}

function commerciallyRequiresCardNumber(fields) {
  if (!fields.card_number) return false;
  if (resolveKnowledgeEntry(fields.card_number)) return false;
  if (/^(?:TCAR|PRP|SR|DRL)[- ]/i.test(String(fields.card_number))) return false;
  return false;
}

function gradeIncluded(titleText, grade) {
  if (!grade) return true;
  if (titleIncludes(titleText, grade)) return true;

  const numericGrade = String(grade).match(/\b\d+(?:\.\d+)?\b/);
  return Boolean(numericGrade && titleText.includes(numericGrade[0]));
}

function yearConflict(titleText, fieldYear) {
  if (!fieldYear) return false;
  const titleYears = titleText.match(/\b20\d{2}(?:-\d{2})?\b/g) || [];
  return titleYears.length > 0 && !titleYears.some((year) => year === fieldYear || year.startsWith(`${fieldYear}-`));
}

function textMentionsAny(text, words) {
  return words.some((word) => text.includes(word));
}

function hasStrongEvidence(reasonText) {
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

function hasVisuallyGuessedParallel(fields, reasonText, unresolved) {
  const parallelText = searchable(fields.parallel);
  if (!parallelText) return false;

  const combined = `${parallelText} ${reasonText} ${searchable(unresolved.join(" "))}`;
  return textMentionsAny(combined, [
    "visual",
    "visible",
    "looks",
    "appears",
    "inferred",
    "likely",
    "guess",
    "guessed",
    "uncertain",
    "not text supported",
    "not text-supported",
    "foil alone"
  ]) && !hasStrongEvidence(reasonText);
}

function hasUncertainty(reasonText, unresolved) {
  const unresolvedText = searchable(unresolved.join(" "));
  const combined = `${reasonText} ${unresolvedText}`;
  return textMentionsAny(combined, [
    "uncertain",
    "unsure",
    "likely",
    "inferred",
    "visual-only",
    "visual only",
    "appears",
    "seems",
    "possible",
    "may be",
    "review",
    "unclear",
    "ambiguous",
    "partial",
    "partially",
    "incomplete",
    "guess",
    "guessed",
    "not confirmed",
    "unresolved"
  ]);
}

function hasVisualOnlyParallelRisk(fields, reasonText, unresolved) {
  const parallelText = searchable(fields.parallel);
  const combined = `${parallelText} ${reasonText} ${searchable(unresolved.join(" "))}`;
  const patternTerms = [
    "wave",
    "shimmer",
    "pattern",
    "foil",
    "refractor",
    "disco",
    "pulsar",
    "prizm",
    "parallel"
  ];

  if (!textMentionsAny(combined, patternTerms)) return false;
  if (!textMentionsAny(combined, ["visual", "visible", "looks", "appears", "inferred", "likely", "guess"]) && hasComplexVisualParallelRisk(fields.parallel)) {
    return !hasStrongEvidence(reasonText);
  }
  return textMentionsAny(combined, ["visual", "visible", "looks", "appears", "inferred", "likely", "guess"])
    && !hasStrongEvidence(reasonText);
}

function auditMissingHighValueFields(title, fields) {
  const titleText = searchable(title);
  const missing = [];

  if (fields.player && !subjectIncluded(titleText, fields.player)) {
    missing.push("player");
  }

  if (fields.character && !subjectIncluded(titleText, fields.character)) {
    missing.push("character");
  }

  if (fields.year && (!titleText.includes(fields.year) || yearConflict(titleText, fields.year))) {
    missing.push("year");
  }

  if (fields.serial_number && !titleText.includes(searchable(fields.serial_number))) {
    missing.push("serial");
  }

  const cardNumberRegistryEntry = resolveKnowledgeEntry(fields.card_number);
  if (
    commerciallyRequiresCardNumber(fields)
    && !titleIncludes(titleText, fields.card_number)
    && !(cardNumberRegistryEntry && titleIncludes(titleText, cardNumberRegistryEntry.label))
  ) {
    missing.push("card number");
  }

  if (fields.auto && !titleIncludesAny(titleText, ["auto", "autograph", "signed"])) {
    missing.push("auto");
  }

  if (fields.relic && !titleIncludesAny(titleText, ["relic", "memorabilia"])) {
    missing.push("relic");
  }

  if (fields.patch && !titleText.includes("patch")) {
    missing.push("patch");
  }

  if (fields.sketch && !titleText.includes("sketch")) {
    missing.push("sketch");
  }

  if (fields.redemption && !titleText.includes("redemption")) {
    missing.push("redemption");
  }

  if (fields.one_of_one && !titleIncludesAny(titleText, ["1/1", "01/01", "001/001", "one of one"])) {
    missing.push("1/1");
  }

  if (fields.grade_company && !titleIncludes(titleText, fields.grade_company)) {
    missing.push("grade company");
  }

  if (fields.grade && !gradeIncluded(titleText, fields.grade)) {
    missing.push("grade");
  }

  if (fields.subset && /\b(rookie|rc|1st bowman|1st)\b/i.test(fields.subset) && !titleIncludes(titleText, fields.subset)) {
    missing.push("rookie/1st");
  }

  return missing;
}

function auditMissingReviewFields(title, fields) {
  const titleText = searchable(title);
  const missing = [];

  if (fields.parallel && !titleIncludes(titleText, fields.parallel)) {
    missing.push("parallel");
  }

  if (fields.insert && !titleIncludes(titleText, fields.insert)) {
    missing.push("insert");
  }

  return missing;
}

function calibrateConfidence({ title, confidence, reason, fields, unresolved }) {
  if (confidence === "FAILED") return { confidence, reason, unresolved };

  const reasonText = searchable(reason);
  const missingHighValueFields = auditMissingHighValueFields(title, fields);
  const calibratedUnresolved = [...unresolved];
  missingHighValueFields.forEach((field) => {
    const label = `title missing ${field}`;
    if (!calibratedUnresolved.includes(label)) calibratedUnresolved.push(label);
  });

  const lowTriggers = missingHighValueFields.length > 0
    || yearConflict(searchable(title), fields.year)
    || textMentionsAny(`${reasonText} ${searchable(unresolved.join(" "))}`, [
      "wrong year",
      "year mismatch",
      "wrong serial",
      "serial mismatch",
      "missing auto",
      "missing serial",
      "missing grade",
      "missing player",
      "missing character",
      "missing card number",
      "missing 1/1",
      "missing rookie",
      "missing 1st bowman",
      "contradicts title"
    ]);

  if (lowTriggers) {
    return {
      confidence: "LOW",
      reason: appendCalibrationReason(reason, "Confidence downgraded: high-value fields require manual correction."),
      unresolved: calibratedUnresolved.slice(0, 12)
    };
  }

  if (confidence !== "HIGH") {
    return { confidence, reason, unresolved: calibratedUnresolved };
  }

  const missingReviewFields = auditMissingReviewFields(title, fields);
  missingReviewFields.forEach((field) => {
    const label = `title missing ${field}`;
    if (!calibratedUnresolved.includes(label)) calibratedUnresolved.push(label);
  });

  const highAllowed = hasStrongEvidence(reasonText)
    && calibratedUnresolved.length === 0
    && !hasUncertainty(reasonText, calibratedUnresolved)
    && !hasVisualOnlyParallelRisk(fields, reasonText, calibratedUnresolved)
    && !hasVisuallyGuessedParallel(fields, reasonText, calibratedUnresolved);

  if (highAllowed) {
    return { confidence, reason, unresolved: calibratedUnresolved };
  }

  const reviewLabel = "operator review required";
  if (!calibratedUnresolved.includes(reviewLabel)) calibratedUnresolved.push(reviewLabel);

  return {
    confidence: "MEDIUM",
    reason: appendCalibrationReason(reason, "Confidence downgraded: core identity fields may be usable, but listing readiness requires operator review."),
    unresolved: calibratedUnresolved.slice(0, 12)
  };
}

function appendCalibrationReason(reason, calibrationReason) {
  const base = String(reason || "").trim();
  const combined = base ? `${base} ${calibrationReason}` : calibrationReason;
  return combined.slice(0, 520);
}

function sanitizeResultText(result, fields, confidence, unresolved, maxTitleLength) {
  const hadBackgroundContamination = [
    result.title,
    result.reason,
    ...Object.values(result.fields || {})
  ].some((value) => typeof value === "string" && containsBackgroundTerm(value));

  const highValueInsert = resolveKnowledgeEntry(fields.insert)?.label || extractHighValueInsert(fields.insert);
  const rawTitle = stripChecklistCardNumbers(stripBackgroundTerms(result.title), fields)
    .replace(/\bBase\b/gi, fields.insert || fields.parallel ? " " : "Base")
    .replace(/\s+/g, " ")
    .trim();
  const requiredTitleTerms = [
    fields.product && !rawIncludes(rawTitle, fields.product) ? fields.product : null,
    fields.product === "Topps Cosmic Chrome" ? "Cosmic Chrome" : null,
    highValueInsert,
    fields.parallel === "Platinum" ? "Platinum" : null,
    titleIncludesSerial(rawTitle, fields) ? normalizeSerialText(fields.serial_number) : null,
    fields.one_of_one ? "1/1" : null,
    fields.grade_company && fields.grade ? `${fields.grade_company} ${String(fields.grade).match(/\d+(?:\.\d+)?/)?.[0] || fields.grade}` : null,
    fields.grade_company && /auto/i.test(String(result.title || "")) && /auto\s*10/i.test(String(result.title || "")) ? "Auto 10" : null
  ].filter(Boolean);
  let strippedTitle = rawTitle;

  if (fields.product === "Topps Cosmic Chrome") {
    strippedTitle = strippedTitle
      .replace(/\bTopps\s+Chrome\s+Cosmic\b/gi, "Topps Cosmic Chrome")
      .replace(/\bTopps\s+Chrome\b/gi, "Topps Cosmic Chrome");
  }

  if (fields.year && yearConflict(searchable(strippedTitle), fields.year)) {
    strippedTitle = strippedTitle.replace(/\b20\d{2}(?:-\d{2})?\b/, fields.year);
  }

  if (fields.one_of_one) {
    strippedTitle = strippedTitle
      .replace(/\bOne\s+of\s+One\b/gi, "1/1")
      .replace(/\bOne\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (highValueInsert === "Red Propulsion") {
    strippedTitle = strippedTitle.replace(/\bPropulsion\b/gi, "Red Propulsion");
  }

  if (highValueInsert === "Dual Signatures") {
    strippedTitle = strippedTitle.replace(/\bDual\b/gi, "Dual Signatures");
    strippedTitle = strippedTitle.replace(/\bDual\s+Signatures\b(?!\s+Auto\b)/gi, "Dual Signatures Auto");
  }

  if (highValueInsert === "Duo Logoman Autographs") {
    strippedTitle = strippedTitle.replace(/\bDual\s+Auto\b|\bDual\b/gi, "Duo Logoman Autographs");
  }

  if (highValueInsert === "Star Swatch Signatures") {
    strippedTitle = strippedTitle.replace(/\bPatch\s+Auto\b/gi, "Star Swatch Signatures");
  }

  const repairedTitle = fitRequiredTitleTerms(
    compactLowPriorityTitleTerms(strippedTitle, fields, maxTitleLength),
    requiredTitleTerms,
    fields,
    maxTitleLength
  );
  const repairedHighValueInsert = Boolean(highValueInsert && !rawIncludes(strippedTitle, highValueInsert));
  const title = normalizeTitle(repairedTitle, maxTitleLength);
  let reason = stripBackgroundTerms(result.reason);
  let guardedConfidence = confidence;
  const guardedUnresolved = [...unresolved];

  if (repairedHighValueInsert) {
    reason = appendCalibrationReason(reason, "High-value insert term preserved from structured evidence.");
  }

  const illustratorGuard = applyIllustratorMetadataGuard({
    title,
    reason: hadBackgroundContamination
      ? appendCalibrationReason(reason, "Background branding ignored.")
      : reason,
    fields,
    confidence: guardedConfidence,
    unresolved: guardedUnresolved,
    maxTitleLength
  });

  return {
    ...illustratorGuard,
    hadBackgroundContamination
  };
}

function applyIllustratorMetadataGuard({ title, reason, fields, confidence, unresolved, maxTitleLength }) {
  if (!fields.artist || fields.sketch) {
    return { title, reason, confidence, unresolved };
  }

  const artistInTitle = rawIncludes(title, fields.artist);
  const identity = fields.character || fields.player;
  const likelyPokemonTrainer = [
    title,
    reason,
    fields.brand,
    fields.product,
    fields.set,
    fields.subset,
    fields.insert
  ].some((value) => /pokemon|pokémon|trainer|supporter|tcg|支援者|训练家|訓練家|寶可夢|宝可梦/i.test(String(value || "")));

  if (!artistInTitle && !likelyPokemonTrainer) {
    return { title, reason, confidence, unresolved };
  }

  let guardedTitle = artistInTitle ? stripLiteralPhrase(title, fields.artist) : title;
  if (likelyPokemonTrainer && !fields.year) {
    guardedTitle = guardedTitle.replace(/\b20\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
  }

  if (identity && !rawIncludes(guardedTitle, identity)) {
    guardedTitle = `${identity} ${guardedTitle}`.replace(/\s+/g, " ").trim();
  }

  guardedTitle = ensureTitleTerm(guardedTitle, fields.card_number);
  guardedTitle = ensureTitleTerm(guardedTitle, fields.subset);
  guardedTitle = ensureTitleTerm(guardedTitle, fields.set);

  const guardedUnresolved = [...unresolved];
  if (!guardedUnresolved.includes("illustrator metadata only")) {
    guardedUnresolved.push("illustrator metadata only");
  }

  return {
    title: normalizeTitle(guardedTitle, maxTitleLength),
    confidence: confidence === "HIGH" ? "MEDIUM" : confidence,
    reason: appendCalibrationReason(reason, identity
      ? "Illustrator is metadata only."
      : "Illustrator is metadata only; localized trainer identity requires operator review."),
    unresolved: guardedUnresolved
  };
}

function fallbackResult(payload) {
  const firstImage = payload.images?.[0] || {};
  const sourceName = compactFileName(firstImage.name);
  const [code, resolvedLabel] = findResolutionLabel(firstImage.name, payload.resolutionMap);
  const titleParts = [sourceName];

  if (resolvedLabel && !sourceName.toLowerCase().includes(String(resolvedLabel).toLowerCase())) {
    titleParts.push(resolvedLabel);
  }

  const title = normalizeTitle(titleParts.filter(Boolean).join(" "), payload.maxTitleLength || maxFallbackTitleLength);

  return {
    title,
    confidence: title ? "MEDIUM" : "FAILED",
    reason: title
      ? "Fallback result from filename because OPENAI_API_KEY is not configured."
      : "No usable filename or AI configuration.",
    fields: {
      ...defaultFields,
      insert: resolvedLabel || null,
      card_number: code || null
    },
    unresolved: ["image identification", "market wording"],
    source: "fallback"
  };
}

function parseOpenAiText(data) {
  if (typeof data.output_text === "string") return data.output_text;

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

function safeJsonParse(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

function normalizeAiResult(result, maxTitleLength) {
  const confidenceMap = {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    UNSURE: "MEDIUM",
    LOW: "LOW",
    FAILED: "FAILED"
  };
  const confidence = confidenceMap[String(result.confidence || "").toUpperCase()] || "MEDIUM";
  const fields = normalizeFields(result.fields);
  const unresolved = normalizeUnresolved(result.unresolved, result.fields);
  const sanitized = sanitizeResultText(result, fields, confidence, unresolved, maxTitleLength);
  const title = moveLeadingGradeToEnd(sanitized.title, maxTitleLength);
  const calibrated = calibrateConfidence({
    title,
    confidence: sanitized.confidence,
    reason: sanitized.reason.slice(0, 520),
    fields,
    unresolved: sanitized.hadBackgroundContamination
      ? [...sanitized.unresolved, "background branding ignored"]
      : sanitized.unresolved
  });

  return {
    title,
    confidence: calibrated.confidence,
    reason: calibrated.reason,
    fields,
    unresolved: calibrated.unresolved,
    source: "openai"
  };
}

async function createOpenAiTitle(payload) {
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const intelligencePrompt = await loadPrompt();
  const imageInputs = payload.images.map((image, index) => ({
    type: "input_image",
    image_url: image.dataUrl,
    detail: index === 0 ? "high" : "low"
  }));

  const prompt = [
    intelligencePrompt,
    `Runtime title limit: ${maxTitleLength} characters.`,
    "Return only valid JSON. Do not wrap the response in Markdown.",
    "Resolution hints:",
    resolutionHints(payload.resolutionMap) || "None",
    registryPromptSummary(),
    "Asset context:",
    JSON.stringify({
      assetId: payload.assetId || null,
      mode: payload.mode || null,
      imageCount: payload.images.length,
      fileNames: payload.images.map((image) => image.name)
    }),
    "Required JSON shape:",
    JSON.stringify({
      title: "",
      confidence: "HIGH | MEDIUM | LOW | FAILED",
      reason: "",
      fields: defaultFields,
      unresolved: []
    })
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_LISTING_MODEL || defaultModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            ...imageInputs
          ]
        }
      ],
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const data = await response.json();
  const parsed = safeJsonParse(parseOpenAiText(data));
  return normalizeAiResult(parsed, maxTitleLength);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const authenticated = isValidSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);

  if (!authenticated) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  if (!Array.isArray(payload.images) || payload.images.length < 1 || payload.images.length > 2) {
    sendJson(res, 400, { ok: false, message: "Expected one or two card images." });
    return;
  }

  try {
    const result = process.env.OPENAI_API_KEY
      ? await createOpenAiTitle(payload)
      : fallbackResult(payload);

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 200, {
      title: "",
      confidence: "FAILED",
      reason: error.message,
      fields: defaultFields,
      unresolved: ["api"],
      source: "error"
    });
  }
}
