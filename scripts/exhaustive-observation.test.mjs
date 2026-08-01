import assert from "node:assert/strict";

import {
  buildExhaustiveObservationRequest,
  finishExhaustiveObservation,
  parseExhaustiveObservation
} from "../lib/listing/thin/exhaustive-observation.mjs";

const parsed = parseExhaustiveObservation({
  observations: [
    { evidence: "027/150", kind: "printed_text", region: "card_front", label: "stamped_number", confidence: "high" },
    { evidence: "Mirrored Horizontal", kind: "printed_text", region: "slab_label", label: "unknown", confidence: "medium" }
  ],
  unreadable_regions: ["small lower-left line"]
});
assert.equal(parsed.observations.length, 2);
assert.equal(parsed.observations[0].evidence, "027/150", "diagnostic evidence must preserve slash forms and leading zeroes");

const request = buildExhaustiveObservationRequest({
  imageUrls: ["https://example.invalid/card.jpg"],
  model: "gpt-5.6-luna",
  effort: "none",
  imageDetail: "original"
});
assert.equal(request.input[0].content[1].detail, "original");
assert.equal(request.text.format.schema.properties.observations.items.properties.label.type, "string",
  "the diagnostic label must remain open-set instead of reproducing CSM filtering");

const finished = finishExhaustiveObservation(JSON.stringify(parsed));
assert.match(finished.title, /027\/150/);
assert.match(finished.title, /Mirrored Horizontal/);

console.log("exhaustive observation tests passed");
