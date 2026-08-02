// Standalone evaluation arm only. It is intentionally not mixed into the
// literal observation schema: hypotheses may use model knowledge and require a
// later world-support ranker before any admission can even be considered.

export const PRODUCT_SET_PARALLEL_HYPOTHESIS_LANE_V1 = "product-set-parallel-hypothesis-lane-v1";
export const PRODUCT_SET_PARALLEL_HYPOTHESIS_MAX_ROWS = 2;

const REGIONS = Object.freeze(["slab_label", "card_front", "card_back", "unknown"]);
const BASES = Object.freeze(["visible_combination", "model_knowledge"]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

export const PRODUCT_SET_PARALLEL_HYPOTHESIS_PROPERTY_V1 = Object.freeze({
  type: "array",
  maxItems: PRODUCT_SET_PARALLEL_HYPOTHESIS_MAX_ROWS,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["product", "set", "parallel", "region", "basis"],
    properties: {
      product: { type: "string", maxLength: 64 },
      set: { type: "string", maxLength: 64 },
      parallel: { type: "string", maxLength: 64 },
      region: { type: "string", enum: [...REGIONS] },
      basis: { type: "string", enum: [...BASES] }
    }
  }
});

export const PRODUCT_SET_PARALLEL_HYPOTHESIS_PROMPT_V1 = [
  "After canonical fields, optionally propose at most two mutually exclusive `product_set_parallel_hypotheses`.",
  "Each row is one complete alternative tuple with product, set, and parallel strings; use an empty string for an unknown member, but never emit an all-empty tuple.",
  "The two rows must be competing explanations, not complementary fragments; a later world ranker may select at most one tuple.",
  "Use visible_combination only when visible regions jointly support the complete value. Use model_knowledge only as an explicit hypothesis, never as observed text.",
  "These hypotheses cannot change canonical fields or the title and must remain empty when no narrower hypothesis is justified."
].join(" ");

export function withProductSetParallelHypothesisLaneV1(request, { enabled = false } = {}) {
  const next = clone(request);
  if (!enabled) return next;
  const format = next?.text?.format;
  const promptPart = next?.input?.[0]?.content?.find?.((part) => part?.type === "input_text");
  if (!plainObject(format?.schema) || !Array.isArray(format.schema.required)
      || !promptPart || typeof promptPart.text !== "string") {
    throw new TypeError("invalid_canonical_request");
  }
  if (format.schema.properties.product_set_parallel_hypotheses) {
    throw new TypeError("product_set_parallel_hypotheses_already_present");
  }
  format.schema = {
    ...clone(format.schema),
    required: [...format.schema.required, "product_set_parallel_hypotheses"],
    properties: {
      ...clone(format.schema.properties),
      product_set_parallel_hypotheses: clone(PRODUCT_SET_PARALLEL_HYPOTHESIS_PROPERTY_V1)
    }
  };
  format.name = `${String(format.name || "canonical_card_fields")}_psp_hypothesis_v1`;
  promptPart.text = `${promptPart.text.trim()} ${PRODUCT_SET_PARALLEL_HYPOTHESIS_PROMPT_V1}`;
  return next;
}

export function captureProductSetParallelHypothesesV1(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  const empty = {
    schema_version: PRODUCT_SET_PARALLEL_HYPOTHESIS_LANE_V1,
    candidates: [], dropped: [], defects: [], field_updates: {}, admission_proposals: [],
    automatic_csm_admission: false, automatic_renderer_admission: false
  };
  if (!plainObject(parsed) || !Array.isArray(parsed.product_set_parallel_hypotheses)) {
    return { ...empty, defects: ["psp_hypothesis_unparseable_or_missing"] };
  }
  const defects = [];
  const dropped = [];
  const candidates = [];
  const seenTuples = new Set();
  const source = parsed.product_set_parallel_hypotheses;
  if (source.length > PRODUCT_SET_PARALLEL_HYPOTHESIS_MAX_ROWS) {
    defects.push(`psp_hypothesis_overflow:${source.length - PRODUCT_SET_PARALLEL_HYPOTHESIS_MAX_ROWS}`);
  }
  for (const [index, rawRow] of source.slice(0, PRODUCT_SET_PARALLEL_HYPOTHESIS_MAX_ROWS).entries()) {
    const keys = ["basis", "parallel", "product", "region", "set"];
    const row = {
      product: clean(rawRow?.product),
      set: clean(rawRow?.set),
      parallel: clean(rawRow?.parallel),
      region: rawRow?.region,
      basis: rawRow?.basis
    };
    if (!plainObject(rawRow) || Object.keys(rawRow).sort().join("|") !== keys.join("|")
        || (!row.product && !row.set && !row.parallel)
        || [row.product, row.set, row.parallel].some((value) => value.length > 64)
        || !REGIONS.includes(row.region) || !BASES.includes(row.basis)) {
      defects.push(`psp_hypothesis_invalid_row:${index}`);
      continue;
    }
    const tupleKey = [row.product, row.set, row.parallel].map((value) => value.toLocaleLowerCase("en-US")).join("\0");
    if (seenTuples.has(tupleKey)) {
      dropped.push({ ...row, disposition: "rejected_duplicate_tuple" });
      continue;
    }
    seenTuples.add(tupleKey);
    candidates.push({
      ...row,
      authority: "candidate_only",
      world_rank_required: true,
      automatic_csm_admission: false,
      automatic_renderer_admission: false
    });
  }
  return { ...empty, candidates, dropped, defects };
}
