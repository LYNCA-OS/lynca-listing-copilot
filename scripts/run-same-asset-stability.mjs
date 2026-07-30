#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import {
  analyzeSameAssetStability,
  buildSameAssetRuntimePolicyState,
  SAME_ASSET_STABILITY_EXPECTED_RUNS,
  sameAssetStabilityPlanSha256
} from "./analyze-same-asset-stability.mjs";
import {
  durableSourceFingerprint,
  login,
  readVerifiedAssetCache,
  readReusableSessionCookie,
  runV4EbaySmoke
} from "./v4-ebay-smoke.mjs";
import {
  assertFrozenTargetedAssistCohort,
  TARGETED_ASSIST_PAIRED_COHORT_SHA256,
  TARGETED_ASSIST_PAIRED_LABEL_SHA256,
  TARGETED_ASSIST_PAIRED_PARTITION
} from "./run-targeted-assist-paired-eval.mjs";

const sha256Pattern = /^[0-9a-f]{64}$/i;
const gitShaPattern = /^[0-9a-f]{40}$/i;
const deploymentIdPattern = /^dpl_[A-Za-z0-9]+$/;
const frozenCohorts = Object.freeze(["FAMILIAR", "UNSEEN"]);

export const sameAssetStabilityExecutionContract = Object.freeze({
  schema_version: "same-asset-stability-execution-plan-v1",
  cohort: "development",
  planned_runs: SAME_ASSET_STABILITY_EXPECTED_RUNS,
  scheduling: "SEQUENTIAL_SINGLE_FLIGHT",
  session_login_count: 1,
  benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
  provider_concurrency_change: "NONE",
  silent_replacement_of_failed_runs: false,
  default_execution_mode: "DRY_RUN"
});

export const sameAssetTrustedReleaseProofBaseUrl = "https://listing.lyncafei.team";

function cleanText(value) {
  return String(value ?? "").trim();
}

function argValue(argv, name, fallback = "") {
  const direct = argv.indexOf(name);
  if (direct >= 0) return argv[direct + 1] ?? fallback;
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

export function assertSameAssetCandidateTarget({ baseUrl = "", expectedGitSha = "", expectedDeploymentId = "" } = {}) {
  const normalizedBaseUrl = cleanText(baseUrl).replace(/\/+$/, "");
  const url = new URL(normalizedBaseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app")) {
    throw new Error("same-asset stability requires an immutable *.vercel.app candidate URL");
  }
  if (url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("same-asset stability candidate URL must be a bare immutable deployment origin");
  }
  if (!gitShaPattern.test(cleanText(expectedGitSha))) {
    throw new Error("--expected-git-sha must be a full 40-character Git SHA");
  }
  if (!deploymentIdPattern.test(cleanText(expectedDeploymentId))) {
    throw new Error("--expected-deployment-id must be a pinned dpl_* deployment ID");
  }
  return Object.freeze({
    base_url: url.origin,
    expected_git_sha: cleanText(expectedGitSha).toLowerCase(),
    expected_deployment_id: cleanText(expectedDeploymentId)
  });
}

export function sameAssetCandidateProtectionHeaders({
  target,
  requestUrl,
  trustedPublicBinding,
  env = process.env
} = {}) {
  const candidate = assertSameAssetCandidateTarget({
    baseUrl: target?.base_url,
    expectedGitSha: target?.expected_git_sha,
    expectedDeploymentId: target?.expected_deployment_id
  });
  if (cleanText(trustedPublicBinding?.observed_git_sha).toLowerCase() !== candidate.expected_git_sha
    || cleanText(trustedPublicBinding?.observed_deployment_id) !== candidate.expected_deployment_id
    || cleanText(trustedPublicBinding?.observed_deployment_url).toLowerCase()
      !== new URL(candidate.base_url).hostname.toLowerCase()) {
    throw new Error("same-asset candidate is not bound by the trusted public release proof");
  }
  const request = new URL(cleanText(requestUrl));
  if (request.origin !== candidate.base_url) {
    throw new Error("same-asset protection bypass is scoped to the immutable candidate origin");
  }
  const bypass = cleanText(env.VERCEL_AUTOMATION_BYPASS_SECRET || "");
  if (!bypass) throw new Error("same-asset candidate protection bypass is missing");
  return Object.freeze({ "x-vercel-protection-bypass": bypass });
}

export async function verifySameAssetPublicReleaseBinding({
  baseUrl,
  expectedGitSha,
  expectedDeploymentId,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 30_000
} = {}) {
  const target = assertSameAssetCandidateTarget({ baseUrl, expectedGitSha, expectedDeploymentId });
  if (typeof fetchImpl !== "function") throw new Error("same-asset public release verification requires fetch");
  const proofUrl = `${sameAssetTrustedReleaseProofBaseUrl}/api/v4/health`;
  const response = await fetchImpl(proofUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(Math.max(10_000, Number(requestTimeoutMs) || 30_000))
  });
  if (!response.ok) throw new Error(`same-asset public release health failed with HTTP ${response.status}`);
  const health = await response.json();
  const observedGitSha = cleanText(health?.deployment?.git_commit_sha).toLowerCase();
  const observedDeploymentId = cleanText(health?.deployment?.deployment_id);
  const observedDeploymentUrl = cleanText(health?.deployment?.deployment_url).toLowerCase();
  const expectedDeploymentHost = new URL(target.base_url).hostname.toLowerCase();
  if (health?.ready !== true
    || observedGitSha !== target.expected_git_sha
    || observedDeploymentId !== target.expected_deployment_id
    || observedDeploymentUrl !== expectedDeploymentHost) {
    throw new Error("same-asset immutable candidate is not the trusted current production release");
  }
  return Object.freeze({
    schema_version: "same-asset-public-release-binding-v1",
    verified_at: new Date().toISOString(),
    proof_url: proofUrl,
    observed_git_sha: observedGitSha,
    observed_deployment_id: observedDeploymentId,
    observed_deployment_url: observedDeploymentUrl
  });
}

export async function verifySameAssetCandidateDeployment({
  baseUrl,
  expectedGitSha,
  expectedDeploymentId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  trustedPublicBinding,
  requestTimeoutMs = 30_000
} = {}) {
  const target = assertSameAssetCandidateTarget({ baseUrl, expectedGitSha, expectedDeploymentId });
  if (typeof fetchImpl !== "function") throw new Error("same-asset deployment verification requires fetch");
  const healthUrl = `${target.base_url}/api/v4/health`;
  const response = await fetchImpl(healthUrl, {
    headers: sameAssetCandidateProtectionHeaders({
      target,
      requestUrl: healthUrl,
      trustedPublicBinding,
      env
    }),
    redirect: "error",
    signal: AbortSignal.timeout(Math.max(10_000, Number(requestTimeoutMs) || 30_000))
  });
  if (!response.ok) throw new Error(`same-asset candidate health failed with HTTP ${response.status}`);
  const health = await response.json();
  if (health?.ready !== true) throw new Error("same-asset candidate health is not ready");
  const observedGitSha = cleanText(health?.deployment?.git_commit_sha).toLowerCase();
  const observedDeploymentId = cleanText(health?.deployment?.deployment_id);
  const observedDeploymentUrl = cleanText(health?.deployment?.deployment_url).toLowerCase();
  const expectedDeploymentHost = new URL(target.base_url).hostname.toLowerCase();
  if (observedGitSha !== target.expected_git_sha) {
    throw new Error(`same-asset candidate Git SHA mismatch: expected ${target.expected_git_sha}, received ${observedGitSha || "missing"}`);
  }
  if (observedDeploymentId !== target.expected_deployment_id) {
    throw new Error(`same-asset candidate deployment mismatch: expected ${target.expected_deployment_id}, received ${observedDeploymentId || "missing"}`);
  }
  if (observedDeploymentUrl !== expectedDeploymentHost) {
    throw new Error(`same-asset candidate URL is not the deployment URL: expected ${expectedDeploymentHost}, received ${observedDeploymentUrl || "missing"}`);
  }
  return Object.freeze({
    schema_version: "same-asset-candidate-deployment-proof-v1",
    verified_at: new Date().toISOString(),
    base_url: target.base_url,
    expected_git_sha: target.expected_git_sha,
    expected_deployment_id: target.expected_deployment_id,
    observed_git_sha: observedGitSha,
    observed_deployment_id: observedDeploymentId,
    observed_deployment_url: observedDeploymentUrl,
    ready: health?.ready === true
  });
}

function datasetItems(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.items || payload?.records || payload?.results || payload?.cards || [];
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function selectedItemId(item = {}) {
  return cleanText(
    item.source_feedback_id
    || item.source_record?.sealed_eval_label_key
    || item.sealed_eval_label_ref?.key
    || item.asset_id
    || item.physical_card_id
    || item.id
  );
}

function normalizeFrozenCohort(value = "") {
  const cohort = cleanText(value).toUpperCase();
  if (!frozenCohorts.includes(cohort)) {
    throw new Error("--frozen-cohort must be FAMILIAR or UNSEEN");
  }
  return cohort;
}

function assertCanonicalAssetCacheEntry(entry, { fingerprint, imageCount } = {}) {
  if (!entry || cleanText(entry.fingerprint) !== fingerprint) {
    throw new Error("same-asset canonical verified cache entry is missing");
  }
  for (const field of ["asset_id", "tenant_id", "image_generation_id", "canonical_verified_at"]) {
    if (!cleanText(entry[field])) throw new Error(`same-asset cache ${field} is missing`);
  }
  if (cleanText(entry.image_generation_id) !== cleanText(entry.asset_id)) {
    throw new Error("same-asset cache image generation is not canonical");
  }
  if (!sha256Pattern.test(cleanText(entry.canonical_image_set_sha256))) {
    throw new Error("same-asset cache canonical image-set SHA is missing");
  }
  const hashes = Array.isArray(entry.canonical_primary_content_sha256)
    ? entry.canonical_primary_content_sha256.map(cleanText)
    : [];
  if (!imageCount || Number(entry.image_count) !== imageCount
    || hashes.length !== imageCount || hashes.some((value) => !sha256Pattern.test(value))) {
    throw new Error("same-asset cache canonical primary image hashes are incomplete");
  }
  return Object.freeze({
    fingerprint,
    asset_id: cleanText(entry.asset_id),
    tenant_id: cleanText(entry.tenant_id),
    image_generation_id: cleanText(entry.image_generation_id),
    canonical_image_set_sha256: cleanText(entry.canonical_image_set_sha256).toLowerCase(),
    canonical_primary_content_sha256: hashes.map((value) => value.toLowerCase()),
    canonical_verified_at: cleanText(entry.canonical_verified_at)
  });
}

function bindResultToExecutionPlan(row = {}, plan = {}, runnerAttempt = 0, deploymentProof = {}) {
  const runtimePolicyState = buildSameAssetRuntimePolicyState(row);
  return {
    ...row,
    runner_attempt: runnerAttempt,
    same_asset_execution_id: plan.execution_id,
    same_asset_plan_sha256: sameAssetStabilityPlanSha256(plan),
    same_asset_dataset_sha256: plan.dataset_sha256,
    same_asset_sealed_labels_sha256: plan.sealed_labels_sha256,
    same_asset_selected_item_id: plan.selected_item_id,
    same_asset_expected_git_sha: plan.expected_git_sha,
    same_asset_expected_deployment_id: plan.expected_deployment_id,
    same_asset_observed_deployment_id: deploymentProof.observed_deployment_id || null,
    same_asset_observed_deployment_url: deploymentProof.observed_deployment_url || null,
    same_asset_runtime_policy_state: runtimePolicyState
  };
}

export async function buildSameAssetStabilityPlan({
  datasetPath,
  sealedLabelsPath = "",
  baseUrl,
  model = "gpt-5-mini",
  outDir,
  verifiedAssetCachePath,
  plannedRuns = SAME_ASSET_STABILITY_EXPECTED_RUNS,
  frozenCohort,
  itemId,
  expectedGitSha,
  expectedDeploymentId,
  assertFrozenCohortImpl = assertFrozenTargetedAssistCohort
}) {
  const candidateTarget = assertSameAssetCandidateTarget({ baseUrl, expectedGitSha, expectedDeploymentId });
  const datasetBytes = await readFile(resolve(datasetPath));
  const dataset = JSON.parse(datasetBytes.toString("utf8"));
  const items = datasetItems(dataset);
  const normalizedCohort = normalizeFrozenCohort(frozenCohort);
  if (!cleanText(sealedLabelsPath)) throw new Error("--sealed-labels is required for frozen cohort proof");
  const frozenProof = await assertFrozenCohortImpl({
    cohort: normalizedCohort,
    datasetPath,
    sealedLabelsPath,
    expectedSha256: TARGETED_ASSIST_PAIRED_COHORT_SHA256[normalizedCohort],
    expectedLabelsSha256: TARGETED_ASSIST_PAIRED_LABEL_SHA256[normalizedCohort],
    expectedPartition: TARGETED_ASSIST_PAIRED_PARTITION
  });
  if (cleanText(frozenProof?.evaluation_partition).toLowerCase() !== "development") {
    throw new Error("same-asset stability requires dataset-proven development membership");
  }
  const requestedItemId = cleanText(itemId);
  if (!requestedItemId) throw new Error("--item-id is required to predeclare one frozen Development asset");
  const selectedIndexes = items
    .map((item, index) => selectedItemId(item) === requestedItemId ? index : -1)
    .filter((index) => index >= 0);
  if (selectedIndexes.length !== 1) {
    throw new Error(`same-asset item must appear exactly once in the frozen cohort; received ${selectedIndexes.length}`);
  }
  const selectedIndex = selectedIndexes[0];
  const selectedItem = items[selectedIndex];
  if (plannedRuns !== sameAssetStabilityExecutionContract.planned_runs) {
    throw new Error(`planned runs are frozen at ${sameAssetStabilityExecutionContract.planned_runs}`);
  }
  if (!cleanText(verifiedAssetCachePath)) throw new Error("--verified-asset-cache is required to freeze one durable asset generation");
  const sealedBytes = await readFile(resolve(sealedLabelsPath));
  const fingerprint = await durableSourceFingerprint(selectedItem, selectedIndex);
  const cacheEntries = await readVerifiedAssetCache(verifiedAssetCachePath);
  if (cacheEntries.size === 0) throw new Error("same-asset canonical verified cache entry is missing");
  if (cacheEntries.size !== 1) {
    throw new Error(`same-asset verified cache must contain exactly one entry; received ${cacheEntries.size}`);
  }
  const assetCacheBytes = await readFile(resolve(verifiedAssetCachePath));
  const imageCount = (Array.isArray(selectedItem.images) ? selectedItem.images : []).slice(0, 2).length;
  const assetCacheProof = assertCanonicalAssetCacheEntry(cacheEntries.get(fingerprint), {
    fingerprint,
    imageCount
  });
  const executionId = crypto.randomUUID();
  return {
    ...sameAssetStabilityExecutionContract,
    generated_at: new Date().toISOString(),
    execution_id: executionId,
    execution_mode: "DRY_RUN",
    dataset_path: resolve(datasetPath),
    dataset_sha256: sha256(datasetBytes),
    sealed_labels_path: resolve(sealedLabelsPath),
    sealed_labels_sha256: sha256(sealedBytes),
    frozen_cohort: normalizedCohort,
    frozen_cohort_proof: frozenProof,
    selected_item_index: selectedIndex,
    selected_item_id: requestedItemId,
    selected_item_sha256: sha256(JSON.stringify(stableValue(selectedItem))),
    dataset_item_count: items.length,
    asset_cache_proof: assetCacheProof,
    base_url: candidateTarget.base_url,
    expected_git_sha: candidateTarget.expected_git_sha,
    expected_deployment_id: candidateTarget.expected_deployment_id,
    model,
    out_dir: resolve(outDir),
    evidence_dir: resolve(outDir, `same-asset-${executionId}`),
    runtime_dataset_snapshot_name: "frozen-development-dataset.json",
    runtime_asset_cache_snapshot_name: "frozen-canonical-asset-cache.json",
    verified_asset_cache_path: resolve(verifiedAssetCachePath),
    verified_asset_cache_sha256: sha256(assetCacheBytes),
    planned_job_runs: plannedRuns,
    provider_http_call_hard_budget: plannedRuns,
    safety_gate: {
      execute_flag_required: true,
      exact_confirmation_required: `--confirm-planned-runs ${plannedRuns}`,
      reusable_authenticated_session: true,
      cold_cache_bypass_asserted_per_run: true,
      prompt_and_ordered_image_fingerprints_required: true,
      runtime_policy_state_required_per_run: true,
      vector_worker_status_and_reason_frozen: true,
      ocr_critical_decision_and_wait_budgets_frozen: true,
      no_failed_run_replacement: true,
      server_owned_provider_retry_budget_enforced: true,
      note: "The cold-algorithm profile enforces one Provider HTTP request before the call; any retry path fails closed."
    }
  };
}

export async function executeSameAssetStabilityPlan(plan, {
  username = "",
  password = "",
  sessionCookieFile = "",
  requestTimeoutMs = 90_000,
  l2WaitMs = 90_000,
  progress = true,
  env = process.env,
  fetchImpl = globalThis.fetch,
  verifyPublicBindingImpl = verifySameAssetPublicReleaseBinding,
  verifyDeploymentImpl = verifySameAssetCandidateDeployment,
  revalidatePlanImpl = async (candidate) => buildSameAssetStabilityPlan({
    datasetPath: candidate.dataset_path,
    sealedLabelsPath: candidate.sealed_labels_path,
    baseUrl: candidate.base_url,
    model: candidate.model,
    outDir: candidate.out_dir,
    verifiedAssetCachePath: candidate.verified_asset_cache_path,
    plannedRuns: candidate.planned_runs,
    frozenCohort: candidate.frozen_cohort,
    itemId: candidate.selected_item_id,
    expectedGitSha: candidate.expected_git_sha,
    expectedDeploymentId: candidate.expected_deployment_id
  }),
  readSessionCookieImpl = readReusableSessionCookie,
  loginImpl = login,
  runSmokeImpl = runV4EbaySmoke
} = {}) {
  const revalidatedPlan = await revalidatePlanImpl(plan);
  for (const key of [
    "dataset_sha256",
    "sealed_labels_sha256",
    "selected_item_sha256",
    "selected_item_index",
    "verified_asset_cache_sha256",
    "expected_git_sha",
    "expected_deployment_id"
  ]) {
    if (revalidatedPlan[key] !== plan[key]) throw new Error(`same-asset plan drifted at ${key}`);
  }
  if (JSON.stringify(revalidatedPlan.asset_cache_proof) !== JSON.stringify(plan.asset_cache_proof)) {
    throw new Error("same-asset canonical asset cache changed after planning");
  }
  const persistedPlan = JSON.parse(await readFile(resolve(
    plan.evidence_dir,
    "same-asset-stability-plan.json"
  ), "utf8"));
  if (sameAssetStabilityPlanSha256(persistedPlan) !== sameAssetStabilityPlanSha256(plan)) {
    throw new Error("same-asset persisted execution plan does not match the authorized plan");
  }
  const existingEvidence = await readdir(plan.evidence_dir);
  const unexpectedEvidence = existingEvidence.filter((name) => name !== "same-asset-stability-plan.json");
  if (unexpectedEvidence.length) {
    throw new Error(`same-asset evidence directory is not fresh: ${unexpectedEvidence.join(",")}`);
  }
  const publicReleaseBinding = await verifyPublicBindingImpl({
    baseUrl: plan.base_url,
    expectedGitSha: plan.expected_git_sha,
    expectedDeploymentId: plan.expected_deployment_id,
    fetchImpl,
    requestTimeoutMs: Math.min(requestTimeoutMs, 30_000)
  });
  await writeFile(resolve(plan.evidence_dir, "same-asset-public-release-binding.json"), `${JSON.stringify(publicReleaseBinding, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o400
  });
  const deploymentPreflight = await verifyDeploymentImpl({
    baseUrl: plan.base_url,
    expectedGitSha: plan.expected_git_sha,
    expectedDeploymentId: plan.expected_deployment_id,
    env,
    fetchImpl,
    trustedPublicBinding: publicReleaseBinding,
    requestTimeoutMs: Math.min(requestTimeoutMs, 30_000)
  });
  await writeFile(resolve(plan.evidence_dir, "same-asset-deployment-preflight.json"), `${JSON.stringify(deploymentPreflight, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o400
  });
  const [datasetBytes, sealedLabelBytes, assetCacheBytes] = await Promise.all([
    readFile(plan.dataset_path),
    readFile(plan.sealed_labels_path),
    readFile(plan.verified_asset_cache_path)
  ]);
  if (sha256(datasetBytes) !== plan.dataset_sha256 || sha256(sealedLabelBytes) !== plan.sealed_labels_sha256) {
    throw new Error("same-asset frozen dataset or label bytes changed after authorization");
  }
  if (sha256(assetCacheBytes) !== plan.verified_asset_cache_sha256) {
    throw new Error("same-asset verified asset cache changed after authorization");
  }
  const runtimeDatasetPath = resolve(plan.evidence_dir, plan.runtime_dataset_snapshot_name);
  const runtimeAssetCachePath = resolve(plan.evidence_dir, plan.runtime_asset_cache_snapshot_name);
  await writeFile(runtimeDatasetPath, datasetBytes, { flag: "wx", mode: 0o400 });
  await writeFile(runtimeAssetCachePath, assetCacheBytes, { flag: "wx", mode: 0o400 });
  const reusableCookie = await readSessionCookieImpl(sessionCookieFile);
  const cookie = reusableCookie || await loginImpl({
    baseUrl: plan.base_url,
    username,
    password
  });
  const reports = [];
  for (let run = 1; run <= plan.planned_runs; run += 1) {
    const label = String(run).padStart(2, "0");
    const intentPath = resolve(plan.evidence_dir, `same-asset-run-${label}.intent.json`);
    const outPath = resolve(plan.evidence_dir, `same-asset-run-${label}.result.json`);
    await writeFile(intentPath, `${JSON.stringify({
      schema_version: "same-asset-stability-run-intent-v1",
      execution_id: plan.execution_id,
      plan_sha256: sameAssetStabilityPlanSha256(plan),
      runner_attempt: run,
      selected_item_id: plan.selected_item_id,
      asset_cache_proof: plan.asset_cache_proof,
      status: "SCHEDULED",
      created_at: new Date().toISOString()
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (progress) process.stderr.write(`same-asset stability run ${run}/${plan.planned_runs}\n`);
    try {
      const report = await runSmokeImpl({
        datasetPath: runtimeDatasetPath,
        sealedLabelsPath: "",
        baseUrl: plan.base_url,
        sessionCookie: cookie,
        limit: 1,
        offset: plan.selected_item_index,
        queueMode: true,
        speculative: true,
        // N30 isolates Provider nondeterminism. Re-enqueuing OCR here would
        // add unbudgeted paid work and let later runs observe evidence created
        // by earlier runs, so the frozen canonical images are the only sensor
        // input admitted by this experiment.
        usePreingestion: false,
        modelOverride: plan.model,
        benchmarkProfile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
        evaluationSampleMode: "PAIRED_ABLATION",
        ultraFastImageDetail: "high",
        concurrency: 1,
        submissionConcurrency: 1,
        preparationConcurrency: 1,
        requestTimeoutMs,
        l2WaitMs,
        thinkMs: 0,
        batchId: `same-asset-${Date.now()}-${label}`,
        verifiedAssetCachePath: runtimeAssetCachePath,
        verifiedAssetCacheMode: "reuse",
        verifiedAssetCacheReadOnly: true,
        outPath: "",
        progress
      });
      if (!Array.isArray(report?.results) || report.results.length !== 1) {
        throw new Error(`same_asset_runner_expected_one_result_received_${report?.results?.length ?? "missing"}`);
      }
      if (sha256(await readFile(runtimeAssetCachePath)) !== plan.verified_asset_cache_sha256) {
        throw new Error("same-asset immutable runtime asset cache changed during execution");
      }
      report.results[0] = bindResultToExecutionPlan(report.results[0], plan, run, deploymentPreflight);
      await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      reports.push(report);
      const prefixAnalysis = analyzeSameAssetStability(reports, {
        plan,
        expectedRuns: SAME_ASSET_STABILITY_EXPECTED_RUNS
      });
      if (prefixAnalysis.validity.status === "INVALID") break;
    } catch (error) {
      const failed = {
        schema_version: "v4-ebay-smoke-v1",
        generated_at: new Date().toISOString(),
        results: [bindResultToExecutionPlan({
          runner_attempt: run,
          ok: false,
          writer_ready: false,
          l2_ready: false,
          error: cleanText(error?.message || error || "same_asset_runner_failed").slice(0, 500)
        }, plan, run, deploymentPreflight)]
      };
      await writeFile(outPath, `${JSON.stringify(failed, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      reports.push(failed);
      break;
    }
  }
  let deploymentPostflight = null;
  let deploymentPostflightError = null;
  try {
    deploymentPostflight = await verifyDeploymentImpl({
      baseUrl: plan.base_url,
      expectedGitSha: plan.expected_git_sha,
      expectedDeploymentId: plan.expected_deployment_id,
      env,
      fetchImpl,
      trustedPublicBinding: publicReleaseBinding,
      requestTimeoutMs: Math.min(requestTimeoutMs, 30_000)
    });
    await writeFile(resolve(plan.evidence_dir, "same-asset-deployment-postflight.json"), `${JSON.stringify(deploymentPostflight, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o400
    });
  } catch (error) {
    deploymentPostflightError = cleanText(error?.message || error || "same_asset_deployment_postflight_failed").slice(0, 500);
    await writeFile(resolve(plan.evidence_dir, "same-asset-deployment-postflight.json"), `${JSON.stringify({
      schema_version: "same-asset-candidate-deployment-proof-v1",
      verified_at: new Date().toISOString(),
      status: "FAILED",
      error: deploymentPostflightError
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o400 });
  }
  const analysis = analyzeSameAssetStability(reports, { plan, expectedRuns: plan.planned_runs });
  analysis.deployment_proof = { preflight: deploymentPreflight, postflight: deploymentPostflight };
  if (deploymentPostflightError) {
    analysis.validity.status = "INVALID";
    analysis.validity.errors.push({
      code: "DEPLOYMENT_POSTFLIGHT_FAILED",
      run_index: null,
      details: { error: deploymentPostflightError }
    });
  }
  const analysisPath = resolve(plan.evidence_dir, "same-asset-stability-analysis.json");
  await writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { reports, analysis, analysis_path: analysisPath };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const datasetPath = argValue(argv, "--dataset", "");
  if (!datasetPath) throw new Error("--dataset is required");
  const plannedRuns = Math.max(1, Math.trunc(Number(argValue(argv, "--runs", "30")) || 30));
  const outDir = argValue(argv, "--out-dir", "artifacts/same-asset-stability");
  const plan = await buildSameAssetStabilityPlan({
    datasetPath,
    sealedLabelsPath: argValue(argv, "--sealed-labels", ""),
    baseUrl: argValue(argv, "--base-url", "https://listing.lyncafei.team"),
    model: argValue(argv, "--model", "gpt-5-mini"),
    outDir,
    verifiedAssetCachePath: argValue(argv, "--verified-asset-cache", ""),
    plannedRuns,
    frozenCohort: argValue(argv, "--frozen-cohort", ""),
    itemId: argValue(argv, "--item-id", ""),
    expectedGitSha: argValue(argv, "--expected-git-sha", ""),
    expectedDeploymentId: argValue(argv, "--expected-deployment-id", "")
  });
  const execute = hasFlag(argv, "--execute");
  if (execute) {
    const confirmed = Number(argValue(argv, "--confirm-planned-runs", "0"));
    if (confirmed !== plan.planned_job_runs) {
      throw new Error(`execution requires --confirm-planned-runs ${plan.planned_job_runs}`);
    }
  }
  const effectivePlan = execute
    ? { ...plan, execution_mode: "EXECUTE_AUTHORIZED", execution_authorized_at: new Date().toISOString() }
    : plan;
  await mkdir(plan.out_dir, { recursive: true });
  await mkdir(plan.evidence_dir);
  const planPath = resolve(plan.evidence_dir, "same-asset-stability-plan.json");
  await writeFile(planPath, `${JSON.stringify(effectivePlan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  if (!execute) {
    process.stdout.write(`${JSON.stringify({ ...effectivePlan, plan_path: planPath }, null, 2)}\n`);
    return 0;
  }
  const outcome = await executeSameAssetStabilityPlan(effectivePlan, {
    username: cleanText(argValue(argv, "--username", env.METAVERSE_USERNAME || "")),
    password: cleanText(argValue(argv, "--password", env.METAVERSE_PASSWORD || "")),
    sessionCookieFile: argValue(argv, "--session-cookie-file", ""),
    requestTimeoutMs: Math.max(10_000, Number(argValue(argv, "--request-timeout-ms", "90000")) || 90_000),
    l2WaitMs: Math.max(18_000, Number(argValue(argv, "--l2-wait-ms", "90000")) || 90_000)
  });
  process.stdout.write(`${JSON.stringify({
    status: outcome.analysis.validity.status,
    analysis_path: outcome.analysis_path,
    plan_path: planPath,
    report_count: outcome.reports.length,
    asset_cache: basename(plan.verified_asset_cache_path)
  }, null, 2)}\n`);
  return outcome.analysis.validity.status === "VALID" ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
