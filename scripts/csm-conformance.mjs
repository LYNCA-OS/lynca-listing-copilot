#!/usr/bin/env node
// Does the output CONFORM to CSM, card by card?
//
//   scripts/csm-conformance.mjs artifacts/canonical-v4/thin-path-gpt-5.6-luna.jsonl
//
// Counting how many CSM exports are imported answers a different and much
// weaker question. A symbol can be referenced and used wrongly; the TCG
// parallel bracket was dropped from every TCG title by code that imported the
// TCG title order and filtered it with the wrong field names, and the export
// count was unaffected. So this asserts the contract's own rules against real
// composed output and reports every violation with the card that caused it.
//
// Each check below is a clause, not an opinion:
//
//   1. Bracket order is a subsequence of CSM's order for that grammar.
//   2. Every canonical SEM field is one semCanonicalEditableFields names.
//   3. serial passes isSemNumericalRarityText; card_number passes
//      isSemCardNumberText -- CSM's own predicates, not our regexes.
//   4. print_finish equals CSM's degradation ladder over the three layers.
//   5. Every non-empty field carries an observation layer, and none claims
//      RESOLVED_SEMANTIC_FIELD, which this path is not entitled to.
//   6. A COS-27 validation event builds without throwing -- meaning parent
//      provenance, reviewer and supporting source are all actually present.
//   7. The title fits the marketplace profile's character budget.
//   8. Grammar agrees with semGrammarForResolved where CSM can decide.

import { readFileSync } from "node:fs";

import {
  semStandardTitleOrder, semTcgTitleOrder, semLotTitleOrder,
  semCanonicalEditableFields, semGrammarForResolved,
  isSemNumericalRarityText, isSemCardNumberText
} from "../lib/listing/csm/sem-definition.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields, BRACKET_ORDER } from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import { MARKETPLACE_PROFILES } from "../lib/listing/thin/marketplace-composer-rules.mjs";
import {
  emitCsm, emitValidationEvent, checkNumberBrackets, unknownFieldNames,
  SEM_OBSERVATION_LAYER
} from "../lib/listing/thin/csm-emit.mjs";

const path = process.argv[2];
if (!path) { process.stderr.write("usage: csm-conformance.mjs <checkpoint.jsonl> [arm]\n"); process.exit(1); }

// The arm filter was pinned to the literal `thin_canonical`, which no artifact
// has carried since arms grew their image-detail and effort suffixes. It matched
// nothing and the run printed thirteen green ticks over zero cards -- a checker
// that cannot fail is worse than no checker, because it is quoted as evidence.
// An empty selection is now an error, and the arm is selectable.
const wantedArm = process.argv[3] || null;
const allRows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const rows = allRows.filter((row) => (
  wantedArm ? row.arm === wantedArm : String(row.arm || "").startsWith("thin_canonical")
));
if (!rows.length) {
  const seen = [...new Set(allRows.map((row) => row.arm))].join(", ") || "(none)";
  process.stderr.write(`no rows matched${wantedArm ? ` arm=${wantedArm}` : ""}; arms present: ${seen}\n`);
  process.exit(2);
}

const CSM_ORDER = { standard: semStandardTitleOrder, tcg: semTcgTitleOrder, lot: semLotTitleOrder };
const violations = {};
const note = (rule, detail) => {
  violations[rule] = violations[rule] || [];
  violations[rule].push(detail);
};

// CSM's ladder, asserted independently of the implementation that produces it.
const ladder = (f) => {
  if (f.parallel_exact) return f.parallel_exact;
  if (!f.surface_color) return f.parallel_family || "";
  if (!f.parallel_family || f.parallel_family.toLowerCase().includes(f.surface_color.toLowerCase())) return f.surface_color;
  return `${f.surface_color} ${f.parallel_family}`;
};

for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  let rawPayload = null;
  try { rawPayload = JSON.parse(row.raw_title); } catch { rawPayload = null; }
  const rawFields = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload) ? rawPayload : {};
  const composed = composeFromCanonicalFields(fields);
  const title = finishCanonicalTitle(row.raw_title).title;
  const id = row.asset_id;

  // 1. Bracket order is a subsequence of the grammar's canonical order. Our
  //    order also has to BE a subsequence of CSM's, so both are checked.
  const ours = BRACKET_ORDER[composed.grammar] || BRACKET_ORDER.standard;
  const positions = composed.brackets.map((bracket) => ours.indexOf(bracket));
  if (positions.some((value, index) => value < 0 || (index > 0 && value <= positions[index - 1]))) {
    note("1_bracket_order", `${id}: ${composed.brackets.join(">")}`);
  }
  const csmOrder = CSM_ORDER[composed.grammar] || semStandardTitleOrder;
  const mapped = ours.filter((name) => csmOrder.includes(name));
  const csmPositions = mapped.map((name) => csmOrder.indexOf(name));
  if (csmPositions.some((value, index) => index > 0 && value <= csmPositions[index - 1])) {
    note("1_bracket_order_vs_csm", `${composed.grammar}: ${mapped.join(">")}`);
  }

  // 2. Canonical SEM fields are CSM fields.
  const emitted = emitCsm(fields, title);
  for (const name of Object.keys(emitted.canonical_sem)) {
    if (!semCanonicalEditableFields.includes(name)) note("2_non_csm_sem_field", `${id}: ${name}`);
  }
  // `parseCanonicalFields` normalises onto a fixed key set, so asking it for
  // unknown names always answered `[]`: the rule could not fail. A field the
  // model invented is only visible in the payload BEFORE normalisation, which
  // is where the question belongs -- the check is whether the provider returned
  // something outside CSM, not whether our own parser kept it.
  const unknown = unknownFieldNames(rawFields);
  if (unknown.length) note("2_non_csm_schema_field", `${id}: ${unknown.join(",")}`);

  // 3. Number brackets, judged by CSM's predicates.
  const csmGaps = [];
  for (const problem of checkNumberBrackets(fields, csmGaps)) note("3_number_bracket", `${id}: ${problem}`);
  for (const gap of csmGaps) note("csm_coverage_gap", `${id}: ${gap}`);
  // Shape rules need TWO lenses. `parseCanonicalFields` sanitises a value it
  // cannot accept down to "", so a rule reading only the parsed field audits
  // our sanitiser rather than the provider: a serial of "not-a-serial-at-all"
  // and a print finish of "Bogus Finish Nobody Has" both arrived as "" and every
  // rule below passed. What the model returned is the question CSM asks, so the
  // raw payload is checked too, and reported separately -- a provider violation
  // that our sanitiser caught is a different fact from one that reached a title.
  const rawValue = (name) => {
    const value = rawFields[name];
    if (value == null) return "";
    return Array.isArray(value) ? value.join(" ").trim() : String(value).trim();
  };
  const shape = (name, parsedOk, rawOk, parsedText, rawText) => {
    if (parsedText && !parsedOk) note(name, `${id}: ${parsedText}`);
    else if (rawText && !rawOk) note(`${name}_provider`, `${id}: ${rawText} (sanitised away)`);
  };
  shape("3_serial_shape",
    isSemNumericalRarityText(fields.serial), isSemNumericalRarityText(rawValue("serial")),
    fields.serial, rawValue("serial"));
  const cardNumberOk = (text) => isSemCardNumberText(text, { grammar: fields.grammar, field: "card_number", checklistContext: true });
  if (fields.grammar !== "tcg") {
    shape("3_card_number_shape",
      cardNumberOk(fields.card_number), cardNumberOk(rawValue("card_number")),
      fields.card_number, rawValue("card_number"));
  }

  // 4. The degradation ladder, on both lenses for the same reason.
  if (fields.print_finish !== ladder(fields)) {
    note("4_print_finish_ladder", `${id}: got "${fields.print_finish}" want "${ladder(fields)}"`);
  } else if (rawValue("print_finish") && rawValue("print_finish") !== ladder({
    parallel_exact: rawValue("parallel_exact"),
    surface_color: rawValue("surface_color"),
    parallel_family: rawValue("parallel_family")
  })) {
    note("4_print_finish_ladder_provider", `${id}: "${rawValue("print_finish")}" (sanitised away)`);
  }

  // 5. Observation layers.
  const layers = emitted.observation_layers;
  for (const [name, value] of Object.entries(fields)) {
    const present = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!present || name === "grammar") continue;
    if (!layers[name]) note("5_missing_observation_layer", `${id}: ${name}`);
  }
  if (Object.values(layers).includes(SEM_OBSERVATION_LAYER.RESOLVED_SEMANTIC_FIELD)) {
    note("5_claims_resolved", id);
  }

  // 6. A COS-27 event builds. Both branches, so the VALIDATED path's extra
  //    requirements are exercised and not merely available.
  try {
    emitValidationEvent({ assetId: id, runId: "conformance", fields, composedTitle: title, reviewedTitle: row.reference });
    emitValidationEvent({ assetId: id, runId: "conformance", fields, composedTitle: row.reference, reviewedTitle: row.reference });
  } catch (error) {
    note("6_validation_event", `${id}: ${error.message}`);
  }

  // 7. Marketplace budget.
  if (title.length > MARKETPLACE_PROFILES.ebay.characterBudget) note("7_over_budget", `${id}: ${title.length}c`);

  // 8. Grammar agrees with CSM where CSM can decide.
  const csmGrammar = semGrammarForResolved({
    product: fields.product, set: fields.set || fields.product, card_name: fields.card_name
  });
  if (csmGrammar === "TCG" && composed.grammar === "standard") note("8_grammar_disagrees", `${id}: CSM says TCG`);
}

const rules = [
  "1_bracket_order", "1_bracket_order_vs_csm", "2_non_csm_sem_field", "2_non_csm_schema_field",
  "3_number_bracket", "3_serial_shape", "3_serial_shape_provider",
  "3_card_number_shape", "3_card_number_shape_provider",
  "4_print_finish_ladder", "4_print_finish_ladder_provider",
  "5_missing_observation_layer", "5_claims_resolved", "6_validation_event", "7_over_budget",
  "8_grammar_disagrees"
];
process.stdout.write(`CSM 行为一致性检查 — ${rows.length} 张卡\n\n`);
let total = 0;
for (const rule of rules) {
  const hits = violations[rule] || [];
  total += hits.length;
  process.stdout.write(`${hits.length ? "✗" : "✓"} ${rule.padEnd(30)} ${hits.length}\n`);
  for (const detail of hits.slice(0, 3)) process.stdout.write(`      ${detail}\n`);
  if (hits.length > 3) process.stdout.write(`      …其余 ${hits.length - 3} 条\n`);
}
process.stdout.write(`\n违规合计 ${total}\n`);

// Reported apart from the violations and NOT counted against them: these are
// places the contract's own predicate does not cover a real value, and bending
// the value until it passes would hide a gap in CSM rather than fix anything.
const gaps = violations.csm_coverage_gap || [];
if (gaps.length) {
  process.stdout.write(`\nCSM 覆盖缺口（不是我们的违规）${gaps.length} 条:\n`);
  for (const detail of gaps.slice(0, 3)) process.stdout.write(`   ${detail}\n`);
}
process.exitCode = total ? 1 : 0;
