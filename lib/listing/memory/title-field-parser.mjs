import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";

const colorWords = Object.freeze([
  "Black",
  "Blue",
  "Bronze",
  "Dark Blue",
  "Gold",
  "Green",
  "Orange",
  "Pink",
  "Purple",
  "Red",
  "Silver",
  "White",
  "Yellow"
]);

const parallelSuffixes = Object.freeze([
  "Bordered",
  "Cracked Ice",
  "Geometric",
  "Hyper",
  "Mojo",
  "Prizm",
  "Refractor",
  "Shimmer",
  "Sparkle",
  "Sparkles",
  "Speckle",
  "Vinyl",
  "Wave"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function yearFromTitle(title) {
  const match = normalizeText(title).match(/\b(\d{4}(?:-\d{2})?)\b/);
  return match?.[1] || null;
}

function serialFromTitle(title) {
  const serials = (String(title || "").match(/\b\d+\s*\/\s*\d+\b/g) || []).map(normalizeSerial).filter(Boolean);
  return serials.at(-1) || null;
}

function collectorNumberFromTitle(title) {
  const matches = [...normalizeText(title).matchAll(/#\s*([A-Z0-9][A-Z0-9-]{0,14})\b/gi)]
    .map((match) => match[1].toUpperCase())
    .filter((value) => !/^\d{4}$/.test(value));
  return matches.at(-1) || null;
}

function gradeFromTitle(title) {
  const match = normalizeText(title).match(/\b(PSA|BGS|SGC|CGC|Beckett)\s+(?:Gem\s+Mint\s+)?(AUTO\s+)?(\d+(?:\.\d+)?)\b/i);
  if (!match) return {};
  const company = /^beckett$/i.test(match[1]) ? "BGS" : match[1].toUpperCase();
  return match[2]
    ? { grade_company: company, auto_grade: match[3], grade_type: "AUTO_ONLY" }
    : { grade_company: company, card_grade: match[3], grade_type: "CARD_ONLY" };
}

function productHintsFromTitle(title) {
  const text = normalizeText(title);
  const hints = {};
  const brandMatch = text.match(/\b(Topps|Panini|Bowman|Upper Deck|Fleer|Donruss|Cardsmiths)\b/i);
  if (brandMatch) hints.manufacturer = brandMatch[1].replace(/\b\w/g, (letter) => letter.toUpperCase());

  const productPatterns = [
    /\bTopps\s+Star\s+Wars\s+Chrome\s+Black\b/i,
    /\bTopps\s+Chrome\s+Black\b/i,
    /\bTopps\s+Chrome\s+Sapphire\b/i,
    /\bTopps\s+Sapphire\b/i,
    /\bTopps\s+Chrome\b/i,
    /\bTopps\s+Finest\b/i,
    /\bTopps\s+Heritage\b/i,
    /\bTopps\s+Stadium\s+Club\b/i,
    /\bStadium\s+Club\b/i,
    /\bTopps\s+Triple\s+Threads\b/i,
    /\bTriple\s+Threads\b/i,
    /\bBowman\s+Chrome\b/i,
    /\bBowman\s+Draft\b/i,
    /\bBowman\b/i,
    /\bPanini\s+Prizm\b/i,
    /\bPanini\s+Hoops\b/i,
    /\bPanini\s+Absolute\b/i,
    /\bAbsolute\s+Hoopla\b/i,
    /\bPanini\s+Select\b/i,
    /\bPanini\s+Mosaic\b/i,
    /\bDonruss\s+Optic\b/i,
    /\bPanini\s+Impeccable\b/i,
    /\bPanini\s+Contenders\b/i,
    /\bUpper\s+Deck\s+Sweet\s+Shot\b/i,
    /\bFleer\s+Greats\b/i,
    /\bContenders\b/i,
    /\bPrizm\b/i
  ];
  const product = productPatterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  if (product) hints.product = product;

  return hints;
}

function parallelFromTitle(title) {
  const text = normalizeText(title);
  const escapedColors = colorWords.map((color) => color.replace(/\s+/g, "\\s+")).join("|");
  const escapedSuffixes = parallelSuffixes.map((suffix) => suffix.replace(/\s+/g, "\\s+")).join("|");
  const colorSuffix = text.match(new RegExp(`\\b(${escapedColors})(?:[-\\s]+(${escapedSuffixes})(?:[-\\s]+(${escapedSuffixes}))?)?\\b`, "i"));
  if (!colorSuffix) return null;
  const parts = [colorSuffix[1], colorSuffix[2], colorSuffix[3]]
    .map(normalizeText)
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.map((part) => part.replace(/\b\w/g, (letter) => letter.toUpperCase())).join(" ");
}

export function parseReviewedTitleFields(title = {}) {
  const text = normalizeText(title);
  const fields = {
    ...productHintsFromTitle(text),
    year: yearFromTitle(text),
    serial_number: serialFromTitle(text),
    collector_number: collectorNumberFromTitle(text),
    parallel: parallelFromTitle(text),
    ...gradeFromTitle(text),
    rc: /\b(?:RC|Rookie|Rated Rookie|Rookie Ticket)\b/i.test(text),
    first_bowman: /\b(?:1st|First)\s+Bowman\b/i.test(text),
    auto: /\b(?:Auto|Autograph|Signed|Signature|Signatures)\b/i.test(text),
    patch: /\bPatch\b/i.test(text),
    relic: /\b(?:Relic|Jersey|Swatch|Memorabilia|Logoman)\b/i.test(text),
    one_of_one: /\b0*1\s*\/\s*0*1\b/.test(text)
  };

  return normalizeResolvedFields(Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "boolean") return value === true;
      return value !== null && value !== undefined && value !== "";
    })
  ));
}

export function reviewedTitleRecordToMemoryRecord(record = {}) {
  const title = normalizeText(record.corrected_title || record.final_title || record.title);
  const fields = parseReviewedTitleFields(title);
  const populatedFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "boolean") return value === true;
      return value !== null && value !== undefined && value !== "" && value !== "UNKNOWN";
    })
  );

  return {
    id: record.id || record.source_feedback_id || "",
    title,
    final_title: title,
    fields: populatedFields,
    review_outcome: record.review_outcome || "CORRECTED_FIELDS",
    stable_training_sample: record.stable_training_sample === true,
    training_status: record.training_status || "title_parsed_local",
    reusable_approved_title: false,
    source_feedback_id: record.source_feedback_id || record.id || ""
  };
}

export function reviewedTitleRowsToMemoryRecords(rows = []) {
  return unique((Array.isArray(rows) ? rows : [])
    .map((row) => reviewedTitleRecordToMemoryRecord(row))
    .filter((record) => record.title && Object.keys(record.fields || {}).length > 0)
    .map((record) => JSON.stringify(record)))
    .map((record) => JSON.parse(record));
}
