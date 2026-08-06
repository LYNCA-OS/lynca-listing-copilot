// Fill the fields the card does not show, AFTER the card has been read.
//
// WHY THIS IS NOT CATALOG ASSIST. Catalog assist was killed on measurement --
// accuracy unchanged on 34/50 cards, hallucinations +4 -- and the mechanism was
// ordering: candidates went in BEFORE recognition, and the model deferred to
// them. This runs strictly after, gets only the fields the model already
// reported, and never sees the images. It cannot change what was observed; it
// can only propose values for brackets that came back empty.
//
// That ordering is not my invention either: `lib/listing/knowledge/world-knowledge-layer.mjs`
// already specifies `mode: "POST_OBSERVATION_SHADOW_ONLY"` and
// `execution_mode: "INDEPENDENT_TEXT_ONLY"`. What it lacks is a live call and
// the right target fields -- it targets team/product, and the measured gap is
// print finish and descriptive rarity.
//
// WHY IT IS WORTH TRYING, from the suppression audit run three times:
//
//   写进标题了   73.8%
//   读到没写出来  4.2%   <- pipeline suppression, and nothing recoverable left
//   根本没读到   22.0%   <- unchanged across three prompt designs
//
// The same 22% survived a prompt with 49 suppressive clauses, a prompt with
// none, and a CSM-structured schema. Two pipelines with nothing in common fail
// on the SAME cards for `ssp`, `sapphire` and `hyper` -- words that are not
// printed on the card at all. They are catalog facts: which parallel this is,
// whether this print run counts as a short print. No prompt can read what is
// not there, so the remaining fifth is an information problem.
//
// THE RISK, and how it is bounded. World knowledge is a model prior, which is
// exactly the thing the guardrails call HEURISTIC_MODEL_PRIOR and refuse to
// treat as observation. So:
//
//   * it may only fill fields that came back EMPTY -- never overwrite;
//   * it may only fill print_finish and descriptive_rarity -- the two measured
//     gaps, not a general licence;
//   * everything it fills is recorded in `knowledge_filled` and marked
//     low-confidence, so a later measurement can subtract it;
//   * it is told to answer nothing when it is not sure, and "not sure" is the
//     expected answer for most cards.

export const KNOWLEDGE_TARGET_FIELDS = Object.freeze(["print_finish", "descriptive_rarity"]);

export const KNOWLEDGE_FILL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["print_finish", "descriptive_rarity", "certain"],
  properties: {
    print_finish: { type: "string", description: "The parallel/finish name for this exact card if you know the product well enough to be sure: \"Gold Refractor\", \"Purple Shock Prizm\", \"Mojo\". Empty if you are not sure." },
    descriptive_rarity: { type: "string", description: "Printed scarcity designation for this exact card if you are sure: SSP, SP, Case Hit, 1st Bowman. Empty if you are not sure." },
    certain: {
      type: "array",
      items: { type: "string", enum: [...KNOWLEDGE_TARGET_FIELDS] },
      description: "Which of the above you are confident about. Leave empty when you are guessing -- a guess here is worse than a blank, because the card itself did not show it."
    }
  }
});

/**
 * Text only. No images, and no way to reach them: the observation is finished
 * and this step must not be able to revise it.
 */
export function buildKnowledgeFillRequest({ fields, model, maxOutputTokens = 512 }) {
  const observed = {
    year: fields.year, manufacturer: fields.manufacturer, product: fields.product,
    set: fields.set, card_name: fields.card_name, subjects: fields.subjects,
    card_number: fields.card_number, serial: fields.serial, grammar: fields.grammar
  };
  const missing = KNOWLEDGE_TARGET_FIELDS.filter((name) => !fields[name]);

  return {
    model,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort: "none" },
    text: { format: { type: "json_schema", name: "knowledge_fill", strict: true, schema: KNOWLEDGE_FILL_SCHEMA } },
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: [
          "A trading card has already been read from photographs. These are the fields that were legible:",
          JSON.stringify(observed),
          `The following came back empty: ${missing.join(", ")}.`,
          "From your knowledge of this product, say what those fields are FOR THIS EXACT CARD.",
          "Answer only when the product and card identity above are enough to pin it down. If this product has many parallels and nothing above distinguishes them, leave the field empty and say so -- a wrong parallel is worse than a missing one, because the card did not show it either.",
          "Do not restate anything already listed above, and do not invent a card number, grade, or serial."
        ].join(" ")
      }]
    }]
  };
}

export function parseKnowledgeFill(payload) {
  let parsed = payload;
  if (typeof payload === "string") {
    try { parsed = JSON.parse(payload); } catch { return { values: {}, certain: [] }; }
  }
  if (!parsed || typeof parsed !== "object") return { values: {}, certain: [] };
  const certain = (Array.isArray(parsed.certain) ? parsed.certain : [])
    .filter((name) => KNOWLEDGE_TARGET_FIELDS.includes(name));
  const values = {};
  for (const name of KNOWLEDGE_TARGET_FIELDS) {
    const value = String(parsed[name] ?? "").replace(/\s+/g, " ").trim();
    if (value && certain.includes(name)) values[name] = value;
  }
  return { values, certain };
}

/**
 * Merge into observed fields. Empty targets only, and every write is recorded.
 *
 * `low_confidence` gets the filled field names appended because that is what
 * they are: CSM's own answer for a value that is present but not observed is an
 * evidence level plus a review flag, not silent promotion to fact.
 */
export function applyKnowledgeFill(fields, fill) {
  const filled = [];
  const merged = { ...fields };
  for (const name of KNOWLEDGE_TARGET_FIELDS) {
    if (merged[name]) continue;
    const value = fill.values?.[name];
    if (!value) continue;
    merged[name] = value;
    filled.push(name);
  }
  if (filled.length) {
    merged.low_confidence = [...new Set([...(merged.low_confidence || []), ...filled])];
  }
  return { fields: merged, knowledge_filled: filled };
}
