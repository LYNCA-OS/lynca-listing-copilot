#!/usr/bin/env node

import assert from "node:assert/strict";
import { applyFieldObservationResolverV1, resolveFieldObservationCandidatesV1 } from "./field-observation-resolver-v1.mjs";

const base = {
  year: "2025",
  manufacturer: "Topps",
  product: "Chrome",
  subjects: ["Shohei Ohtani"],
  serial: "5/50",
  grammar: "standard"
};

const safe = applyFieldObservationResolverV1(base, [{
  text: "05/50", role: "exact_code", region: "card_front", basis: "printed_text"
}]);
assert.equal(safe.applied, true);
assert.equal(safe.fields.serial, "05/50");
assert.equal(safe.decisions[0].disposition, "admitted");
assert.equal(safe.guards.numeric_pair_unchanged, true);

const conflicting = resolveFieldObservationCandidatesV1(base, [{
  text: "07/50", role: "exact_code", region: "card_front", basis: "printed_text"
}]);
assert.equal(conflicting.fields.serial, "5/50");
assert.equal(conflicting.decisions[0].disposition, "candidate_only");
assert.equal(conflicting.decisions[0].reason, "numeric_pair_conflicts_existing_serial");

const ambiguous = resolveFieldObservationCandidatesV1(base, [{
  text: "Fleer Legacy '00 '01", role: "identity_phrase", region: "card_back", basis: "printed_text"
}]);
assert.equal(ambiguous.decisions[0].disposition, "candidate_only");
assert.equal(ambiguous.fields.product, "Chrome");

console.log("field observation resolver v1 tests passed");

