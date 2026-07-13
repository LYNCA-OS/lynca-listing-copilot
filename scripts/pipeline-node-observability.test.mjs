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
  provider_response_profile: "compact_sparse_v1",
  provider_image_detail: "low",
  provider_text_verbosity: "low",
  provider_requested_service_tier: "priority",
  provider_service_tier: "priority",
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
assert.equal(healthyLedger.nodes.find((node) => node.node_id === "provider")?.metrics.service_tier, "priority");
assert.equal(JSON.stringify(healthyLedger).includes("sk-secret-value"), false);

const deadlineContext = createTimingContext({
  asset_id: "asset-observability-deadline",
  images: [{}, {}]
});
deadlineContext.timing.post_observation_retrieval_deadline_ms = 1800;
deadlineContext.timing.post_observation_retrieval_deferred_count = 2;
deadlineContext.timing.post_observation_catalog_settled_within_budget_count = 0;
deadlineContext.timing.post_observation_vector_settled_within_budget_count = 0;
const deadlineLedger = buildPipelineNodeLedger({
  result: { ...healthyResult, timing: deadlineContext.timing },
  timingContext: deadlineContext,
  payload: { asset_id: "asset-observability-deadline", images: [{}, {}] }
});
const deadlineNode = deadlineLedger.nodes.find((node) => node.node_id === "post_observation_retrieval_deadline");
assert.equal(deadlineNode.status, "PARTIAL");
assert.equal(deadlineNode.duration_ms, 1800);
assert.equal(deadlineNode.output_count, 0);
assert.equal(deadlineNode.metrics.deferred_count, 2);

const presentationRetainedLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, surface_color: "Red" },
    resolved_fields: fields,
    rendered_fields: { fields: { ...fields, surface_color: "Red" } }
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-presentation", images: [{}, {}] }
});
assert.equal(presentationRetainedLedger.field_flow.unexplained_resolution_drop_count, 0);
assert.equal(
  presentationRetainedLedger.field_flow.fields.find((row) => row.field_group === "surface_color")?.disposition,
  "RETAINED_IN_PRESENTATION"
);

const catalogTraceWithoutTimingLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    timing: {},
    catalog_activation_funnel: {
      raw_candidate_count: 5,
      approved_candidate_count: 5,
      conflict_blocked_count: 5,
      prompt_candidate_count: 0
    }
  },
  payload: { asset_id: "asset-observability-retry-trace", images: [{}, {}] }
});
const catalogTraceNode = catalogTraceWithoutTimingLedger.nodes.find((node) => node.node_id === "catalog_retrieval");
assert.equal(catalogTraceNode.status, "COMPLETED", "a persisted catalog trace proves execution even when retry timing was not retained");
assert.equal(catalogTraceNode.metrics.trace_observed, true);
assert.equal(catalogTraceNode.metrics.timing_observed, false);
assert.equal(catalogTraceWithoutTimingLedger.coverage.missing_required_node_ids.includes("catalog_retrieval"), false);

const preloadedOcrPatchLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    bundle_used: true,
    preingestion_ocr_rendezvous: {
      status: "CRITICAL_FIELDS_SETTLED",
      terminal: true,
      job_count: 2,
      patch_count: 2
    }
  },
  payload: { asset_id: "asset-preloaded-ocr-patches", images: [{}, {}] }
});
const preloadedRefreshNode = preloadedOcrPatchLedger.nodes.find((node) => node.node_id === "preingestion_evidence_refresh");
assert.equal(preloadedRefreshNode.status, "SKIPPED");
assert.equal(preloadedRefreshNode.expected, false);
assert.equal(preloadedRefreshNode.skip_reason, "ocr_patches_already_available_or_no_refresh_needed");
assert.equal(preloadedOcrPatchLedger.coverage.missing_required_node_ids.includes("preingestion_evidence_refresh"), false);

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

const reviewedArrayStateLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, collector_number: "PA-ANT" },
    resolved_fields: fields,
    rendered_fields: { fields },
    field_states: [{ field_name: "card_number", display_status: "CONFLICT" }]
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-reviewed-array", images: [{}, {}] }
});
assert.equal(reviewedArrayStateLedger.field_flow.unexplained_resolution_drop_count, 0);
assert.equal(
  reviewedArrayStateLedger.field_flow.fields.find((row) => row.field_group === "collector_number")?.disposition,
  "INTENTIONALLY_ROUTED_TO_REVIEW"
);

const suppressedParallelReviewLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, parallel_exact: "Sapphire" },
    resolved_fields: fields,
    rendered_fields: { fields },
    unresolved: ["parallel_exact"]
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-parallel-review", images: [{}, {}] }
});
assert.equal(suppressedParallelReviewLedger.field_flow.unexplained_resolution_drop_count, 0);
assert.equal(
  suppressedParallelReviewLedger.field_flow.fields.find((row) => row.field_group === "parallel_exact")?.disposition,
  "INTENTIONALLY_ROUTED_TO_REVIEW"
);

const safelyNarrowedParallelLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, parallel_exact: "Silver Prizm", surface_color: "Silver" },
    resolved_fields: { ...fields, surface_color: "Silver" },
    rendered_fields: { fields: { ...fields, surface_color: "Silver" } },
    open_set_presentation_guard: {
      used: true,
      action: "downgraded_exact_parallel_to_surface_color",
      preserved_surface_color: "Silver"
    }
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-parallel-narrowed", images: [{}, {}] }
});
assert.equal(safelyNarrowedParallelLedger.field_flow.unexplained_resolution_drop_count, 0);
assert.equal(
  safelyNarrowedParallelLedger.field_flow.fields.find((row) => row.field_group === "parallel_exact")?.disposition,
  "NARROWED_TO_SUPPORTED_SURFACE_COLOR"
);

const mismatchedParallelNarrowingLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, parallel_exact: "Sapphire" },
    resolved_fields: { ...fields, surface_color: "Red" },
    rendered_fields: { fields: { ...fields, surface_color: "Red" } }
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-parallel-mismatch", images: [{}, {}] }
});
assert.deepEqual(mismatchedParallelNarrowingLedger.field_flow.unexplained_resolution_drop_fields, ["parallel_exact"]);

const compositeParallelLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, parallel_exact: "Tie-Dye Prizm" },
    resolved_fields: { ...fields, card_name: "Rookie Patch Auto Tie-Dye Prizm" },
    rendered_fields: { fields: { ...fields, card_name: "Rookie Patch Auto Tie-Dye Prizm" } },
    final_title: "2024 Panini Select Test Player Rookie Patch Auto Tie-Dye Prizm"
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-composite-parallel", images: [{}, {}] }
});
assert.equal(compositeParallelLedger.field_flow.unexplained_resolution_drop_count, 0);
assert.equal(compositeParallelLedger.field_flow.composite_token_migration_count, 1);
assert.equal(
  compositeParallelLedger.field_flow.fields.find((row) => row.field_group === "parallel_exact")?.disposition,
  "RETAINED_AS_COMPOSITE_TOKEN"
);
assert.equal(compositeParallelLedger.reconciliation.error_count, 0);
assert.equal(
  compositeParallelLedger.reconciliation.anomalies.find((item) => item.check_id === "field_flow_has_no_cross_bracket_composite_migration")?.severity,
  "WARNING"
);

const titleOnlyParallelLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, parallel_exact: "Sapphire" },
    resolved_fields: fields,
    rendered_fields: { fields },
    final_title: "2024 Topps Chrome Test Player Sapphire"
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-title-only-parallel", images: [{}, {}] }
});
assert.deepEqual(
  titleOnlyParallelLedger.field_flow.unexplained_resolution_drop_fields,
  ["parallel_exact"],
  "a title token without a canonical composite destination must remain a real field-flow error"
);

const endToEndLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "2024 Topps Chrome Test Player Autograph",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    provider_result_summary: {
      pipeline_node_ledger: healthyLedger,
      title_render_source: "v4_csm_deterministic_renderer",
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
assert.equal(endToEndLedger.nodes.find((node) => node.node_id === "csm_title_serialization")?.status, "COMPLETED");
assert.equal(endToEndLedger.reconciliation.error_count, 0);

const deferredPersistenceLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "2024 Topps Chrome Test Player Autograph",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    provider_result_summary: {
      pipeline_node_ledger: healthyLedger,
      title_render_source: "v4_csm_deterministic_renderer",
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
