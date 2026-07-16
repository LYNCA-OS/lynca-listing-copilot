#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  normalizeTenantOpsSnapshot,
  readTenantOpsSnapshot,
  redactTenantOpsCost
} from "../lib/ops/tenant-ops.mjs";

const raw = {
  tenant_id: "tenant_a",
  generated_at: "2026-07-15T00:00:00.000Z",
  window: {
    since: "2026-07-14T00:00:00.000Z",
    until: "2026-07-15T00:00:00.000Z"
  },
  queue: {
    queued: 3,
    interactive_queued: 2,
    background_queued: 1,
    running: 1,
    completed: 8,
    retryable_failed: 1,
    failed_final: 2,
    retry_count: 4,
    average_wait_ms: 100,
    p50_wait_ms: 75,
    p95_wait_ms: 240,
    p50_writer_visible_latency_ms: 500,
    p95_writer_visible_latency_ms: 900
  },
  ai: { recognition_count: 10, success_count: 8, failed_count: 2, success_rate: 0.8 },
  feedback: {
    feedback_count: 5,
    accept_count: 3,
    edit_count: 1,
    reject_count: 1,
    accept_rate: 0.6,
    edit_rate: 0.2,
    reject_rate: 0.2
  },
  cost: {
    provider_calls: 11,
    provider_call_events: 10,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    estimated_cost_usd: 1.25,
    average_cost_per_successful_card_usd: 0.15625,
    cost_configured: true
  },
  coverage: { feedback_rate: 0.625, pricing_rate: 1 }
};
const normalized = normalizeTenantOpsSnapshot(raw);
assert.equal(normalized.tenant_id, "tenant_a");
assert.equal(normalized.queue.queued, 3);
assert.equal(normalized.queue.p95_writer_visible_latency_ms, 900);
assert.equal(normalized.ai.recognition_count, 10);
assert.equal(normalized.feedback.accept_rate, 0.6);
assert.equal(normalized.feedback.edit_rate, 0.2);
assert.equal(normalized.feedback.reject_rate, 0.2);
assert.equal(normalized.coverage.feedback_rate, 0.625);
assert.equal(normalized.coverage.pricing_rate, 1);
assert.equal(normalized.cost.total_tokens, 150);
assert.equal(normalized.cost.average_cost_per_successful_card_usd, 0.15625);
assert.equal(normalized.cost.cost_configured, true);

const legacy = normalizeTenantOpsSnapshot({
  since: "2026-07-14T00:00:00.000Z",
  system: { queued: 2, p95_latency_ms: 777 },
  ai: { recognition_volume: 4, recognition_failed: 1, accept_count: 1 },
  cost: { input_tokens: 20, output_tokens: 5, average_cost_per_card_usd: 0.2 }
});
assert.equal(legacy.queue.p95_writer_visible_latency_ms, 777);
assert.equal(legacy.ai.recognition_count, 4);
assert.equal(legacy.ai.failed_count, 1);
assert.equal(legacy.feedback.feedback_count, 1);
assert.equal(legacy.cost.total_tokens, 25);
assert.equal(legacy.cost.cost_configured, false, "legacy numeric zero must not imply configured pricing");

const hidden = redactTenantOpsCost(raw, { canViewCost: false });
assert.deepEqual(hidden.cost, { visible: false, reason: "VIEW_COST_PERMISSION_REQUIRED" });
assert.equal(redactTenantOpsCost(raw, { canViewCost: true }).cost.estimated_cost_usd, 1.25);

const calls = [];
const result = await readTenantOpsSnapshot({
  tenantId: "tenant_a",
  windowHours: 9_999,
  canViewCost: true,
  env: {
    SUPABASE_URL: "https://ops-test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_ops_test"
  },
  fetchImpl: async (input, init = {}) => {
    const url = new URL(String(input));
    const body = JSON.parse(init.body || "{}");
    calls.push({ url, body, headers: init.headers });
    return new Response(JSON.stringify(raw), { status: 200, headers: { "content-type": "application/json" } });
  }
});
assert.equal(result.ok, true);
assert.equal(calls[0].url.pathname, "/rest/v1/rpc/track_c_ops_snapshot");
assert.equal(calls[0].body.p_tenant_id, "tenant_a");
assert.equal(calls[0].headers.apikey, "sb_secret_ops_test");
assert.equal(calls[0].headers.authorization, undefined, "opaque Supabase secret keys are apikey-only");
const requestedWindowHours = (Date.now() - Date.parse(calls[0].body.p_since)) / 3_600_000;
assert.ok(requestedWindowHours >= 743.9 && requestedWindowHours <= 744.1, "ops window must be bounded to 31 days");

const missingTenant = await readTenantOpsSnapshot({ tenantId: "" });
assert.equal(missingTenant.ok, false);
assert.equal(missingTenant.error, "tenant_id_required");

console.log("tenant ops tests passed");
