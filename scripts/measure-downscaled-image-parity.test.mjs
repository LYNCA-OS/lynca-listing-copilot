// The instrument, checked against a run whose answer is already known.
//
// COS-56's baseline — 21 field disagreements over 14 cards, 4 of 14 agreeing on
// every field — was measured on 2026-08-07 with a `--control` arm that lived in
// an uncommitted local edit. The numbers were quoted in the issue and in the
// handoff; the flag was not in the file. This replays that run's stored
// per-card payloads through the scoring the restored flag uses, so the flag
// cannot silently score differently from the baseline it is compared against.
//
// The run is a CONTROL run (`small_bytes === original_bytes`, both arms the
// original image) even though it was written to the downscale run's path, which
// is where the uncommitted version put it. It is copied into `scripts/fixtures`
// because `artifacts/` is gitignored: a baseline that exists only on one
// machine is not a baseline anything can be measured against later.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  COMPARED_FIELDS,
  normalizeFieldValue,
  disagreeingFields,
  summarizeParityRows
} from "./measure-downscaled-image-parity.mjs";

const stored = JSON.parse(await readFile(
  new URL("./fixtures/cos-56-variance-baseline-20260807.json", import.meta.url), "utf8"));

assert.equal(stored.original_bytes, stored.small_bytes,
  "the stored baseline must be a control run — both arms the same bytes");

const summary = summarizeParityRows(stored.rows);
assert.equal(summary.cards, 14);
assert.equal(summary.agreed, 4, "4 of 14 cards agreed on every field");
assert.equal(summary.disagreements, 21, "21 field disagreements is COS-56's baseline");
assert.equal(summary.by_field.card_name, 8);
assert.equal(summary.by_field.set, 4);
assert.equal(summary.by_field.card_name + summary.by_field.set, 12,
  "set and card_name carry more than half of the variance — the reason COS-56 exists");

// The scoring recomputes rather than trusting each row's stored tally, so the
// two must agree. If they ever do not, the comparison changed under the
// baseline and no before/after using it means anything.
for (const row of stored.rows) {
  assert.deepEqual(disagreeingFields(row.full, row.reduced), row.disagreements,
    `card ${row.card}: recomputed disagreements differ from the stored ones`);
}

// Known answers for the normalizer itself: a field that differs only by array
// order or case is a real disagreement, and whitespace alone is not.
assert.equal(normalizeFieldValue(["A", "B"]), "a|b");
assert.equal(normalizeFieldValue("  Gold  "), "gold");
assert.equal(normalizeFieldValue(undefined), "");
assert.deepEqual(disagreeingFields({ set: "Downtown" }, { set: " downtown " }), []);
assert.deepEqual(disagreeingFields({ set: "" }, { set: "Draft Picks" }), ["set"]);

// The boundary COS-56 decides is only visible if both fields are compared.
assert.ok(COMPARED_FIELDS.includes("set") && COMPARED_FIELDS.includes("card_name"));

console.log("downscaled image parity instrument tests passed");
