#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest
} from "../lib/listing/thin/canonical-fields.mjs";
import {
  buildFieldSpecificObservationSchemaV1,
  parseFieldSpecificObservationLaneV1,
  withFieldSpecificObservationLaneV1
} from "../lib/listing/thin/field-specific-observation-lane-v1.mjs";

const schema = buildFieldSpecificObservationSchemaV1(CANONICAL_FIELDS_SCHEMA);
assert.ok(schema.required.includes("observation_candidates"));
assert.equal(schema.properties.observation_candidates.properties.identity_phrases.maxItems, 2);
assert.equal(CANONICAL_FIELDS_SCHEMA.properties.observation_candidates, undefined);

const canonical = buildCanonicalFieldsRequest({ imageUrls: ["https://example.invalid/card.jpg"], model: "gpt-5.6-luna" });
const disabled = withFieldSpecificObservationLaneV1(canonical);
assert.deepEqual(disabled, canonical);
const enabled = withFieldSpecificObservationLaneV1(canonical, { enabled: true });
assert.notDeepEqual(enabled, canonical);
assert.match(enabled.text.format.name, /_field_observation_v1$/);
assert.match(enabled.input[0].content[0].text, /Copy complete visible phrases/);

const parsed = parseFieldSpecificObservationLaneV1({
  observation_candidates: {
    identity_phrases: [
      { text: "Topps Chrome Disney 100", region: "card_back" },
      { text: "Topps Chrome", region: "card_back" }
    ],
    printed_markers: [{ text: "SSP", region: "front_symbol" }],
    stamped_serials: [{ text: "027/150", region: "card_front" }],
    parallel_cues: [
      { text: "Gold Raywave", region: "slab_label", basis: "printed_text" },
      { text: "multicolour geometric foil", region: "card_front", basis: "visual_pattern" }
    ]
  }
}, { canonicalFields: { product: "Topps Chrome" } });

assert.equal(parsed.canonical_fields_unchanged, true);
assert.deepEqual(parsed.field_updates, {});
assert.equal(parsed.automatic_csm_admission, false);
assert.equal(parsed.candidates.length, 5);
assert.equal(parsed.replay_candidates.length, 0);
assert.ok(parsed.dropped.some((row) => row.disposition === "already_canonical"));
assert.ok(parsed.candidates.every((row) => row.authority === "candidate_only"));

const invalidSerial = parseFieldSpecificObservationLaneV1({
  observation_candidates: {
    identity_phrases: [], printed_markers: [],
    stamped_serials: [{ text: "about /50", region: "card_back" }],
    parallel_cues: []
  }
});
assert.ok(invalidSerial.dropped.some((row) => row.disposition === "rejected_invalid_serial_shape"));

console.log("field-specific observation lane v1 tests passed");
