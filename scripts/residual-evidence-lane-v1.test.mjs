#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest
} from "../lib/listing/thin/canonical-fields.mjs";
import {
  RESIDUAL_EVIDENCE_LANE_V1_ANCHORS,
  RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS,
  RESIDUAL_EVIDENCE_LANE_V1_PROMPT_SUFFIX,
  RESIDUAL_EVIDENCE_LANE_V1_SCHEMA_PROPERTY,
  RESIDUAL_EVIDENCE_LANE_V1_TARGETS,
  buildResidualEvidenceLaneV1Prompt,
  buildResidualEvidenceLaneV1Schema,
  parseResidualEvidenceLaneV1,
  residualEvidenceLaneV1Enabled,
  toResidualEvidenceCandidateTraceV1,
  withResidualEvidenceLaneV1
} from "../lib/listing/thin/residual-evidence-lane-v1.mjs";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/residual-evidence-lane-v1-design.json", import.meta.url), "utf8"
));
assert.equal(fixture.prompt_suffix, RESIDUAL_EVIDENCE_LANE_V1_PROMPT_SUFFIX);
assert.deepEqual(fixture.property, RESIDUAL_EVIDENCE_LANE_V1_SCHEMA_PROPERTY);
assert.equal(fixture.max_items, RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS);

assert.equal(CANONICAL_FIELDS_SCHEMA.properties.residual_evidence, undefined,
  "the default canonical schema must remain untouched");
const treatmentSchema = buildResidualEvidenceLaneV1Schema(CANONICAL_FIELDS_SCHEMA);
assert.equal(treatmentSchema.properties.residual_evidence.maxItems, 4);
assert.deepEqual(treatmentSchema.properties.residual_evidence.items.required.sort(),
  Object.keys(treatmentSchema.properties.residual_evidence.items.properties).sort());
assert.deepEqual(treatmentSchema.properties.residual_evidence.items.properties.target.enum,
  [...RESIDUAL_EVIDENCE_LANE_V1_TARGETS]);
assert.deepEqual(treatmentSchema.properties.residual_evidence.items.properties.anchor.enum,
  [...RESIDUAL_EVIDENCE_LANE_V1_ANCHORS]);
assert.equal(CANONICAL_FIELDS_SCHEMA.properties.residual_evidence, undefined,
  "schema construction must not mutate the canonical object");
assert.throws(() => buildResidualEvidenceLaneV1Schema(treatmentSchema),
  /residual_evidence_already_present/);
assert.match(buildResidualEvidenceLaneV1Prompt("canonical"), /^canonical After canonical fields/);

const baseRequest = buildCanonicalFieldsRequest({
  imageUrls: ["https://example.invalid/front", "https://example.invalid/back"],
  model: "gpt-5.6-luna",
  effort: "none",
  maxOutputTokens: 4096,
  imageDetail: "high"
});
const disabled = withResidualEvidenceLaneV1(baseRequest);
assert.deepEqual(disabled, baseRequest);
assert.notEqual(disabled, baseRequest, "disabled mode still returns an isolation-safe clone");
const treatment = withResidualEvidenceLaneV1(baseRequest, { enabled: true });
assert.equal(treatment.text.format.name, "canonical_card_fields_residual_v1");
assert.ok(treatment.text.format.schema.required.includes("residual_evidence"));
assert.equal(treatment.input[0].content.filter(({ type }) => type === "input_image").length, 2);
assert.equal(treatment.max_output_tokens, 4096);
assert.equal(treatment.input.length, 1, "the lane must stay inside one Luna request");
assert.equal(baseRequest.text.format.schema.properties.residual_evidence, undefined,
  "request transformation must not mutate the control request");
assert.equal(residualEvidenceLaneV1Enabled({}), false);
assert.equal(residualEvidenceLaneV1Enabled({ LYNCA_EVAL_RESIDUAL_EVIDENCE_V1: "true" }), true);

const canonicalFields = {
  year: "2025",
  product: "Chrome",
  set: "",
  subjects: [],
  card_name: "",
  card_number: "",
  serial: "27/150",
  grammar: "standard",
  unreadable: [],
  low_confidence: []
};
const parsed = parseResidualEvidenceLaneV1({
  residual_evidence: [
    { text: "Topps Chrome Disney 100", target: "identity", anchor: "back_text" },
    { text: "027/150", target: "serial", anchor: "stamped_number" },
    { text: "Gold Refractor", target: "finish", anchor: "visual" },
    { text: "RC", target: "marker", anchor: "front_symbol" }
  ]
}, { canonicalFields });
assert.deepEqual(parsed.field_updates, {});
assert.equal(parsed.canonical_fields_unchanged, true);
assert.equal(parsed.candidates.length, 4);
assert.equal(parsed.replay_candidates.length, 3);
assert.ok(parsed.candidates.every(({ automatic_csm_admission }) => automatic_csm_admission === false));
assert.ok(parsed.candidates.every(({ automatic_renderer_admission }) => automatic_renderer_admission === false));
assert.equal(parsed.candidates.find(({ target }) => target === "serial").disposition,
  "same_value_format_candidate");
assert.equal(parsed.candidates.find(({ target }) => target === "finish").replay_eligible, false);
const spacedSerial = parseResidualEvidenceLaneV1({
  residual_evidence: [{ text: "027 / 150", target: "serial", anchor: "stamped_number" }]
}, { canonicalFields });
assert.equal(spacedSerial.candidates[0].disposition, "same_value_format_candidate");
assert.equal(spacedSerial.candidates[0].replay_eligible, true);

const serialConflict = parseResidualEvidenceLaneV1({
  residual_evidence: [{ text: "028/150", target: "serial", anchor: "stamped_number" }]
}, { canonicalFields });
assert.equal(serialConflict.candidates[0].reason, "serial_numeric_conflict");
assert.equal(serialConflict.replay_candidates.length, 0);
assert.deepEqual(serialConflict.field_updates, {});

const absentSerial = parseResidualEvidenceLaneV1({
  residual_evidence: [{ text: "027/150", target: "serial", anchor: "stamped_number" }]
}, { canonicalFields: { ...canonicalFields, serial: "" } });
assert.equal(absentSerial.candidates[0].reason, "absent_serial_cannot_self_verify");
assert.equal(absentSerial.replay_candidates.length, 0);

const tcgChecklist = parseResidualEvidenceLaneV1({
  residual_evidence: [{ text: "089/063", target: "card_number", anchor: "back_text" }]
}, { canonicalFields: { ...canonicalFields, grammar: "tcg", serial: "" } });
assert.equal(tcgChecklist.candidates[0].replay_eligible, true);
assert.deepEqual(tcgChecklist.candidates[0].candidate_brackets, ["card_number"]);

const standardSlashCardNumber = parseResidualEvidenceLaneV1({
  residual_evidence: [{ text: "089/063", target: "card_number", anchor: "back_text" }]
}, { canonicalFields: { ...canonicalFields, grammar: "standard", serial: "" } });
assert.equal(standardSlashCardNumber.candidates[0].replay_eligible, false);
assert.match(standardSlashCardNumber.candidates[0].reason, /^card_number_boundary_/);

const yearBoundaries = parseResidualEvidenceLaneV1({
  residual_evidence: [
    { text: "2026", target: "year", anchor: "back_text" },
    { text: "2026-27", target: "year", anchor: "slab_text" }
  ]
}, { canonicalFields: { ...canonicalFields, year: "" } });
assert.equal(yearBoundaries.candidates[0].replay_eligible, false);
assert.equal(yearBoundaries.candidates[1].replay_eligible, true);

const knowledge = parseResidualEvidenceLaneV1({
  residual_evidence: [{ text: "Lucky Hyper", target: "finish", anchor: "model_knowledge" }]
}, { canonicalFields });
assert.equal(knowledge.candidates[0].disposition, "candidate_only");
assert.equal(knowledge.candidates[0].replay_eligible, false);

const noiseAndDuplicate = parseResidualEvidenceLaneV1({
  residual_evidence: [
    { text: "Chrome", target: "identity", anchor: "front_text" },
    { text: "ALL RIGHTS RESERVED", target: "identity", anchor: "back_text" },
    { text: "Trainer Gallery", target: "card_name", anchor: "front_text" },
    { text: "trainer   gallery", target: "identity", anchor: "back_text" }
  ]
}, { canonicalFields });
assert.equal(noiseAndDuplicate.candidates.length, 1);
assert.deepEqual(noiseAndDuplicate.dropped.map(({ disposition }) => disposition).sort(), [
  "already_canonical", "rejected_duplicate", "rejected_noise"
]);

const invalid = parseResidualEvidenceLaneV1({ residual_evidence: [
  { text: "x", target: "identity", anchor: "front_text", canonical_value: "attack" },
  { text: "x", target: "field_not_in_csm", anchor: "front_text" },
  { text: "x", target: "identity", anchor: "internet" },
  null,
  { text: "overflow", target: "identity", anchor: "front_text" }
] }, { canonicalFields });
assert.deepEqual(invalid.defects, [
  "residual_v1_overflow:1",
  "residual_v1_extra_or_missing_property:0",
  "residual_v1_invalid_target:1",
  "residual_v1_invalid_anchor:2",
  "residual_v1_invalid_row:3"
]);
assert.equal(invalid.candidates.length, 0);

const oldCheckpoint = parseResidualEvidenceLaneV1({ year: "2025" }, { canonicalFields });
assert.equal(oldCheckpoint.source_present, false);
assert.deepEqual(oldCheckpoint.defects, []);
assert.deepEqual(oldCheckpoint.candidates, []);

const trace = toResidualEvidenceCandidateTraceV1({
  tenantId: "tenant-1",
  recognitionSessionId: "session-1",
  candidates: parsed.candidates
});
const traceAgain = toResidualEvidenceCandidateTraceV1({
  tenantId: "tenant-1",
  recognitionSessionId: "session-1",
  candidates: parsed.candidates
});
assert.deepEqual(trace, traceAgain, "candidate persistence ids must be deterministic");
assert.equal(trace.production_promoted, false);
assert.ok(trace.rows.every((row) => row.authority === "candidate_only"));
assert.ok(trace.rows.every((row) => row.automatic_csm_admission === false));
assert.ok(trace.rows.every((row) => row.automatic_renderer_admission === false));
const serialized = JSON.stringify(trace);
for (const forbidden of ["canonical_value", "selected_candidate_id", "can_apply", "field_updates"]) {
  assert.doesNotMatch(serialized, new RegExp(forbidden));
}
const bracketInjection = toResidualEvidenceCandidateTraceV1({
  recognitionSessionId: "session-1",
  candidates: [{
    ...parsed.candidates[0],
    candidate_brackets: ["grading_info"],
    canonical_value: "attack"
  }]
});
assert.deepEqual(bracketInjection.rows[0].candidate_brackets, ["product", "set", "ip_sport"]);
assert.doesNotMatch(JSON.stringify(bracketInjection), /canonical_value|grading_info|attack/);
assert.throws(() => toResidualEvidenceCandidateTraceV1({
  recognitionSessionId: "session-1",
  candidates: [{ ...parsed.candidates[0], target: "field_not_in_csm" }]
}), /invalid_trace_target:0/);
assert.throws(() => toResidualEvidenceCandidateTraceV1({
  recognitionSessionId: "session-1",
  candidates: [...parsed.candidates, parsed.candidates[0]]
}), /residual_trace_overflow/);

console.log("residual evidence lane v1: ok");
