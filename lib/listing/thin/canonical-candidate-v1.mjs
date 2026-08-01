// Evaluation-only same-call channel: canonical fields plus non-authoritative
// visible facts and identity hypotheses. It is deliberately not imported by
// the production thin path. The candidate lane has no CSM/SEM/storage access;
// callers must still run an explicit admission replay before using it.

import {
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
  parseCanonicalFields,
  extractCanonicalPayload
} from "./canonical-fields.mjs";
import {
  CANDIDATE_EXPRESSION_V4_PROMPT,
  CANDIDATE_EXPRESSION_V4_SCHEMA,
  CANDIDATE_EXPRESSION_V4_VERSION,
  parseCandidateExpressionV4
} from "./candidate-expression-v4.mjs";
import { finishCanonicalTitle } from "./thin-listing-path.mjs";

export const CANONICAL_CANDIDATE_V1_VERSION = "canonical-candidate-v1";
export const CANONICAL_CANDIDATE_V1_SCHEMA_NAME = "canonical_card_fields_with_candidates_v1";

const required = Object.freeze([
  ...CANONICAL_FIELDS_SCHEMA.required,
  "visible_facts", "identity_hypotheses", "unreadable_regions"
]);

export const CANONICAL_CANDIDATE_V1_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required,
  properties: Object.freeze({
    ...CANONICAL_FIELDS_SCHEMA.properties,
    ...CANDIDATE_EXPRESSION_V4_SCHEMA.properties
  })
});

export const CANONICAL_CANDIDATE_V1_PROMPT = [
  CANONICAL_FIELDS_PROMPT,
  "After filling the canonical fields, make a separate non-authoritative evidence pass.",
  "Copy at most 10 commercially useful visible facts exactly into visible_facts, preserving image and region provenance.",
  "Then propose at most 3 concise identity hypotheses in identity_hypotheses. A hypothesis is only a candidate for later SEM/CSM admission, never a canonical field or a title.",
  "Use visible_combination only when the hypothesis is supported by visible_facts; use model_knowledge only for an explicitly uncertain completion and never use it to fill a canonical field.",
  "Do not let the candidate pass change, justify, or repeat a canonical value. Return only the schema object."
].join(" ");

export function buildCanonicalCandidateV1Request({
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
        name: CANONICAL_CANDIDATE_V1_SCHEMA_NAME,
        strict: true,
        schema: CANONICAL_CANDIDATE_V1_SCHEMA
      }
    },
    input: [{ role: "user", content: [
      { type: "input_text", text: CANONICAL_CANDIDATE_V1_PROMPT },
      ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
    ] }]
  };
}

export function finishCanonicalCandidateV1(raw, { limit } = {}) {
  const canonical = finishCanonicalTitle(raw, limit === undefined ? {} : { limit });
  const candidate = parseCandidateExpressionV4(raw);
  return {
    ...canonical,
    candidate_schema_version: CANDIDATE_EXPRESSION_V4_VERSION,
    candidate_facts: candidate.visible_facts,
    candidate_hypotheses: candidate.identity_hypotheses,
    candidate_defects: candidate.candidate_defects,
    candidate_unreadable_regions: candidate.unreadable_regions,
    same_call_channel_version: CANONICAL_CANDIDATE_V1_VERSION,
    production_promoted: false,
    authority: "evaluation_only"
  };
}

export function parseCanonicalCandidateV1(raw) {
  const canonical = parseCanonicalFields(raw);
  const candidate = parseCandidateExpressionV4(raw);
  return {
    fields: canonical.fields,
    canonical_defects: canonical.defects,
    candidate_facts: candidate.visible_facts,
    candidate_hypotheses: candidate.identity_hypotheses,
    candidate_defects: candidate.candidate_defects,
    candidate_unreadable_regions: candidate.unreadable_regions,
    authority: "evaluation_only",
    production_promoted: false
  };
}

export { extractCanonicalPayload };
