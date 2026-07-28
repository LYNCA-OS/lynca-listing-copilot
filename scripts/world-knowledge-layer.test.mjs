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
  player_teams: { "kobe bryant": ["Lakers"] },
  player_team_years: { "kobe bryant": { 2008: ["Lakers"] } },
  set_product_years: { contours: ["2025|Panini Phoenix"] }
};

assert.equal(validateWorldKnowledgeProposal(
  { field: "team", value: "Lakers", basis: "KNOWN" },
  { players: ["Kobe Bryant"], year: "2008" },
  model
).disposition, "ACCEPTED");

assert.equal(validateWorldKnowledgeProposal(
  { field: "team", value: "Celtics", basis: "KNOWN" },
  { players: ["Kobe Bryant"], year: "2008" },
  model
).disposition, "REFUTED");

assert.equal(validateWorldKnowledgeProposal(
  { field: "team", value: "Inter Miami", basis: "KNOWN" },
  { players: ["Lionel Messi"], year: "2024" },
  model
).disposition, "UNCHECKED");

const attached = attachWorldKnowledgeProposals({
  fields: { players: ["Kobe Bryant"], year: "2008", set: "Contours" },
  world_knowledge_proposals: [
    { field: "team", value: "Lakers", basis: "KNOWN" },
    { field: "product", value: "Panini Phoenix", basis: "KNOWN" }
  ]
}, model, { enabled: true });
assert.equal(attached.world_knowledge.accepted_count, 2);
assert.equal(attached.world_knowledge.identity_evidence_items.length, 2);
assert.ok(attached.world_knowledge.identity_evidence_items.every((item) => item.metadata.candidate_is_evidence_not_truth));

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
