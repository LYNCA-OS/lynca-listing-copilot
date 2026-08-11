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
  composeCanonicalFieldsForStoredOutput
} from "../lib/listing/thin/csm-replay.mjs";
import {
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";

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
  "c1f9e654268ca534ff54876d44a29b29adedc575";
export const COMPATIBILITY_BRIDGE_CHANGED_PATHS = Object.freeze([
  "docs/operations/luna-v2-rollback-bridge.md",
  "e2e/production-writer-journey.spec.mjs",
  "scripts/build-large-internal-writer-fixture.browser.test.mjs",
  "scripts/build-large-internal-writer-fixture.contract.test.mjs",
  "scripts/build-large-internal-writer-fixture.mjs",
  "scripts/compatibility-bridge-release.mjs",
  "scripts/compatibility-bridge-release.test.mjs",
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
    return Object.freeze({
      schema_version: "production-release-selection-v1",
      release_class: selected,
      git_sha: expectedSha,
      writer_journey_manifest: "writer-journey-cases-v3",
      parity_required: true
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
  const parents = parentShas ?? gitParentShas(expectedSha);
  if (!Array.isArray(parents) || parents.length !== 1
      || exactGitSha(parents[0]) !== COMPATIBILITY_BRIDGE_PARENT_SHA) {
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
  for (const entry of manifest.cases) {
    if (!exactObject(entry)
        || !["NON_TCG", "TCG"].includes(entry.case_id)
        || entry.expected_grammar !== entry.case_id
        || entry.evaluation_cohort !== "INTERNAL_REVIEWED_GT"
        || !String(entry.source_feedback_id || "").trim()
        || !String(entry.hash_provenance || "").trim()
        || entry.image_count !== 2
        || !Array.isArray(entry.files) || entry.files.length !== 2
        || entry.files[0]?.role !== "front_original"
        || entry.files[1]?.role !== "back_original") {
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
  if (selection?.release_class !== COMPATIBILITY_BRIDGE_RELEASE_CLASS
      || selection?.bridge_marker !== COMPATIBILITY_BRIDGE_MARKER
      || selection?.writer_journey_manifest !== COMPATIBILITY_BRIDGE_MANIFEST_VERSION
      || selection?.parity_required !== false) {
    throw failure("compatibility_bridge_selection_required");
  }
  const cases = validateOrdinaryCases(sourceManifest);
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

async function exclusivePrivateWrite(file, value) {
  if (!path.isAbsolute(file)) throw failure("compatibility_bridge_output_path_invalid");
  await writeFile(file, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
  if (((await stat(file)).mode & 0o777) !== 0o600) {
    throw failure("compatibility_bridge_output_permissions_invalid");
  }
}

function parseArguments(argv) {
  const [mode, ...rest] = argv;
  if (!["verify-selection", "build-manifest", "verify-health"].includes(mode)) {
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
  const proof = compatibilityBridgeRuntimeContractProof({
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
