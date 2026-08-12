#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  resolveExternalIdentitySupport
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  CSM_ACTIVE_MODEL_PROFILE
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT,
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  composeLyncaStandardNameForProfile,
  LYNCA_STANDARD_PROFILE_VERSION_V1,
  LYNCA_STANDARD_PROFILE_VERSION_V2
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  buildCsmStageRows,
  computeCsmPacketHashes,
  LYNCA_STANDARD_PROFILE_VERSION
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  CSM_PROJECTION_ACTIVATION,
  CSM_PROJECTION_STATE_ACTIVE,
  validateCsmProjectionActivation
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  composeCanonicalFieldsForStoredOutput,
  validateVerifiedOriginalObservationReplayPacket
} from "../lib/listing/thin/csm-replay.mjs";
import {
  resolveVerifiedOriginalObservation,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import {
  projectVerifiedOriginalObservationReadback,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import { composeResolutionView } from "../api/csm-resolution-view.js";
import {
  readVercelProductionRollbackReceipt
} from "./vercel-production-rollback-receipt.mjs";
import {
  WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS,
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
} from "./materialize-writer-journey-source.mjs";
import {
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT
} from "./production-standard-p0-verifier.mjs";
import {
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_CONTRACT,
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX
} from "./production-public-composition-projection.mjs";

export const ORDINARY_RELEASE_CLASS = "ordinary";
export const COMPATIBILITY_BRIDGE_RELEASE_CLASS = "compatibility-bridge";
export const COMPATIBILITY_BRIDGE_MARKER =
  "luna-v2-forward-reader-active-v1-compatibility-bridge-v1";
export const COMPATIBILITY_BRIDGE_COMMIT_TRAILER =
  "LYNCA-Release-Class: compatibility-bridge-v1";
export const COMPATIBILITY_BRIDGE_TREE_TRAILER =
  "LYNCA-Compatibility-Bridge-Tree";
export const COMPATIBILITY_BRIDGE_MANIFEST_VERSION =
  "writer-journey-compatibility-bridge-cases-v1";
export const COMPATIBILITY_BRIDGE_PARENT_SHA =
  "ced1a23741e179618e4e7b5eca055cb10ecac8cb";
export const COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID = "compatibility-bridge-v2";
export const COMPATIBILITY_BRIDGE_V2_MARKER =
  "canonical-naming-v3-overlay-forward-reader-active-v2-bridge-v1";
export const COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER =
  "LYNCA-Release-Class: compatibility-bridge";
export const COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION =
  "writer-journey-compatibility-bridge-v2-cases-v1";
export const COMPATIBILITY_BRIDGE_V2_PARENT_SHA =
  "fe7308c3e464a39279eddeebfbac13a62657cb31";
export const COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA =
  "86d19c808ad28b87f11e6b60919eb6613e7a710c";
export const COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA =
  "de55b031523237fc5572523886e25e7d3a1529d8";
export const COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID = "31491259742";
export const COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID =
  "compatibility-bridge-v2-bootstrap-repair-v1";
export const COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER =
  "canonical-naming-v3-overlay-forward-reader-active-v2-bridge-bootstrap-repair-v1";
export const COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA =
  "33f6a4d36ff4635f6e37d6c94660cd0b3e983ef6";
export const COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA =
  "8715891a30a80bf8d88f28f49552842b5d53d81f";
export const COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID = "31505892407";
export const COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID =
  "compatibility-bridge-v2-writer-receipt-repair-v1";
export const COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER =
  "canonical-naming-v3-overlay-forward-reader-active-v2-bridge-writer-receipt-repair-v1";
export const COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA =
  "45eaeb8b2ec6b0e98ed08c302c6af15b1692deda";
export const COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA =
  "9aa385321263b04a1615c7783c631c4066419c76";
export const COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID = "31509043427";
export const ACTIVE_V2_TRANSITION_PARENT_SHA =
  "3755a8f081baa57cf141685f4336999b45373562";
export const ACTIVE_V2_TRANSITION_MARKER =
  "luna-v2-active-from-forward-reader-v1";
export const CANONICAL_NAMING_ACTIVATION_PARENT_SHA =
  "62dd9ed697beeb0128ec7d353a2c7560d4a694b1";
export const CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA =
  "707e9ba0d14e331ab1e9aa532f15e01c0df5cf1c";
export const CANONICAL_NAMING_ACTIVATION_MARKER =
  "canonical-naming-v3-v02-verified-overlay-activation-v1";
export const CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID =
  "canonical-naming-activation-a2-verifier-repair-v1";
export const CANONICAL_NAMING_ACTIVATION_A2_MARKER =
  "canonical-naming-activation-a2-standard-p0-verifier-repair-v1";
export const CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA =
  "171dd51b6188de24dd0f6969c265bfd640610e0b";
export const CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA =
  "2946066d48c1818262db2fbe9150bf3079f051e4";
export const CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID = "31515428405";
export const CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA =
  CANONICAL_NAMING_ACTIVATION_PARENT_SHA;
export const CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID =
  "canonical-naming-activation-a3-public-projection-repair-v1";
export const CANONICAL_NAMING_ACTIVATION_A3_MARKER =
  "canonical-naming-activation-a3-public-composition-projection-repair-v1";
export const CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA =
  "655d00c2e2624f331bf85fa565bb5bc15bb5d4b3";
export const CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA =
  "889e7cf15a711e709227d5d4e6f6a35c2c2bc776";
export const CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID = "31517338969";
export const CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA =
  CANONICAL_NAMING_ACTIVATION_PARENT_SHA;
export const LINEAR_ORDINARY_LINEAGE_MARKER =
  "linear-ordinary-parent-rollback-v1";
export const COMPATIBILITY_BRIDGE_CHANGED_PATHS = Object.freeze([
  "docs/operations/luna-v2-rollback-bridge.md",
  "e2e/production-writer-journey.spec.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-writer-journey-contract.test.mjs"
]);
// Finalize this exact set only after the bridge-v2 repair tree is frozen. Any
// missing or unrelated path fails selection before Production credentials are
// acquired.
export const COMPATIBILITY_BRIDGE_V2_CHANGED_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  ".github/workflows/deploy-production.yml",
  "api/csm-listing-title.js",
  "api/csm-resolution-view.js",
  "api/health.js",
  "csm/contracts/resolution-view.mjs",
  "e2e/production-writer-journey.spec.mjs",
  "lib/listing/thin/canonical-naming-adapter.mjs",
  "lib/listing/thin/canonical-naming-layer.mjs",
  "lib/listing/thin/csm-orchestration.mjs",
  "lib/listing/thin/csm-persistence.mjs",
  "lib/listing/thin/csm-projection-activation.mjs",
  "lib/listing/thin/csm-replay.mjs",
  "lib/listing/thin/csm-supabase-writer.mjs",
  "lib/listing/thin/thin-listing-path.mjs",
  "lib/listing/thin/verified-original-observation-support.mjs",
  "package.json",
  "scripts/accuracy-loss-ledger.test.mjs",
  "scripts/canonical-naming-layer.test.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/csm-direct-api.test.mjs",
  "scripts/csm-model-optimization-pack.test.mjs",
  "scripts/csm-orchestration.test.mjs",
  "scripts/csm-persistence.test.mjs",
  "scripts/csm-projection-activation.test.mjs",
  "scripts/csm-replay.test.mjs",
  "scripts/csm-resolution-api.test.mjs",
  "scripts/exact-parallel-color-compaction.test.mjs",
  "scripts/production-forward-readback.mjs",
  "scripts/production-forward-readback.test.mjs",
  "scripts/production-release-boundaries.test.mjs",
  "scripts/production-writer-journey-contract.test.mjs",
  "scripts/verified-original-observation-support.test.mjs"
]);
export const COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS = Object.freeze([
  ".github/workflows/deploy-production.yml",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-release-boundaries.test.mjs"
]);
export const COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS = Object.freeze([
  "e2e/production-writer-journey.spec.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-writer-journey-contract.test.mjs"
]);
export const CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS = Object.freeze([
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
export const CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS = Object.freeze([
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-standard-p0-verifier.mjs"
]);
export const CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS = Object.freeze([
  "e2e/production-writer-journey.spec.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
  "scripts/production-parity-readback.mjs",
  "scripts/production-parity-readback.test.mjs",
  "scripts/production-public-composition-projection.mjs",
  "scripts/production-writer-journey-contract.test.mjs"
]);

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const originalSha256 = Object.freeze([
  "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
  "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
]);
const targetV2Title =
  "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls";
const expectedModelProfileId = "openai-gpt-5.6-luna-csm-v1";
const HISTORICAL_V01_RELEASE_CONTRACT_SHA256 =
  "eaffac53f6d54347cc2dcd688c6e9028304b66332a9126b5baa342f113ba8afc";
const HISTORICAL_V01_STORED_REPLAY_SHA256 =
  "a4f338d3567c64f1777ce993333fa1e4eba075270975966a1fc55063094a03a8";
const CANONICAL_NAMING_ACTIVATION_RUNTIME_CONTRACT_SHA256 =
  "22b1ae81724522aabf2b022fe8246177b751da86a423e96ad658960e69ecda84";
const CANONICAL_NAMING_ACTIVATION_A2_VERIFIER_CONTRACT = Object.freeze({
  source_asset_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
  expected_title:
    "2025-26 Topps Chrome Basketball Cooper Flagg Gold Refractor RC #251 50/50",
  expected_card_number: "251",
  rendered_card_number: "#251",
  expected_serial: "50/50"
});
const CANONICAL_NAMING_ACTIVATION_A2_VERIFIER_CONTRACT_SHA256 =
  "79c9588bc790a54a3a5088ff9ea10901ea89ab74191c69b58c12e5e9871891d5";
const CANONICAL_NAMING_ACTIVATION_A2_RUNTIME_CONTRACT_SHA256 =
  "cad6a34f87e5a3bc50e41cb4601e95fe5b29b80ebe304c79f7a9d65c86a10543";
const CANONICAL_NAMING_ACTIVATION_A3_PROJECTION_CONTRACT_SHA256 =
  "2a92ad7ffab15ec57555d215bbe2b4119becf238a6094a531ed8e7901f6fd90a";
const CANONICAL_NAMING_ACTIVATION_A3_PROJECTION_MATRIX = Object.freeze([
  ["canonical_naming:v1", "thin-marketplace-composer-v3",
    "lynca-standard-name-v0.1", true],
  ["canonical_naming:v2", "thin-marketplace-composer-v3",
    "lynca-standard-name-v0.2", true],
  ["legacy_ebay:v1", "thin-marketplace-composer-v1", "ebay-profile-v1", false],
  ["legacy_ebay:v2", "thin-marketplace-composer-v2", "ebay-profile-v1", false],
  ["external_identity:registry_thin_external_identity_high_risers_v1",
    "thin-marketplace-composer-v3-verified-external-identity",
    "ebay-verified-external-identity-v1", false],
  ["external_identity:registry_thin_external_identity_high_risers_v2",
    "thin-marketplace-composer-v4-verified-external-identity",
    "ebay-verified-external-identity-v2", false]
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
};
const exactObject = (value) => Boolean(value)
  && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => exactObject(value)
  && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function exactGitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw failure("compatibility_bridge_git_sha_invalid");
  return sha;
}

function gitText(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function bridgeCommitTree(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim());
  const classLines = lines.filter((line) => line === COMPATIBILITY_BRIDGE_COMMIT_TRAILER);
  const treeLines = lines.filter((line) => line.startsWith(
    `${COMPATIBILITY_BRIDGE_TREE_TRAILER}:`
  ));
  if (classLines.length !== 1 || treeLines.length !== 1) return null;
  const match = treeLines[0].match(new RegExp(
    `^${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ([0-9a-f]{40})$`
  ));
  return match?.[1] || null;
}

function bridgeV2CommitTree(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim());
  const classLines = lines.filter((line) => line.startsWith("LYNCA-Release-Class:"));
  const treeLines = lines.filter((line) => line.startsWith(
    `${COMPATIBILITY_BRIDGE_TREE_TRAILER}:`
  ));
  if (classLines.length !== 1
      || classLines[0] !== COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER
      || treeLines.length !== 1) {
    throw failure("compatibility_bridge_v2_commit_marker_invalid");
  }
  const match = treeLines[0].match(new RegExp(
    `^${COMPATIBILITY_BRIDGE_TREE_TRAILER}: ([0-9a-f]{40})$`
  ));
  if (!match) throw failure("compatibility_bridge_v2_commit_marker_invalid");
  return match[1];
}

function exactChangedPaths(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !value || value !== value.trim()
  )) || new Set(values).size !== values.length) {
    throw failure("compatibility_bridge_changed_paths_invalid");
  }
  const actual = [...values].sort();
  if (stableJson(actual) !== stableJson(COMPATIBILITY_BRIDGE_CHANGED_PATHS)) {
    throw failure("compatibility_bridge_changed_paths_mismatch");
  }
  return actual;
}

function exactBridgeV2ChangedPaths(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !value || value !== value.trim()
  )) || new Set(values).size !== values.length) {
    throw failure("compatibility_bridge_v2_changed_paths_invalid");
  }
  const actual = [...values].sort();
  const expected = [...COMPATIBILITY_BRIDGE_V2_CHANGED_PATHS].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw failure("compatibility_bridge_v2_changed_paths_mismatch");
  }
  return actual;
}

function exactBridgeV2RepairChangedPaths(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !value || value !== value.trim()
  )) || new Set(values).size !== values.length) {
    throw failure("compatibility_bridge_v2_repair_changed_paths_invalid");
  }
  const actual = [...values].sort();
  const expected = [...COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw failure("compatibility_bridge_v2_repair_changed_paths_mismatch");
  }
  return actual;
}

function exactBridgeV2WriterReceiptRepairChangedPaths(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !value || value !== value.trim()
  )) || new Set(values).size !== values.length) {
    throw failure("compatibility_bridge_v2_writer_receipt_repair_changed_paths_invalid");
  }
  const actual = [...values].sort();
  const expected = [...COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw failure("compatibility_bridge_v2_writer_receipt_repair_changed_paths_mismatch");
  }
  return actual;
}

function exactCanonicalNamingActivationChangedPaths(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !value || value !== value.trim()
  )) || new Set(values).size !== values.length) {
    throw failure("canonical_naming_activation_changed_paths_invalid");
  }
  const actual = [...values].sort();
  const expected = [...CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw failure("canonical_naming_activation_changed_paths_mismatch");
  }
  return actual;
}

function exactCanonicalNamingActivationA2ChangedPaths(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !value || value !== value.trim()
  )) || new Set(values).size !== values.length) {
    throw failure("canonical_naming_activation_a2_changed_paths_invalid");
  }
  const actual = [...values].sort();
  const expected = [...CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw failure("canonical_naming_activation_a2_changed_paths_mismatch");
  }
  return actual;
}

function exactCanonicalNamingActivationA3ChangedPaths(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !value || value !== value.trim()
  )) || new Set(values).size !== values.length) {
    throw failure("canonical_naming_activation_a3_changed_paths_invalid");
  }
  const actual = [...values].sort();
  const expected = [...CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw failure("canonical_naming_activation_a3_changed_paths_mismatch");
  }
  return actual;
}

function bridgeV2ArtifactManifestSha256(changedPaths) {
  return sha256(stableJson({
    parent_git_sha: COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
    parent_tree_sha: COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
    failed_run_id: COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID,
    required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
    changed_paths: exactBridgeV2ChangedPaths(changedPaths)
  }));
}

function bridgeV2RepairArtifactManifestSha256(changedPaths) {
  return sha256(stableJson({
    bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID,
    repair_marker: COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER,
    parent_git_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
    parent_tree_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
    failed_run_id: COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID,
    required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
    changed_paths: exactBridgeV2RepairChangedPaths(changedPaths)
  }));
}

function bridgeV2WriterReceiptRepairArtifactManifestSha256(changedPaths) {
  return sha256(stableJson({
    bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID,
    repair_marker: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER,
    parent_git_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
    parent_tree_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
    failed_run_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID,
    required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
    changed_paths: exactBridgeV2WriterReceiptRepairChangedPaths(changedPaths)
  }));
}

function canonicalNamingActivationArtifactManifestSha256(changedPaths) {
  return sha256(stableJson({
    activation_marker: CANONICAL_NAMING_ACTIVATION_MARKER,
    parent_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
    parent_tree_sha: CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
    changed_paths: exactCanonicalNamingActivationChangedPaths(changedPaths)
  }));
}

function canonicalNamingActivationA2ArtifactManifestSha256(changedPaths) {
  return sha256(stableJson({
    repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID,
    repair_marker: CANONICAL_NAMING_ACTIVATION_A2_MARKER,
    parent_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
    parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
    failed_run_id: CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
    changed_paths: exactCanonicalNamingActivationA2ChangedPaths(changedPaths)
  }));
}

function canonicalNamingActivationA3ArtifactManifestSha256(changedPaths) {
  return sha256(stableJson({
    repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID,
    repair_marker: CANONICAL_NAMING_ACTIVATION_A3_MARKER,
    parent_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
    parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
    failed_run_id: CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
    changed_paths: exactCanonicalNamingActivationA3ChangedPaths(changedPaths)
  }));
}

function ordinaryTransitionMarker(parentGitSha) {
  if (parentGitSha === CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA) {
    return CANONICAL_NAMING_ACTIVATION_A3_MARKER;
  }
  if (parentGitSha === CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA) {
    return CANONICAL_NAMING_ACTIVATION_A2_MARKER;
  }
  if (parentGitSha === CANONICAL_NAMING_ACTIVATION_PARENT_SHA) {
    return CANONICAL_NAMING_ACTIVATION_MARKER;
  }
  return parentGitSha === ACTIVE_V2_TRANSITION_PARENT_SHA
    ? ACTIVE_V2_TRANSITION_MARKER
    : null;
}

function gitParentShas(sha) {
  const parts = gitText(["rev-list", "--parents", "-n", "1", sha]).split(/\s+/);
  if (parts.shift() !== sha) throw failure("compatibility_bridge_parent_invalid");
  return parts;
}

function gitChangedPaths(parentSha, sha) {
  const value = gitText([
    "diff-tree", "--no-commit-id", "--name-only", "-r", parentSha, sha
  ]);
  return value ? value.split("\n") : [];
}

export function verifyCompatibilityBridgeSelection({
  releaseClass,
  gitSha,
  headSha = null,
  commitMessage = null,
  headTreeSha = null,
  parentTreeSha = null,
  parentShas = null,
  changedPaths = null
} = {}) {
  const selected = String(releaseClass || "").trim();
  if (![ORDINARY_RELEASE_CLASS, COMPATIBILITY_BRIDGE_RELEASE_CLASS].includes(selected)) {
    throw failure("release_class_invalid");
  }
  const expectedSha = exactGitSha(gitSha);
  const actualHead = exactGitSha(headSha ?? gitText(["rev-parse", "HEAD"]));
  if (actualHead !== expectedSha) throw failure("compatibility_bridge_head_sha_mismatch");
  if (selected === ORDINARY_RELEASE_CLASS) {
    const parents = parentShas ?? gitParentShas(expectedSha);
    if (!Array.isArray(parents) || parents.length !== 1) {
      throw failure("ordinary_release_parent_invalid");
    }
    const parentGitSha = exactGitSha(parents[0]);
    if (parentGitSha === COMPATIBILITY_BRIDGE_V2_PARENT_SHA) {
      throw failure("ordinary_release_failed_parent_requires_compatibility_bridge_v2");
    }
    if (parentGitSha === COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA) {
      throw failure("ordinary_release_failed_bridge_requires_compatibility_bridge_v2_repair");
    }
    if (parentGitSha === COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA) {
      throw failure("ordinary_release_failed_bridge_requires_writer_receipt_repair");
    }
    const transitionMarker = ordinaryTransitionMarker(parentGitSha);
    if (parentGitSha === CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA) {
      const actualParentTree = exactGitSha(parentTreeSha ?? gitText([
        "rev-parse", `${CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA}^{tree}`
      ]));
      if (actualParentTree !== CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA) {
        throw failure("canonical_naming_activation_a3_parent_tree_mismatch");
      }
      const artifactPaths = exactCanonicalNamingActivationA3ChangedPaths(
        changedPaths ?? gitChangedPaths(CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA, expectedSha)
      );
      const repairContract = canonicalNamingActivationA3RuntimeContractProof();
      return Object.freeze({
        schema_version: "production-release-selection-v7",
        release_class: selected,
        repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID,
        lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
        transition_marker: CANONICAL_NAMING_ACTIVATION_A3_MARKER,
        parent_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
        parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
        failed_run_id: CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID,
        required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
        artifact_manifest_sha256:
          canonicalNamingActivationA3ArtifactManifestSha256(artifactPaths),
        git_sha: expectedSha,
        writer_journey_manifest: "writer-journey-cases-v3",
        parity_required: true,
        contract_sha256: repairContract.contract_sha256
      });
    }
    if (parentGitSha === CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA) {
      const actualParentTree = exactGitSha(parentTreeSha ?? gitText([
        "rev-parse", `${CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA}^{tree}`
      ]));
      if (actualParentTree !== CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA) {
        throw failure("canonical_naming_activation_a2_parent_tree_mismatch");
      }
      const artifactPaths = exactCanonicalNamingActivationA2ChangedPaths(
        changedPaths ?? gitChangedPaths(CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA, expectedSha)
      );
      const repairContract = canonicalNamingActivationA2RuntimeContractProof();
      return Object.freeze({
        schema_version: "production-release-selection-v6",
        release_class: selected,
        repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID,
        lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
        transition_marker: CANONICAL_NAMING_ACTIVATION_A2_MARKER,
        parent_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
        parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
        failed_run_id: CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID,
        required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
        artifact_manifest_sha256:
          canonicalNamingActivationA2ArtifactManifestSha256(artifactPaths),
        git_sha: expectedSha,
        writer_journey_manifest: "writer-journey-cases-v3",
        parity_required: true,
        contract_sha256: repairContract.contract_sha256
      });
    }
    const contract = activeV2OrdinaryRuntimeContractProof({ parentGitSha });
    if (parentGitSha === CANONICAL_NAMING_ACTIVATION_PARENT_SHA) {
      const actualParentTree = exactGitSha(parentTreeSha ?? gitText([
        "rev-parse", `${CANONICAL_NAMING_ACTIVATION_PARENT_SHA}^{tree}`
      ]));
      if (actualParentTree !== CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA) {
        throw failure("canonical_naming_activation_parent_tree_mismatch");
      }
      const artifactPaths = exactCanonicalNamingActivationChangedPaths(
        changedPaths ?? gitChangedPaths(CANONICAL_NAMING_ACTIVATION_PARENT_SHA, expectedSha)
      );
      return Object.freeze({
        schema_version: "production-release-selection-v4",
        release_class: selected,
        lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
        transition_marker: CANONICAL_NAMING_ACTIVATION_MARKER,
        parent_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
        parent_tree_sha: CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
        required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
        artifact_manifest_sha256:
          canonicalNamingActivationArtifactManifestSha256(artifactPaths),
        git_sha: expectedSha,
        writer_journey_manifest: "writer-journey-cases-v3",
        parity_required: true,
        contract_sha256: contract.contract_sha256
      });
    }
    return Object.freeze({
      schema_version: "production-release-selection-v3",
      release_class: selected,
      lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
      transition_marker: transitionMarker,
      parent_git_sha: parentGitSha,
      required_rollback_git_sha: parentGitSha,
      git_sha: expectedSha,
      writer_journey_manifest: "writer-journey-cases-v3",
      parity_required: true,
      contract_sha256: contract.contract_sha256
    });
  }
  const bridgeParents = parentShas ?? gitParentShas(expectedSha);
  if (!Array.isArray(bridgeParents) || bridgeParents.length !== 1) {
    throw failure("compatibility_bridge_parent_invalid");
  }
  const bridgeParent = exactGitSha(bridgeParents[0]);
  if (bridgeParent === COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA) {
    const message = commitMessage ?? gitText(["show", "-s", "--format=%B", expectedSha]);
    const messageTree = bridgeV2CommitTree(message);
    const actualTree = exactGitSha(
      headTreeSha ?? gitText(["rev-parse", `${expectedSha}^{tree}`])
    );
    if (messageTree !== actualTree) {
      throw failure("compatibility_bridge_v2_writer_receipt_repair_tree_mismatch");
    }
    const actualParentTree = exactGitSha(parentTreeSha ?? gitText([
      "rev-parse", `${COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA}^{tree}`
    ]));
    if (actualParentTree !== COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA) {
      throw failure("compatibility_bridge_v2_writer_receipt_repair_parent_tree_mismatch");
    }
    const artifactPaths = exactBridgeV2WriterReceiptRepairChangedPaths(
      changedPaths ?? gitChangedPaths(
        COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
        expectedSha
      )
    );
    const contract = compatibilityBridgeV2RuntimeContractProof();
    return Object.freeze({
      schema_version: "production-release-selection-v5",
      release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID,
      bridge_marker: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER,
      commit_trailer_sha256: sha256(COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER),
      git_tree_sha: actualTree,
      parent_git_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
      parent_tree_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
      failed_run_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID,
      required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
      artifact_manifest_sha256:
        bridgeV2WriterReceiptRepairArtifactManifestSha256(artifactPaths),
      git_sha: expectedSha,
      writer_journey_manifest: COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION,
      parity_required: false,
      contract_sha256: contract.contract_sha256
    });
  }
  if (bridgeParent === COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA) {
    const message = commitMessage ?? gitText(["show", "-s", "--format=%B", expectedSha]);
    const messageTree = bridgeV2CommitTree(message);
    const actualTree = exactGitSha(
      headTreeSha ?? gitText(["rev-parse", `${expectedSha}^{tree}`])
    );
    if (messageTree !== actualTree) {
      throw failure("compatibility_bridge_v2_repair_tree_mismatch");
    }
    const actualParentTree = exactGitSha(parentTreeSha ?? gitText([
      "rev-parse", `${COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA}^{tree}`
    ]));
    if (actualParentTree !== COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA) {
      throw failure("compatibility_bridge_v2_repair_parent_tree_mismatch");
    }
    const artifactPaths = exactBridgeV2RepairChangedPaths(
      changedPaths ?? gitChangedPaths(COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA, expectedSha)
    );
    const contract = compatibilityBridgeV2RuntimeContractProof();
    return Object.freeze({
      schema_version: "production-release-selection-v4",
      release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID,
      bridge_marker: COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER,
      commit_trailer_sha256: sha256(COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER),
      git_tree_sha: actualTree,
      parent_git_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
      parent_tree_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
      failed_run_id: COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID,
      required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
      artifact_manifest_sha256: bridgeV2RepairArtifactManifestSha256(artifactPaths),
      git_sha: expectedSha,
      writer_journey_manifest: COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION,
      parity_required: false,
      contract_sha256: contract.contract_sha256
    });
  }
  if (bridgeParent === COMPATIBILITY_BRIDGE_V2_PARENT_SHA) {
    const message = commitMessage ?? gitText(["show", "-s", "--format=%B", expectedSha]);
    const messageTree = bridgeV2CommitTree(message);
    const actualTree = exactGitSha(
      headTreeSha ?? gitText(["rev-parse", `${expectedSha}^{tree}`])
    );
    if (messageTree !== actualTree) throw failure("compatibility_bridge_v2_tree_mismatch");
    const actualParentTree = exactGitSha(parentTreeSha ?? gitText([
      "rev-parse", `${COMPATIBILITY_BRIDGE_V2_PARENT_SHA}^{tree}`
    ]));
    if (actualParentTree !== COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA) {
      throw failure("compatibility_bridge_v2_parent_tree_mismatch");
    }
    const artifactPaths = exactBridgeV2ChangedPaths(
      changedPaths ?? gitChangedPaths(COMPATIBILITY_BRIDGE_V2_PARENT_SHA, expectedSha)
    );
    const contract = compatibilityBridgeV2RuntimeContractProof();
    return Object.freeze({
      schema_version: "production-release-selection-v2",
      release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
      bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER,
      commit_trailer_sha256: sha256(COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER),
      git_tree_sha: actualTree,
      parent_git_sha: COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
      parent_tree_sha: COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
      failed_run_id: COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID,
      required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
      artifact_manifest_sha256: bridgeV2ArtifactManifestSha256(artifactPaths),
      git_sha: expectedSha,
      writer_journey_manifest: COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION,
      parity_required: false,
      contract_sha256: contract.contract_sha256
    });
  }
  const message = commitMessage ?? gitText(["show", "-s", "--format=%B", expectedSha]);
  const messageTree = bridgeCommitTree(message);
  if (!messageTree) {
    throw failure("compatibility_bridge_commit_marker_missing");
  }
  const actualTree = exactGitSha(
    headTreeSha ?? gitText(["rev-parse", `${expectedSha}^{tree}`])
  );
  if (messageTree !== actualTree) throw failure("compatibility_bridge_tree_mismatch");
  if (bridgeParent !== COMPATIBILITY_BRIDGE_PARENT_SHA) {
    throw failure("compatibility_bridge_parent_mismatch");
  }
  const artifactPaths = exactChangedPaths(
    changedPaths ?? gitChangedPaths(COMPATIBILITY_BRIDGE_PARENT_SHA, expectedSha)
  );
  const contract = compatibilityBridgeRuntimeContractProof();
  return Object.freeze({
    schema_version: "production-release-selection-v1",
    release_class: selected,
    bridge_marker: COMPATIBILITY_BRIDGE_MARKER,
    commit_trailer_sha256: sha256(COMPATIBILITY_BRIDGE_COMMIT_TRAILER),
    git_tree_sha: actualTree,
    parent_git_sha: COMPATIBILITY_BRIDGE_PARENT_SHA,
    artifact_manifest_sha256: sha256(stableJson({
      parent_git_sha: COMPATIBILITY_BRIDGE_PARENT_SHA,
      changed_paths: artifactPaths
    })),
    git_sha: expectedSha,
    writer_journey_manifest: COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
    parity_required: false,
    contract_sha256: contract.contract_sha256
  });
}

export function activeV2OrdinaryRuntimeContractProof({
  parentGitSha = ACTIVE_V2_TRANSITION_PARENT_SHA
} = {}) {
  const parent = exactGitSha(parentGitSha);
  const transitionMarker = ordinaryTransitionMarker(parent);
  let projectionState;
  try {
    projectionState = validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION);
  } catch {
    throw failure("canonical_naming_activation_runtime_contract_invalid");
  }
  const historicalV01Replay = composeCanonicalFieldsForStoredOutput({
    year: "2025",
    manufacturer: "Topps",
    product: "Chrome",
    set: "",
    subjects: ["Bridge Test Player"],
    team: "Test Team",
    card_name: "",
    release_variant: "",
    print_finish: "",
    surface_color: "",
    parallel_family: "",
    parallel_exact: "",
    descriptive_rarity: "",
    card_number: "1",
    serial: "",
    attributes: [],
    components: [],
    search_optimization: [],
    grade: "",
    grading_info: null,
    grammar: "standard",
    lot_count: "",
    unreadable: [],
    low_confidence: []
  }, {
    marketplace: "EBAY",
    composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V1.composer_version,
    marketplace_profile_version:
      CANONICAL_NAMING_RELEASE_CONTRACT_V1.marketplace_profile_version
  });
  const projectionActive = projectionState.state === CSM_PROJECTION_STATE_ACTIVE
    && CANONICAL_NAMING_RELEASE_CONTRACT === CANONICAL_NAMING_RELEASE_CONTRACT_V2
    && LYNCA_STANDARD_PROFILE_VERSION
      === CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
    && stableJson(CSM_PROJECTION_ACTIVATION.active_writer.standard) === stableJson({
      composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
      marketplace_profile_version:
        CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
    })
    && CSM_PROJECTION_ACTIVATION.active_writer.verified_original_observation_overlay
      === VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
    && sha256(stableJson(CANONICAL_NAMING_RELEASE_CONTRACT_V1))
      === HISTORICAL_V01_RELEASE_CONTRACT_SHA256
    && historicalV01Replay.title
      === "2025 Topps Chrome Bridge Test Player Test Team #1"
    && sha256(stableJson(historicalV01Replay)) === HISTORICAL_V01_STORED_REPLAY_SHA256
    && CSM_ACTIVE_MODEL_PROFILE.reasoning_effort === "low";
  if (!projectionActive) {
    throw failure("canonical_naming_activation_runtime_contract_invalid");
  }
  const v2 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v2;
  const corrected = resolveExternalIdentitySupport({
    year: "1994-95",
    manufacturer: "Topps",
    product: "Stadium Club",
    set: "Hardwood Heroes",
    subjects: ["Michael Jordan"],
    team: "Bulls",
    card_number: "HR 14"
  }, { externalIdentityContext: { originalImageSha256: originalSha256 } });
  const replay = composeCanonicalFieldsForStoredOutput({
    ...corrected.fields,
    card_name: "",
    release_variant: "",
    surface_color: "",
    parallel_family: "",
    parallel_exact: "",
    descriptive_rarity: "",
    serial: "",
    attributes: [],
    grade: "",
    grammar: "standard",
    lot_count: "",
    unreadable: [],
    low_confidence: []
  }, { marketplace: "EBAY", ...v2.output });
  const activeIsV2 = EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID === v2.receipt.registry_release_id
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id === v2.receipt.registry_release_id
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.resolver_version
      === v2.resolution.resolver_version
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.conflict_policy_version
      === v2.resolution.conflict_policy_version
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version
      === v2.output.composer_version
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version
      === v2.output.marketplace_profile_version
    && THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id
      === v2.receipt.registry_release_id
    && CSM_ACTIVE_MODEL_PROFILE.id === expectedModelProfileId
    && corrected.status === "APPLIED"
    && corrected.receipt?.match_mode === "VERIFIED_ORIGINAL_SET"
    && stableJson(corrected.receipt?.corrected_fields) === stableJson(["set", "year"])
    && replay.title === targetV2Title;
  if (!activeIsV2) throw failure("active_v2_transition_runtime_contract_invalid");
  const body = {
    schema_version: "canonical-naming-activation-runtime-contract-proof-v1",
    lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
    transition_marker: transitionMarker,
    required_parent_git_sha: parent,
    active_registry_release_id: v2.receipt.registry_release_id,
    active_resolver_version: v2.resolution.resolver_version,
    active_conflict_policy_version: v2.resolution.conflict_policy_version,
    active_composer_version: v2.output.composer_version,
    active_marketplace_profile_version: v2.output.marketplace_profile_version,
    active_standard_writer_composer_version:
      CSM_PROJECTION_ACTIVATION.active_writer.standard.composer_version,
    active_standard_writer_marketplace_profile_version:
      CSM_PROJECTION_ACTIVATION.active_writer.standard.marketplace_profile_version,
    active_verified_original_observation_overlay:
      CSM_PROJECTION_ACTIVATION.active_writer.verified_original_observation_overlay,
    projection_activation_sha256: CSM_PROJECTION_ACTIVATION.activation_sha256,
    historical_v01_release_contract_sha256: HISTORICAL_V01_RELEASE_CONTRACT_SHA256,
    historical_v01_stored_replay_sha256: HISTORICAL_V01_STORED_REPLAY_SHA256,
    active_model_profile_id: expectedModelProfileId,
    active_model_reasoning_effort: CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
    verified_original_set_conflict_behavior: "CORRECTED",
    expected_title_sha256: sha256(targetV2Title),
    provider_calls: 0
  };
  return Object.freeze({ ...body, contract_sha256: sha256(stableJson(body)) });
}

export function canonicalNamingActivationA2RuntimeContractProof({
  verifierContract = PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT
} = {}) {
  const verifierKeys = [
    "source_asset_id", "expected_title", "expected_card_number",
    "rendered_card_number", "expected_serial"
  ];
  const verifierContractSha256 = sha256(stableJson(verifierContract));
  if (!exactKeys(verifierContract, verifierKeys)
      || stableJson(verifierContract)
        !== stableJson(CANONICAL_NAMING_ACTIVATION_A2_VERIFIER_CONTRACT)
      || verifierContractSha256
        !== CANONICAL_NAMING_ACTIVATION_A2_VERIFIER_CONTRACT_SHA256) {
    throw failure("canonical_naming_activation_a2_verifier_contract_invalid");
  }
  const baseActivationProof = activeV2OrdinaryRuntimeContractProof({
    parentGitSha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA
  });
  if (baseActivationProof.contract_sha256
      !== CANONICAL_NAMING_ACTIVATION_RUNTIME_CONTRACT_SHA256) {
    throw failure("canonical_naming_activation_a2_base_runtime_contract_invalid");
  }
  const body = {
    schema_version: "canonical-naming-activation-a2-runtime-contract-proof-v1",
    repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID,
    repair_marker: CANONICAL_NAMING_ACTIVATION_A2_MARKER,
    required_parent_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
    required_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
    failed_run_id: CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
    base_activation_runtime_contract_sha256: baseActivationProof.contract_sha256,
    verifier_source_asset_id: verifierContract.source_asset_id,
    verifier_expected_title: verifierContract.expected_title,
    verifier_expected_card_number: verifierContract.expected_card_number,
    verifier_rendered_card_number: verifierContract.rendered_card_number,
    verifier_expected_serial: verifierContract.expected_serial,
    verifier_contract_sha256: verifierContractSha256,
    provider_calls: 0
  };
  return Object.freeze({ ...body, contract_sha256: sha256(stableJson(body)) });
}

export function canonicalNamingActivationA3RuntimeContractProof({
  projectionContract = PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_CONTRACT,
  projectionMatrix = PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX,
  baseA2Proof = canonicalNamingActivationA2RuntimeContractProof()
} = {}) {
  const compactMatrix = Array.isArray(projectionMatrix)
    ? projectionMatrix.map((entry) => [
      entry?.id,
      entry?.composer_version,
      entry?.marketplace_profile_version,
      entry?.marketplace_profile_public
    ])
    : null;
  const matrixShapeValid = Array.isArray(projectionMatrix)
    && projectionMatrix.length === CANONICAL_NAMING_ACTIVATION_A3_PROJECTION_MATRIX.length
    && projectionMatrix.every((entry) => exactKeys(entry, [
      "id", "composer_version", "marketplace_profile_version",
      "marketplace_profile_public", "public_output_keys"
    ]) && stableJson(entry.public_output_keys) === stableJson(
      entry.marketplace_profile_public
        ? ["composer_version", "contract_version", "marketplace_profile_version"]
        : ["composer_version", "contract_version"]
    ));
  const contractPayload = {
    schema_version: "production-public-composition-projection-contract-v1",
    projections: projectionMatrix
  };
  if (!matrixShapeValid
      || stableJson(compactMatrix)
        !== stableJson(CANONICAL_NAMING_ACTIVATION_A3_PROJECTION_MATRIX)
      || !exactKeys(projectionContract, [
        "schema_version", "projections", "contract_sha256"
      ])
      || projectionContract.schema_version !== contractPayload.schema_version
      || stableJson(projectionContract.projections) !== stableJson(projectionMatrix)
      || projectionContract.contract_sha256
        !== CANONICAL_NAMING_ACTIVATION_A3_PROJECTION_CONTRACT_SHA256
      || sha256(JSON.stringify(contractPayload)) !== projectionContract.contract_sha256) {
    throw failure("canonical_naming_activation_a3_projection_contract_invalid");
  }
  const expectedA2Proof = canonicalNamingActivationA2RuntimeContractProof();
  if (!exactObject(baseA2Proof)
      || stableJson(baseA2Proof) !== stableJson(expectedA2Proof)
      || baseA2Proof.contract_sha256
        !== CANONICAL_NAMING_ACTIVATION_A2_RUNTIME_CONTRACT_SHA256
      || baseA2Proof.base_activation_runtime_contract_sha256
        !== CANONICAL_NAMING_ACTIVATION_RUNTIME_CONTRACT_SHA256) {
    throw failure("canonical_naming_activation_a3_base_runtime_contract_invalid");
  }
  const body = {
    schema_version: "canonical-naming-activation-a3-runtime-contract-proof-v1",
    repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID,
    repair_marker: CANONICAL_NAMING_ACTIVATION_A3_MARKER,
    required_parent_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
    required_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
    failed_run_id: CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID,
    required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
    base_activation_a2_runtime_contract_sha256: baseA2Proof.contract_sha256,
    base_activation_runtime_contract_sha256:
      baseA2Proof.base_activation_runtime_contract_sha256,
    public_projection_schema_version: projectionContract.schema_version,
    public_projection_contract_sha256: projectionContract.contract_sha256,
    public_projection_matrix_sha256: sha256(stableJson(projectionMatrix)),
    registered_tuple_count: projectionMatrix.length,
    public_profile_tuple_count: projectionMatrix.filter(
      (entry) => entry.marketplace_profile_public
    ).length,
    hidden_profile_tuple_count: projectionMatrix.filter(
      (entry) => !entry.marketplace_profile_public
    ).length,
    verifier_consumers: Object.freeze([
      "production-parity-readback", "production-writer-journey"
    ]),
    provider_calls: 0
  };
  return Object.freeze({ ...body, contract_sha256: sha256(stableJson(body)) });
}

export function verifyOrdinaryRollbackLineage({
  selection,
  rollbackReceipt
} = {}) {
  if (selection?.schema_version === "production-release-selection-v7") {
    if (!exactKeys(selection, [
      "schema_version", "release_class", "repair_descriptor_id", "lineage_marker",
      "transition_marker", "parent_git_sha", "parent_tree_sha", "failed_run_id",
      "required_rollback_git_sha", "artifact_manifest_sha256", "git_sha",
      "writer_journey_manifest", "parity_required", "contract_sha256"
    ])
        || selection.release_class !== ORDINARY_RELEASE_CLASS
        || selection.repair_descriptor_id !== CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID
        || selection.lineage_marker !== LINEAR_ORDINARY_LINEAGE_MARKER
        || selection.transition_marker !== CANONICAL_NAMING_ACTIVATION_A3_MARKER
        || selection.parent_git_sha !== CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA
        || selection.parent_tree_sha !== CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA
        || selection.failed_run_id !== CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID
        || selection.required_rollback_git_sha !== CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA
        || selection.artifact_manifest_sha256
          !== canonicalNamingActivationA3ArtifactManifestSha256(
            CANONICAL_NAMING_ACTIVATION_A3_CHANGED_PATHS
          )
        || selection.writer_journey_manifest !== "writer-journey-cases-v3"
        || selection.parity_required !== true
        || selection.contract_sha256
          !== canonicalNamingActivationA3RuntimeContractProof().contract_sha256
        || !/^[0-9a-f]{40}$/.test(String(selection.git_sha || ""))) {
      throw failure("ordinary_release_activation_a3_selection_invalid");
    }
    const capturedRollbackSha = exactGitSha(rollbackReceipt?.git_sha);
    if (capturedRollbackSha !== CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA) {
      throw failure("ordinary_release_rollback_mismatch");
    }
    return Object.freeze({
      schema_version: "production-release-rollback-lineage-receipt-v8",
      release_class: ORDINARY_RELEASE_CLASS,
      repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A3_DESCRIPTOR_ID,
      lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
      transition_marker: CANONICAL_NAMING_ACTIVATION_A3_MARKER,
      release_git_sha: exactGitSha(selection.git_sha),
      release_parent_git_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA,
      release_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A3_PARENT_TREE_SHA,
      failed_run_id: CANONICAL_NAMING_ACTIVATION_A3_FAILED_RUN_ID,
      required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A3_ROLLBACK_SHA,
      captured_rollback_git_sha: capturedRollbackSha,
      artifact_manifest_sha256: selection.artifact_manifest_sha256,
      lineage_verified: true
    });
  }
  if (selection?.schema_version === "production-release-selection-v6") {
    if (!exactKeys(selection, [
      "schema_version", "release_class", "repair_descriptor_id", "lineage_marker",
      "transition_marker", "parent_git_sha", "parent_tree_sha", "failed_run_id",
      "required_rollback_git_sha", "artifact_manifest_sha256", "git_sha",
      "writer_journey_manifest", "parity_required", "contract_sha256"
    ])
        || selection.release_class !== ORDINARY_RELEASE_CLASS
        || selection.repair_descriptor_id !== CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID
        || selection.lineage_marker !== LINEAR_ORDINARY_LINEAGE_MARKER
        || selection.transition_marker !== CANONICAL_NAMING_ACTIVATION_A2_MARKER
        || selection.parent_git_sha !== CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA
        || selection.parent_tree_sha !== CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA
        || selection.failed_run_id !== CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID
        || selection.required_rollback_git_sha !== CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA
        || selection.artifact_manifest_sha256
          !== canonicalNamingActivationA2ArtifactManifestSha256(
            CANONICAL_NAMING_ACTIVATION_A2_CHANGED_PATHS
          )
        || selection.writer_journey_manifest !== "writer-journey-cases-v3"
        || selection.parity_required !== true
        || selection.contract_sha256
          !== canonicalNamingActivationA2RuntimeContractProof().contract_sha256
        || !/^[0-9a-f]{40}$/.test(String(selection.git_sha || ""))) {
      throw failure("ordinary_release_activation_a2_selection_invalid");
    }
    const capturedRollbackSha = exactGitSha(rollbackReceipt?.git_sha);
    if (capturedRollbackSha !== CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA) {
      throw failure("ordinary_release_rollback_mismatch");
    }
    return Object.freeze({
      schema_version: "production-release-rollback-lineage-receipt-v7",
      release_class: ORDINARY_RELEASE_CLASS,
      repair_descriptor_id: CANONICAL_NAMING_ACTIVATION_A2_DESCRIPTOR_ID,
      lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
      transition_marker: CANONICAL_NAMING_ACTIVATION_A2_MARKER,
      release_git_sha: exactGitSha(selection.git_sha),
      release_parent_git_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA,
      release_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_A2_PARENT_TREE_SHA,
      failed_run_id: CANONICAL_NAMING_ACTIVATION_A2_FAILED_RUN_ID,
      required_rollback_git_sha: CANONICAL_NAMING_ACTIVATION_A2_ROLLBACK_SHA,
      captured_rollback_git_sha: capturedRollbackSha,
      artifact_manifest_sha256: selection.artifact_manifest_sha256,
      lineage_verified: true
    });
  }
  if (selection?.schema_version === "production-release-selection-v4") {
    if (!exactKeys(selection, [
      "schema_version", "release_class", "lineage_marker", "transition_marker",
      "parent_git_sha", "parent_tree_sha", "required_rollback_git_sha",
      "artifact_manifest_sha256", "git_sha", "writer_journey_manifest",
      "parity_required", "contract_sha256"
    ])
        || selection.release_class !== ORDINARY_RELEASE_CLASS
        || selection.lineage_marker !== LINEAR_ORDINARY_LINEAGE_MARKER
        || selection.transition_marker !== CANONICAL_NAMING_ACTIVATION_MARKER
        || selection.parent_git_sha !== CANONICAL_NAMING_ACTIVATION_PARENT_SHA
        || selection.parent_tree_sha !== CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA
        || selection.required_rollback_git_sha !== CANONICAL_NAMING_ACTIVATION_PARENT_SHA
        || selection.artifact_manifest_sha256
          !== canonicalNamingActivationArtifactManifestSha256(
            CANONICAL_NAMING_ACTIVATION_CHANGED_PATHS
          )
        || selection.writer_journey_manifest !== "writer-journey-cases-v3"
        || selection.parity_required !== true
        || selection.contract_sha256 !== activeV2OrdinaryRuntimeContractProof({
          parentGitSha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA
        }).contract_sha256
        || !/^[0-9a-f]{40}$/.test(String(selection.git_sha || ""))) {
      throw failure("ordinary_release_activation_selection_invalid");
    }
    const capturedRollbackSha = exactGitSha(rollbackReceipt?.git_sha);
    if (capturedRollbackSha !== CANONICAL_NAMING_ACTIVATION_PARENT_SHA) {
      throw failure("ordinary_release_rollback_mismatch");
    }
    return Object.freeze({
      schema_version: "production-release-rollback-lineage-receipt-v6",
      release_class: ORDINARY_RELEASE_CLASS,
      lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
      transition_marker: CANONICAL_NAMING_ACTIVATION_MARKER,
      release_git_sha: exactGitSha(selection.git_sha),
      release_parent_git_sha: CANONICAL_NAMING_ACTIVATION_PARENT_SHA,
      release_parent_tree_sha: CANONICAL_NAMING_ACTIVATION_PARENT_TREE_SHA,
      captured_rollback_git_sha: capturedRollbackSha,
      artifact_manifest_sha256: selection.artifact_manifest_sha256,
      lineage_verified: true
    });
  }
  if (!exactKeys(selection, [
    "schema_version", "release_class", "lineage_marker", "transition_marker",
    "parent_git_sha", "required_rollback_git_sha", "git_sha",
    "writer_journey_manifest", "parity_required", "contract_sha256"
  ])
      || selection.schema_version !== "production-release-selection-v3"
      || selection.release_class !== ORDINARY_RELEASE_CLASS
      || selection.lineage_marker !== LINEAR_ORDINARY_LINEAGE_MARKER
      || selection.writer_journey_manifest !== "writer-journey-cases-v3"
      || selection.parity_required !== true
      || !/^[0-9a-f]{64}$/.test(String(selection.contract_sha256 || ""))) {
    throw failure("ordinary_release_selection_invalid");
  }
  const parentGitSha = exactGitSha(selection.parent_git_sha);
  if (parentGitSha === CANONICAL_NAMING_ACTIVATION_A3_PARENT_SHA) {
    throw failure("ordinary_release_activation_a3_selection_invalid");
  }
  if (parentGitSha === CANONICAL_NAMING_ACTIVATION_A2_PARENT_SHA) {
    throw failure("ordinary_release_activation_a2_selection_invalid");
  }
  if (parentGitSha === CANONICAL_NAMING_ACTIVATION_PARENT_SHA) {
    throw failure("ordinary_release_activation_selection_invalid");
  }
  const requiredRollbackSha = exactGitSha(selection.required_rollback_git_sha);
  const expectedTransitionMarker = ordinaryTransitionMarker(parentGitSha);
  if (requiredRollbackSha !== parentGitSha
      || selection.transition_marker !== expectedTransitionMarker) {
    throw failure("ordinary_release_selection_invalid");
  }
  const capturedRollbackSha = exactGitSha(rollbackReceipt?.git_sha);
  if (capturedRollbackSha !== parentGitSha) {
    throw failure("ordinary_release_rollback_mismatch");
  }
  return Object.freeze({
    schema_version: "production-release-rollback-lineage-receipt-v2",
    release_class: ORDINARY_RELEASE_CLASS,
    lineage_marker: LINEAR_ORDINARY_LINEAGE_MARKER,
    transition_marker: expectedTransitionMarker,
    release_git_sha: exactGitSha(selection.git_sha),
    release_parent_git_sha: parentGitSha,
    captured_rollback_git_sha: capturedRollbackSha,
    lineage_verified: true
  });
}

function verifyCompatibilityBridgeV2RepairRollbackLineage({
  selection,
  rollbackReceipt
} = {}) {
  if (!exactKeys(selection, [
    "schema_version", "release_class", "bridge_descriptor_id", "bridge_marker",
    "commit_trailer_sha256", "git_tree_sha", "parent_git_sha", "parent_tree_sha",
    "failed_run_id", "required_rollback_git_sha", "artifact_manifest_sha256",
    "git_sha", "writer_journey_manifest", "parity_required", "contract_sha256"
  ])
      || selection.schema_version !== "production-release-selection-v4"
      || selection.release_class !== COMPATIBILITY_BRIDGE_RELEASE_CLASS
      || selection.bridge_descriptor_id !== COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID
      || selection.bridge_marker !== COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER
      || selection.commit_trailer_sha256 !== sha256(COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER)
      || selection.parent_git_sha !== COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA
      || selection.parent_tree_sha !== COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA
      || selection.failed_run_id !== COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID
      || selection.required_rollback_git_sha !== COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA
      || selection.artifact_manifest_sha256
        !== bridgeV2RepairArtifactManifestSha256(
          COMPATIBILITY_BRIDGE_V2_REPAIR_CHANGED_PATHS
        )
      || selection.writer_journey_manifest !== COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION
      || selection.parity_required !== false
      || !/^[0-9a-f]{40}$/.test(String(selection.git_sha || ""))
      || !/^[0-9a-f]{40}$/.test(String(selection.git_tree_sha || ""))
      || selection.contract_sha256
        !== compatibilityBridgeV2RuntimeContractProof().contract_sha256) {
    throw failure("release_rollback_lineage_repair_selection_invalid");
  }
  const capturedRollbackSha = exactGitSha(rollbackReceipt?.git_sha);
  if (capturedRollbackSha !== COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA) {
    throw failure("release_rollback_lineage_repair_rollback_mismatch");
  }
  return Object.freeze({
    schema_version: "production-release-rollback-lineage-receipt-v4",
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID,
    bridge_marker: COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER,
    release_git_sha: exactGitSha(selection.git_sha),
    release_parent_git_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_SHA,
    release_parent_tree_sha: COMPATIBILITY_BRIDGE_V2_REPAIR_PARENT_TREE_SHA,
    failed_run_id: COMPATIBILITY_BRIDGE_V2_REPAIR_FAILED_RUN_ID,
    required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
    captured_rollback_git_sha: capturedRollbackSha,
    lineage_verified: true
  });
}

function verifyCompatibilityBridgeV2WriterReceiptRepairRollbackLineage({
  selection,
  rollbackReceipt
} = {}) {
  if (!exactKeys(selection, [
    "schema_version", "release_class", "bridge_descriptor_id", "bridge_marker",
    "commit_trailer_sha256", "git_tree_sha", "parent_git_sha", "parent_tree_sha",
    "failed_run_id", "required_rollback_git_sha", "artifact_manifest_sha256",
    "git_sha", "writer_journey_manifest", "parity_required", "contract_sha256"
  ])
      || selection.schema_version !== "production-release-selection-v5"
      || selection.release_class !== COMPATIBILITY_BRIDGE_RELEASE_CLASS
      || selection.bridge_descriptor_id
        !== COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID
      || selection.bridge_marker !== COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER
      || selection.commit_trailer_sha256 !== sha256(COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER)
      || selection.parent_git_sha !== COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA
      || selection.parent_tree_sha
        !== COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA
      || selection.failed_run_id !== COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID
      || selection.required_rollback_git_sha !== COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA
      || selection.artifact_manifest_sha256
        !== bridgeV2WriterReceiptRepairArtifactManifestSha256(
          COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_CHANGED_PATHS
        )
      || selection.writer_journey_manifest !== COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION
      || selection.parity_required !== false
      || !/^[0-9a-f]{40}$/.test(String(selection.git_sha || ""))
      || !/^[0-9a-f]{40}$/.test(String(selection.git_tree_sha || ""))
      || selection.contract_sha256
        !== compatibilityBridgeV2RuntimeContractProof().contract_sha256) {
    throw failure("release_rollback_lineage_writer_receipt_repair_selection_invalid");
  }
  const capturedRollbackSha = exactGitSha(rollbackReceipt?.git_sha);
  if (capturedRollbackSha !== COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA) {
    throw failure("release_rollback_lineage_writer_receipt_repair_rollback_mismatch");
  }
  return Object.freeze({
    schema_version: "production-release-rollback-lineage-receipt-v5",
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID,
    bridge_marker: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER,
    release_git_sha: exactGitSha(selection.git_sha),
    release_parent_git_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_SHA,
    release_parent_tree_sha: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_PARENT_TREE_SHA,
    failed_run_id: COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_FAILED_RUN_ID,
    required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
    captured_rollback_git_sha: capturedRollbackSha,
    lineage_verified: true
  });
}

export function verifyReleaseRollbackLineage({ selection, rollbackReceipt } = {}) {
  if (selection?.release_class === ORDINARY_RELEASE_CLASS) {
    return verifyOrdinaryRollbackLineage({ selection, rollbackReceipt });
  }
  if (selection?.bridge_descriptor_id === COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID) {
    return verifyCompatibilityBridgeV2RepairRollbackLineage({
      selection,
      rollbackReceipt
    });
  }
  if (selection?.bridge_descriptor_id
      === COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID) {
    return verifyCompatibilityBridgeV2WriterReceiptRepairRollbackLineage({
      selection,
      rollbackReceipt
    });
  }
  if (!exactKeys(selection, [
    "schema_version", "release_class", "bridge_descriptor_id", "bridge_marker",
    "commit_trailer_sha256", "git_tree_sha", "parent_git_sha", "parent_tree_sha",
    "failed_run_id", "required_rollback_git_sha", "artifact_manifest_sha256",
    "git_sha", "writer_journey_manifest", "parity_required", "contract_sha256"
  ])
      || selection.schema_version !== "production-release-selection-v2"
      || selection.release_class !== COMPATIBILITY_BRIDGE_RELEASE_CLASS
      || selection.bridge_descriptor_id !== COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID
      || selection.bridge_marker !== COMPATIBILITY_BRIDGE_V2_MARKER
      || selection.commit_trailer_sha256 !== sha256(COMPATIBILITY_BRIDGE_V2_COMMIT_TRAILER)
      || selection.parent_git_sha !== COMPATIBILITY_BRIDGE_V2_PARENT_SHA
      || selection.parent_tree_sha !== COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA
      || selection.failed_run_id !== COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID
      || selection.required_rollback_git_sha !== COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA
      || selection.artifact_manifest_sha256
        !== bridgeV2ArtifactManifestSha256(COMPATIBILITY_BRIDGE_V2_CHANGED_PATHS)
      || selection.writer_journey_manifest !== COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION
      || selection.parity_required !== false
      || !/^[0-9a-f]{40}$/.test(String(selection.git_sha || ""))
      || !/^[0-9a-f]{40}$/.test(String(selection.git_tree_sha || ""))
      || selection.contract_sha256
        !== compatibilityBridgeV2RuntimeContractProof().contract_sha256) {
    throw failure("release_rollback_lineage_selection_invalid");
  }
  const capturedRollbackSha = exactGitSha(rollbackReceipt?.git_sha);
  if (capturedRollbackSha !== COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA) {
    throw failure("release_rollback_lineage_rollback_mismatch");
  }
  return Object.freeze({
    schema_version: "production-release-rollback-lineage-receipt-v3",
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
    bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER,
    release_git_sha: exactGitSha(selection.git_sha),
    release_parent_git_sha: COMPATIBILITY_BRIDGE_V2_PARENT_SHA,
    release_parent_tree_sha: COMPATIBILITY_BRIDGE_V2_PARENT_TREE_SHA,
    failed_run_id: COMPATIBILITY_BRIDGE_V2_FAILED_RUN_ID,
    required_rollback_git_sha: COMPATIBILITY_BRIDGE_V2_ROLLBACK_SHA,
    captured_rollback_git_sha: capturedRollbackSha,
    lineage_verified: true
  });
}

export function compatibilityBridgeRuntimeContractProof({ health = null, gitSha = null } = {}) {
  const v1 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v1;
  const v2 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v2;
  const conflict = resolveExternalIdentitySupport({
    year: "1994-95",
    manufacturer: "Topps",
    product: "Stadium Club",
    set: "Hardwood Heroes",
    subjects: ["Michael Jordan"],
    team: "Bulls",
    card_number: "HR 14"
  }, { externalIdentityContext: { originalImageSha256: originalSha256 } });
  const v2Replay = composeCanonicalFieldsForStoredOutput({
    year: "1996-97",
    manufacturer: "Topps",
    product: "Stadium Club",
    set: "High Risers",
    subjects: ["Michael Jordan"],
    team: "Chicago Bulls",
    card_name: "",
    release_variant: "",
    surface_color: "",
    parallel_family: "",
    parallel_exact: "",
    descriptive_rarity: "",
    card_number: "HR14",
    serial: "",
    attributes: [],
    grade: "",
    grammar: "standard",
    lot_count: "",
    unreadable: [],
    low_confidence: []
  }, { marketplace: "EBAY", ...v2.output });
  const activeIsV1 = EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID === v1.receipt.registry_release_id
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id === v1.receipt.registry_release_id
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.resolver_version
      === v1.resolution.resolver_version
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.conflict_policy_version
      === v1.resolution.conflict_policy_version
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version
      === v1.output.composer_version
    && EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version
      === v1.output.marketplace_profile_version
    && THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id
      === v1.receipt.registry_release_id
    && CSM_ACTIVE_MODEL_PROFILE.id === expectedModelProfileId
    && conflict.status === "ABSTAINED"
    && conflict.receipt.reason === "CONFLICTING_OBSERVATION";
  const v2Dormant = v2.receipt.registry_release_id !== EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID
    && v2.resolution.resolver_version
      !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.resolver_version
    && v2Replay.title === targetV2Title;
  if (!activeIsV1 || !v2Dormant) throw failure("compatibility_bridge_runtime_contract_invalid");

  let healthBound = false;
  let deploymentSha = null;
  if (health != null) {
    deploymentSha = exactGitSha(gitSha);
    healthBound = health?.ready === true
      && health?.deployment?.git_commit_sha === deploymentSha
      && health?.runtime?.model_profile_id === expectedModelProfileId
      && stableJson(health?.runtime?.external_identity)
        === stableJson(EXTERNAL_IDENTITY_RELEASE_CONTRACT);
    if (!healthBound) throw failure("compatibility_bridge_health_contract_invalid");
  }

  const body = {
    schema_version: "compatibility-bridge-runtime-contract-proof-v1",
    bridge_marker: COMPATIBILITY_BRIDGE_MARKER,
    active_registry_release_id: v1.receipt.registry_release_id,
    active_resolver_version: v1.resolution.resolver_version,
    active_conflict_policy_version: v1.resolution.conflict_policy_version,
    active_composer_version: v1.output.composer_version,
    active_marketplace_profile_version: v1.output.marketplace_profile_version,
    active_model_profile_id: expectedModelProfileId,
    active_visible_conflict_behavior: "ABSTAINED",
    dormant_registry_release_id: v2.receipt.registry_release_id,
    dormant_resolver_version: v2.resolution.resolver_version,
    dormant_composer_version: v2.output.composer_version,
    dormant_replay_title_sha256: sha256(targetV2Title),
    provider_calls: 0,
    health_bound: healthBound,
    deployment_git_sha: deploymentSha
  };
  return Object.freeze({ ...body, contract_sha256: sha256(stableJson(body)) });
}

function resealCsmRows(rows) {
  rows.resolution.recognition_packet_sha256 = computeCsmPacketHashes(rows)
    .csm_recognition_packet_sha256;
  rows.output.resolution_packet_sha256 = computeCsmPacketHashes(rows)
    .csm_resolution_packet_sha256;
  rows.session_hashes = computeCsmPacketHashes(rows);
  return rows;
}

export function sealedV3OverlayForwardReadContractProof() {
  const imageReferences = WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images.map((image) => ({
    image_role: image.role,
    content_sha256: image.content_sha256,
    derived: false
  }));
  const observed = {
    year: "2025",
    ip: "",
    language: "",
    manufacturer: "Topps",
    product: "Chrome",
    set: "",
    subjects: ["Cooper Flagg"],
    team: "Mavericks",
    card_name: "",
    release_variant: "",
    surface_color: "Gold",
    parallel_family: "Refractor",
    parallel_exact: "Gold Refractor",
    print_finish: "Gold Refractor",
    descriptive_rarity: "",
    card_number: "251",
    serial: "30/50",
    attributes: ["RC"],
    components: ["RC"],
    search_optimization: [],
    grading_info: null,
    grade: "",
    grammar: "standard",
    lot_count: "",
    special_stamp: "",
    description: "",
    unreadable: [],
    low_confidence: []
  };
  const resolved = resolveVerifiedOriginalObservation(observed, {
    originalImageSha256: imageReferences.map(({ content_sha256: hash }) => hash)
  });
  if (!resolved || resolved.receipt?.status !== "APPLIED") {
    throw failure("compatibility_bridge_v2_overlay_fixture_invalid");
  }
  const composed = composeLyncaStandardNameForProfile(resolved.fields, {
    marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V2
  });
  const rows = buildCsmStageRows({
    tenantId: "tenant-compatibility-bridge-v2",
    recognitionSessionId: "session-compatibility-bridge-v2-overlay",
    fields: resolved.fields,
    observedFields: observed,
    externalIdentitySupport: { status: "ABSTAINED" },
    verifiedOriginalObservationSupport: resolved.receipt,
    composed,
    title: composed.title
  });
  const session = {
    identity_snapshot: {
      expected_original_count: 2,
      image_references: [
        ...imageReferences,
        {
          image_role: "front_readability_derived",
          content_sha256: "9".repeat(64),
          derived: true
        }
      ]
    }
  };
  const publicSupport = projectVerifiedOriginalObservationReadback({ session, rows });
  const readback = composeResolutionView({
    asset_id: "asset-compatibility-bridge-v2-overlay",
    recognition_session_id: rows.output.recognition_session_id,
    canonical_payload: rows.output.structured_output,
    output_title: rows.output.title,
    resolver_version: rows.resolution.resolver_version,
    composer_version: rows.output.composer_version,
    marketplace_profile_version: rows.output.marketplace_profile_version,
    owner_execution_receipt: null,
    verified_original_observation_support: publicSupport,
    replay_rows: rows
  });
  const supportEvidence = rows.evidence.find((row) => (
    row.source_ref?.support_type === "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"
  ));
  const reviewedCandidate = rows.candidates.find((row) => (
    row.source_trust === "REVIEWED_CLOSED_PROJECTION_EXACT"
  ));
  const reviewedLink = rows.links.find((row) => (
    row.evidence_observation_id === supportEvidence?.id
      || row.candidate_id === reviewedCandidate?.id
  ));
  if (!supportEvidence || !reviewedCandidate || !reviewedLink) {
    throw failure("compatibility_bridge_v2_overlay_fixture_invalid");
  }
  const missingEvidence = structuredClone(rows);
  missingEvidence.evidence = missingEvidence.evidence.filter(
    (row) => row.id !== supportEvidence.id
  );
  missingEvidence.links = missingEvidence.links.filter(
    (row) => row.evidence_observation_id !== supportEvidence.id
  );
  resealCsmRows(missingEvidence);
  const missingCandidate = structuredClone(rows);
  missingCandidate.candidates = missingCandidate.candidates.filter(
    (row) => row.id !== reviewedCandidate.id
  );
  missingCandidate.links = missingCandidate.links.filter(
    (row) => row.candidate_id !== reviewedCandidate.id
  );
  resealCsmRows(missingCandidate);
  const missingLink = structuredClone(rows);
  missingLink.links = missingLink.links.filter((row) => (
    row.candidate_id !== reviewedLink.candidate_id
      || row.evidence_observation_id !== reviewedLink.evidence_observation_id
  ));
  resealCsmRows(missingLink);
  const tampered = structuredClone(rows);
  tampered.evidence.find((row) => row.id === supportEvidence.id)
    .source_ref.field_fact_set_sha256 = "0".repeat(64);
  resealCsmRows(tampered);
  const negativeChecks = [
    projectVerifiedOriginalObservationReadback({ session: {}, rows }) === null,
    projectVerifiedOriginalObservationReadback({ session, rows: missingEvidence }) === null,
    projectVerifiedOriginalObservationReadback({ session, rows: missingCandidate }) === null,
    projectVerifiedOriginalObservationReadback({ session, rows: missingLink }) === null,
    projectVerifiedOriginalObservationReadback({ session, rows: tampered }) === null
  ];
  const valid = validateVerifiedOriginalObservationReplayPacket(rows)
    && publicSupport?.status === "APPLIED"
    && readback.composed?.title === rows.output.title
    && readback.composer_version === rows.output.composer_version
    && readback.marketplace_profile_version === rows.output.marketplace_profile_version
    && negativeChecks.every(Boolean);
  if (!valid) throw failure("compatibility_bridge_v2_overlay_forward_read_invalid");
  const body = {
    schema_version: "compatibility-bridge-v2-sealed-overlay-forward-read-proof-v1",
    composer_version: rows.output.composer_version,
    marketplace_profile_version: rows.output.marketplace_profile_version,
    public_receipt_schema_version: publicSupport.schema_version,
    durable_packet_valid: true,
    durable_identity_snapshot_bound: true,
    derived_reference_ignored_for_original_set: true,
    readback_projector_valid: true,
    resolution_view_recomposition_valid: true,
    negative_resealed_counterexample_count: negativeChecks.length,
    provider_calls: 0
  };
  return Object.freeze({ ...body, contract_sha256: sha256(stableJson(body)) });
}

export function compatibilityBridgeV2RuntimeContractProof({
  health = null,
  gitSha = null
} = {}) {
  const sealedOverlayForwardRead = sealedV3OverlayForwardReadContractProof();
  const fields = {
    year: "2025",
    manufacturer: "Topps",
    product: "Chrome",
    set: "",
    subjects: ["Bridge Test Player"],
    team: "Test Team",
    card_name: "",
    release_variant: "",
    print_finish: "",
    surface_color: "",
    parallel_family: "",
    parallel_exact: "",
    descriptive_rarity: "",
    card_number: "1",
    serial: "",
    attributes: [],
    components: [],
    search_optimization: [],
    grade: "",
    grading_info: null,
    grammar: "standard",
    lot_count: "",
    unreadable: [],
    low_confidence: []
  };
  const historicalV2 = composeCanonicalFieldsForStoredOutput(fields, {
    marketplace: "EBAY",
    composer_version: "thin-marketplace-composer-v2",
    marketplace_profile_version: "ebay-profile-v1"
  });
  const historicalV2Receipt = {
    title: historicalV2.title,
    grammar: historicalV2.grammar,
    brackets: historicalV2.brackets,
    bracket_text: historicalV2.bracket_text,
    dropped: historicalV2.dropped,
    suppressed: historicalV2.suppressed,
    restored: historicalV2.restored,
    truncated: historicalV2.truncated,
    empty_fields: historicalV2.empty_fields,
    input_empty_fields: historicalV2.input_empty_fields,
    unreadable: historicalV2.unreadable,
    low_confidence: historicalV2.low_confidence,
    inferred_parent: historicalV2.inferred_parent,
    normalization_reasons: historicalV2.normalization_reasons,
    character_budget: historicalV2.character_budget,
    length: historicalV2.length,
    composer_version: "thin-marketplace-composer-v2",
    marketplace_profile_version: "ebay-profile-v1"
  };
  const bridgeProjectionActivation = {
    schema_version: "csm-projection-activation.v2",
    activation_id: "standard-v2-writer-v3-v01-v02-overlay-forward-reader-bridge-v1",
    active_writer: {
      standard: {
        composer_version: "thin-marketplace-composer-v2",
        marketplace_profile_version: "ebay-profile-v1"
      },
      verified_original_observation_overlay: null
    },
    forward_readers: {
      standard: [
        CANONICAL_NAMING_RELEASE_CONTRACT_V1,
        CANONICAL_NAMING_RELEASE_CONTRACT_V2
      ].map((contract) => ({
        composer_version: contract.composer_version,
        marketplace_profile_version: contract.marketplace_profile_version,
        release_contract_schema_version: contract.schema_version,
        profile_id: contract.profile_id,
        profile_version: contract.profile_version
      })),
      verified_original_observation_overlay: {
        replay_registry_schema_version:
          VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.schema_version,
        release_ids: Object.keys(
          VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases
        ).sort(),
        resolution_contract_schema_version:
          VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.schema_version,
        resolution_contract_sha256:
          VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
        resolver_version: VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.resolver_version,
        conflict_policy_version:
          VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.conflict_policy_version
      }
    },
    activation_sha256: "a489cd2685ff1c56efa499ab64eef9184d0fd54dc1ca93c6cbcc0985aa7630a8"
  };
  const forwardStandard = bridgeProjectionActivation.forward_readers.standard;
  const forwardReceipts = forwardStandard.map((contract) => ({
    contract,
    replayed: composeCanonicalFieldsForStoredOutput(fields, {
      marketplace: "EBAY",
      composer_version: contract.composer_version,
      marketplace_profile_version: contract.marketplace_profile_version,
      contract_version: "csm-stage-shadow-v2"
    }),
    expected: composeLyncaStandardNameForProfile(fields, {
      marketplaceProfileVersion: contract.marketplace_profile_version,
      publicationCoverage: false
    })
  }));
  const activeWriter = bridgeProjectionActivation.active_writer;
  const overlayForward =
    bridgeProjectionActivation.forward_readers.verified_original_observation_overlay;
  const runtimeReady = activeWriter.standard.composer_version
      === historicalV2Receipt.composer_version
    && activeWriter.standard.marketplace_profile_version
      === historicalV2Receipt.marketplace_profile_version
    && activeWriter.verified_original_observation_overlay === null
    && stableJson(forwardStandard.map((contract) => ({
      composer_version: contract.composer_version,
      marketplace_profile_version: contract.marketplace_profile_version
    }))) === stableJson([
      {
        composer_version: "thin-marketplace-composer-v3",
        marketplace_profile_version: LYNCA_STANDARD_PROFILE_VERSION_V1
      },
      {
        composer_version: "thin-marketplace-composer-v3",
        marketplace_profile_version: LYNCA_STANDARD_PROFILE_VERSION_V2
      }
    ])
    && overlayForward.resolution_contract_sha256
      === VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256
    && overlayForward.resolver_version
      === VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.resolver_version
    && overlayForward.conflict_policy_version
      === VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.conflict_policy_version
    && forwardReceipts.every(({ replayed, expected }) => (
      stableJson(replayed) === stableJson(expected)
    ))
    && sealedOverlayForwardRead.durable_packet_valid === true
    && sealedOverlayForwardRead.readback_projector_valid === true
    && sealedOverlayForwardRead.resolution_view_recomposition_valid === true
    && sealedOverlayForwardRead.negative_resealed_counterexample_count === 5
    && CSM_ACTIVE_MODEL_PROFILE.id === expectedModelProfileId;
  if (!runtimeReady) throw failure("compatibility_bridge_v2_runtime_contract_invalid");

  let healthBound = false;
  let deploymentSha = null;
  if (health != null) {
    deploymentSha = exactGitSha(gitSha);
    healthBound = health?.ready === true
      && health?.deployment?.git_commit_sha === deploymentSha
      && health?.runtime?.model_profile_id === expectedModelProfileId
      && stableJson(health?.runtime?.projection_activation)
        === stableJson(bridgeProjectionActivation)
      && stableJson(health?.runtime?.active_writer)
        === stableJson(bridgeProjectionActivation.active_writer)
      && stableJson(health?.runtime?.forward_readers)
        === stableJson(bridgeProjectionActivation.forward_readers);
    if (!healthBound) throw failure("compatibility_bridge_v2_health_contract_invalid");
  }

  const body = {
    schema_version: "compatibility-bridge-v2-runtime-contract-proof-v1",
    bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER,
    active_writer_composer_version: activeWriter.standard.composer_version,
    active_writer_marketplace_profile_version:
      activeWriter.standard.marketplace_profile_version,
    active_verified_original_observation_overlay: null,
    forward_reader_standard_contracts: forwardStandard.map((contract) => ({
      composer_version: contract.composer_version,
      marketplace_profile_version: contract.marketplace_profile_version,
      profile_id: contract.profile_id,
      profile_version: contract.profile_version
    })),
    forward_reader_overlay_resolution_contract_sha256:
      overlayForward.resolution_contract_sha256,
    sealed_overlay_forward_read_contract_sha256:
      sealedOverlayForwardRead.contract_sha256,
    sealed_overlay_forward_read_packet_valid: true,
    sealed_overlay_forward_readback_projector_valid: true,
    sealed_overlay_forward_read_negative_count:
      sealedOverlayForwardRead.negative_resealed_counterexample_count,
    projection_activation_sha256: bridgeProjectionActivation.activation_sha256,
    active_model_profile_id: expectedModelProfileId,
    provider_calls: 0,
    health_bound: healthBound,
    deployment_git_sha: deploymentSha
  };
  return Object.freeze({ ...body, contract_sha256: sha256(stableJson(body)) });
}

function validateOrdinaryCases(manifest) {
  if (!exactKeys(manifest, [
    "schema_version", "evidence_scope", "accuracy_claim", "cases", "parity_case"
  ]) || manifest.schema_version !== "writer-journey-cases-v3"
    || manifest.evidence_scope !== "LIVE_CONTRACT_RECEIPT_ONLY"
    || manifest.accuracy_claim !== null
    || !Array.isArray(manifest.cases) || manifest.cases.length !== 2
    || !exactObject(manifest.parity_case)) {
    throw failure("compatibility_bridge_source_manifest_invalid");
  }
  const ids = new Set();
  const grammars = new Set();
  const tcgContract = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS.find(
    (entry) => entry.case_id === "TCG"
  );
  for (const entry of manifest.cases) {
    const productionStandard = entry?.case_id === "NON_TCG";
    const contract = productionStandard
      ? WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
      : tcgContract;
    const expectedKeys = productionStandard
      ? [
        "case_id", "expected_grammar", "source_kind", "source_record_id", "source_asset_id",
        "evaluation_cohort", "hash_provenance", "image_count", "files"
      ]
      : [
        "case_id", "expected_grammar", "source_feedback_id", "evaluation_cohort",
        "hash_provenance", "image_count", "files"
      ];
    if (!exactObject(entry)
        || !exactKeys(entry, expectedKeys)
        || !["NON_TCG", "TCG"].includes(entry.case_id)
        || entry.expected_grammar !== contract?.expected_grammar
        || entry.evaluation_cohort !== contract?.evaluation_cohort
        || entry.hash_provenance !== contract?.hash_provenance
        || entry.image_count !== 2
        || !Array.isArray(entry.files) || entry.files.length !== 2
        || entry.files.some((file) => !exactKeys(file, [
          "path", "role", "bytes", "content_type", "content_sha256"
        ]))
        || entry.files[0]?.role !== "front_original"
        || entry.files[1]?.role !== "back_original"
        || (productionStandard ? (
          entry.source_kind !== contract.source_kind
          || entry.source_record_id !== contract.source_record_id
          || entry.source_asset_id !== contract.source_asset_id
          || entry.files.some((file, index) => (
            file?.content_sha256 !== contract.images[index].content_sha256
            || file?.content_type !== contract.images[index].content_type
            || file?.bytes !== contract.images[index].bytes
          ))
        ) : (
          entry.source_feedback_id !== contract?.source_feedback_id
          || entry.files.some((file, index) => (
            file?.content_sha256 !== contract.image_sha256[
              `${contract.source_feedback_id}_${index === 0 ? "front" : "back"}`
            ]
          ))
        ))) {
      throw failure("compatibility_bridge_source_case_invalid");
    }
    ids.add(entry.case_id);
    grammars.add(entry.expected_grammar);
  }
  if (ids.size !== 2 || grammars.size !== 2) {
    throw failure("compatibility_bridge_source_case_invalid");
  }
  return manifest.cases;
}

export function buildCompatibilityBridgeManifest({ selection, sourceManifest } = {}) {
  const historicalV1 = selection?.release_class === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && selection?.bridge_marker === COMPATIBILITY_BRIDGE_MARKER
    && selection?.writer_journey_manifest === COMPATIBILITY_BRIDGE_MANIFEST_VERSION
    && selection?.parity_required === false;
  const bridgeV2 = selection?.release_class === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && selection?.bridge_descriptor_id === COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID
    && selection?.bridge_marker === COMPATIBILITY_BRIDGE_V2_MARKER
    && selection?.writer_journey_manifest === COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION
    && selection?.parity_required === false;
  const bridgeV2Repair = selection?.release_class === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && selection?.bridge_descriptor_id === COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID
    && selection?.bridge_marker === COMPATIBILITY_BRIDGE_V2_REPAIR_MARKER
    && selection?.writer_journey_manifest === COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION
    && selection?.parity_required === false;
  const bridgeV2WriterReceiptRepair =
    selection?.release_class === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && selection?.bridge_descriptor_id
      === COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID
    && selection?.bridge_marker === COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_MARKER
    && selection?.writer_journey_manifest === COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION
    && selection?.parity_required === false;
  if (!historicalV1 && !bridgeV2 && !bridgeV2Repair && !bridgeV2WriterReceiptRepair) {
    throw failure("compatibility_bridge_selection_required");
  }
  const cases = validateOrdinaryCases(sourceManifest);
  if (bridgeV2 || bridgeV2Repair || bridgeV2WriterReceiptRepair) {
    return Object.freeze({
      schema_version: COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION,
      release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
      bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER,
      git_sha: exactGitSha(selection.git_sha),
      evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
      accuracy_claim: null,
      cases
    });
  }
  return Object.freeze({
    schema_version: COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_marker: COMPATIBILITY_BRIDGE_MARKER,
    git_sha: exactGitSha(selection.git_sha),
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    accuracy_claim: null,
    cases
  });
}

async function readJson(file, code) {
  if (!path.isAbsolute(file)) throw failure(`${code}_path_invalid`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw failure(`${code}_invalid`);
  }
}

async function readPrivateJson(file, code) {
  if (!path.isAbsolute(file)) throw failure(`${code}_path_invalid`);
  if (((await stat(file)).mode & 0o777) !== 0o600) {
    throw failure(`${code}_permissions_invalid`);
  }
  return readJson(file, code);
}

async function exclusivePrivateWrite(file, value) {
  if (!path.isAbsolute(file)) throw failure("compatibility_bridge_output_path_invalid");
  await writeFile(file, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
  if (((await stat(file)).mode & 0o777) !== 0o600) {
    throw failure("compatibility_bridge_output_permissions_invalid");
  }
}

function parseArguments(argv) {
  const [mode, ...rest] = argv;
  if (![
    "verify-selection", "verify-rollback-lineage", "build-manifest", "verify-health"
  ].includes(mode)) {
    throw failure("compatibility_bridge_arguments_invalid");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!/^--[a-z-]+$/.test(String(key || "")) || value == null || values.has(key)) {
      throw failure("compatibility_bridge_arguments_invalid");
    }
    values.set(key, value);
  }
  const allowed = {
    "verify-selection": ["--release-class", "--git-sha", "--out"],
    "verify-rollback-lineage": [
      "--release-class", "--git-sha", "--selection", "--rollback-receipt", "--out"
    ],
    "build-manifest": ["--release-class", "--git-sha", "--source-manifest", "--out"],
    "verify-health": ["--release-class", "--git-sha", "--health", "--out"]
  }[mode];
  if (rest.length % 2 !== 0
      || [...values.keys()].some((key) => !allowed.includes(key))
      || allowed.some((key) => !values.has(key))) {
    throw failure("compatibility_bridge_arguments_invalid");
  }
  return { mode, values };
}

async function main(argv) {
  const { mode, values } = parseArguments(argv);
  const selection = verifyCompatibilityBridgeSelection({
    releaseClass: values.get("--release-class"),
    gitSha: values.get("--git-sha")
  });
  if (mode === "verify-selection") {
    await exclusivePrivateWrite(values.get("--out"), selection);
    return;
  }
  if (mode === "verify-rollback-lineage") {
    const savedSelection = await readPrivateJson(
      values.get("--selection"),
      "production_release_selection"
    );
    if (stableJson(savedSelection) !== stableJson(selection)) {
      throw failure("production_release_selection_mismatch");
    }
    const rollbackReceipt = await readVercelProductionRollbackReceipt({
      receiptPath: values.get("--rollback-receipt")
    });
    await exclusivePrivateWrite(values.get("--out"), verifyReleaseRollbackLineage({
      selection,
      rollbackReceipt
    }));
    return;
  }
  if (selection.release_class !== COMPATIBILITY_BRIDGE_RELEASE_CLASS) {
    throw failure("compatibility_bridge_selection_required");
  }
  if (mode === "build-manifest") {
    const sourceManifest = await readJson(
      values.get("--source-manifest"),
      "compatibility_bridge_source_manifest"
    );
    await exclusivePrivateWrite(values.get("--out"), buildCompatibilityBridgeManifest({
      selection, sourceManifest
    }));
    return;
  }
  const health = await readJson(values.get("--health"), "compatibility_bridge_health");
  const proof = [
    COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
    COMPATIBILITY_BRIDGE_V2_REPAIR_DESCRIPTOR_ID,
    COMPATIBILITY_BRIDGE_V2_WRITER_RECEIPT_REPAIR_DESCRIPTOR_ID
  ].includes(selection.bridge_descriptor_id)
    ? compatibilityBridgeV2RuntimeContractProof({
      health,
      gitSha: selection.git_sha
    })
    : compatibilityBridgeRuntimeContractProof({
    health,
    gitSha: selection.git_sha
    });
  await exclusivePrivateWrite(values.get("--out"), {
    ...proof,
    release_selection_sha256: sha256(stableJson(selection))
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "compatibility_bridge_failed")
    })}\n`);
    process.exitCode = 1;
  });
}
