#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  durableSourceFingerprint,
  writeVerifiedAssetCache
} from "./v4-ebay-smoke.mjs";
import {
  buildSameAssetStabilityPlan,
  executeSameAssetStabilityPlan,
  sameAssetStabilityExecutionContract
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
    baseUrl: "https://listing.example.test",
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
  assert.equal(plan.provider_http_call_hard_budget, null);
  assert.equal(plan.scheduling, "SEQUENTIAL_SINGLE_FLIGHT");
  assert.equal(plan.session_login_count, 1);
  assert.equal(plan.base_url, "https://listing.example.test");
  assert.equal(plan.safety_gate.no_failed_run_replacement, true);
  assert.equal(plan.safety_gate.server_owned_provider_retry_budget_enforced, false);
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

  const nativeCoreSource = await readFile(new URL(
    "../lib/listing/v4/pipeline/native-recognition-core.mjs",
    import.meta.url
  ), "utf8");
  assert.match(nativeCoreSource, /identityCacheRuntimeEnabled \|\| evaluationCatalogEvidenceRequired/);
  assert.match(nativeCoreSource, /runtimeOptions\.trace_level === "evaluation"/);

  const failFastEvidenceDir = join(directory, "fail-fast-evidence");
  await mkdir(failFastEvidenceDir);
  let smokeCalls = 0;
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
    readSessionCookieImpl: async () => "session=test",
    runSmokeImpl: async () => {
      smokeCalls += 1;
      return { schema_version: "v4-ebay-smoke-v1", results: [{}] };
    }
  });
  assert.equal(smokeCalls, 1);
  assert.equal(failFast.reports.length, 1);
  assert.equal(failFast.analysis.validity.status, "INVALID");
  await assert.rejects(executeSameAssetStabilityPlan(failFastPlan, {
    progress: false,
    revalidatePlanImpl: async () => failFastPlan,
    readSessionCookieImpl: async () => "session=test",
    runSmokeImpl: async () => {
      smokeCalls += 1;
      return { results: [{}] };
    }
  }), /evidence directory is not fresh/);
  assert.equal(smokeCalls, 1);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("same asset stability runner plan tests passed");
