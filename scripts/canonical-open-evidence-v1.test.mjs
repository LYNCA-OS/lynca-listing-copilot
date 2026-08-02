import assert from "node:assert/strict";
import {
  CANONICAL_OPEN_EVIDENCE_V1_SCHEMA,
  buildCanonicalOpenEvidenceV1Request,
  finishCanonicalOpenEvidenceV1,
  parseCanonicalOpenEvidenceV1
} from "../lib/listing/thin/canonical-open-evidence-v1.mjs";

const required = CANONICAL_OPEN_EVIDENCE_V1_SCHEMA.required;
assert.equal(new Set(required).size, required.length);
assert.ok(required.includes("candidate_facts"));
assert.equal(buildCanonicalOpenEvidenceV1Request({ model: "gpt-5.6-luna" }).text.format.name,
  "canonical_card_fields_open_evidence_v1");

const base = {
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", subjects: ["A"], team: "",
  card_name: "", release_variant: "", surface_color: "", parallel_family: "Refractor",
  parallel_exact: "", descriptive_rarity: "", card_number: "1", serial: "", attributes: [],
  grade: "", grammar: "standard", lot_count: "", language: "", unreadable: [], low_confidence: []
};
const parsed = parseCanonicalOpenEvidenceV1(JSON.stringify({
  ...base,
  candidate_facts: [{ value: "Topps Chrome VeeFriends", kind: "identity", basis: "exact_text", image: "image_2", region: "card_back", uncertainty: "none" }],
  unreadable_regions: []
}));
assert.equal(parsed.candidate_facts.length, 1);
assert.deepEqual(parsed.candidate_defects, []);

const knowledge = parseCanonicalOpenEvidenceV1(JSON.stringify({
  ...base,
  candidate_facts: [{ value: "VeeFriends", kind: "identity", basis: "model_knowledge", image: "image_1", region: "card_front", uncertainty: "none" }],
  unreadable_regions: []
}));
assert.equal(knowledge.candidate_facts.length, 0);
assert.deepEqual(knowledge.candidate_defects, ["candidate_fact_knowledge_provenance_invalid:0"]);

const finished = finishCanonicalOpenEvidenceV1(JSON.stringify({
  ...base,
  candidate_facts: [],
  unreadable_regions: []
}));
assert.equal(finished.title, "2025 Topps Chrome A Refractor");
assert.equal(finished.candidate_facts.length, 0);
console.log("canonical open evidence v1: ok");
