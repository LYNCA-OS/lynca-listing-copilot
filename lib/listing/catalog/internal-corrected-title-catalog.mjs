import crypto from "node:crypto";
import { parseReviewedTitleFields } from "../memory/title-field-parser.mjs";
import {
  catalogFieldStatuses,
  catalogImportStatuses,
  catalogSourceTypes
} from "./catalog-contract.mjs";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && normalizeText(value) !== "" && value !== "UNKNOWN";
}

function serialParts(value) {
  const match = normalizeText(value).match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return { numerator: null, denominator: null };
  return {
    numerator: String(Number(match[1])),
    denominator: String(Number(match[2]))
  };
}

function stableRowKey(record = {}, title = "") {
  const seed = [
    record.id,
    record.source_feedback_id,
    record.asset_id,
    title
  ].filter(Boolean).join("|");
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function sportFromParsed(parsed = {}) {
  const haystack = [parsed.category, parsed.product, parsed.set, parsed.insert].filter(Boolean).join(" ");
  if (/\bbasketball\b|\bnba\b/i.test(haystack)) return "basketball";
  if (/\bsoccer\b|\bfifa\b|\buefa\b|\bmls\b/i.test(haystack)) return "soccer";
  if (/\bbaseball\b|\bmlb\b|\bbowman\b/i.test(haystack)) return "baseball";
  if (/\bfootball\b|\bnfl\b/i.test(haystack)) return "football";
  if (/\btc?g\b|\bpokemon\b|\byu-?gi-?oh\b/i.test(haystack)) return "tcg";
  if (/\bnon[_ -]?sports\b|\bstar wars\b/i.test(haystack)) return "non_sports";
  return null;
}

function leagueFromParsed(parsed = {}) {
  const haystack = [parsed.category, parsed.product, parsed.set, parsed.insert].filter(Boolean).join(" ");
  if (/\bnba\b/i.test(haystack)) return "NBA";
  if (/\bfifa\b/i.test(haystack)) return "FIFA";
  if (/\buefa\b/i.test(haystack)) return "UEFA";
  if (/\bmls\b/i.test(haystack)) return "MLS";
  if (/\bmlb\b/i.test(haystack)) return "MLB";
  if (/\bnfl\b/i.test(haystack)) return "NFL";
  return null;
}

function sourceRecord(record = {}, title = "") {
  return {
    source_type: catalogSourceTypes.INTERNAL_CORRECTED_TITLE,
    source_status: catalogFieldStatuses.VERIFIED_CANONICAL_TITLE,
    source_name: "internal corrected_title",
    source_url: record.source_url || null,
    source_metadata: {
      source_feedback_id: record.source_feedback_id || record.id || null,
      asset_id: record.asset_id || null,
      corrected_title_is_ground_truth: false
    },
    raw_text: title
  };
}

function splitFields(parsed = {}) {
  const serial = serialParts(parsed.serial_number);
  const setOrInsert = parsed.set || parsed.insert || (parsed.official_card_type && !/^base$/i.test(parsed.official_card_type)
    ? parsed.official_card_type
    : null);
  const identityFields = {
    sport: sportFromParsed(parsed),
    league: leagueFromParsed(parsed),
    season_year: parsed.year || null,
    manufacturer: parsed.manufacturer || null,
    brand: parsed.brand || parsed.manufacturer || null,
    product: parsed.product || null,
    set_or_insert: setOrInsert,
    subset: parsed.subset || null,
    players: parsed.players || [],
    team: parsed.team || null,
    card_number: parsed.collector_number || null,
    checklist_code: parsed.checklist_code || null,
    official_card_type: parsed.official_card_type || null,
    observable_components: parsed.observable_components || [],
    surface_color: parsed.surface_color || null,
    serial_denominator: serial.denominator
  };
  const physicalInstanceFields = {
    serial_number: parsed.serial_number || null,
    serial_numerator: serial.numerator,
    grade_company: parsed.grade_company || null,
    card_grade: parsed.card_grade || null,
    auto_grade: parsed.auto_grade || null,
    cert_number: parsed.cert_number || null
  };
  return { identityFields, physicalInstanceFields };
}

function fieldStatusesFor(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([field, value]) => [
    field,
    valuePresent(value)
      ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE
      : catalogFieldStatuses.REVIEW_REQUIRED
  ]));
}

export function correctedTitleRecordToCatalogStaging(record = {}) {
  const title = normalizeText(record.corrected_title || record.final_title || record.title);
  if (!title) return null;
  const parsed = parseReviewedTitleFields(title);
  const { identityFields, physicalInstanceFields } = splitFields(parsed);
  const identityPresentCount = Object.values(identityFields).filter(valuePresent).length;
  const importStatus = identityPresentCount >= 3
    ? catalogImportStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE
    : catalogImportStatuses.REVIEW_REQUIRED;

  return {
    source: sourceRecord(record, title),
    staging: {
      import_status: importStatus,
      source_row_key: stableRowKey(record, title),
      canonical_title: title,
      identity_fields: identityFields,
      physical_instance_fields: physicalInstanceFields,
      field_statuses: {
        ...fieldStatusesFor(identityFields),
        ...Object.fromEntries(Object.keys(physicalInstanceFields).map((field) => [
          field,
          valuePresent(physicalInstanceFields[field])
            ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE
            : catalogFieldStatuses.REVIEW_REQUIRED
        ]))
      },
      parse_confidence: importStatus === catalogImportStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE ? 0.62 : 0.35,
      review_notes: importStatus === catalogImportStatuses.REVIEW_REQUIRED
        ? "corrected_title parser did not recover enough identity fields"
        : null
    }
  };
}

export function correctedTitleRowsToCatalogStaging(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => correctedTitleRecordToCatalogStaging(row))
    .filter(Boolean);
}
