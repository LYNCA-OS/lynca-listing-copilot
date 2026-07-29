import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCardJoinAddressability,
  requiredCardJoinCoverage
} from "../lib/listing/evaluation/cardjoin-addressability.mjs";

function candidate(overrides = {}) {
  return {
    identity_id: "official-1",
    year: "2025",
    product: "Panini Phoenix",
    set: "Contours",
    player: "Jaxson Dart",
    card_number: "24",
    source_trust: "OFFICIAL_CHECKLIST",
    source_id: "official-release-pack-v1",
    source_manifest_sha256: "a".repeat(64),
    content_sha256: "b".repeat(64),
    derived_from_source_ids: [],
    derived_from_content_sha256: [],
    rank: 1,
    ...overrides
  };
}

function sample(overrides = {}) {
  return {
    id: "card-1",
    canonical_identity_id: "canonical-card-1",
    split: "development",
    ground_truth_independent: true,
    ground_truth_source_id: "human-audit-v1",
    ground_truth_source_version: `sha256:${"c".repeat(64)}`,
    sealed_source_candidate_ids: ["sealed-self"],
    ground_truth: {
      year: "2025",
      product: "Panini Phoenix",
      set_or_insert: "Contours",
      player: "Jaxson Dart",
      card_number: "24"
    },
    sensor_evidence: {
      exact_card_code: true,
      direct_context_dimensions: 2
    },
    release_pack_candidates: [candidate()],
    no_provider_latency_ms: 2400,
    predicted_identity: candidate(),
    ...overrides
  };
}

test("85% joint target requires at least 90.3775% addressable coverage at 99% precision and 95% deadline", () => {
  assert.equal(requiredCardJoinCoverage(), 0.903775);
});

test("a trusted independent exact join is addressable without a full Provider", () => {
  const report = analyzeCardJoinAddressability([sample()], {
    gate: {
      target_joint_success: 0.85,
      target_precision: 0.99,
      target_deadline_success: 0.95,
      deadline_ms: 3000,
      minimum_development: 1,
      minimum_validation: 0
    }
  });
  assert.equal(report.route, "NO_FULL_PROVIDER");
  assert.equal(report.status, "GO");
  assert.equal(report.metrics.join_addressability, 1);
  assert.equal(report.metrics.observed_joint_success, 1);
});

test("same-source candidate cannot prove the system against itself", () => {
  const report = analyzeCardJoinAddressability([sample({
    release_pack_candidates: [candidate({
      source_id: "human-audit-v1"
    })]
  })], {
    gate: {
      target_joint_success: 0.85,
      target_precision: 0.99,
      target_deadline_success: 0.95,
      deadline_ms: 3000,
      minimum_development: 1,
      minimum_validation: 0
    }
  });
  assert.equal(report.metrics.source_pack_reachability, 0);
  assert.ok(report.blockers.includes("ADDRESSABILITY_BELOW_REQUIRED_COVERAGE"));
});

test("derived lineage cannot self-attest as an independent candidate", () => {
  const report = analyzeCardJoinAddressability([sample({
    release_pack_candidates: [candidate({
      derived_from_source_ids: ["human-audit-v1"]
    })]
  })], {
    gate: {
      target_joint_success: 0.85,
      target_precision: 0.99,
      target_deadline_success: 0.95,
      deadline_ms: 3000,
      minimum_development: 1,
      minimum_validation: 0
    }
  });
  assert.equal(report.metrics.source_pack_reachability, 0);
});

test("holdout is excluded and small dev/validation remains insufficient", () => {
  const report = analyzeCardJoinAddressability([
    sample(),
    sample({ id: "sealed", split: "holdout" })
  ]);
  assert.equal(report.denominator, 1);
  assert.equal(report.excluded_count, 1);
  assert.equal(report.status, "INSUFFICIENT_DENOMINATOR");
});

test("source-pack reachability is not confused with sensor join readiness", () => {
  const report = analyzeCardJoinAddressability([sample({ sensor_evidence: {} })], {
    gate: {
      target_joint_success: 0.85,
      target_precision: 0.99,
      target_deadline_success: 0.95,
      deadline_ms: 3000,
      minimum_development: 1,
      minimum_validation: 0
    }
  });
  assert.equal(report.metrics.source_pack_reachability, 1);
  assert.equal(report.metrics.join_addressability, 0);
  assert.equal(report.status, "NO_GO");
});

test("a correct and incorrect candidate tied at Top-1 is not uniquely addressable", () => {
  const report = analyzeCardJoinAddressability([sample({
    release_pack_candidates: [
      candidate({ identity_id: "correct", rank: 1 }),
      candidate({
        identity_id: "wrong",
        player: "Malik Nabers",
        card_number: "9",
        content_sha256: "d".repeat(64),
        rank: 1
      })
    ]
  })], {
    gate: {
      target_joint_success: 0.85,
      target_precision: 0.99,
      target_deadline_success: 0.95,
      deadline_ms: 3000,
      minimum_development: 1,
      minimum_validation: 0
    }
  });

  assert.equal(report.metrics.source_pack_reachability, 1);
  assert.equal(report.metrics.join_addressability, 0);
  assert.equal(report.rows[0].unique_correct_top, false);
  assert.equal(report.status, "NO_GO");
});

test("duplicate copies of one canonical identity cannot inflate the denominator", () => {
  const copies = Array.from({ length: 130 }, (_, index) => sample({
    id: `copy-${String(index).padStart(3, "0")}`
  }));
  const report = analyzeCardJoinAddressability(copies);
  assert.equal(report.denominator, 1);
  assert.equal(report.duplicate_identity_sample_count, 129);
  assert.equal(report.status, "INSUFFICIENT_DENOMINATOR");
});

test("GO requires the directly observed per-identity joint-success gate", () => {
  const report = analyzeCardJoinAddressability([sample({ no_provider_latency_ms: 3200 })], {
    gate: {
      target_joint_success: 0.85,
      target_precision: 0.99,
      target_deadline_success: 0.95,
      deadline_ms: 3000,
      minimum_development: 1,
      minimum_validation: 0
    }
  });
  assert.equal(report.metrics.observed_joint_success, 0);
  assert.ok(report.blockers.includes("JOINT_SUCCESS_BELOW_GATE"));
  assert.equal(report.status, "NO_GO");
});
