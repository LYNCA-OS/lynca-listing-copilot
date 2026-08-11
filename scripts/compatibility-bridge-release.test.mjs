#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ACTIVE_V2_TRANSITION_MARKER,
  ACTIVE_V2_TRANSITION_PARENT_SHA,
  COMPATIBILITY_BRIDGE_CHANGED_PATHS,
  COMPATIBILITY_BRIDGE_COMMIT_TRAILER,
  COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_MARKER,
  COMPATIBILITY_BRIDGE_PARENT_SHA,
  COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  COMPATIBILITY_BRIDGE_TREE_TRAILER,
  LINEAR_ORDINARY_LINEAGE_MARKER,
  ORDINARY_RELEASE_CLASS,
  activeV2OrdinaryRuntimeContractProof,
  buildCompatibilityBridgeManifest,
  compatibilityBridgeRuntimeContractProof,
  verifyOrdinaryRollbackLineage,
  verifyCompatibilityBridgeSelection
} from "./compatibility-bridge-release.mjs";
import {
  WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS,
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
} from "./materialize-writer-journey-source.mjs";

const gitSha = "a".repeat(40);
const nextOrdinaryGitSha = "d".repeat(40);
const nextOrdinaryParentSha = "add4096a2811b783b46d8907d6a5cbaf8063bbc3";
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
  parentShas: [ACTIVE_V2_TRANSITION_PARENT_SHA],
  commitMessage: "ordinary release"
});
assert.equal(ordinary.release_class, ORDINARY_RELEASE_CLASS);
assert.equal(ordinary.schema_version, "production-release-selection-v3");
assert.equal(ordinary.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(ordinary.transition_marker, ACTIVE_V2_TRANSITION_MARKER);
assert.equal(ordinary.parent_git_sha, ACTIVE_V2_TRANSITION_PARENT_SHA);
assert.equal(ordinary.required_rollback_git_sha, ACTIVE_V2_TRANSITION_PARENT_SHA);
assert.equal(ordinary.writer_journey_manifest, "writer-journey-cases-v3");
assert.equal(ordinary.parity_required, true);
assert.equal(Object.hasOwn(ordinary, "bridge_marker"), false);
const nextOrdinary = verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: nextOrdinaryGitSha,
  headSha: nextOrdinaryGitSha,
  parentShas: [nextOrdinaryParentSha]
});
assert.equal(nextOrdinary.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(nextOrdinary.transition_marker, null);
assert.equal(nextOrdinary.parent_git_sha, nextOrdinaryParentSha);
assert.equal(nextOrdinary.required_rollback_git_sha, nextOrdinaryParentSha);
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha,
  headSha: gitSha,
  parentShas: []
}), (error) => error.code === "ordinary_release_parent_invalid");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha,
  headSha: gitSha,
  parentShas: [ACTIVE_V2_TRANSITION_PARENT_SHA, "c".repeat(40)]
}), (error) => error.code === "ordinary_release_parent_invalid");

assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha,
  headSha: gitSha,
  headTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_PARENT_SHA],
  changedPaths: [...COMPATIBILITY_BRIDGE_CHANGED_PATHS],
  commitMessage: bridgeCommitMessage
}), (error) => error.code === "compatibility_bridge_runtime_contract_invalid",
"the historical active-v1 bridge class must be unusable after active-v2 activation");
const historicalBridgeSelection = {
  release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  bridge_marker: COMPATIBILITY_BRIDGE_MARKER,
  git_sha: gitSha,
  writer_journey_manifest: COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
  parity_required: false
};

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

assert.throws(() => compatibilityBridgeRuntimeContractProof(),
  (error) => error.code === "compatibility_bridge_runtime_contract_invalid",
  "the bridge-only runtime proof must fail once v2 is active");
const activeProof = activeV2OrdinaryRuntimeContractProof();
assert.equal(activeProof.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(activeProof.transition_marker, ACTIVE_V2_TRANSITION_MARKER);
assert.equal(activeProof.required_parent_git_sha, ACTIVE_V2_TRANSITION_PARENT_SHA);
assert.equal(activeProof.active_registry_release_id,
  "registry_thin_external_identity_high_risers_v2");
assert.equal(activeProof.active_resolver_version, "thin-path-exact-external-identity-v3");
assert.equal(activeProof.active_marketplace_profile_version,
  "ebay-verified-external-identity-v2");
assert.equal(activeProof.verified_original_set_conflict_behavior, "CORRECTED");
assert.equal(activeProof.provider_calls, 0);
assert.match(activeProof.contract_sha256, /^[0-9a-f]{64}$/);
const nextOrdinaryProof = activeV2OrdinaryRuntimeContractProof({
  parentGitSha: nextOrdinaryParentSha
});
assert.equal(nextOrdinaryProof.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(nextOrdinaryProof.transition_marker, null);
assert.equal(nextOrdinaryProof.required_parent_git_sha, nextOrdinaryParentSha);
assert.notEqual(nextOrdinaryProof.contract_sha256, activeProof.contract_sha256);

const lineage = verifyOrdinaryRollbackLineage({
  selection: ordinary,
  rollbackReceipt: { git_sha: ACTIVE_V2_TRANSITION_PARENT_SHA }
});
assert.deepEqual(lineage, {
  schema_version: "production-release-rollback-lineage-receipt-v2",
  release_class: ORDINARY_RELEASE_CLASS,
  lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
  transition_marker: ACTIVE_V2_TRANSITION_MARKER,
  release_git_sha: gitSha,
  release_parent_git_sha: ACTIVE_V2_TRANSITION_PARENT_SHA,
  captured_rollback_git_sha: ACTIVE_V2_TRANSITION_PARENT_SHA,
  lineage_verified: true
});
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: ordinary,
  rollbackReceipt: { git_sha: "c".repeat(40) }
}), (error) => error.code === "ordinary_release_rollback_mismatch");
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: { ...ordinary, required_rollback_git_sha: "c".repeat(40) },
  rollbackReceipt: { git_sha: ACTIVE_V2_TRANSITION_PARENT_SHA }
}), (error) => error.code === "ordinary_release_selection_invalid");
const nextLineage = verifyOrdinaryRollbackLineage({
  selection: nextOrdinary,
  rollbackReceipt: { git_sha: nextOrdinaryParentSha }
});
assert.equal(nextLineage.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(nextLineage.transition_marker, null);
assert.equal(nextLineage.release_parent_git_sha, nextOrdinaryParentSha);
assert.equal(nextLineage.captured_rollback_git_sha, nextOrdinaryParentSha);
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: nextOrdinary,
  rollbackReceipt: { git_sha: "c".repeat(40) }
}), (error) => error.code === "ordinary_release_rollback_mismatch");
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: { ...nextOrdinary, parent_git_sha: "c".repeat(40) },
  rollbackReceipt: { git_sha: nextOrdinaryParentSha }
}), (error) => error.code === "ordinary_release_selection_invalid");

const cliFixtureRoot = await mkdtemp(path.join(tmpdir(), "lynca-active-v2-lineage-"));
try {
  const actualHead = git(process.cwd(), ["rev-parse", "HEAD"]);
  const actualParents = parentShas(process.cwd());
  assert.equal(actualParents.length, 1,
    "the checked-out ordinary release must expose exactly one parent");
  const [actualParent] = actualParents;
  const actualTransitionMarker = actualParent === ACTIVE_V2_TRANSITION_PARENT_SHA
    ? ACTIVE_V2_TRANSITION_MARKER
    : null;
  const selectionPath = path.join(cliFixtureRoot, "selection.json");
  const rollbackPath = path.join(cliFixtureRoot, "rollback.json");
  const lineagePath = path.join(cliFixtureRoot, "lineage.json");
  const teamId = "team_activeV2Lineage";
  const projectId = "prj_activeV2Lineage";
  await writeFile(rollbackPath, JSON.stringify({
    schema_version: "vercel-production-rollback-receipt-v1",
    canonical_origin: "https://listing.lyncafei.team",
    team_id: teamId,
    project_id: projectId,
    deployment_id: "dpl_previousOrdinary",
    deployment_url: "https://lynca-previous-ordinary.vercel.app",
    git_sha: actualParent,
    ready_state: "READY",
    target: "production",
    captured_at: "2026-08-11T12:00:00.000Z"
  }), { mode: 0o600 });
  const script = path.resolve("scripts/compatibility-bridge-release.mjs");
  const env = { ...process.env, VERCEL_ORG_ID: teamId, VERCEL_PROJECT_ID: projectId };
  execFileSync(process.execPath, [
    script, "verify-selection",
    "--release-class", ORDINARY_RELEASE_CLASS,
    "--git-sha", actualHead,
    "--out", selectionPath
  ], { env });
  execFileSync(process.execPath, [
    script, "verify-rollback-lineage",
    "--release-class", ORDINARY_RELEASE_CLASS,
    "--git-sha", actualHead,
    "--selection", selectionPath,
    "--rollback-receipt", rollbackPath,
    "--out", lineagePath
  ], { env });
  assert.equal((await stat(selectionPath)).mode & 0o777, 0o600);
  assert.equal((await stat(lineagePath)).mode & 0o777, 0o600);
  const savedSelection = JSON.parse(await readFile(selectionPath, "utf8"));
  assert.equal(savedSelection.schema_version, "production-release-selection-v3");
  assert.equal(savedSelection.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
  assert.equal(savedSelection.transition_marker, actualTransitionMarker);
  assert.equal(savedSelection.parent_git_sha, actualParent);
  assert.equal(savedSelection.required_rollback_git_sha, actualParent);
  const savedLineage = JSON.parse(await readFile(lineagePath, "utf8"));
  assert.equal(savedLineage.schema_version,
    "production-release-rollback-lineage-receipt-v2");
  assert.equal(savedLineage.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
  assert.equal(savedLineage.release_git_sha, actualHead);
  assert.equal(savedLineage.release_parent_git_sha, actualParent);
  assert.equal(savedLineage.captured_rollback_git_sha, actualParent);
  assert.equal(savedLineage.lineage_verified, true);
} finally {
  await rm(cliFixtureRoot, { recursive: true, force: true });
}

const sourceManifest = {
  schema_version: "writer-journey-cases-v3",
  evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
  accuracy_claim: null,
  cases: [{
    case_id: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.case_id,
    expected_grammar: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.expected_grammar,
    source_kind: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_kind,
    source_record_id: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_record_id,
    source_asset_id: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_asset_id,
    evaluation_cohort: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.evaluation_cohort,
    hash_provenance: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.hash_provenance,
    image_count: 2,
    files: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images.map((image, index) => ({
      path: `/tmp/NON_TCG-${index}.webp`,
      role: image.role,
      bytes: image.bytes,
      content_type: image.content_type,
      content_sha256: image.content_sha256
    }))
  }, (() => {
    const contract = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS.find(
      (entry) => entry.case_id === "TCG"
    );
    return {
      case_id: contract.case_id,
      expected_grammar: contract.expected_grammar,
      source_feedback_id: contract.source_feedback_id,
      evaluation_cohort: contract.evaluation_cohort,
      hash_provenance: contract.hash_provenance,
      image_count: 2,
      files: ["front", "back"].map((side, index) => ({
        path: `/tmp/TCG-${index}.jpg`,
        role: `${side}_original`,
        bytes: 100 + index,
        content_type: "image/jpeg",
        content_sha256: contract.image_sha256[`${contract.source_feedback_id}_${side}`]
      }))
    };
  })()],
  parity_case: { case_id: "EXTERNAL_IDENTITY" }
};
const reduced = buildCompatibilityBridgeManifest({
  selection: historicalBridgeSelection,
  sourceManifest
});
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
assert.equal(reduced.cases[0].source_kind, "PRODUCTION_ASSET");
assert.equal(reduced.cases[0].source_asset_id,
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_asset_id);
for (const mutation of [
  { source_kind: "SUPABASE_FEEDBACK" },
  { source_record_id: "asset-drift" },
  { source_asset_id: "asset-drift" },
  { expected_card_number: "251" },
  { files: [
    { ...sourceManifest.cases[0].files[0], expected_serial: "50/50" },
    sourceManifest.cases[0].files[1]
  ] }
]) {
  assert.throws(() => buildCompatibilityBridgeManifest({
    selection: historicalBridgeSelection,
    sourceManifest: {
      ...sourceManifest,
      cases: [{ ...sourceManifest.cases[0], ...mutation }, sourceManifest.cases[1]]
    }
  }), /compatibility_bridge_source_case_invalid/);
}
assert.throws(() => buildCompatibilityBridgeManifest({
  selection: ordinary,
  sourceManifest
}), (error) => error.code === "compatibility_bridge_selection_required");

console.log("compatibility bridge release: ok");
