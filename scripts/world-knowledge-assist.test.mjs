import assert from "node:assert/strict";

import {
  buildWorldKnowledgeAssistInput,
  buildWorldKnowledgePrompt,
  runWorldKnowledgeAssist,
  validateWorldKnowledgeProposal,
  worldKnowledgeAssistContract,
  worldKnowledgeProposalSchema
} from "../lib/listing/knowledge/world-knowledge-assist.mjs";

const input = buildWorldKnowledgeAssistInput({
  observationSnapshot: {
    year: "2008",
    manufacturer: "Panini",
    sport: "basketball",
    set: "Contours",
    players: ["Kobe Bryant"],
    product: "MUST_NOT_PASS",
    team: "MUST_NOT_PASS",
    raw_ocr_text: "MUST_NOT_PASS",
    final_title: "MUST_NOT_PASS"
  },
  forwardEnumerationTrace: [
    {
      field: "product",
      status: "UNKNOWN",
      reason: "set_not_in_model",
      provenance: { version: "constraints-v1", rule_id: "set_not_in_model" }
    },
    {
      field: "team",
      status: "VALUE",
      value: "Los Angeles Lakers",
      provenance: { version: "constraints-v1", rule_id: "year_narrows_to_one_team" }
    }
  ],
  routeInputHash: "a".repeat(64)
});

assert.equal(input.schema_version, "world-knowledge-assist-input-v1");
assert.deepEqual(input.target_fields, ["product"]);
assert.equal(input.observed_facts.year, "2008");
assert.equal(Object.hasOwn(input.observed_facts, "product"), false);
assert.equal(Object.hasOwn(input.observed_facts, "team"), false);
assert.equal(Object.hasOwn(input.observed_facts, "raw_ocr_text"), false);
assert.equal(Object.hasOwn(input.observed_facts, "final_title"), false);
assert.equal(input.unresolved_targets[0].constraint_status, "UNKNOWN");
assert.equal(input.budget.max_paid_calls, 1);
assert.match(input.input_hash, /^[a-f0-9]{64}$/);

const noUnknown = buildWorldKnowledgeAssistInput({
  observationSnapshot: { year: "2024", players: ["Pikachu"] },
  forwardEnumerationTrace: [{ field: "team", status: "EMPTY" }]
});
assert.deepEqual(noUnknown.target_fields, []);
assert.equal(noUnknown.budget.max_paid_calls, 0);

const schema = worldKnowledgeProposalSchema(input.target_fields);
assert.equal(schema.additionalProperties, false);
assert.deepEqual(schema.properties.proposals.items.properties.field.enum, ["product"]);
assert.match(buildWorldKnowledgePrompt(input), /do not identify the card/);
assert.doesNotMatch(buildWorldKnowledgePrompt(input), /MUST_NOT_PASS/);

const validated = validateWorldKnowledgeProposal({
  proposals: [{ field: "product", value: "Panini Contours", rank: 1 }],
  abstentions: []
}, input);
assert.equal(validated.proposals[0].source_type, "MODEL_WORLD_KNOWLEDGE");
assert.equal(validated.proposals[0].source_trust, "HEURISTIC_MODEL_PRIOR");
assert.equal(validated.proposals[0].permission, "QUERY_EXPANSION_ONLY");
assert.equal(validated.proposals[0].validation_status, "UNVERIFIED");
assert.equal(validated.resolver_effect, "NONE");
assert.equal(validated.title_effect, "NONE");

assert.throws(
  () => validateWorldKnowledgeProposal({
    proposals: [{ field: "product", value: "Panini Contours", rank: 1, source_trust: "OFFICIAL_FACT" }],
    abstentions: []
  }, input),
  /forbidden_field/
);
assert.throws(
  () => validateWorldKnowledgeProposal({
    proposals: [{ field: "team", value: "Lakers", rank: 1 }],
    abstentions: []
  }, input),
  /proposal_invalid/
);
assert.throws(
  () => validateWorldKnowledgeProposal({ proposals: [], abstentions: [] }, input),
  /target_outcome_invalid_product/
);

const skipped = await runWorldKnowledgeAssist({ input: noUnknown });
assert.equal(skipped.execution_status, "SKIPPED");
assert.equal(skipped.paid_provider_calls, 0);

let request = null;
const executed = await runWorldKnowledgeAssist({
  input,
  env: { OPENAI_API_KEY: "sk-test-not-real", OPENAI_LISTING_MODEL: "gpt-5-mini" },
  fetchImpl: async (_url, init) => {
    request = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_world",
        model: "gpt-5-mini",
        status: "completed",
        output_text: JSON.stringify({
          proposals: [{ field: "product", value: "Panini Contours", rank: 1 }],
          abstentions: []
        }),
        usage: { input_tokens: 120, output_tokens: 24, total_tokens: 144 }
      })
    };
  }
});
assert.equal(request.store, false);
assert.equal(request.input[0].content.length, 1);
assert.equal(executed.execution_status, "COMPLETED");
assert.equal(executed.paid_provider_calls, 1);
assert.equal(executed.output.permission, "QUERY_EXPANSION_ONLY");
assert.equal(executed.output.proposals[0].source_trust, "HEURISTIC_MODEL_PRIOR");
assert.equal(executed.resolver_access, "DENIED");
assert.equal(executed.title_access, "DENIED");
assert.equal("content" in executed, false);

assert.equal(worldKnowledgeAssistContract.candidate_support, "DENIED_WITHOUT_INDEPENDENT_CORROBORATION");

console.log("world knowledge assist tests passed");
