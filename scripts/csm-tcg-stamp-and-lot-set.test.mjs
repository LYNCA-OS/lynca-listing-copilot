#!/usr/bin/env node
// Three brackets the contract names and the thin path could not emit.
//
// The gap was invisible from inside: TCG Grammar has 17 brackets, the schema
// carried no field for `special_stamp` or `description`, and the Composer
// filters the grammar order by the fields it holds -- so the two simply were
// not in the order, and nothing reported a bracket missing.
import assert from "node:assert/strict";
import { parseCanonicalFields, CANONICAL_FIELD_NAMES } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields, BRACKET_ORDER, DROP_ORDER } from "../lib/listing/thin/canonical-composer.mjs";
import { semTcgTitleOrder, semLotTitleOrder, semCanonicalBracket, semCanonicalEditableFields } from "../lib/listing/csm/sem-definition.mjs";
import { toResolvedFields } from "../lib/listing/thin/csm-emit.mjs";

const compose = (raw) => {
  const parsed = parseCanonicalFields(JSON.stringify(raw));
  return composeFromCanonicalFields(parsed.fields || parsed);
};

// --- 60 CSM Rebuild Contract: "Subject and Special Stamp are text-led" -------
for (const field of ["special_stamp", "description"]) {
  assert.ok(CANONICAL_FIELD_NAMES.includes(field), `${field} must be a canonical field`);
  assert.ok(BRACKET_ORDER.tcg.includes(field), `${field} must reach the TCG order`);
}
// TCG-only: neither grammar names them, so neither may acquire them.
for (const grammar of ["standard", "lot"]) {
  for (const field of ["special_stamp", "description"]) {
    assert.ok(!BRACKET_ORDER[grammar].includes(field), `${field} is not a ${grammar} bracket`);
  }
}

const stamped = compose({
  year: "2022", language: "EN", manufacturer: "Pokemon", set: "Trainer Gallery",
  subjects: ["Eternatus VMAX"], special_stamp: "1st Edition", grammar: "tcg"
});
assert.match(stamped.title, /1st Edition/, "a printed 1st Edition mark reaches the title");
assert.ok(stamped.brackets.includes("special_stamp"));

// Reaching the TITLE is only half of it. The resolved record is the canonical
// identity and the title is a projection of it, so a field that composes but
// does not persist leaves a card whose title claims a stamp its stored identity
// never had. `toResolvedFields` enumerates fields by hand, so a new one is
// silently absent until someone adds it -- these two were.
{
  const parsed = parseCanonicalFields(JSON.stringify({
    year: "2022", manufacturer: "Pokemon", set: "Trainer Gallery",
    subjects: ["Eternatus VMAX"], special_stamp: "1st Edition",
    description: "Case Hit", grammar: "tcg"
  }));
  const resolved = toResolvedFields(parsed.fields || parsed);
  assert.equal(resolved.special_stamp, "1st Edition", "the stamp must persist, not only compose");
  assert.equal(resolved.description, "Case Hit");
}

// Both are CSM canonical fields; this is not a name this layer invented.
for (const field of ["special_stamp", "description"]) {
  assert.ok(semCanonicalEditableFields.includes(field), `${field} must be a CSM canonical field`);
}

// A bracket missing from DROP_ORDER can never be dropped, which would make the
// LOWEST-priority bracket in the contract outrank Product. `description` must
// be offered first and `special_stamp` late.
// Second, not first: COS-9 ranks Manufacturer **** and it yields before
// everything in TCG. What matters is that `description` is IN this table, since
// a bracket absent from it can never be dropped at all.
assert.ok(DROP_ORDER.tcg.includes("description"), "description must be droppable");
assert.ok(DROP_ORDER.tcg.indexOf("description") < DROP_ORDER.tcg.indexOf("product"),
  "the lowest-value bracket must not outrank Product");
assert.equal(DROP_ORDER.tcg[0], "manufacturer", "COS-9 keeps Manufacturer first to yield");
assert.ok(DROP_ORDER.tcg.indexOf("special_stamp") > DROP_ORDER.tcg.indexOf("product"),
  "a printed stamp outranks Manufacturer and Product, per COS-9's tiers");
for (const name of BRACKET_ORDER.tcg) {
  if (name === "search_optimization" || name === "ip") continue;
  assert.ok(DROP_ORDER.tcg.includes(name) || ["year", "subject", "card_number", "numerical_rarity", "grading_info", "language"].includes(name),
    `${name} is either droppable or deliberately un-droppable identity`);
}

// --- COS-14: the approved Lot example, verbatim ------------------------------
// "Composer emits one market-consensus Product / Set expression." The Lot
// grammar is the only one that folds Manufacturer, Product and Set into a
// single bracket, so a set that extends neither could vanish with nothing
// reporting a loss. It did.
const lot = compose({
  year: "2024", manufacturer: "Topps", product: "Chrome", set: "Update",
  subjects: ["Shohei Ohtani", "Aaron Judge", "Juan Soto"],
  parallel_family: "Refractor", parallel_exact: "Refractor",
  lot_count: 3, grammar: "lot"
});
assert.equal(lot.title,
  "Lotx3 2024 Topps Chrome Update Shohei Ohtani Aaron Judge Juan Soto Refractor",
  "COS-14's approved example must be reproduced exactly");

// The counterexample the same branch exists for: an insert line BESIDE the
// product repeats one of its words, and emitting both produces a phrase no
// writer publishes ("Topps Bowman Chrome Bowman Briefing").
const beside = compose({
  year: "2024", manufacturer: "Topps", product: "Bowman Chrome", set: "Bowman Briefing",
  subjects: ["Paul Skenes"], lot_count: 2, grammar: "lot"
});
assert.match(beside.title, /^Lotx2 2024 Topps Bowman Chrome Paul Skenes$/,
  "a set that echoes the product stays out");

// COS-14: at most three commercially salient Subjects.
const four = parseCanonicalFields(JSON.stringify({
  subjects: ["A", "B", "C", "D"], lot_count: 4, grammar: "lot"
}));
assert.equal((four.fields || four).subjects.length, 3, "at most three Subjects");

// COS-14: never invent N. The caller is told to route for review instead.
const uncounted = compose({
  year: "2024", manufacturer: "Topps", product: "Chrome",
  subjects: ["Shohei Ohtani"], grammar: "lot"
});
assert.equal(uncounted.lot_quantity_unresolved, true);
assert.ok(!/Lotx/.test(uncounted.title), "no quantity marker is invented");

// Every bracket each grammar NAMES must be reachable -- compared through
// `semCanonicalBracket`, the same translation the Composer filters with. The
// first version of this check compared contract names against carried names
// directly and reported [Variant] unreachable; it is carried, as
// `release_variant`. A conformance check that speaks a different vocabulary
// than the code invents gaps and hides real ones.
const unreachable = (grammar, order) => order
  .map((name) => semCanonicalBracket(grammar, name))
  .filter((name) => !BRACKET_ORDER[grammar].includes(name));

// Card Number is unprojected by founder decision; Search Optimization is
// suppressed by the eBay profile before the budget is consulted.
assert.deepEqual(
  unreachable("tcg", semTcgTitleOrder).filter((n) => n !== "card_number" && n !== "search_optimization"),
  [],
  "every TCG bracket the contract names must be reachable"
);
assert.deepEqual(
  unreachable("lot", semLotTitleOrder).filter((n) => n !== "search_optimization"),
  [],
  "every Lot bracket the contract names must be reachable"
);

console.log("csm-tcg-stamp-and-lot-set.test.mjs OK");
