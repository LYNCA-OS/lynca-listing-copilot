// The canonical semantic object, read straight off the card in one call.
//
// This is the contract's "Canonical Before Commercial": the model produces
// meaning, a deterministic Composer produces the commercial string.
//
// Deliberately NOT reintroduced, each measured negative on the 255-card paired
// set: catalog assist (accuracy unchanged on 34/50, hallucinations +4), vector
// retrieval (unchanged on 32/50, +5), multi-call candidate scoring, and the
// 825-token output schema.
//
// Three constraints keep this from drifting back into that pipeline:
//
//   1. ONE CALL. `buildCanonicalFieldsRequest` is the only request builder and
//      it takes images, not candidates. There is no hook for a second round.
//   2. FIELDS ARE OBSERVED, NOT RETRIEVED. No parameter through which a catalog
//      row could be injected -- the old pipeline's failure was not that lookups
//      were wrong, it was that the model deferred to them.
//   3. THE SCHEMA IS CSM'S. Field names and the field list come from
//      `semCanonicalEditableFields`, not from a hunch. Eighteen properties.

import {
  classifySemNumberBoundary,
  semGrammarForResolved,
  semTcgIpLabel,
  semCanonicalEditableFields
} from "../csm/sem-definition.mjs";
import { printFinishSuggestion } from "../csm/title-derived-sem.mjs";
import { admitFinishVocabulary } from "./finish-vocabulary-admission.mjs";

export { semCanonicalEditableFields };

/**
 * Attributes are physical COMPONENTS, not finishes.
 *
 * Refractor/Prizm/Holo were in this list for one revision, which gave a print
 * finish two homes. Of the 61 cards whose reviewed title carries a finish word,
 * that run put it in attributes on 38, variant on 27, product on 10, and in NO
 * field on 26. The enum was the most-used channel, not a dead one -- so
 * removing it was a bet, and the bet is now backed by `print_finish` being its
 * own CSM field with its own prompt line.
 */
export const CANONICAL_ATTRIBUTES = Object.freeze([
  "Auto", "RC", "Patch", "Relic", "Jersey", "SP", "SSP", "1st Edition"
]);

export const CANONICAL_GRAMMARS = Object.freeze(["standard", "tcg", "lot"]);
export const CANONICAL_IMAGE_DETAILS = Object.freeze(["high", "original"]);

/** Field names that may appear in `unreadable` / `low_confidence`. */
export const CANONICAL_FIELD_NAMES = Object.freeze([
  "year", "language", "manufacturer", "product", "set", "subjects", "team", "card_name",
  "release_variant", "surface_color", "parallel_family", "parallel_exact",
  "descriptive_rarity", "card_number", "serial", "attributes", "grading_info"
]);

// CSM keeps [Descriptive Rarity] separate from the visible components; this is
// the fallback split for values the model still routes into `attributes`.
const DESCRIPTIVE_RARITY = new Set(["SSP", "SP", "1st Edition"]);

export const CANONICAL_FIELDS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "year", "manufacturer", "product", "set", "subjects", "team",
    "card_name", "release_variant", "surface_color", "parallel_family", "parallel_exact", "descriptive_rarity",
    "card_number", "serial", "attributes", "grading_info", "grammar", "lot_count",
    "language", "unreadable", "low_confidence"
  ],
  properties: {
    year: { type: "string", description: "Season or copyright year as printed: \"2023\" or \"2023-24\". Prefer the slab label. A statistics year on the back is not the issue year." },
    manufacturer: { type: "string", description: "The card publisher as printed: Panini, Topps, Upper Deck. NEVER the grading company, the team, the copyright line, or a legal entity name." },
    product: { type: "string", description: "Product line as printed: Prizm, Donruss Optic, Chrome, Obsidian. Give the fullest printed product phrase once; do not repeat the manufacturer here." },
    // COS-9 places [Language] immediately after [IP] in the TCG order and marks
    // it *, the highest tier. It was in `semCanonicalEditableFields` and in
    // `semTcgTitleOrder` the whole time; THIN_FIELDS simply did not list it, so
    // the bracket was filtered out of every TCG title without a trace -- the
    // same silent-drop failure as the TCG parallel bracket.
    //
    // 3 of the 148 reviewed titles carry a language marker and all 3 are TCG
    // ("2025 Pokemon JP Mega Absol Ex ...", "2022 Pokemon EN SWSH ..."). The
    // writers use it and this path could not produce it.
    //
    // The enum is COS-9's own rule: the four primary languages abbreviate, and
    // everything else is spelled out. Empty is the right answer for a card with
    // no language marking, which is most non-TCG cards.
    language: {
      type: "string",
      enum: ["", "EN", "JP", "CN", "KR", "French", "German", "Italian", "Spanish", "Portuguese"],
      description: "For trading-card-game cards only: the printed language of the card. Use EN, JP, CN or KR for those four; spell out any other language. Empty for sports cards and whenever the language is not evident."
    },
    set: { type: "string", description: "Set or insert line named separately from the product: \"Sapphire Selections\", \"Downtown\". Empty if the product name is the whole of it." },
    // CSM keeps these three apart and so does this schema. They were one
    // `variant` field for two runs and it was the worst-scoring field on the
    // set (support 0.50) -- one string carrying three CSM brackets with three
    // different priorities.
    card_name: { type: "string", description: "The printed card-title segment: \"Rated Rookie\", \"Next Stop Signatures\", \"Passing the Torch\", \"Illustrator\". NOT the player name and NOT the parallel." },
    release_variant: { type: "string", description: "Layout or design variation only: Horizontal, Vertical, Variation, Photo Variation, International. NOT a colour, NOT a finish, NOT FOTL/Hobby/Retail." },
    // CSM keeps the parallel in THREE layers, and `printFinishSuggestion` in
    // title-derived-sem.mjs degrades between them: exact name, else colour plus
    // family, else colour alone, else family alone. This schema had one
    // `print_finish` field with no fallback, so a card whose exact parallel the
    // model could not name came back with nothing -- 27 of the 68 cards whose
    // reviewed title carries a colour had no colour anywhere in our fields,
    // against only 9 where we named the wrong one. The colour is the easiest
    // thing on the card to read and it was being lost to a question that was
    // too hard.
    surface_color: {
      type: "string",
      enum: ["", "Gold", "Silver", "Red", "Blue", "Green", "Orange", "Purple", "Pink", "Black", "Yellow", "Teal", "Bronze", "Platinum", "Emerald", "White", "Aqua", "Rainbow"],
      description: "The BASIC colour of the parallel, if the card is visibly a coloured parallel. Just the colour -- a shimmering gold card is \"Gold\". Empty only if the card has no colour treatment at all."
    },
    parallel_family: {
      type: "string",
      enum: ["", "Refractor", "Prizm", "Holo", "Foil", "Sapphire", "Mojo", "Wave", "Shimmer", "Sparkle", "Pulsar", "Geometric", "Hyper", "Shock", "Velocity", "Disco", "Scope", "Marble", "Cracked Ice", "Xfractor", "Raywave", "Prismatic", "Lucky"],
      description: "The finish family, if you recognise it. These are the standard treatments the hobby uses -- there are not many of them. Empty if you cannot tell which."
    },
    parallel_exact: { type: "string", description: "The full printed parallel name ONLY if it is actually written on the card or slab: \"Gold Vinyl\", \"Mega Box Mojo\". Empty otherwise -- do not construct it from the colour and family, the composer does that." },
    descriptive_rarity: { type: "string", description: "Printed scarcity wording: SSP, SP, Case Hit, 1st Bowman. Empty unless stated on the card or slab." },
    subjects: {
      type: "array",
      items: { type: "string" },
      description: "Person or character name only, as printed -- not the team, not the product. For TCG the subject is the character (Pikachu) and the printed card-title segment (Illustrator) belongs in card_name. Up to 3 for a lot; exactly 1 for a single card."
    },
    team: { type: "string", description: "Team, club, country, or division printed on the card: \"Lakers\", \"Mets\". Use the short form a seller would write, not the full city name." },
    card_number: { type: "string", description: "Checklist code exactly as printed, WITHOUT the # sign: \"221\", \"GS-AKA\", \"086/070\". A checklist code never contains a slash on a non-TCG card." },
    serial: {
      type: "string",
      // The "look for small foil numbering at the top-left, lower edge..."
      // clause was here for one run and is deliberately gone: told to hunt
      // harder, the model produced MORE serials and WORSE ones -- support fell
      // 0.778 -> 0.682 and wrong values rose 13 -> 21 on the same 150 cards.
      // Not "look harder" -- that clause was here for one run and produced MORE
      // serials and WORSE ones (support 0.778 -> 0.682, wrong 13 -> 21). The
      // measured failure now is different: of 81 cards with a full serial, 44
      // read correctly, 25 read WRONG and 12 not at all. Wrong digits, not
      // missing effort. So this asks for care and offers an exit.
      description: "Limited print run as stamped, WITH the numerator: \"17/50\", \"2/3\", \"1/1\". Read both numbers digit by digit and transcribe exactly what is stamped -- do not round, reorder, or infer from the product. If either number is not clearly legible, leave this empty and put \"serial\" in `unreadable` rather than guessing. This is NOT the checklist code."
    },
    attributes: {
      type: "array",
      items: { type: "string", enum: [...CANONICAL_ATTRIBUTES] },
      description: "Physical components only, from visible evidence: Auto needs real ink, an autograph sticker, or printed Auto/Signed wording -- a facsimile signature graphic is not Auto. RC needs an RC logo, Rookie Ticket, Rated Rookie, or Rookie Card marker."
    },
    // CSM defines Grading Info as a structured value. A single display string
    // silently collapsed card grade + autograph grade on 4 of the 45 graded
    // cards in the fresh-150 cohort (for example PSA 9/10 -> PSA 9). Keep the
    // two facts separate until the marketplace projection renders them.
    grading_info: {
      type: "object",
      additionalProperties: false,
      required: ["company", "card_grade", "auto_grade", "grade_type"],
      properties: {
        company: { type: "string", description: "Grading company exactly as printed: PSA, BGS, CGC, SGC, SCD. Empty for a raw card." },
        card_grade: { type: "string", description: "The card-condition grade only, such as 10, 9.5, 9, AUTH or Authentic. Do not put an autograph grade here." },
        auto_grade: { type: "string", description: "The separate autograph grade only, such as 10 or 9. Empty when no separate autograph grade is printed." },
        grade_type: {
          type: "string",
          enum: ["", "CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC_WITH_AUTO"],
          description: "Which literal grade panels are present. CARD_AND_AUTO means both card and autograph grades are printed."
        }
      }
    },
    grammar: {
      type: "string",
      enum: [...CANONICAL_GRAMMARS],
      description: "standard for sports and non-TCG singles, tcg for Pokemon/One Piece/Yu-Gi-Oh/Magic/Lorcana, lot ONLY when one image shows two or more separate physical card or slab rectangles. Several uploads of one card, or several names on one card, are not a lot."
    },
    lot_count: { type: "string", description: "Number of cards in the lot, digits only. Empty unless grammar is lot and the count is countable." },
    // The third state CSM has and this schema did not.
    //
    // `empty` means the card does not have it; `unreadable` means it is there
    // and could not be made out. Neither can say "it looks like Gold Refractor
    // and I am not certain", so the model had to choose between asserting and
    // omitting -- and it omitted. CSM's own answer is an evidence level plus
    // review_required (`LEVEL_2_EVIDENCE_SUPPORT`, `VISION_ONLY`), and the
    // recognition pipeline used that path on 0 of 255 cards because its bar was
    // a 0.80 confidence estimate plus a structured evidence entry. Same idea,
    // cost removed: name the field, keep the value.
    low_confidence: {
      type: "array",
      items: { type: "string", enum: [...CANONICAL_FIELD_NAMES] },
      description: "Fields whose value you are reporting but are not confident about. Report the value anyway and name the field here -- a listing can flag a field for review, but it cannot review one you left out."
    },
    unreadable: {
      type: "array",
      items: { type: "string", enum: [...CANONICAL_FIELD_NAMES] },
      description: "Fields that appear to exist on the card but could not be read at all. Distinct from empty, which means the card does not have it."
    }
  }
});

export const CANONICAL_FIELDS_PROMPT = [
  // Not "sports trading card". The set contains Pokemon, One Piece, Disney,
  // VeeFriends, tennis and UFC, and all of those words appear in the missed
  // tail of the string arms, whose prompts say "sports".
  "Read this trading card and report what is printed on it.",
  "Inspect in this order before answering: (1) the slab label if there is one, (2) the card front for the subject, the parallel/finish wording and small foil limited numbering, (3) the card back for product and identity code, (4) the grade and autograph areas. Do this even when the identity already seems obvious.",
  "A slab label is a literal identity map: read year, product, subject, insert, code, the full card grade and any separate autograph grade straight off it. Never collapse PSA 9 plus AUTO 10 into PSA 9, and never turn AUTO 9 into Authentic. Never return only a year or only a product when the same label also shows a readable subject, grade or code.",
  "When two images are the front and back of one card, combine them: subject and visible finish from the front, product and identity code from the back.",
  // The completeness counterweight. Its absence was the measured defect: with
  // only an anti-fabrication instruction and no budget, the model's optimal
  // play is to say less, and the median title came out 15 characters short.
  "Report every field you can actually read. The title downstream has an 80-character budget and unreported fields simply waste it -- uncertainty about one field must never make you leave another one empty.",
  "At the same time, do not invent: report only what is visible in these images, never what this card usually says.",
  "Leave a field empty when the card does not have it. Name a field in `unreadable` when it is there but you cannot make it out at all.",
  "If you can see a value but are not confident in it, REPORT IT and name the field in `low_confidence`. Do not leave it empty -- a listing can flag a field for review, but it cannot review a field you omitted.",
  "Each field holds only its own value: do not compose a listing title, and do not repeat the same word across two fields.",
  "The parallel is asked for in three separate pieces and you should answer whichever ones you can: `surface_color` is just the basic colour (a shimmering gold card is simply Gold); `parallel_family` is the finish treatment (Refractor, Prizm, Mojo -- the hobby uses a small fixed set); `parallel_exact` only when the full name is literally printed. Answering the colour alone is a good answer -- the composer combines them.",
  "`card_name` is the printed card-title segment (Rated Rookie, Next Stop Signatures) and `release_variant` is a layout difference only (Horizontal, Variation). Most cards have neither.",
  "Give the FULL printed product phrase: \"Leaf Metal Draft\" not \"Leaf Metal\", \"Topps Chrome Disney 100\" not \"Topps Chrome\". A missing word there is a missing word in the listing.",
  "The stamped print run (17/50) and the checklist code (#221) are different things and must never be put in each other's field."
].join(" ");

// ─── Rejected prompt arms, measured 2026-08-05 ──────────────────────────────
//
// Two variants of "ask a different question" were built and paired at 50 cards
// each against the shipped prompt, same effort, same detail, alternating. Both
// are negative and both are DELETED rather than left switched off:
//
//   Arm B  loosen "printed wording" to "visible evidence", and drop
//          "answering the colour alone is a good answer"
//          -0.0063   5W/11L/32T   p=0.21
//
//   Arm C  permission to NAME the parallel family from the product line
//          (a Chrome parallel is a Refractor), bounded so `parallel_exact`
//          still requires printed text
//          -0.0092   9W/15L/26T   p=0.31
//
// Neither is significant on its own, but they fail the same way, and the way
// is the finding: RELAXING THE LITERAL DISCIPLINE COSTS TRANSCRIPTION.
//
//   082/100 -> 82/100      a dropped leading zero
//   PSA 10  -> PSA 9       a misread grade
//   2024    -> 2023        a wrong year
//   Willie Mays -> W. Mays a compressed name
//   ""      -> Blue Shimmer  an invented finish, truth was Crystallized
//
// Arm C is the sharper result, because it lost on the very field it was built
// to fix: finish hits 11 -> 12, finish errors 3 -> 5, serials exact 14 -> 13.
// It bought one right answer for two wrong ones.
//
// So "report what is printed on it" is not the defect it looked like from the
// headroom decomposition. It is load-bearing: it is what keeps serials, grades
// and years exact, and the model spends any licence it is granted globally
// rather than on the field the licence named.
//
//   Arm D  four constructed filled examples, shape only, no relaxation
//          -0.0017   7W/11L/32T   p=0.48   -- below measured drift
//          finish hits 9 -> 8 with errors 4 -> 7; the one free dimension was
//          transcription, serials 14 -> 15 with one fewer error. Examples
//          taught the FORM and cost the finish.
//
// Three arms, three different mechanisms -- loosen the evidence rule, grant
// identification, show examples -- and all three land negative. The shipped
// prompt is at a local optimum for this model.
//
// The headroom is still real -- `refractor` is missing on 30 of 150 cards and
// is not printed on any of them. What is now known is that it cannot be bought
// by asking less strictly.

/**
 * Arm D: show the model what a finished answer looks like.
 *
 * Every clause above DESCRIBES the target. None of them shows one. The model
 * has never seen a filled example, so "report every field you can read" and
 * "do not repeat the same word across two fields" have to be reconstructed from
 * prose on every call.
 *
 * The examples are CONSTRUCTED, not drawn from the reviewed corpus, and that is
 * a deliberate choice rather than a convenience. The 45 writer titles in
 * production overlap the 255 sealed eval cards almost entirely -- 39 of 45 sit
 * above a 0.5 Jaccard against a sealed title, because the eval set was built
 * from writer feedback in the first place. The 6 that survive are all graded
 * Panini/Upper Deck singles: no lot, no TCG, no raw card. Teaching from that
 * sample would teach a bias, and teaching from the other 39 would be leaking
 * the answer.
 *
 * So these show FORM, not cards: the granularity of a product phrase, that a
 * bare colour and its family are two fields, that grading info is structured,
 * and what a lot and a TCG card look like. None of the four is in the eval set,
 * and none can be.
 */
const FEW_SHOT_EXAMPLES = [
  {
    note: "graded, standard grammar, colour + family separated",
    fields: {
      year: "2021", manufacturer: "Topps", product: "Topps Chrome Update",
      subjects: ["Wander Franco"], card_number: "USC12", serial: "42/99",
      surface_color: "Blue", parallel_family: "Refractor", parallel_exact: "",
      attributes: ["RC"], team: "Rays",
      grading_info: { company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY" }
    }
  },
  {
    note: "raw, exact parallel name printed, autograph with its own grade",
    fields: {
      year: "2022", manufacturer: "Panini", product: "Panini Immaculate Collection",
      subjects: ["Sauce Gardner"], card_name: "Rookie Patch Autographs",
      serial: "17/99", parallel_exact: "Emerald", surface_color: "Green",
      attributes: ["Auto", "Patch", "RC"], team: "Jets",
      grading_info: { company: "BGS", card_grade: "9.5", auto_grade: "10", grade_type: "CARD_AND_AUTO" }
    }
  },
  {
    note: "TCG grammar: character in subject, printed title segment in card_name",
    fields: {
      year: "2023", manufacturer: "Pokemon", product: "Scarlet & Violet 151",
      subjects: ["Charizard"], card_name: "Illustration Rare", card_number: "199/165",
      language: "Japanese", ip: "Pokemon", grammar: "tcg",
      parallel_family: "Holo", surface_color: ""
    }
  },
  {
    note: "lot grammar: count read from the images, only shared attributes",
    fields: {
      year: "2024", manufacturer: "Topps", product: "Bowman Chrome",
      subjects: ["Jackson Holliday", "Junior Caminero", "Wyatt Langford"],
      lot_count: "5", grammar: "lot", attributes: ["RC"],
      parallel_family: "Refractor", surface_color: ""
    }
  }
];

const renderExample = ({ note, fields }) => `${JSON.stringify(fields)}   // ${note}`;

export const CANONICAL_FIELDS_PROMPT_FEWSHOT = [
  CANONICAL_FIELDS_PROMPT,
  "Four filled examples follow, for shape only. They are not real cards in this batch and their values must never be copied into your answer; read them for how much detail each field carries and where the boundaries between fields fall.",
  ...FEW_SHOT_EXAMPLES.map(renderExample),
  "Now answer for the images actually supplied."
].join("\n");

/** Arm E: examples AND permission to identify. The two are orthogonal. */

// ─── Evaluation-only: structured serial, 2026-08-05 ─────────────────────────
//
// The research report recommends extending the treatment that worked for
// grading -- splitting a compound scalar into its facts -- to `serial`. The
// mechanism there was real: a single string collapsed card grade and autograph
// grade, and separating them took exact grading from 33/38 to 38/38.
//
// The ceiling was measured before this was built, because the report also
// recommends the same for `card_number` and that one is worth nothing here:
// a card number appears in 3 of 150 reviewed titles and 0 of 105, so a perfect
// answer buys +0.000000. Writers do not publish it. Serial is different --
// 82 and 56 cards carry one, we get 53 and 42 right, and a perfect answer is
// worth +0.016142 and +0.010885, both above measured drift.
//
// The split is the report's, with one addition. `legibility` exists because
// the current prompt tells the model to leave the whole field empty when
// EITHER number is unclear, so a card whose "/50" is crisp and whose numerator
// is scratched returns nothing at all. Partial legibility is a fact worth
// keeping rather than a reason to discard the half that was readable.
export const CANONICAL_FIELDS_SCHEMA_SERIAL_PARTS = Object.freeze({
  ...CANONICAL_FIELDS_SCHEMA,
  required: Object.freeze([...CANONICAL_FIELDS_SCHEMA.required, "serial_parts"]),
  properties: Object.freeze({
    ...CANONICAL_FIELDS_SCHEMA.properties,
    serial_parts: {
      type: "object",
      additionalProperties: false,
      required: ["numerator", "denominator", "literal_text", "legibility"],
      properties: {
        numerator: { type: "string", description: "The copy number alone, exactly as stamped including any leading zero: \"027\", \"8\". Empty if it cannot be read." },
        denominator: { type: "string", description: "The print run alone, exactly as stamped: \"150\", \"25\". Empty if it cannot be read." },
        literal_text: { type: "string", description: "The whole stamp exactly as it appears, including the slash and any leading zeroes: \"027/150\". Empty if nothing is legible." },
        legibility: {
          type: "string",
          enum: ["", "READABLE", "PARTIAL", "UNREADABLE"],
          description: "READABLE when both numbers are clear. PARTIAL when one is clear and the other is not -- report the one you can read rather than discarding both. UNREADABLE when a stamp is present but neither number can be made out. Empty when the card has no serial at all."
        }
      }
    }
  })
});

export const CANONICAL_FIELDS_PROMPT_SERIAL_PARTS = [
  CANONICAL_FIELDS_PROMPT,
  "The serial is asked for twice and both are required. `serial` stays exactly as before.",
  "`serial_parts` splits the same stamp: `numerator` is the copy number alone, `denominator` the print run alone, `literal_text` the whole stamp with its slash and every leading zero, and `legibility` says how much of it you could actually read.",
  "When one number is clear and the other is not, set legibility PARTIAL and report the number you can read. Reporting half a stamp you can see beats reporting nothing."
].join(" ");

/**
 * Prefer the structured stamp when it is at least partially legible.
 *
 * Evaluation-only: the production parse is untouched, so a negative result is
 * reverted by deleting this file's block rather than by unwinding a schema.
 */
export function serialFromParts(parsed = {}) {
  const parts = parsed?.serial_parts;
  if (!parts || typeof parts !== "object") return null;
  const literal = String(parts.literal_text || "").trim();
  if (literal) return literal;
  const num = String(parts.numerator || "").trim();
  const den = String(parts.denominator || "").trim();
  if (num && den) return `${num}/${den}`;
  // A lone denominator is what the writers publish for an unread numerator --
  // "/499" appears in the corpus exactly that way.
  if (den) return `/${den}`;
  return null;
}

// Evaluation-only prompt delta.  The canonical schema already asks for exact
// transcription, but the 150-card observation replay found a narrow failure:
// the model sometimes preserved the numeric pair while normalising away a
// meaningful leading zero (027/150 -> 27/150).  Keep this clause separate from
// the production prompt until a paired screen shows that it improves exact
// serials without increasing wrong digits.
export const CANONICAL_SERIAL_EXACT_PROMPT = `${CANONICAL_FIELDS_PROMPT} When transcribing serial, copy the stamped characters exactly, including every leading zero and the slash: 027/150 must remain 027/150, and 08/25 must remain 08/25. Never normalise, pad, strip, or infer a serial number.`;

export function buildCanonicalFieldsRequest({
  // `low`, not `none`, since 2026-08-03. Paired on 105 cards never used for
  // anything before: F1 0.8149 -> 0.8339, +0.019042, 42 wins to 18, p=0.0027,
  // replicating a +0.014190 reading on the separate 150. Almost all of it is
  // precision (+0.034982, p=0.0015) -- the tier mostly stops the model saying
  // wrong things rather than helping it see more.
  //
  // 8192 rather than 4096 because max_output_tokens is shared with reasoning.
  // At max effort the reasoning consumed the whole 4096 budget and the JSON
  // came back truncated; low averages 341 output tokens, so this is headroom,
  // not an expectation.
  //
  // Costs ~3.6s of latency (7.4s -> 11.1s), accepted by the founder.
  imageUrls = [], model, effort = "low", maxOutputTokens = 8192, imageDetail = "high"
}) {
  if (!CANONICAL_IMAGE_DETAILS.includes(imageDetail)) throw new Error(`unsupported_image_detail:${imageDetail}`);
  return {
    model,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort },
    text: {
      format: { type: "json_schema", name: "canonical_card_fields", strict: true, schema: CANONICAL_FIELDS_SCHEMA }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: CANONICAL_FIELDS_PROMPT },
        ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
      ]
    }]
  };
}

const EMPTY_FIELDS = Object.freeze({
  year: "", manufacturer: "", product: "", set: "", subjects: [], team: "",
  card_name: "", release_variant: "", surface_color: "", parallel_family: "",
  parallel_exact: "", print_finish: "", descriptive_rarity: "",
  card_number: "", serial: "", attributes: [], grade: "", grading_info: null, grammar: "standard",
  lot_count: "", unreadable: [], low_confidence: [], ip: "", language: "", components: []
});

const cleanString = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function normalizeGradingInfo(parsed = {}) {
  const value = parsed?.grading_info;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const company = cleanString(value.company);
  const cardGrade = cleanString(value.card_grade);
  const autoGrade = cleanString(value.auto_grade);
  if (!company && !cardGrade && !autoGrade) return null;
  // The values are the facts; grade_type is only their derived shape. Trusting
  // a contradictory model enum would let CARD_ONLY silently hide auto_grade.
  const gradeType = cardGrade && autoGrade
    ? (/^(?:AUTH|AUTHENTIC)$/i.test(cardGrade) ? "AUTHENTIC_WITH_AUTO" : "CARD_AND_AUTO")
    : autoGrade ? "AUTO_ONLY"
      : "CARD_ONLY";
  return {
    company,
    card_grade: cardGrade,
    auto_grade: autoGrade,
    grade_type: gradeType
  };
}

function renderGradingInfo(info) {
  if (!info) return "";
  const { company, card_grade: cardGrade, auto_grade: autoGrade, grade_type: gradeType } = info;
  if (gradeType === "AUTO_ONLY") return [company, "Auto", autoGrade || cardGrade].filter(Boolean).join(" ");
  if (gradeType === "AUTHENTIC_WITH_AUTO") {
    return `${[company, "Authentic"].filter(Boolean).join(" ")}${autoGrade ? `/${autoGrade}` : ""}`;
  }
  if (cardGrade && autoGrade) return `${[company, cardGrade].filter(Boolean).join(" ")}/${autoGrade}`;
  return [company, cardGrade || autoGrade].filter(Boolean).join(" ");
}

/**
 * The print-run / checklist-code boundary is CSM's call, not this file's.
 *
 * There was a hand-written regex here plus a grammar-gated swap written from
 * scratch. CSM already ships `classifySemNumberBoundary`, which decides the
 * same question with the same TCG exception -- and it sat imported-but-uncalled
 * for a whole revision. Two implementations of one contract rule is one too
 * many, and the one that is not the contract is the one that drifts.
 */
const boundaryOf = (value, field, grammar) =>
  classifySemNumberBoundary(value, { field, grammar, checklistContext: field === "card_number" });

export function parseCanonicalFields(raw) {
  const defects = [];
  let parsed = raw;

  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return { fields: { ...EMPTY_FIELDS }, defects: ["unparseable"] }; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { fields: { ...EMPTY_FIELDS }, defects: ["not_an_object"] };
  }

  const fields = { ...EMPTY_FIELDS };
  for (const key of ["year", "language", "manufacturer", "product", "set", "team", "card_name",
    "release_variant", "surface_color", "parallel_family", "parallel_exact",
    "descriptive_rarity", "card_number", "serial", "grade"]) {
    fields[key] = cleanString(parsed[key]);
  }
  fields.grading_info = normalizeGradingInfo(parsed);
  if (fields.grading_info) fields.grade = renderGradingInfo(fields.grading_info);
  fields.card_number = fields.card_number.replace(/^(?:#|N[oO]\.\s*)/, "").trim();
  // Deny non-naming terms promotion to the resolved finish BEFORE the ladder
  // runs. Withholding after it would leave `print_finish` holding a value the
  // admission layer had already rejected, and the composer reads that field.
  //
  // The raw layers are kept alongside so the rejection stays reversible and the
  // evidence record still shows what was observed: "rainbow" is what a base
  // Refractor genuinely looks like, it just is not what the card is called.
  const admitted = admitFinishVocabulary(fields);
  fields.observed_surface_color = fields.surface_color;
  fields.observed_parallel_family = fields.parallel_family;
  fields.withheld_finish_terms = admitted.withheld;
  fields.surface_color = admitted.surface_color;
  fields.parallel_family = admitted.parallel_family;
  // CSM's own degradation, from `printFinishSuggestion`: exact if printed, else
  // colour + family, else whichever one exists.
  fields.print_finish = printFinishSuggestion(fields) || "";
  fields.lot_count = cleanString(parsed.lot_count).replace(/\D/g, "");

  fields.subjects = (Array.isArray(parsed.subjects) ? parsed.subjects : []).map(cleanString).filter(Boolean).slice(0, 3);
  fields.attributes = (Array.isArray(parsed.attributes) ? parsed.attributes : [])
    .map(cleanString).filter((value) => CANONICAL_ATTRIBUTES.includes(value));
  // Canonical order, not the model's. `resolvedFieldsToSemSuggestion` builds
  // search_optimization as [RC, Auto, Patch, Relic, team] in that fixed order,
  // so rendering components in whatever order the model happened to list them
  // made the composed title unreplayable from stored rows -- 33 of 148 cards
  // came back with the same words in a different order. The scorer is
  // order-insensitive (reversing a whole title moved 138/150 by zero), so
  // adopting the contract's order costs nothing and buys exact round-tripping.
  const COMPONENT_ORDER = ["RC", "Auto", "Patch", "Relic", "Jersey", "SP", "SSP", "1st Edition"];
  fields.components = fields.attributes
    .filter((value) => !DESCRIPTIVE_RARITY.has(value))
    .sort((a, b) => COMPONENT_ORDER.indexOf(a) - COMPONENT_ORDER.indexOf(b));
  if (!fields.descriptive_rarity) {
    fields.descriptive_rarity = fields.attributes.filter((value) => DESCRIPTIVE_RARITY.has(value)).join(" ");
  }
  for (const key of ["unreadable", "low_confidence"]) {
    fields[key] = (Array.isArray(parsed[key]) ? parsed[key] : [])
      .map(cleanString).map((value) => value === "grade" ? "grading_info" : value)
      .filter((value) => CANONICAL_FIELD_NAMES.includes(value));
  }

  fields.grammar = CANONICAL_GRAMMARS.includes(parsed.grammar) ? parsed.grammar : "standard";
  fields.ip = semTcgIpLabel({ product: fields.product, set: fields.set || fields.product, card_name: fields.card_name });
  if (fields.grammar === "standard" && semGrammarForResolved({
    product: fields.product, set: fields.set || fields.product, card_name: fields.card_name
  }) === "TCG") {
    defects.push("grammar_standard_but_csm_says_tcg");
    fields.grammar = "tcg";
  }

  if (fields.serial && boundaryOf(fields.serial, "serial", fields.grammar).boundary !== "NUMERICAL_RARITY") {
    defects.push("serial_not_a_print_run");
    if (!fields.card_number) fields.card_number = fields.serial.replace(/^(?:#|N[oO]\.\s*)/, "").trim();
    fields.serial = "";
  }
  if (fields.card_number && !fields.serial
    && boundaryOf(fields.card_number, "card_number", fields.grammar).boundary === "NUMERICAL_RARITY") {
    defects.push("card_number_is_a_print_run");
    fields.serial = fields.card_number;
    fields.card_number = "";
  }

  // A card_number carrying several codes is not a card number at all -- CSM's
  // predicate rejects it and the Lot grammar has no such bracket. It is also
  // EVIDENCE: a card showing "BCP-122; BCP-38; RCP-42" is showing three cards.
  // Found by the conformance check on 6 of 150 cards, all of them lots the
  // model had already called `lot` or should have.
  const codes = fields.card_number.split(/\s*[;,]\s*|\s+\/\s+/).map((value) => value.trim()).filter(Boolean);
  if (codes.length > 1) {
    defects.push("card_number_holds_multiple_codes");
    if (fields.grammar !== "lot") {
      defects.push("multiple_card_numbers_but_not_lot");
      fields.grammar = "lot";
    }
    // The Lot grammar does not project a card number, so there is nothing to
    // keep. Taking the first would assert one card's identity for a group.
    fields.card_number = "";
  }

  for (const key of ["manufacturer", "product", "card_name", "parallel_exact"]) {
    if (String(fields[key] || "").split(/\s+/).filter(Boolean).length > 6) {
      defects.push(`${key}_looks_like_a_title`);
    }
  }

  // `unreadable` naming a field that also has a value is a contradiction: the
  // model both read it and did not. Trust the value, drop the flag, count it.
  const contradictory = fields.unreadable.filter((name) => {
    const value = fields[name === "subjects" ? "subjects" : name];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  if (contradictory.length) {
    defects.push("unreadable_contradicts_value");
    fields.unreadable = fields.unreadable.filter((name) => !contradictory.includes(name));
  }

  return { fields, defects };
}

/** Pull the model's JSON out of a `/v1/responses` body. */
export function extractCanonicalPayload(body = {}) {
  if (body.output_text) return String(body.output_text);
  const parts = Array.isArray(body.output) ? body.output : [];
  return parts
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text).filter(Boolean).join("").trim();
}
