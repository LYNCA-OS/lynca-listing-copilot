// The COS-56 harness, checked before it is believed.
//
// Two things can make this measurement mean nothing, and both have happened in
// this repo before:
//
//   1. The arms are secretly the same. An evaluation arm once passed its own
//      schema to a builder that ignored the parameter; the manifest recorded
//      the arm and the request carried the shipped schema.
//   2. The comparison scores something other than what it claims.
//
// So: assert the baseline arm differs from the shipped one in exactly the three
// fields COS-56 touches, assert the request BUILDER carries both overrides, and
// give the sign test cases whose answers are arithmetic.
import assert from "node:assert/strict";

import {
  buildCanonicalFieldsRequest,
  CANONICAL_FIELDS_SCHEMA,
  CANONICAL_FIELDS_PROMPT
} from "../lib/listing/thin/canonical-fields.mjs";
import { buildBaselineArm, signTest, mcnemarExact, scoreBoundaryRows } from "./measure-set-card-name-boundary.mjs";

const baseline = buildBaselineArm();

// The baseline arm differs from shipped in exactly product / set / card_name.
const changed = Object.keys(CANONICAL_FIELDS_SCHEMA.properties).filter((field) =>
  CANONICAL_FIELDS_SCHEMA.properties[field].description
    !== baseline.schema.properties[field].description);
assert.deepEqual(changed.sort(), ["card_name", "product", "set"]);
assert.notEqual(baseline.prompt, CANONICAL_FIELDS_PROMPT);

// The shipped definition must actually say what COS-56 decided, or the arm is
// measuring an intention rather than a rule.
assert.match(CANONICAL_FIELDS_SCHEMA.properties.card_name.description, /EMPTY/);
assert.match(CANONICAL_FIELDS_SCHEMA.properties.set.description, /WITHIN that product/);
assert.match(CANONICAL_FIELDS_PROMPT, /Read `product`, `set` and `card_name` in that order/);
// COS-56 names Downtown a card name. It used to be `set`'s own example.
assert.ok(CANONICAL_FIELDS_SCHEMA.properties.card_name.description.includes("Downtown!"));
assert.ok(!CANONICAL_FIELDS_SCHEMA.properties.set.description.includes("Downtown"));

// The overrides survive the builder — the failure mode that once cost a run.
for (const [arm, config] of [["baseline", baseline],
  ["shipped", { schema: CANONICAL_FIELDS_SCHEMA, prompt: CANONICAL_FIELDS_PROMPT }]]) {
  const body = buildCanonicalFieldsRequest({ imageUrls: ["data:image/jpeg;base64,x"],
    model: "m", ...config });
  assert.equal(body.text.format.schema.properties.set.description,
    config.schema.properties.set.description, `${arm}: schema override dropped`);
  assert.equal(body.input[0].content[0].text, config.prompt, `${arm}: prompt override dropped`);
}
// Production passes neither and must keep getting both shipped values.
const shippedByDefault = buildCanonicalFieldsRequest({ imageUrls: [], model: "m" });
assert.equal(shippedByDefault.input[0].content[0].text, CANONICAL_FIELDS_PROMPT);
assert.equal(shippedByDefault.text.format.schema, CANONICAL_FIELDS_SCHEMA);

// Sign test against arithmetic: 14 straight wins is 2/2^14; an even split is 1.
assert.equal(signTest(0, 0).p, 1);
assert.equal(signTest(7, 7).p, 1);
assert.ok(Math.abs(signTest(14, 0).p - 2 / 2 ** 14) < 1e-12);
assert.ok(Math.abs(signTest(0, 14).p - 2 / 2 ** 14) < 1e-12);
assert.ok(Math.abs(signTest(9, 1).p - 2 * (1 + 10) / 2 ** 10) < 1e-12);
// Symmetric, and ties are excluded rather than counted as evidence.
assert.equal(signTest(3, 8).p, signTest(8, 3).p);

// McNemar counts only the DISCORDANT slots. Two hand-built cards with a known
// answer: a field both arms oscillate on carries no information, and a field
// neither arm oscillates on carries none either.
const rows = [
  { baseline: { disagreements: ["set", "card_name", "serial"] }, cos56: { disagreements: ["serial"] } },
  { baseline: { disagreements: ["set"] }, cos56: { disagreements: ["grade"] } }
];
const m = mcnemarExact(rows, ["set", "card_name", "serial", "grade"]);
assert.equal(m.slots, 8);
assert.equal(m.baseline_only, 3, "set x2 and card_name x1 improved");
assert.equal(m.treatment_only, 1, "grade got worse");
assert.equal(m.both_disagree, 1, "serial oscillates in both arms — no information");
assert.equal(m.both_agree, 3);
assert.ok(Math.abs(m.p - signTest(3, 1).p) < 1e-12);

// The card-level scoring counts a card as a win on its total, not per field.
const scored = scoreBoundaryRows(rows);
assert.equal(scored.before.total, 4);
assert.equal(scored.after.total, 2);
assert.equal(scored.wins, 1, "card 1 improved 3 -> 1");
assert.equal(scored.losses, 0);
assert.equal(scored.ties, 1, "card 2 went 1 -> 1: a different field, same count");
assert.equal(scored.boundary_before, 3);
assert.equal(scored.boundary_after, 0);

console.log("set/card_name boundary harness tests passed");
