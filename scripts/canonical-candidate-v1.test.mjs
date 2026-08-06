import assert from "node:assert/strict";
import {
  CANONICAL_CANDIDATE_V1_SCHEMA,
  CANONICAL_CANDIDATE_V1_PROMPT,
  buildCanonicalCandidateV1Request,
  finishCanonicalCandidateV1,
  parseCanonicalCandidateV1
} from "../lib/listing/thin/canonical-candidate-v1.mjs";

const canonical = {
  year: "2025", manufacturer: "Panini", product: "Prizm", set: "FIFA",
  subjects: ["Lautaro Martinez"], team: "", card_name: "Talismen",
  release_variant: "", surface_color: "Orange", parallel_family: "Prizm",
  parallel_exact: "Orange Prizm", descriptive_rarity: "", card_number: "6",
  serial: "", attributes: [], grade: "", grammar: "standard", lot_count: "",
  language: "", unreadable: [], low_confidence: []
};
const raw = JSON.stringify({
  ...canonical,
  visible_facts: [
    { value: "FIFA", kind: "identity", basis: "logo_or_symbol", image: "image_1", region: "card_front" }
  ],
  identity_hypotheses: [{ value: "Panini Prizm FIFA", basis: "visible_combination", evidence_values: ["FIFA"] }],
  unreadable_regions: []
});

const request = buildCanonicalCandidateV1Request({ model: "gpt-5.6-luna", imageUrls: ["data:image/jpeg;base64,AA=="] });
assert.equal(request.text.format.name, "canonical_card_fields_with_candidates_v1");
assert.ok(request.text.format.schema.required.includes("language"));
assert.ok(request.text.format.schema.required.includes("visible_facts"));
assert.match(request.input[0].content[0].text, /non-authoritative/);
assert.equal(CANONICAL_CANDIDATE_V1_SCHEMA.additionalProperties, false);
assert.ok(CANONICAL_CANDIDATE_V1_PROMPT.length > 100);

const parsed = parseCanonicalCandidateV1(raw);
assert.equal(parsed.fields.product, "Prizm");
assert.equal(parsed.candidate_facts[0].value, "FIFA");
assert.equal(parsed.candidate_hypotheses[0].basis, "visible_combination");
assert.equal(parsed.authority, "evaluation_only");

const finished = finishCanonicalCandidateV1(raw);
assert.match(finished.title, /Lautaro/);
assert.equal(finished.candidate_facts.length, 1);
assert.equal(finished.production_promoted, false);
console.log("canonical candidate v1: ok");
