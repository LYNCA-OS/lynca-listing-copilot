import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildFastScoutListingResult,
  selectFastScoutImages
} from "../lib/listing/v4/fast-scout/fast-scout-observation.mjs";
import { runV4Prewarm, v4DeploymentInfo } from "../lib/listing/v4/prewarm.mjs";
import { adaptV2ResultToV4, buildV4PersistenceRows } from "../lib/listing/v4/result-adapter.mjs";
import { buildV4FeedbackArtifacts } from "../lib/listing/v4/feedback/feedback-loop.mjs";
import { planV4RecognitionRoute } from "../lib/listing/v4/route-planner/route-planner.mjs";
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
  updateV4RecognitionSession
} from "../lib/listing/v4/session/session-store.mjs";
import { numberArg as smokeNumberArg, summaryHasVisibleL2Title } from "./v4-ebay-smoke.mjs";

assert.equal(smokeNumberArg(["node", "smoke"], "--request-timeout-ms", 90_000), 90_000);
assert.equal(smokeNumberArg(["node", "smoke", "--request-timeout-ms", ""], "--request-timeout-ms", 90_000), 90_000);
assert.equal(smokeNumberArg(["node", "smoke", "--offset", "0"], "--offset", 12), 0);
assert.equal(smokeNumberArg(["node", "smoke", "--limit", "not-a-number"], "--limit", 10), 10);
assert.equal(summaryHasVisibleL2Title({ session_status: "DRAFT_READY", l2_status: "READY", title: "Final title" }), true);
assert.equal(typeof summaryHasVisibleL2Title({ session_status: "DRAFT_READY", l2_status: "READY", title: "Final title" }), "boolean");
assert.equal(summaryHasVisibleL2Title({ session_status: "DRAFT_READY", l2_status: "READY", title: "" }), false);

const v4TitleApiSource = await readFile("api/v4/listing-copilot-title.js", "utf8");
const fastScoutPrewarmApiSource = await readFile("api/v4/fast-scout-prewarm.js", "utf8");
const queueMigrationApiSource = await readFile("api/admin-apply-v4-production-job-queue-migration.js", "utf8");
const queueStatusApiSource = await readFile("api/v4/listing-job-status.js", "utf8");
const queueWorkerApiSource = await readFile("api/v4/listing-job-worker.js", "utf8");
const v4SmokeSource = await readFile("scripts/v4-ebay-smoke.mjs", "utf8");
const vercelConfigSource = await readFile("vercel.json", "utf8");
assert.match(v4TitleApiSource, /ENABLE_V4_DEFER_NONCRITICAL_PERSISTENCE/, "V4 must keep a kill switch for deferred non-critical persistence.");
assert.match(v4TitleApiSource, /noncritical_persistence_status: deferNonCriticalPersistence \? "DEFERRED" : "SYNC"/, "writer-ready sessions must expose whether non-critical persistence was deferred.");
assert.match(v4TitleApiSource, /scheduleV4Background\(persistV4NonCriticalArtifacts/, "field evidence, candidate trace, catalog gap, and ledger persistence must not block writer-ready L2 by default.");
assert.match(v4SmokeSource, /const prewarmPromise = prewarm/, "production smoke must start the free cache probe independently.");
assert.match(v4SmokeSource, /const prewarmResult = await prewarmPromise/, "speculative smoke must finish its cache probe before final telemetry is assembled.");
assert.match(v4SmokeSource, /prewarmCacheOnly: !hasFlag\(argv, "--paid-prewarm"\)/, "direct smoke prewarm must stay cache-only and avoid a duplicate provider call.");
assert.match(v4SmokeSource, /create_l1_job: enableL1/, "hidden L1 must be explicit experiment-only work rather than a default paid stage.");
assert.match(v4SmokeSource, /create_l2_job: true/, "production smoke must always poll the final L2 stage.");
assert.doesNotMatch(v4SmokeSource, /l1Payload|l1Outcome|Promise\.allSettled/, "production smoke must not issue a duplicate writer-facing L1 request.");
assert.match(v4SmokeSource, /l2_catalog_raw_candidate_count/, "speculative smoke must retain catalog funnel diagnostics.");
assert.match(v4SmokeSource, /input_tokens: finalProviderDiagnostics\.input_tokens/, "speculative smoke must retain provider token diagnostics.");
assert.match(v4SmokeSource, /recognition_phase_loaded_sealed_labels: false/, "blind smoke must not load sealed seller titles during recognition.");
assert.match(v4SmokeSource, /predictions_frozen_before_scoring: true/, "blind smoke must freeze predictions before local weak-label scoring.");
assert.match(v4SmokeSource, /pollBatchJobs/, "large production smoke must use one shared batch poller instead of one poll loop per card.");
assert.match(v4SmokeSource, /async function enqueueSpeculativeItem[\s\S]*const l1Job =[\s\S]*l1_job: l1Job/, "batch enqueue must retain the paired L1 job without referencing an out-of-scope variable.");
assert.match(v4SmokeSource, /concurrency: Math\.max\(1, Math\.trunc\(numberArg\(argv, "--concurrency", 2\)\)\)/, "smoke preparation and enqueue must default to the validated concurrency of two.");
assert.match(fastScoutPrewarmApiSource, /allowProviderCall: payload\.v4_fast_scout_cache_only !== true/, "production can probe the scout cache without putting another model call before L2.");
assert.match(fastScoutPrewarmApiSource, /FAST_SCOUT_CACHE_MISS_PROVIDER_DISABLED/, "a cache-only miss must be an expected route signal rather than a provider failure.");
assert.match(fastScoutPrewarmApiSource, /prewarm_status: "CACHE_MISS"/, "cache-only misses must return a stable non-error response.");
assert.match(vercelConfigSource, /admin-apply-v4-production-job-queue-migration\.js/, "the production migration function must have an explicit Vercel bundle rule.");
assert.match(vercelConfigSource, /supabase\/migrations\/\*\.sql/, "all required SQL migrations must ship with the admin migration function.");
assert.match(queueMigrationApiSource, /fair_batch_claim_ok/, "the migration probe must exercise cross-batch fairness on the real database.");
assert.match(queueMigrationApiSource, /capacity_bound_ok/, "the migration probe must prove capacity cannot be over-claimed.");
assert.match(queueMigrationApiSource, /kick_dedup_ok/, "the migration probe must prove duplicate pump kicks collapse.");
assert.match(queueStatusApiSource, /paired_l1_wait_ms/, "queue metrics must separate intentional L1 dependency time from scheduler delay.");
assert.match(queueStatusApiSource, /scheduler_queue_wait_ms/, "queue metrics must expose actual scheduler delay after a paired L2 becomes runnable.");
assert.match(queueWorkerApiSource, /retryable: error\?\.retryable/, "queue workers must preserve provider retryability instead of retrying deterministic contract failures.");

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
  }
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
await persistV4LearningEvent({
  event: artifacts.learningEvent,
  env,
  fetchImpl: fakeFetch
});
const health = await checkV4Tables({ env, fetchImpl: fakeFetch });
assert.equal(health.configured, true);
assert.ok(writes.some((write) => write.table === "v4_recognition_sessions"));
assert.ok(writes.some((write) => write.table === "v4_field_evidence"));
assert.ok(writes.some((write) => write.table === "v4_candidate_traces"));
assert.ok(writes.some((write) => write.table === "v4_learning_events"));
assert.ok(reads.includes("v4_production_quality_ledger"));

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
