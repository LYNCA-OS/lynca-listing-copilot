import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TARGETED_ASSIST_PAIRED_COHORT_SHA256,
  TARGETED_ASSIST_PAIRED_LABEL_SHA256,
  TARGETED_ASSIST_PAIRED_PARTITION,
  TARGETED_ASSIST_PAIRED_COHORT_SIZE,
  TARGETED_ASSIST_FIXED20_READY_DECISION,
  assertTargetedAssistPairPreparation,
  assertTargetedAssistPairedArmDeployment,
  assertTargetedAssistPairedArmPreparation,
  assertTargetedAssistPairedCohortSize,
  pairedArmOrder,
  targetedAssistPairedGateExitCode,
  targetedPairedSmokeArgs
} from "./run-targeted-assist-paired-eval.mjs";
import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";

assert.deepEqual(pairedArmOrder(0), ["baseline", "candidate"]);
assert.deepEqual(pairedArmOrder(1), ["candidate", "baseline"]);
assert.equal(TARGETED_ASSIST_PAIRED_COHORT_SIZE, 10);
assert.equal(
  TARGETED_ASSIST_PAIRED_COHORT_SHA256.FAMILIAR,
  "e280a121c50060918fbc0ea3ba27f755d3c8421f2db66a49cdeccb467253fefe"
);
assert.equal(TARGETED_ASSIST_PAIRED_LABEL_SHA256.FAMILIAR, "21b094c004a1f25ef5c15a6c62720c8f33a04ec472d91e00d63d797fb2db3599");
assert.equal(TARGETED_ASSIST_PAIRED_LABEL_SHA256.UNSEEN, "b105810bc7dc94bfddb2469d54edb51cc9a4dce7d2f58f8b4a8bfef80d3cb74f");
assert.equal(TARGETED_ASSIST_PAIRED_PARTITION, "development");
assert.equal(TARGETED_ASSIST_FIXED20_READY_DECISION, "READY_FOR_ONE_FIXED20");
assert.equal(targetedAssistPairedGateExitCode({ decision: TARGETED_ASSIST_FIXED20_READY_DECISION }), 0);
assert.equal(targetedAssistPairedGateExitCode({ decision: "NO_GO" }), 2);
assert.equal(
  TARGETED_ASSIST_PAIRED_COHORT_SHA256.UNSEEN,
  "6f27384f23163f6e40c544271ff01575272fcd4b9c42080408bc866e652b6300"
);
assert.equal(assertTargetedAssistPairedCohortSize(10), 10);
assert.throws(() => assertTargetedAssistPairedCohortSize(9), /expected_10_received_9/);
assert.throws(() => assertTargetedAssistPairedCohortSize(11), /expected_10_received_11/);

const baseline = targetedPairedSmokeArgs({
  baseUrl: "https://baseline.test",
  dataset: "familiar.json",
  sealedLabels: "familiar-labels.jsonl",
  outPath: "baseline.json",
  offset: 3,
  arm: "baseline",
  verifiedAssetCachePath: "verified-assets.json"
});
assert.ok(baseline.includes(recognitionBenchmarkProfileIds.COLD_ALGORITHM));
assert.ok(baseline.includes("PAIRED_ABLATION"));
assert.equal(baseline[baseline.indexOf("--offset") + 1], "3");
assert.equal(baseline[baseline.indexOf("--limit") + 1], "1");
assert.ok(baseline.includes("--read-only-provider-contract"));
assert.equal(baseline.includes("--world-knowledge-proposals"), false);

const candidate = targetedPairedSmokeArgs({
  baseUrl: "https://candidate.test",
  dataset: "unseen.json",
  sealedLabels: "unseen-labels.jsonl",
  outPath: "candidate.json",
  offset: 4,
  arm: "candidate",
  verifiedAssetCachePath: "verified-assets.json"
});
assert.ok(candidate.includes(recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST));
assert.equal(candidate[candidate.indexOf("--verified-asset-cache-mode") + 1], "reuse");
assert.equal(candidate[candidate.indexOf("--concurrency") + 1], "1");

const preparedArm = {
  preparation_diagnostics: {
    asset_cache_hit: true,
    upload_skipped_due_to_verified_asset_cache: true
  }
};
const exactDeploymentArm = {
  evaluation_decision_trace_packet: { deployment_git_sha: "d".repeat(40) }
};
assert.equal(assertTargetedAssistPairedArmDeployment(exactDeploymentArm, {
  expectedGitSha: "d".repeat(40),
  cohort: "FAMILIAR",
  index: 0,
  arm: "baseline"
}), "d".repeat(40));
assert.throws(() => assertTargetedAssistPairedArmDeployment(exactDeploymentArm, {
  expectedGitSha: "e".repeat(40),
  cohort: "UNSEEN",
  index: 9,
  arm: "candidate"
}), /deployment_git_sha_mismatch:UNSEEN:10:candidate/);
assert.deepEqual(
  assertTargetedAssistPairedArmPreparation(preparedArm, { cohort: "FAMILIAR", index: 0, arm: "baseline" }),
  { asset_cache_hit: true, upload_skipped_due_to_verified_asset_cache: true }
);
assert.deepEqual(
  assertTargetedAssistPairPreparation({ baseline: preparedArm, candidate: preparedArm }, {
    cohort: "UNSEEN",
    index: 9
  }),
  {
    baseline: { asset_cache_hit: true, upload_skipped_due_to_verified_asset_cache: true },
    candidate: { asset_cache_hit: true, upload_skipped_due_to_verified_asset_cache: true }
  }
);
assert.throws(() => assertTargetedAssistPairedArmPreparation({
  preparation_diagnostics: {
    asset_cache_hit: false,
    upload_skipped_due_to_verified_asset_cache: true
  }
}, { cohort: "FAMILIAR", index: 3, arm: "candidate" }), /targeted_paired_asset_cache_miss:FAMILIAR:4:candidate/);
assert.throws(() => assertTargetedAssistPairPreparation({
  baseline: preparedArm,
  candidate: {
    preparation_diagnostics: {
      asset_cache_hit: true,
      upload_skipped_due_to_verified_asset_cache: false
    }
  }
}, { cohort: "UNSEEN", index: 2 }), /targeted_paired_upload_not_skipped:UNSEEN:3:candidate/);

const workflow = await readFile(
  new URL("../.github/workflows/targeted-assist-paired20.yml", import.meta.url),
  "utf8"
);
assert.doesNotMatch(workflow, /^\s+limit_per_cohort:/m, "paired20 must not expose a variable cohort-size input");
assert.match(workflow, /--limit-per-cohort 10/);
assert.equal((workflow.match(/--limit 10/g) || []).length, 2, "both cohort builders must be fixed at ten");
assert.match(workflow, /world-knowledge-paired20-v1/);
assert.match(workflow, /FAMILIAR_ITEM_SET_SHA256: e280a121c50060918fbc0ea3ba27f755d3c8421f2db66a49cdeccb467253fefe/);
assert.match(workflow, /UNSEEN_ITEM_SET_SHA256: 6f27384f23163f6e40c544271ff01575272fcd4b9c42080408bc866e652b6300/);
assert.match(workflow, /FAMILIAR_LABELS_SHA256: 21b094c004a1f25ef5c15a6c62720c8f33a04ec472d91e00d63d797fb2db3599/);
assert.match(workflow, /UNSEEN_LABELS_SHA256: b105810bc7dc94bfddb2469d54edb51cc9a4dce7d2f58f8b4a8bfef80d3cb74f/);
assert.equal((workflow.match(/--evaluation-partition development/g) || []).length, 2);
assert.match(workflow, /assertFrozenTargetedAssistPaired20/);
assert.match(workflow, /LAUNCH_GATE_EVAL_SECRET: \$\{\{ secrets\.LAUNCH_GATE_EVAL_SECRET \}\}/);
assert.match(workflow, /test -n "\$LAUNCH_GATE_EVAL_SECRET"/);
assert.match(workflow, /checked_out_git_sha="\$\(git rev-parse HEAD\)"/);
assert.equal((workflow.match(/api\/v4\/health/g) || []).length, 2, "production SHA must be checked before and after paid calls");
assert.match(workflow, /Verify production revision remained pinned/);
assert.match(workflow, /api\/listing-provider-status/);
assert.match(workflow, /recognitionPipelineVersion/);
assert.match(workflow, /SERVICE_AUTH_ROUTE_ONLY/);
assert.match(workflow, /pipeline_contract_matches/);
assert.match(workflow, /auth_verified/);
assert.match(workflow, /analysis_route_verified/);
assert.match(workflow, /service_role: worker\.service_role === 'RECOGNITION_WORKER'/);
assert.match(workflow, /cp data\/eval\/unseen-product\/unseen17-verified-assets\.json \/tmp\/targeted-assist-assets\.json/);
assert.match(workflow, /scripts\/materialize-targeted-assist-verified-assets\.mjs/);
assert.ok(
  workflow.indexOf("scripts/materialize-targeted-assist-verified-assets.mjs")
    < workflow.indexOf("node scripts/run-targeted-assist-paired-eval.mjs"),
  "all twenty assets must be uploaded and verified before paired recognition"
);
assert.match(workflow, /\/tmp\/targeted-assist-asset-preparation\.json/);
assert.match(workflow, /\/tmp\/recognition-worker-service-contract\.json/);
assert.match(workflow, /--expected-git-sha "\$EXPECTED_GIT_SHA"/);
assert.match(workflow, /--workflow-run-id "\$GITHUB_RUN_ID"/);
assert.match(workflow, /if: always\(\)[\s\S]*?name: Upload evidence/);

const fixed20Workflow = await readFile(
  new URL("../.github/workflows/fixed20-cold-algorithm.yml", import.meta.url),
  "utf8"
);
assert.match(fixed20Workflow, /^\s{6}paired_gate_run_id:/m);
assert.match(fixed20Workflow, /^\s{6}expected_git_sha:/m);
assert.match(fixed20Workflow, /actions: read/);
assert.match(fixed20Workflow, /ref: \$\{\{ inputs\.expected_git_sha \}\}/);
assert.match(fixed20Workflow, /gh api "\/repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$PAIRED_GATE_RUN_ID"/);
assert.match(fixed20Workflow, /uses: actions\/download-artifact@v5/);
assert.match(fixed20Workflow, /name: targeted-assist-paired20-evidence/);
assert.match(fixed20Workflow, /run-id: \$\{\{ inputs\.paired_gate_run_id \}\}/);
assert.match(fixed20Workflow, /scripts\/verify-targeted-assist-fixed20-gate\.mjs/);
assert.match(fixed20Workflow, /--benchmark-profile cold-targeted-assist/);
assert.match(fixed20Workflow, /--expected-profile cold_targeted_assist_benchmark/);
assert.match(fixed20Workflow, /LAUNCH_GATE_EVAL_SECRET: \$\{\{ secrets\.LAUNCH_GATE_EVAL_SECRET \}\}/);
assert.equal((fixed20Workflow.match(/api\/v4\/health/g) || []).length, 2);
assert.ok(
  fixed20Workflow.indexOf("verify-targeted-assist-fixed20-gate.mjs")
    < fixed20Workflow.indexOf("Run the one allowed cold 20"),
  "the paired artifact admission must precede every fixed20 paid call"
);
assert.ok(
  fixed20Workflow.indexOf("Verify exact production revision before paid calls")
    < fixed20Workflow.indexOf("Run the one allowed cold 20"),
  "the exact production SHA check must precede every fixed20 paid call"
);

console.log("targeted assist paired runner tests passed");
