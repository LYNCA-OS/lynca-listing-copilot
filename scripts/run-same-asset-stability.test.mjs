#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deploymentProtectionHeaders,
  durableSourceFingerprint,
  writeVerifiedAssetCache
} from "./v4-ebay-smoke.mjs";
import {
  buildSameAssetStabilityPlan,
  executeSameAssetStabilityPlan,
  sameAssetCandidateProtectionHeaders,
  sameAssetStabilityExecutionContract,
  verifySameAssetCandidateDeployment,
  verifySameAssetPublicReleaseBinding
} from "./run-same-asset-stability.mjs";

const sha = (character) => character.repeat(64);
const items = Array.from({ length: 10 }, (_, index) => ({
  id: `development-card-${index + 1}`,
  source_feedback_id: `development-card-${index + 1}`,
  images: [{
    image_id: `image-${index + 1}`,
    bucket: "frozen-source",
    object_path: `development/card-${index + 1}.jpg`,
    role: "front_original",
    width: 640,
    height: 960
  }]
}));

const frozenProof = Object.freeze({
  cohort: "FAMILIAR",
  item_count: 10,
  selected_item_ids_sha256: sha("a"),
  sealed_labels_sha256: sha("b"),
  evaluation_partition: "development"
});
const assertFrozenCohortImpl = async () => frozenProof;

const directory = await mkdtemp(join(tmpdir(), "lynca-same-asset-plan-"));
try {
  const datasetPath = join(directory, "development-ten.json");
  const labelsPath = join(directory, "labels.jsonl");
  const cachePath = join(directory, "verified-assets.json");
  await writeFile(datasetPath, `${JSON.stringify({
    evaluation_partition: "development",
    data_policy: { threshold_tuning_eligible: true, frozen_holdout: false },
    evaluation_sample_policy: {
      mode: "PAIRED_ABLATION",
      sample_reuse_permitted: true,
      same_sample_required: true,
      reuse_policy_complete: true,
      reuse_reason: "same asset repeatability",
      reuse_scope_id: "same-asset-n30"
    },
    items
  })}\n`);
  await writeFile(labelsPath, "");
  const selectedIndex = 3;
  const fingerprint = await durableSourceFingerprint(items[selectedIndex], selectedIndex);
  await writeVerifiedAssetCache(cachePath, new Map([[fingerprint, {
    fingerprint,
    source_asset_id: items[selectedIndex].id,
    source_feedback_id: items[selectedIndex].source_feedback_id,
    asset_id: "asset-canonical-1",
    tenant_id: "tenant-evaluation",
    image_generation_id: "asset-canonical-1",
    image_count: 1,
    canonical_image_set_sha256: sha("c"),
    canonical_primary_content_sha256: [sha("d")],
    canonical_verified_at: "2026-07-29T00:00:00.000Z"
  }]]));

  const baseArguments = {
    datasetPath,
    sealedLabelsPath: labelsPath,
    baseUrl: "https://candidate-fixed.vercel.app",
    expectedGitSha: "e".repeat(40),
    expectedDeploymentId: "dpl_FixedCandidate123",
    outDir: join(directory, "out"),
    verifiedAssetCachePath: cachePath,
    frozenCohort: "FAMILIAR",
    itemId: items[selectedIndex].source_feedback_id,
    assertFrozenCohortImpl
  };
  const plan = await buildSameAssetStabilityPlan(baseArguments);
  assert.equal(plan.schema_version, "same-asset-stability-execution-plan-v1");
  assert.equal(plan.execution_mode, "DRY_RUN");
  assert.equal(plan.planned_runs, 30);
  assert.equal(plan.planned_job_runs, 30);
  assert.equal(plan.provider_http_call_hard_budget, 30);
  assert.equal(plan.scheduling, "SEQUENTIAL_SINGLE_FLIGHT");
  assert.equal(plan.session_login_count, 1);
  assert.equal(plan.base_url, "https://candidate-fixed.vercel.app");
  assert.equal(plan.expected_git_sha, "e".repeat(40));
  assert.equal(plan.expected_deployment_id, "dpl_FixedCandidate123");
  assert.match(plan.verified_asset_cache_sha256, /^[0-9a-f]{64}$/);
  assert.equal(plan.safety_gate.no_failed_run_replacement, true);
  assert.equal(plan.safety_gate.server_owned_provider_retry_budget_enforced, true);
  assert.equal(plan.safety_gate.runtime_policy_state_required_per_run, true);
  assert.equal(plan.safety_gate.vector_worker_status_and_reason_frozen, true);
  assert.equal(plan.safety_gate.ocr_critical_decision_and_wait_budgets_frozen, true);
  assert.equal(plan.provider_concurrency_change, "NONE");
  assert.equal(plan.frozen_cohort, "FAMILIAR");
  assert.equal(plan.frozen_cohort_proof.evaluation_partition, "development");
  assert.equal(plan.selected_item_index, selectedIndex);
  assert.equal(plan.selected_item_id, items[selectedIndex].source_feedback_id);
  assert.equal(plan.asset_cache_proof.canonical_image_set_sha256, sha("c"));
  assert.equal(sameAssetStabilityExecutionContract.default_execution_mode, "DRY_RUN");

  await assert.rejects(buildSameAssetStabilityPlan({
    ...baseArguments,
    plannedRuns: 29
  }), /frozen at 30/);

  await assert.rejects(buildSameAssetStabilityPlan({
    ...baseArguments,
    frozenCohort: "HOLDOUT"
  }), /FAMILIAR or UNSEEN/);

  await assert.rejects(buildSameAssetStabilityPlan({
    ...baseArguments,
    itemId: "not-a-member"
  }), /appear exactly once/);

  await assert.rejects(buildSameAssetStabilityPlan({
    ...baseArguments,
    assertFrozenCohortImpl: async () => ({ ...frozenProof, evaluation_partition: "holdout" })
  }), /dataset-proven development membership/);

  await assert.rejects(buildSameAssetStabilityPlan({
    ...baseArguments,
    verifiedAssetCachePath: join(directory, "missing-cache.json")
  }), /canonical verified cache entry is missing/);

  await assert.rejects(buildSameAssetStabilityPlan({
    ...baseArguments,
    baseUrl: "https://listing.lyncafei.team"
  }), /immutable \*\.vercel\.app candidate URL/);

  for (const unsafeBaseUrl of [
    "https://candidate-fixed.vercel.app/path",
    "https://candidate-fixed.vercel.app?next=other",
    "https://candidate-fixed.vercel.app#fragment",
    "https://user@candidate-fixed.vercel.app",
    "https://candidate-fixed.vercel.app:444"
  ]) {
    await assert.rejects(buildSameAssetStabilityPlan({
      ...baseArguments,
      baseUrl: unsafeBaseUrl
    }), /bare immutable deployment origin/);
  }

  const candidateTarget = {
    base_url: baseArguments.baseUrl,
    expected_git_sha: baseArguments.expectedGitSha,
    expected_deployment_id: baseArguments.expectedDeploymentId
  };
  const trustedPublicBinding = await verifySameAssetPublicReleaseBinding({
    baseUrl: baseArguments.baseUrl,
    expectedGitSha: baseArguments.expectedGitSha,
    expectedDeploymentId: baseArguments.expectedDeploymentId,
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://listing.lyncafei.team/api/v4/health");
      assert.equal(init.headers, undefined);
      assert.equal(init.redirect, "error");
      return {
        ok: true,
        async json() {
          return {
            ready: true,
            deployment: {
              git_commit_sha: baseArguments.expectedGitSha,
              deployment_id: baseArguments.expectedDeploymentId,
              deployment_url: "candidate-fixed.vercel.app"
            }
          };
        }
      };
    }
  });
  assert.deepEqual(sameAssetCandidateProtectionHeaders({
    target: candidateTarget,
    requestUrl: `${baseArguments.baseUrl}/api/v4/health`,
    trustedPublicBinding,
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" }
  }), { "x-vercel-protection-bypass": "temporary-bypass" });
  assert.throws(() => sameAssetCandidateProtectionHeaders({
    target: candidateTarget,
    requestUrl: "https://storage.example.test/object",
    trustedPublicBinding,
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" }
  }), /scoped to the immutable candidate origin/);
  assert.throws(() => sameAssetCandidateProtectionHeaders({
    target: candidateTarget,
    requestUrl: `${baseArguments.baseUrl}/api/v4/health`,
    trustedPublicBinding,
    env: {}
  }), /protection bypass is missing/);
  assert.throws(() => sameAssetCandidateProtectionHeaders({
    target: candidateTarget,
    requestUrl: `${baseArguments.baseUrl}/api/v4/health`,
    trustedPublicBinding: { ...trustedPublicBinding, observed_deployment_id: "dpl_Other" },
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" }
  }), /not bound by the trusted public release proof/);
  assert.deepEqual(deploymentProtectionHeaders({
    baseUrl: baseArguments.baseUrl,
    requestUrl: `${baseArguments.baseUrl}/api/login`,
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" }
  }), { "x-vercel-protection-bypass": "temporary-bypass" });
  assert.throws(() => deploymentProtectionHeaders({
    baseUrl: baseArguments.baseUrl,
    requestUrl: "https://storage.example.test/object",
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" }
  }), /cannot leave the configured application origin/);

  const deploymentProof = await verifySameAssetCandidateDeployment({
    baseUrl: baseArguments.baseUrl,
    expectedGitSha: baseArguments.expectedGitSha,
    expectedDeploymentId: baseArguments.expectedDeploymentId,
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" },
    trustedPublicBinding,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers["x-vercel-protection-bypass"], "temporary-bypass");
      return {
        ok: true,
        async json() {
          return {
            ready: true,
            deployment: {
              git_commit_sha: baseArguments.expectedGitSha,
              deployment_id: baseArguments.expectedDeploymentId,
              deployment_url: "candidate-fixed.vercel.app"
            }
          };
        }
      };
    }
  });
  assert.equal(deploymentProof.observed_git_sha, baseArguments.expectedGitSha);
  assert.equal(deploymentProof.observed_deployment_id, baseArguments.expectedDeploymentId);
  assert.equal(deploymentProof.observed_deployment_url, "candidate-fixed.vercel.app");
  let missingBypassFetchCalls = 0;
  await assert.rejects(verifySameAssetCandidateDeployment({
    baseUrl: baseArguments.baseUrl,
    expectedGitSha: baseArguments.expectedGitSha,
    expectedDeploymentId: baseArguments.expectedDeploymentId,
    env: {},
    trustedPublicBinding,
    fetchImpl: async () => {
      missingBypassFetchCalls += 1;
      throw new Error("fetch must not run without the project bypass");
    }
  }), /protection bypass is missing/);
  assert.equal(missingBypassFetchCalls, 0);
  await assert.rejects(verifySameAssetCandidateDeployment({
    baseUrl: baseArguments.baseUrl,
    expectedGitSha: baseArguments.expectedGitSha,
    expectedDeploymentId: baseArguments.expectedDeploymentId,
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" },
    trustedPublicBinding,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ready: false,
          deployment: {
            git_commit_sha: baseArguments.expectedGitSha,
            deployment_id: baseArguments.expectedDeploymentId,
            deployment_url: "candidate-fixed.vercel.app"
          }
        };
      }
    })
  }), /health is not ready/);
  await assert.rejects(verifySameAssetCandidateDeployment({
    baseUrl: baseArguments.baseUrl,
    expectedGitSha: baseArguments.expectedGitSha,
    expectedDeploymentId: baseArguments.expectedDeploymentId,
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" },
    trustedPublicBinding,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ready: true,
          deployment: {
            git_commit_sha: baseArguments.expectedGitSha,
            deployment_id: "dpl_DifferentCandidate",
            deployment_url: "candidate-fixed.vercel.app"
          }
        };
      }
    })
  }), /deployment mismatch/);
  await assert.rejects(verifySameAssetCandidateDeployment({
    baseUrl: baseArguments.baseUrl,
    expectedGitSha: baseArguments.expectedGitSha,
    expectedDeploymentId: baseArguments.expectedDeploymentId,
    env: { VERCEL_AUTOMATION_BYPASS_SECRET: "temporary-bypass" },
    trustedPublicBinding,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ready: true,
          deployment: {
            git_commit_sha: baseArguments.expectedGitSha,
            deployment_id: baseArguments.expectedDeploymentId,
            deployment_url: "moving-alias.vercel.app"
          }
        };
      }
    })
  }), /URL is not the deployment URL/);

  const nativeCoreSource = await readFile(new URL(
    "../lib/listing/v4/pipeline/native-recognition-core.mjs",
    import.meta.url
  ), "utf8");
  assert.match(nativeCoreSource, /identityCacheRuntimeEnabled \|\| evaluationCatalogEvidenceRequired/);
  assert.match(nativeCoreSource, /runtimeOptions\.trace_level === "evaluation"/);

  const failFastEvidenceDir = join(directory, "fail-fast-evidence");
  await mkdir(failFastEvidenceDir);
  let smokeCalls = 0;
  let deploymentChecks = 0;
  let smokeOptions = null;
  const failFastPlan = {
    ...plan,
    execution_id: "fail-fast-test",
    execution_mode: "EXECUTE_AUTHORIZED",
    evidence_dir: failFastEvidenceDir,
    runtime_dataset_snapshot_name: "frozen-development-dataset.json",
    runtime_asset_cache_snapshot_name: "frozen-canonical-asset-cache.json"
  };
  await writeFile(
    join(failFastEvidenceDir, "same-asset-stability-plan.json"),
    `${JSON.stringify(failFastPlan, null, 2)}\n`,
    { flag: "wx" }
  );
  const failFast = await executeSameAssetStabilityPlan(failFastPlan, {
    progress: false,
    revalidatePlanImpl: async () => failFastPlan,
    verifyPublicBindingImpl: async () => trustedPublicBinding,
    verifyDeploymentImpl: async () => {
      deploymentChecks += 1;
      return {
        schema_version: "same-asset-candidate-deployment-proof-v1",
        observed_git_sha: failFastPlan.expected_git_sha,
        observed_deployment_id: failFastPlan.expected_deployment_id,
        observed_deployment_url: "candidate-fixed.vercel.app"
      };
    },
    readSessionCookieImpl: async () => "session=test",
    loginImpl: async () => { throw new Error("reusable cookie must suppress login"); },
    runSmokeImpl: async (options) => {
      smokeCalls += 1;
      smokeOptions = options;
      return { schema_version: "v4-ebay-smoke-v1", results: [{}] };
    }
  });
  assert.equal(smokeCalls, 1);
  assert.equal(deploymentChecks, 2);
  assert.equal(smokeOptions.verifiedAssetCacheMode, "reuse");
  assert.equal(smokeOptions.verifiedAssetCacheReadOnly, true);
  assert.equal(smokeOptions.usePreingestion, false);
  assert.deepEqual(
    await readFile(join(failFastEvidenceDir, failFastPlan.runtime_asset_cache_snapshot_name)),
    await readFile(cachePath)
  );
  assert.equal(failFast.reports.length, 1);
  assert.equal(failFast.analysis.validity.status, "INVALID");
  assert.equal(
    failFast.reports[0].results[0].same_asset_runtime_policy_state.schema_version,
    "same-asset-runtime-policy-state-v1"
  );
  assert.equal(failFast.reports[0].results[0].same_asset_runtime_policy_state.status, "PARTIAL");

  const postflightEvidenceDir = join(directory, "postflight-drift-evidence");
  await mkdir(postflightEvidenceDir);
  const postflightPlan = {
    ...failFastPlan,
    execution_id: "postflight-drift-test",
    evidence_dir: postflightEvidenceDir
  };
  await writeFile(
    join(postflightEvidenceDir, "same-asset-stability-plan.json"),
    `${JSON.stringify(postflightPlan, null, 2)}\n`,
    { flag: "wx" }
  );
  let postflightChecks = 0;
  const postflightDrift = await executeSameAssetStabilityPlan(postflightPlan, {
    progress: false,
    revalidatePlanImpl: async () => postflightPlan,
    verifyPublicBindingImpl: async () => trustedPublicBinding,
    verifyDeploymentImpl: async () => {
      postflightChecks += 1;
      if (postflightChecks === 2) throw new Error("same-asset candidate deployment mismatch");
      return {
        observed_git_sha: postflightPlan.expected_git_sha,
        observed_deployment_id: postflightPlan.expected_deployment_id,
        observed_deployment_url: "candidate-fixed.vercel.app"
      };
    },
    readSessionCookieImpl: async () => "session=test",
    loginImpl: async () => { throw new Error("reusable cookie must suppress login"); },
    runSmokeImpl: async () => ({ results: [{}] })
  });
  assert.equal(postflightDrift.analysis.validity.status, "INVALID");
  assert.ok(postflightDrift.analysis.validity.errors.some((error) => error.code === "DEPLOYMENT_POSTFLIGHT_FAILED"));

  await assert.rejects(executeSameAssetStabilityPlan(failFastPlan, {
    progress: false,
    revalidatePlanImpl: async () => failFastPlan,
    verifyPublicBindingImpl: async () => trustedPublicBinding,
    verifyDeploymentImpl: async () => ({
      observed_git_sha: failFastPlan.expected_git_sha,
      observed_deployment_id: failFastPlan.expected_deployment_id,
      observed_deployment_url: "candidate-fixed.vercel.app"
    }),
    readSessionCookieImpl: async () => "session=test",
    runSmokeImpl: async () => {
      smokeCalls += 1;
      return { results: [{}] };
    }
  }), /evidence directory is not fresh/);
  assert.equal(smokeCalls, 1);

  const workflow = await readFile(new URL("../.github/workflows/same-asset-n30.yml", import.meta.url), "utf8");
  assert.match(workflow, /expected_git_sha:/);
  assert.match(workflow, /expected_deployment_id:/);
  assert.match(workflow, /candidate_base_url:/);
  assert.doesNotMatch(workflow, /VERCEL_TOKEN|npm install --global vercel|acquireProtectionBypass/);
  assert.match(workflow, /VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.VERCEL_AUTOMATION_BYPASS_SECRET \}\}/);
  assert.equal(
    (workflow.match(/VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.VERCEL_AUTOMATION_BYPASS_SECRET \}\}/g) || []).length,
    4,
    "the bypass must be scoped to protected preflight, two session proofs, and N30 execution only"
  );
  assert.match(workflow, /test -n "\$VERCEL_AUTOMATION_BYPASS_SECRET"/);
  assert.match(workflow, /N30_CANDIDATE_BASE_URL: \$\{\{ needs\.bind-public-release\.outputs\.candidate_base_url \}\}/);
  assert.match(workflow, /N30_CANDIDATE_HOST: \$\{\{ needs\.bind-public-release\.outputs\.candidate_host \}\}/);
  assert.doesNotMatch(workflow, /"\$CANDIDATE_BASE_URL|process\.env\.CANDIDATE_BASE_URL/);
  assert.match(workflow, /\.ready == true and \.deployment\.git_commit_sha == \$sha/);
  assert.match(workflow, /\.deployment\.deployment_url == \$host/);
  assert.match(workflow, /--session-cookie-file \/tmp\/same-asset-session-cookie\.txt/);
  const publicBindingIndex = workflow.indexOf("Validate inputs and bind the public production release without credentials");
  const contractTestIndex = workflow.indexOf("Prove the N30 contract without production credentials");
  const preflightJobIndex = workflow.indexOf("  preflight:\n");
  const deploymentPreflightIndex = workflow.indexOf("Verify immutable candidate SHA and deployment before any paid call");
  const assetFreezeIndex = workflow.indexOf("Freeze exactly one predeclared familiar Development asset");
  const preflightSessionProofIndex = workflow.indexOf("Prove the production session before consuming authorization");
  const preflightPacketIndex = workflow.indexOf("Upload the zero-paid preflight packet");
  const consumptionIndex = workflow.indexOf("Consume this exact production SHA only after the paid-ready handshake");
  const n30JobIndex = workflow.indexOf("  n30:\n");
  const sessionProofIndex = workflow.indexOf("Reauthenticate immediately before the authorized paid run");
  const paidReadyIndex = workflow.indexOf("Expose only the non-secret paid-ready handshake");
  const credentialGateIndex = workflow.indexOf("Wait for and verify the late-bound exact-SHA authorization");
  const executionIndex = workflow.indexOf("Run the predeclared sequential N30");
  assert.ok(publicBindingIndex >= 0 && publicBindingIndex < contractTestIndex);
  assert.ok(contractTestIndex < preflightJobIndex);
  assert.ok(preflightJobIndex < deploymentPreflightIndex);
  assert.ok(deploymentPreflightIndex < assetFreezeIndex);
  assert.ok(assetFreezeIndex < preflightSessionProofIndex);
  assert.ok(preflightSessionProofIndex < preflightPacketIndex);
  assert.ok(preflightPacketIndex < consumptionIndex);
  assert.ok(consumptionIndex < n30JobIndex);
  assert.ok(n30JobIndex < sessionProofIndex);
  assert.ok(workflow.indexOf("VERCEL_AUTOMATION_BYPASS_SECRET", n30JobIndex) > n30JobIndex);
  assert.ok(sessionProofIndex < paidReadyIndex);
  assert.ok(paidReadyIndex < credentialGateIndex);
  assert.ok(sessionProofIndex < executionIndex);
  assert.ok(credentialGateIndex < executionIndex);
  assert.match(workflow, /readReusableSessionCookie\('\/tmp\/same-asset-session-cookie\.txt'\)/);
  assert.match(workflow, /session\?\.authenticated !== true/);
  assert.match(workflow, /zero_enqueue_ocr_or_provider_calls: true/);
  assert.match(workflow, /--confirm-planned-runs 30/);
  assert.match(workflow, /provider-output-contract-paired20-evidence/);
  assert.match(workflow, /https:\/\/listing\.lyncafei\.team\/api\/v4\/health/);
  assert.match(workflow, /same-asset-public-release-binding\.json/);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("same asset stability runner plan tests passed");
