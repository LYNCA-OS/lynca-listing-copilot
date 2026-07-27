import test from "node:test";
import assert from "node:assert/strict";

import {
  alignEntityClaim,
  classifyEntityRelation,
  entityAlignmentRelations,
  normalizeEntityText,
  uniqueAlignedValue
} from "../lib/listing/catalog/entity-alignment.mjs";
import { metrics } from "./evaluate-entity-alignment.mjs";

const { EXACT, SPELLING, PREFIX, HYPERNYM, NONE } = entityAlignmentRelations;

test("normalization removes season wrappers but keeps identity words", () => {
  assert.equal(normalizeEntityText("Panini Prizm FIFA (25-26)"), "panini prizm fifa");
});

test("the labelled imprecision cases are not fabrication", () => {
  assert.equal(classifyEntityRelation("Talisman", "Talismen"), SPELLING);
  assert.equal(classifyEntityRelation("Club Legends", "Club Legends Signatures"), PREFIX);
  assert.equal(classifyEntityRelation("Prizm", "Panini Prizm FIFA"), HYPERNYM);
  assert.equal(classifyEntityRelation("Contours", "Contours"), EXACT);
});

test("the labelled invented product claims remain NONE", () => {
  for (const claim of ["Prizm Mosaic", "Emerald Prism", "Prizm Red Wave", "Prizm Draft Picks"]) {
    assert.equal(classifyEntityRelation(claim, "Panini Phoenix"), NONE, claim);
  }
});

test("absence of authoritative candidates is UNCHECKED, never NONE", () => {
  const result = alignEntityClaim("Topps Chrome", []);
  assert.equal(result.checked, false);
  assert.equal(result.status, "UNCHECKED");
  assert.equal(result.relation, null);
});

test("an ambiguous best relation returns candidates but no winner", () => {
  const result = alignEntityClaim("Base", [
    { id: "phoenix", value: "Base", kind: "set" },
    { id: "prizm", value: "Base", kind: "set" }
  ]);
  assert.equal(result.relation, EXACT);
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.selected_candidate, null);
  assert.equal(uniqueAlignedValue("Base", result.candidates), null);
});

test("a unique relation may be read without making an application decision", () => {
  const result = alignEntityClaim("Club Legends", [
    { id: "set-1", value: "Club Legends Signatures", kind: "set" },
    { id: "set-2", value: "Talismen", kind: "set" }
  ]);
  assert.equal(result.relation, PREFIX);
  assert.equal(result.selected_candidate?.id, "set-1");
  assert.equal(uniqueAlignedValue("Club Legends", ["Club Legends Signatures", "Talismen"]), "Club Legends Signatures");
});

test("unlabelled familiar comparisons cannot manufacture a true-negative rate", () => {
  const result = metrics([
    { checked: true, predicted_none: false, expected_none: null },
    { checked: true, predicted_none: true, expected_none: null }
  ]);
  assert.equal(result.checked, 2);
  assert.equal(result.labelled, 0);
  assert.equal(result.true_negative, null);
  assert.equal(result.false_none_rate, null);
});
