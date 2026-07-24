#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzeProviderIdleGapCauses } from "./analyze-provider-idle-gap-causes.mjs";

const at = (seconds) => new Date(Date.parse("2026-07-24T00:00:00Z") + seconds * 1000).toISOString();
const result = ({ id, slot, created, started, providerStart, providerEnd, release = true, releaseLatency = 0, attempts = 1 }) => ({
  job_id: id,
  provider_capacity_slot: slot,
  job_created_at: at(created),
  job_started_at: at(started),
  attempt_count: attempts,
  provider_slot_timing: { started_at: at(providerStart), completed_at: at(providerEnd) },
  provider_capacity_stage_handoff: { released: release, released_count: release ? 1 : 0, latency_ms: releaseLatency }
});

const audit = analyzeProviderIdleGapCauses({
  summary: { run_wall_ms: 210_000, provider_slot_idle_gaps: { idle_gap_total_ms: 25_000 } },
  results: [
    result({ id: "a", slot: 1, created: 0, started: 0, providerStart: 1, providerEnd: 10, releaseLatency: 1_000 }),
    result({ id: "b", slot: 1, created: 5, started: 20, providerStart: 25, providerEnd: 30 }),
    result({ id: "c", slot: 1, created: 8, started: 35, providerStart: 40, providerEnd: 45, attempts: 2 })
  ]
});

assert.equal(audit.reconciliation.raw_gap_total_ms, 25_000);
assert.equal(audit.reconciliation.classified_total_ms, 25_000);
assert.equal(audit.totals_ms.CAPACITY_RELEASE_LATENCY, 1_000);
assert.equal(audit.totals_ms.RUNNABLE_BACKLOG_WAKE_GAP, 14_000);
assert.equal(audit.totals_ms.UPSTREAM_PRE_PROVIDER, 5_000);
assert.equal(audit.totals_ms.RETRY_OR_PRIOR_ATTEMPT, 5_000);
assert.equal(audit.decision.persistent_consumer_threshold_met, true);
console.log("provider idle gap cause audit tests passed");
