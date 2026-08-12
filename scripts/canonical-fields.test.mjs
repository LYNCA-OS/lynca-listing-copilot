import assert from "node:assert/strict";

import {
  CANONICAL_FIELDS_SCHEMA,
  CANONICAL_FIELD_NAMES,
  CANONICAL_ATTRIBUTES,
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_SERIAL_EXACT_PROMPT,
  semCanonicalEditableFields,
  buildCanonicalFieldsRequest,
  parseCanonicalFields
} from "../lib/listing/thin/canonical-fields.mjs";
import { BRACKET_ORDER, DROP_ORDER, composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import {
  emitCsm, emitValidationEvent, classifyReviewedTitle,
  checkNumberBrackets, unknownFieldNames,
  SEM_OBSERVATION_LAYER, SEM_FEEDBACK_LAYER
} from "../lib/listing/thin/csm-emit.mjs";
import { SEM_STANDARD_VERSION, semTcgTitleOrder } from "../lib/listing/csm/sem-definition.mjs";
import { buildSemValidationEvent } from "../lib/listing/csm/sem-validation.mjs";
import {
  WRITER_TITLE_SEM_PARSER_VERSION,
  WRITER_TITLE_SEM_CANDIDATE_SCHEMA_VERSION,
  gradingInfoSuggestion,
  printFinishSuggestion
} from "../lib/listing/csm/title-derived-sem.mjs";

assert.equal(printFinishSuggestion({ parallel_exact: "Gold Vinyl", surface_color: "Gold", parallel_family: "Vinyl" }), "Gold Vinyl");
assert.equal(printFinishSuggestion({ surface_color: "Gold", parallel_family: "Refractor" }), "Gold Refractor");
assert.equal(printFinishSuggestion({ surface_color: "Gold" }), "Gold");
assert.deepEqual(gradingInfoSuggestion({ grade_company: "PSA", grade: "10" }), { company: "PSA", card_grade: "10" });

const fields = (overrides = {}) => parseCanonicalFields({
  year: "", manufacturer: "", product: "", set: "", subjects: [], team: "",
  card_name: "", release_variant: "", surface_color: "", parallel_family: "",
  parallel_exact: "", descriptive_rarity: "",
  card_number: "", serial: "", attributes: [], grade: "", grammar: "standard",
  lot_count: "", unreadable: [], low_confidence: [], ...overrides
}).fields;

// ---------------------------------------------------------------- the schema

// `strict` json_schema rejects a schema whose properties are not all required,
// and the failure arrives as a provider error mid-run rather than at build
// time. Cheaper to assert here than to discover it on card 1 of 150.
{
  const properties = Object.keys(CANONICAL_FIELDS_SCHEMA.properties);
  assert.deepEqual([...CANONICAL_FIELDS_SCHEMA.required].sort(), properties.sort());
  assert.equal(CANONICAL_FIELDS_SCHEMA.additionalProperties, false);
}

// Growth has to come from the contract, not from a hunch: every semantic field
// here is one CSM already defines.
//
// 21 -> 23 on 2026-08-06 for `special_stamp` and `description`, both brackets
// TCG Grammar already names and neither of which this schema could carry. The
// number is a brake on invention, not on the contract: raise it only alongside
// the CSM clause that requires the field.
assert.ok(Object.keys(CANONICAL_FIELDS_SCHEMA.properties).length <= 25);
for (const field of ["special_stamp", "description"]) {
  assert.ok(semTcgTitleOrder.includes(field), `${field} is only here because TCG Grammar names it`);
}
for (const field of ["year", "manufacturer", "product", "set", "card_name",
  "release_variant", "print_finish", "descriptive_rarity", "card_number"]) {
  assert.ok(semCanonicalEditableFields.includes(field), `${field} must be a CSM canonical field`);
}
// Subject remains the one deliberate plural alias. Grading Info used to be a
// local display string; aligning it with CSM's structured field is what keeps a
// separate autograph grade from disappearing before composition.
assert.ok(semCanonicalEditableFields.includes("grading_info"));
assert.ok(semCanonicalEditableFields.includes("subject"));
assert.ok(CANONICAL_FIELDS_SCHEMA.properties.grading_info);
assert.equal(CANONICAL_FIELDS_SCHEMA.properties.grade, undefined);
assert.ok(CANONICAL_FIELDS_SCHEMA.properties.subjects);

// Print finishes have exactly one home. Refractor/Prizm/Holo were in this enum
// AND in a `variant` field's remit, and the model reported the finish in
// neither on 26 of 61 cards that have one.
for (const finish of ["Refractor", "Prizm", "Holo", "Sapphire", "Mojo"]) {
  assert.ok(!CANONICAL_ATTRIBUTES.includes(finish), `${finish} is a print finish and belongs to print_finish alone`);
}
// CSM keeps the parallel in three layers and degrades between them. A single
// field with no ladder lost the colour on 27 of 68 cards whose reviewed title
// has one, against 9 where the colour named was wrong.
assert.ok(CANONICAL_FIELDS_SCHEMA.properties.surface_color.enum.includes("Gold"));
assert.ok(CANONICAL_FIELDS_SCHEMA.properties.parallel_family.enum.includes("Refractor"));
// COS-49 (Fei, 2026-08-04) removes ONE rung: a bare colour is Recognition
// evidence and becomes canonical Print Finish only when the card names it or
// verified taxonomy confirms the colour alone. The other rungs are untouched --
// colour + family is not a bare colour, and a printed name is explicit.
{
  const ladder = [
    [{ surface_color: "Gold", parallel_family: "Refractor" }, "Gold Refractor"],
    [{ surface_color: "Gold" }, ""],
    [{ parallel_family: "Mojo" }, "Mojo"],
    [{ parallel_exact: "Gold Vinyl", surface_color: "Gold" }, "Gold Vinyl"],
    [{}, ""]
  ];
  for (const [input, expected] of ladder) {
    assert.equal(parseCanonicalFields(input).fields.print_finish, expected);
  }
  // Withheld, not erased. The rejection has to be reversible by a Registry that
  // later confirms the colour, which it cannot be if the term is simply gone.
  const bare = parseCanonicalFields({ surface_color: "Gold" }).fields;
  assert.equal(bare.observed_surface_color, "Gold",
    "the observation survives its denied promotion");
  assert.ok(bare.withheld_finish_terms.some((entry) => (
    entry.value === "Gold" && entry.reason === "BARE_COLOUR_NOT_TAXONOMY_CONFIRMED"
  )), "the evidence record must name what was withheld and why");
}

// The completeness counterweight. An anti-fabrication instruction with nothing
// on the other side of the scale makes "say less" the model's optimal play.
assert.match(CANONICAL_FIELDS_PROMPT, /80-character budget/);
assert.match(CANONICAL_FIELDS_PROMPT, /Report every field you can actually read/);
assert.match(CANONICAL_FIELDS_PROMPT, /low_confidence/);
assert.doesNotMatch(CANONICAL_FIELDS_PROMPT, /mentally rotate it 180 degrees/,
  "the synthetic inverted-card arm was not rotation-stable enough for Production");
assert.match(CANONICAL_FIELDS_PROMPT, /Never collapse PSA 9 plus AUTO 10/);
// And the suppression that must NOT come back: the recognition pipeline forbids
// confirming Refractor/Prizm/Holo without catalog or vector candidates, and
// those candidates are disabled -- a gate whose key was thrown away.
assert.ok(!/never mark|leave it unresolved/i.test(CANONICAL_FIELDS_PROMPT));
// Not "sports": the set carries Pokemon, One Piece, Disney, VeeFriends, tennis
// and UFC, all of which appear in the string arms' missed-word tail.
assert.ok(!/sports trading card/i.test(CANONICAL_FIELDS_PROMPT));
// The clause that induced fabrication is gone: told to hunt for small foil
// numbering, the model wrote more serials and got more of them wrong (support
// 0.778 -> 0.682, wrong 13 -> 21).
assert.ok(!/look for small foil numbering/i.test(CANONICAL_FIELDS_SCHEMA.properties.serial.description));
// The replacement is precision-oriented, not effort-oriented: the measured
// failure is 25 misread serials against 12 missing ones.
assert.match(CANONICAL_FIELDS_SCHEMA.properties.serial.description, /digit by digit/);
assert.ok(!/leading zero.*must remain/i.test(CANONICAL_FIELDS_PROMPT), "production prompt stays unchanged until the arm passes");
assert.match(CANONICAL_SERIAL_EXACT_PROMPT, /027\/150 must remain 027\/150/);

for (const name of CANONICAL_FIELDS_SCHEMA.properties.unreadable.items.enum) {
  assert.ok(CANONICAL_FIELD_NAMES.includes(name));
}
assert.ok(CANONICAL_FIELD_NAMES.includes("language"), "COS-9 language must support unreadable/low-confidence state");

// One call, images in, nothing else. No candidate list, no catalog rows, no
// second round -- the three things measured as negative all entered through a
// parameter like that.
{
  const request = buildCanonicalFieldsRequest({ imageUrls: ["https://example.test/a.jpg"], model: "gpt-5.6-luna" });
  assert.equal(request.input.length, 1);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input[0].content.filter((part) => part.type === "input_image").length, 1);
  assert.equal(request.input[0].content.find((part) => part.type === "input_image").detail, "high");
  const original = buildCanonicalFieldsRequest({
    imageUrls: ["https://example.test/a.jpg"], model: "gpt-5.6-luna", imageDetail: "original"
  });
  assert.equal(original.input[0].content.find((part) => part.type === "input_image").detail, "original");
  assert.throws(() => buildCanonicalFieldsRequest({ imageDetail: "maximum" }), /unsupported_image_detail/);
}

// ---------------------------------------------- print run vs checklist code

// The distinction the whole compression ranking hangs on, and it is CSM's
// `classifySemNumberBoundary` deciding it, not a regex in this repo.
{
  const { fields: parsed } = parseCanonicalFields({ card_number: "#221", serial: "17/50", grammar: "standard" });
  assert.equal(parsed.card_number, "221");
  assert.equal(parsed.serial, "17/50");
}
{
  const { fields: parsed, defects } = parseCanonicalFields({ serial: "GS-AKA", grammar: "standard" });
  assert.equal(parsed.serial, "");
  assert.equal(parsed.card_number, "GS-AKA");
  assert.ok(defects.includes("serial_not_a_print_run"));
}
{
  const standard = parseCanonicalFields({ card_number: "15/30", grammar: "standard" });
  assert.equal(standard.fields.serial, "15/30");
  assert.equal(standard.fields.card_number, "");
  // "086/070" on a Pokemon card really is the card number.
  const tcg = parseCanonicalFields({ card_number: "086/070", grammar: "tcg" });
  assert.equal(tcg.fields.card_number, "086/070");
  assert.equal(tcg.fields.serial, "");
}

// COS-39 classification precedes product finish admission. The classifier must
// receive every field its own contract reads; omitting Manufacturer/IP left a
// provider-reported Standard Pokemon card uncorrected, so Refractor survived.
{
  const pokemon = parseCanonicalFields({
    grammar: "standard", manufacturer: "Pokémon", product: "Mega Brave",
    subjects: ["Charizard"], parallel_exact: "Gold Refractor"
  });
  assert.equal(pokemon.fields.grammar, "tcg");
  assert.ok(pokemon.defects.includes("grammar_standard_but_csm_says_tcg"));
  assert.equal(pokemon.fields.print_finish, "",
    "grammar correction must complete before product finish admission");
  assert.ok(pokemon.fields.withheld_finish_terms.some((term) => (
    term.reason === "FINISH_NOT_MARKET_RECOGNIZED_FOR_PRODUCT"
  )));

  const topps = parseCanonicalFields({
    grammar: "standard", manufacturer: "Topps", product: "Chrome",
    subjects: ["Player"], parallel_exact: "Gold Refractor"
  });
  assert.equal(topps.fields.grammar, "standard");
  assert.ok(!topps.defects.includes("grammar_standard_but_csm_says_tcg"));
  assert.equal(topps.fields.print_finish, "Gold Refractor");

  const panini = parseCanonicalFields({
    grammar: "standard", manufacturer: "Panini", product: "Prizm",
    subjects: ["Player"], parallel_exact: "Silver Prizm"
  });
  assert.equal(panini.fields.grammar, "standard");
  assert.ok(!panini.defects.includes("grammar_standard_but_csm_says_tcg"));
  assert.equal(panini.fields.print_finish, "Silver Prizm");
}

// SSP is [Descriptive Rarity], a CSM bracket of its own, not a component.
{
  const parsed = fields({ attributes: ["Auto", "RC", "SSP"] });
  // Canonical order, not the model's. resolvedFieldsToSemSuggestion builds
  // search_optimization as [RC, Auto, Patch, Relic], and rendering components
  // in the model's arbitrary order made the composed title unreplayable from
  // stored rows on 33 of 148 cards. The scorer ignores word order, so adopting
  // the contract's costs nothing.
  assert.deepEqual(parsed.components, ["RC", "Auto"]);
  assert.equal(parsed.descriptive_rarity, "SSP");
}

// Provider variance can repeat an enum item without violating the strict JSON
// schema. Canonical admission keeps the first exact value, records the defect,
// and prevents duplicate buyer terms from reaching the title.
{
  const { fields: parsed, defects } = parseCanonicalFields({
    subjects: ["Michael Jordan", "Michael Jordan", "Scottie Pippen", "Dennis Rodman"],
    card_number: "57",
    attributes: ["Auto", "Auto", "RC", "Auto", "RC"]
  });
  assert.deepEqual(parsed.subjects, ["Michael Jordan", "Scottie Pippen", "Dennis Rodman"],
    "dedupe precedes the three-subject cap so real identities are not displaced");
  assert.deepEqual(parsed.attributes, ["Auto", "RC"]);
  assert.deepEqual(parsed.components, ["RC", "Auto"]);
  assert.ok(defects.includes("duplicate_subjects"));
  assert.ok(defects.includes("duplicate_attributes"));
  const title = composeFromCanonicalFields(parsed).title;
  assert.equal((title.match(/\bAuto\b/g) || []).length, 1);
  assert.equal((title.match(/\bRC\b/g) || []).length, 1);

  const fourUnique = parseCanonicalFields({
    subjects: ["One", "Two", "Three", "Four"]
  });
  assert.deepEqual(fourUnique.fields.subjects, ["One", "Two", "Three"]);
  assert.ok(!fourUnique.defects.includes("duplicate_subjects"),
    "the governed three-subject cap is not a duplicate defect");
}

// A field carrying a whole title instead of its own value.
assert.ok(parseCanonicalFields({
  product: "2023-24 Panini Prizm Silver Refractor LeBron James #1 PSA 10", grammar: "standard"
}).defects.includes("product_looks_like_a_title"));

// `unreadable` naming a field that also has a value is a contradiction.
{
  const { fields: parsed, defects } = parseCanonicalFields({
    serial: "17/50", unreadable: ["serial", "grade"], grammar: "standard"
  });
  assert.deepEqual(parsed.unreadable, ["grading_info"]);
  assert.ok(defects.includes("unreadable_contradicts_value"));
}

// CSM's Grading Info is atomic in priority but structured in meaning. Preserve
// both card and autograph grades until the final marketplace string.
{
  const parsed = fields({
    grading_info: {
      company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
    }
  });
  assert.deepEqual(parsed.grading_info, {
    company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
  });
  assert.equal(parsed.grade, "PSA 9/10");
  assert.deepEqual(emitCsm(parsed, "Example PSA 9/10").canonical_sem.grading_info, {
    company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
  });
}
{
  const parsed = fields({
    grading_info: {
      company: "PSA", card_grade: "", auto_grade: "9", grade_type: "AUTO_ONLY"
    }
  });
  assert.equal(parsed.grade, "PSA Auto 9");
}
{
  const parsed = fields({
    grading_info: {
      company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_ONLY"
    }
  });
  assert.equal(parsed.grading_info.grade_type, "CARD_AND_AUTO",
    "literal grade values outrank a contradictory model enum");
  assert.equal(parsed.grade, "PSA 9/10");
}

assert.deepEqual(parseCanonicalFields("not json").defects, ["unparseable"]);
assert.deepEqual(parseCanonicalFields(null).defects, ["not_an_object"]);

// ---------------------------------------------------- CSM's ordering, not mine

{
  const card = fields({
    year: "2023-24", manufacturer: "Panini", product: "Prizm",
    surface_color: "Silver", parallel_family: "Prizm",
    subjects: ["LeBron James"], card_number: "1", serial: "17/50",
    attributes: ["Auto"], grade: "PSA 10"
  });
  const first = composeFromCanonicalFields(card);
  assert.equal(first.title, composeFromCanonicalFields(card).title, "composition must be deterministic");

  // Imported from semStandardTitleOrder. The hand-written table had both of
  // these inverted.
  assert.ok(BRACKET_ORDER.standard.indexOf("subject") < BRACKET_ORDER.standard.indexOf("release_variant"));
  assert.ok(BRACKET_ORDER.standard.indexOf("numerical_rarity") < BRACKET_ORDER.standard.indexOf("card_number"));

  const positions = first.brackets.map((bracket) => BRACKET_ORDER.standard.indexOf(bracket));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
  // No "#1": the eBay profile does not project [Card Number] for a Standard
  // card. The field is still in the canonical object.
  //
  // No "Silver Prizm" either, and this fixture is the textbook case for why:
  // a base Panini Prizm IS silver, so the colour describes the product's base
  // appearance rather than naming a parallel, and the reviewed titles call the
  // card a Prizm. The admission layer withholds it. Measured across 150 cards,
  // `silver` as an observed surface colour hit the reference once in eleven
  // uses and `rainbow` none in thirty.
  //
  // This assertion previously expected the finish to survive; it was written
  // before the per-term hit rates were measured and encoded the defect.
  assert.equal(first.title, "2023-24 Panini Prizm LeBron James 17/50 Auto PSA 10");
  // The observation is preserved even though the resolution rejected it --
  // withholding must stay reversible for a registry that can confirm the term.
  assert.equal(card.observed_surface_color, "Silver");
  assert.equal(card.withheld_finish_terms[0].reason, "BASE_APPEARANCE_NOT_PARALLEL");
  assert.ok(first.suppressed.includes("card_number"));
  assert.equal(card.card_number, "1");
}

// TCG keeps its card number and its parallel bracket. Filtering the TCG order
// by Standard field names silently dropped the parallel from every TCG title.
{
  const composed = composeFromCanonicalFields(fields({
    year: "2023", manufacturer: "Pokemon", product: "Paldean Fates",
    parallel_exact: "Shiny Ultra Rare", subjects: ["Charizard ex"],
    card_number: "086/070", grade: "PSA 10", grammar: "tcg"
  }));
  assert.match(composed.title, /086\/070/);
  assert.match(composed.title, /Shiny Ultra Rare/);
  assert.ok(!composed.suppressed.includes("card_number"));
  assert.ok(BRACKET_ORDER.tcg.includes("print_finish"), "TCG must carry a parallel bracket");
}

// ------------------------------------------------------- priority compression

{
  const composed = composeFromCanonicalFields(fields({
    year: "2020", manufacturer: "Topps", product: "Triple Threads",
    card_name: "Historic Ties Triple Relic", subjects: ["Aaron Judge"],
    card_number: "HTTR-AJ", serial: "9/10", attributes: ["Auto"], grade: "PSA 10"
  }));
  assert.ok(composed.title.length <= 80);
  // [Subject] outranks [Numerical Rarity] on the keep-list, so a squeeze must
  // never buy "9/10" with "Aaron Judge" -- the documented string-version
  // regression, inverted.
  assert.match(composed.title, /Aaron Judge/);
  assert.match(composed.title, /9\/10/);
  assert.match(composed.title, /PSA 10/);
  // And the repetition rule must not eat a real word: "Triple" appears in both
  // the product and the card name, legitimately.
  assert.match(composed.title, /Historic Ties Triple Relic/);
}

// Nothing on the keep-list appears in any drop list, and `search_optimization`
// is absent because the profile suppresses it before the budget is consulted.
for (const [grammar, order] of Object.entries(DROP_ORDER)) {
  assert.ok(!order.includes("subject"), `${grammar} must never drop the subject`);
  assert.ok(!order.includes("grading_info"), `${grammar} must never drop the grade`);
  assert.ok(!order.includes("numerical_rarity"), `${grammar} must never drop the print run`);
  assert.ok(!order.includes("search_optimization"), `${grammar} suppresses it by profile, not by budget`);
}

// ------------------------------------------------------------- lot structure

// "[Lot*N][Year][Manufacturer Product Set][Subjects up to 3]", and CSM's Lot
// grammar DOES carry [Shared Numerical Rarity] -- the hand-written version
// dropped it on the reasoning that a lot has no single copy number.
{
  const composed = composeFromCanonicalFields(fields({
    year: "2023", manufacturer: "Panini", product: "Prizm",
    subjects: ["Victor Wembanyama", "Chet Holmgren", "Scoot Henderson"],
    card_number: "1", serial: "17/50", lot_count: "12", grammar: "lot"
  }));
  // Lot*N per COS-14 as amended 2026-08-08 (COS-49 named LotxN; superseded):
  // marker, and the spelling the reviewed corpus actually uses (`lotx4`,
  // `Lot*16`). The interim `Lot*n` form is retired; "n Card Lot" before it was
  // written by no writer at all.
  assert.ok(composed.title.startsWith("Lot*12"));
  assert.ok(!composed.title.includes("#1"));
  assert.ok(composed.title.includes("17/50"));
  // The combined bracket carries the product, not just the manufacturer.
  assert.match(composed.title, /Panini Prizm/);
}
// An uncounted lot ABSTAINS from the quantity bracket. This assertion used to
// require a bare "Lot", which was the behaviour rather than the contract:
// COS-14 names `Lot*N` as the ONE approved quantity format and requires
// "route for review or abstain rather than inventing N" when the count cannot
// be established. A bare "Lot" invents nothing, but it is a fourth marker
// beside the three the decision forbids, and it ships a title instead of
// routing. The gate was stricter than the contract in the wrong direction, so
// the gate moved.
{
  const uncounted = composeFromCanonicalFields(fields({ subjects: ["A", "B"], grammar: "lot" }));
  assert.ok(!/\bLot\b/i.test(uncounted.title), "an unread count must not ship a quantity marker");
  assert.ok(!/^Lot\*/.test(uncounted.title), "an unread count must not be fabricated");
  assert.equal(uncounted.lot_quantity_unresolved, true, "the caller must be told to route for review");

  // "0" arrives as a string and used to be truthy, rendering `Lot*0` -- a lot
  // of no cards. N is "the number of cards uploaded or visibly represented".
  const zero = composeFromCanonicalFields(fields({ subjects: ["A"], grammar: "lot", lot_count: 0 }));
  assert.ok(!/Lot\*0/.test(zero.title), "zero cards is not a lot");
  assert.equal(zero.lot_quantity_unresolved, true);

  const counted = composeFromCanonicalFields(fields({ subjects: ["A"], grammar: "lot", lot_count: "4" }));
  assert.ok(counted.title.startsWith("Lot*4"));
  assert.equal(counted.lot_quantity_unresolved, false);

  for (const ambiguous of ["2-3", "1/2", " 2 cards ", 2]) {
    const { fields: parsed, defects } = parseCanonicalFields({
      subjects: ["A", "B"], grammar: "lot", lot_count: ambiguous
    });
    const result = composeFromCanonicalFields(parsed);
    assert.equal(parsed.lot_count, "");
    assert.equal(result.lot_quantity_unresolved, true);
    assert.doesNotMatch(result.title, /^Lot\*(?:23|12|2)\b/,
      `ambiguous quantity ${JSON.stringify(ambiguous)} must not become N`);
    assert.ok(defects.includes("lot_count_not_strict_positive_integer_text"));
  }
  assert.equal(parseCanonicalFields({ grammar: "lot", lot_count: "9999" })
    .fields.lot_count, "9999");
  for (const unsafe of ["01", "10000", "9".repeat(100)]) {
    const parsed = parseCanonicalFields({ grammar: "lot", lot_count: unsafe });
    assert.equal(parsed.fields.lot_count, "");
    assert.ok(parsed.defects.includes("lot_count_not_strict_positive_integer_text"));
  }
}

// ------------------------------------------------------------ empty and team

{
  const composed = composeFromCanonicalFields(fields({ manufacturer: "Topps", subjects: ["Nolan Ryan"] }));
  assert.equal(composed.title, "Topps Nolan Ryan");
  assert.ok(composed.empty_fields.includes("numerical_rarity"));
  assert.ok(composed.empty_fields.includes("grading_info"));
  assert.ok(!composed.title.includes("#"));
}
{
  // Team is carried and NOT projected onto eBay. The reviewed titles do carry
  // "Spurs" and "Lakers", so the bracket is wanted -- what the model puts in it
  // is a full city name, and suppressing it scored better than rendering it.
  const composed = composeFromCanonicalFields(fields({
    year: "2025", manufacturer: "Topps", subjects: ["Nolan Ryan"], team: "Mets"
  }));
  assert.equal(composed.title, "2025 Topps Nolan Ryan");
  assert.ok(composed.suppressed.includes("search_optimization"));
}
{
  // COS-41 (Fei, 2026-08-04): Auto, RC, Patch and Relic stay under Search
  // Optimization, there is no Visible Components bracket, and the Composer must
  // "solve title preservation through priority and compression rules INSIDE
  // Search Optimization" -- suppressing the whole bracket is named as the
  // failure, not the fix. Resolution path item 4 asks to verify these survive
  // compression, and nothing did.
  //
  // The suppression above and the survival below are the same rule seen twice:
  // the bracket is projected partially, keeping the terms buyers search on and
  // dropping the city name they do not.
  const composed = composeFromCanonicalFields(fields({
    year: "2024", manufacturer: "Topps", product: "Chrome", subjects: ["Shohei Ohtani"],
    team: "Los Angeles Dodgers", attributes: ["Auto", "RC", "Patch", "Relic", "Jersey"]
  }));
  for (const term of ["Auto", "RC", "Patch", "Relic", "Jersey"]) {
    assert.match(composed.title, new RegExp(`\\b${term}\\b`), `COS-41: ${term} must survive eBay compression`);
  }
  assert.ok(!/Los Angeles|Dodgers/.test(composed.title), "the city name is the low-value term that yields");

  // `components` is DERIVED from `attributes`; supplying it directly is ignored.
  // Worth pinning, because a test that sets `components` alone sees every term
  // vanish and reads that as a COS-41 violation. It is malformed input.
  const direct = composeFromCanonicalFields(fields({
    year: "2024", manufacturer: "Topps", product: "Chrome", subjects: ["Shohei Ohtani"],
    components: ["Auto", "RC"]
  }));
  assert.ok(!/\bAuto\b/.test(direct.title), "components is derived, not an input");
}

// Composition Before Repetition, and a player whose surname matches the set
// must not lose their name to it.
assert.equal(
  composeFromCanonicalFields(fields({ manufacturer: "Panini", product: "Panini Prizm", subjects: ["Ja Morant"] })).title,
  "Panini Prizm Ja Morant"
);
assert.match(
  composeFromCanonicalFields(fields({ manufacturer: "Topps", product: "Bowman", subjects: ["Bowman"] })).title,
  /Topps Bowman Bowman/
);

// -------------------------------------------------------------- end to end

// Field-level sanitising: the foreign-script tail attaches to whatever the
// model wrote last, and with fields there are a dozen "lasts".
{
  const finished = finishCanonicalTitle(JSON.stringify({
    year: "2025", manufacturer: "Topps", product: "Chrome Platinum", set: "",
    card_name: "", release_variant: "", surface_color: "Gold", parallel_family: "Refractor",
    parallel_exact: "", descriptive_rarity: "",
    subjects: ["Luisangel Acuna 大发时时彩"], team: "Mets", card_number: "", serial: "12/50",
    attributes: ["Auto", "RC"], grade: "", grammar: "standard", lot_count: "",
    unreadable: [], low_confidence: ["surface_color"]
  }));
  assert.ok(finished.sanitised);
  assert.ok(!/[一-鿿]/.test(finished.title));
  assert.match(finished.title, /Luisangel Acuna/);
  assert.match(finished.title, /12\/50/);
  assert.match(finished.title, /Gold Refractor/);
  assert.deepEqual(finished.low_confidence_fields, ["surface_color"]);
  assert.ok(finished.length <= 80);
}

// A response that is not JSON degrades to an empty object rather than throwing
// mid-run: one malformed card must not cost the other 149.
{
  const finished = finishCanonicalTitle("I'm sorry, I can't read this card.");
  assert.equal(finished.title, "");
  assert.deepEqual(finished.field_defects, ["unparseable"]);
}

// ------------------------------------------------------------- CSM emission

// The canonical object is produced FROM our fields, not by composing a title
// and parsing it back. Round-tripping through a string discards exactly what
// the string cannot carry -- confidence, provenance, empty-vs-unreadable.
{
  const card = fields({
    year: "2025-26", manufacturer: "Topps", product: "Chrome",
    surface_color: "Gold", parallel_family: "Refractor",
    subjects: ["Victor Wembanyama"], team: "Spurs", serial: "17/50",
    attributes: ["RC"], grade: "PSA 10", low_confidence: ["surface_color"]
  });
  const title = composeFromCanonicalFields(card).title;
  const emitted = emitCsm(card, title);

  assert.equal(emitted.sem_standard_version, SEM_STANDARD_VERSION);
  assert.equal(emitted.canonical_sem.print_finish, "Gold Refractor");
  assert.deepEqual(emitted.canonical_sem.subject, ["Victor Wembanyama"]);
  assert.equal(emitted.canonical_sem.numerical_rarity, "17/50");
  // RC and the team are search signals in CSM, not brackets of their own.
  assert.ok(emitted.canonical_sem.search_optimization.includes("RC"));
  assert.ok(emitted.canonical_sem.search_optimization.includes("Spurs"));
  // The flywheel projection is what COS-27 consumes.
  assert.ok(Object.keys(emitted.data_flywheel_sem).includes("parallel"));

  // A field the model flagged is an OBSERVED_FIELD_CANDIDATE; one it did not is
  // the BEST_OBSERVED_FIELD. Nothing here may claim RESOLVED_SEMANTIC_FIELD --
  // this path observes and does not resolve.
  assert.equal(emitted.observation_layers.surface_color, SEM_OBSERVATION_LAYER.OBSERVED_FIELD_CANDIDATE);
  assert.equal(emitted.observation_layers.year, SEM_OBSERVATION_LAYER.BEST_OBSERVED_FIELD);
  assert.ok(!Object.values(emitted.observation_layers).includes(SEM_OBSERVATION_LAYER.RESOLVED_SEMANTIC_FIELD));

  assert.deepEqual(checkNumberBrackets(card), []);
  assert.deepEqual(unknownFieldNames(card), []);
}

// The reviewed title is writer feedback, and CSM classifies what it is worth.
{
  const approved = classifyReviewedTitle("same title", "same title");
  assert.equal(approved.action, "APPROVE");
  const edited = classifyReviewedTitle("ours", "theirs");
  assert.equal(edited.action, "EDIT");
  assert.equal(edited.feedback_layer, SEM_FEEDBACK_LAYER.REVIEWED_SEMANTIC_TRUTH);
  // The candidate carries its own parser and standard versions, which is what
  // makes a learning record replayable.
  assert.equal(edited.writer_candidate.parser_version, WRITER_TITLE_SEM_PARSER_VERSION);
  assert.equal(edited.writer_candidate.schema_version, WRITER_TITLE_SEM_CANDIDATE_SCHEMA_VERSION);
}

// A validation event refuses to exist without parent provenance, and a
// VALIDATED one refuses without a reviewer, a timestamp and an identity group.
// Those refusals are the contract doing its job, so they are asserted rather
// than worked around.
{
  const card = fields({ year: "2025", manufacturer: "Topps", subjects: ["Nolan Ryan"] });
  const title = composeFromCanonicalFields(card).title;
  const pending = emitValidationEvent({
    assetId: "card_1", runId: "test", fields: card, composedTitle: title,
    reviewedTitle: "something else", createdAt: "2026-08-01T00:00:00Z"
  });
  assert.equal(pending.validation_status, "PENDING");
  assert.equal(pending.semantic_truth, false);
  assert.ok(pending.payload_sha256);

  const validated = emitValidationEvent({
    assetId: "card_1", runId: "test", fields: card, composedTitle: title,
    reviewedTitle: title, createdAt: "2026-08-01T00:00:00Z"
  });
  assert.equal(validated.validation_status, "VALIDATED");
  assert.equal(validated.semantic_truth, true);
  assert.equal(validated.golden_sem_candidate, true);

  // Image evidence is declared SUPPORTED because it genuinely ran; OCR and
  // catalog are NOT_RUN and say so rather than being absent.
  assert.equal(pending.validation_sources.IMAGE_EVIDENCE.status, "SUPPORTED");
  assert.equal(pending.validation_sources.CATALOG.status, "NOT_RUN");
  assert.equal(validated.validation_sources.HUMAN_CONFIRMATION.status, "SUPPORTED");

  // And the contract's own refusal, called directly: an event with no parent
  // ids cannot be built. `emitValidationEvent` fills them from the run, so the
  // refusal has to be provoked at the CSM boundary to be observed at all.
  assert.throws(() => buildSemValidationEvent({
    extraction: { parser_version: "p", sem_standard_version: "s" },
    validationStatus: "PENDING"
  }), /provenance/);
}

// [Print Finish] projection is grounded-only: an exact printed name, or a
// colour with a recognised finish family. A bare colour stays in the canonical
// object and is not projected onto eBay -- 17 of 59 colours the model wrote on
// the 150-card set were the wrong colour, and a wrong one costs precision
// while buying almost no recall.
{
  const bare = composeFromCanonicalFields(fields({
    manufacturer: "Topps", subjects: ["Nolan Ryan"], surface_color: "Gold"
  }));
  assert.equal(bare.title, "Topps Nolan Ryan");

  const grounded = composeFromCanonicalFields(fields({
    manufacturer: "Topps", subjects: ["Nolan Ryan"], surface_color: "Gold", parallel_family: "Refractor"
  }));
  assert.equal(grounded.title, "Topps Nolan Ryan Gold Refractor");

  const printed = composeFromCanonicalFields(fields({
    manufacturer: "Topps", subjects: ["Nolan Ryan"], parallel_exact: "Gold Vinyl", surface_color: "Gold"
  }));
  assert.match(printed.title, /Gold Vinyl/);

  // COS-49 moved this from a projection decision to a resolution one. The
  // Composer already refused to print a bare colour; what changed is that the
  // CANONICAL object no longer claims it as a resolved Print Finish either. The
  // record and the output now say the same thing, which is the point -- CSM
  // persists the record and the Glass Box shows it to an operator.
  //
  // The observation is not lost: it moves to the evidence layer, where a
  // Registry that confirms the colour can still admit it.
  const card = fields({ manufacturer: "Topps", subjects: ["Nolan Ryan"], surface_color: "Gold" });
  assert.equal(card.print_finish, "", "a bare colour is not canonical Print Finish");
  assert.equal(card.observed_surface_color, "Gold", "but it survives as Recognition evidence");
}

process.stdout.write("canonical fields: ok\n");

// COS-9: [Language] is a * (highest tier) TCG bracket sitting immediately after
// [IP], and it appears in NO other grammar. It was in semCanonicalEditableFields
// and semTcgTitleOrder from the start; the thin path's THIN_FIELDS omitted it,
// so it was filtered out of every TCG title silently. These assertions pin both
// halves: that it renders for TCG in the contract's position, and that it stays
// out of Standard, where COS-8's order has no such bracket.
{
  const tcgFields = {
    grammar: "tcg", year: "2025", ip: "Pokemon", language: "JP", set: "Mega Brave",
    subjects: ["Mega Absol Ex"], card_number: "089/063", descriptive_rarity: "Special Art Rare",
    grade: "CGC 10", attributes: [], components: [], unreadable: [], low_confidence: []
  };
  const tcg = composeFromCanonicalFields(tcgFields);
  assert.match(tcg.title, /^2025 Pokemon JP /, "TCG title must carry [Language] right after [IP]");
  assert.equal(emitCsm(tcgFields, tcg.title).canonical_sem.language, "JP",
    "COS-9 language must survive the title projection into the canonical CSM object");
  assert.equal(BRACKET_ORDER.tcg.indexOf("language"), BRACKET_ORDER.tcg.indexOf("ip") + 1);
  assert.equal(BRACKET_ORDER.standard.includes("language"), false);
  assert.equal(BRACKET_ORDER.lot.includes("language"), false);

  // A sports card leaves it empty and loses nothing.
  const standard = composeFromCanonicalFields({
    grammar: "standard", year: "2023", manufacturer: "Panini", product: "Prizm",
    subjects: ["Victor Wembanyama"], language: "", attributes: [], components: [],
    unreadable: [], low_confidence: []
  });
  assert.equal(/\bJP\b|\bEN\b/.test(standard.title), false);
}

// COS-8 / COS-9 compression tiers. The table is consulted on 28 of 148 real
// cards, so an order that contradicts the grammar is not a theoretical problem.
{
  assert.equal(DROP_ORDER.standard[0], "card_number", "COS-8: Card Number is *** and yields first");
  assert.ok(DROP_ORDER.standard.indexOf("print_finish") < DROP_ORDER.standard.indexOf("release_variant"),
    "COS-8: Print Finish is ** and Release Variant is *, so the finish yields first");
  assert.equal(DROP_ORDER.tcg[0], "manufacturer", "COS-9: Manufacturer is **** in TCG");
  assert.ok(DROP_ORDER.tcg.indexOf("product") < DROP_ORDER.tcg.indexOf("year"),
    "COS-9: Product is **** and Year is *, so Product yields first");
  // Identity and price are in no drop list, in any grammar.
  for (const grammar of ["standard", "tcg", "lot"]) {
    for (const bracket of ["subject", "numerical_rarity", "grading_info", "card_number"]) {
      if (grammar === "standard" && bracket === "card_number") continue;
      assert.equal(DROP_ORDER[grammar].includes(bracket), false, `${grammar}/${bracket} must never be dropped`);
    }
  }
}
