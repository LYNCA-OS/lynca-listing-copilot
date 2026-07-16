import assert from "node:assert/strict";
import {
  buildErrorLogRow,
  buildProductionEventRow,
  buildRequestLogRow,
  createRequestTelemetry,
  operationalErrorFingerprint,
  requestIdFromRequest,
  sanitizeOperationalText,
  sanitizeOperationalStack,
  persistProductionEvents
} from "../lib/observability/production-events.mjs";
import { adaptV2ResultToV4 } from "../lib/listing/v4/result-adapter.mjs";
import { v4ResponseUsage } from "../api/v4/listing-job-worker.js";

const req = {
  method: "POST",
  url: "/api/v4/listing-job-enqueue?secret=must-not-be-logged",
  headers: { "x-request-id": "req-safe-123" }
};
const headers = {};
const res = { statusCode: 202, setHeader(name, value) { headers[name] = value; } };

assert.equal(requestIdFromRequest(req), "req-safe-123");
assert.notEqual(requestIdFromRequest({ headers: { "x-request-id": "bad id with spaces" } }), "bad id with spaces");

const row = buildRequestLogRow({
  requestId: "req-safe-123",
  context: { tenantId: "tenant_001", userId: "user_001", role: "MANAGER" },
  req,
  statusCode: 202,
  durationMs: 17
});
assert.equal(row.api, "/api/v4/listing-job-enqueue");
assert.equal(row.tenant_id, "tenant_001");
assert.equal(row.status_code, 202);

const error = new Error("provider failed Authorization: Bearer sk-live-secret https://storage.example/object?token=abc");
error.code = "PROVIDER_TIMEOUT";
error.stack = "Error: provider failed\nAuthorization: Bearer definitely-secret\n at safe-file.mjs:10:4";
const errorRow = buildErrorLogRow({ error, requestId: "req-safe-123", context: { tenantId: "tenant_001" } });
assert.equal(errorRow.error_type, "PROVIDER_TIMEOUT");
assert.match(errorRow.stack, /redacted/);
assert.doesNotMatch(errorRow.stack, /definitely-secret/);
assert.doesNotMatch(errorRow.message, /sk-live-secret|token=abc|storage\.example/);
assert.match(errorRow.message, /redacted/);
assert.equal(errorRow.metadata.error_fingerprint, operationalErrorFingerprint(error, "PROVIDER_TIMEOUT"));
assert.equal(sanitizeOperationalStack(error).includes("definitely-secret"), false);
assert.equal(sanitizeOperationalText("api_key=sk-live-secret").includes("sk-live-secret"), false);

const eventRow = buildProductionEventRow({
  eventType: "provider_called",
  requestId: "req-safe-123",
  context: { tenantId: "tenant_001", userId: "user_001" },
  jobId: "job_001",
  sessionId: "session_001",
  modelVersion: "gpt-5-mini",
  inputTokens: 120,
  outputTokens: 40,
  metadata: {
    lane: "interactive",
    api_key: "must-not-leak",
    nested: { response_body: "must-not-leak", attempt: 1 }
  }
});
assert.equal(eventRow.event_type, "provider_called");
assert.equal(eventRow.tenant_id, "tenant_001");
assert.deepEqual(eventRow.metadata, { lane: "interactive", nested: { attempt: 1 } });
assert.throws(() => buildProductionEventRow({ eventType: "arbitrary_event" }), /unsupported production event type/);

const bulkWrites = [];
const bulkResult = await persistProductionEvents([
  { eventType: "job_created", context: { tenantId: "tenant_001" }, jobId: "job_001" },
  { eventType: "job_created", context: { tenantId: "tenant_001" }, jobId: "job_002" }
], {
  env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, init) => {
    bulkWrites.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, status: 201, text: async () => "", json: async () => [] };
  }
});
assert.equal(bulkResult.saved, true);
assert.equal(bulkWrites[0].body.length, 2);

const writes = [];
const telemetry = createRequestTelemetry(req, res, { now: (() => { let value = 100; return () => (value += 10); })() });
telemetry.bindContext({ tenantId: "tenant_001", userId: "user_001", role: "MANAGER" });
const result = await telemetry.finish({
  env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, init) => {
    writes.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, status: 201, text: async () => "", json: async () => [] };
  }
});
assert.equal(result.saved, true);
assert.equal(headers["x-request-id"], "req-safe-123");
assert.equal(writes.length, 1);
assert.equal(writes[0].body.tenant_id, "tenant_001");
assert.equal((await telemetry.finish()).skipped, true);

const pricedV4 = adaptV2ResultToV4({
  sessionId: "session-priced",
  result: {
    title: "2024 Panini Test Card #1",
    final_title: "2024 Panini Test Card #1",
    confidence: "HIGH",
    provider: "openai_legacy",
    model: "gpt-5-mini",
    resolved_fields: { year: "2024", manufacturer: "Panini", card_name: "Test Card", card_number: "1" },
    provider_token_diagnostics: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
    usage: {
      provider_calls: 2,
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
      estimated_cost_usd: 0.012345,
      cost_configured: true
    }
  }
});
assert.deepEqual(pricedV4.provider_result.usage, {
  provider_calls: 2,
  input_tokens: 120,
  output_tokens: 40,
  total_tokens: 160,
  estimated_cost_usd: 0.012345,
  cost_configured: true
});
assert.equal(pricedV4.provider_result.provider_calls, 2);
assert.equal(pricedV4.provider_result.estimated_cost_usd, 0.012345);

const pricedUsage = v4ResponseUsage(pricedV4);
assert.equal(pricedUsage.providerCalls, 2, "worker telemetry must preserve multi-call provider usage");
assert.equal(pricedUsage.inputTokens, 120);
assert.equal(pricedUsage.outputTokens, 40);
assert.equal(pricedUsage.estimatedCostUsd, 0.012345);
assert.equal(pricedUsage.pricingCoverage, "PRICED");

const failedV4 = adaptV2ResultToV4({
  sessionId: "session-failed",
  result: {
    confidence: "FAILED",
    provider: "openai_legacy",
    model: "gpt-5-mini",
    provider_error_type: "PROVIDER_TIMEOUT",
    reason: "provider timed out",
    provider_token_diagnostics: { input_tokens: 90, output_tokens: 0, total_tokens: 90 },
    usage: {
      provider_calls: 1,
      input_tokens: 90,
      output_tokens: 0,
      total_tokens: 90,
      estimated_cost_usd: 0,
      cost_configured: false
    }
  }
});
assert.equal(failedV4.ok, false);
assert.equal(failedV4.provider_result.usage.provider_calls, 1);
assert.equal(failedV4.provider_result.usage.estimated_cost_usd, null, "unconfigured pricing must not become a fake $0");
assert.equal(failedV4.provider_result.cost_configured, false);

const failedUsage = v4ResponseUsage(failedV4);
assert.equal(failedUsage.providerCalls, 1, "failed provider responses must retain the observed call");
assert.equal(failedUsage.outputTokens, 0, "observed zero tokens must not be collapsed to unknown");
assert.equal(failedUsage.estimatedCostUsd, null);
assert.equal(failedUsage.pricingCoverage, "UNPRICED");
const unpricedProviderEvent = buildProductionEventRow({
  eventType: "provider_called",
  context: { tenantId: "tenant_001" },
  providerCalls: failedUsage.providerCalls,
  inputTokens: failedUsage.inputTokens,
  outputTokens: failedUsage.outputTokens,
  estimatedCostUsd: failedUsage.estimatedCostUsd,
  metadata: {
    cost_configured: failedUsage.costConfigured,
    pricing_coverage: failedUsage.pricingCoverage
  }
});
assert.equal(unpricedProviderEvent.provider_calls, 1);
assert.equal(unpricedProviderEvent.estimated_cost_usd, null);
assert.deepEqual(unpricedProviderEvent.metadata, {
  cost_configured: false,
  pricing_coverage: "UNPRICED"
});

const explicitZeroCallUsage = v4ResponseUsage({
  provider_result: {
    provider: "approved_identity_memory",
    usage: { provider_calls: 0, estimated_cost_usd: 0, cost_configured: false }
  }
});
assert.equal(explicitZeroCallUsage.providerCalls, 0, "an explicit cache/no-provider result must not be inferred as one call");
assert.equal(explicitZeroCallUsage.providerCallsSource, "reported");
assert.equal(explicitZeroCallUsage.pricingCoverage, "NO_PROVIDER_CALL");

const configuredZeroCost = v4ResponseUsage({
  provider_result: {
    provider: "test_provider",
    usage: { provider_calls: 1, estimated_cost_usd: 0, cost_configured: true }
  }
});
assert.equal(configuredZeroCost.estimatedCostUsd, 0, "a configured measured zero remains a real zero");
assert.equal(configuredZeroCost.pricingCoverage, "PRICED");

console.log("production event tests passed");
