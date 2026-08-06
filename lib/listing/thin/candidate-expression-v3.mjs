// Evaluation-only candidate-first observation envelope.
//
// Unlike the canonical and bounded-evidence arms, this request does not ask the
// model to choose CSM/SEM fields or write a marketplace title. It externalizes
// a small set of commercially relevant candidates first. A later, separately
// measured deterministic resolver may inspect them, but this module supplies no
// resolver, renderer, persistence hook, or production authority.

export const CANDIDATE_EXPRESSION_V3_VERSION = "candidate-expression-v3";
export const CANDIDATE_EXPRESSION_V3_SCHEMA_NAME = "card_candidate_expression_v3";
export const CANDIDATE_EXPRESSION_V3_MAX_FACTS = 16;
export const CANDIDATE_EXPRESSION_V3_MAX_VALUE_LENGTH = 96;
export const CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_REGIONS = 4;
export const CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_LENGTH = 120;

export const CANDIDATE_EXPRESSION_V3_KINDS = Object.freeze([
  "identity", "subject", "year", "language", "affiliation",
  "number", "finish", "attribute", "grade", "other"
]);
export const CANDIDATE_EXPRESSION_V3_BASES = Object.freeze([
  "exact_text", "stamped_text", "logo_or_symbol", "visual_interpretation", "model_knowledge"
]);
export const CANDIDATE_EXPRESSION_V3_IMAGES = Object.freeze(["image_1", "image_2", "none"]);
export const CANDIDATE_EXPRESSION_V3_REGIONS = Object.freeze([
  "slab_label", "card_front", "card_back", "unknown"
]);
export const CANDIDATE_EXPRESSION_V3_UNCERTAINTY = Object.freeze(["none", "uncertain"]);
export const CANDIDATE_EXPRESSION_V3_IMAGE_DETAILS = Object.freeze(["high", "original"]);

const CANDIDATE_FACT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["value", "kind", "basis", "image", "region", "uncertainty"],
  properties: {
    value: {
      type: "string",
      minLength: 1,
      maxLength: CANDIDATE_EXPRESSION_V3_MAX_VALUE_LENGTH,
      description: "A concise candidate value. For visible text, copy it exactly and preserve punctuation, slashes, case and leading zeroes."
    },
    kind: {
      type: "string",
      enum: [...CANDIDATE_EXPRESSION_V3_KINDS],
      description: "A broad observation kind. Use identity when product versus set versus IP is ambiguous."
    },
    basis: { type: "string", enum: [...CANDIDATE_EXPRESSION_V3_BASES] },
    image: { type: "string", enum: [...CANDIDATE_EXPRESSION_V3_IMAGES] },
    region: { type: "string", enum: [...CANDIDATE_EXPRESSION_V3_REGIONS] },
    uncertainty: { type: "string", enum: [...CANDIDATE_EXPRESSION_V3_UNCERTAINTY] }
  }
});

export const CANDIDATE_EXPRESSION_V3_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["candidate_facts", "unreadable_regions"],
  properties: {
    candidate_facts: {
      type: "array",
      maxItems: CANDIDATE_EXPRESSION_V3_MAX_FACTS,
      items: CANDIDATE_FACT_SCHEMA,
      description: "All commercially relevant candidates, including useful conflicts. This is an observation ledger, not a resolved semantic object."
    },
    unreadable_regions: {
      type: "array",
      maxItems: CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_REGIONS,
      items: {
        type: "string",
        minLength: 1,
        maxLength: CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_LENGTH
      },
      description: "Short image-and-location descriptions for commercially relevant text-bearing regions that remain unreadable."
    }
  }
});

export const CANDIDATE_EXPRESSION_V3_PROMPT = [
  "Inspect every supplied collectible-card image and return candidate facts, not a title and not canonical fields.",
  "Preserve every commercially useful identity phrase, subject, year, language, affiliation, code or number, stamped print run, finish or parallel, mark or component, and grade you can see, including useful conflicting candidates.",
  "Do not decide whether an ambiguous identity phrase is Product, Set, or IP; use kind `identity` and let a later resolver decide.",
  "Do not omit a proper noun merely because it appears inside copyright or trademark text. Copy the proper noun alone, not the surrounding legal boilerplate.",
  "For visible text, copy exactly and preserve punctuation, slashes, case, and leading zeroes. Name the source image and region. Logos and symbols remain their own visible basis.",
  "You may use your own card-world knowledge to propose a fuller identity, subject, year, or affiliation that is not printed contiguously, but it MUST use basis `model_knowledge`, image `none`, region `unknown`, and uncertainty `uncertain`.",
  "Never use model knowledge for a current-copy serial, grade, physical component, or finish, and never present inference as visible evidence.",
  "Keep concise facts, not a listing title, prose, statistics, biographies, legal boilerplate, or layout narration. Do not silently discard a candidate merely because it conflicts with another candidate.",
  `Return at most ${CANDIDATE_EXPRESSION_V3_MAX_FACTS} unique candidate facts and at most ${CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_REGIONS} concise unreadable-region descriptions.`
].join(" ");

export function buildCandidateExpressionV3Request({
  imageUrls = [], model, effort = "none", maxOutputTokens = 4096, imageDetail = "high"
} = {}) {
  if (!CANDIDATE_EXPRESSION_V3_IMAGE_DETAILS.includes(imageDetail)) {
    throw new Error(`unsupported_image_detail:${imageDetail}`);
  }
  return {
    model,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort },
    text: {
      format: {
        type: "json_schema",
        name: CANDIDATE_EXPRESSION_V3_SCHEMA_NAME,
        strict: true,
        schema: CANDIDATE_EXPRESSION_V3_SCHEMA
      }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: CANDIDATE_EXPRESSION_V3_PROMPT },
        ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
      ]
    }]
  };
}

export function extractCandidateExpressionV3Payload(body = {}) {
  if (body.output_text) return String(body.output_text);
  const parts = Array.isArray(body.output) ? body.output : [];
  return parts
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text).filter(Boolean).join("").trim();
}

const exactValue = (value) => String(value ?? "").normalize("NFC").trim();
const cleanText = (value) => exactValue(value).replace(/\s+/g, " ");

function parsedObject(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function allowed(value, values) {
  return values.includes(value);
}

function candidateKey(candidate) {
  return JSON.stringify([
    candidate.value.toLocaleLowerCase("en-US"), candidate.kind, candidate.basis,
    candidate.image, candidate.region, candidate.uncertainty
  ]);
}

export function parseCandidateExpressionV3(raw) {
  const parsed = parsedObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { candidate_facts: [], unreadable_regions: [], candidate_defects: ["candidate_v3_unparseable"] };
  }

  const defects = [];
  const source = parsed.candidate_facts;
  if (!Array.isArray(source)) {
    defects.push("candidate_v3_facts_not_array");
  } else if (source.length > CANDIDATE_EXPRESSION_V3_MAX_FACTS) {
    defects.push(`candidate_v3_overflow:${source.length - CANDIDATE_EXPRESSION_V3_MAX_FACTS}`);
  }

  const candidate_facts = [];
  const seen = new Set();
  for (const [index, rawCandidate] of (Array.isArray(source) ? source : [])
    .slice(0, CANDIDATE_EXPRESSION_V3_MAX_FACTS).entries()) {
    if (!rawCandidate || typeof rawCandidate !== "object" || Array.isArray(rawCandidate)) {
      defects.push(`candidate_v3_invalid_row:${index}`);
      continue;
    }
    const candidate = {
      value: exactValue(rawCandidate.value),
      kind: rawCandidate.kind,
      basis: rawCandidate.basis,
      image: rawCandidate.image,
      region: rawCandidate.region,
      uncertainty: rawCandidate.uncertainty
    };
    const rowDefects = [];
    if (!candidate.value || candidate.value.length > CANDIDATE_EXPRESSION_V3_MAX_VALUE_LENGTH) {
      defects.push(`candidate_v3_invalid_value:${index}`);
      continue;
    }
    for (const [field, values] of [
      ["kind", CANDIDATE_EXPRESSION_V3_KINDS],
      ["basis", CANDIDATE_EXPRESSION_V3_BASES],
      ["image", CANDIDATE_EXPRESSION_V3_IMAGES],
      ["region", CANDIDATE_EXPRESSION_V3_REGIONS],
      ["uncertainty", CANDIDATE_EXPRESSION_V3_UNCERTAINTY]
    ]) {
      if (!allowed(candidate[field], values)) rowDefects.push(`candidate_v3_invalid_${field}:${index}`);
    }
    if (rowDefects.length) {
      defects.push(...rowDefects);
      continue;
    }

    if (candidate.basis === "model_knowledge") {
      if (candidate.image !== "none" || candidate.region !== "unknown"
          || candidate.uncertainty !== "uncertain") {
        defects.push(`candidate_v3_knowledge_provenance_invalid:${index}`);
        continue;
      }
      if (!["identity", "subject", "year", "affiliation"].includes(candidate.kind)) {
        defects.push(`candidate_v3_knowledge_kind_forbidden:${index}`);
        continue;
      }
    } else if (candidate.image === "none") {
      defects.push(`candidate_v3_visible_image_missing:${index}`);
      continue;
    }

    const key = candidateKey(candidate);
    if (seen.has(key)) {
      defects.push(`candidate_v3_duplicate:${index}`);
      continue;
    }
    seen.add(key);
    candidate_facts.push(candidate);
  }

  const unreadableSource = parsed.unreadable_regions;
  if (!Array.isArray(unreadableSource)) {
    defects.push("candidate_v3_unreadable_not_array");
  } else if (unreadableSource.length > CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_REGIONS) {
    defects.push(`candidate_v3_unreadable_overflow:${unreadableSource.length - CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_REGIONS}`);
  }
  const unreadable_regions = (Array.isArray(unreadableSource) ? unreadableSource : [])
    .slice(0, CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_REGIONS)
    .flatMap((value, index) => {
      const text = cleanText(value);
      if (!text || text.length > CANDIDATE_EXPRESSION_V3_MAX_UNREADABLE_LENGTH) {
        defects.push(`candidate_v3_invalid_unreadable:${index}`);
        return [];
      }
      return [text];
    });

  return { candidate_facts, unreadable_regions, candidate_defects: defects };
}

export function finishCandidateExpressionV3(raw) {
  const parsed = parseCandidateExpressionV3(raw);
  // The general harness currently requires a string title for every arm. Keep
  // it empty: candidate facts are an observation ledger, never a rendered or
  // scoreable marketplace title. The capture gate reads `candidate_facts`.
  return {
    title: "",
    raw_length: typeof raw === "string" ? raw.length : JSON.stringify(raw ?? {}).length,
    length: 0,
    sanitised: false,
    truncated: false,
    candidate_schema_version: CANDIDATE_EXPRESSION_V3_VERSION,
    candidate_facts: parsed.candidate_facts,
    unreadable_regions: parsed.unreadable_regions,
    candidate_defects: parsed.candidate_defects
  };
}
