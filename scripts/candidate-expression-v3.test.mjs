#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CANDIDATE_EXPRESSION_V3_MAX_FACTS,
  CANDIDATE_EXPRESSION_V3_PROMPT,
  CANDIDATE_EXPRESSION_V3_SCHEMA,
  CANDIDATE_EXPRESSION_V3_SCHEMA_NAME,
  CANDIDATE_EXPRESSION_V3_VERSION,
  buildCandidateExpressionV3Request,
  extractCandidateExpressionV3Payload,
  finishCandidateExpressionV3,
  parseCandidateExpressionV3
} from "../lib/listing/thin/candidate-expression-v3.mjs";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/candidate-expression-v3-response.json", import.meta.url),
  "utf8"
));

assert.deepEqual(
  [...CANDIDATE_EXPRESSION_V3_SCHEMA.required].sort(),
  Object.keys(CANDIDATE_EXPRESSION_V3_SCHEMA.properties).sort()
);
assert.equal(CANDIDATE_EXPRESSION_V3_SCHEMA.properties.product, undefined,
  "candidate-first v3 must not expose canonical product or any other CSM field");
const factSchema = CANDIDATE_EXPRESSION_V3_SCHEMA.properties.candidate_facts.items;
assert.deepEqual([...factSchema.required].sort(), Object.keys(factSchema.properties).sort());
assert.equal(CANDIDATE_EXPRESSION_V3_SCHEMA.properties.candidate_facts.maxItems,
  CANDIDATE_EXPRESSION_V3_MAX_FACTS);

const request = buildCandidateExpressionV3Request({
  imageUrls: ["https://example.invalid/front.jpg", "https://example.invalid/back.jpg"],
  model: "gpt-5.6-luna",
  effort: "none",
  imageDetail: "original"
});
assert.equal(request.text.format.name, CANDIDATE_EXPRESSION_V3_SCHEMA_NAME);
assert.equal(request.text.format.strict, true);
assert.deepEqual(request.input[0].content.filter(({ type }) => type === "input_image")
  .map(({ detail }) => detail), ["original", "original"]);
assert.match(CANDIDATE_EXPRESSION_V3_PROMPT, /not a title and not canonical fields/);
assert.match(CANDIDATE_EXPRESSION_V3_PROMPT, /model_knowledge/);
assert.match(CANDIDATE_EXPRESSION_V3_PROMPT, /proper noun merely because it appears inside copyright/);
assert.throws(() => buildCandidateExpressionV3Request({ imageDetail: "auto" }),
  /unsupported_image_detail:auto/);

const bodyPayload = extractCandidateExpressionV3Payload({
  output: [{ content: [{ text: JSON.stringify(fixture) }] }]
});
assert.deepEqual(JSON.parse(bodyPayload), fixture);

const parsed = parseCandidateExpressionV3(fixture);
assert.equal(parsed.candidate_defects.length, 0);
assert.equal(parsed.candidate_facts.length, 4);
assert.equal(parsed.candidate_facts[1].basis, "model_knowledge");
assert.equal(parsed.candidate_facts[1].image, "none");
assert.equal(parsed.candidate_facts[2].value, "07/10",
  "literal slash form and leading zero must survive parsing");

const finished = finishCandidateExpressionV3(fixture);
assert.equal(finished.candidate_schema_version, CANDIDATE_EXPRESSION_V3_VERSION);
assert.deepEqual(finished.candidate_facts, parsed.candidate_facts);
assert.equal(finished.fields, undefined);
assert.equal(finished.production_promoted, undefined);
assert.equal(finished.evidence_promotions, undefined);
assert.equal(finished.title, "",
  "candidate facts must never be copied into the harness title channel");
assert.equal(finished.length, 0);

const invalid = parseCandidateExpressionV3({
  candidate_facts: [
    { ...fixture.candidate_facts[1], image: "image_1" },
    { ...fixture.candidate_facts[1], uncertainty: "none" },
    { ...fixture.candidate_facts[2], image: "none" },
    { ...fixture.candidate_facts[1], kind: "finish" },
    fixture.candidate_facts[0],
    fixture.candidate_facts[0]
  ],
  unreadable_regions: []
});
assert.deepEqual(invalid.candidate_defects, [
  "candidate_v3_knowledge_provenance_invalid:0",
  "candidate_v3_knowledge_provenance_invalid:1",
  "candidate_v3_visible_image_missing:2",
  "candidate_v3_knowledge_kind_forbidden:3",
  "candidate_v3_duplicate:5"
]);
assert.equal(invalid.candidate_facts.length, 1);

const overflow = parseCandidateExpressionV3({
  candidate_facts: Array.from({ length: CANDIDATE_EXPRESSION_V3_MAX_FACTS + 1 }, (_, index) => ({
    ...fixture.candidate_facts[0], value: `Identity ${index}`
  })),
  unreadable_regions: []
});
assert.equal(overflow.candidate_facts.length, CANDIDATE_EXPRESSION_V3_MAX_FACTS);
assert.ok(overflow.candidate_defects.includes("candidate_v3_overflow:1"));

assert.deepEqual(parseCandidateExpressionV3("not json"), {
  candidate_facts: [], unreadable_regions: [], candidate_defects: ["candidate_v3_unparseable"]
});

console.log("candidate expression v3 tests passed");
