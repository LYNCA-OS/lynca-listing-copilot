import assert from "node:assert/strict";

import {
  CANONICAL_FIELDS_SCHEMA,
  CANONICAL_FIELD_NAMES,
  CANONICAL_ATTRIBUTES,
  CANONICAL_FIELDS_PROMPT,
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
import { SEM_STANDARD_VERSION } from "../lib/listing/csm/sem-definition.mjs";
import { buildSemValidationEvent } from "../lib/listing/csm/sem-validation.mjs";
import {
  WRITER_TITLE_SEM_PARSER_VERSION,
  WRITER_TITLE_SEM_CANDIDATE_SCHEMA_VERSION
} from "../lib/listing/csm/title-derived-sem.mjs";

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
assert.ok(Object.keys(CANONICAL_FIELDS_SCHEMA.properties).length <= 21);
for (const field of ["year", "manufacturer", "product", "set", "card_name",
  "release_variant", "print_finish", "descriptive_rarity", "card_number"]) {
  assert.ok(semCanonicalEditableFields.includes(field), `${field} must be a CSM canonical field`);
}
// Two schema names differ from CSM's and the difference is deliberate, so it is
// written down rather than discovered later: this schema says `grade` and
// `subjects` where CSM says `grading_info` and `subject`. The composer maps
// them; nothing else may invent a third name.
assert.ok(semCanonicalEditableFields.includes("grading_info"));
assert.ok(semCanonicalEditableFields.includes("subject"));
assert.ok(CANONICAL_FIELDS_SCHEMA.properties.grade);
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
{
  const ladder = [
    [{ surface_color: "Gold", parallel_family: "Refractor" }, "Gold Refractor"],
    [{ surface_color: "Gold" }, "Gold"],
    [{ parallel_family: "Mojo" }, "Mojo"],
    [{ parallel_exact: "Gold Vinyl", surface_color: "Gold" }, "Gold Vinyl"],
    [{}, ""]
  ];
  for (const [input, expected] of ladder) {
    assert.equal(parseCanonicalFields(input).fields.print_finish, expected);
  }
}

// The completeness counterweight. An anti-fabrication instruction with nothing
// on the other side of the scale makes "say less" the model's optimal play.
assert.match(CANONICAL_FIELDS_PROMPT, /80-character budget/);
assert.match(CANONICAL_FIELDS_PROMPT, /Report every field you can actually read/);
assert.match(CANONICAL_FIELDS_PROMPT, /low_confidence/);
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

for (const name of CANONICAL_FIELDS_SCHEMA.properties.unreadable.items.enum) {
  assert.ok(CANONICAL_FIELD_NAMES.includes(name));
}

// One call, images in, nothing else. No candidate list, no catalog rows, no
// second round -- the three things measured as negative all entered through a
// parameter like that.
{
  const request = buildCanonicalFieldsRequest({ imageUrls: ["https://example.test/a.jpg"], model: "gpt-5.6-luna" });
  assert.equal(request.input.length, 1);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input[0].content.filter((part) => part.type === "input_image").length, 1);
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

// SSP is [Descriptive Rarity], a CSM bracket of its own, not a component.
{
  const parsed = fields({ attributes: ["Auto", "RC", "SSP"] });
  assert.deepEqual(parsed.components, ["Auto", "RC"]);
  assert.equal(parsed.descriptive_rarity, "SSP");
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
  assert.deepEqual(parsed.unreadable, ["grade"]);
  assert.ok(defects.includes("unreadable_contradicts_value"));
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
  // "Prizm" appears twice -- once as the product, once inside the finish -- and
  // that is left alone deliberately. Prefix de-duplication does not reach a word
  // in the middle of a bracket, and it should not: the reviewed titles repeat it
  // too ("Panini Prizm Jalen Brunson RC Prizm Mojo 13/25"). 16 of 148 composed
  // titles carry a repeat and the reference does the same on those cards.
  assert.equal(first.title, "2023-24 Panini Prizm LeBron James Silver Prizm 17/50 Auto PSA 10");
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

// "[Lot*n][Year][Manufacturer Product Set][Subjects up to 3]", and CSM's Lot
// grammar DOES carry [Shared Numerical Rarity] -- the hand-written version
// dropped it on the reasoning that a lot has no single copy number.
{
  const composed = composeFromCanonicalFields(fields({
    year: "2023", manufacturer: "Panini", product: "Prizm",
    subjects: ["Victor Wembanyama", "Chet Holmgren", "Scoot Henderson"],
    card_number: "1", serial: "17/50", lot_count: "12", grammar: "lot"
  }));
  assert.ok(composed.title.startsWith("12 Card Lot"));
  assert.ok(!composed.title.includes("#1"));
  assert.ok(composed.title.includes("17/50"));
  // The combined bracket carries the product, not just the manufacturer.
  assert.match(composed.title, /Panini Prizm/);
}
// An uncounted lot says "Card Lot" rather than inventing a count from the
// subject list, which caps at 3 and is not the number of cards.
assert.ok(composeFromCanonicalFields(fields({ subjects: ["A", "B"], grammar: "lot" })).title.startsWith("Card Lot"));

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

  // And the colour is still in the object -- this is a projection decision.
  const card = fields({ manufacturer: "Topps", subjects: ["Nolan Ryan"], surface_color: "Gold" });
  assert.equal(card.surface_color, "Gold");
  assert.equal(card.print_finish, "Gold");
}

process.stdout.write("canonical fields: ok\n");
