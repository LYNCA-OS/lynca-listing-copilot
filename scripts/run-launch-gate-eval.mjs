#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEvaluationSampleProvenance,
  evaluationItemSetSha256,
  normalizeEvaluationSampleMode
} from "../lib/listing/evaluation/sample-policy.mjs";
import { assertRecognitionManifestBlind } from "./build-launch-gate-mixed-manifest.mjs";
import {
  attachPostRecognitionScoring,
  durableSourceFingerprint,
  login,
  payloadForItem,
  readVerifiedAssetCache,
  runV4EbaySmoke,
  summarizePipelineNodeLedgers
} from "./v4-ebay-smoke.mjs";
import { materializeLaunchGateImages } from "./materialize-launch-gate-images.mjs";
import {
  attachReviewedTitleSemProjection,
  reviewedTitleSemAcceptanceThreshold
} from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";

export const launchGateExecutionContract = Object.freeze({
  model: "gpt-5-mini",
  image_detail: "high",
  provider_prompt_mode: "v4_compact_l2",
  provider_concurrency: 2,
  // Three preparation lanes match the browser upload bulkhead and provide one
  // spare lane over the two-provider critical path. This is chain capacity,
  // not an algorithm/model concurrency change.
  preparation_concurrency: 3,
  submission_concurrency: 2,
  identity_cache_disabled: true,
  ultra_fast_l2: false
});

export const launchGateAccuracyContract = Object.freeze({
  contract_version: "listing-evaluation-gate-v4-2026-07-19",
  frozen_at: "2026-07-19",
  primary_metric: "policy_fair_token_recall_avg",
  sem_role: "catastrophic_single_card_guard_only",
  deprecated_primary_metric: "per_item_sem_acceptance_rate_at_0.87",
  per_item_sem_acceptance_threshold: reviewedTitleSemAcceptanceThreshold,
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

export const launchGateSpeedContract = Object.freeze({
  minimum_writer_perceived_cards_per_minute: 6,
  required_profiles: ["reviewed-10", "reviewed-50", "ebay-50", "mixed-100"],
  clock_start: "first_writer_upload_started",
  clock_stop: "all_complete_recognition_results_available",
  excluded_setup: ["candidate_protection", "dataset_download", "image_materialization", "prewarm"]
});

export const launchGateIterationContract = Object.freeze({
  formal_mode: "formal-cold-chain",
  strategy_replay_mode: "strategy-replay",
  default_verified_asset_cache_path: ".local/launch-gate/verified-assets-v1.json"
});

const supportedProfiles = new Set(["reviewed-10", "reviewed-50", "ebay-50", "mixed-100"]);
const lockedCliOptions = [
  "--username",
  "--password",
  "--model",
  "--limit",
  "--concurrency",
  "--preparation-concurrency",
  "--submission-concurrency",
  "--ultra-image-detail",
  "--compact-l2",
  "--ultra-fast-l2",
  "--disable-identity-cache",
  "--enable-identity-cache"
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function launchGateItemId(item = {}) {
  return cleanText(item.asset_id || item.candidate_id || item.id || item.physical_card_id);
}

function structurallyReusableAssetEntry(entry = {}, fingerprint = "", sourceAssetId = "") {
  return Boolean(entry
    && cleanText(entry.fingerprint) === cleanText(fingerprint)
    && cleanText(sourceAssetId)
    && cleanText(entry.asset_id)
    && cleanText(entry.tenant_id)
    && cleanText(entry.image_generation_id)
    && Number(entry.image_count) > 0);
}

async function materializeStrategyReplayMisses({
  dataset,
  verifiedAssetCachePath,
  outputDirectory,
  baseUrl,
  cookie,
  concurrency,
  fetchImpl,
  imageMaterializer,
  assetCacheReader,
  sourceFingerprint
} = {}) {
  const items = loadItems(dataset);
  const cache = await assetCacheReader(verifiedAssetCachePath);
  const coverage = await Promise.all(items.map(async (item, index) => {
    const fingerprint = await sourceFingerprint(item, index);
    return {
      item,
      fingerprint,
      hit: structurallyReusableAssetEntry(cache.get(fingerprint), fingerprint, launchGateItemId(item))
    };
  }));
  const misses = coverage.filter((entry) => !entry.hit).map((entry) => entry.item);
  if (!misses.length) {
    return {
      dataset,
      summary: {
        mode: "skipped_verified_asset_reuse",
        item_count: items.length,
        image_count: items.reduce((sum, item) => sum + (item.images || []).length, 0),
        cache_hit_count: items.length,
        cache_miss_count: 0,
        downloaded_count: 0,
        reused_local_count: 0
      }
    };
  }
  const missDataset = Array.isArray(dataset) ? misses : { ...dataset, items: misses };
  const materializedMisses = await imageMaterializer({
    dataset: missDataset,
    outputDirectory,
    baseUrl,
    cookie,
    concurrency,
    fetchImpl
  });
  const materializedById = new Map(loadItems(materializedMisses.dataset)
    .map((item) => [launchGateItemId(item), item]));
  const mergedItems = items.map((item) => materializedById.get(launchGateItemId(item)) || item);
  return {
    dataset: Array.isArray(dataset) ? mergedItems : { ...dataset, items: mergedItems },
    summary: {
      ...materializedMisses.summary,
      mode: "verified_asset_reuse_with_bounded_miss_materialization",
      item_count: items.length,
      image_count: items.reduce((sum, item) => sum + (item.images || []).length, 0),
      cache_hit_count: items.length - misses.length,
      cache_miss_count: misses.length,
      materialized_miss_count: misses.length
    }
  };
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export function numberArg(argv, name, fallback) {
  const rawValue = argValue(argv, name, null);
  if (rawValue === null || String(rawValue).trim() === "") return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function deploymentProtectedFetch(fetchImpl = globalThis.fetch, {
  baseUrl = "",
  bypassSecret = "",
  bypassCookie = ""
} = {}) {
  const secret = cleanText(bypassSecret);
  const deploymentCookie = cleanText(bypassCookie);
  const targetOrigin = normalizeBaseUrl(baseUrl);
  if ((!secret && !deploymentCookie) || !targetOrigin) return fetchImpl;
  const targetHost = new URL(targetOrigin).host;
  return async (input, init = {}) => {
    const requestUrl = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (requestUrl.host !== targetHost) return fetchImpl(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    if (secret) headers.set("x-vercel-protection-bypass", secret);
    if (deploymentCookie) {
      const requestCookie = cleanText(headers.get("cookie"));
      const deploymentCookieName = deploymentCookie.split("=", 1)[0];
      const withoutStaleDeploymentCookie = requestCookie.split(";")
        .map((value) => cleanText(value))
        .filter(Boolean)
        .filter((value) => value.split("=", 1)[0] !== deploymentCookieName);
      headers.set("cookie", [...withoutStaleDeploymentCookie, deploymentCookie].join("; "));
    }
    return fetchImpl(input, { ...init, headers });
  };
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

function launchGateCheckpointFingerprint({ profile = "", evaluationMode = "formal-cold-chain", dataset = {}, expectedDeployment = {} } = {}) {
  return evaluationItemSetSha256([
    `profile:${cleanText(profile)}`,
    `evaluation_mode:${cleanText(evaluationMode)}`,
    `deployment:${cleanText(expectedDeployment.deployment_id)}`,
    `sha:${cleanText(expectedDeployment.deployment_sha)}`,
    `seed:${cleanText(dataset.selection_seed || dataset.evaluation_sample_policy?.sample_seed_sha256)}`,
    ...loadItems(dataset).map((item) => cleanText(item.source_feedback_id || item.asset_id || item.physical_card_id))
  ]);
}

async function readLaunchGateCheckpoint(path, fingerprint) {
  try {
    const checkpoint = JSON.parse(await readFile(resolve(path), "utf8"));
    if (checkpoint.schema_version !== "launch-gate-checkpoint-v1") {
      throw new Error("unsupported checkpoint schema");
    }
    if (checkpoint.fingerprint !== fingerprint) {
      throw new Error("checkpoint fingerprint does not match this sample and deployment");
    }
    return checkpoint;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeLaunchGateCheckpoint(path, checkpoint) {
  await writeJson(path, {
    ...checkpoint,
    updated_at: new Date().toISOString()
  });
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
    fastInitialPrompt: false,
    compactL2: true,
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
  if (["reviewed-10", "reviewed-50"].includes(profile)) {
    const expectedCount = profile === "reviewed-50" ? 50 : 10;
    if (items.length !== expectedCount) {
      throw new Error(`${profile} requires exactly ${expectedCount} items; received ${items.length}.`);
    }
    if (Number(cohortCounts.INTERNAL_REVIEWED_GT || 0) !== expectedCount) {
      throw new Error(`${profile} requires ${expectedCount} internal reviewed GT items.`);
    }
    const sampleMode = normalizeEvaluationSampleMode(dataset.evaluation_sample_policy?.mode || "UNSPECIFIED");
    if (!["RANDOM_BLIND", "FIXED_REGRESSION"].includes(sampleMode)) {
      throw new Error(`${profile} requires RANDOM_BLIND or FIXED_REGRESSION provenance; received ${sampleMode}.`);
    }
    assertEvaluationSampleProvenance({
      requestedMode: sampleMode,
      datasetPolicy: dataset.evaluation_sample_policy
    });
  } else if (profile === "ebay-50") {
    assertRecognitionManifestBlind(dataset, []);
    if (items.length !== 50 || Number(cohortCounts.EBAY_COLD_START || 0) !== 50) {
      throw new Error(`ebay-50 requires exactly 50 eBay cold-start items; received items=${items.length}, ebay=${Number(cohortCounts.EBAY_COLD_START || 0)}.`);
    }
    if (Number(cohortCounts.INTERNAL_REVIEWED_GT || 0) > 0 || Number(cohortCounts.UNKNOWN || 0) > 0) {
      throw new Error("ebay-50 cannot contain internal reviewed or unknown cohort items.");
    }
    const sampleMode = normalizeEvaluationSampleMode(dataset.evaluation_sample_policy?.mode || "UNSPECIFIED");
    if (sampleMode !== "RANDOM_BLIND") {
      throw new Error(`ebay-50 requires RANDOM_BLIND provenance; received ${sampleMode}.`);
    }
    assertEvaluationSampleProvenance({
      requestedMode: sampleMode,
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
  const immutableCandidateMode = Boolean(expectedId && !expectedSha);
  const checks = {
    ready: snapshot.ready === true,
    deployment_id_present: Boolean(cleanText(snapshot.deployment_id)),
    immutable_runtime_identity: immutableCandidateMode
      ? cleanText(snapshot.deployment_id) === expectedId
      : Boolean(cleanText(snapshot.deployment_sha)),
    main_branch_or_pinned_candidate: immutableCandidateMode
      ? true
      : cleanText(snapshot.deployment_ref) === "main",
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
  const startSha = cleanText(start.deployment_sha);
  const endSha = cleanText(end.deployment_sha);
  const checks = {
    deployment_id_unchanged: Boolean(start.deployment_id)
      && start.deployment_id === end.deployment_id,
    deployment_sha_unchanged_or_absent: startSha || endSha
      ? Boolean(startSha) && startSha === endSha
      : true
  };
  return { ...checks, unchanged: Object.values(checks).every((value) => value === true) };
}

export function assertProviderControlPlane(status = {}, { expectedRuntime = null } = {}) {
  const execution = status.execution_control || {};
  const recognitionWorker = execution.recognition_worker || {};
  const paddleOcrVerifier = execution.paddle_ocr_verifier || {};
  const selectableModels = (status.providers || []).filter((provider) => provider?.selectable === true)
    .map((provider) => cleanText(provider.model_id));
  const checks = {
    model_available: selectableModels.includes(launchGateExecutionContract.model),
    provider_global_concurrency_locked: Number(execution.global_provider_concurrency) === launchGateExecutionContract.provider_concurrency,
    provider_key_pool_available: Number(execution.provider_key_pool_size || 0) >= 1,
    recognition_worker_enabled: recognitionWorker.enabled === true,
    recognition_worker_configured: recognitionWorker.configured === true,
    paddle_ocr_verifier_enabled: paddleOcrVerifier.enabled === true,
    paddle_ocr_verifier_configured: paddleOcrVerifier.configured === true,
    ...(expectedRuntime ? {
      provider_status_deployment_id_matches: Boolean(cleanText(status.deployment?.deployment_id))
        && cleanText(status.deployment?.deployment_id) === cleanText(expectedRuntime.deployment_id),
      ...(cleanText(expectedRuntime.deployment_sha) ? {
        provider_status_deployment_sha_matches: Boolean(cleanText(status.deployment?.git_commit_sha))
          && cleanText(status.deployment?.git_commit_sha) === cleanText(expectedRuntime.deployment_sha)
      } : {})
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
      queue_submission_concurrency: execution.queue_submission_concurrency ?? null,
      recognition_worker_enabled: recognitionWorker.enabled === true,
      recognition_worker_configured: recognitionWorker.configured === true,
      paddle_ocr_verifier_enabled: paddleOcrVerifier.enabled === true,
      paddle_ocr_verifier_configured: paddleOcrVerifier.configured === true
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
  const semValues = numericValues(rows, (row) => row.sem_projection_scoring?.weighted_accuracy);
  const legacyTokenValues = numericValues(rows, (row) => row.final_scoring?.policy_fair_token_recall);
  const correctCount = rows.filter((row) => row.sem_projection_scoring?.accepted === true).length;
  return {
    evidence_class: "INTERNAL_REVIEWED_GT",
    ...technicalMetrics(rows),
    formal_accuracy: {
      eligible: rows.length > 0
        && rows.every((row) => row.reference_title_is_reviewed_ground_truth === true)
        && semValues.length === rows.length,
      metric: "linear_sem_weighted_projection_at_0.87",
      correct_count: correctCount,
      measured_count: semValues.length,
      rate: rows.length > 0 && semValues.length === rows.length
        ? Number((correctCount / rows.length).toFixed(6))
        : null,
      sem_weighted_accuracy_avg: average(semValues),
      sem_weighted_accuracy_min: semValues.length ? Math.min(...semValues) : null,
      per_item_acceptance_threshold: launchGateAccuracyContract.per_item_sem_acceptance_threshold,
      authority: "LINEAR_COS_10_TO_COS_23_WITH_SUPABASE_SEM_REGISTRY_VERIFICATION",
      production_release_authority: false,
      boundary: "reviewed-title-derived SEM projection for strategy testing; formal Golden SEM field review remains required for production release",
      token_recall: {
        metric: "policy_fair_token_recall",
        measured_count: legacyTokenValues.length,
        average: average(legacyTokenValues)
      },
      legacy_token_recall_diagnostics: {
        decision_authority: true,
        policy_fair_token_recall_avg: average(legacyTokenValues)
      }
    }
  };
}

function weakReferenceMetrics(rows = []) {
  const semValues = numericValues(rows, (row) => row.sem_projection_scoring?.weighted_accuracy);
  const legacyTokenValues = numericValues(rows, (row) => row.final_scoring?.policy_fair_token_recall);
  const agreementCount = rows.filter((row) => row.sem_projection_scoring?.accepted === true).length;
  return {
    evidence_class: "EBAY_WEAK_LABEL",
    ...technicalMetrics(rows),
    formal_accuracy_eligible: false,
    weak_label_agreement: {
      metric: "seller_title_sem_projection_agreement_at_0.87",
      agreement_count: agreementCount,
      measured_count: semValues.length,
      agreement_rate: rows.length > 0 && semValues.length === rows.length
        ? Number((agreementCount / rows.length).toFixed(6))
        : null,
      sem_weighted_accuracy_avg: average(semValues),
      legacy_token_recall_diagnostics: {
        decision_authority: false,
        policy_fair_token_recall_avg: average(legacyTokenValues)
      },
      boundary: "marketplace seller text is a weak label; SEM projection remains diagnostics only"
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
  const parsedRate = formalAccuracy.rate === null || formalAccuracy.rate === undefined
    ? null
    : Number(formalAccuracy.rate);
  const actualRate = Number.isFinite(parsedRate) ? parsedRate : null;
  const commonChecks = {
    reviewed_ground_truth_only: formalAccuracy.eligible === true,
    ebay_diagnostics_only: ebayMetrics.formal_accuracy_eligible === false
      && !Object.hasOwn(ebayMetrics, "formal_accuracy")
  };
  if (profile === "ebay-50") {
    const checks = {
      ebay_diagnostics_only: commonChecks.ebay_diagnostics_only,
      formal_accuracy_not_applicable: formalAccuracy.eligible !== true
        && !Object.hasOwn(internalMetrics, "formal_accuracy"),
      weak_label_count_matches_cohort: expectedCount > 0
        && Number(ebayMetrics.attempted_count || 0) === expectedCount
    };
    return {
      scope: "ebay_external_distribution_diagnostics_only",
      decision_metric: null,
      threshold_rate: null,
      cohort_count: expectedCount,
      required_correct_count: null,
      measured_count: Number(ebayMetrics.attempted_count || 0),
      actual_correct_count: null,
      actual_rate: null,
      sem_diagnostics: null,
      checks,
      passed: Object.values(checks).every((value) => value === true)
    };
  }
  if (profile === "reviewed-10") {
    const tokenRecall = formalAccuracy.token_recall || {};
    const parsedTokenRecall = metricNumber(tokenRecall.average);
    const minimumSemScore = metricNumber(formalAccuracy.sem_weighted_accuracy_min);
    const checks = {
      ...commonChecks,
      measured_count_matches_cohort: expectedCount > 0
        && Number(tokenRecall.measured_count) === expectedCount,
      minimum_token_recall_met: parsedTokenRecall !== null
        && parsedTokenRecall >= launchGateAccuracyContract.reviewed_10_minimum_token_recall,
      catastrophic_sem_floor_met: minimumSemScore !== null
        && minimumSemScore >= launchGateAccuracyContract.reviewed_10_minimum_sem_floor
    };
    return {
      scope: launchGateAccuracyContract.formal_scope,
      decision_metric: "policy_fair_token_recall_avg",
      threshold_rate: launchGateAccuracyContract.reviewed_10_minimum_token_recall,
      cohort_count: expectedCount,
      required_correct_count: null,
      measured_count: Number(tokenRecall.measured_count || 0),
      actual_correct_count: null,
      actual_rate: parsedTokenRecall,
      sem_diagnostics: {
        correct_count: Number(formalAccuracy.correct_count || 0),
        measured_count: Number(formalAccuracy.measured_count || 0),
        rate: actualRate,
        weighted_accuracy_avg: metricNumber(formalAccuracy.sem_weighted_accuracy_avg),
        weighted_accuracy_min: minimumSemScore,
        catastrophic_floor: launchGateAccuracyContract.reviewed_10_minimum_sem_floor
      },
      checks,
      passed: Object.values(checks).every((value) => value === true)
    };
  }
  const tokenRecall = formalAccuracy.token_recall || {};
  const tokenThreshold = profile === "reviewed-50"
    ? launchGateAccuracyContract.reviewed_50_minimum_token_recall
    : launchGateAccuracyContract.mixed_100_minimum_token_recall;
  const semFloor = profile === "reviewed-50"
    ? launchGateAccuracyContract.reviewed_50_minimum_sem_floor
    : launchGateAccuracyContract.mixed_100_minimum_sem_floor;
  const parsedTokenRecall = metricNumber(tokenRecall.average);
  const minimumSemScore = metricNumber(formalAccuracy.sem_weighted_accuracy_min);
  const checks = {
    ...commonChecks,
    measured_count_matches_cohort: expectedCount > 0
      && Number(tokenRecall.measured_count) === expectedCount,
    minimum_token_recall_met: parsedTokenRecall !== null
      && parsedTokenRecall >= tokenThreshold,
    catastrophic_sem_floor_met: minimumSemScore !== null
      && minimumSemScore >= semFloor
  };
  return {
    scope: launchGateAccuracyContract.formal_scope,
    decision_metric: "policy_fair_token_recall_avg",
    threshold_rate: tokenThreshold,
    cohort_count: expectedCount,
    required_correct_count: null,
    measured_count: Number(tokenRecall.measured_count || 0),
    actual_correct_count: null,
    actual_rate: parsedTokenRecall,
    sem_diagnostics: {
      correct_count: Number(formalAccuracy.correct_count || 0),
      measured_count: Number(formalAccuracy.measured_count || 0),
      rate: actualRate,
      weighted_accuracy_avg: metricNumber(formalAccuracy.sem_weighted_accuracy_avg),
      weighted_accuracy_min: minimumSemScore,
      catastrophic_floor: semFloor
    },
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
      + `metric=${cleanText(gate.decision_metric || "linear_sem_weighted_projection")}, `
      + `actual=${gate.actual_rate ?? "missing"}, measured=${Number(gate.measured_count || 0)}, `
      + `threshold=${gate.threshold_rate ?? launchGateAccuracyContract.mixed_100_minimum_token_recall}.`
    );
  }
  return gate.checks;
}

export function buildWriterPerceivedSpeedGate({
  profile = "reviewed-10",
  evaluationMode = launchGateIterationContract.formal_mode,
  runReports = []
} = {}) {
  const reports = runReports.map((entry) => entry.report || entry);
  const results = reports.flatMap((report) => report.results || []);
  const elapsedMs = reports.reduce((sum, report) => sum + Number(report.run_wall_ms || 0), 0);
  const completedCount = results.filter((result) => result?.ok === true && result?.l2_ready === true).length;
  const expectedCount = results.length;
  const rawRate = elapsedMs > 0 ? completedCount * 60_000 / elapsedMs : null;
  const rate = rawRate === null ? null : Number(rawRate.toFixed(3));
  const formalColdChain = cleanText(evaluationMode) === launchGateIterationContract.formal_mode;
  const cacheHitCount = reports.reduce((sum, report) => (
    sum + Number(report.verified_asset_cache?.hit_count || 0)
  ), 0);
  const required = formalColdChain && launchGateSpeedContract.required_profiles.includes(cleanText(profile));
  const checks = {
    cold_chain_measurement: formalColdChain && cacheHitCount === 0,
    writer_clock_measured: elapsedMs > 0,
    all_cards_complete: expectedCount > 0 && completedCount === expectedCount,
    minimum_rate_met: rawRate !== null
      && rawRate >= launchGateSpeedContract.minimum_writer_perceived_cards_per_minute
  };
  return {
    required,
    evaluation_mode: cleanText(evaluationMode),
    formal_cold_chain: formalColdChain,
    verified_asset_cache_hit_count: cacheHitCount,
    formal_chain_proof_eligible: formalColdChain && cacheHitCount === 0,
    scope: "writer_perceived_upload_to_complete_recognition",
    clock_start: launchGateSpeedContract.clock_start,
    clock_stop: launchGateSpeedContract.clock_stop,
    excluded_setup: launchGateSpeedContract.excluded_setup,
    minimum_cards_per_minute: launchGateSpeedContract.minimum_writer_perceived_cards_per_minute,
    expected_count: expectedCount,
    completed_count: completedCount,
    elapsed_ms: elapsedMs,
    actual_cards_per_minute: rate,
    checks,
    passed: !required || Object.values(checks).every((value) => value === true)
  };
}

export function assertWriterPerceivedSpeed(report = {}) {
  const gate = report.writer_perceived_speed_gate || {};
  if (gate.required !== true) return gate.checks || {};
  const failed = Object.entries(gate.checks || {})
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (gate.passed !== true || failed.length) {
    throw new Error(
      `Launch-gate writer speed failed: ${failed.length ? failed.join(", ") : "gate_not_passed"}; `
      + `actual=${gate.actual_cards_per_minute ?? "missing"}, completed=${Number(gate.completed_count || 0)}/${Number(gate.expected_count || 0)}, `
      + `threshold=${gate.minimum_cards_per_minute ?? launchGateSpeedContract.minimum_writer_perceived_cards_per_minute}.`
    );
  }
  return gate.checks;
}

export function observedExecutionContractChecks(runReports = []) {
  const reports = runReports.map((entry) => entry.report || entry);
  const results = reports.flatMap((report) => report.results || []);
  const cacheBypassObservations = results.filter((result) => (
    Object.hasOwn(result, "identity_cache_read_bypassed")
    && result.identity_cache_read_bypassed !== null
  ));
  const providerExecutionObservations = results.filter((result) => (
    Number(result.provider_latency_ms || 0) > 0
    || Boolean(cleanText(result.provider_prompt_mode))
  ));
  const internalResults = runReports
    .filter((entry) => cleanText(entry.cohort).toUpperCase() === "INTERNAL_REVIEWED_GT")
    .flatMap((entry) => (entry.report || entry).results || []);
  const successfulInternalResults = internalResults.filter((result) => result.ok === true);
  const vectorSelfExclusionAttempts = successfulInternalResults.filter((result) => (
    result.vector_self_exclusion_query_attempted === true
  ));
  const cohortPlans = runReports.filter((entry) => Object.hasOwn(entry, "cold_start_blind"));
  const checks = {
    model_override_locked: reports.length > 0 && reports.every((report) => report.model_override === launchGateExecutionContract.model),
    fast_prompt_override_locked: reports.length > 0 && reports.every((report) => report.fast_initial_prompt_override === false),
    compact_prompt_override_locked: reports.length > 0 && reports.every((report) => report.compact_l2_enabled === true),
    runner_concurrency_locked: reports.length > 0 && reports.every((report) => Number(report.concurrency) === 2),
    preparation_concurrency_locked: reports.length > 0 && reports.every((report) => (
      Number(report.preparation_concurrency) === launchGateExecutionContract.preparation_concurrency
    )),
    submission_concurrency_locked: reports.length > 0 && reports.every((report) => Number(report.submission_concurrency) === 2),
    provider_concurrency_locked: reports.length > 0 && reports.every((report) => Number(report.provider_concurrency) === 2),
    identity_cache_disabled: reports.length > 0 && reports.every((report) => report.identity_cache_disabled === true),
    identity_cache_never_hit: results.length > 0 && results.every((result) => result.identity_cache_hit !== true),
    // Preparation failures and exact-anchor finalizations never enter the
    // provider stage, so they cannot truthfully emit provider-only fields.
    identity_cache_read_bypassed: cacheBypassObservations.every((result) => result.identity_cache_read_bypassed === true),
    image_detail_high: providerExecutionObservations.every((result) => (
      cleanText(result.provider_image_detail).toLowerCase() === "high"
    )),
    provider_prompt_mode_locked: providerExecutionObservations.every((result) => (
      cleanText(result.provider_prompt_mode).toLowerCase() === launchGateExecutionContract.provider_prompt_mode
    )),
    predictions_frozen_before_scoring: reports.length > 0 && reports.every((report) => Boolean(cleanText(report.predictions_sha256))),
    vector_self_retrieval_exclusion_enforced: successfulInternalResults.length === 0
      || (vectorSelfExclusionAttempts.length > 0
        && successfulInternalResults.every((result) => (
          result.vector_self_exclusion_filter_active === true
          && Number(result.vector_self_exclusion_requested_source_count) >= 1
          && Boolean(cleanText(result.vector_self_exclusion_source_ids_sha256))
        ))),
    cohort_cold_start_policy_observed: cohortPlans.length === 0 || cohortPlans.every((entry) => (
      entry.report?.cold_start_blind === entry.cold_start_blind
    ))
  };
  return checks;
}

export function assertObservedExecutionContract(runReports = []) {
  const checks = observedExecutionContractChecks(runReports);
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  if (failed.length) throw new Error(`Observed launch-gate contract failed: ${failed.join(", ")}`);
  return checks;
}

export function buildLaunchGateReport({
  profile = "reviewed-10",
  evaluationMode = launchGateIterationContract.formal_mode,
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
  const writerPerceivedSpeedGate = buildWriterPerceivedSpeedGate({ profile, evaluationMode, runReports });
  const report = {
    schema_version: "launch-gate-evaluation-report-v1",
    generated_at: now.toISOString(),
    profile,
    evaluation_mode: evaluationMode,
    formal_chain_proof: evaluationMode === launchGateIterationContract.formal_mode,
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
      contract_version: launchGateAccuracyContract.contract_version,
      frozen_at: launchGateAccuracyContract.frozen_at,
      combined_formal_accuracy_prohibited: true,
      combined_formal_accuracy: null,
      formal_scope: launchGateAccuracyContract.formal_scope,
      minimum_mixed_100_policy_token_recall: launchGateAccuracyContract.mixed_100_minimum_token_recall,
      weak_reference_scope: "ebay_weak_label_diagnostics_only",
      ebay_formal_accuracy_eligible: false,
      token_recall_decision_authority: true,
      sem_projection_catastrophic_guard_only: true,
      deprecated_sem_acceptance_rate_decision_authority: false,
      historical_exposure_exclusion: launchGateAccuracyContract.historical_exposure_exclusion
    },
    formal_accuracy_gate: formalAccuracyGate,
    writer_perceived_speed_gate: writerPerceivedSpeedGate,
    technical_summary: {
      ...technicalMetrics(results),
      run_count: runReports.length,
      run_wall_ms: writerPerceivedSpeedGate.elapsed_ms,
      writer_perceived_cards_per_minute: writerPerceivedSpeedGate.actual_cards_per_minute,
      pipeline_node_observability: summarizePipelineNodeLedgers(results)
    },
    integrity_checks: {
      deployment_stable: drift.unchanged,
      all_results_classified: unknownRows.length === 0,
      combined_formal_accuracy_absent: true,
      internal_reviewed_gt_measurement_complete: profile === "ebay-50"
        ? true
        : formalAccuracyGate.checks.measured_count_matches_cohort,
      ebay_diagnostics_only: formalAccuracyGate.checks.ebay_diagnostics_only,
      formal_accuracy_gate_passed: formalAccuracyGate.passed,
      writer_perceived_speed_gate_passed: writerPerceivedSpeedGate.passed
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
  if (["reviewed-10", "reviewed-50"].includes(profile)) {
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
  if (profile === "ebay-50") {
    const recognitionDataset = recognitionSafeValue(dataset);
    const recognitionItems = loadItems(recognitionDataset);
    const recognitionPath = join(tempRoot, "ebay_cold_start.json");
    assertRecognitionManifestBlind(recognitionDataset, []);
    await writeFile(recognitionPath, `${JSON.stringify(recognitionDataset, null, 2)}\n`);
    return [{
      cohort: "EBAY_COLD_START",
      coldStartBlind: true,
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

export function datasetForLaunchGateProfile(dataset = {}, profile = "reviewed-10") {
  if (!["reviewed-10", "reviewed-50", "ebay-50"].includes(profile)) return dataset;
  const targetCohort = profile === "ebay-50" ? "EBAY_COLD_START" : "INTERNAL_REVIEWED_GT";
  const profileLimit = profile === "reviewed-10" ? 10 : 50;
  const items = loadItems(dataset)
    .filter((item) => cohortForItem(item) === targetCohort)
    .slice(0, profileLimit);
  const selectedIds = items.map((item) => cleanText(item.source_feedback_id || item.asset_id));
  return {
    ...dataset,
    items,
    item_count: items.length,
    allocation: undefined,
    evaluation_sample_policy: dataset.evaluation_sample_policy
      ? {
        ...dataset.evaluation_sample_policy,
        selected_item_count: items.length,
        selected_item_ids_sha256: evaluationItemSetSha256(selectedIds)
      }
      : null
  };
}

export async function runLaunchGateEvaluation({
  profile = "reviewed-10",
  evaluationMode = launchGateIterationContract.formal_mode,
  datasetPath,
  sealedLabelsPath,
  baseUrl,
  username,
  password,
  expectedDeploymentId = "",
  expectedDeploymentSha = "",
  outPath,
  checkpointPath = "",
  verifiedAssetCachePath = launchGateIterationContract.default_verified_asset_cache_path,
  resumeBatchIds = {},
  thinkMs = 0,
  l2WaitMs = 240000,
  requestTimeoutMs = 120000,
  fetchImpl = globalThis.fetch,
  smokeRunner = runV4EbaySmoke,
  imageMaterializer = materializeLaunchGateImages,
  assetCacheReader = readVerifiedAssetCache,
  sourceFingerprint = durableSourceFingerprint,
  progress = true,
  now = () => new Date()
} = {}) {
  if (!datasetPath) throw new Error("--dataset is required");
  if (!sealedLabelsPath) throw new Error("--sealed-labels is required");
  if (!outPath) throw new Error("--out is required");
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error("--base-url is required");
  if (!username || !password) throw new Error("runtime credentials are required");
  const normalizedEvaluationMode = cleanText(evaluationMode) || launchGateIterationContract.formal_mode;
  if (![launchGateIterationContract.formal_mode, launchGateIterationContract.strategy_replay_mode].includes(normalizedEvaluationMode)) {
    throw new Error(`unsupported evaluation mode: ${normalizedEvaluationMode}`);
  }
  const sourceDataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const dataset = datasetForLaunchGateProfile(sourceDataset, profile);
  const datasetContract = assertLaunchGateDatasetContract(dataset, { profile });
  const expectedDeployment = {
    deployment_id: cleanText(expectedDeploymentId),
    deployment_sha: cleanText(expectedDeploymentSha)
  };
  const resolvedCheckpointPath = resolve(checkpointPath || `${outPath}.checkpoint.json`);
  const checkpointFingerprint = launchGateCheckpointFingerprint({
    profile,
    evaluationMode: normalizedEvaluationMode,
    dataset,
    expectedDeployment
  });
  const checkpoint = await readLaunchGateCheckpoint(resolvedCheckpointPath, checkpointFingerprint) || {
    schema_version: "launch-gate-checkpoint-v1",
    fingerprint: checkpointFingerprint,
    profile,
    evaluation_mode: normalizedEvaluationMode,
    expected_deployment: expectedDeployment,
    active_batches: {},
    completed_cohorts: {}
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
    const strategyReplay = normalizedEvaluationMode === launchGateIterationContract.strategy_replay_mode;
    const materialized = strategyReplay
      ? await materializeStrategyReplayMisses({
        dataset,
        verifiedAssetCachePath,
        outputDirectory: join(tempRoot, "images"),
        baseUrl: normalizedBaseUrl,
        cookie,
        concurrency: launchGateExecutionContract.preparation_concurrency,
        fetchImpl,
        imageMaterializer,
        assetCacheReader,
        sourceFingerprint
      })
      : await imageMaterializer({
        dataset,
        outputDirectory: join(tempRoot, "images"),
        baseUrl: normalizedBaseUrl,
        cookie,
        concurrency: launchGateExecutionContract.preparation_concurrency,
        fetchImpl
      });
    datasetContract.image_materialization = materialized.summary;
    const emptyReferencesPath = join(tempRoot, "sealed-references-empty.jsonl");
    await writeFile(emptyReferencesPath, "\n");
    const plans = await prepareRunPlans({ profile, dataset: materialized.dataset, tempRoot });
    for (const plan of plans) {
      const completed = checkpoint.completed_cohorts?.[plan.cohort];
      if (completed?.report) {
        if (progress) process.stderr.write(`[launch-gate] cohort=${plan.cohort} restored_from_checkpoint=true\n`);
        runReports.push({
          cohort: plan.cohort,
          cold_start_blind: plan.coldStartBlind,
          scoring_items: plan.scoringItems,
          report: completed.report
        });
        continue;
      }
      if (progress) process.stderr.write(`[launch-gate] cohort=${plan.cohort} items=${plan.itemCount}\n`);
      const explicitResumeBatchId = cleanText(resumeBatchIds?.[plan.cohort]);
      const checkpointBatchId = cleanText(checkpoint.active_batches?.[plan.cohort]);
      const resumeBatchId = explicitResumeBatchId || checkpointBatchId;
      const assignedBatchId = resumeBatchId || `smoke-v4-batch-${Date.now()}-${plan.cohort.toLowerCase()}`;
      checkpoint.active_batches = {
        ...(checkpoint.active_batches || {}),
        [plan.cohort]: assignedBatchId
      };
      await writeLaunchGateCheckpoint(resolvedCheckpointPath, checkpoint);
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
        fastInitialPrompt: false,
        enableL1: false,
        compactL2: true,
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
        batchId: assignedBatchId,
        resumeBatchId,
        evaluationSampleMode: dataset.evaluation_sample_policy?.mode || "UNSPECIFIED",
        verifiedAssetCachePath,
        verifiedAssetCacheMode: strategyReplay ? "reuse" : "refresh",
        outPath: "",
        progress
      });
      runReports.push({
        cohort: plan.cohort,
        cold_start_blind: plan.coldStartBlind,
        scoring_items: plan.scoringItems,
        report
      });
      checkpoint.completed_cohorts = {
        ...(checkpoint.completed_cohorts || {}),
        [plan.cohort]: {
          cohort: plan.cohort,
          cold_start_blind: plan.coldStartBlind,
          report
        }
      };
      delete checkpoint.active_batches[plan.cohort];
      await writeLaunchGateCheckpoint(resolvedCheckpointPath, checkpoint);
    }
    const sealedReferences = await readSealedReferenceMap(sealedLabelsPath);
    for (const entry of runReports) {
      entry.report.results = attachReviewedTitleSemProjection(attachPostRecognitionScoring(
        entry.report.results || [],
        entry.scoring_items,
        sealedReferences
      ));
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
  const observedChecks = observedExecutionContractChecks(runReports);
  const report = buildLaunchGateReport({
    profile,
    evaluationMode: normalizedEvaluationMode,
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
  const failedObservedChecks = Object.entries(observedChecks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (failedObservedChecks.length) {
    throw new Error(`Observed launch-gate contract failed: ${failedObservedChecks.join(", ")}`);
  }
  if (!report.integrity_checks.deployment_stable) {
    throw new Error("Pinned runtime identity drifted during the launch-gate run.");
  }
  if (!report.integrity_checks.all_results_classified) {
    throw new Error(`Launch-gate report contains ${report.strata.unclassified.attempted_count} unclassified result(s).`);
  }
  assertLaunchGateFormalAccuracy(report);
  assertWriterPerceivedSpeed(report);
  return report;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  assertNoLockedCliOverrides(argv);
  const baseUrl = argValue(argv, "--base-url", env.API_BASE_URL || "");
  const originalFetch = globalThis.fetch;
  const fetchImpl = deploymentProtectedFetch(originalFetch, {
    baseUrl,
    bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
    bypassCookie: env.VERCEL_AUTOMATION_BYPASS_COOKIE || ""
  });
  globalThis.fetch = fetchImpl;
  let report;
  try {
    report = await runLaunchGateEvaluation({
    profile: argValue(argv, "--profile", env.LAUNCH_GATE_PROFILE || "reviewed-10"),
    evaluationMode: argv.includes("--strategy-replay")
      ? launchGateIterationContract.strategy_replay_mode
      : launchGateIterationContract.formal_mode,
    datasetPath: argValue(argv, "--dataset", env.DATASET_PATH || ""),
    sealedLabelsPath: argValue(argv, "--sealed-labels", env.SEALED_LABELS_PATH || ""),
    baseUrl,
    username: env.METAVERSE_USERNAME || "",
    password: env.METAVERSE_PASSWORD || "",
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
    checkpointPath: argValue(argv, "--checkpoint", env.LAUNCH_GATE_CHECKPOINT_PATH || ""),
    verifiedAssetCachePath: argValue(
      argv,
      "--verified-asset-cache",
      env.LAUNCH_GATE_VERIFIED_ASSET_CACHE_PATH || launchGateIterationContract.default_verified_asset_cache_path
    ),
    resumeBatchIds: {
      INTERNAL_REVIEWED_GT: argValue(argv, "--resume-internal-batch-id", env.LAUNCH_GATE_RESUME_INTERNAL_BATCH_ID || ""),
      EBAY_COLD_START: argValue(argv, "--resume-ebay-batch-id", env.LAUNCH_GATE_RESUME_EBAY_BATCH_ID || "")
    },
    thinkMs: numberArg(argv, "--think-ms", 0),
    l2WaitMs: numberArg(argv, "--l2-wait-ms", 240000),
    requestTimeoutMs: numberArg(argv, "--request-timeout-ms", 120000),
      progress: !argv.includes("--no-progress"),
      fetchImpl
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
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
