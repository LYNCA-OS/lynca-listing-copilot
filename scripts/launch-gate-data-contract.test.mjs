import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertRecognitionManifestBlind,
  buildLaunchGateMixedManifest
} from "./build-launch-gate-mixed-manifest.mjs";
import {
  assertLaunchGateDatasetContract,
  assertLaunchGateFormalAccuracy,
  assertObservedExecutionContract,
  assertProviderControlPlane,
  assertRuntimeSnapshot,
  assertSupabaseGlobalQueueEmpty,
  assertWriterPerceivedSpeed,
  buildLaunchGateFormalAccuracyGate,
  buildLaunchGateReport,
  buildWriterPerceivedSpeedGate,
  datasetForLaunchGateProfile,
  deploymentProtectedFetch,
  deploymentDrift,
  launchGateAccuracyContract,
  launchGateExecutionContract,
  launchGateSpeedContract,
  main as runLaunchGateMain,
  numberArg as launchGateNumberArg,
  observedExecutionContractChecks,
  runLaunchGateEvaluation,
  runtimeSnapshot
} from "./run-launch-gate-eval.mjs";

assert.deepEqual(await assertSupabaseGlobalQueueEmpty({
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key"
  },
  fetchImpl: async () => new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" }
  })
}), {
  checked: true,
  empty: true,
  checked_statuses: ["QUEUED", "RETRYING", "RUNNING"]
});
await assert.rejects(() => assertSupabaseGlobalQueueEmpty({
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key"
  },
  fetchImpl: async () => new Response(JSON.stringify([{ id: "job-1", status: "RUNNING" }]), {
    status: 200,
    headers: { "content-type": "application/json" }
  })
}), /Global queue is not empty/);
import {
  attachPostRecognitionScoring,
  compactCandidateTrace,
  createConcurrencyGate,
  mapWithConcurrency,
  resultFromBatchJob,
  summarizeProviderSlotIdleGaps
} from "./v4-ebay-smoke.mjs";

assert.deepEqual(summarizeProviderSlotIdleGaps([
  {
    provider_capacity_slot: 1,
    provider_slot_timing: {
      started_at: "2026-07-24T00:00:00.000Z",
      completed_at: "2026-07-24T00:00:10.000Z"
    }
  },
  {
    provider_capacity_slot: 1,
    provider_slot_timing: {
      started_at: "2026-07-24T00:00:12.000Z",
      completed_at: "2026-07-24T00:00:20.000Z"
    }
  },
  {
    provider_capacity_slot: 2,
    provider_slot_timing: {
      started_at: "2026-07-24T00:00:01.000Z",
      completed_at: "2026-07-24T00:00:11.000Z"
    }
  }
]), {
  schema_version: "provider-slot-idle-gap-v1",
  measured_interval_count: 3,
  missing_interval_count: 0,
  measured_slot_count: 2,
  overlap_violation_count: 0,
  idle_gap_total_ms: 2000,
  idle_gap_p50_ms: 2000,
  idle_gap_p95_ms: 2000,
  idle_gap_max_ms: 2000,
  slots: {
    1: {
      interval_count: 2,
      idle_gap_count: 1,
      idle_gap_total_ms: 2000,
      idle_gap_p50_ms: 2000,
      idle_gap_p95_ms: 2000,
      idle_gap_max_ms: 2000
    },
    2: {
      interval_count: 1,
      idle_gap_count: 0,
      idle_gap_total_ms: 0,
      idle_gap_p50_ms: null,
      idle_gap_p95_ms: null,
      idle_gap_max_ms: null
    }
  }
});

assert.equal(launchGateNumberArg([], "--request-timeout-ms", 120_000), 120_000);
assert.equal(launchGateNumberArg(["--request-timeout-ms", ""], "--request-timeout-ms", 120_000), 120_000);
assert.equal(launchGateNumberArg(["--think-ms", "0"], "--think-ms", 6_000), 0);
assert.equal(launchGateNumberArg(["--l2-wait-ms", "240000"], "--l2-wait-ms", 18_000), 240_000);

{
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ input: String(input), headers: Object.fromEntries(new Headers(init.headers || {}).entries()) });
    return new Response("{}", { status: 200 });
  };
  const protectedFetch = deploymentProtectedFetch(fetchImpl, {
    baseUrl: "https://candidate.example.test",
    bypassSecret: "test-bypass-secret"
  });
  await protectedFetch("https://candidate.example.test/api/v4/health", {
    headers: { accept: "application/json" }
  });
  await protectedFetch("https://signed-storage.example.test/image.jpg");
  assert.equal(calls[0].headers["x-vercel-protection-bypass"], "test-bypass-secret");
  assert.equal(calls[0].headers.accept, "application/json");
  assert.equal(calls[1].headers["x-vercel-protection-bypass"], undefined, "bypass credentials must not leak to signed storage origins");
}

{
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ input: String(input), headers: Object.fromEntries(new Headers(init.headers || {}).entries()) });
    return new Response("{}", { status: 200 });
  };
  const protectedFetch = deploymentProtectedFetch(fetchImpl, {
    baseUrl: "https://candidate.example.test",
    bypassCookie: "_vercel_jwt=short-lived-test-cookie"
  });
  await protectedFetch("https://candidate.example.test/api/jobs", {
    headers: { cookie: "lynca_session=application-session" }
  });
  await protectedFetch("https://signed-storage.example.test/image.jpg", {
    headers: { cookie: "storage_cookie=keep" }
  });
  assert.equal(calls[0].headers.cookie, "lynca_session=application-session; _vercel_jwt=short-lived-test-cookie");
  assert.equal(calls[1].headers.cookie, "storage_cookie=keep", "deployment cookie must not leak to signed storage origins");
}

const compactRetrievalAudit = compactCandidateTrace({
  retrieval_application: {
    schema_version: "retrieval-application-v1",
    enabled: true,
    candidate_count: 1,
    field_evidence_count: 1,
    decision_counts: { BLOCK: 1 },
    decisions: [{
      candidate_id: "candidate-1",
      candidate_lane: "catalog",
      field: "product",
      old_value: "",
      candidate_value: "Topps Chrome",
      decision: "BLOCK",
      reason: "anchor_missing"
    }]
  }
});
assert.equal(compactRetrievalAudit.retrieval_application.field_evidence_count, 1);
assert.equal(compactRetrievalAudit.retrieval_application.decisions[0].reason, "anchor_missing");

{
  const jobId = "job-vector-self-exclusion";
  const result = resultFromBatchJob({
    asset_id: "asset-vector-self-exclusion",
    tenant_id: "tenant-vector-self-exclusion",
    batch_id: "batch-vector-self-exclusion",
    job: { job_id: jobId },
    item: { images: [{ image_id: "image-1" }] },
    enqueue: { http_status: 202, data: {} }
  }, {
    jobsById: new Map([[jobId, {
      job_id: jobId,
      tenant_id: "tenant-vector-self-exclusion",
      status: "L2_READY",
      display_status: "FINAL_READY",
      session: {
        final_title: "2026 Topps Chrome Test Player",
        provider_result_summary: {},
        candidate_control_plane_trace: {
          vector_activation_funnel: {
            self_exclusion_query_attempted: true,
            self_exclusion_filter_active: true,
            self_exclusion_requested_source_count: 1,
            self_exclusion_source_ids_sha256: "source-feedback-hash",
            self_excluded_count: 1
          }
        }
      },
      timing: { time_to_l2_ready_ms: 1000 }
    }]]),
    polls: 1,
    elapsed_ms: 1000,
    fatal_error: null,
    last_error: null
  });
  assert.equal(result.vector_self_exclusion_query_attempted, true);
  assert.equal(result.vector_self_exclusion_filter_active, true);
  assert.equal(result.vector_self_exclusion_requested_source_count, 1);
  assert.equal(result.vector_self_exclusion_source_ids_sha256, "source-feedback-hash");
  assert.equal(result.vector_self_excluded_count, 1);
}

{
  let active = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 6 }, (_, index) => index), 2, async (index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2 + (index % 2)));
    active -= 1;
  });
  assert.equal(peak, 2, "submission concurrency must remain capped at the configured limit");
}

{
  let active = 0;
  let peak = 0;
  const gate = createConcurrencyGate(2);
  await Promise.all(Array.from({ length: 8 }, () => gate(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active -= 1;
  })));
  assert.equal(peak, 2, "queue submission gate must remain independent from preparation concurrency");
}

function reviewedSourceItem(index) {
  return {
    asset_id: `reviewed-source-${index}`,
    source_feedback_id: `feedback-${index}`,
    category: "collectible_card",
    source_titles: { corrected_title: `2026 Reviewed Secret Player ${index} PSA 10` },
    source_record: { reviewed_ground_truth: true },
    images: [{
      image_id: `reviewed-image-${index}`,
      bucket: "cards",
      object_path: `reviewed/${index}/front.jpg`,
      role: "image_1_original"
    }]
  };
}

function ebaySourceItem(index) {
  return {
    asset_id: `ebay_image_only_case-${index}`,
    source_feedback_id: `ebay:image_only:case-${index}`,
    physical_card_id: `ebay_image_only_case-${index}`,
    category: "collectible_card",
    canonical_title: "",
    source_titles: {},
    sealed_eval_label_ref: { key: `ebay-key-${index}` },
    source_record: {
      source_type: "IMAGE_ONLY_MARKETPLACE_CAPTURE",
      sealed_eval_label_key: `ebay-key-${index}`,
      seller_title_visible_to_model: false
    },
    images: [{
      image_id: `ebay-image-${index}`,
      bucket: "cards",
      object_path: `ebay/${index}/front.jpg`,
      role: "image_1_original"
    }]
  };
}

function ebayReference(index) {
  return {
    key: `ebay-key-${index}`,
    case_id: `case-${index}`,
    item_id: `ebay-item-${index}`,
    title: `2026 eBay Weak Secret Player ${index} BGS 9.5`,
    policy: {
      seller_title_is_ground_truth: false,
      model_prompt_visible: false
    }
  };
}

function prohibitedPaths(value, path = "$", output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => prohibitedPaths(entry, `${path}[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, entry] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (/(?:title|label)/i.test(key)) output.push(next);
    prohibitedPaths(entry, next, output);
  }
  return output;
}

function makeReviewedDataset(count = 10) {
  return {
    schema_version: "reviewed-title-blind-eval-v1",
    item_count: count,
    evaluation_sample_policy: {
      mode: "RANDOM_BLIND",
      randomized_selection: true,
      randomization_verified: true,
      selection_strategy: "seeded_sha256_source_feedback_id",
      sample_seed_sha256: "reviewed-ten-seed-sha256",
      selected_item_ids_sha256: `reviewed-${count}-items-sha256`
    },
    items: Array.from({ length: count }, (_, index) => ({
      asset_id: `reviewed-${index + 1}`,
      physical_card_id: `reviewed-${index + 1}`,
      source_feedback_id: `feedback-${index + 1}`,
      category: "collectible_card",
      canonical_title: "",
      source_titles: { corrected_title: `Must Stay Sealed ${index + 1}` },
      sealed_eval_label_ref: { key: `reviewed-key-${index + 1}` },
      source_record: {
        source_type: "REVIEWED_INTERNAL_IMAGE_ONLY",
        self_retrieval_exclusion_required: true,
        reviewed_title_visible_to_model: false,
        title_derived_fields_visible_to_model: false
      },
      images: [{
        image_id: `image-${index + 1}`,
        bucket: "cards",
        object_path: `reviewed/${index + 1}/front.jpg`
      }]
    }))
  };
}

function reviewedTenDataset() {
  return makeReviewedDataset(10);
}

function runtimeHealth() {
  return {
    ready: true,
    default_model: "gpt-5-mini",
    deployment: {
      deployment_id: "dpl_launch_gate",
      git_commit_sha: "abc123",
      git_commit_ref: "main"
    },
    production_queue: {
      configured: true,
      worker_secret_configured: true
    }
  };
}

function providerStatus() {
  return {
    deployment: {
      deployment_id: "dpl_launch_gate",
      git_commit_sha: "abc123"
    },
    providers: [{ selectable: true, model_id: "gpt-5-mini" }],
    execution_control: {
      recognition_worker: { enabled: true, configured: true },
      paddle_ocr_verifier: { enabled: true, configured: true },
      provider_key_pool_size: 1,
      per_key_stable_concurrency: 2,
      global_provider_concurrency: 2,
      queue_submission_concurrency: 2
    }
  };
}

function scoredResult({ assetId, reviewed = false, score = 1, finalTitle = "" }) {
  const ordinal = Number((assetId.match(/(\d+)$/) || [0, 1])[1]);
  const providerSlot = ordinal % 2 === 0 ? 2 : 1;
  const intervalStartedAt = Date.parse("2026-07-24T00:00:00.000Z") + Math.floor((ordinal - 1) / 2) * 11_000;
  return {
    asset_id: assetId,
    ok: true,
    l2_ready: true,
    writer_ready: true,
    final_title: finalTitle,
    provider_image_detail: "high",
    provider_prompt_mode: "v4_compact_l2",
    identity_cache_hit: false,
    identity_cache_read_bypassed: true,
    provider_call_skipped: false,
    provider_calls: 1,
    provider_capacity_slot: providerSlot,
    provider_slot_timing: {
      started_at: new Date(intervalStartedAt).toISOString(),
      completed_at: new Date(intervalStartedAt + 10_000).toISOString()
    },
    recognition_benchmark_profile: "cold_algorithm_benchmark",
    vector_self_exclusion_query_attempted: true,
    vector_self_exclusion_filter_active: true,
    vector_self_exclusion_requested_source_count: 1,
    vector_self_exclusion_source_ids_sha256: "offline-source-feedback-hash",
    reference_title_type: reviewed ? "REVIEWED_INTERNAL_TITLE" : "MARKETPLACE_WEAK_LABEL",
    reference_title_is_reviewed_ground_truth: reviewed,
    sem_projection_scoring: {
      weighted_accuracy: score,
      accepted: score >= 0.87,
      components: []
    },
    final_scoring: { policy_fair_token_recall: score }
  };
}

function rawRunReport(results, { coldStartBlind = false } = {}) {
  return {
    model_override: "gpt-5-mini",
    concurrency: 2,
    preparation_concurrency: 3,
    submission_concurrency: 2,
    provider_concurrency: 2,
    identity_cache_disabled: true,
    fast_initial_prompt_override: false,
    compact_l2_enabled: true,
    cold_start_blind: coldStartBlind,
    predictions_sha256: "offline-predictions-sha256",
    run_wall_ms: 1000,
    evaluation_sample_policy: { provenance_verified: true },
    summary: { provider_slot_idle_gaps: summarizeProviderSlotIdleGaps(results) },
    results
  };
}

const root = await mkdtemp(join(tmpdir(), "lynca-launch-gate-data-"));
try {
  const reviewedPath = join(root, "reviewed-source.json");
  const reviewedSmallPath = join(root, "reviewed-source-small.json");
  const ebayDatasetPath = join(root, "ebay-dataset.json");
  const ebayLabelsPath = join(root, "ebay-sealed.jsonl");
  const manifestPath = join(root, "mixed-manifest.json");
  const sealedPath = join(root, "mixed-sealed.jsonl");
  const reviewedItems = [1, 2, 3].map(reviewedSourceItem);
  const ebayItems = [1, 2, 3, 4].map(ebaySourceItem);
  const ebayReferences = [1, 2, 3, 4].map(ebayReference);
  await writeFile(reviewedPath, `${JSON.stringify({ items: reviewedItems })}\n`);
  await writeFile(reviewedSmallPath, `${JSON.stringify({ items: reviewedItems.slice(0, 1) })}\n`);
  await writeFile(ebayDatasetPath, `${JSON.stringify({ items: ebayItems })}\n`);
  await writeFile(ebayLabelsPath, `${ebayReferences.map((row) => JSON.stringify(row)).join("\n")}\n`);

  const built = await buildLaunchGateMixedManifest({
    reviewedSourcePath: reviewedPath,
    ebayDatasetPath,
    ebayLabelsPath,
    outPath: manifestPath,
    labelsOutPath: sealedPath,
    targetPerCohort: 2,
    selectionSeed: "fixed-mixed-seed",
    now: new Date("2026-07-16T00:00:00.000Z")
  });
  assert.equal(built.manifest.item_count, 4);
  assert.equal(built.manifest.allocation.selected_per_cohort, 2);
  assert.equal(built.manifest.allocation.downsized, false);
  assert.equal(built.manifest.evaluation_sample_policy.mode, "RANDOM_BLIND");
  assert.equal(built.manifest.evaluation_sample_policy.randomization_verified, true);
  assert.deepEqual(prohibitedPaths(built.manifest), []);
  assert.equal(built.blindVerification.verified, true);
  assert.equal(built.manifest.items.filter((item) => item.evaluation_cohort === "INTERNAL_REVIEWED_GT").length, 2);
  assert.equal(built.manifest.items.filter((item) => item.evaluation_cohort === "EBAY_COLD_START").length, 2);
  assert.ok(built.manifest.items.filter((item) => item.evaluation_cohort === "INTERNAL_REVIEWED_GT")
    .every((item) => item.self_retrieval_exclusion_required === true && item.cold_start_blind === false));
  assert.ok(built.manifest.items.filter((item) => item.evaluation_cohort === "EBAY_COLD_START")
    .every((item) => item.cold_start_blind === true));
  assert.ok(built.sealedRows.filter((row) => row.evaluation_cohort === "EBAY_WEAK_LABEL")
    .every((row) => row.case_id === row.asset_id.replace(/^ebay_image_only_/, "")));
  const sealedLookup = new Map();
  for (const row of built.sealedRows) {
    sealedLookup.set(row.key, row);
    sealedLookup.set(row.case_id, row);
  }
  const attached = attachPostRecognitionScoring(
    built.manifest.items.map((item) => ({ asset_id: item.asset_id, ok: true, final_title: "offline prediction" })),
    built.manifest.items,
    sealedLookup
  );
  assert.equal(attached.filter((row) => row.reference_title_type === "REVIEWED_INTERNAL_TITLE").length, 2);
  assert.equal(attached.filter((row) => row.reference_title_type === "MARKETPLACE_WEAK_LABEL").length, 2);
  const manifestText = await readFile(manifestPath, "utf8");
  for (const item of reviewedItems) assert.doesNotMatch(manifestText, new RegExp(item.source_titles.corrected_title));
  for (const row of ebayReferences) assert.doesNotMatch(manifestText, new RegExp(row.title));
  const sealedText = await readFile(sealedPath, "utf8");
  assert.match(sealedText, /Reviewed Secret Player/);
  assert.match(sealedText, /eBay Weak Secret Player/);

  const repeated = await buildLaunchGateMixedManifest({
    reviewedSourcePath: reviewedPath,
    ebayDatasetPath,
    ebayLabelsPath,
    targetPerCohort: 2,
    selectionSeed: "fixed-mixed-seed",
    writeOutputs: false
  });
  assert.deepEqual(
    repeated.manifest.items.map((item) => item.asset_id),
    built.manifest.items.map((item) => item.asset_id)
  );

  const downsized = await buildLaunchGateMixedManifest({
    reviewedSourcePath: reviewedSmallPath,
    ebayDatasetPath,
    ebayLabelsPath,
    targetPerCohort: 2,
    selectionSeed: "downsize-seed",
    writeOutputs: false
  });
  assert.equal(downsized.manifest.item_count, 2);
  assert.equal(downsized.manifest.allocation.selected_per_cohort, 1);
  assert.equal(downsized.manifest.allocation.downsized, true);
  assert.equal(downsized.manifest.allocation.internal_reviewed_gt.shortfall_count, 1);
  assert.equal(downsized.manifest.allocation.ebay_cold_start.selected_count, 1);

  const defaultSeed = await buildLaunchGateMixedManifest({
    reviewedSourcePath: reviewedPath,
    ebayDatasetPath,
    ebayLabelsPath,
    targetPerCohort: 1,
    seedFactory: () => "random-seed-from-factory",
    writeOutputs: false
  });
  assert.equal(defaultSeed.manifest.selection_seed, "mixed-random-seed-from-factory");
  assertRecognitionManifestBlind(defaultSeed.manifest, defaultSeed.sealedRows);
  assert.throws(() => assertRecognitionManifestBlind({ items: [{ reviewed_title: "leak" }] }, []), /prohibited title\/label keys/);

  const reviewedDataset = reviewedTenDataset();
  const reviewedContract = assertLaunchGateDatasetContract(reviewedDataset, { profile: "reviewed-10" });
  assert.equal(reviewedContract.item_count, 10);
  assert.equal(reviewedContract.self_retrieval_exclusion.payload_verified_count, 10);
  const reviewedRegressionDataset = {
    ...reviewedDataset,
    evaluation_sample_policy: {
      ...reviewedDataset.evaluation_sample_policy,
      mode: "FIXED_REGRESSION",
      sample_reuse_permitted: true,
      reuse_reason: "previous_failed10_replay",
      reuse_scope_id: "failed10-v1",
      reuse_policy_complete: true,
      generalization_claim_permitted: false,
      randomized_selection: false,
      selection_strategy: null,
      sample_seed_sha256: null
    }
  };
  assert.equal(
    assertLaunchGateDatasetContract(reviewedRegressionDataset, { profile: "reviewed-10" }).item_count,
    10
  );
  assert.throws(() => assertLaunchGateDatasetContract({
    ...reviewedRegressionDataset,
    evaluation_sample_policy: {
      ...reviewedRegressionDataset.evaluation_sample_policy,
      reuse_reason: null
    }
  }, { profile: "reviewed-10" }), /reuse requires reuse_reason/);
  assert.throws(() => assertLaunchGateDatasetContract({ ...reviewedDataset, items: reviewedDataset.items.slice(0, 9) }, {
    profile: "reviewed-10"
  }), /exactly 10/);
  assert.throws(() => assertLaunchGateDatasetContract({
    ...reviewedDataset,
    items: reviewedDataset.items.map((item, index) => index === 0 ? { ...item, source_feedback_id: "" } : item)
  }, { profile: "reviewed-10" }), /source_feedback_id_missing/);
  const mixedContract = assertLaunchGateDatasetContract(built.manifest, { profile: "mixed-100" });
  assert.deepEqual(mixedContract.cohort_counts, { internal_reviewed_gt: 2, ebay_cold_start: 2, unknown: 0 });
  const ebayTemplate = built.manifest.items.find((item) => item.evaluation_cohort === "EBAY_COLD_START");
  const ebayFiftySource = {
    ...built.manifest,
    item_count: 50,
    allocation: undefined,
    evaluation_sample_policy: {
      ...built.manifest.evaluation_sample_policy,
      selected_item_count: 50,
      selected_item_ids_sha256: "ebay-fifty-items-sha256"
    },
    items: Array.from({ length: 50 }, (_, index) => ({
      ...structuredClone(ebayTemplate),
      asset_id: `ebay-random-${index + 1}`,
      physical_card_id: `ebay-random-${index + 1}`,
      source_feedback_id: `ebay:random:${index + 1}`,
      images: ebayTemplate.images.map((image) => ({
        ...image,
        image_id: `ebay-random-image-${index + 1}`,
        object_path: `ebay/random/${index + 1}.jpg`
      }))
    }))
  };
  const ebayFifty = datasetForLaunchGateProfile(ebayFiftySource, "ebay-50");
  const ebayFiftyContract = assertLaunchGateDatasetContract(ebayFifty, { profile: "ebay-50" });
  assert.deepEqual(ebayFiftyContract.cohort_counts, { internal_reviewed_gt: 0, ebay_cold_start: 50, unknown: 0 });
  assert.equal(ebayFiftyContract.self_retrieval_exclusion.required_count, 0);

  assert.deepEqual(launchGateExecutionContract, {
    model: "gpt-5-mini",
    image_detail: "high",
    provider_prompt_mode: "v4_compact_l2",
    provider_concurrency: 2,
    preparation_concurrency: 3,
    submission_concurrency: 2,
    identity_cache_disabled: true,
    recognition_benchmark_profile: "cold_algorithm_benchmark",
    ultra_fast_l2: false
  });
  assert.deepEqual(launchGateAccuracyContract, {
    contract_version: "listing-evaluation-gate-v4-2026-07-19",
    frozen_at: "2026-07-19",
    primary_metric: "policy_fair_token_recall_avg",
    sem_role: "catastrophic_single_card_guard_only",
    deprecated_primary_metric: "per_item_sem_acceptance_rate_at_0.87",
    per_item_sem_acceptance_threshold: 0.87,
    reviewed_10_minimum_token_recall: 0.85,
    reviewed_10_minimum_sem_floor: 0.5,
    reviewed_50_minimum_token_recall: 0.87,
    reviewed_50_minimum_sem_floor: 0.5,
    mixed_100_minimum_token_recall: 0.87,
    mixed_100_minimum_sem_floor: 0.5,
    formal_scope: "internal_reviewed_gt_only",
    ebay_reference_role: "diagnostics_only",
    historical_exposure_exclusion: false,
    required_sequence: ["reviewed-50", "ebay-50", "mixed-100"]
  });
  assert.deepEqual(launchGateSpeedContract, {
    minimum_writer_perceived_cards_per_minute: 6,
    required_profiles: ["reviewed-10", "reviewed-50", "ebay-50", "mixed-100"],
    clock_start: "first_writer_upload_started",
    clock_stop: "all_complete_recognition_results_available",
    excluded_setup: ["candidate_protection", "dataset_download", "image_materialization", "prewarm"]
  });
  const reviewedFifty = datasetForLaunchGateProfile(makeReviewedDataset(50), "reviewed-50");
  assert.equal(reviewedFifty.items.length, 50);
  assert.equal(assertLaunchGateDatasetContract(reviewedFifty, { profile: "reviewed-50" }).cohort_counts.internal_reviewed_gt, 50);
  const reviewedTenFromFifty = datasetForLaunchGateProfile(makeReviewedDataset(50), "reviewed-10");
  assert.equal(reviewedTenFromFifty.items.length, 10);
  assert.equal(
    assertLaunchGateDatasetContract(reviewedTenFromFifty, { profile: "reviewed-10" }).cohort_counts.internal_reviewed_gt,
    10
  );
  assert.equal(reviewedTenFromFifty.evaluation_sample_policy.selected_item_count, 10);
  const writerSpeedPass = buildWriterPerceivedSpeedGate({
    profile: "mixed-100",
    runReports: [{
      run_wall_ms: 20_000,
      results: [
        { ok: true, l2_ready: true },
        { ok: true, l2_ready: true }
      ]
    }]
  });
  assert.equal(writerSpeedPass.actual_cards_per_minute, 6);
  assert.equal(writerSpeedPass.passed, true);
  assertWriterPerceivedSpeed({ writer_perceived_speed_gate: writerSpeedPass });
  const writerSpeedFail = buildWriterPerceivedSpeedGate({
    profile: "mixed-100",
    runReports: [{
      run_wall_ms: 20_001,
      results: [
        { ok: true, l2_ready: true },
        { ok: true, l2_ready: true }
      ]
    }]
  });
  assert.equal(writerSpeedFail.passed, false);
  assert.throws(
    () => assertWriterPerceivedSpeed({ writer_perceived_speed_gate: writerSpeedFail }),
    /minimum_rate_met/
  );
  const strategyReplaySpeed = buildWriterPerceivedSpeedGate({
    profile: "reviewed-10",
    evaluationMode: "strategy-replay",
    runReports: [{
      run_wall_ms: 60_000,
      verified_asset_cache: { hit_count: 10 },
      results: Array.from({ length: 10 }, () => ({ ok: true, l2_ready: true }))
    }]
  });
  assert.equal(strategyReplaySpeed.required, false);
  assert.equal(strategyReplaySpeed.formal_chain_proof_eligible, false);
  assert.equal(strategyReplaySpeed.passed, true);
  const mixedFiftyGate = buildLaunchGateFormalAccuracyGate({
    profile: "mixed-100",
    cohortCount: 50,
    internalMetrics: {
      formal_accuracy: {
        eligible: true,
        measured_count: 50,
        correct_count: 44,
        rate: 0.88,
        sem_weighted_accuracy_min: 0.6,
        token_recall: { measured_count: 50, average: 0.88 }
      }
    },
    ebayMetrics: { formal_accuracy_eligible: false }
  });
  assert.equal(mixedFiftyGate.required_correct_count, null);
  assert.equal(mixedFiftyGate.passed, true);
  const reviewedFiftyAccuracyGate = buildLaunchGateFormalAccuracyGate({
    profile: "reviewed-50",
    cohortCount: 50,
    internalMetrics: {
      formal_accuracy: {
        eligible: true,
        measured_count: 50,
        correct_count: 1,
        rate: 0.02,
        sem_weighted_accuracy_min: 0.5,
        token_recall: { measured_count: 50, average: 0.87 }
      }
    },
    ebayMetrics: { formal_accuracy_eligible: false }
  });
  assert.equal(reviewedFiftyAccuracyGate.threshold_rate, 0.87);
  assert.equal(reviewedFiftyAccuracyGate.sem_diagnostics.catastrophic_floor, 0.5);
  assert.equal(reviewedFiftyAccuracyGate.passed, true);
  const ebayFiftyDiagnosticGate = buildLaunchGateFormalAccuracyGate({
    profile: "ebay-50",
    cohortCount: 50,
    internalMetrics: { formal_accuracy_eligible: false },
    ebayMetrics: { formal_accuracy_eligible: false, attempted_count: 50 }
  });
  assert.equal(ebayFiftyDiagnosticGate.scope, "ebay_external_distribution_diagnostics_only");
  assert.equal(ebayFiftyDiagnosticGate.decision_metric, null);
  assert.equal(ebayFiftyDiagnosticGate.passed, true);
  assert.equal(buildLaunchGateFormalAccuracyGate({
    profile: "mixed-100",
    cohortCount: 50,
    internalMetrics: {
      formal_accuracy: {
        eligible: true,
        measured_count: 50,
        correct_count: 43,
        rate: 0.86,
        sem_weighted_accuracy_min: 0.6,
        token_recall: { measured_count: 50, average: 0.86 }
      }
    },
    ebayMetrics: { formal_accuracy_eligible: false }
  }).passed, false);
  await assert.rejects(() => runLaunchGateMain(["--model", "gpt-5"], {}), /execution options are locked/);
  await assert.rejects(() => runLaunchGateMain(["--password", "unsafe"], {}), /execution options are locked/);
  const snapshot = runtimeSnapshot(runtimeHealth());
  assertRuntimeSnapshot(snapshot);
  assertRuntimeSnapshot(snapshot, {
    expectedDeploymentId: "dpl_launch_gate",
    expectedDeploymentSha: "abc123"
  });
  assert.throws(() => assertRuntimeSnapshot(snapshot, {
    expectedDeploymentId: "dpl_other"
  }), /expected_deployment_id_matches/);
  assert.throws(() => assertRuntimeSnapshot(snapshot, {
    expectedDeploymentSha: "def456"
  }), /expected_deployment_sha_matches/);
  const localCandidateSnapshot = {
    ...snapshot,
    deployment_sha: "",
    deployment_ref: ""
  };
  const localCandidateChecks = assertRuntimeSnapshot(localCandidateSnapshot, {
    expectedDeploymentId: "dpl_launch_gate"
  });
  assert.equal(localCandidateChecks.immutable_runtime_identity, true);
  assert.equal(localCandidateChecks.main_branch_or_pinned_candidate, true);
  assertProviderControlPlane({
    ...providerStatus(),
    deployment: {
      ...providerStatus().deployment,
      git_commit_sha: ""
    }
  }, { expectedRuntime: localCandidateSnapshot });
  assert.equal(deploymentDrift(snapshot, snapshot).unchanged, true);
  assert.equal(deploymentDrift(snapshot, { ...snapshot, deployment_sha: "def456" }).unchanged, false);
  assert.equal(deploymentDrift(localCandidateSnapshot, localCandidateSnapshot).unchanged, true);
  assertProviderControlPlane(providerStatus(), { expectedRuntime: snapshot });
  assert.throws(() => assertProviderControlPlane({
    ...providerStatus(),
    execution_control: { ...providerStatus().execution_control, global_provider_concurrency: 3 }
  }), /provider_global_concurrency_locked/);
  assert.throws(() => assertProviderControlPlane({
    ...providerStatus(),
    execution_control: {
      ...providerStatus().execution_control,
      recognition_worker: { enabled: false, configured: false }
    }
  }), /recognition_worker_enabled, recognition_worker_configured/);
  assert.throws(() => assertProviderControlPlane({
    ...providerStatus(),
    execution_control: {
      ...providerStatus().execution_control,
      paddle_ocr_verifier: { enabled: false, configured: false }
    }
  }), /paddle_ocr_verifier_enabled, paddle_ocr_verifier_configured/);

  const mixedResults = [
    scoredResult({ assetId: "internal-1", reviewed: true, score: 0.9 }),
    scoredResult({ assetId: "internal-2", reviewed: true, score: 0.5 }),
    scoredResult({ assetId: "ebay-1", score: 1 }),
    scoredResult({ assetId: "ebay-2", score: 0.2 })
  ];
  const mixedRunReports = [
    {
      cohort: "INTERNAL_REVIEWED_GT",
      cold_start_blind: false,
      report: rawRunReport(mixedResults.slice(0, 2))
    },
    {
      cohort: "EBAY_COLD_START",
      cold_start_blind: true,
      report: rawRunReport(mixedResults.slice(2), { coldStartBlind: true })
    }
  ];
  const observedChecks = assertObservedExecutionContract(mixedRunReports);
  assert.equal(observedChecks.provider_slot_timing_complete, true);
  assert.equal(observedChecks.provider_two_slots_observed, true);
  assert.equal(observedChecks.provider_slot_overlap_free, true);
  const vacuousVectorExclusionChecks = observedExecutionContractChecks([{
    cohort: "INTERNAL_REVIEWED_GT",
    cold_start_blind: false,
    report: rawRunReport([{
      ...scoredResult({ assetId: "vector-exclusion-not-attempted", reviewed: true, score: 1 }),
      vector_self_exclusion_query_attempted: false
    }])
  }]);
  assert.equal(vacuousVectorExclusionChecks.vector_self_retrieval_exclusion_enforced, false);
  const preparationFailureChecks = observedExecutionContractChecks([{
    cohort: "INTERNAL_REVIEWED_GT",
    cold_start_blind: false,
    report: rawRunReport([
      scoredResult({ assetId: "provider-observed", reviewed: true, score: 1 }),
      {
        asset_id: "preparation-failed",
        ok: false,
        error: "upload_verify_failed",
        identity_cache_hit: false
      }
    ])
  }]);
  assert.equal(preparationFailureChecks.identity_cache_read_bypassed, true);
  assert.equal(preparationFailureChecks.image_detail_high, true);
  assert.equal(preparationFailureChecks.provider_prompt_mode_locked, true);
  const missingProviderModeChecks = observedExecutionContractChecks([{
    cohort: "INTERNAL_REVIEWED_GT",
    cold_start_blind: false,
    report: rawRunReport([{
      ...scoredResult({ assetId: "provider-mode-missing", reviewed: true, score: 1 }),
      provider_latency_ms: 1200,
      provider_prompt_mode: null
    }])
  }]);
  assert.equal(missingProviderModeChecks.provider_prompt_mode_locked, false);
  const stratifiedReport = buildLaunchGateReport({
    profile: "mixed-100",
    dataset: built.manifest,
    datasetContract: mixedContract,
    startSnapshot: snapshot,
    endSnapshot: snapshot,
    providerPreflight: assertProviderControlPlane(providerStatus()),
    observedChecks,
    runReports: mixedRunReports,
    now: new Date("2026-07-16T01:00:00.000Z")
  });
  assert.equal(stratifiedReport.strata.internal_reviewed_gt.formal_accuracy.rate, 0.5);
  assert.equal(stratifiedReport.strata.internal_reviewed_gt.formal_accuracy.measured_count, 2);
  assert.equal(stratifiedReport.strata.ebay_weak_label.formal_accuracy_eligible, false);
  assert.equal(Object.hasOwn(stratifiedReport.strata.ebay_weak_label, "formal_accuracy"), false);
  assert.equal(stratifiedReport.strata.ebay_weak_label.weak_label_agreement.agreement_rate, 0.5);
  assert.equal(stratifiedReport.formal_accuracy_gate.cohort_count, 2);
  assert.equal(stratifiedReport.formal_accuracy_gate.required_correct_count, null);
  assert.equal(stratifiedReport.formal_accuracy_gate.passed, false);
  assert.throws(() => assertLaunchGateFormalAccuracy(stratifiedReport), /minimum_token_recall_met/);
  assert.equal(stratifiedReport.accuracy_reporting_policy.combined_formal_accuracy_prohibited, true);
  assert.equal(stratifiedReport.accuracy_reporting_policy.combined_formal_accuracy, null);
  assert.equal(stratifiedReport.formal_accuracy, undefined);
  assert.equal(stratifiedReport.summary, undefined);

  const spoofedEbayReport = buildLaunchGateReport({
    profile: "mixed-100",
    dataset: built.manifest,
    datasetContract: mixedContract,
    startSnapshot: snapshot,
    endSnapshot: snapshot,
    runReports: [
      {
        cohort: "INTERNAL_REVIEWED_GT",
        report: rawRunReport([
          scoredResult({ assetId: "internal-1", reviewed: true, score: 1 }),
          scoredResult({ assetId: "internal-2", reviewed: true, score: 1 })
        ])
      },
      {
        cohort: "EBAY_COLD_START",
        report: rawRunReport([
          scoredResult({ assetId: "ebay-spoof", reviewed: true, score: 1 }),
          scoredResult({ assetId: "ebay-2", score: 1 })
        ], { coldStartBlind: true })
      }
    ]
  });
  assert.equal(spoofedEbayReport.strata.internal_reviewed_gt.formal_accuracy.measured_count, 2);
  assert.equal(spoofedEbayReport.strata.ebay_weak_label.weak_label_agreement.measured_count, 1);
  assert.equal(spoofedEbayReport.strata.unclassified.attempted_count, 1);

  const semPassTokenFailResults = Array.from({ length: 10 }, (_, index) => ({
    ...scoredResult({ assetId: `sem-pass-token-fail-${index + 1}`, reviewed: true, score: 1 }),
    final_scoring: { policy_fair_token_recall: 0 }
  }));
  const semPassTokenFailReport = buildLaunchGateReport({
    profile: "reviewed-10",
    dataset: reviewedDataset,
    datasetContract: reviewedContract,
    startSnapshot: snapshot,
    endSnapshot: snapshot,
    runReports: [{
      cohort: "INTERNAL_REVIEWED_GT",
      report: rawRunReport(semPassTokenFailResults)
    }]
  });
  assert.equal(semPassTokenFailReport.formal_accuracy_gate.passed, false);
  assert.equal(
    semPassTokenFailReport.strata.internal_reviewed_gt.formal_accuracy.legacy_token_recall_diagnostics.policy_fair_token_recall_avg,
    0
  );

  const semFailTokenPassResults = semPassTokenFailResults.map((row, index) => index < 2 ? {
    ...row,
    sem_projection_scoring: { weighted_accuracy: 0.86, accepted: false, components: [] },
    final_scoring: { policy_fair_token_recall: 1 }
  } : {
    ...row,
    final_scoring: { policy_fair_token_recall: 1 }
  });
  const semFailTokenPassReport = buildLaunchGateReport({
    profile: "reviewed-10",
    dataset: reviewedDataset,
    datasetContract: reviewedContract,
    startSnapshot: snapshot,
    endSnapshot: snapshot,
    runReports: [{
      cohort: "INTERNAL_REVIEWED_GT",
      report: rawRunReport(semFailTokenPassResults)
    }]
  });
  assert.equal(semFailTokenPassReport.formal_accuracy_gate.passed, true);
  assert.equal(
    semFailTokenPassReport.strata.internal_reviewed_gt.formal_accuracy.legacy_token_recall_diagnostics.policy_fair_token_recall_avg,
    1
  );
  const catastrophicSemResults = semPassTokenFailResults.map((row, index) => ({
    ...row,
    sem_projection_scoring: {
      weighted_accuracy: index === 0 ? 0.49 : 1,
      accepted: index !== 0,
      components: []
    },
    final_scoring: { policy_fair_token_recall: 0.9 }
  }));
  const catastrophicSemReport = buildLaunchGateReport({
    profile: "reviewed-10",
    dataset: reviewedDataset,
    datasetContract: reviewedContract,
    startSnapshot: snapshot,
    endSnapshot: snapshot,
    runReports: [{
      cohort: "INTERNAL_REVIEWED_GT",
      report: rawRunReport(catastrophicSemResults)
    }]
  });
  assert.equal(catastrophicSemReport.formal_accuracy_gate.actual_rate, 0.9);
  assert.equal(catastrophicSemReport.formal_accuracy_gate.checks.minimum_token_recall_met, true);
  assert.equal(catastrophicSemReport.formal_accuracy_gate.checks.catastrophic_sem_floor_met, false);
  assert.equal(catastrophicSemReport.formal_accuracy_gate.passed, false);

  const incompleteReviewedResults = Array.from({ length: 10 }, (_, index) => scoredResult({
    assetId: `reviewed-${index + 1}`,
    reviewed: true,
    score: 0.8
  }));
  incompleteReviewedResults[0] = {
    ...incompleteReviewedResults[0],
    sem_projection_scoring: { weighted_accuracy: null, accepted: false, components: [] },
    final_scoring: { policy_fair_token_recall: null }
  };
  const incompleteReviewedReport = buildLaunchGateReport({
    profile: "reviewed-10",
    dataset: reviewedDataset,
    datasetContract: reviewedContract,
    startSnapshot: snapshot,
    endSnapshot: snapshot,
    runReports: [{
      cohort: "INTERNAL_REVIEWED_GT",
      report: rawRunReport(incompleteReviewedResults)
    }]
  });
  assert.equal(incompleteReviewedReport.formal_accuracy_gate.cohort_count, 10);
  assert.equal(incompleteReviewedReport.formal_accuracy_gate.measured_count, 9);
  assert.equal(incompleteReviewedReport.formal_accuracy_gate.checks.measured_count_matches_cohort, false);
  assert.throws(() => assertLaunchGateFormalAccuracy(incompleteReviewedReport), /measured_count_matches_cohort/);

  const reviewedDatasetPath = join(root, "reviewed-10.json");
  const reviewedSealedPath = join(root, "reviewed-10-sealed.jsonl");
  const reviewedReportPath = join(root, "reviewed-10-report.json");
  await writeFile(reviewedDatasetPath, `${JSON.stringify(reviewedDataset)}\n`);
  await writeFile(reviewedSealedPath, `${reviewedDataset.items.map((item, index) => JSON.stringify({
    key: `reviewed-key-${index + 1}`,
    case_id: item.asset_id,
    reviewed_title: `2026 Reviewed Offline ${index + 1} PSA 10`,
    policy: {
      reviewed_title_is_ground_truth: true,
      model_prompt_visible: false
    }
  })).join("\n")}\n`);
  let healthCallCount = 0;
  let smokeCallCount = 0;
  const materializedImagePath = join(root, "materialized-launch-gate-image.jpg");
  await writeFile(materializedImagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const imageMaterializer = async ({ dataset }) => ({
    dataset: {
      ...dataset,
      items: dataset.items.map((item) => ({
        ...item,
        images: item.images.map((image) => ({
          ...image,
          local_path: materializedImagePath,
          content_type: "image/jpeg",
          width: 640,
          height: 900
        }))
      }))
    },
    summary: { mode: "offline_test_materialized", item_count: dataset.items.length }
  });
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/v4/health")) {
      healthCallCount += 1;
      return new Response(JSON.stringify(runtimeHealth()), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/login")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "lynca_session=offline-test; Path=/; HttpOnly"
        }
      });
    }
    if (url.endsWith("/api/listing-provider-status")) {
      return new Response(JSON.stringify(providerStatus()), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected offline URL: ${url}`);
  };
  const smokeRunner = async (options) => {
    smokeCallCount += 1;
    const recognitionDataset = JSON.parse(await readFile(options.datasetPath, "utf8"));
    assert.deepEqual(prohibitedPaths(recognitionDataset), []);
    assert.ok(recognitionDataset.items.every((item) => item.images.every((image) => (
      image.local_path === materializedImagePath
      && image.content_type === "image/jpeg"
      && image.width === 640
      && image.height === 900
    ))), "materialized local image paths must survive cohort splitting and reach the smoke runner");
    assert.equal(options.modelOverride, "gpt-5-mini");
    assert.equal(options.ultraFastL2, false);
    assert.equal(options.compactL2, true);
    assert.equal(options.fastInitialPrompt, false);
    assert.equal(options.ultraFastImageDetail, "high");
    assert.equal(options.concurrency, 2);
    assert.equal(options.preparationConcurrency, 3);
    assert.equal(options.submissionConcurrency, 2);
    assert.equal(options.disableIdentityCache, true);
    assert.equal(options.limit, 10);
    assert.equal((await readFile(options.sealedLabelsPath, "utf8")).trim(), "");
    return rawRunReport(Array.from({ length: 10 }, (_, index) => scoredResult({
      assetId: `reviewed-${index + 1}`,
      reviewed: true,
      finalTitle: `2026 Reviewed Offline ${index + 1} PSA 10`
    })), { coldStartBlind: options.coldStartBlind });
  };
  const offlineReport = await runLaunchGateEvaluation({
    profile: "reviewed-10",
    datasetPath: reviewedDatasetPath,
    sealedLabelsPath: reviewedSealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentId: "dpl_launch_gate",
    expectedDeploymentSha: "abc123",
    outPath: reviewedReportPath,
    fetchImpl,
    smokeRunner,
    imageMaterializer,
    progress: false,
    now: () => new Date("2026-07-16T02:00:00.000Z")
  });
  assert.equal(healthCallCount, 2);
  assert.equal(smokeCallCount, 1);
  assert.equal(offlineReport.strata.internal_reviewed_gt.attempted_count, 10);
  assert.equal(offlineReport.strata.internal_reviewed_gt.formal_accuracy.measured_count, 10);
  assert.equal(offlineReport.strata.internal_reviewed_gt.formal_accuracy.correct_count, 10);
  assert.equal(offlineReport.strata.internal_reviewed_gt.formal_accuracy.rate, 1);
  assert.equal(offlineReport.formal_accuracy_gate.required_correct_count, null);
  assert.equal(offlineReport.formal_accuracy_gate.actual_rate, 1);
  assert.equal(offlineReport.formal_accuracy_gate.passed, true);
  assert.equal(offlineReport.execution_contract.deployment.drift.unchanged, true);
  assert.deepEqual(offlineReport.execution_contract.deployment.expected, {
    deployment_id: "dpl_launch_gate",
    deployment_sha: "abc123"
  });
  assert.equal(offlineReport.data_contract.sealed_reference_handling.loaded_after_all_predictions_frozen, true);
  assert.equal(JSON.parse(await readFile(reviewedReportPath, "utf8")).technical_summary.completed_count, 10);

  const strategyReplayReport = await runLaunchGateEvaluation({
    profile: "reviewed-10",
    evaluationMode: "strategy-replay",
    datasetPath: reviewedDatasetPath,
    sealedLabelsPath: reviewedSealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentId: "dpl_launch_gate",
    expectedDeploymentSha: "abc123",
    outPath: join(root, "reviewed-10-strategy-replay.json"),
    checkpointPath: join(root, "reviewed-10-strategy-replay.checkpoint.json"),
    verifiedAssetCachePath: join(root, "verified-assets.json"),
    sourceFingerprint: async (item) => item.asset_id,
    assetCacheReader: async () => new Map(Array.from({ length: 10 }, (_, index) => {
      const assetId = `reviewed-${index + 1}`;
      return [assetId, {
        fingerprint: assetId,
        source_asset_id: assetId,
        asset_id: `cached-${assetId}`,
        tenant_id: "tenant-cache",
        image_generation_id: `cached-${assetId}`,
        image_count: 1
      }];
    })),
    fetchImpl,
    imageMaterializer: async () => {
      throw new Error("strategy replay must not materialize source images");
    },
    smokeRunner: async (options) => {
      assert.equal(options.verifiedAssetCacheMode, "reuse");
      assert.equal(options.verifiedAssetCachePath, join(root, "verified-assets.json"));
      return {
        ...rawRunReport(Array.from({ length: 10 }, (_, index) => scoredResult({
          assetId: `reviewed-${index + 1}`,
          reviewed: true,
          finalTitle: `2026 Reviewed Offline ${index + 1} PSA 10`
        })), { coldStartBlind: options.coldStartBlind }),
        verified_asset_cache: { mode: "reuse", hit_count: 10 }
      };
    },
    progress: false
  });
  assert.equal(strategyReplayReport.evaluation_mode, "strategy-replay");
  assert.equal(strategyReplayReport.formal_chain_proof, false);
  assert.equal(strategyReplayReport.data_contract.image_materialization.mode, "skipped_verified_asset_reuse");
  assert.equal(strategyReplayReport.writer_perceived_speed_gate.required, false);
  assert.equal(strategyReplayReport.writer_perceived_speed_gate.formal_chain_proof_eligible, false);

  const belowThresholdReportPath = join(root, "reviewed-10-below-threshold-report.json");
  await assert.rejects(() => runLaunchGateEvaluation({
    profile: "reviewed-10",
    datasetPath: reviewedDatasetPath,
    sealedLabelsPath: reviewedSealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentSha: "abc123",
    outPath: belowThresholdReportPath,
    fetchImpl,
    imageMaterializer,
    smokeRunner: async (options) => rawRunReport(Array.from({ length: 10 }, (_, index) => scoredResult({
      assetId: `reviewed-${index + 1}`,
      reviewed: true,
      finalTitle: index < 2 ? "" : `2026 Reviewed Offline ${index + 1} PSA 10`
    })), { coldStartBlind: options.coldStartBlind }),
    progress: false
  }), /Launch-gate formal accuracy failed/);
  const belowThresholdReport = JSON.parse(await readFile(belowThresholdReportPath, "utf8"));
  assert.equal(belowThresholdReport.formal_accuracy_gate.actual_correct_count, null);
  assert.equal(belowThresholdReport.formal_accuracy_gate.checks.minimum_token_recall_met, false);
  assert.equal(belowThresholdReport.formal_accuracy_gate.passed, false);

  const observedFailureReportPath = join(root, "reviewed-10-observed-contract-failure-report.json");
  await assert.rejects(() => runLaunchGateEvaluation({
    profile: "reviewed-10",
    datasetPath: reviewedDatasetPath,
    sealedLabelsPath: reviewedSealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentSha: "abc123",
    outPath: observedFailureReportPath,
    fetchImpl,
    imageMaterializer,
    smokeRunner: async (options) => ({
      ...rawRunReport(Array.from({ length: 10 }, (_, index) => scoredResult({
        assetId: `reviewed-${index + 1}`,
        reviewed: true,
        finalTitle: `2026 Reviewed Offline ${index + 1} PSA 10`
      })), { coldStartBlind: options.coldStartBlind }),
      preparation_concurrency: 2
    }),
    progress: false
  }), /Observed launch-gate contract failed: preparation_concurrency_locked/);
  const observedFailureReport = JSON.parse(await readFile(observedFailureReportPath, "utf8"));
  assert.equal(observedFailureReport.execution_contract.observed_checks.preparation_concurrency_locked, false);
  assert.equal(observedFailureReport.formal_accuracy_gate.passed, true);

  let mismatchSmokeCallCount = 0;
  await assert.rejects(() => runLaunchGateEvaluation({
    profile: "reviewed-10",
    datasetPath: reviewedDatasetPath,
    sealedLabelsPath: reviewedSealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentSha: "def456",
    outPath: join(root, "deployment-mismatch-report.json"),
    fetchImpl,
    imageMaterializer,
    smokeRunner: async () => {
      mismatchSmokeCallCount += 1;
      return rawRunReport([]);
    },
    progress: false
  }), /expected_deployment_sha_matches/);
  assert.equal(mismatchSmokeCallCount, 0);

  const mixedReportPath = join(root, "mixed-report.json");
  const mixedSmokeCalls = [];
  const mixedSmokeRunner = async (options) => {
    const splitDataset = JSON.parse(await readFile(options.datasetPath, "utf8"));
    assert.deepEqual(prohibitedPaths(splitDataset), []);
    assert.equal((await readFile(options.sealedLabelsPath, "utf8")).trim(), "");
    const cohorts = [...new Set(splitDataset.items.map((item) => item.evaluation_cohort))];
    mixedSmokeCalls.push({ cold_start_blind: options.coldStartBlind, cohorts });
    return rawRunReport(splitDataset.items.map((item) => scoredResult({
      assetId: item.asset_id,
      reviewed: item.evaluation_cohort === "INTERNAL_REVIEWED_GT",
      finalTitle: item.evaluation_cohort === "INTERNAL_REVIEWED_GT"
        ? "2026 Reviewed Secret Player 1 2 3 PSA 10"
        : `2026 eBay Weak Secret Player ${item.asset_id.replace(/^ebay_image_only_case-/, "")} BGS 9.5`
    })), { coldStartBlind: options.coldStartBlind });
  };
  const mixedOfflineReport = await runLaunchGateEvaluation({
    profile: "mixed-100",
    datasetPath: manifestPath,
    sealedLabelsPath: sealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentSha: "abc123",
    outPath: mixedReportPath,
    fetchImpl,
    smokeRunner: mixedSmokeRunner,
    imageMaterializer,
    progress: false,
    now: () => new Date("2026-07-16T03:00:00.000Z")
  });
  assert.deepEqual(mixedSmokeCalls, [
    { cold_start_blind: false, cohorts: ["INTERNAL_REVIEWED_GT"] },
    { cold_start_blind: true, cohorts: ["EBAY_COLD_START"] }
  ]);
  assert.equal(mixedOfflineReport.strata.internal_reviewed_gt.attempted_count, 2);
  assert.equal(mixedOfflineReport.strata.internal_reviewed_gt.formal_accuracy.measured_count, 2);
  assert.equal(mixedOfflineReport.strata.ebay_weak_label.attempted_count, 2);
  assert.equal(mixedOfflineReport.formal_accuracy_gate.threshold_rate, 0.87);
  assert.equal(mixedOfflineReport.formal_accuracy_gate.required_correct_count, null);
  assert.equal(mixedOfflineReport.formal_accuracy_gate.passed, true);
  assert.equal(mixedOfflineReport.data_contract.sample_provenance.verified, true);
  const mixedCheckpointPath = `${mixedReportPath}.checkpoint.json`;
  const mixedCheckpoint = JSON.parse(await readFile(mixedCheckpointPath, "utf8"));
  assert.deepEqual(Object.keys(mixedCheckpoint.completed_cohorts).sort(), ["EBAY_COLD_START", "INTERNAL_REVIEWED_GT"]);
  assert.equal(Object.hasOwn(mixedCheckpoint.completed_cohorts.INTERNAL_REVIEWED_GT, "scoring_items"), false);
  let checkpointReplaySmokeCalls = 0;
  const checkpointReplayReport = await runLaunchGateEvaluation({
    profile: "mixed-100",
    datasetPath: manifestPath,
    sealedLabelsPath: sealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentSha: "abc123",
    outPath: mixedReportPath,
    fetchImpl,
    smokeRunner: async () => {
      checkpointReplaySmokeCalls += 1;
      throw new Error("completed cohorts must not rerun");
    },
    imageMaterializer,
    progress: false
  });
  assert.equal(checkpointReplaySmokeCalls, 0);
  assert.equal(checkpointReplayReport.formal_accuracy_gate.passed, true);

  const interruptedReportPath = join(root, "mixed-interrupted-report.json");
  let interruptedEbayBatchId = "";
  let interruptedCallCount = 0;
  await assert.rejects(() => runLaunchGateEvaluation({
    profile: "mixed-100",
    datasetPath: manifestPath,
    sealedLabelsPath: sealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentSha: "abc123",
    outPath: interruptedReportPath,
    fetchImpl,
    imageMaterializer,
    smokeRunner: async (options) => {
      interruptedCallCount += 1;
      const splitDataset = JSON.parse(await readFile(options.datasetPath, "utf8"));
      if (!options.coldStartBlind) {
        return rawRunReport(splitDataset.items.map((item) => scoredResult({
          assetId: item.asset_id,
          reviewed: true,
          finalTitle: "2026 Reviewed Secret Player 1 2 3 PSA 10"
        })), { coldStartBlind: false });
      }
      interruptedEbayBatchId = options.batchId;
      assert.equal(options.resumeBatchId, "");
      throw new Error("simulated task interruption");
    },
    progress: false
  }), /simulated task interruption/);
  assert.equal(interruptedCallCount, 2);
  assert.ok(interruptedEbayBatchId);
  let resumedCallCount = 0;
  const resumedReport = await runLaunchGateEvaluation({
    profile: "mixed-100",
    datasetPath: manifestPath,
    sealedLabelsPath: sealedPath,
    baseUrl: "https://offline.invalid",
    username: "offline-user",
    password: "offline-password",
    expectedDeploymentSha: "abc123",
    outPath: interruptedReportPath,
    fetchImpl,
    imageMaterializer,
    smokeRunner: async (options) => {
      resumedCallCount += 1;
      assert.equal(options.coldStartBlind, true);
      assert.equal(options.resumeBatchId, interruptedEbayBatchId);
      const splitDataset = JSON.parse(await readFile(options.datasetPath, "utf8"));
      return rawRunReport(splitDataset.items.map((item) => scoredResult({
        assetId: item.asset_id,
        reviewed: false,
        finalTitle: `2026 eBay Weak Secret Player ${item.asset_id.replace(/^ebay_image_only_case-/, "")} BGS 9.5`
      })), { coldStartBlind: true });
    },
    imageMaterializer,
    progress: false
  });
  assert.equal(resumedCallCount, 1);
  assert.equal(resumedReport.formal_accuracy_gate.passed, true);

  const workflow = await readFile(".github/workflows/reviewed-title-accuracy-smoke.yml", "utf8");
  assert.match(workflow, /--limit 10/);
  assert.match(workflow, /Initialize repeat-eligible history artifact/);
  assert.match(workflow, /const restoringSealedSample = Boolean\(process\.env\.SAMPLE_RUN_ID\)/);
  assert.match(workflow, /sampling_policy_matches_run_mode: restoringSealedSample/);
  assert.match(workflow, /restoringSealedSample\s+\? dataset\.evaluation_sample_policy\?\.randomized_selection === true/);
  assert.match(workflow, /: dataset\.evaluation_sample_policy\?\.cross_wave_overlap_permitted === true\s+&& dataset\.evaluation_sample_policy\?\.prior_history_exclusion_present === false\s+&& dataset\.evaluation_sample_policy\?\.excluded_item_count === 0/);
  assert.doesNotMatch(workflow, /collect-ebay-evaluation-history/);
  assert.doesNotMatch(workflow, /--exclude/);
  assert.match(workflow, /scripts\/run-launch-gate-eval\.mjs/);
  assert.match(workflow, /sample_run_id:/);
  assert.match(workflow, /gh run download "\$SAMPLE_RUN_ID"/);
  assert.match(workflow, /reviewed-title-blind-sample/);
  assert.match(workflow, /sha256sum --check \/tmp\/reviewed-title-sample-sha256\.txt/);
  assert.match(workflow, /&& test -f \/tmp\/reviewed-title-reused-report\/reviewed-title-accuracy-report\.json/);
  assert.match(workflow, /test -f \/tmp\/reviewed-title-reused-report\/reviewed-title-accuracy-report\.json; then\s+cp \/tmp\/reviewed-title-reused-report\/reviewed-title-accuracy-report\.json "\$BASELINE_REPORT_PATH"/);
  assert.match(workflow, /continuing with the sealed sample only/);
  assert.match(workflow, /scripts\/analyze-launch-gate-report\.mjs/);
  assert.match(workflow, /if: \$\{\{ inputs\.sample_run_id == '' \}\}/);
  assert.match(workflow, /if: \$\{\{ inputs\.sample_run_id != '' \}\}/);
  assert.match(workflow, /--expected-deployment-sha "\$\{\{ github\.sha \}\}"/);
  assert.match(workflow, /LAUNCH_GATE_EVAL_SECRET: \$\{\{ secrets\.LAUNCH_GATE_EVAL_SECRET \}\}/);
  assert.match(workflow, /SUPABASE_URL: \$\{\{ vars\.SUPABASE_URL \}\}/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  assert.match(workflow, /test -n "\$LAUNCH_GATE_EVAL_SECRET"/);
  assert.match(workflow, /measured_count_matches_cohort/);
  assert.match(workflow, /reviewed_accuracy_gate/);
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\.(?:limit|model)/);
  assert.doesNotMatch(workflow, /scripts\/v4-ebay-smoke\.mjs/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("launch-gate data contract tests passed");
