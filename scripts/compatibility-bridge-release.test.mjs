#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  COMPATIBILITY_BRIDGE_CHANGED_PATHS,
  COMPATIBILITY_BRIDGE_COMMIT_TRAILER,
  COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_MARKER,
  COMPATIBILITY_BRIDGE_PARENT_SHA,
  COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  COMPATIBILITY_BRIDGE_TREE_TRAILER,
  ORDINARY_RELEASE_CLASS,
  buildCompatibilityBridgeManifest,
  compatibilityBridgeRuntimeContractProof,
  verifyCompatibilityBridgeSelection
} from "./compatibility-bridge-release.mjs";
import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";

const gitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
assert.equal(
  COMPATIBILITY_BRIDGE_PARENT_SHA,
  "ced1a23741e179618e4e7b5eca055cb10ecac8cb"
);
assert.deepEqual(COMPATIBILITY_BRIDGE_CHANGED_PATHS, [
  "docs/operations/luna-v2-rollback-bridge.md",
  "e2e/production-writer-journey.spec.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-writer-journey-contract.test.mjs"
]);
const git = (cwd, args) => execFileSync("git", args, {
  cwd,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}).trim();
const parentShas = (cwd) => {
  const [head, ...parents] = git(cwd, ["rev-list", "--parents", "-n", "1", "HEAD"])
    .split(/\s+/);
  assert.equal(head, git(cwd, ["rev-parse", "HEAD"]));
  return parents;
};
const bridgeCommitMessage = [
  "rollback forward reader",
  "",
  COMPATIBILITY_BRIDGE_COMMIT_TRAILER,
  `${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${treeSha}`
].join("\n");
const ordinary = verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha,
  headSha: gitSha,
  commitMessage: "ordinary release"
});
assert.equal(ordinary.release_class, ORDINARY_RELEASE_CLASS);
assert.equal(ordinary.writer_journey_manifest, "writer-journey-cases-v3");
assert.equal(ordinary.parity_required, true);
assert.equal(Object.hasOwn(ordinary, "bridge_marker"), false);

const bridge = verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha,
  headSha: gitSha,
  headTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_PARENT_SHA],
  changedPaths: [...COMPATIBILITY_BRIDGE_CHANGED_PATHS],
  commitMessage: bridgeCommitMessage
});
assert.equal(bridge.bridge_marker, COMPATIBILITY_BRIDGE_MARKER);
assert.equal(bridge.git_sha, gitSha);
assert.equal(bridge.git_tree_sha, treeSha);
assert.equal(bridge.parent_git_sha, COMPATIBILITY_BRIDGE_PARENT_SHA);
assert.match(bridge.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
assert.equal(bridge.writer_journey_manifest, COMPATIBILITY_BRIDGE_MANIFEST_VERSION);
assert.equal(bridge.parity_required, false);

const shallowFixtureRoot = await mkdtemp(path.join(tmpdir(), "lynca-bridge-shallow-"));
try {
  const source = path.join(shallowFixtureRoot, "source");
  git(shallowFixtureRoot, ["init", "--quiet", "--initial-branch=main", source]);
  git(source, [
    "-c", "user.name=LYNCA fixture",
    "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--allow-empty", "-m", "synthetic bridge parent"
  ]);
  const fixtureParentSha = git(source, ["rev-parse", "HEAD"]);
  git(source, [
    "-c", "user.name=LYNCA fixture",
    "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--allow-empty", "-m", "synthetic bridge child"
  ]);
  const sourceUrl = pathToFileURL(source).href;

  const depthOne = path.join(shallowFixtureRoot, "depth-one");
  git(shallowFixtureRoot, ["clone", "--quiet", "--depth=1", sourceUrl, depthOne]);
  assert.deepEqual(parentShas(depthOne), [],
    "a depth-one checkout hides the bridge parent even when its object exists upstream");

  const depthTwo = path.join(shallowFixtureRoot, "depth-two");
  git(shallowFixtureRoot, ["clone", "--quiet", "--depth=2", sourceUrl, depthTwo]);
  git(depthTwo, [
    "fetch", "--quiet", "--no-tags", "--depth=2",
    "origin", "main:refs/remotes/origin/main"
  ]);
  assert.deepEqual(parentShas(depthTwo), [fixtureParentSha],
    "depth two must retain the synthetic bridge parent");

  const truncated = path.join(shallowFixtureRoot, "depth-two-then-one");
  git(shallowFixtureRoot, ["clone", "--quiet", "--depth=2", sourceUrl, truncated]);
  git(truncated, [
    "fetch", "--quiet", "--no-tags", "--depth=1",
    "origin", "main:refs/remotes/origin/main"
  ]);
  assert.deepEqual(parentShas(truncated), [],
    "a later depth-one freshness fetch makes the checked-out bridge commit shallow again");
} finally {
  await rm(shallowFixtureRoot, { recursive: true, force: true });
}

for (const commitMessage of [
  "ordinary release",
  COMPATIBILITY_BRIDGE_COMMIT_TRAILER,
  `${COMPATIBILITY_BRIDGE_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${treeSha}`,
  `LYNCA-Release-Class: compatibility-bridge-v2\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${treeSha}`
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha,
    headSha: gitSha,
    commitMessage
  }), (error) => error.code === "compatibility_bridge_commit_marker_missing");
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha,
  headSha: gitSha,
  headTreeSha: "c".repeat(40),
  parentShas: [COMPATIBILITY_BRIDGE_PARENT_SHA],
  changedPaths: [...COMPATIBILITY_BRIDGE_CHANGED_PATHS],
  commitMessage: bridgeCommitMessage
}), (error) => error.code === "compatibility_bridge_tree_mismatch");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha,
  headSha: gitSha,
  headTreeSha: treeSha,
  parentShas: ["c".repeat(40)],
  changedPaths: [...COMPATIBILITY_BRIDGE_CHANGED_PATHS],
  commitMessage: bridgeCommitMessage
}), (error) => error.code === "compatibility_bridge_parent_mismatch");
for (const changedPaths of [
  ["api/csm-listing-title.js"],
  [...COMPATIBILITY_BRIDGE_CHANGED_PATHS, "api/unrelated-active-v1-change.js"]
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha,
    headSha: gitSha,
    headTreeSha: treeSha,
    parentShas: [COMPATIBILITY_BRIDGE_PARENT_SHA],
    changedPaths,
    commitMessage: bridgeCommitMessage
  }), (error) => error.code === "compatibility_bridge_changed_paths_mismatch");
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha,
  headSha: "b".repeat(40),
  commitMessage: COMPATIBILITY_BRIDGE_COMMIT_TRAILER
}), (error) => error.code === "compatibility_bridge_head_sha_mismatch");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: "active-v2",
  gitSha,
  headSha: gitSha,
  commitMessage: COMPATIBILITY_BRIDGE_COMMIT_TRAILER
}), (error) => error.code === "release_class_invalid");

const proof = compatibilityBridgeRuntimeContractProof();
assert.equal(proof.active_registry_release_id,
  "registry_thin_external_identity_high_risers_v1");
assert.equal(proof.active_resolver_version, "thin-path-exact-external-identity-v2");
assert.equal(proof.active_marketplace_profile_version, "ebay-verified-external-identity-v1");
assert.equal(proof.active_model_profile_id, "openai-gpt-5.6-luna-csm-v1");
assert.equal(proof.active_visible_conflict_behavior, "ABSTAINED");
assert.equal(proof.dormant_registry_release_id,
  "registry_thin_external_identity_high_risers_v2");
assert.equal(proof.dormant_resolver_version, "thin-path-exact-external-identity-v3");
assert.equal(proof.provider_calls, 0);
assert.equal(proof.health_bound, false);

const health = {
  ready: true,
  deployment: { git_commit_sha: gitSha },
  runtime: {
    model_profile_id: "openai-gpt-5.6-luna-csm-v1",
    external_identity: EXTERNAL_IDENTITY_RELEASE_CONTRACT
  }
};
assert.equal(compatibilityBridgeRuntimeContractProof({ health, gitSha }).health_bound, true);
assert.throws(() => compatibilityBridgeRuntimeContractProof({
  health: {
    ...health,
    runtime: {
      ...health.runtime,
      external_identity: {
        ...EXTERNAL_IDENTITY_RELEASE_CONTRACT,
        registry_release: {
          ...EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release,
          id: "registry_thin_external_identity_high_risers_v2"
        }
      }
    }
  },
  gitSha
}), (error) => error.code === "compatibility_bridge_health_contract_invalid");

const sourceManifest = {
  schema_version: "writer-journey-cases-v3",
  evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
  accuracy_claim: null,
  cases: [
    { case_id: "NON_TCG", expected_grammar: "NON_TCG" },
    { case_id: "TCG", expected_grammar: "TCG" }
  ].map((entry) => ({
    ...entry,
    source_feedback_id: `feedback-${entry.case_id}`,
    evaluation_cohort: "INTERNAL_REVIEWED_GT",
    hash_provenance: "PRODUCTION_STORAGE_EXACT_BYTES",
    image_count: 2,
    files: ["front_original", "back_original"].map((role, index) => ({
      path: `/tmp/${entry.case_id}-${index}.jpg`,
      role,
      content_type: "image/jpeg",
      content_sha256: String(index + 1).repeat(64)
    }))
  })),
  parity_case: { case_id: "EXTERNAL_IDENTITY" }
};
const reduced = buildCompatibilityBridgeManifest({ selection: bridge, sourceManifest });
assert.deepEqual(Object.keys(reduced).sort(), [
  "accuracy_claim", "bridge_marker", "cases", "evidence_scope", "git_sha",
  "release_class", "schema_version"
]);
assert.equal(reduced.schema_version, COMPATIBILITY_BRIDGE_MANIFEST_VERSION);
assert.equal(reduced.release_class, COMPATIBILITY_BRIDGE_RELEASE_CLASS);
assert.equal(reduced.bridge_marker, COMPATIBILITY_BRIDGE_MARKER);
assert.equal(reduced.git_sha, gitSha);
assert.deepEqual(reduced.cases.map((entry) => entry.case_id), ["NON_TCG", "TCG"]);
assert.equal(Object.hasOwn(reduced, "parity_case"), false);
assert.equal(JSON.stringify(reduced).includes("EXTERNAL_IDENTITY"), false);
assert.throws(() => buildCompatibilityBridgeManifest({
  selection: ordinary,
  sourceManifest
}), (error) => error.code === "compatibility_bridge_selection_required");

console.log("compatibility bridge release: ok");
