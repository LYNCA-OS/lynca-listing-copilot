// Evaluation-only extension of the CSM canonical response.
//
// COS-9 gives TCG [IP] a first-class position, but the thin schema previously
// carried only the derived IP labels that semTcgIpLabel already knew. That
// leaves newer/less conventional TCG identities (for example Disney and
// VeeFriends) with no place to go. This arm asks for one narrowly scoped,
// printed IP value; it does not add open evidence or a second call.

import {
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
  parseCanonicalFields
} from "./canonical-fields.mjs";
import { composeFromCanonicalFields } from "./canonical-composer.mjs";
import { sanitizeListingTitle } from "./sanitize-listing-title.mjs";

export const CANONICAL_IP_V1_VERSION = "canonical-ip-v1";
export const CANONICAL_IP_V1_SCHEMA_NAME = "canonical_card_fields_ip_v1";

const properties = Object.freeze({
  ...CANONICAL_FIELDS_SCHEMA.properties,
  ip: {
    type: "string",
    maxLength: 48,
    description: "For TCG cards only, the printed game, franchise, or IP identity (for example Pokemon, Disney, Disney Lorcana, VeeFriends, Star Wars). Copy it from visible card text or a logo. Do not put a manufacturer, sport, team, league, grader, sponsor, product fragment, character, or set here. Empty when no clear printed IP is visible."
  }
});

export const CANONICAL_IP_V1_SCHEMA = Object.freeze({
  ...CANONICAL_FIELDS_SCHEMA,
  required: Object.freeze([...CANONICAL_FIELDS_SCHEMA.required, "ip"]),
  properties
});

export const CANONICAL_IP_V1_PROMPT = [
  CANONICAL_FIELDS_PROMPT,
  "This card may be a trading card game or other collectible franchise card.",
  "After the other fields, fill `ip` only for TCG cards: copy the printed game, franchise, or IP identity from visible text or a logo (for example Pokemon, Disney, Disney Lorcana, VeeFriends, Star Wars).",
  "Do not use `ip` for a sports league, team, manufacturer, grader, sponsor, product fragment, character, set, or a value inferred only from world knowledge. Leave it empty when the printed IP is not clear.",
  "Set `grammar` to `tcg` for a TCG or collectible franchise card, including one whose IP is not in a fixed list."
].join(" ");

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function parsedObject(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export function parseCanonicalIpV1(raw) {
  const parsed = parsedObject(raw);
  const canonical = parseCanonicalFields(parsed ?? raw);
  const defects = [...canonical.defects];
  const fields = { ...canonical.fields };
  const candidate = clean(parsed?.ip);

  // Do not let this optional field silently turn a standard sports card into a
  // TCG card. The model must make the grammar decision in the same response.
  if (candidate && candidate.length <= 48 && fields.grammar === "tcg") fields.ip = candidate;
  else if (candidate) defects.push("ip_requires_tcg_grammar");

  return { fields, defects };
}

export function buildCanonicalIpV1Request({
  imageUrls = [], model, effort = "none", maxOutputTokens = 4096, imageDetail = "high"
} = {}) {
  if (!["high", "original"].includes(imageDetail)) throw new Error(`unsupported_image_detail:${imageDetail}`);
  return {
    model,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort },
    text: {
      format: {
        type: "json_schema",
        name: CANONICAL_IP_V1_SCHEMA_NAME,
        strict: true,
        schema: CANONICAL_IP_V1_SCHEMA
      }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: CANONICAL_IP_V1_PROMPT },
        ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
      ]
    }]
  };
}

export function extractCanonicalIpV1Payload(body = {}) {
  if (body.output_text) return String(body.output_text);
  return (Array.isArray(body.output) ? body.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => part?.text).filter(Boolean).join("").trim();
}

export function finishCanonicalIpV1(raw, { limit } = {}) {
  const parsed = parseCanonicalIpV1(raw);
  let sanitised = false;
  const cleaned = { ...parsed.fields };
  for (const key of ["year", "ip", "manufacturer", "product", "set", "card_name", "release_variant",
    "print_finish", "descriptive_rarity", "card_number", "serial", "grade", "team"]) {
    const result = sanitizeListingTitle(cleaned[key]);
    if (result.title !== cleaned[key]) sanitised = true;
    cleaned[key] = result.title;
  }
  cleaned.subjects = cleaned.subjects.map((subject) => {
    const result = sanitizeListingTitle(subject);
    if (result.title !== subject) sanitised = true;
    return result.title;
  }).filter(Boolean);
  const composed = composeFromCanonicalFields(cleaned, limit === undefined ? {} : { limit });
  return {
    title: composed.title,
    fields: cleaned,
    field_defects: parsed.defects,
    sanitised,
    truncated: composed.truncated,
    grammar: composed.grammar,
    brackets: composed.brackets,
    dropped_brackets: composed.dropped,
    suppressed_brackets: composed.suppressed,
    restored_brackets: composed.restored,
    empty_fields: composed.empty_fields,
    unreadable_fields: composed.unreadable,
    low_confidence_fields: composed.low_confidence,
    inferred_parent: composed.inferred_parent,
    normalization_reasons: composed.normalization_reasons,
    raw_length: typeof raw === "string" ? raw.length : JSON.stringify(raw ?? {}).length,
    length: composed.length,
    eval_version: CANONICAL_IP_V1_VERSION,
    production_promoted: false
  };
}
