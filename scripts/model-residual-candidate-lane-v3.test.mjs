import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARM_SPECS } from "./run-thin-path-eval.mjs";
import { captureModelResidualCandidatesV3, MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3,
  MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3, routeModelResidualCandidatesV3,
  splitModelResidualCandidateEnvelopeV3, withModelResidualCandidateLaneV3 } from "../experiments/accuracy/model-residual-candidate-lane-v3.mjs";

const request = ARM_SPECS.thin_canonical_high.buildRequest({ imageUrls: ["https://contract.invalid/a"],
  model: "gpt-5.6-luna", effort: "none", imageDetail: "high" });
const beforePrompt = request.input[0].content.find((part) => part.type === "input_text").text;
const treatment = withModelResidualCandidateLaneV3(request, { enabled: true });
assert.equal(treatment.input[0].content.find((part) => part.type === "input_text").text, beforePrompt);
assert.equal(treatment.text.format.name, request.text.format.name);
assert.equal(Object.keys(treatment.text.format.schema.properties)[0], MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3);
assert.equal(treatment.text.format.schema.required[0], MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3);
assert.equal(treatment.text.format.schema.properties[MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3].maxItems,
  MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3);
assert.equal(MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3, 8);

const capture = captureModelResidualCandidatesV3({ [MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3]: [
  { text: "Topps Chrome Sapphire", role: "identity_phrase", region: "slab_label", basis: "printed_text" },
  { text: "Topps Chrome", role: "identity_phrase", region: "card_back", basis: "printed_text" },
  { text: "05/50", role: "exact_code", region: "card_front", basis: "printed_text" }
] }, { canonicalFields: { product: "Topps Chrome", serial: "5/50" } });
assert.deepEqual(capture.candidates.map((row) => row.text), ["Topps Chrome Sapphire", "05/50"]);
assert.equal(capture.field_updates && Object.keys(capture.field_updates).length, 0);
const routed = routeModelResidualCandidatesV3(capture);
assert.equal(routed.queues.identity_phrase.length, 1);
assert.equal(routed.queues.exact_code.length, 1);
assert.equal(routed.automatic_admission, false);
assert.deepEqual(captureModelResidualCandidatesV3({}).defects, ["required_candidate_array_missing"]);
assert.deepEqual(captureModelResidualCandidatesV3({ [MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3]: {} }).defects,
  ["candidate_source_not_array"]);
assert.deepEqual(captureModelResidualCandidatesV3({ [MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3]: [
  { text: "visible", role: "other_visible", region: "card_front", basis: "printed_text", extra: true }
] }).defects, ["invalid_row_shape:0"]);
const canonicalPayload = { recognition_status: "CONFIRMED", fields: { product: "Topps Chrome" },
  field_evidence: [], unresolved: [] };
const envelope = splitModelResidualCandidateEnvelopeV3({ [MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3]: [], ...canonicalPayload });
assert.deepEqual(envelope.canonical_payload, canonicalPayload);
const moduleSource = readFileSync(new URL("../experiments/accuracy/model-residual-candidate-lane-v3.mjs", import.meta.url), "utf8");
assert.doesNotMatch(moduleSource, /reviewed_blind_/i);
assert.doesNotMatch(moduleSource, /provider[_-]?call/i);
console.log("model-residual-candidate-lane-v3 tests passed");
