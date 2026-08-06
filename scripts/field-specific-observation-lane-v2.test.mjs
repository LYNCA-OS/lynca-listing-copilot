#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest
} from "../lib/listing/thin/canonical-fields.mjs";
import {
  FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2,
  buildFieldSpecificObservationSchemaV2,
  captureFieldSpecificObservationLaneV2,
  toFieldSpecificObservationTraceV2,
  withFieldSpecificObservationLaneV2
} from "../experiments/accuracy/field-specific-observation-lane-v2.mjs";
import {
  captureProductSetParallelHypothesesV1,
  withProductSetParallelHypothesisLaneV1
} from "../experiments/accuracy/product-set-parallel-hypothesis-lane-v1.mjs";

const schema = buildFieldSpecificObservationSchemaV2(CANONICAL_FIELDS_SCHEMA);
assert.equal(schema.properties.observation_candidates.maxItems, 2);
assert.equal(FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2, 2);
assert.equal(CANONICAL_FIELDS_SCHEMA.properties.observation_candidates, undefined);

const canonical = buildCanonicalFieldsRequest({
  imageUrls: ["https://example.invalid/front.jpg", "https://example.invalid/back.jpg"],
  model: "gpt-5.6-luna"
});
assert.deepEqual(withFieldSpecificObservationLaneV2(canonical), canonical);
const treatment = withFieldSpecificObservationLaneV2(canonical, { enabled: true });
assert.equal(treatment.model, canonical.model);
assert.equal(treatment.max_output_tokens, canonical.max_output_tokens);
assert.deepEqual(treatment.reasoning, canonical.reasoning);
assert.deepEqual(treatment.input[0].content.filter((part) => part.type === "input_image"),
  canonical.input[0].content.filter((part) => part.type === "input_image"));
assert.match(treatment.text.format.name, /_field_observation_v2$/);
assert.match(treatment.input[0].content[0].text, /zero to two rows/i);

const canonicalFields = {
  product: "Topps Chrome",
  team: "Dodgers",
  serial: "17/50",
  grading_info: { company: "PSA", card_grade: "10" }
};
const snapshot = structuredClone(canonicalFields);
const captured = captureFieldSpecificObservationLaneV2({
  observation_candidates: [
    { text: "Los Angeles Dodgers", role: "identity_phrase", region: "card_front", basis: "printed_text" },
    { text: "Gold Refractor", role: "finish_phrase", region: "card_front", basis: "visual_pattern" }
  ]
}, { canonicalFields });
assert.deepEqual(canonicalFields, snapshot);
assert.equal(captured.candidates.length, 2);
assert.deepEqual(captured.field_updates, {});
assert.deepEqual(captured.admission_proposals, []);
assert.ok(captured.candidates.every((row) => row.authority === "candidate_only"));
assert.equal(captured.automatic_csm_admission, false);
assert.equal(captured.persistence_authority, false);

const rejected = captureFieldSpecificObservationLaneV2({
  observation_candidates: [
    { text: "Topps Chrome", role: "identity_phrase", region: "card_back", basis: "printed_text" },
    { text: "Shohei Ohtani", role: "identity_phrase", region: "card_front", basis: "visual_pattern" },
    { text: "Career statistics", role: "identity_phrase", region: "card_back", basis: "printed_text" }
  ]
}, { canonicalFields });
assert.ok(rejected.defects.some((value) => value.startsWith("field_observation_v2_overflow:")));
assert.ok(rejected.dropped.some((row) => row.disposition === "already_represented_in_canonical_fields"));
assert.ok(rejected.dropped.some((row) => row.disposition === "rejected_visual_basis_for_non_finish"));

const trace = toFieldSpecificObservationTraceV2(captured);
assert.deepEqual(trace.field_updates, {});
assert.equal(trace.authority, "capture_only");
assert.equal(JSON.stringify(trace).includes("canonical_value"), false);
assert.equal(JSON.stringify(trace).includes("selected_candidate"), false);

const hypothesisRequest = withProductSetParallelHypothesisLaneV1(canonical, { enabled: true });
assert.equal(hypothesisRequest.text.format.schema.properties.observation_candidates, undefined);
assert.ok(hypothesisRequest.text.format.schema.properties.product_set_parallel_hypotheses);
const hypotheses = captureProductSetParallelHypothesesV1({
  product_set_parallel_hypotheses: [
    { product: "Topps Chrome Disney 100", set: "Disney 100", parallel: "", region: "card_back", basis: "visible_combination" },
    { product: "Topps Chrome", set: "", parallel: "Gold Refractor", region: "card_front", basis: "model_knowledge" }
  ]
});
assert.equal(hypotheses.candidates.length, 2);
assert.deepEqual(hypotheses.field_updates, {});
assert.ok(hypotheses.candidates.every((row) => row.world_rank_required));

const duplicateHypothesis = captureProductSetParallelHypothesesV1({
  product_set_parallel_hypotheses: [
    { product: "Chrome", set: "", parallel: "", region: "card_front", basis: "visible_combination" },
    { product: "Chrome", set: "", parallel: "", region: "card_back", basis: "visible_combination" }
  ]
});
assert.equal(duplicateHypothesis.candidates.length, 1);
assert.ok(duplicateHypothesis.dropped.some((row) => row.disposition === "rejected_duplicate_tuple"));

console.log("field-specific observation lane v2 contract tests passed");
