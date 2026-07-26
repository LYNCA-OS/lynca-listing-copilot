import assert from "node:assert/strict";
import {
  candidatePromptInjectionDisabled,
  vectorCandidatePromptSection
} from "../lib/listing/pipeline/provider-prompt.mjs";

const packet = { vector_retrieval: { candidates: [{ candidate_id: "c1" }], field_support: [] } };

// Default must be untouched: candidates still reach the prompt exactly as before.
assert.equal(candidatePromptInjectionDisabled({}), false);
assert.ok(vectorCandidatePromptSection(packet, {}).length > 0, "default must still inject");

// The B arm withholds the packet from the prompt. Retrieval and post-observation
// application are untouched -- only what the model is shown changes, which is
// what makes it a control for the confounded 0.80 vs 0.68 comparison.
const off = { DISABLE_CANDIDATE_PROMPT_INJECTION: "1" };
assert.equal(candidatePromptInjectionDisabled(off), true);
assert.equal(vectorCandidatePromptSection(packet, off), "");

// An absent packet is still the empty string either way.
assert.equal(vectorCandidatePromptSection(null, {}), "");
assert.equal(vectorCandidatePromptSection(null, off), "");

console.log("candidate prompt injection flag tests passed");
