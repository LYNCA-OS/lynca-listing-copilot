import assert from "node:assert/strict";

import {
  attachWorldKnowledgeProposals,
  validateWorldKnowledgeProposal
} from "../lib/listing/knowledge/world-knowledge-layer.mjs";
import {
  providerReadOnlyOutputShape,
  readOnlyV4RecognitionPrompt
} from "../lib/listing/pipeline/provider-prompt.mjs";
import {
  expandOpenAiUltraCompactProviderPayload,
  openAiWorldKnowledgeProviderResponseSchema
} from "../lib/listing/providers/openai-emergency-provider.mjs";

const model = {
  schema_version: "test-constraint-model-v1",
  team_value_contract: {
    schema_version: "team-identity-semantics-v1",
    semantic_values_validated: true,
    subject_coverage_exhaustive: true
  },
  player_teams: { "kobe bryant": ["Lakers"] },
  player_team_years: { "kobe bryant": { 2008: ["Lakers"] } },
  set_product_years: { contours: ["2008|Panini Phoenix"] }
};

assert.equal(validateWorldKnowledgeProposal(
  { field: "team", value: "Lakers", basis: "KNOWN" },
  { players: ["Kobe Bryant"], year: "2008", sport: "basketball" },
  model
).disposition, "ACCEPTED");

assert.equal(validateWorldKnowledgeProposal(
  { field: "team", value: "Celtics", basis: "KNOWN" },
  { players: ["Kobe Bryant"], year: "2008", sport: "basketball" },
  model
).disposition, "REFUTED");

assert.equal(validateWorldKnowledgeProposal(
  { field: "team", value: "Inter Miami", basis: "KNOWN" },
  { players: ["Lionel Messi"], year: "2024", sport: "soccer" },
  model
).disposition, "UNCHECKED");

assert.deepEqual(validateWorldKnowledgeProposal(
  { field: "product", value: "Prizm?", basis: "KNOWN" },
  {},
  model
), {
  field: "product",
  value: "Prizm?",
  basis: "KNOWN",
  disposition: "INVALID",
  checked: false,
  reason: "uncertain_proposal_value"
});

assert.equal(validateWorldKnowledgeProposal(
  { field: "product", value: "Rookie Signs insert", basis: "KNOWN" },
  {},
  model
).disposition, "INVALID");

assert.equal(validateWorldKnowledgeProposal(
  { field: "product", value: "Panini Phoenix", basis: "KNOWN" },
  { set: "Contours", year: "2024", manufacturer: "Panini" },
  model
).disposition, "UNCHECKED");

assert.equal(validateWorldKnowledgeProposal(
  { field: "product", value: "Panini Phoenix", basis: "KNOWN" },
  { set: "Contours", year: "2008", manufacturer: "Topps" },
  model
).disposition, "UNCHECKED");

assert.equal(validateWorldKnowledgeProposal(
  { field: "team", value: "Lakers", basis: "KNOWN" },
  { players: ["Kobe Bryant"], year: "2008", sport: "basketball" },
  { ...model, team_value_contract: undefined }
).disposition, "UNCHECKED");

const attached = attachWorldKnowledgeProposals({
  fields: {
    players: ["Kobe Bryant"],
    year: "2008",
    sport: "basketball",
    manufacturer: "Panini",
    set: "Contours"
  },
  world_knowledge_proposals: [
    { field: "team", value: "Lakers", basis: "KNOWN" },
    { field: "product", value: "Panini Phoenix", basis: "KNOWN" }
  ]
}, model, { enabled: true });
assert.equal(attached.world_knowledge.accepted_count, 2);
assert.equal(attached.world_knowledge.identity_evidence_items.length, 2);
assert.ok(attached.world_knowledge.identity_evidence_items.every((item) => item.metadata.candidate_is_evidence_not_truth));

const uncheckedStaysTraceOnly = attachWorldKnowledgeProposals({
  fields: {
    players: ["Caleb Williams"],
    year: "2024",
    manufacturer: "Panini",
    set: "Rookies"
  },
  world_knowledge_proposals: [
    { field: "product", value: "Prizm", basis: "KNOWN" },
    { field: "team", value: "Chicago Bears", basis: "KNOWN" }
  ]
}, null, { enabled: true });
assert.equal(uncheckedStaysTraceOnly.world_knowledge.unchecked_count, 2);
assert.equal(uncheckedStaysTraceOnly.world_knowledge.trace_only_count, 2);
assert.equal(uncheckedStaysTraceOnly.world_knowledge.evidence_eligible_count, 0);
assert.deepEqual(uncheckedStaysTraceOnly.world_knowledge.identity_evidence_items, []);

const selfLabelledObservationStaysTraceOnly = attachWorldKnowledgeProposals({
  fields: { players: ["Caleb Williams"], year: "2024" },
  world_knowledge_proposals: [
    { field: "team", value: "Chicago Bears", basis: "OBSERVED" }
  ]
}, model, { enabled: true });
assert.equal(selfLabelledObservationStaysTraceOnly.world_knowledge.unchecked_count, 1);
assert.equal(
  selfLabelledObservationStaysTraceOnly.world_knowledge.decisions[0].reason,
  "observed_proposal_lacks_direct_evidence"
);
assert.deepEqual(selfLabelledObservationStaysTraceOnly.world_knowledge.identity_evidence_items, []);

assert.equal(Object.hasOwn(providerReadOnlyOutputShape(), "k"), false);
assert.equal(providerReadOnlyOutputShape({ includeWorldKnowledge: true }).k.length, 1);
const prompt = readOnlyV4RecognitionPrompt({
  images: [],
  provider_options: {
    v4_read_only_provider_contract: true,
    v4_world_knowledge_proposals: true,
    recognition_benchmark_profile: "cold_algorithm_benchmark",
    trace_level: "evaluation"
  }
}, 80);
assert.match(prompt, /Surface-mark safety: never infer RC/);
assert.match(prompt, /k may contain only team or product/);

const schema = openAiWorldKnowledgeProviderResponseSchema();
assert.ok(schema.required.includes("k"));
assert.deepEqual(schema.properties.k.items.properties.b.enum, ["OBSERVED", "KNOWN"]);

const expanded = expandOpenAiUltraCompactProviderPayload({
  r: "CONFIRMED",
  v: { s: [], b: [], n: [], l: [] },
  e: [],
  u: [],
  k: [{ f: "team", v: "Lakers", b: "KNOWN" }]
});
assert.deepEqual(expanded.world_knowledge_proposals, [
  { field: "team", value: "Lakers", basis: "KNOWN" }
]);

console.log("world knowledge layer tests passed");
