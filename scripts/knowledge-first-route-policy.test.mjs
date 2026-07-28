import assert from "node:assert/strict";

import {
  knowledgeFirstRoutes,
  planKnowledgeFirstRecognition
} from "../lib/listing/v4/route-planner/knowledge-first-route-policy.mjs";

function evidence(resolved = {}, evidence = {}) {
  return { resolved, evidence };
}

const replay = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  higherAuthorityRoute: "WRITER_FINAL_REPLAY"
});
assert.equal(replay.route, knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL);
assert.equal(replay.model_call_budget, 0);
assert.equal(replay.full_provider_required, false);
assert.equal(replay.production_effect, "SHADOW_ONLY");
assert.equal(replay.production_action, "RUN_FULL_PROVIDER");
assert.equal(replay.counterfactual_action, knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL);

const exactAnchor = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  exactAnchorShadow: { eligible: true }
});
assert.equal(exactAnchor.route, knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL);
assert.equal(exactAnchor.higher_authority_route, "EXACT_ANCHOR_FINAL");

const deterministic = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: evidence({
    year: "2025",
    manufacturer: "Panini",
    players: ["Victor Wembanyama"],
    card_name: "Fade To Black",
    product: "Phoenix"
  })
});
assert.equal(deterministic.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(deterministic.model_call_budget, 0);

const targeted = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: evidence({ manufacturer: "Panini" })
});
assert.equal(targeted.route, knowledgeFirstRoutes.TARGETED_VISUAL_AND_KNOWLEDGE);
assert.deepEqual(targeted.visual_field_targets, ["year", "players", "card_name_or_insert_or_code"]);
assert.deepEqual(targeted.knowledge_field_targets, ["product"]);
assert.equal(targeted.model_call_budget, 1);
assert.equal(targeted.complete_title_output_allowed, false);

const knowledgeOnly = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: evidence({
    year: "2025",
    manufacturer: "Panini",
    players: ["Victor Wembanyama"],
    set: "Fade To Black"
  })
});
assert.equal(knowledgeOnly.route, knowledgeFirstRoutes.KNOWLEDGE_ASSIST);
assert.deepEqual(knowledgeOnly.knowledge_field_targets, ["product"]);
assert.equal(knowledgeOnly.image_policy, "NONE");

const noImage = planKnowledgeFirstRecognition({ usableImageCount: 0 });
assert.equal(noImage.route, knowledgeFirstRoutes.WRITER_REVIEW);
assert.equal(noImage.model_call_budget, 0);

console.log("knowledge-first route policy tests passed");
