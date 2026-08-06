// Evaluation-only extension of the canonical response.
//
// The extra free_title is an observation channel, not a CSM field. It is
// intentionally returned beside the canonical object so the product resolver
// can be replayed without granting the model authority over product/set.

import {
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
  parseCanonicalFields,
  extractCanonicalPayload
} from "./canonical-fields.mjs";
import { composeFromCanonicalFields } from "./canonical-composer.mjs";

export const CANONICAL_FREE_PRODUCT_V1_VERSION = "canonical-free-product-v1";
export const CANONICAL_FREE_PRODUCT_V1_SCHEMA_NAME = "canonical_card_fields_with_free_title_v1";

const properties = Object.freeze({
  ...CANONICAL_FIELDS_SCHEMA.properties,
  free_title: {
    type: "string",
    maxLength: 120,
    description: "A best-effort marketplace title expression copied from visible card text. This is evidence only, not a canonical field; do not invent or use catalog/world knowledge."
  }
});

export const CANONICAL_FREE_PRODUCT_V1_SCHEMA = Object.freeze({
  ...CANONICAL_FIELDS_SCHEMA,
  required: Object.freeze([...CANONICAL_FIELDS_SCHEMA.required, "free_title"]),
  properties
});

export const CANONICAL_FREE_PRODUCT_V1_PROMPT = [
  CANONICAL_FIELDS_PROMPT,
  "After filling the canonical fields, also write `free_title` as one concise best-effort marketplace title using every useful identity phrase you can visibly read.",
  "free_title is an evidence channel only: copy visible words, do not infer a product or parallel from world knowledge, and do not let it replace or alter any canonical field. It may be empty only when no useful visible identity text can be expressed."
].join(" ");

export function buildCanonicalFreeProductV1Request({
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
        name: CANONICAL_FREE_PRODUCT_V1_SCHEMA_NAME,
        strict: true,
        schema: CANONICAL_FREE_PRODUCT_V1_SCHEMA
      }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: CANONICAL_FREE_PRODUCT_V1_PROMPT },
        ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
      ]
    }]
  };
}

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

export function finishCanonicalFreeProductV1(raw) {
  const parsed = typeof raw === "string" ? (() => {
    try { return JSON.parse(raw); } catch { return {}; }
  })() : (raw || {});
  const { fields, defects } = parseCanonicalFields(parsed);
  const composed = composeFromCanonicalFields(fields);
  const freeTitle = clean(parsed.free_title);
  return {
    title: composed.title,
    free_title: freeTitle,
    fields,
    field_defects: defects,
    sanitised: false,
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
    eval_version: CANONICAL_FREE_PRODUCT_V1_VERSION,
    production_promoted: false
  };
}

export { extractCanonicalPayload };
