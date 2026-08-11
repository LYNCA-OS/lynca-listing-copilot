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
  CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS,
  CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID,
  CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID,
  CANONICAL_NAMING_ACTIVATION_A2_MARKER,
  CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
  CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
  CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
  CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS,
  CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID,
  CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID,
  CANONICAL_NAMING_ACTIVATION_A3_MARKER,
  CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
  CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
  CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
  CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS,
  CANONICAL_NAMING_ACTIVATION_MARKER,
  CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
  CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
  COMPATIBILITY_BRIDGE_CHANGED_PATHS,
  COMPATIBILITY_BRIDGE_COMMIT_TRAILER,
  COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_MARKER,
  COMPATIBILITY_BRIDGE_PARENT_SHA,
  COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  COMPATIBILITY_BRIDGE_TREE_TRAILER,
  COMPATIBILITY_BRIDGE_V2_CHANGED_PATHS,
  COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER,
  COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
  COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID,
  COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_V2_MARKER,
  COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
  COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
  COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS,
  COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID,
  COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID,
  COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER,
  COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
  COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
  COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
  LINEAR_ORDINARY_LINEAGE_MARKER,
  ORDINARY_RELEASE_CLASS,
  activeV2OrdinaryRuntimeContractProof,
  buildCompatibilityBridgeManifest,
  canonicalNamingActivationA2RuntimeContractProof,
  canonicalNamingActivationA3RuntimeContractProof,
  compatibilityBridgeV2RuntimeContractProof,
  compatibilityBridgeRuntimeContractProof,
  sealedV3OverlayForwardReadContractProof,
  verifyReleaseRollbackLineage,
  verifyOrdinaryRollbackLineage,
  verifyCompatibilityBridgeSelection
} from "./compatibility-bridge-release.mjs";
import {
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_CONTRACT,
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX
} from "./production-public-composition-projection.mjs";
import {
  WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS,
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
} from "./materialize-writer-journey-source.mjs";
import {
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT,
  standardP0TitleIdentityExact
} from "./production-standard-p0-verifier.mjs";

const gitSha = "a".repeat(40);
const activationGitSha = "5".repeat(40);
const activationA2GitSha = "6".repeat(40);
const activationA3GitSha = "7".repeat(40);
const nextOrdinaryGitSha = "d".repeat(40);
const treeSha = "b".repeat(40);
const bridgeV2GitSha = "e".repeat(40);
const bridgeV2TreeSha = "f".repeat(40);
const bridgeV2RepairGitSha = "1".repeat(40);
const bridgeV2RepairTreeSha = "2".repeat(40);
const bridgeV2WriterReceiptRepairGitSha = "3".repeat(40);
const bridgeV2WriterReceiptRepairTreeSha = "4".repeat(40);
const nextOrdinaryParentSha = activationA3GitSha;
const releaseSource = await readFile(
  new URL("./compatibility-bridge-release.mjs", import.meta.url),
  "utf8"
);
const verifyHealthDescriptorDispatch = releaseSource.match(
  /const proof = \[[\s\S]+?\]\.includes\(selection\.bridge_descriptor_id\)/
)?.[0] || "";
assert.match(verifyHealthDescriptorDispatch,
  /COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID/,
  "the B3 selection must reuse the sealed v2 runtime health proof");
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
assert.equal(COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID, "compatibility-bridge-v2");
assert.equal(COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
  "fe7308c3e464a39279eddeebfbac13a62657cb31");
assert.equal(COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
  "86d19c808ad28b87f11e6b60919eb6613e7a710c");
assert.equal(COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  "de55b031523237fc5572523886e25e7d3a1529d8");
assert.equal(COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID, "31491259742");
assert.equal(COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID,
  "compatibility-bridge-v2-bootstrap-repair-v1");
assert.equal(COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER,
  "canonical-naming-v3-overlay-forward-reader-active-v2-bridge-bootstrap-repair-v1");
assert.equal(COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
  "33f6a4d36ff4635f6e37d6c94660cd0b3e983ef6");
assert.equal(COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
  "8715891a30a80bf8d88f28f49552842b5d53d81f");
assert.equal(COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID, "31505892407");
assert.deepEqual(COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS, [
  ".github/workflows/deploy-production.yml",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-release-boundaries.test.mjs"
]);
assert.equal(COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID,
  "compatibility-bridge-v2-writer-receipt-repair-v1");
assert.equal(COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER,
  "canonical-naming-v3-overlay-forward-reader-active-v2-bridge-writer-receipt-repair-v1");
assert.equal(COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
  "45eaeb8b2ec6b0e98ed08c302c6af15b1692deda");
assert.equal(COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
  "9aa385321263b04a1615c7783c631c4066419c76");
assert.equal(COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID,
  "31509043427");
assert.deepEqual(COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS, [
  "e2e/production-writer-journey.spec.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-writer-journey-contract.test.mjs"
]);
assert.equal(CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
  "62dd9ed697beeb0128ec7d353a2c7560d4a694b1");
assert.equal(CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
  "707e9ba0d14e331ab1e9aa532f15e01c0df5cf1c");
assert.equal(CANONICAL_NAMING_ACTIVATION_MARKER,
  "canonical-naming-v3-v02-verified-overlay-activation-v1");
assert.deepEqual(CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS, [
  "lib/listing/thin/canonical-naming-adapter.mjs",
  "lib/listing/thin/csm-persistence.mjs",
  "lib/listing/thin/csm-projection-activation.mjs",
  "scripts/canonical-naming-subset-a-zero-provider.test.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/csm-direct-api.test.mjs",
  "scripts/csm-projection-activation.test.mjs",
  "scripts/csm-resolution-api.test.mjs",
  "scripts/exact-parallel-color-compaction.test.mjs"
]);
assert.equal(CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID,
  "canonical-naming-activation-a2-verifier-repair-v1");
assert.equal(CANONICAL_NAMING_ACTIVATION_A2_MARKER,
  "canonical-naming-activation-a2-standard-p0-verifier-repair-v1");
assert.equal(CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
  "171dd51b6188de24dd0f6969c265bfd640610e0b");
assert.equal(CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
  "2946066d48c1818262db2fbe9150bf3079f051e4");
assert.equal(CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID, "31515428405");
assert.equal(CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
  CANONICAL_NAMING_ACTIVATION_PARENT_SHA);
assert.deepEqual(CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS, [
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-standard-p0-verifier.mjs"
]);
assert.equal(CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID,
  "canonical-naming-activation-a3-public-projection-repair-v1");
assert.equal(CANONICAL_NAMING_ACTIVATION_A3_MARKER,
  "canonical-naming-activation-a3-public-composition-projection-repair-v1");
assert.equal(CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
  "655d00c2e2624f331bf85fa565bb5bc15bb5d4b3");
assert.equal(CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
  "889e7cf15a711e709227d5d4e6f6a35c2c2bc776");
assert.equal(CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID, "31517338969");
assert.equal(CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
  CANONICAL_NAMING_ACTIVATION_PARENT_SHA);
assert.deepEqual(CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS, [
  "e2e/production-writer-journey.spec.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-parity-readback.mjs",
  "scripts/production-parity-readback.test.mjs",
  "scripts/production-public-composition-projection.mjs",
  "scripts/production-writer-journey-contract.test.mjs"
]);
assert.equal(PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title,
  "2025-26 Topps Chrome Basketball Cooper Flagg Gold Refractor RC #251 50/50");
assert.equal(standardP0TitleIdentityExact(
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title
), true);
assert.equal(standardP0TitleIdentityExact(
  "2025 Topps Chrome Cooper Flagg Gold Refractor RC Mavericks #251 50/50"
), false, "the failed v0.1 verifier title must not satisfy the frozen v0.2 identity");
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
const bridgeV2CommitMessage = [
  "activate rollback-safe projection bridge",
  "",
  COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER,
  `${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${bridgeV2TreeSha}`
].join("\n");
const bridgeV2RepairCommitMessage = [
  "repair compatibility bridge bootstrap",
  "",
  COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER,
  `${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${bridgeV2RepairTreeSha}`
].join("\n");
const bridgeV2WriterReceiptRepairCommitMessage = [
  "repair compatibility bridge Writer Journey receipt",
  "",
  COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER,
  `${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${bridgeV2WriterReceiptRepairTreeSha}`
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
const activation = verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: activationGitSha,
  headSha: activationGitSha,
  parentTreeSha: CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
  parentShas: [CANONICAL_NAMING_ACTIVATION_PARENT_SHA],
  changedPaths: [...CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS]
});
assert.equal(activation.schema_version, "production-release-selection-v4");
assert.equal(activation.release_class, ORDINARY_RELEASE_CLASS);
assert.equal(activation.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(activation.transition_marker, CANONICAL_NAMING_ACTIVATION_MARKER);
assert.equal(activation.parent_git_sha, CANONICAL_NAMING_ACTIVATION_PARENT_SHA);
assert.equal(activation.parent_tree_sha, CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA);
assert.equal(activation.required_rollback_git_sha, CANONICAL_NAMING_ACTIVATION_PARENT_SHA);
assert.equal(activation.writer_journey_manifest, "writer-journey-cases-v3");
assert.equal(activation.parity_required, true);
assert.match(activation.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
for (const changedPaths of [
  [],
  CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS.slice(1),
  [...CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS, "api/unrelated.js"],
  [...CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS,
    CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS[0]]
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: ORDINARY_RELEASE_CLASS,
    gitSha: activationGitSha,
    headSha: activationGitSha,
    parentTreeSha: CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
    parentShas: [CANONICAL_NAMING_ACTIVATION_PARENT_SHA],
    changedPaths
  }), (error) => [
    "canonical_naming_activation_changed_paths_invalid",
    "canonical_naming_activation_changed_paths_mismatch"
  ].includes(error.code));
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: activationGitSha,
  headSha: activationGitSha,
  parentTreeSha: "0".repeat(40),
  parentShas: [CANONICAL_NAMING_ACTIVATION_PARENT_SHA],
  changedPaths: [...CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS]
}), (error) => error.code === "canonical_naming_activation_parent_tree_mismatch");
const activationA2 = verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: activationA2GitSha,
  headSha: activationA2GitSha,
  parentTreeSha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
  parentShas: [CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA],
  changedPaths: [...CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS]
});
assert.equal(activationA2.schema_version, "production-release-selection-v6");
assert.equal(activationA2.release_class, ORDINARY_RELEASE_CLASS);
assert.equal(activationA2.repair_descriptor_id,
  CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID);
assert.equal(activationA2.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(activationA2.transition_marker, CANONICAL_NAMING_ACTIVATION_A2_MARKER);
assert.equal(activationA2.parent_git_sha, CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA);
assert.equal(activationA2.parent_tree_sha,
  CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA);
assert.equal(activationA2.failed_run_id, CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID);
assert.equal(activationA2.required_rollback_git_sha,
  CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA);
assert.equal(activationA2.writer_journey_manifest, "writer-journey-cases-v3");
assert.equal(activationA2.parity_required, true);
assert.match(activationA2.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
for (const changedPaths of [
  [],
  CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS.slice(1),
  [...CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS, "api/unrelated.js"],
  [...CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS,
    CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS[0]]
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: ORDINARY_RELEASE_CLASS,
    gitSha: activationA2GitSha,
    headSha: activationA2GitSha,
    parentTreeSha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
    parentShas: [CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA],
    changedPaths
  }), (error) => [
    "canonical_naming_activation_a2_changed_paths_invalid",
    "canonical_naming_activation_a2_changed_paths_mismatch"
  ].includes(error.code));
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: activationA2GitSha,
  headSha: activationA2GitSha,
  parentTreeSha: "0".repeat(40),
  parentShas: [CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA],
  changedPaths: [...CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS]
}), (error) => error.code === "canonical_naming_activation_a2_parent_tree_mismatch");
const activationA3 = verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: activationA3GitSha,
  headSha: activationA3GitSha,
  parentTreeSha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
  parentShas: [CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA],
  changedPaths: [...CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS]
});
assert.equal(activationA3.schema_version, "production-release-selection-v7");
assert.equal(activationA3.release_class, ORDINARY_RELEASE_CLASS);
assert.equal(activationA3.repair_descriptor_id,
  CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID);
assert.equal(activationA3.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
assert.equal(activationA3.transition_marker, CANONICAL_NAMING_ACTIVATION_A3_MARKER);
assert.equal(activationA3.parent_git_sha, CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA);
assert.equal(activationA3.parent_tree_sha,
  CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA);
assert.equal(activationA3.failed_run_id, CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID);
assert.equal(activationA3.required_rollback_git_sha,
  CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA);
assert.equal(activationA3.writer_journey_manifest, "writer-journey-cases-v3");
assert.equal(activationA3.parity_required, true);
assert.match(activationA3.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
for (const changedPaths of [
  [],
  CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS.slice(1),
  [...CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS, "api/unrelated.js"],
  [...CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS,
    CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS[0]]
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: ORDINARY_RELEASE_CLASS,
    gitSha: activationA3GitSha,
    headSha: activationA3GitSha,
    parentTreeSha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
    parentShas: [CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA],
    changedPaths
  }), (error) => [
    "canonical_naming_activation_a3_changed_paths_invalid",
    "canonical_naming_activation_a3_changed_paths_mismatch"
  ].includes(error.code));
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: activationA3GitSha,
  headSha: activationA3GitSha,
  parentTreeSha: "0".repeat(40),
  parentShas: [CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA],
  changedPaths: [...CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS]
}), (error) => error.code === "canonical_naming_activation_a3_parent_tree_mismatch");
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
  gitSha: bridgeV2GitSha,
  headSha: bridgeV2GitSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_PARENT_SHA]
}), (error) => error.code
  === "ordinary_release_failed_parent_requires_compatibility_bridge_v2");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: bridgeV2RepairGitSha,
  headSha: bridgeV2RepairGitSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA]
}), (error) => error.code
  === "ordinary_release_failed_bridge_requires_compatibility_bridge_v2_repair");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: ORDINARY_RELEASE_CLASS,
  gitSha: bridgeV2WriterReceiptRepairGitSha,
  headSha: bridgeV2WriterReceiptRepairGitSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA]
}), (error) => error.code
  === "ordinary_release_failed_bridge_requires_writer_receipt_repair");
const bridgeV2WriterReceiptRepair = verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2WriterReceiptRepairGitSha,
  headSha: bridgeV2WriterReceiptRepairGitSha,
  headTreeSha: bridgeV2WriterReceiptRepairTreeSha,
  parentTreeSha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
  parentShas: [COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA],
  changedPaths: [...COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS],
  commitMessage: bridgeV2WriterReceiptRepairCommitMessage
});
assert.equal(bridgeV2WriterReceiptRepair.schema_version, "production-release-selection-v5");
assert.equal(bridgeV2WriterReceiptRepair.release_class, COMPATIBILITY_BRIDGE_RELEASE_CLASS);
assert.equal(bridgeV2WriterReceiptRepair.bridge_descriptor_id,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID);
assert.equal(bridgeV2WriterReceiptRepair.bridge_marker,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER);
assert.equal(bridgeV2WriterReceiptRepair.parent_git_sha,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA);
assert.equal(bridgeV2WriterReceiptRepair.parent_tree_sha,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA);
assert.equal(bridgeV2WriterReceiptRepair.failed_run_id,
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID);
assert.equal(bridgeV2WriterReceiptRepair.required_rollback_git_sha,
  COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA);
assert.equal(bridgeV2WriterReceiptRepair.writer_journey_manifest,
  COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION);
assert.equal(bridgeV2WriterReceiptRepair.parity_required, false);
assert.match(bridgeV2WriterReceiptRepair.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2WriterReceiptRepairGitSha,
  headSha: bridgeV2WriterReceiptRepairGitSha,
  headTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA],
  commitMessage: bridgeV2WriterReceiptRepairCommitMessage
}), (error) => error.code
  === "compatibility_bridge_v2_writer_receipt_repair_tree_mismatch");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2WriterReceiptRepairGitSha,
  headSha: bridgeV2WriterReceiptRepairGitSha,
  headTreeSha: bridgeV2WriterReceiptRepairTreeSha,
  parentTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA],
  changedPaths: [...COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS],
  commitMessage: bridgeV2WriterReceiptRepairCommitMessage
}), (error) => error.code
  === "compatibility_bridge_v2_writer_receipt_repair_parent_tree_mismatch");
for (const changedPaths of [
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS.slice(1),
  [...COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS, "api/unrelated.js"],
  [...COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS,
    COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS[0]]
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha: bridgeV2WriterReceiptRepairGitSha,
    headSha: bridgeV2WriterReceiptRepairGitSha,
    headTreeSha: bridgeV2WriterReceiptRepairTreeSha,
    parentTreeSha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
    parentShas: [COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA],
    changedPaths,
    commitMessage: bridgeV2WriterReceiptRepairCommitMessage
  }), (error) => [
    "compatibility_bridge_v2_writer_receipt_repair_changed_paths_invalid",
    "compatibility_bridge_v2_writer_receipt_repair_changed_paths_mismatch"
  ].includes(error.code));
}
const bridgeV2Repair = verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2RepairGitSha,
  headSha: bridgeV2RepairGitSha,
  headTreeSha: bridgeV2RepairTreeSha,
  parentTreeSha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
  parentShas: [COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA],
  changedPaths: [...COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS],
  commitMessage: bridgeV2RepairCommitMessage
});
assert.equal(bridgeV2Repair.schema_version, "production-release-selection-v4");
assert.equal(bridgeV2Repair.release_class, COMPATIBILITY_BRIDGE_RELEASE_CLASS);
assert.equal(bridgeV2Repair.bridge_descriptor_id,
  COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID);
assert.equal(bridgeV2Repair.bridge_marker, COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER);
assert.equal(bridgeV2Repair.parent_git_sha, COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA);
assert.equal(bridgeV2Repair.parent_tree_sha,
  COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA);
assert.equal(bridgeV2Repair.failed_run_id,
  COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID);
assert.equal(bridgeV2Repair.required_rollback_git_sha,
  COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA);
assert.equal(bridgeV2Repair.writer_journey_manifest,
  COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION);
assert.equal(bridgeV2Repair.parity_required, false);
assert.match(bridgeV2Repair.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
for (const commitMessage of [
  "repair without trailers",
  `${COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${bridgeV2RepairTreeSha}`,
  `${COMPATIBILITY_BRIDGE_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${bridgeV2RepairTreeSha}`,
  `${COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: not-a-tree`,
  COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha: bridgeV2RepairGitSha,
    headSha: bridgeV2RepairGitSha,
    parentShas: [COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA],
    commitMessage
  }), (error) => error.code === "compatibility_bridge_v2_commit_marker_invalid");
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2RepairGitSha,
  headSha: bridgeV2RepairGitSha,
  headTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA],
  commitMessage: bridgeV2RepairCommitMessage
}), (error) => error.code === "compatibility_bridge_v2_repair_tree_mismatch");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2RepairGitSha,
  headSha: bridgeV2RepairGitSha,
  headTreeSha: bridgeV2RepairTreeSha,
  parentTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA],
  commitMessage: bridgeV2RepairCommitMessage
}), (error) => error.code === "compatibility_bridge_v2_repair_parent_tree_mismatch");
for (const changedPaths of [
  COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS.slice(1),
  [...COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS, "api/unrelated-repair.js"],
  [...COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS,
    COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS[0]]
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha: bridgeV2RepairGitSha,
    headSha: bridgeV2RepairGitSha,
    headTreeSha: bridgeV2RepairTreeSha,
    parentTreeSha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
    parentShas: [COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA],
    changedPaths,
    commitMessage: bridgeV2RepairCommitMessage
  }), (error) => [
    "compatibility_bridge_v2_repair_changed_paths_invalid",
    "compatibility_bridge_v2_repair_changed_paths_mismatch"
  ].includes(error.code));
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2RepairGitSha,
  headSha: bridgeV2RepairGitSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA, "c".repeat(40)],
  commitMessage: bridgeV2RepairCommitMessage
}), (error) => error.code === "compatibility_bridge_parent_invalid");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2RepairGitSha,
  headSha: bridgeV2RepairGitSha,
  headTreeSha: bridgeV2RepairTreeSha,
  parentShas: ["c".repeat(40)],
  changedPaths: [...COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS],
  commitMessage: bridgeV2RepairCommitMessage
}), (error) => error.code === "compatibility_bridge_commit_marker_missing");
const bridgeV2 = verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2GitSha,
  headSha: bridgeV2GitSha,
  headTreeSha: bridgeV2TreeSha,
  parentTreeSha: COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
  parentShas: [COMPATIBILITY_BRIDGE_V2_PARENT_SHA],
  changedPaths: [...COMPATIBILITY_BRIDGE_V2_CHANGED_PATHS],
  commitMessage: bridgeV2CommitMessage
});
assert.equal(bridgeV2.schema_version, "production-release-selection-v2");
assert.equal(bridgeV2.release_class, COMPATIBILITY_BRIDGE_RELEASE_CLASS);
assert.equal(bridgeV2.bridge_descriptor_id, COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID);
assert.equal(bridgeV2.bridge_marker, COMPATIBILITY_BRIDGE_V2_MARKER);
assert.equal(bridgeV2.parent_git_sha, COMPATIBILITY_BRIDGE_V2_PARENT_SHA);
assert.equal(bridgeV2.parent_tree_sha, COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA);
assert.equal(bridgeV2.failed_run_id, COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID);
assert.equal(bridgeV2.required_rollback_git_sha, COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA);
assert.equal(bridgeV2.writer_journey_manifest, COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION);
assert.equal(bridgeV2.parity_required, false);
assert.match(bridgeV2.artifact_manifest_sha256, /^[0-9a-f]{64}$/);

for (const commitMessage of [
  "bridge without trailers",
  `${COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${bridgeV2TreeSha}`,
  `${COMPATIBILITY_BRIDGE_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${bridgeV2TreeSha}`,
  `${COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: not-a-tree`,
  COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha: bridgeV2GitSha,
    headSha: bridgeV2GitSha,
    parentShas: [COMPATIBILITY_BRIDGE_V2_PARENT_SHA],
    commitMessage
  }), (error) => error.code === "compatibility_bridge_v2_commit_marker_invalid");
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2GitSha,
  headSha: bridgeV2GitSha,
  headTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_PARENT_SHA],
  commitMessage: bridgeV2CommitMessage
}), (error) => error.code === "compatibility_bridge_v2_tree_mismatch");
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2GitSha,
  headSha: bridgeV2GitSha,
  headTreeSha: bridgeV2TreeSha,
  parentTreeSha: treeSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_PARENT_SHA],
  commitMessage: bridgeV2CommitMessage
}), (error) => error.code === "compatibility_bridge_v2_parent_tree_mismatch");
for (const changedPaths of [
  COMPATIBILITY_BRIDGE_V2_CHANGED_PATHS.slice(1),
  [...COMPATIBILITY_BRIDGE_V2_CHANGED_PATHS, "api/unrelated-bridge-change.js"]
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha: bridgeV2GitSha,
    headSha: bridgeV2GitSha,
    headTreeSha: bridgeV2TreeSha,
    parentTreeSha: COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
    parentShas: [COMPATIBILITY_BRIDGE_V2_PARENT_SHA],
    changedPaths,
    commitMessage: bridgeV2CommitMessage
  }), (error) => error.code === "compatibility_bridge_v2_changed_paths_mismatch");
}
assert.throws(() => verifyCompatibilityBridgeSelection({
  releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  gitSha: bridgeV2GitSha,
  headSha: bridgeV2GitSha,
  parentShas: [COMPATIBILITY_BRIDGE_V2_PARENT_SHA, "c".repeat(40)],
  commitMessage: bridgeV2CommitMessage
}), (error) => error.code === "compatibility_bridge_parent_invalid");
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
    "commit", "--quiet", "--allow-empty", "-m", "synthetic canonical rollback"
  ]);
  const fixtureRollbackSha = git(source, ["rev-parse", "HEAD"]);
  git(source, [
    "-c", "user.name=LYNCA fixture",
    "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--allow-empty", "-m", "synthetic failed bridge"
  ]);
  const fixtureParentSha = git(source, ["rev-parse", "HEAD"]);
  const fixtureParentTreeSha = git(source, ["rev-parse", "HEAD^{tree}"]);
  git(source, [
    "-c", "user.name=LYNCA fixture",
    "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--allow-empty", "-m", "synthetic bridge repair"
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
    "depth two must retain the exact failed bridge parent needed by the repair selector");
  assert.equal(git(depthTwo, ["rev-parse", `${fixtureParentSha}^{tree}`]),
    fixtureParentTreeSha,
    "depth two must retain the failed bridge tree used by exact repair selection");
  assert.throws(() => git(depthTwo, ["cat-file", "-e", `${fixtureRollbackSha}^{commit}`]),
    "the signed rollback SHA need not be in the shallow graph before receipt verification");

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
  `${"LYNCA-Release-Class"}: ${COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID}\n${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ${treeSha}`
]) {
  assert.throws(() => verifyCompatibilityBridgeSelection({
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    gitSha,
    headSha: gitSha,
    parentShas: [COMPATIBILITY_BRIDGE_PARENT_SHA],
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
const bridgeV2Proof = compatibilityBridgeV2RuntimeContractProof();
assert.equal(bridgeV2Proof.schema_version,
  "compatibility-bridge-v2-runtime-contract-proof-v1");
assert.equal(bridgeV2Proof.bridge_marker, COMPATIBILITY_BRIDGE_V2_MARKER);
assert.equal(bridgeV2Proof.active_writer_composer_version,
  "thin-marketplace-composer-v2");
assert.equal(bridgeV2Proof.active_writer_marketplace_profile_version,
  "ebay-profile-v1");
assert.equal(bridgeV2Proof.active_verified_original_observation_overlay, null);
assert.deepEqual(bridgeV2Proof.forward_reader_standard_contracts.map((contract) => ({
  composer_version: contract.composer_version,
  marketplace_profile_version: contract.marketplace_profile_version
})), [
  {
    composer_version: "thin-marketplace-composer-v3",
    marketplace_profile_version: "lynca-standard-name-v0.1"
  },
  {
    composer_version: "thin-marketplace-composer-v3",
    marketplace_profile_version: "lynca-standard-name-v0.2"
  }
]);
assert.equal(bridgeV2Proof.sealed_overlay_forward_read_packet_valid, true);
assert.equal(bridgeV2Proof.sealed_overlay_forward_readback_projector_valid, true);
assert.equal(bridgeV2Proof.sealed_overlay_forward_read_negative_count, 5);
assert.match(bridgeV2Proof.sealed_overlay_forward_read_contract_sha256,
  /^[0-9a-f]{64}$/);
assert.equal(bridgeV2Proof.provider_calls, 0);
assert.equal(bridgeV2Proof.health_bound, false);
assert.match(bridgeV2Proof.contract_sha256, /^[0-9a-f]{64}$/);
assert.equal(bridgeV2Proof.contract_sha256,
  "ffe908a15ba75829943bfa84dab0686be227060339256f9de83b98c804c5f267");
assert.equal(bridgeV2.contract_sha256, bridgeV2Proof.contract_sha256);
const sealedOverlayProof = sealedV3OverlayForwardReadContractProof();
assert.equal(sealedOverlayProof.durable_packet_valid, true);
assert.equal(sealedOverlayProof.durable_identity_snapshot_bound, true);
assert.equal(sealedOverlayProof.derived_reference_ignored_for_original_set, true);
assert.equal(sealedOverlayProof.readback_projector_valid, true);
assert.equal(sealedOverlayProof.resolution_view_recomposition_valid, true);
assert.equal(sealedOverlayProof.marketplace_profile_version,
  "lynca-standard-name-v0.2");
assert.equal(sealedOverlayProof.negative_resealed_counterexample_count, 5);
assert.equal(sealedOverlayProof.provider_calls, 0);
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
const activationProof = activeV2OrdinaryRuntimeContractProof({
  parentGitSha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA
});
assert.equal(activationProof.schema_version,
  "canonical-naming-activation-runtime-contract-proof-v1");
assert.equal(activationProof.transition_marker, CANONICAL_NAMING_ACTIVATION_MARKER);
assert.equal(activationProof.required_parent_git_sha,
  CANONICAL_NAMING_ACTIVATION_PARENT_SHA);
assert.equal(activationProof.active_standard_writer_composer_version,
  "thin-marketplace-composer-v3");
assert.equal(activationProof.active_standard_writer_marketplace_profile_version,
  "lynca-standard-name-v0.2");
assert.equal(activationProof.active_verified_original_observation_overlay,
  "verified_original_closed_projection_subset_a_v1");
assert.match(activationProof.projection_activation_sha256, /^[0-9a-f]{64}$/);
assert.equal(activationProof.historical_v01_release_contract_sha256,
  "eaffac53f6d54347cc2dcd688c6e9028304b66332a9126b5baa342f113ba8afc");
assert.equal(activationProof.historical_v01_stored_replay_sha256,
  "a4f338d3567c64f1777ce993333fa1e4eba075270975966a1fc55063094a03a8");
assert.equal(activationProof.active_model_reasoning_effort, "low");
assert.equal(activationProof.contract_sha256,
  "22b1ae81724522aabf2b022fe8246177b751da86a423e96ad658960e69ecda84");
assert.equal(activation.contract_sha256, activationProof.contract_sha256);
const activationA2Proof = activeV2OrdinaryRuntimeContractProof({
  parentGitSha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA
});
assert.equal(activationA2Proof.transition_marker, CANONICAL_NAMING_ACTIVATION_A2_MARKER);
assert.equal(activationA2Proof.required_parent_git_sha,
  CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA);
const {
  transition_marker: _activationTransitionMarker,
  required_parent_git_sha: _activationParent,
  contract_sha256: _activationContractSha,
  ...activationRuntimeBody
} = activationProof;
const {
  transition_marker: _activationA2TransitionMarker,
  required_parent_git_sha: _activationA2Parent,
  contract_sha256: _activationA2ContractSha,
  ...activationA2RuntimeBody
} = activationA2Proof;
assert.deepEqual(activationA2RuntimeBody, activationRuntimeBody,
  "A2 must preserve the already-activated runtime behavior byte-for-byte");
const activationA2RepairProof = canonicalNamingActivationA2RuntimeContractProof();
assert.equal(activationA2RepairProof.schema_version,
  "canonical-naming-activation-a2-runtime-contract-proof-v1");
assert.equal(activationA2RepairProof.repair_descriptor_id,
  CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID);
assert.equal(activationA2RepairProof.repair_marker,
  CANONICAL_NAMING_ACTIVATION_A2_MARKER);
assert.equal(activationA2RepairProof.base_activation_runtime_contract_sha256,
  activationProof.contract_sha256);
assert.equal(activationA2RepairProof.verifier_source_asset_id,
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.source_asset_id);
assert.equal(activationA2RepairProof.verifier_expected_title,
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title);
assert.equal(activationA2RepairProof.verifier_expected_card_number, "251");
assert.equal(activationA2RepairProof.verifier_rendered_card_number, "#251");
assert.equal(activationA2RepairProof.verifier_expected_serial, "50/50");
assert.equal(activationA2RepairProof.verifier_contract_sha256,
  "79c9588bc790a54a3a5088ff9ea10901ea89ab74191c69b58c12e5e9871891d5");
assert.equal(activationA2RepairProof.provider_calls, 0);
assert.equal(activationA2.contract_sha256, activationA2RepairProof.contract_sha256);
const verifierContractCounterexamples = [
  {
    ...PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT,
    expected_title: "#251 50/50"
  },
  {
    ...PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT,
    expected_title:
      "2025-26 Topps Chrome Cooper Flagg Gold Refractor RC #251 50/50"
  },
  {
    ...PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT,
    expected_title: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title
      .replace("Basketball", "Volleyball")
  }
];
assert.equal(verifierContractCounterexamples[2].expected_title.length,
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title.length);
for (const verifierContract of verifierContractCounterexamples) {
  assert.throws(() => canonicalNamingActivationA2RuntimeContractProof({ verifierContract }),
    (error) => error.code === "canonical_naming_activation_a2_verifier_contract_invalid");
}
const activationA3RepairProof = canonicalNamingActivationA3RuntimeContractProof();
assert.equal(activationA3RepairProof.schema_version,
  "canonical-naming-activation-a3-runtime-contract-proof-v1");
assert.equal(activationA3RepairProof.repair_descriptor_id,
  CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID);
assert.equal(activationA3RepairProof.repair_marker,
  CANONICAL_NAMING_ACTIVATION_A3_MARKER);
assert.equal(activationA3RepairProof.required_parent_git_sha,
  CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA);
assert.equal(activationA3RepairProof.required_parent_tree_sha,
  CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA);
assert.equal(activationA3RepairProof.failed_run_id,
  CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID);
assert.equal(activationA3RepairProof.required_rollback_git_sha,
  CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA);
assert.equal(activationA3RepairProof.base_activation_a2_runtime_contract_sha256,
  activationA2RepairProof.contract_sha256);
assert.equal(activationA3RepairProof.base_activation_runtime_contract_sha256,
  activationProof.contract_sha256);
assert.equal(activationA3RepairProof.public_projection_schema_version,
  "production-public-composition-projection-contract-v1");
assert.equal(activationA3RepairProof.public_projection_contract_sha256,
  "2a92ad7ffab15ec57555d215bbe2b4119becf238a6094a531ed8e7901f6fd90a");
assert.equal(activationA3RepairProof.public_projection_matrix_sha256,
  "3027bb203fa0c064eb8d1df6ffe0b050bb6f1e4c909e44890d4f6f84274a16a5");
assert.equal(activationA3RepairProof.registered_tuple_count, 6);
assert.equal(activationA3RepairProof.public_profile_tuple_count, 2);
assert.equal(activationA3RepairProof.hidden_profile_tuple_count, 4);
assert.deepEqual(activationA3RepairProof.verifier_consumers,
  ["production-parity-readback", "production-writer-journey"]);
assert.equal(activationA3RepairProof.provider_calls, 0);
assert.equal(activationA3.contract_sha256, activationA3RepairProof.contract_sha256);
for (const projectionMatrix of [
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.slice(1),
  [...PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX,
    PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX[0]],
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.map((entry, index) => index === 0
    ? { ...entry, marketplace_profile_public: false }
    : entry),
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.map((entry, index) => index === 5
    ? { ...entry, marketplace_profile_version: "ebay-verified-external-identity-v1" }
    : entry)
]) {
  assert.throws(() => canonicalNamingActivationA3RuntimeContractProof({ projectionMatrix }),
    (error) => error.code === "canonical_naming_activation_a3_projection_contract_invalid");
}
for (const projectionContract of [
  { ...PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_CONTRACT,
    contract_sha256: "0".repeat(64) },
  { ...PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_CONTRACT,
    schema_version: "production-public-composition-projection-contract-v2" },
  { ...PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_CONTRACT,
    projections: PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.slice(1) }
]) {
  assert.throws(() => canonicalNamingActivationA3RuntimeContractProof({ projectionContract }),
    (error) => error.code === "canonical_naming_activation_a3_projection_contract_invalid");
}
assert.throws(() => canonicalNamingActivationA3RuntimeContractProof({
  baseA2Proof: { ...activationA2RepairProof, contract_sha256: "0".repeat(64) }
}), (error) => error.code === "canonical_naming_activation_a3_base_runtime_contract_invalid");
assert.throws(() => canonicalNamingActivationA3RuntimeContractProof({
  baseA2Proof: {
    contract_sha256: activationA2RepairProof.contract_sha256,
    base_activation_runtime_contract_sha256: activationProof.contract_sha256
  }
}), (error) => error.code === "canonical_naming_activation_a3_base_runtime_contract_invalid");
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
const activationLineage = verifyOrdinaryRollbackLineage({
  selection: activation,
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA }
});
assert.deepEqual(activationLineage, {
  schema_version: "production-release-rollback-lineage-receipt-v6",
  release_class: ORDINARY_RELEASE_CLASS,
  lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
  transition_marker: CANONICAL_NAMING_ACTIVATION_MARKER,
  release_git_sha: activationGitSha,
  release_parent_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
  release_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
  captured_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
  artifact_manifest_sha256: activation.artifact_manifest_sha256,
  lineage_verified: true
});
for (const tampered of [
  { ...activation, transition_marker: ACTIVE_V2_TRANSITION_MARKER },
  { ...activation, parent_tree_sha: "0".repeat(40) },
  { ...activation, artifact_manifest_sha256: "0".repeat(64) },
  { ...activation, contract_sha256: "0".repeat(64) }
]) {
  assert.throws(() => verifyOrdinaryRollbackLineage({
    selection: tampered,
    rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA }
  }), (error) => error.code === "ordinary_release_activation_selection_invalid");
}
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: activation,
  rollbackReceipt: { git_sha: "c".repeat(40) }
}), (error) => error.code === "ordinary_release_rollback_mismatch");
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: {
    schema_version: "production-release-selection-v3",
    release_class: ORDINARY_RELEASE_CLASS,
    lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
    transition_marker: CANONICAL_NAMING_ACTIVATION_MARKER,
    parent_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
    git_sha: activationGitSha,
    writer_journey_manifest: "writer-journey-cases-v3",
    parity_required: true,
    contract_sha256: activation.contract_sha256
  },
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA }
}), (error) => error.code === "ordinary_release_activation_selection_invalid");
const activationA2Lineage = verifyOrdinaryRollbackLineage({
  selection: activationA2,
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA }
});
assert.deepEqual(activationA2Lineage, {
  schema_version: "production-release-rollback-lineage-receipt-v7",
  release_class: ORDINARY_RELEASE_CLASS,
  repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID,
  lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
  transition_marker: CANONICAL_NAMING_ACTIVATION_A2_MARKER,
  release_git_sha: activationA2GitSha,
  release_parent_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
  release_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
  failed_run_id: CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID,
  required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
  captured_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
  artifact_manifest_sha256: activationA2.artifact_manifest_sha256,
  lineage_verified: true
});
for (const tampered of [
  { ...activationA2, repair_descriptor_id: "unknown-repair" },
  { ...activationA2, transition_marker: CANONICAL_NAMING_ACTIVATION_MARKER },
  { ...activationA2, parent_tree_sha: "0".repeat(40) },
  { ...activationA2, failed_run_id: "31515428404" },
  { ...activationA2, required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA },
  { ...activationA2, artifact_manifest_sha256: "0".repeat(64) },
  { ...activationA2, contract_sha256: "0".repeat(64) }
]) {
  assert.throws(() => verifyOrdinaryRollbackLineage({
    selection: tampered,
    rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA }
  }), (error) => error.code === "ordinary_release_activation_a2_selection_invalid");
}
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: activationA2,
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA }
}), (error) => error.code === "ordinary_release_rollback_mismatch");
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: {
    schema_version: "production-release-selection-v3",
    release_class: ORDINARY_RELEASE_CLASS,
    lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
    transition_marker: CANONICAL_NAMING_ACTIVATION_A2_MARKER,
    parent_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
    git_sha: activationA2GitSha,
    writer_journey_manifest: "writer-journey-cases-v3",
    parity_required: true,
    contract_sha256: activationA2.contract_sha256
  },
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA }
}), (error) => error.code === "ordinary_release_activation_a2_selection_invalid");
const activationA3Lineage = verifyOrdinaryRollbackLineage({
  selection: activationA3,
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA }
});
assert.deepEqual(activationA3Lineage, {
  schema_version: "production-release-rollback-lineage-receipt-v8",
  release_class: ORDINARY_RELEASE_CLASS,
  repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID,
  lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
  transition_marker: CANONICAL_NAMING_ACTIVATION_A3_MARKER,
  release_git_sha: activationA3GitSha,
  release_parent_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
  release_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
  failed_run_id: CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID,
  required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
  captured_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
  artifact_manifest_sha256: activationA3.artifact_manifest_sha256,
  lineage_verified: true
});
for (const tampered of [
  { ...activationA3, repair_descriptor_id: "unknown-repair" },
  { ...activationA3, transition_marker: CANONICAL_NAMING_ACTIVATION_A2_MARKER },
  { ...activationA3, parent_tree_sha: "0".repeat(40) },
  { ...activationA3, failed_run_id: "31517338968" },
  { ...activationA3, required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA },
  { ...activationA3, artifact_manifest_sha256: "0".repeat(64) },
  { ...activationA3, contract_sha256: "0".repeat(64) }
]) {
  assert.throws(() => verifyOrdinaryRollbackLineage({
    selection: tampered,
    rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA }
  }), (error) => error.code === "ordinary_release_activation_a3_selection_invalid");
}
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: activationA3,
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA }
}), (error) => error.code === "ordinary_release_rollback_mismatch");
assert.throws(() => verifyOrdinaryRollbackLineage({
  selection: {
    schema_version: "production-release-selection-v3",
    release_class: ORDINARY_RELEASE_CLASS,
    lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
    transition_marker: CANONICAL_NAMING_ACTIVATION_A3_MARKER,
    parent_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
    git_sha: activationA3GitSha,
    writer_journey_manifest: "writer-journey-cases-v3",
    parity_required: true,
    contract_sha256: activationA3.contract_sha256
  },
  rollbackReceipt: { git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA }
}), (error) => error.code === "ordinary_release_activation_a3_selection_invalid");
const bridgeV2Lineage = verifyReleaseRollbackLineage({
  selection: bridgeV2,
  rollbackReceipt: { git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA }
});
assert.deepEqual(bridgeV2Lineage, {
  schema_version: "production-release-rollback-lineage-receipt-v3",
  release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
  bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER,
  release_git_sha: bridgeV2GitSha,
  release_parent_git_sha: COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
  release_parent_tree_sha: COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
  failed_run_id: COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID,
  required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  captured_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  lineage_verified: true
});
for (const rollbackSha of [COMPATIBILITY_BRIDGE_V2_PARENT_SHA, "c".repeat(40)]) {
  assert.throws(() => verifyReleaseRollbackLineage({
    selection: bridgeV2,
    rollbackReceipt: { git_sha: rollbackSha }
  }), (error) => error.code === "release_rollback_lineage_rollback_mismatch");
}
for (const tampered of [
  { ...bridgeV2, bridge_descriptor_id: "wrong" },
  { ...bridgeV2, parent_tree_sha: treeSha },
  { ...bridgeV2, failed_run_id: "31491259743" },
  { ...bridgeV2, required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_PARENT_SHA },
  { ...bridgeV2, artifact_manifest_sha256: "0".repeat(64) },
  { ...bridgeV2, contract_sha256: "0".repeat(64) }
]) {
  assert.throws(() => verifyReleaseRollbackLineage({
    selection: tampered,
    rollbackReceipt: { git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA }
  }), (error) => error.code === "release_rollback_lineage_selection_invalid");
}
const bridgeV2RepairLineage = verifyReleaseRollbackLineage({
  selection: bridgeV2Repair,
  rollbackReceipt: { git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA }
});
assert.deepEqual(bridgeV2RepairLineage, {
  schema_version: "production-release-rollback-lineage-receipt-v4",
  release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID,
  bridge_marker: COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER,
  release_git_sha: bridgeV2RepairGitSha,
  release_parent_git_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
  release_parent_tree_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
  failed_run_id: COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID,
  required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  captured_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  lineage_verified: true
});
for (const rollbackSha of [
  COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
  COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
  "c".repeat(40)
]) {
  assert.throws(() => verifyReleaseRollbackLineage({
    selection: bridgeV2Repair,
    rollbackReceipt: { git_sha: rollbackSha }
  }), (error) => error.code === "release_rollback_lineage_repair_rollback_mismatch");
}
for (const tampered of [
  { ...bridgeV2Repair, bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID },
  { ...bridgeV2Repair, bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER },
  { ...bridgeV2Repair, parent_git_sha: COMPATIBILITY_BRIDGE_V2_PARENT_SHA },
  { ...bridgeV2Repair, parent_tree_sha: COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA },
  { ...bridgeV2Repair, failed_run_id: COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID },
  { ...bridgeV2Repair, required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA },
  { ...bridgeV2Repair, artifact_manifest_sha256: "0".repeat(64) },
  { ...bridgeV2Repair, contract_sha256: "0".repeat(64) }
]) {
  assert.throws(() => verifyReleaseRollbackLineage({
    selection: tampered,
    rollbackReceipt: { git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA }
  }), (error) => [
    "release_rollback_lineage_repair_selection_invalid",
    "release_rollback_lineage_selection_invalid"
  ].includes(error.code));
}
const bridgeV2WriterReceiptRepairLineage = verifyReleaseRollbackLineage({
  selection: bridgeV2WriterReceiptRepair,
  rollbackReceipt: { git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA }
});
assert.deepEqual(bridgeV2WriterReceiptRepairLineage, {
  schema_version: "production-release-rollback-lineage-receipt-v5",
  release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID,
  bridge_marker: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER,
  release_git_sha: bridgeV2WriterReceiptRepairGitSha,
  release_parent_git_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
  release_parent_tree_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
  failed_run_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID,
  required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  captured_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
  lineage_verified: true
});
for (const rollbackSha of [
  COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
  COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
  "c".repeat(40)
]) {
  assert.throws(() => verifyReleaseRollbackLineage({
    selection: bridgeV2WriterReceiptRepair,
    rollbackReceipt: { git_sha: rollbackSha }
  }), (error) => error.code
    === "release_rollback_lineage_writer_receipt_repair_rollback_mismatch");
}
for (const tampered of [
  { ...bridgeV2WriterReceiptRepair, bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID },
  { ...bridgeV2WriterReceiptRepair, bridge_marker: COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER },
  { ...bridgeV2WriterReceiptRepair, parent_git_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA },
  { ...bridgeV2WriterReceiptRepair, parent_tree_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA },
  { ...bridgeV2WriterReceiptRepair, failed_run_id: COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID },
  { ...bridgeV2WriterReceiptRepair, required_rollback_git_sha:
    COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA },
  { ...bridgeV2WriterReceiptRepair, artifact_manifest_sha256: "0".repeat(64) },
  { ...bridgeV2WriterReceiptRepair, contract_sha256: "0".repeat(64) }
]) {
  assert.throws(() => verifyReleaseRollbackLineage({
    selection: tampered,
    rollbackReceipt: { git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA }
  }), (error) => [
    "release_rollback_lineage_writer_receipt_repair_selection_invalid",
    "release_rollback_lineage_repair_selection_invalid",
    "release_rollback_lineage_selection_invalid"
  ].includes(error.code));
}
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
    "the checked-out release must expose exactly one parent");
  const [actualParent] = actualParents;
  const actualReleaseClass = [
    COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
    COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
    COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA
  ].includes(actualParent)
    ? COMPATIBILITY_BRIDGE_RELEASE_CLASS
    : ORDINARY_RELEASE_CLASS;
  const actualActivationA3 = actualParent === CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA;
  const actualActivationA2 = actualParent === CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA;
  const actualActivation = actualParent === CANONICAL_NAMING_ACTIVATION_PARENT_SHA;
  const actualTransitionMarker = actualActivationA3
    ? CANONICAL_NAMING_ACTIVATION_A3_MARKER
    : actualActivationA2
      ? CANONICAL_NAMING_ACTIVATION_A2_MARKER
      : actualActivation
        ? CANONICAL_NAMING_ACTIVATION_MARKER
        : actualParent === ACTIVE_V2_TRANSITION_PARENT_SHA
          ? ACTIVE_V2_TRANSITION_MARKER
          : null;
  const selectionPath = path.join(cliFixtureRoot, "selection.json");
  const rollbackPath = path.join(cliFixtureRoot, "rollback.json");
  const lineagePath = path.join(cliFixtureRoot, "lineage.json");
  const teamId = "team_activeV2Lineage";
  const projectId = "prj_activeV2Lineage";
  const script = path.resolve("scripts/compatibility-bridge-release.mjs");
  const env = { ...process.env, VERCEL_ORG_ID: teamId, VERCEL_PROJECT_ID: projectId };
  execFileSync(process.execPath, [
    script, "verify-selection",
    "--release-class", actualReleaseClass,
    "--git-sha", actualHead,
    "--out", selectionPath
  ], { env });
  const savedSelection = JSON.parse(await readFile(selectionPath, "utf8"));
  await writeFile(rollbackPath, JSON.stringify({
    schema_version: "vercel-production-rollback-receipt-v1",
    canonical_origin: "https://listing.lyncafei.team",
    team_id: teamId,
    project_id: projectId,
    deployment_id: "dpl_previousCanonical",
    deployment_url: "https://lynca-previous-canonical.vercel.app",
    git_sha: savedSelection.required_rollback_git_sha,
    ready_state: "READY",
    target: "production",
    captured_at: "2026-08-11T12:00:00.000Z"
  }), { mode: 0o600 });
  execFileSync(process.execPath, [
    script, "verify-rollback-lineage",
    "--release-class", actualReleaseClass,
    "--git-sha", actualHead,
    "--selection", selectionPath,
    "--rollback-receipt", rollbackPath,
    "--out", lineagePath
  ], { env });
  assert.equal((await stat(selectionPath)).mode & 0o777, 0o600);
  assert.equal((await stat(lineagePath)).mode & 0o777, 0o600);
  const savedLineage = JSON.parse(await readFile(lineagePath, "utf8"));
  assert.equal(savedSelection.release_class, actualReleaseClass);
  assert.equal(savedLineage.release_git_sha, actualHead);
  assert.equal(savedLineage.release_parent_git_sha, actualParent);
  assert.equal(savedLineage.captured_rollback_git_sha,
    savedSelection.required_rollback_git_sha);
  assert.equal(savedLineage.lineage_verified, true);
  if (actualReleaseClass === ORDINARY_RELEASE_CLASS) {
    assert.equal(savedSelection.schema_version,
      actualActivationA3
        ? "production-release-selection-v7"
        : actualActivationA2
          ? "production-release-selection-v6"
          : actualActivation
            ? "production-release-selection-v4"
            : "production-release-selection-v3");
    assert.equal(savedSelection.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
    assert.equal(savedSelection.transition_marker, actualTransitionMarker);
    assert.equal(savedSelection.parent_git_sha, actualParent);
    assert.equal(savedSelection.required_rollback_git_sha,
      actualActivationA3
        ? CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA
        : actualActivationA2
          ? CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA
          : actualParent);
    assert.equal(savedLineage.schema_version, actualActivationA3
      ? "production-release-rollback-lineage-receipt-v8"
      : actualActivationA2
        ? "production-release-rollback-lineage-receipt-v7"
        : actualActivation
          ? "production-release-rollback-lineage-receipt-v6"
          : "production-release-rollback-lineage-receipt-v2");
    assert.equal(savedLineage.lineage_marker, LINEAR_ORDINARY_LINEAGE_MARKER);
    if (actualActivationA3) {
      assert.equal(savedSelection.repair_descriptor_id,
        CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID);
      assert.equal(savedSelection.failed_run_id,
        CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID);
      assert.equal(savedSelection.parent_tree_sha,
        CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA);
      assert.match(savedSelection.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
      assert.equal(savedLineage.release_parent_tree_sha,
        CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA);
    } else if (actualActivationA2) {
      assert.equal(savedSelection.repair_descriptor_id,
        CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID);
      assert.equal(savedSelection.failed_run_id,
        CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID);
      assert.equal(savedSelection.parent_tree_sha,
        CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA);
      assert.match(savedSelection.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
      assert.equal(savedLineage.release_parent_tree_sha,
        CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA);
    } else if (actualActivation) {
      assert.equal(savedSelection.parent_tree_sha,
        CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA);
      assert.match(savedSelection.artifact_manifest_sha256, /^[0-9a-f]{64}$/);
      assert.equal(savedLineage.release_parent_tree_sha,
        CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA);
    }
  } else if (actualParent === COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA) {
    assert.equal(savedSelection.schema_version, "production-release-selection-v5");
    assert.equal(savedSelection.bridge_descriptor_id,
      COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID);
    assert.equal(savedSelection.bridge_marker,
      COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER);
    assert.equal(savedSelection.parent_git_sha,
      COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA);
    assert.equal(savedSelection.required_rollback_git_sha,
      COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA);
    assert.equal(savedLineage.schema_version,
      "production-release-rollback-lineage-receipt-v5");
    assert.equal(savedLineage.bridge_descriptor_id,
      COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID);
  } else if (actualParent === COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA) {
    assert.equal(savedSelection.schema_version, "production-release-selection-v4");
    assert.equal(savedSelection.bridge_descriptor_id,
      COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID);
    assert.equal(savedSelection.bridge_marker, COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER);
    assert.equal(savedSelection.parent_git_sha,
      COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA);
    assert.equal(savedSelection.required_rollback_git_sha,
      COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA);
    assert.equal(savedLineage.schema_version,
      "production-release-rollback-lineage-receipt-v4");
    assert.equal(savedLineage.bridge_descriptor_id,
      COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID);
  } else {
    assert.equal(savedSelection.schema_version, "production-release-selection-v2");
    assert.equal(savedSelection.bridge_descriptor_id,
      COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID);
    assert.equal(savedSelection.parent_git_sha, COMPATIBILITY_BRIDGE_V2_PARENT_SHA);
    assert.equal(savedSelection.required_rollback_git_sha,
      COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA);
    assert.equal(savedLineage.schema_version,
      "production-release-rollback-lineage-receipt-v3");
    assert.equal(savedLineage.bridge_descriptor_id,
      COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID);
  }
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
const reducedRepair = buildCompatibilityBridgeManifest({
  selection: bridgeV2Repair,
  sourceManifest
});
assert.deepEqual(Object.keys(reducedRepair).sort(), [
  "accuracy_claim", "bridge_descriptor_id", "bridge_marker", "cases",
  "evidence_scope", "git_sha", "release_class", "schema_version"
]);
assert.equal(reducedRepair.schema_version, COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION);
assert.equal(reducedRepair.bridge_descriptor_id, COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
  "the one-time repair must reuse the unchanged runtime Writer Journey descriptor");
assert.equal(reducedRepair.bridge_marker, COMPATIBILITY_BRIDGE_V2_MARKER,
  "the private release selection owns the repair marker, not the runtime manifest");
assert.equal(reducedRepair.git_sha, bridgeV2RepairGitSha);
assert.deepEqual(reducedRepair.cases.map((entry) => entry.case_id), ["NON_TCG", "TCG"]);
const reducedWriterReceiptRepair = buildCompatibilityBridgeManifest({
  selection: bridgeV2WriterReceiptRepair,
  sourceManifest
});
assert.equal(reducedWriterReceiptRepair.schema_version,
  COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION);
assert.equal(reducedWriterReceiptRepair.bridge_descriptor_id,
  COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
  "the Writer Journey repair must reuse the unchanged runtime descriptor");
assert.equal(reducedWriterReceiptRepair.bridge_marker, COMPATIBILITY_BRIDGE_V2_MARKER);
assert.equal(reducedWriterReceiptRepair.git_sha, bridgeV2WriterReceiptRepairGitSha);
assert.deepEqual(reducedWriterReceiptRepair.cases.map((entry) => entry.case_id),
  ["NON_TCG", "TCG"]);
for (const selection of [
  { ...bridgeV2Repair, bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID },
  { ...bridgeV2Repair, bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER },
  { ...bridgeV2Repair, writer_journey_manifest: COMPATIBILITY_BRIDGE_MANIFEST_VERSION }
]) {
  assert.throws(() => buildCompatibilityBridgeManifest({
    selection,
    sourceManifest
  }), (error) => error.code === "compatibility_bridge_selection_required");
}
for (const selection of [
  { ...bridgeV2WriterReceiptRepair,
    bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID },
  { ...bridgeV2WriterReceiptRepair, bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER },
  { ...bridgeV2WriterReceiptRepair,
    writer_journey_manifest: COMPATIBILITY_BRIDGE_MANIFEST_VERSION }
]) {
  assert.throws(() => buildCompatibilityBridgeManifest({
    selection,
    sourceManifest
  }), (error) => error.code === "compatibility_bridge_selection_required");
}
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
