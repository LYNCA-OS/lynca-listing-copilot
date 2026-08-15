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
import { canonicalLotCountText } from "./lot-terminal-contract.mjs";
import {
  applyTcgGrammarContextClaim,
  validateTcgFieldSourceAuthorityReceipt
} from "./tcg-grammar-context-authority.mjs";
export {
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_SHA256,
  CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA,
  CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA_SHA256
} from "./captured-production-e1ae-assets.mjs";

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
export const CANONICAL_FIELDS_PROMPT_VERSION = "csm-canonical-fields-web-v2";
export const CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_VERSION =
  "csm-canonical-fields-v1";
export const CANONICAL_FIELDS_PARSER_SEMANTICS = Object.freeze({
  CAPTURED_E1AE_V1: "CAPTURED_E1AE_V1",
  WEB_V2: "WEB_V2",
  WEB_V3_TCG_CONTEXT: "WEB_V3_TCG_CONTEXT"
});
export const CANONICAL_TCG_GRAMMAR_AUTHORITY_MISSING_DEFECT =
  "grammar_standard_tcg_card_number_without_authority";
export const CANONICAL_TCG_GRAMMAR_CONTEXT_APPLIED_DEFECT =
  "grammar_standard_but_approved_tcg_context_applied";
// Two built-in Web actions are enough for one identity search followed by one
// bounded page inspection. They still execute inside the single Responses
// request enforced by the provider boundary.
export const CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS = 2;
// This is execution configuration, not a schema rule. Export it so the
// durable model-execution receipt and the provider request cannot drift onto
// different output budgets while still claiming the same prompt contract.
export const CANONICAL_FIELDS_MAX_OUTPUT_TOKENS = 8192;

/** Field names that may appear in `unreadable` / `low_confidence`. */
export const CANONICAL_FIELD_NAMES = Object.freeze([
  "year", "language", "manufacturer", "product", "set", "subjects", "team", "card_name",
  "release_variant", "surface_color", "parallel_family", "parallel_exact",
  "descriptive_rarity", "card_number", "serial", "attributes", "grading_info",
  "special_stamp", "description"
]);

export const CANONICAL_FIELD_SOURCE_FIELDS = Object.freeze([
  "year", "language", "manufacturer", "product", "set", "subjects", "team",
  "card_name", "release_variant", "surface_color", "parallel_family",
  "parallel_exact", "descriptive_rarity", "card_number", "serial", "attributes",
  "grading_info", "grammar", "lot_count", "special_stamp", "description"
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
    "language", "unreadable", "low_confidence", "special_stamp", "description",
    "field_sources", "set_card_name_relations"
  ],
  properties: {
    set_card_name_relations: {
      type: "object",
      additionalProperties: false,
      required: ["set", "card_name"],
      properties: {
        set: { type: "string", enum: ["", "CURRENT_CARD_MEMBER_OF_SET"] },
        card_name: { type: "string", enum: ["", "CURRENT_CARD_NAMED_BY_DESIGN"] }
      }
    },
    field_sources: {
      type: "array",
      description: "Source ledger for every non-empty named field. Use original_image_1 or original_image_2 for visible card evidence; use an exact HTTPS URL only when it was returned by this request's Web Search. Physical copy fields must cite an original image.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "source_ids"],
        properties: {
          field: { type: "string", enum: [...CANONICAL_FIELD_SOURCE_FIELDS] },
          source_ids: { type: "array", items: { type: "string" } }
        }
      }
    },
    year: { type: "string", description: "Season or copyright year as printed: \"2023\" or \"2023-24\". Prefer the slab label. A statistics year on the back is not the issue year." },
    manufacturer: { type: "string", description: "The card publisher as printed: Panini, Topps, Upper Deck. NEVER the grading company, the team, the copyright line, or a legal entity name." },
    // COS-56 (approved 2026-08-07). Product > Set > Card Name, read in that
    // order, with Card Name EMPTY when the printed phrase is exhausted by the
    // first two. The three had no boundary between them and the model paid for
    // it on every run: on 14 cards through identical input twice, `set` and
    // `card_name` carried 12 of 21 field disagreements, always the same shape
    // -- one string moving between the two fields. A field that oscillates is
    // wrong on a share of runs by construction, and no model or pipeline work
    // removes that. Sampling parameters cannot help either: `gpt-5.6-luna`
    // rejects temperature, top_p and seed outright. What is left is the
    // definition, so the definition is stated here, where the model reads it.
    product: { type: "string", description: "The product line as the market names it: Prizm, Donruss Optic, Chrome, Impeccable, Flawless, Immaculate Collection, Exquisite Collection. Give the fullest printed product phrase once; do not repeat the manufacturer here. Read `product`, then `set`, then `card_name`, in that order." },
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
    // "Downtown" was this field's own example and COS-56 names it a card name
    // -- it names one card, not a subset. An example that contradicts the rule
    // is worth less than no example, so it moved to `card_name`.
    set: { type: "string", description: "The named insert or subset WITHIN that product: \"Jersey Number Autographs\", \"Draft Pick Autographs\", \"Logoman Autographs\", \"Timeless Moments\", \"Sapphire Selections\". Take the whole printed insert phrase, even where it repeats a word from the product. Empty only when the product name is the whole of it." },
    // CSM keeps these three apart and so does this schema. They were one
    // `variant` field for two runs and it was the worst-scoring field on the
    // set (support 0.50) -- one string carrying three CSM brackets with three
    // different priorities.
    card_name: { type: "string", description: "ONLY what names THIS card apart from the others in the same set: \"Downtown!\", \"Rated Rookie\", \"Next Stop Signatures\", \"Passing the Torch\", \"Illustrator\". When the product and the set already account for the whole printed phrase, this is EMPTY -- empty is the correct answer there, not a gap. \"Jersey Numbers\" and \"Logoman Autographs\" are sets, not card names. NOT the player name, NOT the parallel, NOT an attribute such as Auto." },
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
      // The closed enum was SUSPECTED of being the limit and is not. 2026-08-05:
      // the model answered "Shimmer" where the truth was "Crystallized", a word
      // this list lacks, which looked like the constraint. Of 21 wrong family
      // answers across 255 cards, 20 had the correct word available here and the
      // model chose another. Widening the list is not the fix.
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
    // TCG Grammar carries two brackets this schema had no field for, so the
    // Composer could never emit them and reported nothing missing. `60 CSM
    // Rebuild Contract` names Special Stamp a text-led TCG field alongside
    // Subject, and the legacy Pokemon renderer has carried it at priority 9
    // since before the thin path existed -- the concept was implemented
    // everywhere except the path now in production.
    special_stamp: {
      type: "string",
      description: "A mark PRINTED on the card that is neither rarity nor finish: \"1st Edition\", or a promotional/tournament origin such as Staff, Promo, Prize, Tournament, Championship, CoroCoro, Parent/Child, Event. Transcribe only what is printed. Leave empty for an ordinary retail card -- most cards have no special stamp."
    },
    // Deliberately a closed vocabulary rather than free text. This bracket sits
    // last in the TCG order and is the first to yield under the 80-character
    // budget; a prose field there would spend the scarcest space in the title
    // on the least verifiable claim. New members belong in Registry, not here.
    description: {
      type: "string",
      enum: ["", "Case Hit"],
      description: "A commercial descriptor evidenced by the pack or case, not by the card face. Empty unless there is direct evidence. SSP belongs in descriptive_rarity, not here."
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

const WEB_IDENTITY_PROMPT = "Use the built-in Web Search only when the images do not settle the collectible identity. After inspecting both images, when you can read at least two identity anchors such as subject plus year, product, manufacturer or a partial checklist code but the Set/Card Name boundary or checklist-code relationship is still incomplete or ambiguous, search the official manufacturer checklist or card list first. Include the visible subject, product or year, and checklist code in the query; use a second Web action only to inspect the official result. Web evidence may resolve year, manufacturer, product, set, card_name or subject, but the visible checklist code is a query anchor only: Web must never overwrite card_number or other visible current-card copy such as serial, grading, finish, surface, parallel or stamp. Put an official HTTPS URL in field_sources only for an identity field it actually supports, and keep an absent or conflicting official answer unresolved.";
const WEB_CURRENT_CARD_PROMPT = "At the same time, do not invent: current-card copy must be visible in these images; a Web result about what this card usually says is not current-card evidence.";
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
  WEB_IDENTITY_PROMPT,
  WEB_CURRENT_CARD_PROMPT,
  "Leave a field empty when the card does not have it. Name a field in `unreadable` when it is there but you cannot make it out at all.",
  "If you can see a value but are not confident in it, REPORT IT and name the field in `low_confidence`. Do not leave it empty -- a listing can flag a field for review, but it cannot review a field you omitted.",
  "Each field holds only its own value: do not compose a listing title, and do not repeat the same word across two fields.",
  "The parallel is asked for in three separate pieces and you should answer whichever ones you can: `surface_color` is just the basic colour (a shimmering gold card is simply Gold); `parallel_family` is the finish treatment (Refractor, Prizm, Mojo -- the hobby uses a small fixed set); `parallel_exact` only when the full name is literally printed. Answering the colour alone is a good answer -- the composer combines them.",
  // COS-56. This sentence used to define `card_name` as "the printed card-title
  // segment", which is precisely the phrase a product and its insert also
  // answer to -- the schema now decides between them and the prompt must not
  // say otherwise.
  "Read `product`, `set` and `card_name` in that order: the product line, then the named insert or subset within it, then -- only if something is left -- what names THIS card apart from the others in that same set. When the product and the set already account for the whole printed phrase, `card_name` is empty; most cards have no card name at all. `release_variant` is a layout difference only (Horizontal, Variation).",
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

// ─── REJECTED 2026-08-05, after the schema actually reached the model ───────
//
// The research report recommends extending the grading treatment to `serial`.
// Measured: +0.001457, 9W/10L/31T, p=1.0000, and serial exact unmoved at
// 15 -> 15. Below drift and below every clause of the bar.
//
// The mechanism failed, not merely the number, and that is the part worth
// keeping. The model returned `serial_parts` on 50 of 50 cards:
//
//   READABLE           24    both numbers clear, and the split value was
//                            byte-identical to the scalar on all 24
//   no serial at all   26
//   PARTIAL             0    <- the whole premise
//   rescued by split    0    scalar empty while the split held a value
//
// A crisp denominator beside a scratched numerator did not occur once. A
// stamped serial is either legible or it is not, so the split addresses a
// case this corpus does not contain. The prompt clause it existed to relax
// -- leave the field empty when EITHER number is unclear -- costs nothing,
// because EITHER is never the state.
//
// Recording the MECHANISM matters more than the delta here. A +0.001 with no
// mechanism reading files as "structured serial did not help", which invites
// retrying it in three months. What is recorded instead is that there is
// nothing there to help.
//
// Kept only because this arm exposed the schema-passthrough defect.
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
  // The schema is a parameter as of 2026-08-05, and it was not before. An
  // evaluation arm that supplied its own schema had it silently discarded --
  // the harness recorded it in the run manifest and the request kept the
  // hard-coded one. With `strict: true` and `additionalProperties: false`, the
  // model could not return the new field even though the prompt asked for it,
  // so the arm measured a prompt sentence and an unused field. Zero of 50 cards
  // came back with it, which is what exposed this.
  // The prompt is a parameter for the same reason the schema is: COS-56 changes
  // a definition that is stated in BOTH, so an arm that varied only the schema
  // would measure a schema fighting a prompt that still said the old thing.
  // Production passes neither and gets both shipped values.
  imageUrls = [], model, effort = "low",
  maxOutputTokens = CANONICAL_FIELDS_MAX_OUTPUT_TOKENS, imageDetail = "high",
  schema = CANONICAL_FIELDS_SCHEMA, prompt = CANONICAL_FIELDS_PROMPT,
  webSearchToolsEnabled = true
}) {
  if (!CANONICAL_IMAGE_DETAILS.includes(imageDetail)) throw new Error(`unsupported_image_detail:${imageDetail}`);
  if (typeof webSearchToolsEnabled !== "boolean") {
    throw new TypeError("web_search_tools_enabled_invalid");
  }
  return {
    model,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort },
    ...(webSearchToolsEnabled ? {
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      max_tool_calls: CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS,
      include: ["web_search_call.action.sources"]
    } : {}),
    text: {
      format: { type: "json_schema", name: "canonical_card_fields", strict: true, schema }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
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
  special_stamp: "", description: "",
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

export function parseCanonicalFields(raw, {
  semantics = CANONICAL_FIELDS_PARSER_SEMANTICS.WEB_V2,
  finishAdmissionSemantics = "CURRENT",
  tcgFieldSourceAuthorityReceipt = null,
  tcgGrammarContextClaimReceipt = null
} = {}) {
  if (!Object.values(CANONICAL_FIELDS_PARSER_SEMANTICS).includes(semantics)) {
    throw new TypeError("canonical_fields_parser_semantics_unsupported");
  }
  const capturedE1ae = semantics === CANONICAL_FIELDS_PARSER_SEMANTICS.CAPTURED_E1AE_V1;
  const tcgContextSemantics =
    semantics === CANONICAL_FIELDS_PARSER_SEMANTICS.WEB_V3_TCG_CONTEXT;
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
    "descriptive_rarity", "card_number", "serial", "grade", "special_stamp", "description"]) {
    fields[key] = cleanString(parsed[key]);
  }
  fields.grading_info = normalizeGradingInfo(parsed);
  if (fields.grading_info) fields.grade = renderGradingInfo(fields.grading_info);
  fields.card_number = fields.card_number.replace(/^(?:#|N[oO]\.\s*)/, "").trim();

  // COS-39 (Fei, 2026-08-04): "TCG vs NON_TCG classification MUST HAPPEN FIRST
  // so domain-inappropriate finish terminology does not cross Grammar
  // boundaries." It used to happen forty lines below the finish admission, so
  // the admission layer read `grammar` before anything had set it and the
  // boundary the decision asks for could never fire. The required order is
  // written into the decision as a flow -- classify, then validate the domain,
  // then resolve Print Finish -- and this is that first step.
  //
  // Everything it reads (`product`, `set`, `card_name`) is populated above.
  // The later `lot` promotions still run where they did; they are not a TCG
  // question and nothing between here and there depends on them.
  const observedGrammar = CANONICAL_GRAMMARS.includes(parsed.grammar)
    ? parsed.grammar : "standard";
  fields.grammar = observedGrammar;
  // `semResolvedClassificationText` reads manufacturer, and every call site
  // dropped it. That is why the table looked silent on cards that are
  // unmistakably Pokemon: they carry `manufacturer: "Pokémon"` with an empty or
  // product-shaped `product` ("Mega Brave"). Feeding the field the contract
  // already asks for recognises both, and across the other 250 reviewed cards
  // it recognises nothing new -- zero false positives.
  const grammarIdentity = capturedE1ae ? {
    product: fields.product,
    set: fields.set || fields.product,
    card_name: fields.card_name
  } : fields;
  fields.ip = semTcgIpLabel({
    manufacturer: fields.manufacturer,
    ...grammarIdentity
  });
  if (!tcgContextSemantics && fields.grammar === "standard"
      && semGrammarForResolved(capturedE1ae ? grammarIdentity : fields) === "TCG") {
    defects.push("grammar_standard_but_csm_says_tcg");
    fields.grammar = "tcg";
  }
  // This policy is a new parser identity. WEB_V2 remains immutable: a bridge
  // may learn to read v4 without rewriting what an already-paid v3 response
  // means. V3 accepts only a sealed source-authority receipt plus the exact
  // approved joint-namespace claim. A TCG-shaped token by itself is only an
  // ambiguity signal; it can never author Grammar.
  if (tcgContextSemantics) {
    const contextFields = {
      grammar: observedGrammar,
      set: fields.set,
      card_number: fields.card_number,
      ip: fields.ip,
      unreadable: fields.unreadable,
      low_confidence: fields.low_confidence
    };
    validateTcgFieldSourceAuthorityReceipt(tcgFieldSourceAuthorityReceipt, {
      fields: contextFields
    });
    const claimed = applyTcgGrammarContextClaim(contextFields,
      tcgGrammarContextClaimReceipt, {
      fieldSourceAuthorityReceipt: tcgFieldSourceAuthorityReceipt
    });
    if (tcgGrammarContextClaimReceipt.status === "APPLIED") {
      defects.push(CANONICAL_TCG_GRAMMAR_CONTEXT_APPLIED_DEFECT);
      fields.grammar = claimed.grammar;
    } else if (fields.grammar === "standard" && fields.card_number
        && boundaryOf(fields.card_number, "card_number", "standard").boundary === "UNKNOWN"
        && boundaryOf(fields.card_number, "card_number", "tcg").boundary === "CARD_NUMBER") {
      defects.push(CANONICAL_TCG_GRAMMAR_AUTHORITY_MISSING_DEFECT);
    }
  }

  // Deny non-naming terms promotion to the resolved finish BEFORE the ladder
  // runs. Withholding after it would leave `print_finish` holding a value the
  // admission layer had already rejected, and the composer reads that field.
  //
  // The raw layers are kept alongside so the rejection stays reversible and the
  // evidence record still shows what was observed: "rainbow" is what a base
  // Refractor genuinely looks like, it just is not what the card is called.
  const admitted = admitFinishVocabulary(fields, {
    taxonomyProfile: finishAdmissionSemantics
  });
  fields.observed_surface_color = fields.surface_color;
  fields.observed_parallel_family = fields.parallel_family;
  fields.withheld_finish_terms = admitted.withheld;
  fields.surface_color = admitted.surface_color;
  fields.parallel_family = admitted.parallel_family;
  // `parallel_exact` has to come back too. Only the two lower rungs were copied
  // here, which was harmless while nothing could withhold a printed name -- the
  // admission layer returned early on one. COS-39's governed product claim can,
  // and its own example ("Gold Refractor" on a Charizard) is a printed name, so
  // leaving this out meant the rejection was computed and then thrown away.
  fields.parallel_exact = admitted.parallel_exact;
  // CSM's own degradation, from `printFinishSuggestion`: exact if printed, else
  // colour + family, else whichever one exists.
  fields.print_finish = printFinishSuggestion(fields) || "";
  // Lot quantity is identity, not a digit-extraction hint. Stripping every
  // non-digit silently turned contradictory observations such as `2-3` and
  // `1/2` into the fabricated counts 23 and 12. The provider schema owns a
  // STRING here; accept only its exact positive-integer spelling and route
  // every other non-empty shape through the unresolved terminal state.
  const lotCount = cleanString(parsed.lot_count);
  fields.lot_count = capturedE1ae
    ? lotCount.replace(/\D/g, "")
    : canonicalLotCountText(typeof parsed.lot_count === "string" ? lotCount : "");
  if (!capturedE1ae && parsed.lot_count != null && lotCount !== ""
      && fields.lot_count === "") defects.push("lot_count_not_strict_positive_integer_text");

  const subjects = (Array.isArray(parsed.subjects) ? parsed.subjects : [])
    .map(cleanString).filter(Boolean);
  const uniqueSubjects = capturedE1ae ? subjects : [...new Set(subjects)];
  fields.subjects = uniqueSubjects.slice(0, 3);
  if (!capturedE1ae && uniqueSubjects.length !== subjects.length) defects.push("duplicate_subjects");
  const attributes = (Array.isArray(parsed.attributes) ? parsed.attributes : [])
    .map(cleanString).filter((value) => CANONICAL_ATTRIBUTES.includes(value));
  fields.attributes = capturedE1ae ? attributes : [...new Set(attributes)];
  if (!capturedE1ae && fields.attributes.length !== attributes.length) {
    defects.push("duplicate_attributes");
  }
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

  return {
    fields,
    defects,
    ...(tcgContextSemantics ? {
      observed_fields: tcgGrammarContextClaimReceipt.status === "APPLIED"
        ? { ...fields, grammar: observedGrammar }
        : { ...fields }
    } : {})
  };
}

export function stripCanonicalFieldSources(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("canonical_field_sources_payload_invalid");
  }
  const fieldSources = parsed.field_sources;
  const setCardNameRelations = parsed.set_card_name_relations;
  delete parsed.field_sources;
  delete parsed.set_card_name_relations;
  return {
    payload: parsed,
    field_sources: fieldSources,
    set_card_name_relations: setCardNameRelations
  };
}

/** Pull the model's JSON out of a `/v1/responses` body. */
export function extractCanonicalPayload(body = {}) {
  if (body.output_text) return String(body.output_text);
  const parts = Array.isArray(body.output) ? body.output : [];
  return parts
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text).filter(Boolean).join("").trim();
}
