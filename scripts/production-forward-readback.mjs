#!/usr/bin/env node

import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readVercelProductionRollbackReceipt
} from "./vercel-production-rollback-receipt.mjs";

export const PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA =
  "production-forward-readback-expectation-v1";
export const PRODUCTION_FORWARD_READBACK_RECEIPT_SCHEMA =
  "production-forward-readback-receipt-v1";

const WRITER_JOURNEY_EVIDENCE_SCHEMA = "production-writer-journey-evidence-v6";
const STANDARD_CASE_ID = "NON_TCG";
const CANONICAL_PRODUCTION_ORIGIN = "https://listing.lyncafei.team";
const RELEASE_CLASSES = new Set(["ordinary", "compatibility-bridge"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SESSION_ID = /^csmsess_[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

const exactObject = (value) => Boolean(value)
  && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => exactObject(value)
  && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
};

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function exactGitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!GIT_SHA.test(sha)) throw failure("production_forward_readback_git_sha_invalid");
  return sha;
}

function exactCandidateOrigin(value) {
  const raw = String(value || "").trim();
  let url;
  try { url = new URL(raw); } catch {
    throw failure("production_forward_readback_candidate_origin_invalid");
  }
  if (raw !== url.origin || url.protocol !== "https:"
      || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)) {
    throw failure("production_forward_readback_candidate_origin_invalid");
  }
  return raw;
}

function safeId(value, code) {
  const id = String(value || "").trim();
  if (!SAFE_ID.test(id)) throw failure(code);
  return id;
}

function safeVersion(value, code) {
  const version = String(value || "").trim();
  if (!version || version.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(version)) {
    throw failure(code);
  }
  return version;
}

function candidateStandardCase(evidence, { deploymentUrl, gitSha }) {
  if (!exactObject(evidence)
      || evidence.schema_version !== WRITER_JOURNEY_EVIDENCE_SCHEMA
      || evidence.evidence_scope !== "LIVE_CONTRACT_RECEIPT_ONLY"
      || !RELEASE_CLASSES.has(evidence.release_class)
      || evidence.passed !== true
      || evidence.accuracy_claim !== null
      || evidence.deployment_origin !== deploymentUrl
      || evidence.deployment_identity !== `${deploymentUrl}#${gitSha}`
      || evidence.deployment_git_commit_sha !== gitSha
      || evidence.deployment_environment !== "production") {
    throw failure("production_forward_readback_evidence_invalid");
  }
  const matches = (Array.isArray(evidence.cases) ? evidence.cases : [])
    .filter((entry) => entry?.case_id === STANDARD_CASE_ID);
  if (matches.length !== 1) {
    throw failure("production_forward_readback_standard_case_invalid");
  }
  const entry = matches[0];
  const owner = entry.owner_execution_readback;
  const versions = entry.versions;
  const assetId = safeId(entry.asset_id,
    "production_forward_readback_asset_id_invalid");
  const recognitionSessionId = String(entry.recognition_session_id || "").trim();
  if (entry.expected_grammar !== STANDARD_CASE_ID
      || !SESSION_ID.test(recognitionSessionId)
      || entry.resolution_http_method !== "GET"
      || entry.resolution_request_count !== 1
      || entry.trace_reliable !== true
      || entry.recomposed_matches_stored !== true
      || !Number.isInteger(entry.title_length)
      || entry.title_length < 1 || entry.title_length > 80
      || !exactKeys(owner, ["version", "sha256", "durable_read_after_write"])
      || owner.durable_read_after_write !== true
      || !SHA256.test(String(owner.sha256 || ""))
      || !exactKeys(versions, [
        "resolution_view_schema", "csm_contract", "resolver", "composer",
        "marketplace_profile"
      ])) {
    throw failure("production_forward_readback_standard_case_invalid");
  }
  return Object.freeze({
    release_class: evidence.release_class,
    asset_id: assetId,
    recognition_session_id: recognitionSessionId,
    title_length: entry.title_length,
    owner_execution_receipt: {
      version: safeVersion(owner.version,
        "production_forward_readback_owner_version_invalid"),
      sha256: owner.sha256
    },
    versions: {
      resolution_view_schema: safeVersion(versions.resolution_view_schema,
        "production_forward_readback_view_version_invalid"),
      csm_contract: safeVersion(versions.csm_contract,
        "production_forward_readback_csm_version_invalid"),
      resolver: safeVersion(versions.resolver,
        "production_forward_readback_resolver_version_invalid"),
      composer: safeVersion(versions.composer,
        "production_forward_readback_composer_version_invalid"),
      marketplace_profile: safeVersion(versions.marketplace_profile,
        "production_forward_readback_profile_version_invalid")
    }
  });
}

function validateResolutionView(resolutionView, entry) {
  const composer = resolutionView?.composer;
  const storedTitle = typeof composer?.stored_title === "string"
    ? composer.stored_title : "";
  const legacyV2View = entry.versions.composer === "thin-marketplace-composer-v2"
    && entry.versions.marketplace_profile === "ebay-profile-v1"
    && composer?.marketplace_profile_version == null;
  if (!exactObject(resolutionView)
      || resolutionView.asset_id !== entry.asset_id
      || resolutionView.recognition_session_id !== entry.recognition_session_id
      || resolutionView.schema_version !== entry.versions.resolution_view_schema
      || resolutionView.grammar?.value !== STANDARD_CASE_ID
      || resolutionView.grammar?.raw !== "standard"
      || resolutionView.grammar?.contract_version !== entry.versions.resolution_view_schema
      || resolutionView.grammar?.resolver_version !== entry.versions.resolver
      || composer?.composer_version !== entry.versions.composer
      || (composer?.marketplace_profile_version !== entry.versions.marketplace_profile
        && !legacyV2View)
      || composer?.title !== storedTitle
      || storedTitle.length !== entry.title_length
      || composer?.length !== storedTitle.length
      || composer?.recomposed_matches_stored !== true
      || composer?.trace_reliable !== true
      || !Array.isArray(resolutionView.brackets)
      || !exactKeys(resolutionView.owner_execution_receipt, ["version", "sha256"])
      || stableJson(resolutionView.owner_execution_receipt)
        !== stableJson(entry.owner_execution_receipt)) {
    throw failure("production_forward_readback_resolution_view_invalid");
  }
  return structuredClone(resolutionView);
}

function validateExpectation(expectation, { evidence, deploymentUrl, gitSha }) {
  const entry = candidateStandardCase(evidence, { deploymentUrl, gitSha });
  if (!exactKeys(expectation, [
    "schema_version", "candidate_deployment_origin", "candidate_git_sha",
    "release_class", "case_id", "asset_id", "recognition_session_id",
    "resolution_view"
  ])
      || expectation.schema_version !== PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA
      || expectation.candidate_deployment_origin !== deploymentUrl
      || expectation.candidate_git_sha !== gitSha
      || expectation.release_class !== entry.release_class
      || expectation.case_id !== STANDARD_CASE_ID
      || expectation.asset_id !== entry.asset_id
      || expectation.recognition_session_id !== entry.recognition_session_id) {
    throw failure("production_forward_readback_expectation_invalid");
  }
  const resolutionView = validateResolutionView(expectation.resolution_view, entry);
  return Object.freeze({ entry, resolution_view: resolutionView });
}

export function buildProductionForwardReadbackExpectation({
  evidence,
  resolutionView,
  deploymentUrl,
  gitSha
} = {}) {
  const candidateOrigin = exactCandidateOrigin(deploymentUrl);
  const sha = exactGitSha(gitSha);
  const entry = candidateStandardCase(evidence, {
    deploymentUrl: candidateOrigin,
    gitSha: sha
  });
  return Object.freeze({
    schema_version: PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA,
    candidate_deployment_origin: candidateOrigin,
    candidate_git_sha: sha,
    release_class: entry.release_class,
    case_id: STANDARD_CASE_ID,
    asset_id: entry.asset_id,
    recognition_session_id: entry.recognition_session_id,
    resolution_view: validateResolutionView(resolutionView, entry)
  });
}

export function productionForwardReadbackAssetId({
  evidence,
  expectation,
  deploymentUrl,
  gitSha
} = {}) {
  const candidateOrigin = exactCandidateOrigin(deploymentUrl);
  const sha = exactGitSha(gitSha);
  return validateExpectation(expectation, {
    evidence,
    deploymentUrl: candidateOrigin,
    gitSha: sha
  }).entry.asset_id;
}

function verifyExactProductionForwardReadback({
  evidence,
  expectation,
  resolutionView,
  responseUrl,
  deploymentUrl,
  gitSha,
  rollbackReceipt,
  readScope,
  now = () => new Date()
} = {}) {
  const candidateOrigin = exactCandidateOrigin(deploymentUrl);
  const sha = exactGitSha(gitSha);
  const validated = validateExpectation(expectation, {
    evidence,
    deploymentUrl: candidateOrigin,
    gitSha: sha
  });
  let readDeploymentGitSha;
  if (readScope === "CAPTURED_ROLLBACK_TARGET") {
    readDeploymentGitSha = exactGitSha(rollbackReceipt?.git_sha);
    if (rollbackReceipt?.canonical_origin !== CANONICAL_PRODUCTION_ORIGIN
        || rollbackReceipt?.deployment_url === candidateOrigin) {
      throw failure("production_forward_readback_rollback_identity_invalid");
    }
  } else if (readScope === "PROMOTED_CANDIDATE") {
    if (rollbackReceipt != null) {
      throw failure("production_forward_readback_promoted_identity_invalid");
    }
    readDeploymentGitSha = sha;
  } else {
    throw failure("production_forward_readback_scope_invalid");
  }
  const expectedUrl = new URL("/api/csm-resolution-view", CANONICAL_PRODUCTION_ORIGIN);
  expectedUrl.searchParams.set("asset_id", validated.entry.asset_id);
  if (String(responseUrl || "") !== expectedUrl.href) {
    throw failure("production_forward_readback_response_url_invalid");
  }
  const readback = validateResolutionView(resolutionView, validated.entry);
  if (stableJson(readback) !== stableJson(validated.resolution_view)) {
    throw failure("production_forward_readback_projection_mismatch");
  }
  const receipt = Object.freeze({
    schema_version: PRODUCTION_FORWARD_READBACK_RECEIPT_SCHEMA,
    canonical_origin: CANONICAL_PRODUCTION_ORIGIN,
    canonical_read_scope: readScope,
    canonical_read_deployment_git_sha: readDeploymentGitSha,
    candidate_deployment_origin: candidateOrigin,
    candidate_git_sha: sha,
    release_class: validated.entry.release_class,
    read_route: "/api/csm-resolution-view",
    http_method: "GET",
    redirects_followed: 0,
    provider_calls: 0,
    asset_id: validated.entry.asset_id,
    recognition_session_id: validated.entry.recognition_session_id,
    stored_title_exact_match: true,
    composer_profile_exact_match: true,
    owner_execution_receipt_exact_match: true,
    trace_exact_match: true,
    support_receipts_exact_match: true,
    full_resolution_view_exact_match: true,
    composer_version: validated.entry.versions.composer,
    marketplace_profile_version: validated.entry.versions.marketplace_profile,
    owner_execution_receipt_version:
      validated.entry.owner_execution_receipt.version,
    owner_execution_receipt_sha256:
      validated.entry.owner_execution_receipt.sha256,
    verified_at: now().toISOString()
  });
  const serialized = JSON.stringify(receipt);
  const storedTitle = validated.resolution_view.composer.stored_title;
  if (serialized.includes(storedTitle)
      || /"(?:stored_title|title|title_sha256|resolution_view)"/.test(serialized)) {
    throw failure("production_forward_readback_receipt_not_sanitized");
  }
  return receipt;
}

export function verifyProductionForwardReadback(input = {}) {
  return verifyExactProductionForwardReadback({
    ...input,
    readScope: "CAPTURED_ROLLBACK_TARGET"
  });
}

export function verifyPromotedProductionForwardReadback(input = {}) {
  return verifyExactProductionForwardReadback({
    ...input,
    rollbackReceipt: null,
    readScope: "PROMOTED_CANDIDATE"
  });
}

async function readJson(file, code, { privateFile = false } = {}) {
  if (!path.isAbsolute(file)) throw failure(`${code}_path_invalid`);
  if (privateFile && ((await stat(file)).mode & 0o777) !== 0o600) {
    throw failure(`${code}_permissions_invalid`);
  }
  try { return JSON.parse(await readFile(file, "utf8")); } catch {
    throw failure(`${code}_invalid`);
  }
}

async function writePrivate(file, value) {
  if (!path.isAbsolute(file)) throw failure("production_forward_readback_output_path_invalid");
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); } finally {
    await handle.close();
  }
  if (((await stat(file)).mode & 0o777) !== 0o600) {
    throw failure("production_forward_readback_output_permissions_invalid");
  }
}

export async function writeProductionForwardReadbackExpectation(file, value) {
  await writePrivate(file, value);
}

function argumentsFor(argv) {
  const [mode, ...rest] = argv;
  const allowed = {
    "asset-id": [
      "--evidence", "--expectation", "--deployment-url", "--git-sha"
    ],
    verify: [
      "--evidence", "--expectation", "--readback", "--response-url",
      "--deployment-url", "--git-sha", "--rollback-receipt", "--out"
    ],
    "verify-promoted": [
      "--evidence", "--expectation", "--readback", "--response-url",
      "--deployment-url", "--git-sha", "--out"
    ]
  }[mode];
  if (!allowed || rest.length % 2 !== 0) {
    throw failure("production_forward_readback_arguments_invalid");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!allowed.includes(key) || value == null || values.has(key)) {
      throw failure("production_forward_readback_arguments_invalid");
    }
    values.set(key, value);
  }
  if (allowed.some((key) => !values.has(key))) {
    throw failure("production_forward_readback_arguments_invalid");
  }
  return { mode, values };
}

async function main(argv) {
  const { mode, values } = argumentsFor(argv);
  const evidence = await readJson(
    values.get("--evidence"), "production_forward_readback_evidence"
  );
  const expectation = await readJson(
    values.get("--expectation"), "production_forward_readback_expectation",
    { privateFile: true }
  );
  const input = {
    evidence,
    expectation,
    deploymentUrl: values.get("--deployment-url"),
    gitSha: values.get("--git-sha")
  };
  if (mode === "asset-id") {
    process.stdout.write(`${productionForwardReadbackAssetId(input)}\n`);
    return;
  }
  const resolutionView = await readJson(
    values.get("--readback"), "production_forward_readback_response",
    { privateFile: true }
  );
  const rollbackReceipt = mode === "verify"
    ? await readVercelProductionRollbackReceipt({
      receiptPath: values.get("--rollback-receipt")
    })
    : null;
  const verify = mode === "verify"
    ? verifyProductionForwardReadback
    : verifyPromotedProductionForwardReadback;
  await writePrivate(values.get("--out"), verify({
    ...input,
    resolutionView,
    responseUrl: values.get("--response-url"),
    rollbackReceipt
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "production_forward_readback_failed")
    })}\n`);
    process.exitCode = 1;
  });
}
