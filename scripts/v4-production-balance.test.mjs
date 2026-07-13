import assert from "node:assert/strict";
import {
  accuracyEvidence,
  assessCapacityReport,
  assessProductionBalance,
  assessStabilityReport
} from "./assess-v4-production-balance.mjs";
import { summarize } from "./v4-ebay-smoke.mjs";

function stabilityReport(overrides = {}) {
  const attempted = overrides.attempted ?? 50;
  return {
    schema_version: "v4-ebay-smoke-v1",
    concurrency: 2,
    provider_done_capacity_handoff_override: true,
    run_wall_ms: 600_000,
    summary: {
      attempted_count: attempted,
      ok_count: attempted,
      technical_failure_count: 0,
      completed_cards_per_minute: 5,
      writer_ready_p50_ms: 35_000,
      writer_ready_p95_ms: 70_000,
      scheduler_queue_wait_p95_ms: 20_000,
      retry_card_count: 0,
      retry_attempt_count: 0,
      provider_error_count: 0,
      production_integrity: {
        duplicate_asset_id_count: 0,
        duplicate_job_id_count: 0,
        missing_job_id_count: 0,
        successful_nonterminal_job_count: 0,
        provider_capacity_release_missing_count: 0,
        provider_capacity_refill_missing_count: 0
      },
      provider_diagnostics: {
        provider_latency_p50_ms: 8_000,
        provider_latency_p95_ms: 15_000,
        input_tokens_total: 300_000,
        output_tokens_total: 30_000,
        total_tokens_total: 330_000
      },
      preingestion_ocr: {
        timeout_count: 0,
        worker_timeout_count: 0,
        stage_capacity_control_enabled_count: attempted,
        stage_global_capacity_latest: 8,
        stage_capacity_wait_p50_ms: 1_000,
        stage_capacity_wait_p95_ms: 5_000,
        stage_capacity_deferred_count: 0,
        peak_local_active_p95: 5
      },
      vector_runtime_status_breakdown: {},
      pipeline_node_observability: {
        ledger_present_count: attempted,
        ledger_missing_count: 0,
        error_count: 0,
        transport_error_count: 0,
        field_quality_error_count: 0,
        warning_count: 0,
        missing_required_node_count: 0,
        node_metrics: []
      },
      ...overrides.summary
    },
    results: Array.from({ length: attempted }, (_, index) => ({
      asset_id: `asset-${index}`,
      ok: true,
      job_status: "L2_READY"
    }))
  };
}

function reviewedTitleAccuracy({ pass = 45, total = 50 } = {}) {
  return {
    schema_version: "cloud-listing-api-eval-v1",
    attempted_count: total,
    accuracy_policy: {
      corrected_title_is_reviewed_title_ground_truth: true
    },
    policy_fair_pass_at_0_72_count: pass,
    policy_fair_pass_at_0_72_rate: pass / total
  };
}

function capacityReport() {
  return {
    schema_version: "v4-concurrency-capacity-sweep-v2",
    recommended_concurrency: 2,
    recommendation_confidence: "PAIRED_CONFIRMED",
    rows: [{
      concurrency: 2,
      stable: true,
      completed_cards_per_minute: 5,
      writer_ready_p95_ms: 70_000
    }]
  };
}

function stabilityEnvelope() {
  return {
    schema_version: "v4-multi-tenant-soak-v1",
    summary: stabilityReport().summary,
    stability_envelope: {
      schema_version: "v4-stability-envelope-v1",
      pass: true,
      aggregate: {
        wave_count: 3,
        attempted_count: 60,
        tenant_count: 5,
        technical_availability: 1,
        tenant_completion_fairness: 1,
        residual_backlog_count: 0,
        writer_ready_p95_ms: 70_000
      },
      rejection_reasons: [],
      warning_reasons: []
    }
  };
}

const weakSellerEvidence = accuracyEvidence({
  blind_policy: { seller_title_is_ground_truth: false },
  summary: { final_accuracy_proxy: { policy_fair_pass_at_0_72: 50 }, attempted_count: 50 }
});
assert.equal(weakSellerEvidence.eligible, false);
assert.equal(weakSellerEvidence.evidence_type, "NO_REVIEWED_GROUND_TRUTH");

const integritySummary = summarize([
  {
    asset_id: "asset-1",
    job_id: "job-1",
    job_status: "L2_READY",
    queue_mode: true,
    ok: true,
    writer_ready_capacity_release_mode: "provider_done",
    writer_ready_capacity_release: { released: true },
    writer_ready_capacity_refill: { triggered: true }
  },
  {
    asset_id: "asset-2",
    job_id: "job-1",
    job_status: "RUNNING",
    queue_mode: true,
    ok: true,
    writer_ready_capacity_release_mode: "provider_done",
    writer_ready_capacity_release: { released: true },
    writer_ready_capacity_refill: { triggered: false }
  }
]);
assert.equal(integritySummary.production_integrity.duplicate_asset_id_count, 0);
assert.equal(integritySummary.production_integrity.duplicate_job_id_count, 1);
assert.equal(integritySummary.production_integrity.successful_nonterminal_job_count, 1);
assert.equal(integritySummary.production_integrity.provider_capacity_refill_missing_count, 1);
assert.equal(integritySummary.production_integrity.tenant_service[0].queue_wait_p95_ms, null);
assert.equal(integritySummary.production_integrity.tenant_service[0].writer_ready_p95_ms, null);

const reviewedTitleEvidence = accuracyEvidence(reviewedTitleAccuracy());
assert.equal(reviewedTitleEvidence.eligible, true);
assert.equal(reviewedTitleEvidence.value, 0.9);
assert.equal(reviewedTitleEvidence.evidence_type, "REVIEWED_TITLE_POLICY_ACCEPTANCE");

const fieldExactEvidence = accuracyEvidence({
  metrics: {
    ai_card_exact_accuracy: { correct: 27, total: 30, rate: 0.9 }
  }
});
assert.equal(fieldExactEvidence.eligible, true);
assert.equal(fieldExactEvidence.value, 0.9);
assert.equal(fieldExactEvidence.evidence_type, "REVIEWED_FIELD_CARD_EXACT");

const stable = assessStabilityReport(stabilityReport(), {
  minimumCards: 50,
  maximumWriterP95Ms: 120_000,
  requireVectorRuntime: true,
  requireStabilityEnvelope: false
});
assert.equal(stable.pass, true);
assert.equal(stable.ocr_stage_global_capacity, 8);

const duplicateJobs = stabilityReport({
  summary: {
    production_integrity: {
      duplicate_asset_id_count: 0,
      duplicate_job_id_count: 1,
      missing_job_id_count: 0,
      successful_nonterminal_job_count: 0,
      provider_capacity_release_missing_count: 0,
      provider_capacity_refill_missing_count: 0
    }
  }
});
const duplicateDecision = assessStabilityReport(duplicateJobs, { minimumCards: 50, requireStabilityEnvelope: false });
assert.equal(duplicateDecision.pass, false);
assert.ok(duplicateDecision.rejection_reasons.includes("DUPLICATE_QUEUE_JOB"));

const vectorUnavailable = stabilityReport({
  summary: { vector_runtime_status_breakdown: { UNAVAILABLE: 2 } }
});
const vectorDecision = assessStabilityReport(vectorUnavailable, {
  minimumCards: 50,
  requireVectorRuntime: true,
  requireStabilityEnvelope: false
});
assert.equal(vectorDecision.pass, false);
assert.ok(vectorDecision.rejection_reasons.includes("VECTOR_RUNTIME_REQUIRED_BUT_UNAVAILABLE"));

const capacity = assessCapacityReport(capacityReport());
assert.equal(capacity.pass, true);
assert.equal(capacity.recommended_concurrency, 2);

const balanced = assessProductionBalance({
  accuracyReport: reviewedTitleAccuracy(),
  stabilityReport: stabilityEnvelope(),
  capacityReport: capacityReport(),
  requireVectorRuntime: true
});
assert.equal(balanced.pass, true);
assert.equal(balanced.accuracy.pass, true);
assert.equal(balanced.speed.pass, true);

const inaccurate = assessProductionBalance({
  accuracyReport: reviewedTitleAccuracy({ pass: 42, total: 50 }),
  stabilityReport: stabilityEnvelope(),
  capacityReport: capacityReport()
});
assert.equal(inaccurate.pass, false);
assert.ok(inaccurate.rejection_reasons.includes("ACCURACY_BELOW_TARGET"));

const weakOnly = assessProductionBalance({
  accuracyReport: { blind_policy: { seller_title_is_ground_truth: false } },
  stabilityReport: stabilityEnvelope(),
  capacityReport: capacityReport()
});
assert.equal(weakOnly.pass, false);
assert.ok(weakOnly.rejection_reasons.includes("REVIEWED_ACCURACY_EVIDENCE_MISSING"));

const legacySingleRun = assessProductionBalance({
  accuracyReport: reviewedTitleAccuracy(),
  stabilityReport: stabilityReport(),
  capacityReport: capacityReport()
});
assert.equal(legacySingleRun.pass, false);
assert.ok(legacySingleRun.rejection_reasons.includes("MULTI_WAVE_STABILITY_ENVELOPE_REQUIRED"));

console.log("v4 production balance tests passed");
