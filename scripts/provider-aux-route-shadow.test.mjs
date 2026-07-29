#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  expandProviderAuxVisualFieldTargets,
  planProviderAuxRouteShadow,
  providerAuxRoutes,
  withObservedProviderAuxRoute
} from "../lib/listing/v4/route-planner/provider-aux-route-shadow.mjs";

const cutoff = "2026-07-29T00:00:00.000Z";
const decided = "2026-07-29T00:00:00.001Z";

function route(decision, options = {}) {
  return planProviderAuxRouteShadow({
    knowledgeFirstDecision: {
      production_effect: "SHADOW_ONLY",
      production_action: "RUN_FULL_PROVIDER",
      reason_codes: [],
      visual_field_targets: [],
      knowledge_field_targets: [],
      ...decision
    },
    usableImageCount: 2,
    decisionEvidenceCutoffAt: cutoff,
    routeDecidedAt: decided,
    includeReplayInput: true,
    ...options
  });
}

const deterministic = route({ route: "DETERMINISTIC_FINAL" });
assert.equal(deterministic.route, providerAuxRoutes.FAST_DETERMINISTIC);
assert.equal(deterministic.max_model_call_budget, 0);
assert.equal(deterministic.full_provider_role, "AUXILIARY_FALLBACK_ONLY");
assert.equal(deterministic.production_effect, "SHADOW_ONLY");

const targeted = route({
  route: "TARGETED_VISUAL_AND_KNOWLEDGE",
  reason_codes: ["VISIBLE_FIELDS_UNKNOWN", "KNOWLEDGE_FIELDS_UNKNOWN"],
  visual_field_targets: ["year", "players"],
  knowledge_field_targets: ["product", "team"],
  image_policy: "PRIMARY_PLUS_RELEVANT_CROPS_ONLY"
});
assert.equal(targeted.route, providerAuxRoutes.TARGETED_MODEL_ASSIST);
assert.equal(targeted.targeted_executor_status, "EVALUATION_ONLY");
assert.equal(targeted.initial_model_call_budget, 1);
assert.equal(targeted.conditional_model_call_budget, 1);
assert.equal(targeted.max_model_call_budget, 2);
assert.deepEqual(targeted.assist_sequence.map((stage) => stage.stage), [
  "TARGETED_VISUAL_OBSERVATION",
  "RECOMPUTE_CONSTRAINTS",
  "WORLD_KNOWLEDGE_ASSIST"
]);
assert.equal(targeted.assist_sequence[0].image_access, "PRIMARY_PLUS_RELEVANT_CROPS_ONLY");
assert.equal(targeted.assist_sequence[2].image_access, "DENIED");
assert.equal(targeted.assist_sequence[2].resolver_effect, "NONE");
assert.equal(targeted.assist_sequence[2].title_effect, "NONE");
assert.equal(targeted.activation_eligible, false);
assert.ok(targeted.activation_blockers.includes("TARGETED_EXECUTOR_EVALUATION_ONLY"));

const expandedLiteralTargets = [
  "year",
  "card_name",
  "insert",
  "set",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "card_number"
];
assert.deepEqual(
  expandProviderAuxVisualFieldTargets(["year", "card_name_or_insert_or_code", "year"]),
  expandedLiteralTargets
);
assert.throws(
  () => expandProviderAuxVisualFieldTargets(["product"]),
  /provider auxiliary visual target must be READ: product/
);

const expandedTargeted = route({
  route: "TARGETED_VISUAL_ASSIST",
  reason_codes: ["VISIBLE_FIELDS_UNKNOWN"],
  visual_field_targets: ["year", "card_name_or_insert_or_code"],
  evidence_snapshot: {
    year: "2024",
    manufacturer: "Panini",
    players: ["Unsafe Subject"],
    field_states: {
      year: "PUBLISHABLE",
      manufacturer: "PUBLISHABLE",
      players: "UNTRUSTED_PROVENANCE"
    }
  },
  image_policy: "RELEVANT_CROPS_ONLY"
});
assert.deepEqual(expandedTargeted.visual_field_targets, expandedLiteralTargets);
assert.deepEqual(expandedTargeted.visual_requirement_targets, ["year", "card_name_or_insert_or_code"]);
assert.deepEqual(expandedTargeted.target_fields, expandedLiteralTargets);
assert.deepEqual(expandedTargeted.assist_sequence[0].target_fields, expandedLiteralTargets);
assert.deepEqual(expandedTargeted.assist_sequence[0].required_targets, ["year", "card_name_or_insert_or_code"]);
assert.deepEqual(expandedTargeted.publishable_known_fields, {
  year: "2024",
  manufacturer: "Panini"
});

const enumerationDeferred = route({
  route: "TARGETED_VISUAL_ASSIST",
  reason_codes: ["VISIBLE_FIELDS_UNKNOWN", "FORWARD_ENUMERATION_REQUIRED"],
  visual_field_targets: ["year", "players"],
  knowledge_field_targets: [],
  evidence_snapshot: { product: null, team: null },
  image_policy: "RELEVANT_CROPS_ONLY"
});
assert.deepEqual(enumerationDeferred.knowledge_field_targets, ["product", "team"]);
assert.deepEqual(enumerationDeferred.assist_sequence.map((stage) => stage.stage), [
  "TARGETED_VISUAL_OBSERVATION",
  "RECOMPUTE_CONSTRAINTS",
  "WORLD_KNOWLEDGE_ASSIST"
]);
assert.equal(enumerationDeferred.max_model_call_budget, 2);

const conflict = route({
  route: "WRITER_REVIEW",
  reason_codes: ["EVIDENCE_CONFLICT_OR_NOT_APPLICABLE", "BLOCKED_year"]
});
assert.equal(conflict.route, providerAuxRoutes.FULL_PROVIDER_FALLBACK);
assert.equal(conflict.image_policy, "FULL_CARD");
assert.equal(conflict.max_model_call_budget, 1);
assert.equal(conflict.terminal_disposition, null);

const noImage = route({
  route: "WRITER_REVIEW",
  reason_codes: ["NO_USABLE_IMAGE", "MODEL_CANNOT_REPAIR_MISSING_INPUT"]
}, { usableImageCount: 0 });
assert.equal(noImage.route, null);
assert.equal(noImage.decision_status, "INELIGIBLE");
assert.equal(noImage.terminal_disposition, "WRITER_REVIEW");
assert.equal(noImage.max_model_call_budget, 0);

const replay = route({
  route: "HIGHER_AUTHORITY_FINAL",
  higher_authority_route: "WRITER_FINAL_REPLAY"
}, { higherAuthorityRoute: "WRITER_FINAL_REPLAY" });
assert.equal(replay.route, providerAuxRoutes.FAST_DETERMINISTIC);
assert.equal(replay.input_class, "EXACT_REPLAY");

const providerTainted = route({ route: "TARGETED_VISUAL_ASSIST" }, {
  evidenceDocument: {
    evidence: {
      year: {
        value: "2025",
        sources: [{
          source_type: "VISION_MODEL",
          observed_text: "2025",
          available_at: "2026-07-28T23:59:59.000Z"
        }]
      }
    }
  }
});
assert.equal(providerTainted.provider_derived_field_count, 1);
assert.ok(providerTainted.activation_blockers.includes("PROVIDER_DERIVED_INPUT_FORBIDDEN"));

const observed = withObservedProviderAuxRoute(targeted, {
  providerCalls: 1,
  providerCallSkipped: false
});
assert.equal(observed.observed_production_action, "RUN_FULL_PROVIDER");
assert.equal(observed.observed_provider_calls, 1);
assert.equal(observed.observed_provider_call_skipped, false);
const targetedObserved = withObservedProviderAuxRoute(targeted, {
  providerCalls: 1,
  providerCallSkipped: false,
  targetedAssistExecution: {
    final_observation_owner: "TARGETED_VISUAL_OBSERVATION",
    fallback_reason_code: null,
    provider_call_ledger: [{
      logical_stage: "TARGETED_VISUAL_OBSERVATION",
      provider_calls: 1,
      started_at: "2026-07-29T00:00:00.002Z"
    }]
  }
});
assert.equal(targetedObserved.observed_production_action, "RUN_TARGETED_VISUAL_PROVIDER");
assert.equal(targetedObserved.observed_targeted_visual_provider_calls, 1);
assert.equal(targetedObserved.observed_full_provider_calls, 0);
assert.equal(targetedObserved.observed_final_observation_owner, "TARGETED_VISUAL_OBSERVATION");
assert.equal(targetedObserved.first_provider_call_started_at, "2026-07-29T00:00:00.002Z");
assert.equal(targetedObserved.decision_frozen_before_provider, true);
const lateDecisionObserved = withObservedProviderAuxRoute(targeted, {
  providerCalls: 1,
  providerCallLedger: [{
    logical_stage: "TARGETED_VISUAL_OBSERVATION",
    provider_calls: 1,
    started_at: cutoff
  }]
});
assert.equal(lateDecisionObserved.decision_frozen_before_provider, false);
const unobserved = withObservedProviderAuxRoute(targeted);
assert.equal(unobserved.observed_production_action, "UNKNOWN");
assert.equal(unobserved.observed_provider_calls, null);
assert.equal(unobserved.observed_provider_call_skipped, null);
assert.equal(unobserved.decision_frozen_before_provider, null);

console.log("provider auxiliary route shadow tests passed");
