import assert from "node:assert/strict";
import {
  CANDIDATE_EXPRESSION_V4_SCHEMA_NAME,
  buildCandidateExpressionV4Request,
  finishCandidateExpressionV4,
  parseCandidateExpressionV4
} from "../lib/listing/thin/candidate-expression-v4.mjs";

const request = buildCandidateExpressionV4Request({ imageUrls: ["https://signed.invalid/front"], model: "gpt-5.6-luna" });
assert.equal(request.text.format.name, CANDIDATE_EXPRESSION_V4_SCHEMA_NAME);
assert.equal(request.input[0].content.at(-1).detail, "high");
const parsed = parseCandidateExpressionV4(JSON.stringify({
  visible_facts: [
    { value: "Topps Chrome", kind: "identity", basis: "exact_text", image: "image_1", region: "card_front" },
    { value: "VeeFriends", kind: "affiliation", basis: "logo_or_symbol", image: "image_1", region: "card_back" }
  ],
  identity_hypotheses: [{ value: "Topps Chrome VeeFriends", basis: "visible_combination", evidence_values: ["Topps Chrome", "VeeFriends"] }],
  unreadable_regions: []
}));
assert.equal(parsed.candidate_defects.length, 0);
assert.equal(parsed.identity_hypotheses[0].value, "Topps Chrome VeeFriends");
const bad = parseCandidateExpressionV4(JSON.stringify({
  visible_facts: [{ value: "Topps", kind: "identity", basis: "exact_text", image: "image_1", region: "card_front" }],
  identity_hypotheses: [{ value: "VeeFriends", basis: "visible_combination", evidence_values: ["not-visible"] }],
  unreadable_regions: []
}));
assert.deepEqual(bad.identity_hypotheses, []);
assert.ok(bad.candidate_defects.includes("candidate_v4_hypothesis_evidence_missing:0"));
assert.equal(finishCandidateExpressionV4(JSON.stringify({ visible_facts: [], identity_hypotheses: [], unreadable_regions: [] })).title, "");
console.log("candidate expression v4 tests passed");
