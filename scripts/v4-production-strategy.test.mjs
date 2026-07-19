#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetRecoveryActions } from "../lib/listing/v4/assets/asset-lifecycle-contract.mjs";
import {
  v4ProductionStrategy,
  v4ProductionStrategyProfile
} from "../lib/listing/v4/policy/production-strategy.mjs";

const assetId = "asset_11111111-2222-4123-8abc-abcdef123456";
assert.equal(Object.isFrozen(v4ProductionStrategy), true);
assert.equal(Object.isFrozen(v4ProductionStrategy.asset_lifecycle), true);
assert.equal(Object.isFrozen(v4ProductionStrategy.candidate_control), true);
assert.equal(Object.isFrozen(v4ProductionStrategy.provider_terminal), true);
assert.equal(Object.isFrozen(v4ProductionStrategy.shadow_recognition_policy), true);
assert.equal(Object.isFrozen(v4ProductionStrategy.profile.job_retry), true);
assert.equal(v4ProductionStrategy.profile, v4ProductionStrategyProfile);
assert.equal(v4ProductionStrategy.profile.job_retry.max_attempts, 4);
assert.equal(v4ProductionStrategy.profile.shadow_recognition_policy_enabled, true);
assert.equal(v4ProductionStrategy.profile.shadow_recognition_policy_can_execute, false);
assert.equal(v4ProductionStrategy.profile.provider_terminal_path_policy_id, "provider-terminal-path-policy");
assert.equal(v4ProductionStrategy.shadow_recognition_policy.constraints.shadow_only, true);
assert.equal(
  v4ProductionStrategy.asset_lifecycle.assert_image_generation({
    requestedGenerationId: assetId,
    canonicalGenerationId: assetId
  }),
  assetId
);
assert.equal(
  v4ProductionStrategy.job_recovery.classify_failure({
    code: "CANONICAL_IMAGE_GENERATION_MISSING",
    retryable: true
  }).recovery_action,
  assetRecoveryActions.INPUT_REBIND
);
assert.equal(
  v4ProductionStrategy.job_recovery.classify_failure({ code: "PROVIDER_TIMEOUT" }).recovery_action,
  assetRecoveryActions.EXECUTION_RETRY
);
assert.equal(
  v4ProductionStrategy.recognition_route.plan({ images: [{}, {}] }, {}).route,
  "COLD_START_SAFE_DRAFT"
);

const chainSources = [
  "../api/v4/listing-copilot-title.js",
  "../api/v4/listing-job-enqueue.js",
  "../api/v4/listing-job-retry.js",
  "../api/v4/listing-job-status.js",
  "../lib/listing/v4/jobs/production-job-queue.mjs",
  "../lib/listing/v4/pipeline/native-recognition-core.mjs"
].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8"));
for (const source of chainSources) {
  assert.match(source, /v4ProductionStrategy/, "V4 execution edges must call the versioned strategy profile");
}
assert.doesNotMatch(chainSources[0], /route-planner\/route-planner\.mjs/);
assert.doesNotMatch(chainSources[1], /classifyAssetLifecycleFailure/);
assert.doesNotMatch(chainSources[2], /job-retry-policy\.mjs/);
assert.doesNotMatch(chainSources[3], /job-retry-policy\.mjs/);
assert.doesNotMatch(chainSources[4], /job-retry-policy\.mjs/);
assert.doesNotMatch(chainSources[5], /candidates\/(?:candidate-decision-stage|candidate-selection-pass|retrieval-application-layer)\.mjs/);

console.log("V4 production strategy tests passed");
