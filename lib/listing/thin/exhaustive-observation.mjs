// Diagnostic-only, unconstrained observation arm.
//
// It deliberately does not ask for a listing title or CSM fields. The model
// enumerates everything it can see, including facts whose semantic label is
// unknown. This lets a paired experiment separate visual/expression misses
// from closed-schema compression and downstream composition loss.

import { CANONICAL_IMAGE_DETAILS, extractCanonicalPayload } from "./canonical-fields.mjs";

export const EXHAUSTIVE_OBSERVATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["observations", "unreadable_regions"],
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidence", "kind", "region", "label", "confidence"],
        properties: {
          evidence: {
            type: "string",
            description: "Exact visible text when text is readable; otherwise a literal visual description. Preserve numbers, punctuation and leading zeroes."
          },
          kind: { type: "string", enum: ["printed_text", "visual_property", "object_structure"] },
          region: { type: "string", enum: ["slab_label", "card_front", "card_back", "unknown"] },
          label: {
            type: "string",
            description: "Best short open-set label for this fact, such as name, logo, code, stamped_number, color, finish, emblem, or unknown. Do not force a CSM field."
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] }
        }
      }
    },
    unreadable_regions: {
      type: "array",
      items: { type: "string" },
      description: "Visible text-bearing regions that remain unreadable, described by location."
    }
  }
});

export const EXHAUSTIVE_OBSERVATION_PROMPT = [
  "Inspect every supplied image of this collectible card and exhaustively enumerate everything visibly present.",
  "This is a perception diagnostic, not a listing task: do not write a title, rank facts, apply an 80-character budget, or limit yourself to known card fields.",
  "Scan the slab label, every area of the card front, and every area of the card back. Record names, words, abbreviations, logos, emblems, colors, patterns, signatures, patches, stamps, checklist codes, serial forms, copyright lines, languages, teams, products, sets and layout facts.",
  "Use one observation per fact. Preserve exact readable text, punctuation, slashes and leading zeroes. Do not merge several printed phrases into a shorter summary.",
  "When you can see a fact but do not know what it means, keep it with label `unknown`. When text exists but cannot be read, describe its location in unreadable_regions.",
  "Do not infer facts from general card knowledge. Report only visible evidence."
].join(" ");

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

export function parseExhaustiveObservation(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return { observations: [], unreadable_regions: [], defects: ["unparseable"] }; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { observations: [], unreadable_regions: [], defects: ["not_an_object"] };
  }
  const observations = (Array.isArray(parsed.observations) ? parsed.observations : [])
    .map((row) => ({
      evidence: clean(row?.evidence),
      kind: clean(row?.kind),
      region: clean(row?.region),
      label: clean(row?.label),
      confidence: clean(row?.confidence)
    }))
    .filter((row) => row.evidence);
  const unreadable_regions = (Array.isArray(parsed.unreadable_regions) ? parsed.unreadable_regions : [])
    .map(clean).filter(Boolean);
  return { observations, unreadable_regions, defects: [] };
}

export function buildExhaustiveObservationRequest({
  imageUrls = [], model, effort = "none", maxOutputTokens = 8192, imageDetail = "high"
} = {}) {
  if (!CANONICAL_IMAGE_DETAILS.includes(imageDetail)) throw new Error(`unsupported_image_detail:${imageDetail}`);
  return {
    model,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort },
    text: {
      format: { type: "json_schema", name: "exhaustive_card_observations", strict: true, schema: EXHAUSTIVE_OBSERVATION_SCHEMA }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: EXHAUSTIVE_OBSERVATION_PROMPT },
        ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
      ]
    }]
  };
}

export const extractExhaustiveObservationPayload = extractCanonicalPayload;

export function finishExhaustiveObservation(raw) {
  const parsed = parseExhaustiveObservation(raw);
  const evidenceText = parsed.observations.map((row) => row.evidence).join(" ");
  return {
    title: evidenceText,
    raw_length: evidenceText.length,
    length: evidenceText.length,
    sanitised: false,
    truncated: false,
    observations: parsed.observations,
    unreadable_regions: parsed.unreadable_regions,
    observation_defects: parsed.defects
  };
}
