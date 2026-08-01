// Evaluation-only identity-hypothesis channel.
// Visible facts are captured first; identity hypotheses are a separate,
// explicitly non-canonical section so SEM/CSM can later decide admission.

export const CANDIDATE_EXPRESSION_V4_VERSION = "candidate-expression-v4";
export const CANDIDATE_EXPRESSION_V4_SCHEMA_NAME = "card_candidate_expression_v4";
export const CANDIDATE_EXPRESSION_V4_MAX_FACTS = 10;
export const CANDIDATE_EXPRESSION_V4_MAX_HYPOTHESES = 3;
export const CANDIDATE_EXPRESSION_V4_MAX_VALUE_LENGTH = 96;

const FACT_KINDS = Object.freeze([
  "identity", "subject", "year", "language", "affiliation", "number",
  "finish", "attribute", "grade", "other"
]);
const BASES = Object.freeze(["exact_text", "stamped_text", "logo_or_symbol", "visual_interpretation"]);
const IMAGES = Object.freeze(["image_1", "image_2"]);
const REGIONS = Object.freeze(["slab_label", "card_front", "card_back", "unknown"]);

const factSchema = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["value", "kind", "basis", "image", "region"],
  properties: {
    value: { type: "string", minLength: 1, maxLength: CANDIDATE_EXPRESSION_V4_MAX_VALUE_LENGTH },
    kind: { type: "string", enum: [...FACT_KINDS] },
    basis: { type: "string", enum: [...BASES] },
    image: { type: "string", enum: [...IMAGES] },
    region: { type: "string", enum: [...REGIONS] }
  }
});

const hypothesisSchema = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["value", "basis", "evidence_values"],
  properties: {
    value: { type: "string", minLength: 1, maxLength: CANDIDATE_EXPRESSION_V4_MAX_VALUE_LENGTH },
    basis: { type: "string", enum: ["visible_combination", "model_knowledge"] },
    evidence_values: {
      type: "array", maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: CANDIDATE_EXPRESSION_V4_MAX_VALUE_LENGTH }
    }
  }
});

export const CANDIDATE_EXPRESSION_V4_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["visible_facts", "identity_hypotheses", "unreadable_regions"],
  properties: {
    visible_facts: { type: "array", maxItems: CANDIDATE_EXPRESSION_V4_MAX_FACTS, items: factSchema },
    identity_hypotheses: {
      type: "array", maxItems: CANDIDATE_EXPRESSION_V4_MAX_HYPOTHESES, items: hypothesisSchema,
      description: "One to three specific product, set, or IP identity hypotheses after reading the visible facts."
    },
    unreadable_regions: {
      type: "array", maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
});

export const CANDIDATE_EXPRESSION_V4_PROMPT = [
  "Inspect every supplied collectible-card image in two passes.",
  "First, copy at most 10 commercially useful visible facts exactly: product, set, IP, subject, year, language, serial, card number, finish, rarity, autograph/RC, or grade. Keep image and region provenance.",
  "Second, after reading those facts, propose at most 3 concise identity hypotheses for the card's product, set, or IP. Combine visible facts when they form a fuller identity (for example Topps + Chrome + VeeFriends).",
  "A hypothesis is not canonical and must not be a title. Use basis visible_combination when the phrase is supported by the visible_facts list; use model_knowledge only when you are completing a non-contiguous identity, and leave evidence_values empty in that case.",
  "Do not use legal boilerplate, slogans, game statistics, biographies, or a person's name as an identity hypothesis. Do not infer serial, finish, year, grade, or subject from model knowledge.",
  "Return only the JSON object requested by the schema."
].join(" ");

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const parse = (raw) => {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

export function buildCandidateExpressionV4Request({ imageUrls = [], model, effort = "none", maxOutputTokens = 4096, imageDetail = "high" } = {}) {
  if (!["high", "original"].includes(imageDetail)) throw new Error(`unsupported_image_detail:${imageDetail}`);
  return {
    model, max_output_tokens: maxOutputTokens, reasoning: { effort },
    text: { format: { type: "json_schema", name: CANDIDATE_EXPRESSION_V4_SCHEMA_NAME, strict: true, schema: CANDIDATE_EXPRESSION_V4_SCHEMA } },
    input: [{ role: "user", content: [
      { type: "input_text", text: CANDIDATE_EXPRESSION_V4_PROMPT },
      ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
    ] }]
  };
}
export function extractCandidateExpressionV4Payload(body = {}) {
  if (body.output_text) return String(body.output_text);
  return (Array.isArray(body.output) ? body.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => part?.text).filter(Boolean).join("").trim();
}

export function parseCandidateExpressionV4(raw) {
  const parsed = parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { visible_facts: [], identity_hypotheses: [], unreadable_regions: [], candidate_defects: ["candidate_v4_unparseable"] };
  }
  const defects = [];
  const visible = Array.isArray(parsed.visible_facts) ? parsed.visible_facts : [];
  const hypotheses = Array.isArray(parsed.identity_hypotheses) ? parsed.identity_hypotheses : [];
  if (!Array.isArray(parsed.visible_facts)) defects.push("candidate_v4_facts_not_array");
  if (!Array.isArray(parsed.identity_hypotheses)) defects.push("candidate_v4_hypotheses_not_array");
  const visible_facts = visible.slice(0, CANDIDATE_EXPRESSION_V4_MAX_FACTS).flatMap((rawFact, index) => {
    const fact = { value: clean(rawFact?.value), kind: rawFact?.kind, basis: rawFact?.basis, image: rawFact?.image, region: rawFact?.region };
    if (!fact.value || fact.value.length > CANDIDATE_EXPRESSION_V4_MAX_VALUE_LENGTH
      || !FACT_KINDS.includes(fact.kind) || !BASES.includes(fact.basis)
      || !IMAGES.includes(fact.image) || !REGIONS.includes(fact.region)) {
      defects.push(`candidate_v4_invalid_fact:${index}`); return [];
    }
    return [fact];
  });
  const visibleValues = new Set(visible_facts.map((fact) => fact.value.toLocaleLowerCase("en-US")));
  const identity_hypotheses = hypotheses.slice(0, CANDIDATE_EXPRESSION_V4_MAX_HYPOTHESES).flatMap((rawHypothesis, index) => {
    const hypothesis = {
      value: clean(rawHypothesis?.value), basis: rawHypothesis?.basis,
      evidence_values: Array.isArray(rawHypothesis?.evidence_values) ? rawHypothesis.evidence_values.map(clean).filter(Boolean).slice(0, 4) : []
    };
    if (!hypothesis.value || hypothesis.value.length > CANDIDATE_EXPRESSION_V4_MAX_VALUE_LENGTH
      || !["visible_combination", "model_knowledge"].includes(hypothesis.basis)) {
      defects.push(`candidate_v4_invalid_hypothesis:${index}`); return [];
    }
    if (hypothesis.basis === "visible_combination" && hypothesis.evidence_values.some((value) => !visibleValues.has(value.toLocaleLowerCase("en-US")))) {
      defects.push(`candidate_v4_hypothesis_evidence_missing:${index}`); return [];
    }
    if (hypothesis.basis === "model_knowledge" && hypothesis.evidence_values.length) {
      defects.push(`candidate_v4_knowledge_evidence_forbidden:${index}`); return [];
    }
    return [hypothesis];
  });
  const unreadable_regions = (Array.isArray(parsed.unreadable_regions) ? parsed.unreadable_regions : [])
    .slice(0, 4).map(clean).filter(Boolean).filter((value) => value.length <= 120);
  return { visible_facts, identity_hypotheses, unreadable_regions, candidate_defects: defects };
}

export function finishCandidateExpressionV4(raw) {
  const parsed = parseCandidateExpressionV4(raw);
  return {
    title: "", raw_length: typeof raw === "string" ? raw.length : JSON.stringify(raw ?? {}).length,
    length: 0, sanitised: false, truncated: false,
    candidate_schema_version: CANDIDATE_EXPRESSION_V4_VERSION,
    candidate_facts: parsed.visible_facts,
    candidate_hypotheses: parsed.identity_hypotheses,
    unreadable_regions: parsed.unreadable_regions,
    candidate_defects: parsed.candidate_defects
  };
}
