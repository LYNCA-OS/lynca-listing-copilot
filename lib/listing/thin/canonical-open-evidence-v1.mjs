// Evaluation-only one-call treatment: retain the canonical CSM/SEM object and
// an open candidate ledger in the same provider response. The ledger has no
// field authority; a later replay may test a narrowly sourced projection.

import {
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest,
  parseCanonicalFields
} from "./canonical-fields.mjs";
import { finishCanonicalTitle } from "./thin-listing-path.mjs";

export const CANONICAL_OPEN_EVIDENCE_V1 = "canonical-open-evidence-v1";
export const CANONICAL_OPEN_EVIDENCE_V1_SCHEMA_NAME = "canonical_card_fields_open_evidence_v1";
export const CANONICAL_OPEN_EVIDENCE_V1_MAX_FACTS = 12;

const FACT_KINDS = Object.freeze([
  "identity", "subject", "year", "language", "affiliation",
  "number", "finish", "attribute", "grade", "other"
]);
const FACT_BASES = Object.freeze([
  "exact_text", "stamped_text", "logo_or_symbol", "visual_interpretation", "model_knowledge"
]);
const FACT_IMAGES = Object.freeze(["image_1", "image_2", "none"]);
const FACT_REGIONS = Object.freeze(["slab_label", "card_front", "card_back", "unknown"]);
const FACT_UNCERTAINTY = Object.freeze(["none", "uncertain"]);

const FACT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["value", "kind", "basis", "image", "region", "uncertainty"],
  properties: {
    value: { type: "string", minLength: 1, maxLength: 96 },
    kind: { type: "string", enum: [...FACT_KINDS] },
    basis: { type: "string", enum: [...FACT_BASES] },
    image: { type: "string", enum: [...FACT_IMAGES] },
    region: { type: "string", enum: [...FACT_REGIONS] },
    uncertainty: { type: "string", enum: [...FACT_UNCERTAINTY] }
  }
});

export const CANONICAL_OPEN_EVIDENCE_V1_SCHEMA = Object.freeze({
  ...CANONICAL_FIELDS_SCHEMA,
  required: [...CANONICAL_FIELDS_SCHEMA.required, "candidate_facts", "unreadable_regions"],
  properties: {
    ...CANONICAL_FIELDS_SCHEMA.properties,
    candidate_facts: {
      type: "array",
      maxItems: CANONICAL_OPEN_EVIDENCE_V1_MAX_FACTS,
      items: FACT_SCHEMA,
      description: "Open-set observation ledger. Preserve useful visible or explicitly qualified knowledge candidates without assigning CSM fields."
    },
    unreadable_regions: {
      type: "array",
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
});

export const CANONICAL_OPEN_EVIDENCE_V1_PROMPT = [
  CANONICAL_FIELDS_PROMPT,
  "After filling every canonical field, make a second open observation pass.",
  `Preserve up to ${CANONICAL_OPEN_EVIDENCE_V1_MAX_FACTS} concise commercially useful candidate facts: product, set, IP, subject, year, language, affiliation, code, serial, finish, rarity, component or grade.`,
  "Do not force an ambiguous phrase into Product, Set or IP; use kind identity and let a later CSM/SEM resolver decide.",
  "For visible text copy exactly, preserving case, punctuation, slashes and leading zeroes. Use exact_text or stamped_text only when it is actually visible.",
  "You may add a fuller identity or temporal affiliation from card-world knowledge only as basis model_knowledge with image none, region unknown and uncertainty uncertain. Never use that basis for serial, finish, grade or physical components.",
  "The candidate ledger is append-only evidence, not a title and not authority. Do not omit canonical fields merely to make room for it."
].join(" ");

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function parsedObject(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export function parseCanonicalOpenEvidenceV1(raw) {
  const parsed = parsedObject(raw);
  const canonical = parseCanonicalFields(parsed ?? raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      fields: canonical.fields,
      field_defects: canonical.defects,
      candidate_facts: [],
      unreadable_regions: [],
      candidate_defects: ["canonical_open_evidence_unparseable"]
    };
  }
  const defects = [];
  const facts = Array.isArray(parsed.candidate_facts) ? parsed.candidate_facts : [];
  if (!Array.isArray(parsed.candidate_facts)) defects.push("candidate_facts_not_array");
  const candidate_facts = facts.slice(0, CANONICAL_OPEN_EVIDENCE_V1_MAX_FACTS).flatMap((rawFact, index) => {
    const fact = {
      value: clean(rawFact?.value),
      kind: rawFact?.kind,
      basis: rawFact?.basis,
      image: rawFact?.image,
      region: rawFact?.region,
      uncertainty: rawFact?.uncertainty
    };
    if (!fact.value || fact.value.length > 96
      || !FACT_KINDS.includes(fact.kind) || !FACT_BASES.includes(fact.basis)
      || !FACT_IMAGES.includes(fact.image) || !FACT_REGIONS.includes(fact.region)
      || !FACT_UNCERTAINTY.includes(fact.uncertainty)) {
      defects.push(`candidate_fact_invalid:${index}`);
      return [];
    }
    if (fact.basis === "model_knowledge"
      && (fact.image !== "none" || fact.region !== "unknown" || fact.uncertainty !== "uncertain")) {
      defects.push(`candidate_fact_knowledge_provenance_invalid:${index}`);
      return [];
    }
    if (fact.basis !== "model_knowledge" && fact.image === "none") {
      defects.push(`candidate_fact_visible_image_missing:${index}`);
      return [];
    }
    return [fact];
  });
  const unreadable_regions = (Array.isArray(parsed.unreadable_regions) ? parsed.unreadable_regions : [])
    .slice(0, 4).map(clean).filter((value) => value && value.length <= 120);
  if (!Array.isArray(parsed.unreadable_regions)) defects.push("unreadable_regions_not_array");
  return {
    fields: canonical.fields,
    field_defects: canonical.defects,
    candidate_facts,
    unreadable_regions,
    candidate_defects: defects
  };
}

export function buildCanonicalOpenEvidenceV1Request(context = {}) {
  const request = buildCanonicalFieldsRequest(context);
  request.text.format = {
    type: "json_schema",
    name: CANONICAL_OPEN_EVIDENCE_V1_SCHEMA_NAME,
    strict: true,
    schema: CANONICAL_OPEN_EVIDENCE_V1_SCHEMA
  };
  request.input[0].content[0].text = CANONICAL_OPEN_EVIDENCE_V1_PROMPT;
  return request;
}

export function extractCanonicalOpenEvidenceV1Payload(body = {}) {
  if (body.output_text) return String(body.output_text);
  return (Array.isArray(body.output) ? body.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => part?.text).filter(Boolean).join("").trim();
}

export function finishCanonicalOpenEvidenceV1(raw) {
  const parsed = parseCanonicalOpenEvidenceV1(raw);
  const canonical = finishCanonicalTitle(raw);
  return {
    ...canonical,
    candidate_schema_version: CANONICAL_OPEN_EVIDENCE_V1,
    candidate_facts: parsed.candidate_facts,
    unreadable_regions: parsed.unreadable_regions,
    candidate_defects: parsed.candidate_defects
  };
}
