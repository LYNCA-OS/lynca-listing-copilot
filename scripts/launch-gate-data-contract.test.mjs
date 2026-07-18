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
  buildLaunchGateFormalAccuracyGate,
  buildLaunchGateReport,
  deploymentDrift,
  launchGateAccuracyContract,
  launchGateExecutionContract,
  main as runLaunchGateMain,
  numberArg as launchGateNumberArg,
  observedExecutionContractChecks,
  runLaunchGateEvaluation,
  runtimeSnapshot
} from "./run-launch-gate-eval.mjs";
import { attachPostRecognitionScoring, createConcurrencyGate, mapWithConcurrency } from "./v4-ebay-smoke.mjs";

assert.equal(launchGateNumberArg([], "--request-timeout-ms", 120_000), 120_000);
assert.equal(launchGateNumberArg(["--request-timeout-ms", ""], "--request-timeout-ms", 120_000), 120_000);
assert.equal(launchGateNumberArg(["--think-ms", "0"], "--think-ms", 6_000), 0);
assert.equal(launchGateNumberArg(["--l2-wait-ms", "240000"], "--l2-wait-ms", 18_000), 240_000);

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

function reviewedTenDataset() {
  return {
    schema_version: "reviewed-title-blind-eval-v1",
    item_count: 10,
    evaluation_sample_policy: {
      mode: "RANDOM_BLIND",
      randomized_selection: true,
      randomization_verified: true,
      selection_strategy: "seeded_sha256_source_feedback_id",
      sample_seed_sha256: "reviewed-ten-seed-sha256",
      selected_item_ids_sha256: "reviewed-ten-items-sha256"
    },
    items: Array.from({ length: 10 }, (_, index) => ({
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
      provider_key_pool_size: 1,
      per_key_stable_concurrency: 2,
      global_provider_concurrency: 2,
      queue_submission_concurrency: 2
    }
  };
}

function scoredResult({ assetId, reviewed = false, score = 1, finalTitle = "" }) {
  return {
    asset_id: assetId,
    ok: true,
    writer_ready: true,
    final_title: finalTitle,
    provider_image_detail: "high",
    provider_prompt_mode: "fast_initial",
    identity_cache_hit: false,
    identity_cache_read_bypassed: true,
    reference_title_type: reviewed ? "REVIEWED_INTERNAL_TITLE" : "MARKETPLACE_WEAK_LABEL",
    reference_title_is_reviewed_ground_truth: reviewed,
    final_scoring: { policy_fair_token_recall: score }
  };
}

function rawRunReport(results, { coldStartBlind = false } = {}) {
  return {
    model_override: "gpt-5-mini",
    concurrency: 2,
    preparation_concurrency: 2,
    submission_concurrency: 2,
    provider_concurrency: 2,
    identity_cache_disabled: true,
    fast_initial_prompt_override: true,
    cold_start_blind: coldStartBlind,
    predictions_sha256: "offline-predictions-sha256",
    run_wall_ms: 1000,
    evaluation_sample_policy: { provenance_verified: true },
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
  assert.throws(() => assertLaunchGateDatasetContract({ ...reviewedDataset, items: reviewedDataset.items.slice(0, 9) }, {
    profile: "reviewed-10"
  }), /exactly 10/);
  assert.throws(() => assertLaunchGateDatasetContract({
    ...reviewedDataset,
    items: reviewedDataset.items.map((item, index) => index === 0 ? { ...item, source_feedback_id: "" } : item)
  }, { profile: "reviewed-10" }), /source_feedback_id_missing/);
  const mixedContract = assertLaunchGateDatasetContract(built.manifest, { profile: "mixed-100" });
  assert.deepEqual(mixedContract.cohort_counts, { internal_reviewed_gt: 2, ebay_cold_start: 2, unknown: 0 });

  assert.deepEqual(launchGateExecutionContract, {
    model: "gpt-5-mini",
    image_detail: "high",
    provider_prompt_mode: "fast_initial",
    provider_concurrency: 2,
    preparation_concurrency: 2,
    submission_concurrency: 2,
    identity_cache_disabled: true,
    ultra_fast_l2: false
  });
  assert.deepEqual(launchGateAccuracyContract, {
    per_item_policy_acceptance_threshold: 0.72,
    minimum_internal_reviewed_gt_rate: 0.87,
    reviewed_10_minimum_correct_count: 9,
    formal_scope: "internal_reviewed_gt_only",
    ebay_reference_role: "diagnostics_only"
  });
  const mixedFiftyGate = buildLaunchGateFormalAccuracyGate({
    profile: "mixed-100",
    cohortCount: 50,
    internalMetrics: {
      formal_accuracy: {
        eligible: true,
        measured_count: 50,
        correct_count: 44,
        rate: 0.88
      }
    },
    ebayMetrics: { formal_accuracy_eligible: false }
  });
  assert.equal(mixedFiftyGate.required_correct_count, 44);
  assert.equal(mixedFiftyGate.passed, true);
  assert.equal(buildLaunchGateFormalAccuracyGate({
    profile: "mixed-100",
    cohortCount: 50,
    internalMetrics: {
      formal_accuracy: {
        eligible: true,
        measured_count: 50,
        correct_count: 43,
        rate: 0.86
      }
    },
    ebayMetrics: { formal_accuracy_eligible: false }
  }).passed, false);
  await assert.rejects(() => runLaunchGateMain(["--model", "gpt-5"], {}), /execution options are locked/);
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
  assert.equal(deploymentDrift(snapshot, snapshot).unchanged, true);
  assert.equal(deploymentDrift(snapshot, { ...snapshot, deployment_sha: "def456" }).unchanged, false);
  assertProviderControlPlane(providerStatus(), { expectedRuntime: snapshot });
  assert.throws(() => assertProviderControlPlane({
    ...providerStatus(),
    execution_control: { ...providerStatus().execution_control, global_provider_concurrency: 3 }
  }), /provider_global_concurrency_locked/);

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
  assert.equal(stratifiedReport.formal_accuracy_gate.required_correct_count, 2);
  assert.equal(stratifiedReport.formal_accuracy_gate.passed, false);
  assert.throws(() => assertLaunchGateFormalAccuracy(stratifiedReport), /minimum_correct_count_met/);
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

  const incompleteReviewedResults = Array.from({ length: 10 }, (_, index) => scoredResult({
    assetId: `reviewed-${index + 1}`,
    reviewed: true,
    score: 0.8
  }));
  incompleteReviewedResults[0] = {
    ...incompleteReviewedResults[0],
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
    assert.equal(options.ultraFastImageDetail, "high");
    assert.equal(options.concurrency, 2);
    assert.equal(options.preparationConcurrency, 2);
    assert.equal(options.submissionConcurrency, 2);
    assert.equal(options.disableIdentityCache, true);
    assert.equal(options.limit, 10);
    assert.equal((await readFile(options.sealedLabelsPath, "utf8")).trim(), "");
    return rawRunReport(Array.from({ length: 10 }, (_, index) => scoredResult({
      assetId: `reviewed-${index + 1}`,
      reviewed: true,
      finalTitle: index === 0 ? "" : `2026 Reviewed Offline ${index + 1} PSA 10`
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
  assert.equal(offlineReport.strata.internal_reviewed_gt.formal_accuracy.correct_count, 9);
  assert.equal(offlineReport.strata.internal_reviewed_gt.formal_accuracy.rate, 0.9);
  assert.equal(offlineReport.formal_accuracy_gate.required_correct_count, 9);
  assert.equal(offlineReport.formal_accuracy_gate.passed, true);
  assert.equal(offlineReport.execution_contract.deployment.drift.unchanged, true);
  assert.deepEqual(offlineReport.execution_contract.deployment.expected, {
    deployment_id: "dpl_launch_gate",
    deployment_sha: "abc123"
  });
  assert.equal(offlineReport.data_contract.sealed_reference_handling.loaded_after_all_predictions_frozen, true);
  assert.equal(JSON.parse(await readFile(reviewedReportPath, "utf8")).technical_summary.completed_count, 10);

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
  assert.equal(belowThresholdReport.formal_accuracy_gate.actual_correct_count, 8);
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
      preparation_concurrency: 3
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
        ? `2026 Reviewed Secret Player ${item.asset_id.replace(/^reviewed-source-/, "")} PSA 10`
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
  assert.equal(mixedOfflineReport.formal_accuracy_gate.required_correct_count, 2);
  assert.equal(mixedOfflineReport.formal_accuracy_gate.passed, true);
  assert.equal(mixedOfflineReport.data_contract.sample_provenance.verified, true);

  const workflow = await readFile(".github/workflows/reviewed-title-accuracy-smoke.yml", "utf8");
  assert.match(workflow, /--limit 10/);
  assert.match(workflow, /scripts\/run-launch-gate-eval\.mjs/);
  assert.match(workflow, /--expected-deployment-sha "\$\{\{ github\.sha \}\}"/);
  assert.match(workflow, /LAUNCH_GATE_EVAL_SECRET: \$\{\{ secrets\.LAUNCH_GATE_EVAL_SECRET \}\}/);
  assert.match(workflow, /test -n "\$LAUNCH_GATE_EVAL_SECRET"/);
  assert.match(workflow, /measured_count_matches_cohort/);
  assert.match(workflow, /reviewed_accuracy_gate/);
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\.(?:limit|model)/);
  assert.doesNotMatch(workflow, /scripts\/v4-ebay-smoke\.mjs/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("launch-gate data contract tests passed");
