import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildFastScoutListingResult,
  selectFastScoutImages
} from "../lib/listing/v4/fast-scout/fast-scout-observation.mjs";
import { runV4Prewarm, v4DeploymentInfo } from "../lib/listing/v4/prewarm.mjs";
import { adaptV2ResultToV4, buildV4PersistenceRows } from "../lib/listing/v4/result-adapter.mjs";
import { buildV4FieldGraph, buildV4FieldStates, buildV4ResolvedFields } from "../lib/listing/v4/evidence/field-evidence.mjs";
import { buildV4FeedbackArtifacts } from "../lib/listing/v4/feedback/feedback-loop.mjs";
import { planV4RecognitionRoute } from "../lib/listing/v4/route-planner/route-planner.mjs";
import {
  explicitlyUncertainIdentityFields,
  normalizeFields,
  normalizePrintedCardCodeForFields
} from "../lib/listing/pipeline/field-normalization.mjs";
import {
  buildV4TitleStageState,
  providerOptionsForV4BackgroundL2,
  providerOptionsForV4ProgressiveL1,
  v4TitleStages
} from "../lib/listing/v4/stages/title-stages.mjs";
import {
  checkV4Tables,
  createV4RecognitionSession,
  persistV4CandidateTrace,
  persistV4FieldEvidence,
  persistV4LearningEvent,
  persistV4NonCriticalArtifactsAtomic,
  persistV4WriterFeedbackTransaction,
  updateV4RecognitionSession
} from "../lib/listing/v4/session/session-store.mjs";
import {
  batchStatusResponseDisposition,
  mergeJobDiagnosticsIntoResult,
  numberArg as smokeNumberArg,
  numberOrNull as smokeNumberOrNull,
  perCardTsv,
  providerDoneHandoffOverride,
  summarize as summarizeSmoke,
  summarizePipelineNodeLedgers,
  summaryHasVisibleL2Title,
  summaryRequiresWriterReview
} from "./v4-ebay-smoke.mjs";

assert.equal(smokeNumberArg(["node", "smoke"], "--request-timeout-ms", 90_000), 90_000);
assert.equal(smokeNumberArg(["node", "smoke", "--request-timeout-ms", ""], "--request-timeout-ms", 90_000), 90_000);
assert.equal(smokeNumberArg(["node", "smoke", "--offset", "0"], "--offset", 12), 0);
assert.equal(smokeNumberArg(["node", "smoke", "--limit", "not-a-number"], "--limit", 10), 10);
assert.equal(summaryHasVisibleL2Title({ session_status: "DRAFT_READY", l2_status: "READY", title: "Final title" }), true);
assert.equal(typeof summaryHasVisibleL2Title({ session_status: "DRAFT_READY", l2_status: "READY", title: "Final title" }), "boolean");
assert.equal(summaryHasVisibleL2Title({ session_status: "DRAFT_READY", l2_status: "READY", title: "" }), false);
assert.equal(summaryRequiresWriterReview({ session_status: "WRITER_REVIEW", l2_status: "READY", title: "" }), true);
assert.equal(summaryRequiresWriterReview({ session_status: "FAILED", l2_status: "FAILED", title: "" }), false);
assert.equal(smokeNumberOrNull(null), null, "missing optional timings must not be forged as zero");
assert.equal(smokeNumberOrNull(undefined), null, "missing optional token counts must stay missing");
assert.equal(smokeNumberOrNull(""), null, "empty optional diagnostics must stay missing");
assert.equal(smokeNumberOrNull(0), 0, "a real observed zero must remain zero");

const smokeTsv = perCardTsv([{
  asset_id: "asset-timing",
  ok: true,
  recognition_started_at: "2026-07-14T00:00:01.000Z",
  recognition_start_source: "gpt_provider_request",
  writer_visible_recognition_ms: 7_500,
  pipeline_node_ledger: {
    reconciliation: {},
    coverage: {},
    field_flow: {
      unexplained_resolution_drop_fields: ["grade"],
      unexplained_terminal_drop_fields: []
    }
  }
}]).split("\n").slice(0, 2).map((line) => line.split("\t"));
assert.equal(smokeTsv[0].length, smokeTsv[1].length, "per-card TSV columns must not silently shift");
const smokeTsvRow = Object.fromEntries(smokeTsv[0].map((column, index) => [column, smokeTsv[1][index]]));
assert.equal(smokeTsvRow.recognition_start_source, "gpt_provider_request");
assert.equal(smokeTsvRow.writer_visible_recognition_ms, "7500");
assert.equal(smokeTsvRow.unexplained_resolution_drop_fields, "grade");

const pipelineLedgerSummary = summarizePipelineNodeLedgers([
  {
    asset_id: "asset-terminal-drop",
    pipeline_node_ledger: {
      nodes: [],
      coverage: { missing_required_node_count: 0 },
      field_flow: {
        unexplained_terminal_drop_count: 1,
        fields: [{
          field_group: "year",
          raw_provider_present: true,
          evidence_present: true,
          resolved_present: true,
          rendered_present: true,
          terminal_resolved_present: false,
          disposition: "UNEXPLAINED_TERMINAL_DROP",
          terminal_drop_reason: "upstream_resolved_value_missing_from_v4_session"
        }],
        grade_atomic: {
          terminal: { grade_company: true, card_grade: false, auto_grade: false }
        }
      },
      reconciliation: {
        anomaly_count: 1,
        error_count: 1,
        warning_count: 0,
        anomalies: [{
          check_id: "terminal_critical_field_flow_has_no_silent_drop",
          severity: "ERROR"
        }]
      }
    }
  }
]);
assert.equal(pipelineLedgerSummary.schema_version, "pipeline-node-ledger-summary-v2");
assert.equal(pipelineLedgerSummary.field_quality_error_count, 1);
assert.equal(pipelineLedgerSummary.transport_error_count, 0);
assert.equal(pipelineLedgerSummary.unexplained_terminal_drop_count, 1);
assert.equal(pipelineLedgerSummary.unexplained_terminal_drop_card_count, 1);
assert.deepEqual(pipelineLedgerSummary.unexplained_terminal_drop_field_breakdown, { year: 1 });
assert.equal(pipelineLedgerSummary.terminal_grade_atomic.company_without_score_count, 1);
assert.equal(providerDoneHandoffOverride(["node", "smoke"]), null, "omitted handoff mode must inherit production configuration");
assert.equal(providerDoneHandoffOverride(["node", "smoke", "--provider-done-handoff"]), true);
assert.equal(providerDoneHandoffOverride(["node", "smoke", "--no-provider-done-handoff"]), false);
assert.throws(
  () => providerDoneHandoffOverride(["node", "smoke", "--provider-done-handoff", "--no-provider-done-handoff"]),
  /mutually exclusive/
);
assert.equal(batchStatusResponseDisposition({ ok: true, http_status: 200 }), "ok");
assert.equal(batchStatusResponseDisposition({ ok: false, http_status: 503, data: { retryable: true } }), "retry");
assert.equal(batchStatusResponseDisposition({ ok: false, http_status: 400, data: { message: "Unable to read V4 jobs." } }), "retry");
assert.equal(batchStatusResponseDisposition({ ok: false, http_status: 400, data: { message: "batch_id required" } }), "fatal");
assert.equal(batchStatusResponseDisposition({ ok: false, http_status: 401 }), "fatal");

const reviewAwareSmokeSummary = summarizeSmoke([{
  asset_id: "asset-title-ready",
  ok: true,
  writer_ready: true,
  l2_ready: true,
  final_title: "2024 Topps Chrome Test Player"
}, {
  asset_id: "asset-writer-review",
  ok: true,
  writer_ready: true,
  l2_ready: true,
  writer_review_required: true,
  final_title: ""
}], { runWallMs: 10_000 });
assert.equal(reviewAwareSmokeSummary.ok_count, 2);
assert.equal(reviewAwareSmokeSummary.technical_failure_count, 0);
assert.equal(reviewAwareSmokeSummary.title_ready_count, 1);
assert.equal(reviewAwareSmokeSummary.writer_review_required_count, 1);

const hydratedDiagnostic = mergeJobDiagnosticsIntoResult({
  asset_id: "asset-hydrate",
  job_id: "job-hydrate",
  pipeline_node_ledger: null,
  input_tokens: 10
}, {
  jobs: [{
    job_id: "job-hydrate",
    status: "L2_READY",
    attempt_count: 2,
    error: {
      resolved: true,
      attempt_history: [{ attempt: 1, code: "QUEUE_COMPLETION_WRITE_FAILED", message: "Postgres rejected NUL" }]
    },
    timing: {
      worker_queue_wait_ms: 125,
      worker_processing_ms: 22500,
      completion_payload_sanitized_nul_count: 1,
      writer_ready_capacity_release: {
        released: true,
        release_boundary: "writer_ready_atomic"
      },
      writer_ready_capacity_refill: { triggered: true, lane: "background" }
    },
    execution_control: {
      provider_capacity_slot: 1,
      provider_key_slot: 1,
      provider_capacity: 2,
      provider_key_count: 2,
      provider_key_assignment: "balanced_round_robin_v1"
    },
    end_to_end_node_ledger: { coverage: { missing_required_node_count: 0 }, nodes: [] },
    session: {
      status: "DRAFT_READY",
      l2_status: "READY",
      provider_result_summary: {
        final_title: "Hydrated title",
        noncritical_persistence_status: "COMPLETED",
        writer_ready_capacity_release_mode: "writer_ready_atomic",
        writer_ready_capacity_refill: { triggered: true, lane: "background" },
        provider_token_diagnostics: { input_tokens: 99, output_tokens: 11, total_tokens: 110 },
        preingestion_ocr_rendezvous: { status: "EVIDENCE_READY", job_count: 2 }
      }
    }
  }]
});
assert.equal(hydratedDiagnostic.job_status, "L2_READY");
assert.equal(hydratedDiagnostic.attempt_count, 2);
assert.deepEqual(hydratedDiagnostic.retry_error_codes, ["QUEUE_COMPLETION_WRITE_FAILED"]);
assert.equal(hydratedDiagnostic.retry_attempt_history[0].attempt, 1);
assert.equal(hydratedDiagnostic.completion_payload_sanitized_nul_count, 1);
assert.equal(hydratedDiagnostic.worker_processing_ms, 22500);
assert.equal(hydratedDiagnostic.input_tokens, 99);
assert.equal(hydratedDiagnostic.pipeline_node_ledger.coverage.missing_required_node_count, 0);
assert.equal(hydratedDiagnostic.preingestion_ocr_rendezvous.status, "EVIDENCE_READY");
assert.equal(hydratedDiagnostic.writer_ready_capacity_release_mode, "writer_ready_atomic");
assert.equal(hydratedDiagnostic.writer_ready_capacity_refill.triggered, true);
assert.equal(hydratedDiagnostic.provider_key_count, 2);
assert.equal(hydratedDiagnostic.provider_key_slot, 1);
assert.equal(hydratedDiagnostic.provider_key_assignment, "balanced_round_robin_v1");

const speedSmokeSummary = summarizeSmoke([{
  ok: true,
  writer_ready_capacity_release: { released: true },
  writer_ready_capacity_refill: { triggered: true },
  writer_ready_capacity_release_mode: "writer_ready_atomic",
  provider_key_assignment: "balanced_round_robin_v1",
  pipeline_node_ledger: {
    nodes: [],
    coverage: { missing_required_node_count: 0 },
    reconciliation: {
      anomaly_count: 1,
      error_count: 1,
      warning_count: 0,
      anomalies: [{
        check_id: "critical_field_flow_has_no_silent_drop",
        severity: "ERROR"
      }]
    }
  }
}]);
assert.equal(speedSmokeSummary.pipeline_node_observability.transport_error_count, 0);
assert.equal(speedSmokeSummary.pipeline_node_observability.field_quality_error_count, 1);
assert.equal(speedSmokeSummary.writer_ready_capacity_atomic_count, 1);
assert.equal(speedSmokeSummary.provider_key_assignment_breakdown.balanced_round_robin_v1, 1);

for (const code of ["PA-ANT", "83T-6", "OP01-001", "CT14-EN001", "EN001", "201/165", "PAU", "SV2A 201/165"]) {
  assert.equal(normalizePrintedCardCodeForFields(code), code, `${code} should remain a valid compact printed code`);
}
assert.equal(
  normalizePrintedCardCodeForFields("TRAEYOUNG", { players: ["Trae Young"] }),
  null,
  "a whitespace-free subject name must not become a printed card code"
);
for (const text of [
  "2026PANINI-PRIZMFIFAW0RLDCUP2026TMS0",
  "2026 Panini Prizm FIFA World Cup",
  "SIG GOLD BREAKAWAY"
]) {
  assert.equal(normalizePrintedCardCodeForFields(text), null, `${text} must not become a retrieval anchor`);
}

const explicitAlternativeFields = {
  set: "Sword & Shield—Evolving Skies (or Darkness Ablaze?)",
  product: "Pokemon TCG",
  card_name: "What If...?",
  players: ["Jalen Brunson"]
};
assert.deepEqual(
  explicitlyUncertainIdentityFields(explicitAlternativeFields),
  ["set"],
  "only explicit identity alternatives should be routed to review"
);
const explicitAlternativeNormalized = normalizeFields(explicitAlternativeFields);
assert.equal(explicitAlternativeNormalized.set, null);
assert.equal(explicitAlternativeNormalized.product, "Pokemon TCG");
assert.equal(explicitAlternativeNormalized.card_name, "What If...?", "legitimate question-mark card names must survive");
assert.deepEqual(explicitAlternativeNormalized.players, ["Jalen Brunson"]);

const nonSportSubjectAlias = normalizeFields({
  subject: "Wolverine",
  card_name: "Wolverine"
});
assert.deepEqual(nonSportSubjectAlias.players, ["Wolverine"]);
assert.equal(nonSportSubjectAlias.player, "Wolverine");

const subjectArrayAlias = normalizeFields({ subjects: ["Wolverine", "Deadpool"] });
assert.deepEqual(subjectArrayAlias.players, ["Wolverine", "Deadpool"]);

const v4CodeSanitizedFields = buildV4ResolvedFields({
  resolved_fields: {
    players: ["Trae Young"],
    card_number: "TRAE YOUNG",
    collector_number: "TRAE YOUNG",
    checklist_code: "TRAE YOUNG"
  }
});
assert.equal(v4CodeSanitizedFields.card_number, null);
assert.equal(v4CodeSanitizedFields.collector_number, null);
assert.equal(v4CodeSanitizedFields.checklist_code, null);
const duplicatePrintRunCodeFields = buildV4ResolvedFields({
  resolved_fields: {
    print_run_number: "03/15",
    serial_number: "03/15",
    card_number: "03/15",
    collector_number: "03/15",
    checklist_code: "03/15"
  }
});
assert.equal(duplicatePrintRunCodeFields.print_run_number, "03/15");
assert.equal(duplicatePrintRunCodeFields.card_number, null);
assert.equal(duplicatePrintRunCodeFields.collector_number, null);
assert.equal(duplicatePrintRunCodeFields.checklist_code, null);
const tcgSlashCardNumberRemainsIdentityCode = buildV4ResolvedFields({
  resolved_fields: {
    card_number: "201/165",
    collector_number: "201/165"
  }
});
assert.equal(tcgSlashCardNumberRemainsIdentityCode.card_number, "201/165");
assert.equal(tcgSlashCardNumberRemainsIdentityCode.collector_number, "201/165");
const invalidDecimalCodeGraph = buildV4FieldGraph({
  resolved_fields: {
    players: ["Keldon Johnson"],
    card_number: "4.8",
    collector_number: "4.8"
  }
});
assert.equal(invalidDecimalCodeGraph.card_number, null, "invalid decimal OCR noise must not survive in the V4 field graph");
const invalidDecimalCodeState = buildV4FieldStates({
  resolved_fields: { card_number: "4.8", collector_number: "4.8" }
});
assert.equal(invalidDecimalCodeState.card_number.value, null);

const conflictSuppressedFields = buildV4ResolvedFields({
  resolved_fields: {
    year: "2013",
    product: "Leaf Optichrome",
    players: ["Garrett Nussmeier"]
  },
  conflict_map: [{ field: "year", severity: "HIGH" }]
});
assert.equal(conflictSuppressedFields.year, null, "a conflicted year must remain internal evidence, never a rendered fact");
assert.equal(conflictSuppressedFields.product, "Leaf Optichrome");

const resolvedConflictRetainsCanonicalValue = buildV4ResolvedFields({
  resolved_fields: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Test Player"],
    print_run_number: "03/10",
    print_run_numerator: "03",
    print_run_denominator: "10"
  },
  conflict_map: [{
    field: "serial_number",
    severity: "HIGH",
    resolved: true,
    resolved_value: "03/10"
  }]
});
assert.equal(resolvedConflictRetainsCanonicalValue.year, "2025");
assert.equal(
  resolvedConflictRetainsCanonicalValue.print_run_number,
  "03/10",
  "an OCR-resolved conflict must keep the current-image value at the V4 boundary"
);

const reviewStateDoesNotEraseDraftValue = buildV4ResolvedFields({
  resolved_fields: {
    year: "2026",
    product: "Bowman Chrome",
    players: ["Test Player"]
  },
  field_states: [{ field_name: "year", display_status: "CONFLICT" }]
});
assert.equal(
  reviewStateDoesNotEraseDraftValue.year,
  "2026",
  "writer-review metadata must not silently delete an otherwise resolved draft value"
);
const reviewStateRemainsVisible = buildV4FieldStates({
  resolved_fields: reviewStateDoesNotEraseDraftValue,
  field_states: [{ field_name: "year", display_status: "CONFLICT" }]
});
assert.equal(reviewStateRemainsVisible.year.display_status, "CONFLICT");

const highlightedConflictRetainsWriterDraftValue = buildV4ResolvedFields({
  resolved_fields: {
    year: "2025-26",
    product: "Topps Chrome",
    players: ["Test Player"]
  },
  conflict_map: [{ field: "year", severity: "HIGH" }],
  draft_gate: {
    by_field: {
      year: {
        field: "year",
        selected_value: "2025-26",
        display_policy: "INCLUDE_HIGHLIGHTED"
      }
    }
  }
});
assert.equal(
  highlightedConflictRetainsWriterDraftValue.year,
  "2025-26",
  "an upstream gate-selected highlighted value must survive the V4 persistence boundary"
);

const pipelineRetainedConflictSurvivesV4Boundary = buildV4ResolvedFields({
  resolved_fields: {
    year: "2025-26",
    product: "Topps Chrome",
    players: ["Test Player"]
  },
  conflict_map: [{ field: "year", severity: "HIGH" }],
  pipeline_node_ledger: {
    field_flow: {
      fields: [{
        field_group: "year",
        raw_provider_present: true,
        resolved_present: true,
        rendered_present: true,
        review_flagged: true,
        disposition: "RETAINED_IN_RESOLUTION"
      }]
    }
  }
});
assert.equal(
  pipelineRetainedConflictSurvivesV4Boundary.year,
  "2025-26",
  "V4 must not re-adjudicate a conflict after the upstream resolver retained and rendered it"
);
const pipelineRetainedConflictState = buildV4FieldStates({
  resolved_fields: pipelineRetainedConflictSurvivesV4Boundary,
  conflict_map: [{ field: "year", severity: "HIGH" }]
});
assert.equal(
  pipelineRetainedConflictState.year.display_status,
  "CONFLICT",
  "a retained value remains highlighted for writer review instead of being silently erased"
);

const nullRendererScaffoldDoesNotEraseResolvedValue = buildV4ResolvedFields({
  resolved_fields: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Test Player"]
  },
  rendered_fields: {
    fields: {
      year: null,
      product: "Topps Chrome"
    }
  }
});
assert.equal(
  nullRendererScaffoldDoesNotEraseResolvedValue.year,
  "2025",
  "null renderer scaffolding must not erase a meaningful resolved value"
);

const uncertainObservationStates = buildV4FieldStates({
  resolved: {
    players: ["Cristiano Ronaldo"],
    card_name: "Patch Perfect? Signature"
  }
});
assert.equal(
  uncertainObservationStates.card_type.display_status,
  "REVIEW",
  "explicit model uncertainty must never be presented as a normal field"
);
const malformedDescriptorStates = buildV4FieldStates({
  resolved: { parallel_exact: "Sapphire Ed - Green" }
});
assert.equal(
  malformedDescriptorStates.parallel.display_status,
  "REVIEW",
  "a malformed edition descriptor may be normalized for output but must remain review-visible"
);

const v4TitleApiSource = await readFile("api/v4/listing-copilot-title.js", "utf8");
const fastScoutPrewarmApiSource = await readFile("api/v4/fast-scout-prewarm.js", "utf8");
const queueMigrationApiSource = await readFile("api/admin-apply-v4-production-job-queue-migration.js", "utf8");
const queueStatusApiSource = await readFile("api/v4/listing-job-status.js", "utf8");
const sessionStatusApiSource = await readFile("api/v4/listing-session-status.js", "utf8");
const feedbackApiSource = await readFile("api/v4/listing-feedback.js", "utf8");
const writerExportApiSource = await readFile("api/v4/listing-export-workbook.js", "utf8");
const atomicFeedbackMigrationSource = await readFile("supabase/migrations/20260711200533_atomic_v4_writer_feedback_transaction.sql", "utf8");
const atomicNoncriticalMigrationSource = await readFile("supabase/migrations/20260712072310_atomic_v4_noncritical_persistence.sql", "utf8");
const atomicNoncriticalMigrationApiSource = await readFile("api/admin-apply-v4-noncritical-persistence-migration.js", "utf8");
const writerReadyCapacityMigrationSource = await readFile("supabase/migrations/20260712153000_atomic_v4_writer_ready_capacity_release.sql", "utf8");
const stageCapacityMigrationSource = await readFile("supabase/migrations/20260713130000_v4_stage_capacity_control.sql", "utf8");
const tenantFairQueueMigrationSource = await readFile("supabase/migrations/20260713224500_v4_tenant_fair_provider_queue.sql", "utf8");
const writerReadyCapacityMigrationApiSource = await readFile("api/admin-apply-v4-writer-ready-capacity-migration.js", "utf8");
const balancedProviderKeyMigrationSource = await readFile("supabase/migrations/20260712170000_v4_balanced_provider_key_slots.sql", "utf8");
const productionDeployWorkflowSource = await readFile(".github/workflows/deploy-production.yml", "utf8");
const writerLearningSupersessionMigrationSource = await readFile("supabase/migrations/20260712040453_supersede_stale_writer_learning_events.sql", "utf8");
const queueWorkerApiSource = await readFile("api/v4/listing-job-worker.js", "utf8");
const v4SmokeSource = await readFile("scripts/v4-ebay-smoke.mjs", "utf8");
const freshEbaySmokeWorkflowSource = await readFile(".github/workflows/fresh-ebay-smoke.yml", "utf8");
const vercelConfigSource = await readFile("vercel.json", "utf8");
const persistPipelineStart = v4TitleApiSource.indexOf("async function persistPipelineResult");
const persistPipelineEnd = v4TitleApiSource.indexOf("async function runBackgroundAssistedDraft", persistPipelineStart);
const persistPipelineSource = v4TitleApiSource.slice(persistPipelineStart, persistPipelineEnd);
assert.ok(persistPipelineStart >= 0 && persistPipelineEnd > persistPipelineStart);
assert.doesNotMatch(persistPipelineSource, /\breq\b/, "persistence helpers must not capture an undefined request object");
assert.match(persistPipelineSource, /requestContext/, "request context must be passed explicitly to capacity refill");
assert.match(v4TitleApiSource, /recognition_clock_source:\s*"gpt_provider_request"/, "GPT requests must persist the per-card recognition clock source");
assert.match(v4TitleApiSource, /deterministic_anchor_finalize/, "no-GPT exact-anchor titles must persist their own clock source");
assert.match(v4TitleApiSource, /ENABLE_V4_DEFER_NONCRITICAL_PERSISTENCE/, "V4 must keep a kill switch for deferred non-critical persistence.");
assert.match(v4TitleApiSource, /noncritical_persistence_status: deferNonCriticalPersistence \? "DEFERRED" : "SYNC"/, "writer-ready sessions must expose whether non-critical persistence was deferred.");
assert.match(v4TitleApiSource, /const backgroundPersistence = persistV4NonCriticalArtifacts/, "field evidence, candidate trace, catalog gap, and ledger persistence must be assembled outside the writer-ready response.");
assert.match(v4TitleApiSource, /persistV4NonCriticalArtifactsAtomic/, "post-title learning artifacts must prefer one atomic RPC over four concurrent PostgREST writes.");
assert.match(v4TitleApiSource, /async function persistV4NonCriticalArtifacts\([\s\S]*l1Stage = false/, "L2 background persistence must default its catalog-gap stage guard instead of reading an undeclared variable.");
assert.match(v4TitleApiSource, /scheduleV4Background\(backgroundPersistence/, "non-critical persistence and its self-observation must not block writer-ready L2 by default.");
assert.match(v4TitleApiSource, /persistV4WriterReadyAndReleaseCapacity/, "writer-ready persistence must be able to release scarce provider capacity in the same transaction.");
assert.match(v4TitleApiSource, /writer_ready_provider_capacity_release/, "the release boundary must remain observable in the V4 response.");
assert.match(v4TitleApiSource, /noncritical_persistence_summary: persistenceSummary/, "background persistence must report its terminal artifact-level outcome.");
assert.match(v4SmokeSource, /const prewarmPromise = prewarm/, "production smoke must start the free cache probe independently.");
assert.match(v4SmokeSource, /const prewarmResult = await prewarmPromise/, "speculative smoke must finish its cache probe before final telemetry is assembled.");
assert.match(v4SmokeSource, /prewarmCacheOnly: !hasFlag\(argv, "--paid-prewarm"\)/, "direct smoke prewarm must stay cache-only and avoid a duplicate provider call.");
assert.match(v4SmokeSource, /create_l1_job: enableL1/, "hidden L1 must be explicit experiment-only work rather than a default paid stage.");
assert.match(v4SmokeSource, /create_l2_job: true/, "production smoke must always poll the final L2 stage.");
assert.doesNotMatch(v4SmokeSource, /l1Payload|l1Outcome|Promise\.allSettled/, "production smoke must not issue a duplicate writer-facing L1 request.");
assert.match(queueStatusApiSource, /provider_capacity_stage_handoff: summary\.provider_capacity_stage_handoff \|\| null/, "job status must preserve provider-stage handoff telemetry for production capacity audits.");
assert.match(v4SmokeSource, /l2_catalog_raw_candidate_count/, "speculative smoke must retain catalog funnel diagnostics.");
assert.match(v4SmokeSource, /input_tokens: finalProviderDiagnostics\.input_tokens/, "speculative smoke must retain provider token diagnostics.");
assert.match(v4SmokeSource, /recognition_phase_loaded_sealed_labels: false/, "blind smoke must not load sealed seller titles during recognition.");
assert.match(v4SmokeSource, /predictions_frozen_before_scoring: true/, "blind smoke must freeze predictions before local weak-label scoring.");
assert.match(v4SmokeSource, /evaluation_sample_policy/, "smoke reports must state whether their sample supports regression, ablation, or generalization claims.");
assert.match(freshEbaySmokeWorkflowSource, /--sample-mode fresh_generalization/, "fresh smoke must label rotated cards as a generalization sample.");
assert.match(v4SmokeSource, /pollBatchJobs/, "large production smoke must use one shared batch poller instead of one poll loop per card.");
assert.match(v4SmokeSource, /pipeline_node_ledger:\s*summary\.pipeline_node_ledger/, "batch smoke results must retain the end-to-end node ledger.");
assert.match(v4SmokeSource, /resolved_fields:\s*summary\.resolved_fields/, "batch smoke results must retain canonical resolved fields for per-card diagnosis.");
assert.match(v4SmokeSource, /title_length_policy:\s*summary\.title_length_policy/, "batch smoke results must retain deterministic compression decisions.");
assert.match(v4SmokeSource, /async function enqueueSpeculativeItem[\s\S]*const l1Job =[\s\S]*l1_job: l1Job/, "batch enqueue must retain the paired L1 job without referencing an out-of-scope variable.");
assert.match(v4SmokeSource, /concurrency: Math\.max\(1, Math\.trunc\(numberArg\(argv, "--concurrency", 2\)\)\)/, "smoke preparation and enqueue must default to the measured production concurrency of two.");
assert.match(v4SmokeSource, /compactL2: hasFlag\(argv, "--compact-l2"\)/, "smoke harness must expose the compact L2 request-level ablation flag.");
assert.match(freshEbaySmokeWorkflowSource, /ledger_present_count[^\n]+attempted_count/, "fresh blind smoke must fail closed when node ledgers are missing.");
assert.match(freshEbaySmokeWorkflowSource, /transport_error_count/, "speed smoke must fail on transport errors without treating field-quality findings as infrastructure failures.");
assert.match(freshEbaySmokeWorkflowSource, /field_quality_error_count/, "speed smoke must still report deferred field-quality findings.");
assert.match(freshEbaySmokeWorkflowSource, /writer_ready_capacity_atomic_count/, "speed smoke must prove writer-ready provider capacity release behavior.");
assert.match(fastScoutPrewarmApiSource, /allowProviderCall: payload\.v4_fast_scout_cache_only !== true/, "production can probe the scout cache without putting another model call before L2.");
assert.match(fastScoutPrewarmApiSource, /FAST_SCOUT_CACHE_MISS_PROVIDER_DISABLED/, "a cache-only miss must be an expected route signal rather than a provider failure.");
assert.match(fastScoutPrewarmApiSource, /prewarm_status: "CACHE_MISS"/, "cache-only misses must return a stable non-error response.");
assert.match(vercelConfigSource, /admin-apply-v4-production-job-queue-migration\.js/, "the production migration function must have an explicit Vercel bundle rule.");
assert.match(vercelConfigSource, /supabase\/migrations\/\*\.sql/, "all required SQL migrations must ship with the admin migration function.");
assert.match(productionDeployWorkflowSource, /admin-apply-v4-production-job-queue-migration/, "production deployment must apply and verify the queue control-plane migration before declaring readiness.");
assert.match(productionDeployWorkflowSource, /production-job-queue-migration\.json/, "queue migration evidence must be retained with every production release.");
assert.match(queueMigrationApiSource, /20260713224500_v4_tenant_fair_provider_queue\.sql/, "production migration apply must include the tenant-fair scheduler.");
assert.match(queueMigrationApiSource, /tenant_fair_scheduler/, "the migration probe must verify that tenant-first scheduling is installed.");
assert.match(queueMigrationApiSource, /tenant_fair_claim_ok/, "the migration probe must prove that multiple batches cannot multiply one tenant's provider share.");
assert.match(queueMigrationApiSource, /capacity_bound_ok/, "the migration probe must prove capacity cannot be over-claimed.");
assert.match(queueMigrationApiSource, /balanced_key_assignment_ok/, "the migration probe must prove concurrent slots are distributed across configured provider keys.");
assert.match(queueMigrationApiSource, /kick_dedup_ok/, "the migration probe must prove duplicate pump kicks collapse.");
assert.match(balancedProviderKeyMigrationSource, /provider_key_assignment', 'balanced_round_robin_v1'/, "provider capacity must expose its balanced key-slot assignment policy.");
assert.match(tenantFairQueueMigrationSource, /partition by coalesce\(nullif\(jobs\.tenant_id, ''\), nullif\(jobs\.batch_id, ''\), jobs\.id\)/, "scarce provider capacity must be fair by tenant before batch.");
assert.match(tenantFairQueueMigrationSource, /scheduling_fairness_scope/, "claimed jobs must expose their scheduling fairness scope.");
assert.match(tenantFairQueueMigrationSource, /claim_v4_recognition_jobs_with_capacity[\s\S]*claim_v4_recognition_jobs_with_balanced_capacity/, "the compatibility RPC must preserve tenant-first scheduling.");
assert.match(queueStatusApiSource, /paired_l1_wait_ms/, "queue metrics must separate intentional L1 dependency time from scheduler delay.");
assert.match(queueStatusApiSource, /scheduler_queue_wait_ms/, "queue metrics must expose actual scheduler delay after a paired L2 becomes runnable.");
assert.match(queueStatusApiSource, /preingestion_ocr_rendezvous/, "queue status must expose OCR rendezvous diagnostics used by production smoke.");
assert.match(queueStatusApiSource, /serial_numerator_verified/, "queue status must expose the final serial numerator verification decision.");
assert.match(queueStatusApiSource, /V4_JOB_STATUS_QUERY_REQUIRED/, "missing status query identifiers must remain a non-retryable client error.");
assert.match(queueStatusApiSource, /sendJson\(res, 503,[\s\S]*retryable: true[\s\S]*V4_JOB_STATUS_BACKEND_UNAVAILABLE/, "transient queue-store reads must be reported as retryable service failures.");
assert.match(queueStatusApiSource, /ownedJobs = result\.rows\.filter[\s\S]*operator_id/, "job status must not expose another operator's queued work.");
assert.match(sessionStatusApiSource, /session\.operator_id[\s\S]*operatorIdFromRequest/, "session status must enforce operator ownership.");
assert.match(sessionStatusApiSource, /include_related_counts/, "writer polling must not block on diagnostic table counts unless explicitly requested.");
assert.match(sessionStatusApiSource, /Promise\.all\(Object\.entries\(tables\)/, "evaluation-only related counts should load in parallel.");
assert.match(sessionStatusApiSource, /Recognition session status is temporarily unavailable/, "transient session reads must remain retryable instead of looking like a terminal failure.");
assert.match(feedbackApiSource, /readV4SessionStatus[\s\S]*session\.operator_id[\s\S]*operatorId/, "writer feedback must verify session ownership before learning writes.");
assert.match(feedbackApiSource, /persistV4WriterFeedbackTransaction/, "writer feedback, learning data, and the session terminal state must commit atomically.");
assert.match(feedbackApiSource, /v4_writer_cert_registry_promotion_failed/, "non-blocking cert promotion failures must remain observable.");
assert.match(v4TitleApiSource, /v4_noncritical_persistence_failure_status_write_failed/, "a failed background-persistence terminal write must not disappear silently.");
assert.match(atomicFeedbackMigrationSource, /for update/, "the feedback transaction must lock the owned recognition session before writing learning artifacts.");
assert.match(atomicFeedbackMigrationSource, /insert into public\.v4_writer_feedback_events[\s\S]*insert into public\.v4_learning_events[\s\S]*update public\.v4_recognition_sessions/, "one database transaction must persist all three writer-loop records.");
assert.match(atomicFeedbackMigrationSource, /revoke execute on function public\.persist_v4_writer_feedback_transaction[\s\S]*from public, anon, authenticated/, "the writer transaction RPC must remain service-role only.");
assert.match(atomicNoncriticalMigrationSource, /insert into public\.v4_field_evidence[\s\S]*insert into public\.v4_candidate_traces[\s\S]*insert into public\.v4_catalog_gap_queue[\s\S]*insert into public\.v4_production_quality_ledger/, "post-title evidence artifacts must persist in one database transaction.");
assert.match(atomicNoncriticalMigrationSource, /revoke all on function public\.persist_v4_noncritical_artifacts[\s\S]*from public, anon, authenticated/, "the non-critical persistence RPC must remain service-role only.");
assert.match(atomicNoncriticalMigrationApiSource, /anon_blocked[\s\S]*authenticated_blocked[\s\S]*service_role_allowed/, "the production migration probe must verify the RPC privilege boundary.");
assert.match(writerReadyCapacityMigrationSource, /update public\.v4_recognition_sessions[\s\S]*update public\.v4_provider_capacity_leases/, "writer-ready state and provider-capacity release must commit in one database transaction.");
assert.match(stageCapacityMigrationSource, /acquire_v4_stage_capacity[\s\S]*for update skip locked/, "non-LLM stages must use a durable global capacity lease instead of multiplying per-request concurrency.");
assert.match(stageCapacityMigrationSource, /release_v4_stage_capacity/, "non-LLM stage slots must be explicitly releasable.");
assert.match(writerReadyCapacityMigrationSource, /revoke all on function public\.persist_v4_writer_ready_and_release_capacity[\s\S]*from public, anon, authenticated/, "the writer-ready capacity RPC must remain service-role only.");
assert.match(writerReadyCapacityMigrationApiSource, /anon_blocked[\s\S]*authenticated_blocked[\s\S]*service_role_allowed/, "the writer-ready capacity migration probe must verify the RPC privilege boundary.");
assert.match(productionDeployWorkflowSource, /admin-apply-v4-noncritical-persistence-migration[\s\S]*noncritical-persistence-migration\.json/, "production deploys must apply and retain evidence for the atomic persistence migration.");
assert.match(productionDeployWorkflowSource, /admin-apply-v4-writer-ready-capacity-migration[\s\S]*writer-ready-capacity-migration\.json/, "production deploys must apply and retain evidence for the writer-ready capacity migration.");
assert.match(writerLearningSupersessionMigrationSource, /before insert on public\.v4_learning_events/, "writer learning supersession must be enforced at the database boundary.");
assert.match(writerLearningSupersessionMigrationSource, /SUPERSEDED_BY_LATEST_WRITER_FEEDBACK/, "older writer-derived training truth must be retained for audit but excluded from training.");
assert.match(writerLearningSupersessionMigrationSource, /events\.id <> new\.id[\s\S]*events\.training_eligible = true/, "the latest writer event must only supersede older eligible events for the same session.");
assert.match(writerExportApiSource, /writerExportRowsBelongToOperator/, "writer exports must verify every referenced recognition session.");
assert.doesNotMatch(writerExportApiSource, /new pg\.Client|client\.query\(sql\)/, "normal writer export requests must never mutate production schema.");
assert.match(v4SmokeSource, /transient_error_count/, "cloud smoke must report recovered status-read faults instead of hiding them.");
assert.match(v4SmokeSource, /--resume-batch-id/, "cloud smoke must resume an existing paid batch after an observational polling failure.");
assert.match(v4SmokeSource, /resume_batch_job_missing/, "batch recovery must fail closed when an expected card is absent.");
assert.match(v4SmokeSource, /excluded_from_recognition_wall_time:\s*true/, "post-title diagnostics hydration must never inflate writer latency or throughput timing.");
assert.match(v4SmokeSource, /hydrateV4JobDiagnostics/, "per-card polling must hydrate final node, OCR, and persistence evidence after timing stops.");
assert.match(queueWorkerApiSource, /retryable: error\?\.retryable/, "queue workers must preserve provider retryability instead of retrying deterministic contract failures.");
assert.match(queueWorkerApiSource, /Promise\.all\(\[capacityReleasePromise, completionPromise\]\)/, "capacity release and queue completion must not serialize the worker tail.");
assert.match(queueWorkerApiSource, /provider_capacity_released_at_writer_ready/, "worker telemetry must expose whether the scarce slot was already released at writer readiness.");
assert.match(vercelConfigSource, /admin-apply-v4-writer-ready-capacity-migration\.js/, "the writer-ready capacity migration must ship in the Vercel artifact.");

const route = planV4RecognitionRoute({
  preingestion_bundle_id: "bundle-1",
  approved_candidate_count: 1,
  initial_evidence: {
    collector_number: "PAU"
  },
  images: [{ role: "image_1" }, { role: "image_2" }]
}, {
  VECTOR_INDEX_READY: "true"
});
assert.equal(route.route, "EXACT_ANCHOR_FAST_LANE");
assert.ok(route.blocking_modules.includes("fast_scout_observation"));
assert.ok(route.blocking_modules.includes("deterministic_renderer"));
assert.ok(route.background_modules.includes("full_assisted_observation"));
assert.ok(route.background_modules.includes("post_observation_catalog_lookup"));
assert.ok(route.skipped_modules.includes("visual_vector_retrieval"));

const exactFastLaneOptions = providerOptionsForV4ProgressiveL1({
  payload: { provider_options: { enable_catalog_assist: true, force_vector_assist: true } },
  routePlan: route
});
assert.equal(exactFastLaneOptions.enable_catalog_assist, false);
assert.equal(exactFastLaneOptions.enable_vector_assist, false);
assert.equal(exactFastLaneOptions.enable_ephemeral_external_retrieval, false);
assert.equal(exactFastLaneOptions.v4_title_stage_target, v4TitleStages.L1_INTERNAL_SCOUT);

const coldStartRoute = planV4RecognitionRoute({
  images: [{ role: "image_1" }, { role: "image_2" }]
}, {
  VECTOR_INDEX_READY: "true"
});
assert.equal(coldStartRoute.route, "COLD_START_SAFE_DRAFT");
assert.ok(coldStartRoute.blocking_modules.includes("fast_scout_observation"));
assert.ok(coldStartRoute.background_modules.includes("full_assisted_observation"));

const assistedRoute = planV4RecognitionRoute({
  images: [{ role: "image_1" }, { role: "image_2" }],
  approved_candidate_count: 2
}, {
  VECTOR_INDEX_READY: "true"
});
assert.equal(assistedRoute.route, "ASSISTED_FULL");
assert.ok(assistedRoute.blocking_modules.includes("fast_scout_observation"));
assert.ok(assistedRoute.background_modules.includes("full_assisted_observation"));
assert.ok(assistedRoute.background_modules.includes("visual_vector_retrieval"));
const assistedOptions = providerOptionsForV4ProgressiveL1({
  payload: { provider_options: { enable_catalog_assist: true } },
  routePlan: assistedRoute
});
assert.equal(assistedOptions.enable_catalog_assist, false);
assert.equal(assistedOptions.enable_vector_retrieval, false);

const l2Options = providerOptionsForV4BackgroundL2({
  payload: { provider_options: { enable_catalog_assist: true } },
  routePlan: assistedRoute
});
assert.equal(l2Options.v4_title_stage_target, v4TitleStages.L2_ASSISTED_DRAFT);
assert.equal(l2Options.v4_compact_l2_prompt, undefined, "compact L2 prompt must be explicit opt-in, not the default production path");
assert.equal(l2Options.enable_post_observation_retrieval_deadline, true);
assert.equal(l2Options.post_observation_catalog_vector_hedge_ms, 100);
assert.equal(l2Options.post_observation_retrieval_critical_path_budget_ms, 250);

const l2CustomRetrievalBudget = providerOptionsForV4BackgroundL2({
  payload: {
    provider_options: {
      post_observation_catalog_vector_hedge_ms: 400,
      post_observation_retrieval_critical_path_budget_ms: 800
    }
  },
  routePlan: assistedRoute
});
assert.equal(l2CustomRetrievalBudget.post_observation_catalog_vector_hedge_ms, 400);
assert.equal(l2CustomRetrievalBudget.post_observation_retrieval_critical_path_budget_ms, 800);

const resolvedOcrOverridePresentation = adaptV2ResultToV4({
  sessionId: "v4sess-resolved-ocr-override",
  result: {
    confidence: "HIGH",
    final_title: "2025 Topps Chrome Test Player #/10 Auto",
    resolved_fields: {
      year: "2025",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Test Player"],
      auto: true,
      print_run_number: "03/10",
      print_run_numerator: "03",
      print_run_denominator: "10",
      serial_number: "03/10"
    },
    serial_numerator_verified: true,
    preingestion_serial_verification: {
      verified: true,
      value: "03/10"
    },
    conflict_map: [{
      field: "serial_number",
      conflict_type: "OCR_CURRENT_IMAGE_OVERRIDE",
      severity: "HIGH",
      resolved: true,
      resolved_value: "03/10"
    }],
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.match(resolvedOcrOverridePresentation.final_title, /03\/10/);
assert.equal(resolvedOcrOverridePresentation.resolved_fields.print_run_number, "03/10");

const verifiedOcrMustBeatDenominatorOnlyEvidence = adaptV2ResultToV4({
  sessionId: "v4sess-verified-ocr-beats-denominator",
  result: {
    confidence: "HIGH",
    final_title: "2018 Topps Test Player #/5 Auto",
    resolved_fields: {
      year: "2018",
      manufacturer: "Topps",
      players: ["Test Player"],
      auto: true,
      print_run_number: "1/5",
      print_run_numerator: "1",
      print_run_denominator: "5",
      serial_number: "1/5"
    },
    normalized_evidence: {
      print_run_number: {
        status: "CONFIRMED",
        normalized_value: "#/5",
        sources: [{ source_type: "OCR", direct_observation: true }]
      }
    },
    serial_numerator_verified: true,
    preingestion_serial_verification: {
      verified: true,
      value: "1/5",
      confidence: 0.96
    },
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.match(
  verifiedOcrMustBeatDenominatorOnlyEvidence.final_title,
  /1\/5/,
  "verified current-image OCR numerator must not regress to denominator-only evidence"
);
assert.equal(verifiedOcrMustBeatDenominatorOnlyEvidence.resolved_fields.print_run_number, "1/5");

const v2Result = {
  title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5",
  final_title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5",
  confidence: "HIGH",
  provider: "openai",
  resolved_fields: {
    year: "2024-25",
    manufacturer: "Panini",
    product: "Immaculate",
    players: ["Anthony Edwards"],
    card_name: "Patch Auto",
    collector_number: "PAU",
    serial_number: "2/3",
    grade_company: "BGS",
    card_grade: "8.5"
  },
  candidate_application_trace: {
    applied_field_count: 3,
    blocked_field_count: 1,
    per_field: {
      product: { applied: true }
    }
  },
  candidate_activation_funnel: {
    raw_candidate_count: 5,
    prompt_candidate_count: 2
  },
  catalog_activation_funnel: {
    prompt_candidate_count: 1
  },
  vector_activation_funnel: {
    prompt_candidate_count: 1
  },
  provider_token_diagnostics: {
    input_tokens: 1000,
    output_tokens: 500,
    total_tokens: 1500
  },
  provider_rate_limit_diagnostics: {
    "x-ratelimit-limit-requests": "5000",
    "x-ratelimit-remaining-requests": "4998",
    "x-ratelimit-limit-tokens": "2000000",
    "x-ratelimit-remaining-tokens": "1998500",
    "x-ratelimit-reset-requests": "12ms",
    "x-ratelimit-reset-tokens": "90ms"
  },
  provider_request_diagnostics: {
    input_tokens: 1000,
    output_tokens: 500,
    provider_latency_ms: 12345,
    response_status: "completed"
  },
  preingestion_ocr_rendezvous: { status: "TERMINAL", job_count: 2, patch_count: 3 },
  preingestion_evidence_refresh: { refreshed: true, added_patch_count: 2 },
  serial_numerator_verified: true
};

const v4 = adaptV2ResultToV4({
  sessionId: "v4sess-test",
  result: v2Result,
  payload: { preingestion_bundle_id: "bundle-1" },
  routePlan: route
});
assert.equal(v4.v4_schema_version, "v4-recognition-session-v1");
assert.equal(v4.recognition_session_id, "v4sess-test");
assert.equal(v4.writer_draft.user_edit_mode, "one_line_title_only");
assert.equal(v4.writer_draft.structured_fields_visible, false);
assert.equal(v4.title_stage, "L2_ASSISTED_DRAFT");
assert.equal(v4.writer_safe_draft, v4.final_title);
assert.equal(v4.assisted_draft, v4.final_title);
assert.ok(v4.blocking_modules.includes("fast_scout_observation"));
assert.ok(v4.background_modules.includes("post_observation_catalog_lookup"));
assert.equal(v4.assisted_draft_status, "READY");
assert.ok(Array.isArray(v4.pending_modules));
assert.equal(v4.title_stage_readiness.writer_safe_ready, true);
assert.ok(v4.module_speed_metrics.modules_skipped_by_route.includes("visual_vector_retrieval"));
assert.equal(v4.resolved_fields.print_run_number, "2/3");
assert.equal(v4.resolved_fields.print_run_denominator, "3");
assert.equal(v4.field_states.product.display_status, "NORMAL");
assert.equal(v4.candidate_control_plane_trace.prompt_candidate_count, 2);
assert.equal(v4.catalog_activation_funnel.prompt_candidate_count, 1);
assert.equal(v4.provider_result.token_diagnostics.input_tokens, 1000);
assert.equal(v4.provider_result.rate_limit_diagnostics["x-ratelimit-remaining-tokens"], "1998500");
assert.equal(v4.provider_result.request_diagnostics.provider_latency_ms, 12345);
assert.equal(v4.provider_result.preingestion_ocr_rendezvous.status, "TERMINAL");
assert.equal(v4.provider_result.preingestion_evidence_refresh.added_patch_count, 2);
assert.equal(v4.provider_result.serial_numerator_verified, true);

const reconciledSlabTitle = adaptV2ResultToV4({
  sessionId: "v4sess-slab-reconcile",
  result: {
    final_title: "2021 Panini Contenders Optic Aaron Rodgers 06/25 #8 (Green Bay Packers) PSA 10",
    confidence: "MEDIUM",
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    fields: {
      manufacturer: "Contenders Optic (brand)",
      product: "2021 Contenders Optic Football",
      card_name: "SPLTTNG.IMG - BLACK SCOPE"
    },
    resolved_fields: {
      year: "2021",
      manufacturer: "Contenders Optic (brand)",
      product: "2021 Contenders Optic Football",
      players: ["Aaron Rodgers"],
      parallel_exact: "Black Scope",
      print_run_number: "06/25",
      collector_number: "8",
      grade_company: "PSA",
      card_grade: "10",
      team: "Green Bay Packers"
    },
    rendered_fields: {
      fields: {
        year: "2021",
        manufacturer: "Panini",
        product: "Contenders Optic",
        players: ["Aaron Rodgers"],
        parallel_exact: "Black Scope",
        surface_color: "Black",
        print_run_number: "06/25",
        collector_number: "8",
        grade_company: "PSA",
        card_grade: "10",
        team: "Green Bay Packers"
      }
    },
    evidence: {
      parallel_exact: {
        value: "Black Scope",
        normalized_value: "Black Scope",
        status: "CONFIRMED",
        confidence: 0.9648,
        sources: [{
          source_type: "SLAB_LABEL",
          region: "grade_label",
          raw_text: "SPLTNG.IMG-BLACK SCOPE"
        }]
      },
      surface_color: {
        value: "Black",
        normalized_value: "Black",
        status: "CONFIRMED",
        confidence: 0.9648,
        sources: [{
          source_type: "SLAB_LABEL",
          region: "grade_label",
          raw_text: "SPLTNG.IMG-BLACK SCOPE"
        }]
      },
      print_run_number: {
        value: "06/25",
        normalized_value: "06/25",
        status: "CONFIRMED",
        confidence: 0.9943,
        sources: [{
          source_type: "OCR",
          region: "serial_number",
          raw_text: "06/25"
        }]
      }
    },
    preingestion_slab_parallel_verification: {
      verified: true,
      value: "Black Scope"
    },
    preingestion_serial_verification: {
      verified: true,
      value: "06/25"
    },
    serial_numerator_verified: true
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.match(reconciledSlabTitle.final_title, /Black Scope/);
assert.match(reconciledSlabTitle.final_title, /06\/25/);
assert.doesNotMatch(reconciledSlabTitle.final_title, /SPLTTNG\.IMG/);
assert.equal(reconciledSlabTitle.resolved_fields.card_name, null);
assert.equal(reconciledSlabTitle.resolved_fields.manufacturer, "Panini");
assert.equal(reconciledSlabTitle.provider_result.title_reconciled_from_v4_field_graph, true);
assert.ok(reconciledSlabTitle.provider_result.title_length_policy);
assert.deepEqual(reconciledSlabTitle.provider_result.title_reconciliation_reasons, [{
  field: "parallel_exact",
  value: "Black Scope",
  source: "verified_slab_label"
}]);

const deterministicCsmTitle = adaptV2ResultToV4({
  sessionId: "v4sess-deterministic-csm",
  result: {
    confidence: "HIGH",
    final_title: "2020 Bowman Chrome Bobby Witt Jr. Auto - Atomic Refractor. 43/100 1st Bowman",
    fields: {
      collector_number: "164",
      surface_color: "Silver"
    },
    resolved_fields: {
      year: "2020",
      manufacturer: "Topps",
      brand: "Bowman",
      product: "2020 Bowman Chrome",
      players: ["Bobby Witt Jr."],
      card_name: "Prospects Autograph - Atomic Ref.",
      insert: "Prospects Autograph",
      auto: true,
      print_run_number: "43/100",
      print_run_numerator: "43",
      print_run_denominator: "100",
      grade_company: "PSA",
      card_grade: "9",
      auto_grade: "9",
      grade_type: "CARD_AND_AUTO"
    },
    serial_numerator_verified: true,
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.equal(
  deterministicCsmTitle.final_title,
  "2020 Bowman Chrome Bobby Witt Jr. Auto Atomic Refractor 43/100 PSA 9"
);
assert.equal(deterministicCsmTitle.resolved_fields.collector_number, "164");
assert.equal(deterministicCsmTitle.resolved_fields.surface_color, "Silver");
assert.equal(deterministicCsmTitle.provider_result.title_reconciled_from_v4_field_graph, true);
assert.equal(deterministicCsmTitle.legacy_v2_result.title_render_source, "v4_csm_deterministic_renderer");
assert.match(deterministicCsmTitle.legacy_v2_result.model_title_suggestion, /1st Bowman/);

const conflictedYearNeverRenders = adaptV2ResultToV4({
  sessionId: "v4sess-conflicted-year",
  result: {
    confidence: "LOW",
    final_title: "2013 Leaf Optichrome Garrett Nussmeier",
    resolved_fields: {
      year: "2013",
      product: "Leaf Optichrome",
      players: ["Garrett Nussmeier"]
    },
    conflict_map: [{ field: "year", severity: "HIGH" }],
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.equal(conflictedYearNeverRenders.resolved_fields.year, null);
assert.doesNotMatch(conflictedYearNeverRenders.final_title, /\b2013\b/);
assert.equal(conflictedYearNeverRenders.field_states.year.display_status, "CONFLICT");

const deterministicTcgCardNameTitle = adaptV2ResultToV4({
  sessionId: "v4sess-deterministic-tcg-card-name",
  result: {
    confidence: "HIGH",
    final_title: "2023 Yu-Gi-Oh! Adidas Collaboration Dark Magician EN001 #/2500 PSA 10",
    resolved_fields: {
      year: "2023",
      manufacturer: "Konami",
      product: "Yu-Gi-Oh! Promo",
      set: "Adidas Collaboration",
      card_name: "Dark Magician",
      card_number: "EN001",
      collector_number: "EN001",
      print_run_number: "#/2500",
      grade_company: "PSA",
      card_grade: "10"
    },
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.equal(deterministicTcgCardNameTitle.legacy_v2_result.title_render_source, "v4_csm_deterministic_renderer");
assert.match(deterministicTcgCardNameTitle.final_title, /Dark Magician/);
assert.match(deterministicTcgCardNameTitle.final_title, /EN001/);
assert.match(deterministicTcgCardNameTitle.final_title, /PSA 10/);

const sparseIdentityStillUsesCsm = adaptV2ResultToV4({
  sessionId: "v4sess-sparse-csm",
  result: {
    confidence: "LOW",
    final_title: "Model prose Michael Jordan wording must remain internal",
    resolved_fields: {
      year: "2006",
      product: "Fleer",
      set: "20th Anniversary Rookie Reprint",
      collector_number: "23"
    },
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.equal(sparseIdentityStillUsesCsm.legacy_v2_result.title_render_source, "v4_csm_deterministic_renderer");
assert.equal(sparseIdentityStillUsesCsm.final_title, "2006 Fleer 20th Anniversary Rookie Reprint #23");
assert.match(sparseIdentityStillUsesCsm.legacy_v2_result.model_title_suggestion, /Michael Jordan/);
assert.doesNotMatch(sparseIdentityStillUsesCsm.final_title, /Model prose/);

const failedL2V4 = adaptV2ResultToV4({
  sessionId: "v4sess-failed-l2",
  result: {
    confidence: "FAILED",
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    assisted_draft_status: "READY",
    provider_error_type: "PROVIDER_ERROR"
  },
  payload: {},
  routePlan: assistedRoute
});
assert.equal(failedL2V4.ok, false);
assert.equal(failedL2V4.status, "FAILED");
assert.equal(failedL2V4.assisted_draft_status, "FAILED");
assert.equal(failedL2V4.title_stage_readiness.writer_visible_title_ready, false);

const semanticAbstainV4 = adaptV2ResultToV4({
  sessionId: "v4sess-semantic-abstain",
  result: {
    confidence: "FAILED",
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    identity_resolution_status: "ABSTAIN",
    title_render_source: "identity_resolution_abstain",
    route: "COLD_START_SAFE_DRAFT",
    reason: "Grounded evidence did not converge."
  },
  payload: {},
  routePlan: assistedRoute
});
assert.equal(semanticAbstainV4.ok, true);
assert.equal(semanticAbstainV4.status, "WRITER_REVIEW");
assert.equal(semanticAbstainV4.outcome_type, "WRITER_REVIEW_REQUIRED");
assert.equal(semanticAbstainV4.writer_review_required, true);
assert.equal(semanticAbstainV4.final_title, "");
assert.equal(semanticAbstainV4.writer_draft.title, "");
assert.equal(semanticAbstainV4.writer_draft.actions.includes("ACCEPT"), false);
assert.equal(semanticAbstainV4.assisted_draft_status, "REVIEW_REQUIRED");
assert.equal(semanticAbstainV4.title_stage_readiness.writer_can_start, true);
assert.equal(semanticAbstainV4.failure_reason, null);

const recoveredFailedL2V4 = adaptV2ResultToV4({
  sessionId: "v4sess-recovered-l2",
  result: {
    confidence: "FAILED",
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    assisted_draft_status: "FAILED",
    provider_error_type: "SCHEMA_INVALID",
    fields: {
      year: "2018",
      manufacturer: "Panini",
      product: "Select",
      set: "Premier Level",
      players: ["Nick Chubb"],
      card_name: "Die-Cut",
      print_finish: "Gold Prizm",
      print_run_number: "10/10",
      rc: true,
      team: "Cleveland Browns"
    }
  },
  payload: { maxTitleLength: 80 },
  routePlan: assistedRoute
});
assert.equal(recoveredFailedL2V4.ok, true);
assert.equal(recoveredFailedL2V4.status, "DRAFT_READY");
assert.equal(recoveredFailedL2V4.writer_safe_draft, recoveredFailedL2V4.final_title);
assert.match(recoveredFailedL2V4.final_title, /Nick Chubb/);
assert.match(recoveredFailedL2V4.final_title, /10\/10/);
assert.equal(recoveredFailedL2V4.provider_result.confidence, "LOW");
assert.equal(recoveredFailedL2V4.provider_result.title_recovered_from_v4_field_graph, true);
assert.equal(recoveredFailedL2V4.legacy_v2_result.title_recovered_from_v4_field_graph, true);

const internalScoutV4 = adaptV2ResultToV4({
  sessionId: "v4sess-internal-scout",
  result: {
    ...v2Result,
    title_stage: v4TitleStages.L1_INTERNAL_SCOUT
  },
  payload: {},
  routePlan: route
});
assert.equal(internalScoutV4.title_stage, "L1_INTERNAL_SCOUT");
assert.equal(internalScoutV4.writer_safe_draft, "");
assert.equal(internalScoutV4.assisted_draft_status, "PENDING");
assert.equal(internalScoutV4.title_stage_readiness.writer_visible_title_ready, false);

const rows = buildV4PersistenceRows({ sessionId: "v4sess-test", result: v2Result, payload: {} });
assert.ok(rows.fieldEvidenceRows.some((row) => row.field_name === "serial" && row.field_value === "2/3"));
assert.equal(rows.candidateTrace.applied_field_count, 3);

const fastScoutResult = buildFastScoutListingResult({
  parsed: {
    recognition_status: "RESOLVED",
    fast_scout_confidence: 0.72,
    fast_scout_review_fields: ["print_finish"],
    unresolved: ["exact_parallel"],
    evidence_notes: ["Visible current card image reads 2/3 and Anthony Edwards."],
    fast_scout_fields: {
      subject: "Anthony Edwards",
      players: ["Anthony Edwards"],
      character: null,
      year: "2024-25",
      manufacturer: "Panini",
      product_family: "Immaculate",
      set: null,
      card_name: "Patch Auto",
      release_variant: null,
      print_finish: "Green",
      surface_color: "Green",
      print_run_number: "2/3",
      print_run_denominator: "3",
      collector_number: "PAU",
      checklist_code: null,
      tcg_card_number: null,
      grade_company: "BGS",
      card_grade: "8.5",
      auto_grade: "10",
      grade_type: "CARD_AND_AUTO",
      team: "Minnesota Timberwolves",
      language: null,
      observable_components: ["auto", "patch"],
      rc: null,
      auto: true,
      patch: true,
      relic: null,
      jersey: null,
      one_of_one: false,
      unsafe_fields_omitted: ["exact_parallel"]
    }
  },
  payload: { maxTitleLength: 80 },
  signedImages: [{ image_id: "image-1", role: "image_1", width: 1200, height: 1600 }],
  latencyMs: 1500,
  modelId: "gpt-4.1-mini-2025-04-14",
  tokenDiagnostics: { input_tokens: 100, output_tokens: 80, total_tokens: 180 }
});
assert.match(fastScoutResult.final_title, /Anthony Edwards/);
assert.match(fastScoutResult.final_title, /2\/3|#\/3/);
assert.equal(fastScoutResult.fast_scout.input_image_count, 1);
assert.equal(fastScoutResult.evidence.print_run_number.status, "CONFIRMED");

const fastScoutV4 = adaptV2ResultToV4({
  sessionId: "v4sess-fast-scout",
  result: fastScoutResult,
  payload: {},
  routePlan: coldStartRoute
});
assert.equal(fastScoutV4.provider_result.fast_scout.input_image_count, 1);
assert.equal(fastScoutV4.module_speed_metrics.fast_scout_input_image_count, 1);
assert.equal(fastScoutV4.provider_result.fast_scout.input_images[0].role, "image_1");

const fastScoutSelectedUploadOrder = selectFastScoutImages([
  { id: "back-1", role: "back_original" },
  { id: "serial-1", role: "serial_crop" },
  { id: "front-1", role: "front_original" }
], { maxImages: 1 });
assert.equal(fastScoutSelectedUploadOrder.length, 1);
assert.equal(fastScoutSelectedUploadOrder[0].id, "back-1");

const fastScoutSelectedPair = selectFastScoutImages([
  { id: "grade-1", role: "grade_label_crop" },
  { id: "back-ready", role: "back_model_ready" },
  { id: "front-ready", role: "front_model_ready" }
], { maxImages: 2 });
assert.deepEqual(fastScoutSelectedPair.map((image) => image.id), ["back-ready", "front-ready"]);

const riskyStage = buildV4TitleStageState({
  result: {
    final_title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto BGS 8.5",
    confidence: "HIGH",
    unresolved: ["parallel_exact"],
    resolved_fields: {
      year: "2024-25",
      product: "Immaculate",
      players: ["Anthony Edwards"],
      parallel_exact: "International Green"
    }
  },
  routePlan: assistedRoute,
  writerDraft: {
    title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto BGS 8.5"
  },
  resolvedFields: {
    year: "2024-25",
    product: "Immaculate",
    players: ["Anthony Edwards"],
    parallel_exact: "International Green"
  },
  fieldStates: {}
});
assert.equal(riskyStage.title_stage, "L2_ASSISTED_DRAFT");
assert.ok(riskyStage.review_required_fields.includes("parallel_exact"));
assert.ok(riskyStage.background_modules.includes("visual_vector_retrieval"));

const artifacts = buildV4FeedbackArtifacts({
  sessionId: "v4sess-test",
  action: "EDIT",
  aiTitle: v4.final_title,
  writerTitle: "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5 Timberwolves",
  resultPayload: v4
});
assert.equal(artifacts.status, "EDITED");
assert.equal(artifacts.feedbackEvent.correction_type, "EDIT");
assert.equal(artifacts.rawWriterTitle, "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5 Timberwolves");
assert.equal(artifacts.csmNormalization.applied, true);
assert.equal(artifacts.feedbackEvent.title_diff.raw_writer_title, "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5 Timberwolves");
assert.equal(artifacts.learningEvent.training_eligible, true);
assert.equal(artifacts.learningEvent.feedback_training_event.schema_version, "listing-feedback-loop-training-v1");
assert.ok(Array.isArray(artifacts.learningEvent.field_level_ground_truth));
assert.ok(artifacts.learningEvent.field_level_ground_truth.some((row) => row.field === "player" && row.training_eligible === true));
assert.ok(Array.isArray(artifacts.learningEvent.field_level_diff));
assert.equal(typeof artifacts.learningEvent.candidate_changes.candidate_count, "number");
assert.equal(artifacts.correctedResolved.year, "2024-25");

const writerResolvedAbstain = buildV4FeedbackArtifacts({
  sessionId: "v4sess-writer-resolved-abstain",
  action: "EDIT",
  aiTitle: "",
  writerTitle: "2024 Topps Chrome Test Player Autograph PSA 10",
  resultPayload: {
    writer_review_required: true,
    identity_resolution_status: "ABSTAIN",
    resolved_fields: {}
  }
});
assert.equal(writerResolvedAbstain.status, "EDITED");
assert.equal(writerResolvedAbstain.feedbackEvent.generated_title, "");
assert.equal(writerResolvedAbstain.feedbackEvent.writer_final_title, "2024 Topps Chrome Test Player Auto PSA 10");
assert.equal(writerResolvedAbstain.learningEvent.training_eligible, true);

const writerRejectedAbstain = buildV4FeedbackArtifacts({
  sessionId: "v4sess-writer-rejected-abstain",
  action: "REJECT",
  aiTitle: "",
  writerTitle: "",
  resultPayload: { writer_review_required: true, identity_resolution_status: "ABSTAIN" }
});
assert.equal(writerRejectedAbstain.status, "REJECTED");
assert.equal(writerRejectedAbstain.feedbackEvent.writer_final_title, "");
assert.equal(writerRejectedAbstain.learningEvent.training_eligible, false);

const csmOrderedFeedback = buildV4FeedbackArtifacts({
  sessionId: "v4sess-csm-order",
  action: "EDIT",
  aiTitle: "1997-98 Bowman's Best Michael Jordan Best Performance (Chicago Bulls)",
  writerTitle: "Michael Jordan Chicago Bulls Best Performance 1997-98 Bowman's Best",
  resultPayload: {
    max_title_length: 85,
    resolved_fields: {
      year: "1997-98",
      product: "Bowman's Best",
      players: ["Michael Jordan"],
      card_name: "Best Performance",
      team: "Chicago Bulls"
    }
  }
});
assert.equal(csmOrderedFeedback.feedbackEvent.writer_final_title, "1997-98 Bowman's Best Michael Jordan Best Performance (Chicago Bulls)");
assert.equal(csmOrderedFeedback.rawWriterTitle, "Michael Jordan Chicago Bulls Best Performance 1997-98 Bowman's Best");
assert.equal(csmOrderedFeedback.csmNormalization.applied, true);
assert.equal(csmOrderedFeedback.feedbackEvent.title_diff.raw_writer_title, "Michael Jordan Chicago Bulls Best Performance 1997-98 Bowman's Best");
assert.equal(csmOrderedFeedback.learningEvent.feedback_training_event.writer_final_title, "1997-98 Bowman's Best Michael Jordan Best Performance (Chicago Bulls)");
assert.equal(
  csmOrderedFeedback.learningEvent.feedback_training_event.writer_raw_title,
  "Michael Jordan Chicago Bulls Best Performance 1997-98 Bowman's Best"
);

const rejectedFeedback = buildV4FeedbackArtifacts({
  sessionId: "v4sess-csm-reject",
  action: "REJECT",
  aiTitle: "1997-98 Bowman's Best Michael Jordan Best Performance (Chicago Bulls)",
  writerTitle: "wrong loose title",
  resultPayload: {
    resolved_fields: {
      year: "1997-98",
      product: "Bowman's Best",
      players: ["Michael Jordan"],
      card_name: "Best Performance",
      team: "Chicago Bulls"
    }
  }
});
assert.equal(rejectedFeedback.feedbackEvent.writer_final_title, "wrong loose title");
assert.equal(rejectedFeedback.csmNormalization.skipped_reason, "REJECTED_FEEDBACK");
assert.equal(rejectedFeedback.learningEvent.training_eligible, false);

const writes = [];
const reads = [];
const fakeFetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  if (init.method === "POST" || init.method === "PATCH") {
    writes.push({
      table: parsed.pathname.split("/").pop(),
      method: init.method,
      prefer: init.headers?.prefer || null,
      body: JSON.parse(init.body)
    });
    return {
      ok: true,
      status: init.method === "PATCH" ? 200 : 201,
      text: async () => JSON.stringify(Array.isArray(JSON.parse(init.body)) ? JSON.parse(init.body) : [JSON.parse(init.body)])
    };
  }
  reads.push(parsed.pathname.split("/").pop());
  return { ok: true, status: 200, text: async () => "[]" };
};
const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role"
};
await createV4RecognitionSession({
  sessionId: "v4sess-test",
  payload: { asset_id: "asset-1" },
  routePlan: route,
  env,
  fetchImpl: fakeFetch
});
await updateV4RecognitionSession({
  sessionId: "v4sess-test",
  patch: { status: "DRAFT_READY" },
  env,
  fetchImpl: fakeFetch
});
await persistV4FieldEvidence({
  sessionId: "v4sess-test",
  rows: rows.fieldEvidenceRows,
  env,
  fetchImpl: fakeFetch
});
await persistV4CandidateTrace({
  sessionId: "v4sess-test",
  trace: rows.candidateTrace,
  env,
  fetchImpl: fakeFetch
});
const atomicPersistenceCalls = [];
const atomicPersistence = await persistV4NonCriticalArtifactsAtomic({
  sessionId: "v4sess-test",
  fieldEvidenceRows: rows.fieldEvidenceRows,
  candidateTrace: rows.candidateTrace,
  catalogGap: {
    asset_id: "asset-1",
    gap_type: "CATALOG_IDENTITY_GAP",
    observed_fields: { year: "2024" },
    candidate_snapshot: {},
    draft_title: "2024 Test Player"
  },
  qualityLedger: {
    route: "FAST",
    provider: "openai_legacy",
    model: "gpt-5-mini",
    status: "DRAFT_READY"
  },
  env,
  fetchImpl: async (url, init = {}) => {
    atomicPersistenceCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        saved: true,
        recognition_session_id: "v4sess-test",
        field_evidence_count: rows.fieldEvidenceRows.length,
        candidate_trace_saved: true,
        catalog_gap_saved: true,
        quality_ledger_saved: true
      })
    };
  }
});
assert.equal(atomicPersistence.saved, true);
assert.equal(atomicPersistence.write_attempts, 1);
assert.ok(atomicPersistenceCalls[0].url.endsWith("/rest/v1/rpc/persist_v4_noncritical_artifacts"));
assert.equal(atomicPersistenceCalls[0].body.p_session_id, "v4sess-test");
assert.equal(atomicPersistenceCalls[0].body.p_field_evidence.length, rows.fieldEvidenceRows.length);
assert.equal(atomicPersistenceCalls[0].body.p_catalog_gap.asset_id, "asset-1");
await persistV4LearningEvent({
  event: artifacts.learningEvent,
  env,
  fetchImpl: fakeFetch
});
const feedbackTransactionCalls = [];
const feedbackTransaction = await persistV4WriterFeedbackTransaction({
  sessionId: "v4sess-test",
  operatorId: "operator-test",
  status: artifacts.status,
  feedbackEvent: artifacts.feedbackEvent,
  learningEvent: artifacts.learningEvent,
  env,
  fetchImpl: async (url, init = {}) => {
    feedbackTransactionCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        saved: true,
        recognition_session_id: "v4sess-test",
        feedback_event_id: artifacts.feedbackEvent.id,
        learning_event_id: artifacts.learningEvent.id
      })
    };
  }
});
assert.equal(feedbackTransaction.saved, true);
assert.ok(feedbackTransactionCalls[0].url.endsWith("/rest/v1/rpc/persist_v4_writer_feedback_transaction"));
assert.equal(feedbackTransactionCalls[0].body.p_session_id, "v4sess-test");
assert.equal(feedbackTransactionCalls[0].body.p_feedback_event.schema_version, "v4-recognition-session-v1");
assert.equal(feedbackTransactionCalls[0].body.p_learning_event.training_eligible, true);
const health = await checkV4Tables({ env, fetchImpl: fakeFetch });
assert.equal(health.configured, true);
assert.ok(writes.some((write) => write.table === "v4_recognition_sessions"));
assert.ok(writes.some((write) => write.table === "v4_field_evidence"));
assert.ok(writes.some((write) => write.table === "v4_candidate_traces"));
assert.ok(writes.find((write) => write.table === "v4_field_evidence")?.prefer?.includes("return=minimal"));
assert.ok(writes.find((write) => write.table === "v4_candidate_traces")?.prefer?.includes("return=minimal"));
assert.ok(writes.some((write) => write.table === "v4_learning_events"));
assert.ok(reads.includes("v4_production_quality_ledger"));
assert.ok(reads.includes("v4_writer_export_batches"));
assert.ok(reads.includes("v4_writer_export_items"));

const prewarmCalls = [];
const fakePrewarmFetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  prewarmCalls.push({ path: parsed.pathname, method: init.method || "GET" });
  if (parsed.pathname.includes("/rpc/search_catalog_candidates")) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{
        identity_id: "catalog-1",
        canonical_title: "1997-98 Bowman's Best Michael Jordan Best Performance",
        fields: { year: "1997-98", players: ["Michael Jordan"], product: "Bowman's Best" },
        retrieval_status: "reviewed",
        source_type: "INTERNAL_CORRECTED_TITLE",
        source_status: "REVIEWED_INTERNAL",
        normalized_score: 0.8,
        supporting_fields: ["year", "players", "product"]
      }])
    };
  }
  if (parsed.pathname.includes("/rpc/search_card_identities_hybrid")) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{
        identity_id: "identity-1",
        canonical_title: "1997-98 Bowman's Best Michael Jordan Best Performance",
        fields: { year: "1997-98", players: ["Michael Jordan"], product: "Bowman's Best" },
        retrieval_status: "reviewed",
        normalized_score: 0.7,
        supporting_fields: ["players"]
      }])
    };
  }
  return { ok: true, status: 200, text: async () => "[]" };
};
const prewarm = await runV4Prewarm({
  env: {
    ...env,
    VECTOR_INDEX_READY: "true",
    VERCEL_GIT_COMMIT_SHA: "abc123",
    VERCEL_GIT_COMMIT_REF: "main",
    PREWARM_CATALOG_TIMEOUT_MS: "1000",
    PREWARM_HYBRID_TIMEOUT_MS: "1000"
  },
  fetchImpl: fakePrewarmFetch
});
assert.equal(prewarm.ok, true);
assert.equal(prewarm.vector_index_ready, true);
assert.equal(prewarm.deployment.git_commit_sha, "abc123");
assert.ok(prewarm.steps.some((step) => step.name === "supabase_v4_tables" && step.ok));
assert.ok(prewarm.steps.some((step) => step.name === "catalog_rpc" && step.ok && step.candidate_count === 1));
assert.ok(prewarm.steps.some((step) => step.name === "postgres_hybrid_rpc" && step.ok && step.candidate_count === 1));
assert.ok(prewarmCalls.some((call) => call.path.includes("/rpc/search_catalog_candidates")));
assert.ok(prewarmCalls.some((call) => call.path.includes("/rpc/search_card_identities_hybrid")));
assert.deepEqual(v4DeploymentInfo({}).git_commit_sha, "");

console.log("v4 spine tests passed");
