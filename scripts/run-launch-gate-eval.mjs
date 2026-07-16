#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEvaluationSampleProvenance,
  evaluationItemSetSha256
} from "../lib/listing/evaluation/sample-policy.mjs";
import { assertRecognitionManifestBlind } from "./build-launch-gate-mixed-manifest.mjs";
import {
  attachPostRecognitionScoring,
  login,
  payloadForItem,
  runV4EbaySmoke,
  summarizePipelineNodeLedgers
} from "./v4-ebay-smoke.mjs";

export const launchGateExecutionContract = Object.freeze({
  model: "gpt-5-mini",
  image_detail: "high",
  provider_concurrency: 2,
  preparation_concurrency: 4,
  submission_concurrency: 2,
  identity_cache_disabled: true,
  ultra_fast_l2: false
});

export const launchGateAccuracyContract = Object.freeze({
  per_item_policy_acceptance_threshold: 0.72,
  minimum_internal_reviewed_gt_rate: 0.87,
  reviewed_10_minimum_correct_count: 9,
  formal_scope: "internal_reviewed_gt_only",
  ebay_reference_role: "diagnostics_only"
});

const supportedProfiles = new Set(["reviewed-10", "mixed-100"]);
const lockedCliOptions = [
  "--model",
  "--limit",
  "--concurrency",
  "--preparation-concurrency",
  "--submission-concurrency",
  "--ultra-image-detail",
  "--ultra-fast-l2",
  "--disable-identity-cache",
  "--enable-identity-cache"
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function numberArg(argv, name, fallback) {
  const parsed = Number(argValue(argv, name, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeBaseUrl(value = "") {
  return cleanText(value).replace(/\/+$/, "");
}

function loadItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

function recognitionSafeValue(value) {
  if (Array.isArray(value)) return value.map(recognitionSafeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:title|label)/i.test(key))
    .map(([key, entry]) => [key, recognitionSafeValue(entry)]));
}

async function writeJson(path, value) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

async function readSealedReferenceMap(path) {
  const output = new Map();
  const text = await readFile(resolve(path), "utf8");
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid sealed JSONL at ${path}:${index + 1}: ${error.message}`);
    }
    for (const value of [row.key, row.case_id, row.asset_id, row.item_id]) {
      const key = cleanText(value);
      if (key) output.set(key, row);
    }
  }
  return output;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${response.url || "runtime endpoint"}; received ${text.slice(0, 120)}.`);
  }
}

async function fetchJson({ baseUrl, path, cookie = "", timeoutMs = 30000, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request_timeout:${path}`)), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {})
      },
      signal: controller.signal
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(`${path} failed HTTP ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function cohortForItem(item = {}) {
  const explicit = cleanText(item.evaluation_cohort).toUpperCase();
  if (explicit === "INTERNAL_REVIEWED_GT") return "INTERNAL_REVIEWED_GT";
  if (["EBAY_COLD_START", "EBAY_WEAK_LABEL"].includes(explicit)) return "EBAY_COLD_START";
  const sourceType = cleanText(item.source_record?.source_type).toUpperCase();
  if (sourceType === "REVIEWED_INTERNAL_IMAGE_ONLY") return "INTERNAL_REVIEWED_GT";
  if (sourceType === "IMAGE_ONLY_MARKETPLACE_CAPTURE") return "EBAY_COLD_START";
  return "UNKNOWN";
}

function selfExclusionRequired(item = {}) {
  return item.self_retrieval_exclusion_required === true
    || item.source_record?.self_retrieval_exclusion_required === true;
}

function fixedPayloadForPreflight(item, index) {
  return payloadForItem(item, index, [], {
    forceL2Direct: true,
    modelOverride: launchGateExecutionContract.model,
    ultraFastL2: launchGateExecutionContract.ultra_fast_l2,
    ultraFastImageDetail: launchGateExecutionContract.image_detail,
    disableIdentityCache: launchGateExecutionContract.identity_cache_disabled,
    coldStartBlind: cohortForItem(item) === "EBAY_COLD_START"
  });
}

export function assertLaunchGateDatasetContract(dataset = {}, { profile = "reviewed-10" } = {}) {
  if (!supportedProfiles.has(profile)) throw new Error(`Unsupported launch-gate profile: ${profile}`);
  const items = loadItems(dataset);
  if (!items.length) throw new Error("Launch-gate dataset has no recognition items.");
  const cohortCounts = items.reduce((counts, item) => {
    const cohort = cohortForItem(item);
    counts[cohort] = (counts[cohort] || 0) + 1;
    return counts;
  }, {});
  if (profile === "reviewed-10") {
    if (items.length !== 10) throw new Error(`reviewed-10 requires exactly 10 items; received ${items.length}.`);
    if (Number(cohortCounts.INTERNAL_REVIEWED_GT || 0) !== 10) {
      throw new Error("reviewed-10 requires 10 internal reviewed GT items.");
    }
    assertEvaluationSampleProvenance({
      requestedMode: "RANDOM_BLIND",
      datasetPolicy: dataset.evaluation_sample_policy
    });
  } else {
    assertRecognitionManifestBlind(dataset, []);
    const internalCount = Number(cohortCounts.INTERNAL_REVIEWED_GT || 0);
    const ebayCount = Number(cohortCounts.EBAY_COLD_START || 0);
    if (Number(cohortCounts.UNKNOWN || 0) > 0) throw new Error("mixed-100 contains unknown cohort items.");
    if (internalCount < 1 || internalCount !== ebayCount) {
      throw new Error(`mixed-100 must remain balanced after downsizing; internal=${internalCount}, ebay=${ebayCount}.`);
    }
    if (dataset.allocation?.balanced_one_to_one !== true
      || Number(dataset.allocation?.selected_per_cohort) !== internalCount
      || Number(dataset.item_count) !== items.length) {
      throw new Error("mixed-100 allocation metadata does not match its recognition items.");
    }
  }

  const internalItems = items.filter((item) => cohortForItem(item) === "INTERNAL_REVIEWED_GT");
  const selfExclusionFailures = [];
  for (const [index, item] of internalItems.entries()) {
    const assetId = cleanText(item.asset_id || item.physical_card_id || `item_${index + 1}`);
    const sourceFeedbackId = cleanText(item.source_feedback_id);
    const payload = fixedPayloadForPreflight(item, index);
    if (!selfExclusionRequired(item)) selfExclusionFailures.push(`${assetId}:requirement_missing`);
    if (!sourceFeedbackId) selfExclusionFailures.push(`${assetId}:source_feedback_id_missing`);
    if (cleanText(payload.source_feedback_id) !== sourceFeedbackId) selfExclusionFailures.push(`${assetId}:payload_id_mismatch`);
    if (payload.provider_options?.enable_catalog_assist !== true
      || payload.provider_options?.enable_vector_retrieval !== true) {
      selfExclusionFailures.push(`${assetId}:retrieval_not_enabled`);
    }
  }
  if (selfExclusionFailures.length) {
    throw new Error(`Self-retrieval exclusion preflight failed: ${selfExclusionFailures.join(", ")}`);
  }
  return {
    profile,
    item_count: items.length,
    cohort_counts: {
      internal_reviewed_gt: Number(cohortCounts.INTERNAL_REVIEWED_GT || 0),
      ebay_cold_start: Number(cohortCounts.EBAY_COLD_START || 0),
      unknown: Number(cohortCounts.UNKNOWN || 0)
    },
    self_retrieval_exclusion: {
      required_count: internalItems.length,
      payload_verified_count: internalItems.length,
      preflight_verified: internalItems.length > 0,
      evidence_boundary: "request contract verified before recognition; runtime candidate echo is not exposed by the job-status API"
    }
  };
}

export function runtimeSnapshot(health = {}) {
  return {
    ready: health.ready === true,
    deployment_id: cleanText(health.deployment?.deployment_id),
    deployment_sha: cleanText(health.deployment?.git_commit_sha),
    deployment_ref: cleanText(health.deployment?.git_commit_ref),
    model: cleanText(
      health.default_model
      || health.provider_runtime?.model_id
      || health.provider?.model_id
      || health.provider?.model
    ),
    queue_configured: health.production_queue?.configured === true,
    worker_secret_configured: health.production_queue?.worker_secret_configured === true
  };
}

export function assertRuntimeSnapshot(snapshot = {}, {
  expectedDeploymentId = "",
  expectedDeploymentSha = ""
} = {}) {
  const expectedId = cleanText(expectedDeploymentId);
  const expectedSha = cleanText(expectedDeploymentSha);
  const checks = {
    ready: snapshot.ready === true,
    deployment_id_present: Boolean(cleanText(snapshot.deployment_id)),
    deployment_sha_present: Boolean(cleanText(snapshot.deployment_sha)),
    main_branch: cleanText(snapshot.deployment_ref) === "main",
    model_locked: cleanText(snapshot.model) === launchGateExecutionContract.model,
    queue_configured: snapshot.queue_configured === true,
    worker_secret_configured: snapshot.worker_secret_configured === true,
    ...(expectedId ? {
      expected_deployment_id_matches: cleanText(snapshot.deployment_id) === expectedId
    } : {}),
    ...(expectedSha ? {
      expected_deployment_sha_matches: cleanText(snapshot.deployment_sha) === expectedSha
    } : {})
  };
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  if (failed.length) throw new Error(`Production runtime preflight failed: ${failed.join(", ")}`);
  return checks;
}

export function deploymentDrift(start = {}, end = {}) {
  const checks = {
    deployment_id_unchanged: Boolean(start.deployment_id)
      && start.deployment_id === end.deployment_id,
    deployment_sha_unchanged: Boolean(start.deployment_sha)
      && start.deployment_sha === end.deployment_sha
  };
  return { ...checks, unchanged: Object.values(checks).every((value) => value === true) };
}

export function assertProviderControlPlane(status = {}, { expectedRuntime = null } = {}) {
  const execution = status.execution_control || {};
  const selectableModels = (status.providers || []).filter((provider) => provider?.selectable === true)
    .map((provider) => cleanText(provider.model_id));
  const checks = {
    model_available: selectableModels.includes(launchGateExecutionContract.model),
    provider_global_concurrency_locked: Number(execution.global_provider_concurrency) === launchGateExecutionContract.provider_concurrency,
    provider_key_pool_available: Number(execution.provider_key_pool_size || 0) >= 1,
    ...(expectedRuntime ? {
      provider_status_deployment_id_matches: Boolean(cleanText(status.deployment?.deployment_id))
        && cleanText(status.deployment?.deployment_id) === cleanText(expectedRuntime.deployment_id),
      provider_status_deployment_sha_matches: Boolean(cleanText(status.deployment?.git_commit_sha))
        && cleanText(status.deployment?.git_commit_sha) === cleanText(expectedRuntime.deployment_sha)
    } : {})
  };
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  if (failed.length) throw new Error(`Provider control-plane preflight failed: ${failed.join(", ")}`);
  return {
    checks,
    execution_control: {
      provider_key_pool_size: execution.provider_key_pool_size ?? null,
      per_key_stable_concurrency: execution.per_key_stable_concurrency ?? null,
      global_provider_concurrency: execution.global_provider_concurrency ?? null,
      queue_submission_concurrency: execution.queue_submission_concurrency ?? null
    }
  };
}

function metricNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericValues(rows = [], accessor) {
  return rows.map(accessor).map(metricNumber).filter((value) => value !== null);
}

function average(values = []) {
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
    : null;
}

function technicalMetrics(rows = []) {
  return {
    attempted_count: rows.length,
    completed_count: rows.filter((row) => row.ok === true).length,
    failed_count: rows.filter((row) => row.ok !== true).length
  };
}

function reviewedMetrics(rows = []) {
  const policyValues = numericValues(rows, (row) => row.final_scoring?.policy_fair_token_recall);
  const correctCount = policyValues.filter((value) => (
    value >= launchGateAccuracyContract.per_item_policy_acceptance_threshold
  )).length;
  return {
    evidence_class: "INTERNAL_REVIEWED_GT",
    ...technicalMetrics(rows),
    formal_accuracy: {
      eligible: rows.length > 0 && rows.every((row) => row.reference_title_is_reviewed_ground_truth === true),
      metric: "reviewed_title_policy_acceptance_at_0.72",
      correct_count: correctCount,
      measured_count: policyValues.length,
      rate: rows.length > 0 && policyValues.length === rows.length
        ? Number((correctCount / rows.length).toFixed(6))
        : null,
      policy_fair_token_recall_avg: average(policyValues),
      boundary: "reviewed title-level ground truth only; not field-level card exact"
    }
  };
}

function weakReferenceMetrics(rows = []) {
  const policyValues = numericValues(rows, (row) => row.final_scoring?.policy_fair_token_recall);
  const agreementCount = policyValues.filter((value) => (
    value >= launchGateAccuracyContract.per_item_policy_acceptance_threshold
  )).length;
  return {
    evidence_class: "EBAY_WEAK_LABEL",
    ...technicalMetrics(rows),
    formal_accuracy_eligible: false,
    weak_label_agreement: {
      metric: "seller_title_policy_agreement_at_0.72",
      agreement_count: agreementCount,
      measured_count: policyValues.length,
      agreement_rate: rows.length > 0 && policyValues.length === rows.length
        ? Number((agreementCount / rows.length).toFixed(6))
        : null,
      policy_fair_token_recall_avg: average(policyValues),
      boundary: "marketplace seller text is a weak label and cannot support formal accuracy"
    }
  };
}

function evidenceClassForResult(entry = {}, row = {}) {
  const runCohort = cleanText(entry.cohort).toUpperCase();
  const reviewedGroundTruth = row.reference_title_is_reviewed_ground_truth === true
    && cleanText(row.reference_title_type).toUpperCase() === "REVIEWED_INTERNAL_TITLE";
  const ebayWeakLabel = row.reference_title_is_reviewed_ground_truth !== true
    && cleanText(row.reference_title_type).toUpperCase() === "MARKETPLACE_WEAK_LABEL";

  if (runCohort === "INTERNAL_REVIEWED_GT") return reviewedGroundTruth ? "INTERNAL_REVIEWED_GT" : "UNKNOWN";
  if (["EBAY_COLD_START", "EBAY_WEAK_LABEL"].includes(runCohort)) {
    return ebayWeakLabel ? "EBAY_WEAK_LABEL" : "UNKNOWN";
  }
  return "UNKNOWN";
}

function requiredReviewedCorrectCount(profile, cohortCount) {
  if (profile === "reviewed-10") return launchGateAccuracyContract.reviewed_10_minimum_correct_count;
  return Math.ceil((cohortCount * launchGateAccuracyContract.minimum_internal_reviewed_gt_rate) - 1e-12);
}

export function buildLaunchGateFormalAccuracyGate({
  profile = "reviewed-10",
  cohortCount = 0,
  internalMetrics = {},
  ebayMetrics = {}
} = {}) {
  const parsedCohortCount = Number(cohortCount);
  const expectedCount = Number.isInteger(parsedCohortCount) && parsedCohortCount >= 0
    ? parsedCohortCount
    : 0;
  const formalAccuracy = internalMetrics.formal_accuracy || {};
  const requiredCorrectCount = requiredReviewedCorrectCount(profile, expectedCount);
  const parsedRate = formalAccuracy.rate === null || formalAccuracy.rate === undefined
    ? null
    : Number(formalAccuracy.rate);
  const actualRate = Number.isFinite(parsedRate) ? parsedRate : null;
  const checks = {
    reviewed_ground_truth_only: formalAccuracy.eligible === true,
    measured_count_matches_cohort: expectedCount > 0
      && Number(formalAccuracy.measured_count) === expectedCount,
    minimum_correct_count_met: expectedCount > 0
      && Number(formalAccuracy.correct_count) >= requiredCorrectCount,
    minimum_rate_met: actualRate !== null
      && actualRate >= launchGateAccuracyContract.minimum_internal_reviewed_gt_rate,
    ebay_diagnostics_only: ebayMetrics.formal_accuracy_eligible === false
      && !Object.hasOwn(ebayMetrics, "formal_accuracy")
  };
  return {
    scope: launchGateAccuracyContract.formal_scope,
    threshold_rate: launchGateAccuracyContract.minimum_internal_reviewed_gt_rate,
    cohort_count: expectedCount,
    required_correct_count: requiredCorrectCount,
    measured_count: Number(formalAccuracy.measured_count || 0),
    actual_correct_count: Number(formalAccuracy.correct_count || 0),
    actual_rate: actualRate,
    checks,
    passed: Object.values(checks).every((value) => value === true)
  };
}

export function assertLaunchGateFormalAccuracy(report = {}) {
  const gate = report.formal_accuracy_gate || {};
  const failed = Object.entries(gate.checks || {})
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (gate.passed !== true || failed.length) {
    throw new Error(
      `Launch-gate formal accuracy failed: ${failed.length ? failed.join(", ") : "gate_not_passed"}; `
      + `correct=${Number(gate.actual_correct_count || 0)}/${Number(gate.cohort_count || 0)}, `
      + `measured=${Number(gate.measured_count || 0)}, required=${Number(gate.required_correct_count || 0)}, `
      + `minimum_rate=${launchGateAccuracyContract.minimum_internal_reviewed_gt_rate}.`
    );
  }
  return gate.checks;
}

export function assertObservedExecutionContract(runReports = []) {
  const reports = runReports.map((entry) => entry.report || entry);
  const results = reports.flatMap((report) => report.results || []);
  const internalResults = runReports
    .filter((entry) => cleanText(entry.cohort).toUpperCase() === "INTERNAL_REVIEWED_GT")
    .flatMap((entry) => (entry.report || entry).results || []);
  const vectorSelfExclusionAttempts = internalResults.filter((result) => (
    result.vector_self_exclusion_query_attempted === true
  ));
  const cohortPlans = runReports.filter((entry) => Object.hasOwn(entry, "cold_start_blind"));
  const checks = {
    model_override_locked: reports.length > 0 && reports.every((report) => report.model_override === launchGateExecutionContract.model),
    runner_concurrency_locked: reports.length > 0 && reports.every((report) => Number(report.concurrency) === 2),
    preparation_concurrency_locked: reports.length > 0 && reports.every((report) => Number(report.preparation_concurrency) === 4),
    submission_concurrency_locked: reports.length > 0 && reports.every((report) => Number(report.submission_concurrency) === 2),
    provider_concurrency_locked: reports.length > 0 && reports.every((report) => Number(report.provider_concurrency) === 2),
    identity_cache_disabled: reports.length > 0 && reports.every((report) => report.identity_cache_disabled === true),
    identity_cache_never_hit: results.length > 0 && results.every((result) => result.identity_cache_hit !== true),
    identity_cache_read_bypassed: results.length > 0 && results.every((result) => result.identity_cache_read_bypassed === true),
    image_detail_high: results.length > 0 && results.every((result) => cleanText(result.provider_image_detail).toLowerCase() === "high"),
    predictions_frozen_before_scoring: reports.length > 0 && reports.every((report) => Boolean(cleanText(report.predictions_sha256))),
    vector_self_retrieval_exclusion_enforced: vectorSelfExclusionAttempts.every((result) => (
      result.vector_self_exclusion_filter_active === true
      && Number(result.vector_self_exclusion_requested_source_count) >= 1
      && Boolean(cleanText(result.vector_self_exclusion_source_ids_sha256))
    )),
    cohort_cold_start_policy_observed: cohortPlans.length === 0 || cohortPlans.every((entry) => (
      entry.report?.cold_start_blind === entry.cold_start_blind
    ))
  };
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  if (failed.length) throw new Error(`Observed launch-gate contract failed: ${failed.join(", ")}`);
  return checks;
}

export function buildLaunchGateReport({
  profile = "reviewed-10",
  dataset = {},
  datasetContract = {},
  startSnapshot = {},
  endSnapshot = {},
  expectedDeployment = {},
  startRuntimeChecks = {},
  endRuntimeChecks = {},
  providerPreflight = {},
  observedChecks = {},
  runReports = [],
  now = new Date()
} = {}) {
  const classifiedResults = runReports.flatMap((entry) => (
    (entry.report?.results || entry.results || []).map((row) => ({
      row,
      evidenceClass: evidenceClassForResult(entry, row)
    }))
  ));
  const results = classifiedResults.map(({ row }) => row);
  const internalRows = classifiedResults
    .filter(({ evidenceClass }) => evidenceClass === "INTERNAL_REVIEWED_GT")
    .map(({ row }) => row);
  const weakRows = classifiedResults
    .filter(({ evidenceClass }) => evidenceClass === "EBAY_WEAK_LABEL")
    .map(({ row }) => row);
  const unknownRows = classifiedResults
    .filter(({ evidenceClass }) => evidenceClass === "UNKNOWN")
    .map(({ row }) => row);
  const drift = deploymentDrift(startSnapshot, endSnapshot);
  const sampleProvenance = runReports.map((entry) => (entry.report || entry).evaluation_sample_policy || null);
  const internalMetrics = reviewedMetrics(internalRows);
  const ebayMetrics = weakReferenceMetrics(weakRows);
  const formalAccuracyGate = buildLaunchGateFormalAccuracyGate({
    profile,
    cohortCount: datasetContract.cohort_counts?.internal_reviewed_gt,
    internalMetrics,
    ebayMetrics
  });
  const report = {
    schema_version: "launch-gate-evaluation-report-v1",
    generated_at: now.toISOString(),
    profile,
    execution_contract: {
      required: launchGateExecutionContract,
      observed_checks: observedChecks,
      provider_preflight: providerPreflight,
      deployment: {
        expected: {
          deployment_id: cleanText(expectedDeployment.deployment_id) || null,
          deployment_sha: cleanText(expectedDeployment.deployment_sha) || null
        },
        start: startSnapshot,
        start_checks: startRuntimeChecks,
        end: endSnapshot,
        end_checks: endRuntimeChecks,
        drift
      }
    },
    data_contract: {
      ...datasetContract,
      sample_policy: dataset.evaluation_sample_policy || null,
      sample_provenance: {
        verified: sampleProvenance.length > 0
          && sampleProvenance.every((policy) => policy?.provenance_verified === true),
        runs: sampleProvenance
      }
    },
    accuracy_reporting_policy: {
      combined_formal_accuracy_prohibited: true,
      combined_formal_accuracy: null,
      formal_scope: launchGateAccuracyContract.formal_scope,
      minimum_internal_reviewed_gt_rate: launchGateAccuracyContract.minimum_internal_reviewed_gt_rate,
      weak_reference_scope: "ebay_weak_label_diagnostics_only",
      ebay_formal_accuracy_eligible: false
    },
    formal_accuracy_gate: formalAccuracyGate,
    technical_summary: {
      ...technicalMetrics(results),
      run_count: runReports.length,
      run_wall_ms: runReports.reduce((sum, entry) => sum + Number((entry.report || entry).run_wall_ms || 0), 0),
      pipeline_node_observability: summarizePipelineNodeLedgers(results)
    },
    integrity_checks: {
      deployment_stable: drift.unchanged,
      all_results_classified: unknownRows.length === 0,
      combined_formal_accuracy_absent: true,
      internal_reviewed_gt_measurement_complete: formalAccuracyGate.checks.measured_count_matches_cohort,
      ebay_diagnostics_only: formalAccuracyGate.checks.ebay_diagnostics_only,
      formal_accuracy_gate_passed: formalAccuracyGate.passed
    },
    strata: {
      internal_reviewed_gt: internalMetrics,
      ebay_weak_label: ebayMetrics,
      unclassified: {
        ...technicalMetrics(unknownRows),
        formal_accuracy_eligible: false
      }
    },
    results
  };
  return report;
}

function assertNoLockedCliOverrides(argv = []) {
  const found = lockedCliOptions.filter((name) => argv.some((arg) => arg === name || arg.startsWith(`${name}=`)));
  if (found.length) throw new Error(`Launch-gate execution options are locked; remove: ${found.join(", ")}`);
}

async function prepareRunPlans({ profile, dataset, tempRoot }) {
  const items = loadItems(dataset);
  if (profile === "reviewed-10") {
    const recognitionDataset = recognitionSafeValue(dataset);
    const recognitionItems = loadItems(recognitionDataset);
    const recognitionPath = join(tempRoot, "internal_reviewed_gt.json");
    assertRecognitionManifestBlind(recognitionDataset, []);
    await writeFile(recognitionPath, `${JSON.stringify(recognitionDataset, null, 2)}\n`);
    return [{
      cohort: "INTERNAL_REVIEWED_GT",
      coldStartBlind: false,
      datasetPath: recognitionPath,
      itemCount: recognitionItems.length,
      recognitionItems,
      scoringItems: items
    }];
  }
  const plans = [];
  for (const [cohort, coldStartBlind] of [["INTERNAL_REVIEWED_GT", false], ["EBAY_COLD_START", true]]) {
    const cohortItems = items.filter((item) => cohortForItem(item) === cohort);
    const recognitionItems = recognitionSafeValue(cohortItems);
    const cohortPath = join(tempRoot, `${cohort.toLowerCase()}.json`);
    const cohortItemIds = cohortItems.map((item) => cleanText(item.source_feedback_id || item.asset_id));
    await writeFile(cohortPath, `${JSON.stringify({
      ...dataset,
      item_count: cohortItems.length,
      evaluation_sample_policy: dataset.evaluation_sample_policy
        ? {
          ...dataset.evaluation_sample_policy,
          selected_item_count: cohortItems.length,
          selected_item_ids_sha256: evaluationItemSetSha256(cohortItemIds)
        }
        : null,
      items: recognitionItems
    }, null, 2)}\n`);
    plans.push({
      cohort,
      coldStartBlind,
      datasetPath: cohortPath,
      itemCount: recognitionItems.length,
      recognitionItems,
      scoringItems: cohortItems
    });
  }
  return plans;
}

export async function runLaunchGateEvaluation({
  profile = "reviewed-10",
  datasetPath,
  sealedLabelsPath,
  baseUrl,
  username,
  password,
  expectedDeploymentId = "",
  expectedDeploymentSha = "",
  outPath,
  thinkMs = 0,
  l2WaitMs = 240000,
  requestTimeoutMs = 120000,
  fetchImpl = globalThis.fetch,
  smokeRunner = runV4EbaySmoke,
  progress = true,
  now = () => new Date()
} = {}) {
  if (!datasetPath) throw new Error("--dataset is required");
  if (!sealedLabelsPath) throw new Error("--sealed-labels is required");
  if (!outPath) throw new Error("--out is required");
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error("--base-url is required");
  if (!username || !password) throw new Error("runtime credentials are required");
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const datasetContract = assertLaunchGateDatasetContract(dataset, { profile });
  const expectedDeployment = {
    deployment_id: cleanText(expectedDeploymentId),
    deployment_sha: cleanText(expectedDeploymentSha)
  };

  const startHealth = await fetchJson({ baseUrl: normalizedBaseUrl, path: "/api/v4/health", fetchImpl });
  const startSnapshot = runtimeSnapshot(startHealth);
  const startRuntimeChecks = assertRuntimeSnapshot(startSnapshot, {
    expectedDeploymentId: expectedDeployment.deployment_id,
    expectedDeploymentSha: expectedDeployment.deployment_sha
  });
  const cookie = await login({ baseUrl: normalizedBaseUrl, username, password, fetchImpl });
  const providerStatus = await fetchJson({
    baseUrl: normalizedBaseUrl,
    path: "/api/listing-provider-status",
    cookie,
    fetchImpl
  });
  const providerPreflight = assertProviderControlPlane(providerStatus, { expectedRuntime: startSnapshot });

  const tempRoot = await mkdtemp(join(tmpdir(), "lynca-launch-gate-"));
  const runReports = [];
  try {
    const emptyReferencesPath = join(tempRoot, "sealed-references-empty.jsonl");
    await writeFile(emptyReferencesPath, "\n");
    const plans = await prepareRunPlans({ profile, dataset, tempRoot });
    for (const plan of plans) {
      if (progress) process.stderr.write(`[launch-gate] cohort=${plan.cohort} items=${plan.itemCount}\n`);
      const report = await smokeRunner({
        datasetPath: plan.datasetPath,
        sealedLabelsPath: emptyReferencesPath,
        baseUrl: normalizedBaseUrl,
        username,
        password,
        limit: plan.itemCount,
        prewarm: false,
        queueMode: true,
        forceL2Direct: true,
        modelOverride: launchGateExecutionContract.model,
        enableL1: false,
        compactL2: false,
        ultraFastL2: launchGateExecutionContract.ultra_fast_l2,
        ultraFastImageDetail: launchGateExecutionContract.image_detail,
        disableIdentityCache: launchGateExecutionContract.identity_cache_disabled,
        coldStartBlind: plan.coldStartBlind,
        usePreingestion: true,
        speculative: true,
        thinkMs,
        l2WaitMs,
        requestTimeoutMs,
        concurrency: launchGateExecutionContract.provider_concurrency,
        preparationConcurrency: launchGateExecutionContract.preparation_concurrency,
        submissionConcurrency: launchGateExecutionContract.submission_concurrency,
        evaluationSampleMode: dataset.evaluation_sample_policy?.mode || "UNSPECIFIED",
        outPath: "",
        progress
      });
      runReports.push({
        cohort: plan.cohort,
        cold_start_blind: plan.coldStartBlind,
        scoring_items: plan.scoringItems,
        report
      });
    }
    const sealedReferences = await readSealedReferenceMap(sealedLabelsPath);
    for (const entry of runReports) {
      entry.report.results = attachPostRecognitionScoring(
        entry.report.results || [],
        entry.scoring_items,
        sealedReferences
      );
    }
    datasetContract.sealed_reference_handling = {
      loaded_after_all_predictions_frozen: true,
      recognition_runs_with_empty_reference_file: runReports.length,
      sealed_reference_count: new Set(sealedReferences.values()).size,
      prediction_hashes: runReports.map((entry) => entry.report.predictions_sha256)
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  const endHealth = await fetchJson({ baseUrl: normalizedBaseUrl, path: "/api/v4/health", fetchImpl });
  const endSnapshot = runtimeSnapshot(endHealth);
  const endRuntimeChecks = assertRuntimeSnapshot(endSnapshot, {
    expectedDeploymentId: expectedDeployment.deployment_id,
    expectedDeploymentSha: expectedDeployment.deployment_sha
  });
  const observedChecks = assertObservedExecutionContract(runReports);
  const report = buildLaunchGateReport({
    profile,
    dataset,
    datasetContract,
    startSnapshot,
    endSnapshot,
    expectedDeployment,
    startRuntimeChecks,
    endRuntimeChecks,
    providerPreflight,
    observedChecks,
    runReports,
    now: now()
  });
  await writeJson(outPath, report);
  if (!report.integrity_checks.deployment_stable) {
    throw new Error("Production deployment id/sha drifted during the launch-gate run.");
  }
  if (!report.integrity_checks.all_results_classified) {
    throw new Error(`Launch-gate report contains ${report.strata.unclassified.attempted_count} unclassified result(s).`);
  }
  assertLaunchGateFormalAccuracy(report);
  return report;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  assertNoLockedCliOverrides(argv);
  const report = await runLaunchGateEvaluation({
    profile: argValue(argv, "--profile", env.LAUNCH_GATE_PROFILE || "reviewed-10"),
    datasetPath: argValue(argv, "--dataset", env.DATASET_PATH || ""),
    sealedLabelsPath: argValue(argv, "--sealed-labels", env.SEALED_LABELS_PATH || ""),
    baseUrl: argValue(argv, "--base-url", env.API_BASE_URL || ""),
    username: argValue(argv, "--username", env.METAVERSE_USERNAME || ""),
    password: argValue(argv, "--password", env.METAVERSE_PASSWORD || ""),
    expectedDeploymentId: argValue(
      argv,
      "--expected-deployment-id",
      env.LAUNCH_GATE_EXPECTED_DEPLOYMENT_ID || env.EXPECTED_DEPLOYMENT_ID || ""
    ),
    expectedDeploymentSha: argValue(
      argv,
      "--expected-deployment-sha",
      env.LAUNCH_GATE_EXPECTED_DEPLOYMENT_SHA || env.EXPECTED_DEPLOYMENT_SHA || ""
    ),
    outPath: argValue(argv, "--out", env.REPORT_PATH || ""),
    thinkMs: numberArg(argv, "--think-ms", 0),
    l2WaitMs: numberArg(argv, "--l2-wait-ms", 240000),
    requestTimeoutMs: numberArg(argv, "--request-timeout-ms", 120000),
    progress: !argv.includes("--no-progress")
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    profile: report.profile,
    execution_contract: report.execution_contract,
    technical_summary: report.technical_summary,
    strata: report.strata
  }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Run launch-gate evaluation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
