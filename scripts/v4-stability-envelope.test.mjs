import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeV4StabilityEnvelope } from "../lib/listing/v4/jobs/stability-envelope.mjs";
import { numberArg as stabilityNumberArg } from "./analyze-v4-stability-soak.mjs";
import { buildV4SoakWavePlan, numberArg as soakNumberArg } from "./run-v4-multi-tenant-soak.mjs";
import { smokeTenantId, summarize } from "./v4-ebay-smoke.mjs";

function waveReport(waveIndex, {
  tenants = 5,
  cardsPerTenant = 4,
  writerBaseMs = 30_000,
  queueBaseMs = 2_000,
  failTenant = "",
  duplicateAssetId = ""
} = {}) {
  const results = [];
  for (let tenantIndex = 0; tenantIndex < tenants; tenantIndex += 1) {
    for (let cardIndex = 0; cardIndex < cardsPerTenant; cardIndex += 1) {
      const tenantId = `client-${tenantIndex + 1}`;
      const failed = tenantId === failTenant;
      results.push({
        asset_id: duplicateAssetId && waveIndex === 1 && tenantIndex === 0 && cardIndex === 0
          ? duplicateAssetId
          : `wave-${waveIndex + 1}-tenant-${tenantIndex + 1}-card-${cardIndex + 1}`,
        tenant_id: tenantId,
        batch_id: `batch-${waveIndex + 1}`,
        job_id: `job-${waveIndex + 1}-${tenantIndex + 1}-${cardIndex + 1}`,
        queue_mode: true,
        ok: !failed,
        writer_ready: !failed,
        l2_ready: !failed,
        job_status: failed ? "FAILED" : "L2_READY",
        attempt_count: 1,
        writer_ready_capacity_release_mode: "writer_ready_atomic",
        scheduler_queue_wait_ms: queueBaseMs + tenantIndex * 100 + cardIndex * 25,
        worker_queue_wait_ms: queueBaseMs + tenantIndex * 100 + cardIndex * 25,
        time_to_writer_ready_ms: writerBaseMs + tenantIndex * 150 + cardIndex * 50,
        pipeline_node_ledger: {
          coverage: { missing_required_node_count: 0 },
          reconciliation: { anomaly_count: 0, error_count: 0, warning_count: 0, anomalies: [] },
          nodes: []
        }
      });
    }
  }
  const summary = summarize(results, { runWallMs: writerBaseMs * 2 });
  return {
    schema_version: "v4-ebay-smoke-v1",
    wave_id: `wave-${waveIndex + 1}`,
    run_wall_ms: writerBaseMs * 2,
    evaluation_sample_policy: {
      mode: "FRESH_GENERALIZATION",
      sample_reuse_permitted: false,
      generalization_claim_permitted: true
    },
    batch_poll_metrics: {
      transient_error_count: 0,
      fatal_error: null
    },
    summary,
    results
  };
}

assert.deepEqual(buildV4SoakWavePlan({ totalItems: 53, limit: 50, waveSize: 20 }), [
  { wave_index: 0, wave_id: "wave-1", offset: 0, limit: 20 },
  { wave_index: 1, wave_id: "wave-2", offset: 20, limit: 20 },
  { wave_index: 2, wave_id: "wave-3", offset: 40, limit: 10 }
]);
assert.equal(soakNumberArg(["node", "script"], "--limit", 100), 100);
assert.equal(soakNumberArg(["node", "script", "--limit", "50"], "--limit", 100), 50);
assert.equal(stabilityNumberArg(["node", "script"], "--minimum-cards", 50), 50);
assert.equal(stabilityNumberArg(["node", "script", "--minimum-cards=75"], "--minimum-cards", 50), 75);
assert.equal(smokeTenantId({ batchId: "batch", tenantPrefix: "client", tenantCount: 3, index: 0 }), "client-tenant-1");
assert.equal(smokeTenantId({ batchId: "batch", tenantPrefix: "client", tenantCount: 3, index: 4 }), "client-tenant-2");

const healthyReports = [0, 1, 2].map((waveIndex) => waveReport(waveIndex));
const healthy = analyzeV4StabilityEnvelope(healthyReports);
assert.equal(healthy.pass, true);
assert.equal(healthy.aggregate.wave_count, 3);
assert.equal(healthy.aggregate.attempted_count, 60);
assert.equal(healthy.aggregate.tenant_count, 5);
assert.equal(healthy.aggregate.tenant_completion_fairness, 1);
assert.equal(healthy.aggregate.duplicate_asset_count, 0);
assert.deepEqual(healthy.rejection_reasons, []);

const duplicate = analyzeV4StabilityEnvelope([
  healthyReports[0],
  waveReport(1, { duplicateAssetId: healthyReports[0].results[0].asset_id }),
  healthyReports[2]
]);
assert.equal(duplicate.pass, false);
assert.ok(duplicate.rejection_reasons.includes("CROSS_WAVE_SAMPLE_REUSE"));

const starvedReports = [0, 1, 2].map((waveIndex) => waveReport(waveIndex));
starvedReports[2].results[0].scheduler_queue_wait_ms = 240_000;
starvedReports[2].results[0].worker_queue_wait_ms = 240_000;
starvedReports[2].summary = summarize(starvedReports[2].results, { runWallMs: 60_000 });
const starved = analyzeV4StabilityEnvelope(starvedReports);
assert.equal(starved.pass, false);
assert.ok(starved.rejection_reasons.includes("QUEUE_STARVATION_DETECTED"));

const tenantSpreadReports = [0, 1, 2].map((waveIndex) => waveReport(waveIndex));
for (const report of tenantSpreadReports) {
  for (const row of report.results.filter((item) => item.tenant_id === "client-5")) {
    row.scheduler_queue_wait_ms += 70_000;
    row.worker_queue_wait_ms += 70_000;
  }
  report.summary = summarize(report.results, { runWallMs: 60_000 });
}
const tenantSpread = analyzeV4StabilityEnvelope(tenantSpreadReports);
assert.equal(tenantSpread.pass, false);
assert.ok(tenantSpread.rejection_reasons.includes("TENANT_QUEUE_WAIT_SPREAD_ABOVE_TARGET"));

const unfair = analyzeV4StabilityEnvelope([
  waveReport(0, { failTenant: "client-5" }),
  waveReport(1, { failTenant: "client-5" }),
  waveReport(2, { failTenant: "client-5" })
]);
assert.equal(unfair.pass, false);
assert.ok(unfair.rejection_reasons.includes("TECHNICAL_AVAILABILITY_BELOW_TARGET"));
assert.ok(unfair.rejection_reasons.includes("TENANT_COMPLETION_FAIRNESS_BELOW_TARGET"));

const drifting = analyzeV4StabilityEnvelope([
  waveReport(0, { writerBaseMs: 20_000 }),
  waveReport(1, { writerBaseMs: 24_000 }),
  waveReport(2, { writerBaseMs: 60_000 })
]);
assert.equal(drifting.pass, false);
assert.ok(drifting.rejection_reasons.includes("TAIL_LATENCY_DEGRADES_OVER_TIME"));

const recoveredRetryReports = [0, 1, 2].map((waveIndex) => waveReport(waveIndex));
recoveredRetryReports[1].results[0].attempt_count = 2;
recoveredRetryReports[1].results[0].retry_error_codes = ["PROVIDER_NETWORK_ERROR"];
recoveredRetryReports[1].summary = summarize(recoveredRetryReports[1].results, { runWallMs: 60_000 });
const recoveredRetry = analyzeV4StabilityEnvelope(recoveredRetryReports);
assert.equal(recoveredRetry.pass, true, "a bounded recovered retry is production redundancy, not an outage");
assert.equal(recoveredRetry.aggregate.retry_card_count, 1);
assert.ok(recoveredRetry.warning_reasons.includes("RECOVERED_RETRY_OBSERVED"));

const excessiveRetryReports = [0, 1, 2].map((waveIndex) => waveReport(waveIndex));
for (const row of excessiveRetryReports[2].results.slice(0, 4)) {
  row.attempt_count = 2;
  row.retry_error_codes = ["PROVIDER_NETWORK_ERROR"];
}
excessiveRetryReports[2].summary = summarize(excessiveRetryReports[2].results, { runWallMs: 60_000 });
const excessiveRetries = analyzeV4StabilityEnvelope(excessiveRetryReports);
assert.equal(excessiveRetries.pass, false);
assert.ok(excessiveRetries.rejection_reasons.includes("RECOVERED_RETRY_RATE_ABOVE_TARGET"));

const migration = await readFile("supabase/migrations/20260713224500_v4_tenant_fair_provider_queue.sql", "utf8");
assert.match(
  migration,
  /partition by coalesce\(nullif\(jobs\.tenant_id, ''\), nullif\(jobs\.batch_id, ''\), jobs\.id\)/,
  "provider scheduling must allocate by tenant before batch"
);
assert.match(migration, /scheduling_fairness_key/);

console.log("V4 stability envelope tests passed");
