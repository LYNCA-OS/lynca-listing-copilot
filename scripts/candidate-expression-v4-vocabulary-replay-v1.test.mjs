import assert from "node:assert/strict";
import {
  replayCandidateExpressionV4VocabularyV1,
  CANDIDATE_EXPRESSION_V4_VOCABULARY_REPLAY_VERSION
} from "../lib/listing/thin/candidate-expression-v4-vocabulary-replay-v1.mjs";

const base = {
  manufacturer: "Topps", product: "Chrome", set: "", subjects: ["Diana Shnaider"],
  card_name: "", parallel_exact: "", descriptive_rarity: ""
};

const admitted = replayCandidateExpressionV4VocabularyV1(base, [
  { value: "MIRRORED", kind: "identity", basis: "exact_text", image: "image_1", region: "card_front" },
  { value: "Gold Shimmer", kind: "finish", basis: "stamped_text", image: "image_1", region: "slab_label" },
  { value: "SSP", kind: "attribute", basis: "exact_text", image: "image_1", region: "card_front" }
]);
assert.equal(admitted.fields.card_name, "MIRRORED");
assert.equal(admitted.fields.parallel_exact, "Gold Shimmer");
assert.equal(admitted.fields.descriptive_rarity, "SSP");
assert.equal(admitted.changes.length, 3);
assert.equal(admitted.authority, "evaluation_only");
assert.equal(admitted.production_promoted, false);
assert.equal(admitted.resolver, CANDIDATE_EXPRESSION_V4_VOCABULARY_REPLAY_VERSION);
assert.equal(base.card_name, "");

const rejected = replayCandidateExpressionV4VocabularyV1(base, [
  { value: "Topps", kind: "identity", basis: "logo_or_symbol", image: "image_1", region: "card_front" },
  { value: "Mirror Orange", kind: "finish", basis: "stamped_text", image: "image_1", region: "slab_label" },
  { value: "Japanese text", kind: "attribute", basis: "exact_text", image: "image_1", region: "card_front" }
]);
assert.equal(rejected.changes.length, 0);
assert.equal(rejected.fields.card_name, "");
assert.equal(rejected.fields.parallel_exact, "");
assert.equal(rejected.fields.descriptive_rarity, "");

const occupied = replayCandidateExpressionV4VocabularyV1(
  { ...base, card_name: "Spotlights", parallel_exact: "Gold Refractor", descriptive_rarity: "SP" },
  [{ value: "MIRRORED", kind: "identity", basis: "exact_text", image: "image_1", region: "card_front" }]
);
assert.equal(occupied.changes.length, 0);
assert.equal(occupied.fields.card_name, "Spotlights");
console.log("candidate expression v4 vocabulary replay v1 tests passed");
