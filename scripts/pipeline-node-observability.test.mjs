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
assert.equal(healthyLedger.nodes.find((node) => node.node_id === "catalog_stage_capacity")?.status, "SKIPPED");
assert.equal(healthyLedger.nodes.find((node) => node.node_id === "vector_stage_capacity")?.status, "SKIPPED");
assert.equal(JSON.stringify(healthyLedger).includes("sk-secret-value"), false);

const clientNetworkLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    preingestion_bundle_id: "bundle-client-network"
  },
  payload: {
    asset_id: "asset-client-network",
    images: [{}, {}],
    clientTiming: {
      client_upload_ms: 1400,
      client_storage_sign_ms: 180,
      client_storage_put_ms: 900,
      client_storage_verify_ms: 320,
      client_storage_sign_attempts: 3,
      client_storage_put_attempts: 2,
      client_storage_verify_attempts: 2,
      client_storage_image_count: 2,
      client_network_retry_count: 1,
      client_storage_recovered_upload_count: 1,
      client_background_prepare_ms: 1700,
      client_preingestion_request_ms: 300,
      client_preingestion_request_attempts: 1
    }
  }
});
const clientUploadNode = clientNetworkLedger.nodes.find((node) => node.node_id === "client_image_upload");
const clientPreingestionNode = clientNetworkLedger.nodes.find((node) => node.node_id === "client_preingestion_build");
assert.equal(clientUploadNode.metrics.signing_ms, 180);
assert.equal(clientUploadNode.metrics.retry_count, 1);
assert.equal(clientUploadNode.metrics.recovered_upload_count, 1);
assert.equal(clientPreingestionNode.metrics.request_ms, 300);
assert.equal(clientPreingestionNode.metrics.request_attempts, 1);

const droppedAtomicGradeLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, card_grade: "10" },
    resolved_fields: { ...fields, card_grade: "10", grade_type: "CARD_ONLY" },
    rendered_fields: { fields },
    final_title: "2024 Topps Chrome Test Player Autograph"
  },
  payload: {
    asset_id: "asset-observability-grade-drop",
    images: [{}, {}],
    preingestion_evidence_patches: [
      { field: "grade_company", value: "PSA" },
      { field: "card_grade", value: "10" }
    ]
  }
});
assert.equal(droppedAtomicGradeLedger.field_flow.grade_atomic.resolved.card_grade, true);
assert.equal(droppedAtomicGradeLedger.field_flow.grade_atomic.resolved.grade_company, false);
assert.equal(
  droppedAtomicGradeLedger.reconciliation.anomalies.some((item) => item.check_id === "resolved_grade_score_has_company"),
  true
);
assert.equal(
  droppedAtomicGradeLedger.reconciliation.anomalies.some((item) => item.check_id === "direct_grade_company_reaches_resolution"),
  true
);

const completeAtomicGradeLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, grade_company: "PSA", card_grade: "10" },
    resolved_fields: { ...fields, grade_company: "PSA", card_grade: "10", grade_type: "CARD_ONLY" },
    rendered_fields: { fields: { ...fields, grade_company: "PSA", card_grade: "10" } },
    final_title: "2024 Topps Chrome Test Player Autograph PSA 10"
  },
  payload: {
    asset_id: "asset-observability-grade-complete",
    images: [{}, {}],
    preingestion_evidence_patches: [
      { field: "grade_company", value: "PSA" },
      { field: "card_grade", value: "10" }
    ]
  }
});
assert.equal(
  completeAtomicGradeLedger.reconciliation.anomalies.some((item) => item.check_id.startsWith("direct_grade") || item.check_id === "resolved_grade_is_rendered"),
  false
);

const stageCapacityLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    timing: {
      ...context.timing,
      catalog_stage_capacity_wait_ms: 125,
      catalog_stage_capacity_controlled_count: 1,
      vector_stage_capacity_wait_ms: 240,
      vector_stage_capacity_controlled_count: 1,
      vector_stage_capacity_deferred_count: 1
    },
    catalog_stage_capacity: {
      coordinated: true,
      configured: true,
      acquired: true,
      released: true,
      slot: 2,
      attempts: 2,
      wait_ms: 125
    },
    vector_stage_capacity: {
      coordinated: true,
      configured: true,
      acquired: false,
      released: null,
      attempts: 4,
      wait_ms: 240,
      error: "stage_capacity_busy"
    }
  },
  payload: { asset_id: "asset-stage-capacity", images: [{}, {}] }
});
const catalogCapacityNode = stageCapacityLedger.nodes.find((node) => node.node_id === "catalog_stage_capacity");
const vectorCapacityNode = stageCapacityLedger.nodes.find((node) => node.node_id === "vector_stage_capacity");
assert.equal(catalogCapacityNode.status, "COMPLETED");
assert.equal(catalogCapacityNode.duration_ms, 125);
assert.equal(catalogCapacityNode.metrics.released, true);
assert.equal(vectorCapacityNode.status, "PARTIAL");
assert.equal(vectorCapacityNode.duration_ms, 240);
assert.equal(vectorCapacityNode.metrics.deferred_count, 1);

const missingStageReleaseLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    timing: {
      ...context.timing,
      catalog_stage_capacity_controlled_count: 1,
      catalog_stage_capacity_release_missing_count: 1
    },
    catalog_stage_capacity: {
      coordinated: true,
      configured: true,
      acquired: true,
      released: false,
      release_error: "temporary_release_failure"
    }
  },
  payload: { asset_id: "asset-stage-capacity-release-missing", images: [{}, {}] }
});
assert.equal(missingStageReleaseLedger.nodes.find((node) => node.node_id === "catalog_stage_capacity")?.status, "FAILED");
assert.equal(
  missingStageReleaseLedger.reconciliation.anomalies.some((item) => item.check_id === "catalog_stage_capacity_release_complete"),
  true
);

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

const storedVectorFeatureLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    timing: {
      stored_visual_feature_lookup_ms: 180,
      vector_retrieval_ms: 420
    },
    visual_feature_summary: {
      source: "supabase_stored_visual_embedding",
      feature_count: 2
    },
    vector_activation_funnel: {
      raw_candidate_count: 5,
      approved_candidate_count: 5,
      conflict_blocked_count: 5,
      prompt_candidate_count: 0
    },
    vector_runtime_status: "COMPLETED"
  },
  payload: { asset_id: "asset-stored-vector-features", images: [{}, {}] }
});
const storedFeatureNode = storedVectorFeatureLedger.nodes.find((node) => node.node_id === "stored_visual_feature_lookup");
const onlineEmbeddingNode = storedVectorFeatureLedger.nodes.find((node) => node.node_id === "vector_embedding");
assert.equal(storedFeatureNode.status, "COMPLETED");
assert.equal(storedFeatureNode.expected, true);
assert.equal(storedFeatureNode.output_count, 2);
assert.equal(onlineEmbeddingNode.status, "SKIPPED");
assert.equal(onlineEmbeddingNode.expected, false);
assert.equal(onlineEmbeddingNode.skip_reason, "precomputed_visual_features_reused");
assert.equal(storedVectorFeatureLedger.coverage.missing_required_node_ids.includes("vector_embedding"), false);

const trustBlockedCatalogLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    catalog_activation_funnel: {
      raw_candidate_count: 1,
      approved_candidate_count: 0,
      trust_blocked_count: 1,
      conflict_blocked_count: 0,
      prompt_candidate_count: 0
    }
  },
  payload: { asset_id: "asset-catalog-trust-blocked", images: [{}, {}] }
});
const trustBlockedCatalogNode = trustBlockedCatalogLedger.nodes.find((node) => node.node_id === "catalog_retrieval");
assert.equal(trustBlockedCatalogNode.metrics.trust_blocked_count, 1);
assert.equal(
  trustBlockedCatalogLedger.reconciliation.anomalies.some((item) => item.check_id === "catalog_candidate_drop_has_explanation"),
  false,
  "an unapproved shadow candidate is trust-blocked, not an unexplained drop"
);

const unclassifiedCatalogLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    catalog_activation_funnel: {
      raw_candidate_count: 1,
      approved_candidate_count: 0,
      trust_blocked_count: 0,
      conflict_blocked_count: 0,
      prompt_candidate_count: 0
    }
  },
  payload: { asset_id: "asset-catalog-unclassified", images: [{}, {}] }
});
assert.equal(
  unclassifiedCatalogLedger.reconciliation.anomalies.some((item) => item.check_id === "catalog_candidate_drop_has_explanation"),
  true,
  "an explicitly unclassified raw candidate must remain observable"
);

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

const v4PreloadedBundleLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    bundle_used: true,
    preingestion_bundle_id: "bundle-loaded-by-v4"
  },
  timingContext: context,
  payload: {
    asset_id: "asset-v4-preloaded-bundle",
    images: [{}, {}],
    preingestion_bundle_used: true,
    v4_pre_l2_bundle_loaded: true
  }
});
const v4PreloadedBundleNode = v4PreloadedBundleLedger.nodes.find((node) => node.node_id === "preingestion_bundle_load");
assert.equal(v4PreloadedBundleNode.status, "SKIPPED");
assert.equal(v4PreloadedBundleNode.expected, false);
assert.equal(v4PreloadedBundleNode.skip_reason, "bundle_already_loaded_by_v4_pre_l2");
assert.equal(v4PreloadedBundleLedger.coverage.missing_required_node_ids.includes("preingestion_bundle_load"), false);

const noNewPatchRefreshLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    preingestion_evidence_refresh: {
      refreshed: false,
      reason: "no_new_ocr_patches",
      patch_count: 6,
      added_patch_count: 0
    }
  },
  payload: { asset_id: "asset-no-new-ocr-patches", images: [{}, {}] }
});
const noNewPatchRefreshNode = noNewPatchRefreshLedger.nodes.find((node) => node.node_id === "preingestion_evidence_refresh");
assert.equal(noNewPatchRefreshNode.status, "SKIPPED");
assert.equal(noNewPatchRefreshNode.expected, false);
assert.equal(noNewPatchRefreshNode.skip_reason, "no_new_ocr_patches");
assert.equal(noNewPatchRefreshLedger.coverage.missing_required_node_ids.includes("preingestion_evidence_refresh"), false);

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

const safelyRejectedInitialsLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: {
      ...fields,
      player: "Shohei Ohtani",
      collector_number: "SO"
    },
    resolved_fields: fields,
    rendered_fields: { fields }
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-rejected-initials", images: [{}, {}] }
});
const safelyRejectedCollectorFlow = safelyRejectedInitialsLedger.field_flow.fields
  .find((row) => row.field_group === "collector_number");
assert.equal(safelyRejectedInitialsLedger.field_flow.unexplained_resolution_drop_count, 0);
assert.equal(safelyRejectedInitialsLedger.field_flow.normalization_guard_rejection_count, 1);
assert.deepEqual(safelyRejectedInitialsLedger.field_flow.normalization_guard_rejection_fields, ["collector_number"]);
assert.equal(safelyRejectedCollectorFlow?.disposition, "INTENTIONALLY_REJECTED_BY_NORMALIZATION_GUARD");
assert.equal(safelyRejectedCollectorFlow?.normalization_guard_rejected, true);
assert.equal(safelyRejectedCollectorFlow?.normalization_guard_candidate_count, 1);
assert.equal(safelyRejectedCollectorFlow?.normalization_guard_accepted_count, 0);
assert.deepEqual(safelyRejectedCollectorFlow?.normalization_guard_source_fields, ["collector_number"]);
assert.equal(
  safelyRejectedInitialsLedger.reconciliation.anomalies
    .some((item) => item.check_id === "critical_field_flow_has_no_silent_drop"),
  false
);

const validCodeStillDroppedLedger = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: {
      ...fields,
      player: "Shohei Ohtani",
      collector_number: "RMS-SO"
    },
    resolved_fields: fields,
    rendered_fields: { fields }
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-valid-code-drop", images: [{}, {}] }
});
const validCodeCollectorFlow = validCodeStillDroppedLedger.field_flow.fields
  .find((row) => row.field_group === "collector_number");
assert.deepEqual(validCodeStillDroppedLedger.field_flow.unexplained_resolution_drop_fields, ["collector_number"]);
assert.equal(validCodeCollectorFlow?.disposition, "UNEXPLAINED_RESOLUTION_DROP");
assert.equal(validCodeCollectorFlow?.normalization_guard_rejected, false);
assert.equal(validCodeCollectorFlow?.normalization_guard_accepted_count, 1);

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

const finalizerLedger = buildEndToEndNodeLedger({
  session: {
    ...endToEndLedger.session,
    l2_status: "READY",
    l2_title: "2024 Topps Chrome Test Player Autograph",
    provider_result_summary: {
      pipeline_node_ledger: healthyLedger,
      title_render_source: "deterministic_renderer_finalizer",
      noncritical_persistence_status: "COMPLETED"
    }
  },
  job: {
    id: "job-observability-finalizer",
    status: "SUCCEEDED",
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z"
  },
  display: { can_writer_start: true }
});
assert.equal(finalizerLedger.reconciliation.error_count, 0);

const terminalDropLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "Topps Chrome Autograph",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    resolved_fields: {
      manufacturer: "Topps",
      product: "Chrome",
      card_name: "Autograph"
    },
    provider_result_summary: {
      pipeline_node_ledger: healthyLedger,
      title_render_source: "v4_csm_deterministic_renderer",
      noncritical_persistence_status: "COMPLETED",
      noncritical_persistence_summary: { saved_count: 4, failed_count: 0, artifact_count: 4 }
    }
  },
  job: {
    id: "job-observability-terminal-drop",
    status: "SUCCEEDED",
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z"
  },
  display: { can_writer_start: true }
});
assert.equal(terminalDropLedger.field_flow.unexplained_terminal_drop_count, 2);
assert.deepEqual(terminalDropLedger.field_flow.unexplained_terminal_drop_fields, ["year", "subject"]);
assert.equal(
  terminalDropLedger.reconciliation.anomalies.some((item) => item.check_id === "terminal_critical_field_flow_has_no_silent_drop"),
  true
);

const reviewedTerminalDropLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "Topps Chrome Test Player",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    resolved_fields: {
      manufacturer: "Topps",
      product: "Chrome",
      players: ["Test Player"]
    },
    provider_result_summary: {
      pipeline_node_ledger: {
        ...healthyLedger,
        field_flow: {
          ...healthyLedger.field_flow,
          fields: healthyLedger.field_flow.fields.map((row) => (
            row.field_group === "year"
              ? { ...row, raw_provider_present: true, resolved_present: true, review_flagged: true }
              : row
          ))
        }
      },
      title_render_source: "v4_csm_deterministic_renderer",
      noncritical_persistence_status: "COMPLETED"
    }
  },
  job: {
    id: "job-observability-reviewed-terminal-drop",
    status: "SUCCEEDED",
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z"
  },
  display: { can_writer_start: true }
});
assert.ok(
  reviewedTerminalDropLedger.field_flow.unexplained_terminal_drop_fields.includes("year"),
  "REVIEW metadata must not hide a value lost after upstream resolution"
);

const printRunMigrationBase = buildPipelineNodeLedger({
  result: {
    ...healthyResult,
    raw_provider_fields: { ...fields, card_number: "03/10" },
    resolved_fields: {
      ...fields,
      card_number: "03/10",
      serial_number: "03/10",
      print_run_number: "03/10"
    },
    rendered_fields: {
      fields: {
        ...fields,
        card_number: "03/10",
        print_run_number: "03/10"
      }
    },
    final_title: "2024 Topps Chrome Test Player Autograph 03/10"
  },
  timingContext: context,
  payload: { asset_id: "asset-observability-print-run-migration", images: [{}, {}] }
});
const printRunMigrationLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "2024 Topps Chrome Test Player Autograph 03/10",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    resolved_fields: {
      ...fields,
      serial_number: "03/10",
      print_run_number: "03/10",
      numerical_rarity: "03/10"
    },
    provider_result_summary: {
      pipeline_node_ledger: printRunMigrationBase,
      title_render_source: "v4_csm_deterministic_renderer",
      noncritical_persistence_status: "COMPLETED"
    }
  },
  job: {
    id: "job-observability-print-run-migration",
    status: "SUCCEEDED",
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z"
  },
  display: { can_writer_start: true }
});
const migratedCollectorFlow = printRunMigrationLedger.field_flow.fields
  .find((row) => row.field_group === "collector_number");
assert.equal(migratedCollectorFlow?.disposition, "MIGRATED_TO_NUMERICAL_RARITY");
assert.equal(migratedCollectorFlow?.terminal_semantic_migration, true);
assert.equal(printRunMigrationLedger.field_flow.unexplained_terminal_drop_count, 0);
assert.equal(
  printRunMigrationLedger.reconciliation.anomalies
    .some((item) => item.check_id === "terminal_critical_field_flow_has_no_silent_drop"),
  false
);

const writerReviewLedger = buildEndToEndNodeLedger({
  session: {
    status: "WRITER_REVIEW",
    l2_status: "READY",
    l2_title: "",
    final_title: "",
    l2_ready_at: "2026-07-11T00:00:02.900Z",
    provider_result_summary: {
      assisted_draft_status: "REVIEW_REQUIRED",
      writer_review_required: true,
      title_render_source: "identity_resolution_abstain",
      noncritical_persistence_status: "COMPLETED",
      noncritical_persistence_summary: { saved_count: 4, failed_count: 0, artifact_count: 4 }
    }
  },
  job: {
    id: "job-observability-writer-review",
    batch_id: "batch-observability-writer-review",
    lane: "interactive",
    job_type: "final_assisted_title",
    status: "L2_READY",
    attempt_count: 1,
    max_attempts: 3,
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z"
  },
  timing: {
    scheduler_queue_wait_ms: 500,
    worker_processing_ms: 2500,
    time_to_l2_ready_ms: 2900
  },
  display: { can_writer_start: true, display_status: "WRITER_REVIEW", writer_status: "REVIEW_REQUIRED" }
});
assert.equal(writerReviewLedger.nodes.find((node) => node.node_id === "worker_execution")?.status, "COMPLETED");
assert.equal(writerReviewLedger.nodes.find((node) => node.node_id === "full_l2_provider_decision")?.status, "COMPLETED");
assert.equal(writerReviewLedger.nodes.find((node) => node.node_id === "writer_ready")?.status, "COMPLETED");
assert.equal(writerReviewLedger.nodes.find((node) => node.node_id === "csm_title_serialization")?.status, "SKIPPED");
assert.equal(writerReviewLedger.nodes.some((node) => node.status === "RUNNING"), false);
assert.equal(writerReviewLedger.reconciliation.error_count, 0);

const preL2AnchorLedger = buildEndToEndNodeLedger({
  session: {
    l2_status: "READY",
    l2_title: "2022 One Piece Romance Dawn Shanks OP01-120",
    l2_ready_at: "2026-07-11T00:00:01.500Z",
    provider_result_summary: {
      title_render_source: "pre_l2_anchor_catalog_finalized",
      v4_l2_timing: {
        pre_l2_bundle_load_ms: 120,
        pre_l2_anchor_probe_ms: 340,
        pre_l2_anchor_route: "TCG_EXACT_LOOKUP",
        pre_l2_anchor_finalize_reason: "exact_anchor_catalog_finalized",
        pre_l2_anchor_patch_count: 3,
        pre_l2_anchor_candidate_count: 1,
        pre_l2_anchor_direct_candidate_count: 1,
        pre_l2_anchor_type_breakdown: { tcg_card_code: 1 },
        pre_l2_anchor_lookup_attempted: true,
        pre_l2_anchor_catalog_candidate_count: 1,
        pre_l2_anchor_trusted_candidate_count: 1,
        pre_l2_anchor_eligible_candidate_count: 1,
        pre_l2_full_l2_skipped: true
      },
      noncritical_persistence_status: "COMPLETED",
      noncritical_persistence_summary: { saved_count: 4, failed_count: 0, artifact_count: 4 }
    }
  },
  job: {
    id: "job-observability-anchor",
    status: "SUCCEEDED",
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.200Z",
    completed_at: "2026-07-11T00:00:01.700Z"
  },
  display: { can_writer_start: true }
});
assert.equal(preL2AnchorLedger.nodes.find((node) => node.node_id === "csm_title_serialization")?.status, "COMPLETED");
assert.equal(preL2AnchorLedger.nodes.find((node) => node.node_id === "pre_l2_anchor_extract_route_lookup")?.status, "COMPLETED");
assert.equal(preL2AnchorLedger.nodes.find((node) => node.node_id === "pre_l2_anchor_extract_route_lookup")?.metrics.direct_anchor_count, 1);
assert.equal(preL2AnchorLedger.nodes.find((node) => node.node_id === "pre_l2_anchor_extract_route_lookup")?.metrics.eligible_candidate_count, 1);
assert.equal(preL2AnchorLedger.nodes.find((node) => node.node_id === "full_l2_provider_decision")?.status, "SKIPPED");
assert.equal(preL2AnchorLedger.reconciliation.error_count, 0);

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
  display: { can_writer_start: true },
  observedAtMs: Date.parse("2026-07-11T00:00:10.000Z")
});
assert.equal(deferredPersistenceLedger.reconciliation.anomalies.some((item) => item.check_id === "production_observability_persistence_terminal"), false);

const staleDeferredPersistenceLedger = buildEndToEndNodeLedger({
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
    id: "job-observability-stale-deferred",
    status: "L2_READY",
    created_at: "2026-07-11T00:00:00.000Z",
    started_at: "2026-07-11T00:00:00.500Z",
    completed_at: "2026-07-11T00:00:03.000Z"
  },
  display: { can_writer_start: true },
  observedAtMs: Date.parse("2026-07-11T00:01:04.000Z")
});
assert.equal(staleDeferredPersistenceLedger.reconciliation.anomalies.some((item) => item.check_id === "production_observability_persistence_terminal"), true);

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
