#!/usr/bin/env node
// COS-39: filtering a grammar's order by names from another grammar's
// vocabulary drops brackets without erroring. These assertions fail on the two
// instances that actually shipped, which the previous test could not -- it
// asserted the rendered order is a subsequence of the canonical order, and a
// missing bracket satisfies that trivially.
import assert from "node:assert/strict";
import {
  semBracketAliases, semCanonicalBracket, semCanonicalTitleOrder,
  semStandardTitleOrder, semTcgTitleOrder, semLotTitleOrder
} from "../lib/listing/csm/sem-definition.mjs";

// The two shipped losses.
assert.equal(semCanonicalBracket("tcg", "product_finish"), "print_finish",
  "every TCG title lost its parallel because these two names did not meet");
assert.equal(semCanonicalBracket("lot", "manufacturer_product_set"), "manufacturer_product",
  "lot titles lost the product: this is one combined bracket, not the manufacturer");

// The canonical vocabulary is Standard's, so every translated name must exist
// there or be a bracket Standard genuinely lacks.
const STANDARD = new Set(semStandardTitleOrder);
const GRAMMAR_ONLY = new Set(["ip", "language", "special_stamp", "description", "lot", "manufacturer_product"]);
for (const grammar of ["tcg", "lot"]) {
  for (const name of semCanonicalTitleOrder(grammar)) {
    assert.ok(STANDARD.has(name) || GRAMMAR_ONLY.has(name),
      `${grammar} bracket ${name} is neither canonical nor a declared grammar-only bracket`);
  }
}

// A translated order must not be shorter than its source: an alias may merge
// names, but nothing may disappear silently.
for (const [grammar, order] of [["tcg", semTcgTitleOrder], ["lot", semLotTitleOrder]]) {
  const translated = semCanonicalTitleOrder(grammar);
  assert.equal(translated.length, new Set(order.map((n) => semCanonicalBracket(grammar, n))).size);
  assert.ok(translated.length >= order.length - 1,
    `${grammar} lost brackets in translation`);
}

// Aliases must point somewhere real, not at another alias.
for (const [grammar, table] of Object.entries(semBracketAliases)) {
  for (const [from, to] of Object.entries(table)) {
    assert.notEqual(from, to, `${grammar}.${from} aliases itself`);
    assert.ok(!Object.prototype.hasOwnProperty.call(table, to),
      `${grammar}.${from} points at another alias`);
  }
}

console.log("csm-bracket-aliases.test.mjs OK");
