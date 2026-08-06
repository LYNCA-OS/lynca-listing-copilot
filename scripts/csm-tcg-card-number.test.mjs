#!/usr/bin/env node
// COS-38: the contract's own predicate rejected a value the contract's own
// ground truth treats as a card number. A reviewed title in the evaluation set
// reads "2022 Pokemon EN SWSH Lost Origin Eternatus VMAX Trainer Gallery
// #TG22/TG30", and isSemCardNumberText returned false for TG22/TG30.
import assert from "node:assert/strict";
import { isSemCardNumberText, isSemNumericalRarityText, classifySemNumberBoundary } from "../lib/listing/csm/sem-definition.mjs";

const asCardNumber = (value, grammar) =>
  isSemCardNumberText(value, { grammar, field: "card_number", checklistContext: true });

// The shapes Pokémon subsets actually print.
for (const code of ["TG22/TG30", "TG01/TG30", "GG01/GG70", "SV01/SV122"]) {
  assert.ok(asCardNumber(code, "tcg"), `${code} is a printed TCG card number`);
  assert.equal(classifySemNumberBoundary(code, { grammar: "tcg", field: "card_number", checklistContext: true }).boundary,
    "CARD_NUMBER", `${code} must reach a bracket, not UNKNOWN`);
}

// The asymmetry that made the gap easy to miss: these already passed.
assert.ok(asCardNumber("086/070", "tcg"), "all digits passed via the rarity branch");
assert.ok(asCardNumber("OP01-120", "tcg"), "letters with a hyphen passed via the fallback");

// Standard validation must NOT loosen. There, "a checklist code never contains
// a slash" is what separates a checklist code from a print run, and a print run
// read as a card number would put the copy count in the wrong bracket.
assert.ok(!asCardNumber("17/50", "standard"), "a print run is not a card number");
assert.ok(!asCardNumber("1/1", "standard"));
assert.ok(!asCardNumber("TG22/TG30", "standard"), "the TCG shape stays TCG-only");
assert.equal(classifySemNumberBoundary("17/50", { grammar: "standard", field: "card_number" }).boundary,
  "NUMERICAL_RARITY");
assert.ok(asCardNumber("221", "standard"), "a plain checklist code still passes");

// Not everything with a slash and letters is a subset code.
assert.ok(!asCardNumber("PSA/DNA", "tcg"), "a grading authority is not a card number");
assert.ok(!asCardNumber("TOOLONGPREFIX22/TG30", "tcg"));

// ---------------------------------------------------------------------------
// COS-38's own tables, asserted verbatim. The file grew from one reviewed
// title, so it covered the shapes that had failed and not the decision's list:
// five of the eleven examples were untested, and among them EVERY Standard
// counterexample. That is the exact failure the decision names -- "the TCG
// exception must not weaken the Standard-card rule" -- and nothing here could
// have caught it. Both tables now come from the issue, so a change that trades
// one side for the other fails rather than passing quietly.
//
// Under TCG Grammar these are Card Number. Many copies may share the value;
// the denominator describes checklist or subset size, not print quantity.
for (const code of ["TG22/TG30", "GG01/GG70", "SV01/SV122", "086/070", "139/205", "OP01-120", "TAEV-EN006"]) {
  assert.ok(asCardNumber(code, "tcg"), `COS-38: ${code} is a TCG Card Number`);
}

// Under Standard / Non-TCG Grammar these are Numerical Rarity -- a specific
// copy within a limited production quantity -- and must NOT be a Card Number.
for (const serial of ["04/10", "02/99", "1/1", "150/299"]) {
  assert.ok(isSemNumericalRarityText(serial), `COS-38: ${serial} is Numerical Rarity`);
  assert.ok(!asCardNumber(serial, "standard"), `COS-38: ${serial} must not become a Card Number`);
  assert.equal(
    classifySemNumberBoundary(serial, { grammar: "standard", field: "card_number" }).boundary,
    "NUMERICAL_RARITY",
    `COS-38: ${serial} resolves to scarcity, not checklist position`
  );
}

// The processing order the decision requires: grammar first, then the boundary.
// The same string resolves differently on each side, which is the whole point.
assert.equal(classifySemNumberBoundary("086/070", { grammar: "tcg", field: "card_number", checklistContext: true }).boundary,
  "CARD_NUMBER");
assert.equal(classifySemNumberBoundary("086/070", { grammar: "standard", field: "card_number" }).boundary,
  "NUMERICAL_RARITY");

console.log("csm-tcg-card-number.test.mjs OK");
