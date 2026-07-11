import assert from "node:assert/strict";
import {
  createTimingContext,
  snapshotNodeSpans,
  timeAsync,
  timeSync
} from "../lib/listing/pipeline/timing.mjs";
import { buildPipelineNodeLedger } from "../lib/listing/pipeline/node-observability.mjs";
import { buildEndToEndNodeLedger } from "../lib/listing/v4/jobs/end-to-end-node-observability.mjs";
import {
  normalizeV4QualityLedgerRow,
  persistV4QualityLedger,
  updateV4RecognitionSessionWithRetry
} from "../lib/listing/v4/session/session-store.mjs";

const context = createTimingContext({
  asset_id: "asset-observability-1",
  recognition_session_id: "session-observability-1",
  images: [{ image_id: "image-1" }, { image_id: "image-2" }]
});

timeSync(context, "image_quality_check_ms", () => ({ status: "PASS" }));
await timeAsync(context, "approved_memory_lookup_ms", async () => null);
await timeAsync(context, "identity_cache_lookup_ms", async () => null);
await timeAsync(context, "signed_url_ms", async () => ["signed-1", "signed-2"]);
await timeAsync(context, "catalog_retrieval_ms", async () => ({ candidates: [{ id: "candidate-1" }] }));
await timeAsync(context, "provider_total_ms", async () => ({ fields: { year: "2024" } }));
timeSync(context, "resolver_ms", () => ({ resolved_fields: { year: "2024" } }));
timeSync(context, "renderer_ms", () => ({ title: "2024 Topps Test Player" }));
await timeAsync(context, "workflow_sidecars_ms", async () => ({ status: "QUEUED" }));

try {
  await timeAsync(context, "synthetic_failure_ms", async () => {
    const error = new Error("must-not-leak sk-secret-value https://signed.example.test");
    error.code = "SYNTHETIC_FAILURE";
    throw error;
  });
  assert.fail("synthetic failure should throw");
} catch (error) {
  assert.equal(error.code, "SYNTHETIC_FAILURE");
}

const spanSnapshot = snapshotNodeSpans(context);
assert.equal(spanSnapshot.spans.length, 10);
assert.equal(spanSnapshot.spans.find((span) => span.node_id === "synthetic_failure")?.status, "FAILED");
assert.equal(spanSnapshot.spans.find((span) => span.node_id === "synthetic_failure")?.error_code, "SYNTHETIC_FAILURE");
assert.equal(JSON.stringify(spanSnapshot).includes("sk-secret-value"), false);
assert.equal(JSON.stringify(spanSnapshot).includes("signed.example.test"), false);

const inferredOutput = await timeAsync(context, "catalog_retrieval_ms", async () => ["a", "b"]);
assert.equal(inferredOutput.length, 2);
const inferredOutputSpan = snapshotNodeSpans(context).spans.at(-1);
assert.equal(inferredOutputSpan.input_count, null);
assert.equal(inferredOutputSpan.output_count, 2);

const fields = {
  year: "2024",
  manufacturer: "Topps",
  product: "Chrome",
  player: "Test Player",
  card_name: "Autograph"
};
const healthyResult = {
  timing: context.timing,
  provider: "openai",
  model: "gpt-5-mini",
  provider_token_diagnostics: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  raw_provider_fields: fields,
  resolved_fields: fields,
  rendered_fields: { fields },
  field_states: {},
  catalog_activation_funnel: {
    raw_candidate_count: 1,
    approved_candidate_count: 1,
    conflict_blocked_count: 0,
    prompt_candidate_count: 1,
    evidence_support_field_count: 3
  },
  final_title: "2024 Topps Chrome Test Player Autograph",
  workflow_sidecars: {
    paddle_ocr: { status: "QUEUED" },
    splink: { status: "NOT_TRIGGERED" }
  }
};
const healthyLedger = buildPipelineNodeLedger({
  result: healthyResult,
  timingContext: context,
  payload: { asset_id: "asset-observability-1", images: [{}, {}] }
});
assert.equal(healthyLedger.schema_version, "pipeline-node-ledger-v1");
assert.equal(healthyLedger.reconciliation.error_count, 0);
assert.equal(healthyLedger.coverage.missing_required_node_count, 0);
assert.equal(healthyLedger.field_flow.unexplained_resolution_drop_count, 0);
assert.equal(healthyLedger.nodes.find((node) => node.node_id === "catalog_retrieval")?.output_count, 1);
assert.equal(healthyLedger.nodes.find((node) => node.node_id === "provider")?.metrics.total_tokens, 120);
assert.equal(JSON.stringify(healthyLedger).includes("sk-secret-value"), false);

const brokenLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    bundle_used: true,
    raw_provider_fields: { ...fields, collector_number: "PA-ANT" },
    resolved_fields: fields,
    rendered_fields: { fields },
    preingestion_ocr_rendezvous: {
      status: "TERMINAL",
      job_count: 3,
      status_counts: { succeeded: 1, failed: 1 },
      raw_patch_count: 4,
      patch_count: 1,
      historical_patch_count: 1,
      job_observability: [{
        job_id: "job-1",
        crop_role: "serial_crop",
        status: "FAILED",
        attempts: 2,
        lifecycle_ms: 900,
        error_code: "OCR_TIMEOUT"
      }]
    }
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-1", images: [{}, {}] }
});
const failedChecks = new Set(brokenLedger.reconciliation.anomalies.map((item) => item.check_id));
assert.equal(failedChecks.has("ocr_job_status_count_conservation"), true);
assert.equal(failedChecks.has("ocr_patch_version_count_conservation"), true);
assert.equal(failedChecks.has("critical_field_flow_has_no_silent_drop"), true);
assert.deepEqual(brokenLedger.field_flow.unexplained_resolution_drop_fields, ["collector_number"]);
assert.equal(brokenLedger.nodes.find((node) => node.node_id === "preingestion_ocr")?.metrics.job_observability[0].error_code, "OCR_TIMEOUT");

const endToEndLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "2024 Topps Chrome Test Player Autograph",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    provider_result_summary: {
      pipeline_node_ledger: healthyLedger,
      noncritical_persistence_status: "COMPLETED",
      noncritical_persistence_summary: { saved_count: 4, failed_count: 0, artifact_count: 4 }
    }
  },
  job: {
    id: "job-observability-1",
    batch_id: "batch-observability-1",
    lane: "interactive",
    job_type: "final_assisted_title",
    status: "SUCCEEDED",
    attempt_count: 1,
    max_attempts: 3,
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z",
    queue_tags: { provider_capacity_slot: 1, provider_key_slot: 1 }
  },
  timing: {
    scheduler_queue_wait_ms: 500,
    total_created_to_worker_start_ms: 500,
    worker_processing_ms: 2500,
    time_to_l2_ready_ms: 2900
  },
  display: { can_writer_start: true }
});
assert.equal(endToEndLedger.schema_version, "pipeline-end-to-end-node-ledger-v1");
assert.equal(endToEndLedger.nodes.find((node) => node.node_id === "scheduler_queue")?.duration_ms, 500);
assert.equal(endToEndLedger.nodes.find((node) => node.node_id === "writer_ready")?.status, "COMPLETED");
assert.equal(endToEndLedger.reconciliation.error_count, 0);

const deferredPersistenceLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "2024 Topps Chrome Test Player Autograph",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    provider_result_summary: {
      pipeline_node_ledger: healthyLedger,
      noncritical_persistence_status: "DEFERRED"
    }
  },
  job: {
    id: "job-observability-deferred",
    status: "L2_READY",
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z"
  },
  display: { can_writer_start: true }
});
assert.equal(deferredPersistenceLedger.reconciliation.anomalies.some((item) => item.check_id === "production_observability_persistence_terminal"), true);

const qualityRow = normalizeV4QualityLedgerRow({
  id: "session-observability-1_quality",
  recognition_session_id: "session-observability-1",
  provider: "openai",
  model: "gpt-5-mini",
  status: "DRAFT_READY",
  timing: { provider_total_ms: 1200, total_ms: 1500 },
  token_diagnostics: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  request_diagnostics: { provider_key_slot: 1, authorization: "Bearer must-not-persist" },
  pipeline_node_ledger: endToEndLedger,
  unexpected_legacy_field: "must-not-be-sent-to-postgrest"
});
assert.equal(qualityRow.latency_ms, 1200);
assert.equal(qualityRow.input_tokens, 100);
assert.equal(qualityRow.pipeline_node_ledger.schema_version, "pipeline-end-to-end-node-ledger-v1");
assert.equal(Object.hasOwn(qualityRow, "unexpected_legacy_field"), false);
assert.equal(JSON.stringify(qualityRow).includes("must-not-persist"), false);

const emptyQualityRow = normalizeV4QualityLedgerRow({ recognition_session_id: "session-empty-observability" });
assert.equal(emptyQualityRow.latency_ms, null);
assert.equal(emptyQualityRow.input_tokens, null);

let persistedBody = null;
const persistenceResult = await persistV4QualityLedger({
  ledger: {
    ...qualityRow,
    request_diagnostics: { authorization: "must-not-persist" },
    unexpected_legacy_field: "must-not-be-sent-to-postgrest"
  },
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test"
  },
  fetchImpl: async (_url, init = {}) => {
    persistedBody = JSON.parse(init.body || "{}");
    return { ok: true, status: 201, text: async () => JSON.stringify([persistedBody]) };
  }
});
assert.equal(persistenceResult.saved, true);
assert.equal(Object.hasOwn(persistedBody, "unexpected_legacy_field"), false);
assert.equal(Object.hasOwn(persistedBody, "request_diagnostics"), false);
assert.equal(persistedBody.pipeline_node_ledger.schema_version, "pipeline-end-to-end-node-ledger-v1");
assert.equal(JSON.stringify(persistedBody).includes("must-not-persist"), false);

let sessionWriteAttempts = 0;
const retriedSessionWrite = await updateV4RecognitionSessionWithRetry({
  sessionId: "session-observability-1",
  patch: { provider_result_summary: { noncritical_persistence_status: "COMPLETED" } },
  attempts: 3,
  retryBaseMs: 1,
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
    V4_SUPABASE_PATCH_TIMEOUT_MS: "1000"
  },
  fetchImpl: async () => {
    sessionWriteAttempts += 1;
    if (sessionWriteAttempts < 3) {
      return { ok: false, status: 503, text: async () => "temporary PostgREST failure" };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "session-observability-1" }]) };
  }
});
assert.equal(retriedSessionWrite.saved, true);
assert.equal(retriedSessionWrite.write_attempts, 3);
assert.equal(sessionWriteAttempts, 3);

console.log("pipeline node observability tests passed");
