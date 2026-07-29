import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  attachWorldKnowledgeShadowAssistInput,
  buildWorldKnowledgeShadowAssistInput,
  worldKnowledgeObservationContract,
  worldKnowledgeShadowAssistContract,
  worldKnowledgeShadowAssistRequested
} from "../lib/listing/knowledge/world-knowledge-layer.mjs";
import {
  providerReadOnlyOutputShape,
  readOnlyV4RecognitionPrompt
} from "../lib/listing/pipeline/provider-prompt.mjs";
import {
  analyzeCardEvidenceWithOpenAiEmergency,
  expandOpenAiUltraCompactProviderPayload,
  openAiReadOnlyProviderResponseSchema
} from "../lib/listing/providers/openai-emergency-provider.mjs";
import { providerReadFieldNamesByType } from "../lib/listing/providers/provider-output-field-contract.mjs";

const evaluationOptions = {
  v4_read_only_provider_contract: true,
  v4_world_knowledge_proposals: true,
  recognition_benchmark_profile: "cold_algorithm_benchmark",
  trace_level: "evaluation"
};

assert.equal(worldKnowledgeShadowAssistContract.mode, "POST_OBSERVATION_SHADOW_ONLY");
assert.equal(worldKnowledgeShadowAssistContract.observation_contract, "read_only_sparse_v4");
assert.equal(worldKnowledgeShadowAssistContract.paid_provider_call_allowed, false);
assert.equal(worldKnowledgeShadowAssistContract.resolver_access, "DENIED");
assert.equal(worldKnowledgeShadowAssistContract.title_access, "DENIED");
const providerReadFields = new Set(["string", "boolean", "number", "list"]
  .flatMap((type) => providerReadFieldNamesByType(type)));
assert.ok(worldKnowledgeShadowAssistContract.allowed_input_fields.every((field) => providerReadFields.has(field)));
assert.equal(worldKnowledgeShadowAssistRequested({ provider_options: evaluationOptions }, {}), true);
assert.equal(worldKnowledgeShadowAssistRequested({
  provider_options: { ...evaluationOptions, v4_read_only_provider_contract: false }
}, {}), false);
assert.equal(worldKnowledgeShadowAssistRequested({
  provider_options: { ...evaluationOptions, recognition_benchmark_profile: "production_workload" }
}, {}), false);

const baselinePayload = {
  images: [{ name: "front.jpg" }, { name: "back.jpg" }],
  provider_options: {
    v4_read_only_provider_contract: true,
    recognition_benchmark_profile: "cold_algorithm_benchmark",
    trace_level: "evaluation"
  }
};
const requestedPayload = {
  ...baselinePayload,
  provider_options: evaluationOptions
};
assert.equal(
  readOnlyV4RecognitionPrompt(requestedPayload, 80),
  readOnlyV4RecognitionPrompt(baselinePayload, 80),
  "requesting world knowledge must not change the visual observation prompt"
);
assert.equal(
  createHash("sha256").update(readOnlyV4RecognitionPrompt(baselinePayload, 80)).digest("hex"),
  "c8824b9c18b493f9ec2de47e1ee46c29ff73967423663cd098e5a8f617911d6f",
  "read_only_sparse_v4 keeps the measured read_only_sparse_v3 prompt while enforcing the v4 schema"
);
assert.deepEqual(providerReadOnlyOutputShape(), {
  r: "CONFIRMED | RESOLVED | ABSTAIN",
  v: {
    s: [{ f: "year", v: "2024-25" }],
    b: [{ f: "auto", v: true }],
    n: [{ f: "card_count", v: 2 }],
    l: [{ f: "players", v: ["Player Name"] }]
  },
  e: [{ f: "print_run_number", v: "14/99", s: "CARD_FRONT_PRINTED_TEXT", i: "image_1", t: "14/99" }],
  u: []
});
const schema = openAiReadOnlyProviderResponseSchema();
assert.deepEqual(schema.required, ["r", "v", "e", "u"]);
assert.equal(Object.hasOwn(schema.properties, "k"), false);
assert.equal(
  createHash("sha256").update(JSON.stringify(schema)).digest("hex"),
  "a054b37c7365893a4fd509645c75f5982528e22adf2a26573a07d29bae357192",
  "read_only_sparse_v4 response schema must remain byte-identical after Task A"
);

const expanded = expandOpenAiUltraCompactProviderPayload({
  r: "CONFIRMED",
  v: { s: [], b: [], n: [], l: [] },
  e: [],
  u: [],
  k: [{ f: "team", v: "Lakers", b: "KNOWN" }]
});
assert.equal(Object.hasOwn(expanded, "world_knowledge_proposals"), false);

const observationResult = {
  raw_provider_fields: {
    year: "2008",
    manufacturer: "Panini",
    set: "Contours",
    players: ["Kobe Bryant"],
    product: "Phoenix",
    team: "Lakers"
  },
  resolved: {
    product: "Prizm",
    team: "Celtics"
  },
  unresolved: ["product"],
  forward_enumeration_trace: [
    { field: "product", status: "UNKNOWN", reason: "set_not_in_model" },
    { field: "team", status: "VALUE", value: "Los Angeles Lakers", reason: "year_narrows_to_one_team" }
  ]
};
const shadowInput = buildWorldKnowledgeShadowAssistInput(observationResult);
assert.equal(shadowInput.input.schema_version, worldKnowledgeObservationContract);
assert.deepEqual(shadowInput.input.fields, {
  year: "2008",
  manufacturer: "Panini",
  set: "Contours",
  players: ["Kobe Bryant"]
});
assert.equal(Object.hasOwn(shadowInput.input.fields, "product"), false);
assert.equal(Object.hasOwn(shadowInput.input.fields, "team"), false);
assert.deepEqual(shadowInput.input.target_fields, ["product"]);
assert.deepEqual(shadowInput.input.unresolved_targets, [{
  field: "product",
  status: "UNKNOWN",
  reason_code: "set_not_in_model"
}]);
assert.equal(shadowInput.execution_status, "NOT_RUN");
assert.equal(shadowInput.paid_provider_calls, 0);
assert.equal(shadowInput.output, null);
assert.match(shadowInput.input_hash, /^[0-9a-f]{64}$/);

const attached = attachWorldKnowledgeShadowAssistInput(observationResult, { requested: true });
assert.equal(attached.world_knowledge_shadow_assist.resolver_effect, "NONE");
assert.equal(attached.world_knowledge_shadow_assist.title_effect, "NONE");
assert.equal(Object.hasOwn(attached, "world_knowledge"), false);
assert.equal(attachWorldKnowledgeShadowAssistInput(observationResult), observationResult);

let paidCallAttempted = false;
await assert.rejects(
  analyzeCardEvidenceWithOpenAiEmergency({
    images: [],
    prompt: "must not run",
    responseProfile: "read_only_world_knowledge_v1",
    fetchImpl: async () => {
      paidCallAttempted = true;
      throw new Error("unexpected fetch");
    }
  }),
  /Mixed visual-observation and world-knowledge responses are disabled/
);
assert.equal(paidCallAttempted, false);

console.log("world knowledge shadow isolation tests passed");
