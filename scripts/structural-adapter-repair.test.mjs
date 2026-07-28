import test from "node:test";
import assert from "node:assert/strict";

import {
  candidateFields,
  candidateFieldPermissions,
  fieldPermissions
} from "../lib/listing/candidates/candidate-application-policy.mjs";
import { applyCandidateDecisionStage } from "../lib/listing/candidates/candidate-decision-stage.mjs";
import { buildCandidateSelectionPass } from "../lib/listing/candidates/candidate-selection-pass.mjs";
import { adaptRecognitionResultToV4 } from "../lib/listing/v4/result-adapter.mjs";

const serialFields = {
  year: "2024",
  manufacturer: "Topps",
  product: "Topps Chrome",
  players: ["Test Player"],
  print_run_number: "12/25",
  print_run_numerator: "12",
  print_run_denominator: "25",
  serial_number: "12/25"
};

const unrelatedEvidence = {
  year: { status: "CONFIRMED", normalized_value: "2024" }
};

function adaptSerial(serialNumeratorVerified) {
  const result = {
    confidence: "HIGH",
    resolved_fields: serialFields,
    normalized_evidence: unrelatedEvidence,
    title_stage: "L2_ASSISTED_DRAFT"
  };
  if (serialNumeratorVerified !== undefined) {
    result.serial_numerator_verified = serialNumeratorVerified;
  }
  return adaptRecognitionResultToV4({
    sessionId: "serial-three-state-regression",
    result,
    payload: { maxTitleLength: 80 },
    routePlan: {}
  });
}

test("result adapter preserves unknown serial verification instead of inventing a refusal", () => {
  const unknown = adaptSerial(undefined);
  assert.match(unknown.final_title, /12\/25/);
  assert.doesNotMatch(unknown.final_title, /#\/25/);
  assert.equal(unknown.provider_result.serial_numerator_verified, null);

  const explicitUnknown = adaptSerial(null);
  assert.match(explicitUnknown.final_title, /12\/25/);
  assert.doesNotMatch(explicitUnknown.final_title, /#\/25/);
  assert.equal(explicitUnknown.provider_result.serial_numerator_verified, null);

  const refused = adaptSerial(false);
  assert.match(refused.final_title, /#\/25/);
  assert.doesNotMatch(refused.final_title, /12\/25/);
  assert.equal(refused.provider_result.serial_numerator_verified, false);
});

test("candidate counterfactual renderer preserves unknown but honors explicit serial refusal", () => {
  const unknown = applyCandidateDecisionStage({
    result: { evidence: unrelatedEvidence, serial_numerator_verified: null },
    resolvedBefore: serialFields
  });
  assert.match(unknown.title_before, /12\/25/);
  assert.doesNotMatch(unknown.title_before, /#\/25/);

  const refused = applyCandidateDecisionStage({
    result: { evidence: unrelatedEvidence, serial_numerator_verified: false },
    resolvedBefore: serialFields
  });
  assert.match(refused.title_before, /#\/25/);
  assert.doesNotMatch(refused.title_before, /12\/25/);
});

function packet(candidate) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates: [candidate],
      assist_filter: {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: [candidate.candidate_id]
      }
    }
  };
}

function catalogSubjectCandidate(overrides = {}) {
  return {
    candidate_id: "catalog-subject-alias",
    candidate_identity_id: "identity-subject-alias",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number", "product_hierarchy", "year"],
      contradicted: []
    },
    fields: {
      year: "2025",
      manufacturer: "Topps",
      product: "Topps Chrome",
      subjects: ["Shohei Ohtani"],
      collector_number: "1"
    },
    ...overrides
  };
}

test("official Catalog subjects cross the candidate adapter as permitted players", () => {
  const candidate = catalogSubjectCandidate();
  const observed = {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    collector_number: "1"
  };
  const selection = buildCandidateSelectionPass({
    result: { resolved_fields: observed, catalog_candidate_packet: packet(candidate) }
  });
  const decision = applyCandidateDecisionStage({ result: selection, resolvedBefore: observed });

  assert.equal(selection.selected_candidate_decision.selected_candidate_id, candidate.candidate_id);
  assert.ok(selection.selected_candidate_safe_field_application.eligible_fields.includes("players"));
  assert.ok(selection.candidate_field_evidence.some((row) => (
    row.field_name === "players"
      && row.permission === fieldPermissions.CAN_APPLY
      && row.value.includes("Shohei Ohtani")
  )));
  assert.deepEqual(decision.resolved_after.players, ["Shohei Ohtani"]);
  assert.ok(decision.field_application.applied_fields.includes("players"));
});

test("subjects alias does not bypass source-trust permissions", () => {
  const candidate = catalogSubjectCandidate({
    source_type: "MARKETPLACE",
    source_trust: "MARKETPLACE"
  });
  const permissions = candidateFieldPermissions(candidate);
  assert.equal(permissions.players, fieldPermissions.SUGGEST_ONLY);
});

test("subjects alias cannot override an existing canonical player", () => {
  const fields = candidateFields({
    fields: {
      players: ["Canonical Player"],
      subjects: ["Conflicting Alias"]
    }
  });
  assert.deepEqual(fields.players, ["Canonical Player"]);
});

test("a scalar canonical players value still outranks subjects aliases", () => {
  const fields = candidateFields({
    fields: {
      players: "Canonical Player",
      subjects: ["Alias Player"]
    }
  });
  assert.deepEqual(fields.players, ["Canonical Player"]);
});
