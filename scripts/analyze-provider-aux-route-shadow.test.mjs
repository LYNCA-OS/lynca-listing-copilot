#!/usr/bin/env node

import assert from "node:assert/strict";

import { analyzeProviderAuxRouteShadow } from "./analyze-provider-aux-route-shadow.mjs";
import { providerAuxRouteReplayInputHash } from "../lib/listing/v4/route-planner/provider-aux-route-shadow.mjs";

const legacy = {
  job_id: "legacy-targeted",
  image_count: 2,
  provider_calls: 1,
  total_tokens: 4000,
  exact_anchor_fast_final_shadow: { eligible: false },
  pre_l2_anchor_patch_count: 0,
  preingestion_ocr_rendezvous: { patch_count: 0 },
  preingestion_retrieval_anchor_fields: [],
  provider_capacity_timeline: {
    provider_started_at: "2026-07-29T00:00:01.000Z",
    provider_execution_ms: 4500
  },
  evaluation_decision_trace_packet: {
    recognition_preflight: {
      worker_finished_before_provider: false,
      evidence_field_count: 3
    },
    knowledge_first_route: {
      route: "WRITER_REVIEW"
    }
  }
};

const nativeReplayInput = {
  evidence_document: {},
  forward_enumeration_trace: [],
  usable_image_count: 2,
  exact_anchor_shadow: null,
  higher_authority_route: null,
  evidence_availability_manifest: []
};
const native = {
  job_id: "native-fast",
  image_count: 2,
  provider_calls: 1,
  total_tokens: 3000,
  provider_capacity_timeline: {
    provider_started_at: "2026-07-29T00:00:01.000Z",
    provider_execution_ms: 3500
  },
  evaluation_decision_trace_packet: {
    provider_aux_route: {
      schema_version: "provider-aux-route-shadow-v1",
      route_input_hash: "a".repeat(64),
      preprovider_snapshot_hash: providerAuxRouteReplayInputHash(nativeReplayInput),
      replay_input: nativeReplayInput,
      route: "FAST_DETERMINISTIC",
      input_class: "NOVEL_IMAGE",
      route_decided_at: "2026-07-29T00:00:00.500Z",
      trace_completeness: "COMPLETE",
      source_availability: "COMPLETE",
      provider_derived_field_count: 0,
      post_cutoff_evidence_count: 0,
      reason_codes: ["PUBLISHABLE_CANONICAL_EVIDENCE_SUFFICIENT"]
    }
  }
};

const audit = analyzeProviderAuxRouteShadow({ results: [legacy, native] });
assert.equal(audit.sample_count, 2);
assert.equal(audit.trace.native_frozen_trace_count, 1);
assert.equal(audit.trace.native_activation_admissible_count, 1);
assert.equal(audit.trace.legacy_empty_replay_count, 1);
assert.equal(audit.lanes.counts.TARGETED_MODEL_ASSIST, 1);
assert.equal(audit.lanes.counts.FAST_DETERMINISTIC, 1);
assert.equal(audit.lanes.final_full_provider_fallback_lower_bound, 0);
assert.equal(audit.lanes.final_full_provider_fallback_upper_bound, 1);
assert.equal(audit.observed_production.measured_provider_work_ms, 8000);
assert.equal(audit.counterfactual_cost_boundary.targeted_full_provider_work_gross_ceiling_ms, 4500);
assert.equal(audit.counterfactual_cost_boundary.proven_net_provider_work_saving_ms, 0);
assert.equal(audit.activation_gate.eligible, false);
assert.ok(audit.activation_gate.blockers.includes("FROZEN_PREPROVIDER_TRACE_INCOMPLETE"));
assert.ok(audit.activation_gate.blockers.includes("TARGETED_EXECUTOR_NOT_EVALUATED"));

const lateNative = structuredClone(native);
lateNative.job_id = "late-native";
lateNative.evaluation_decision_trace_packet.provider_aux_route.route_decided_at = "2026-07-29T00:00:02.000Z";
const lateAudit = analyzeProviderAuxRouteShadow({ results: [lateNative] });
assert.equal(lateAudit.trace.native_activation_admissible_count, 0);
assert.equal(lateAudit.activation_gate.eligible, false);

const unknown = analyzeProviderAuxRouteShadow({ results: [{ job_id: "unknown" }] });
assert.equal(unknown.trace.unknown_not_reconstructable_count, 1);
assert.equal(unknown.lanes.counts.UNKNOWN, 1);

console.log("provider auxiliary route shadow audit tests passed");
