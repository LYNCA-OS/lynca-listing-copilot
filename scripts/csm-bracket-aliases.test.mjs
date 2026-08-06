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
// Superseded by COS-39's founder decision of 2026-08-04: this is a composition
// responsibility, not an alias. The original defect it guarded -- lot titles
// losing the product because the name was read as `manufacturer` -- is now
// covered by the composition assertions at the end of this file, which check
// the decision's own examples rather than a mapping.

// The canonical vocabulary is Standard's, so every translated name must exist
// there or be a bracket Standard genuinely lacks.
const STANDARD = new Set(semStandardTitleOrder);
// `manufacturer_product_set` is here as a composition responsibility, not as a
// canonical field -- COS-39 is explicit that it is not a fourth one.
const GRAMMAR_ONLY = new Set(["ip", "language", "special_stamp", "description", "lot", "manufacturer_product_set"]);
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

// COS-39 (founder, 2026-08-04): manufacturer_product_set is a COMPOSITION
// RESPONSIBILITY, not a fourth CSM field and not an alias. An earlier pass of
// this file listed it as an alias for `manufacturer_product`, which is the
// reading the decision rejects -- an alias says two names mean one field, and
// this name means "work these three out".
import { semCompositionResponsibilities } from "../csm/ontology/sem-definition.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

assert.equal(semCanonicalBracket("lot", "manufacturer_product_set"), "manufacturer_product_set",
  "a composition responsibility must not be translated into one of its parts");
assert.deepEqual(semCompositionResponsibilities.manufacturer_product_set.composes,
  ["manufacturer", "product", "set"]);

// The decision's own examples. Containment, not concatenation, and not one
// field chosen blindly -- reading `product` alone silently dropped the set.
{
  const card = (manufacturer, product, set) => composeFromCanonicalFields({
    year: "2025", manufacturer, product, set, subjects: ["A", "B"],
    attributes: [], components: [], team: "", serial: "", card_number: "",
    grade: "", card_name: "", release_variant: "", print_finish: "",
    descriptive_rarity: "", grammar: "lot", lot_count: "3"
  }).title;
  const update = card("Topps", "Topps Chrome", "Topps Chrome Update");
  assert.match(update, /Topps Chrome Update/);
  assert.ok(!/Topps Topps/.test(update), "never concatenate all three");
  assert.match(card("Topps", "Topps Chrome", "Topps Chrome Disney"), /Topps Chrome Disney/);
  // Nothing to contain: both survive.
  assert.match(card("Panini", "Prizm", ""), /Panini Prizm/);
}

console.log("csm-bracket-aliases composition-responsibility assertions OK");
