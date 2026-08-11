#!/usr/bin/env node

import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT,
  productionStandardP0EvidenceProofValid,
  productionStandardP0ResolutionProof,
  productionStandardP0ResolutionProofValid
} from "./production-standard-p0-verifier.mjs";
import {
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
} from "./materialize-writer-journey-source.mjs";

export const PRODUCTION_PARITY_EXPECTED_TITLE =
  "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls";
export const PRODUCTION_PARITY_READBACK_RECEIPT_SCHEMA =
  "production-parity-persisted-readback-receipt-v2";
export const PRODUCTION_STANDARD_READBACK_RECEIPT_SCHEMA =
  "production-standard-canonical-naming-readback-receipt-v2";

const CANONICAL_PRODUCTION_ORIGIN = "https://listing.lyncafei.team";
const WRITER_JOURNEY_EVIDENCE_SCHEMA = "production-writer-journey-evidence-v6";
const PARITY_CASE_ID = "EXTERNAL_IDENTITY";
const STANDARD_CASE_ID = "NON_TCG";
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const EXPECTED_FIELDS = Object.freeze([
  "card_number", "manufacturer", "product", "set", "subjects", "team", "year"
]);

const exactObject = (value) => Boolean(value)
  && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => exactObject(value)
  && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function exactGitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!GIT_SHA.test(sha)) throw failure("production_parity_readback_git_sha_invalid");
  return sha;
}

function exactDeploymentUrl(value) {
  const raw = String(value || "").trim();
  let url;
  try { url = new URL(raw); } catch {
    throw failure("production_parity_readback_deployment_url_invalid");
  }
  if (raw !== url.origin || url.protocol !== "https:"
      || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)) {
    throw failure("production_parity_readback_deployment_url_invalid");
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

function exactStringSet(values, expected) {
  return Array.isArray(values)
    && values.length === expected.length
    && [...values].sort().join("\0") === [...expected].sort().join("\0");
}

function writerJourneyEvidenceValid(evidence, { deploymentUrl, gitSha }) {
  return exactObject(evidence)
    && evidence.schema_version === WRITER_JOURNEY_EVIDENCE_SCHEMA
    && evidence.evidence_scope === "LIVE_CONTRACT_RECEIPT_ONLY"
    && evidence.release_class === "ordinary"
    && evidence.passed === true
    && evidence.accuracy_claim === null
    && evidence.deployment_origin === deploymentUrl
    && evidence.deployment_identity === `${deploymentUrl}#${gitSha}`
    && evidence.deployment_git_commit_sha === gitSha
    && evidence.deployment_environment === "production";
}

function parityEvidence(evidence, { deploymentUrl, gitSha }) {
  if (!writerJourneyEvidenceValid(evidence, { deploymentUrl, gitSha })
      || evidence.final_seal?.codex_parity_exact_match_count !== 1
      || evidence.final_seal?.verified_original_set_match_count !== 1) {
    throw failure("production_parity_readback_evidence_invalid");
  }
  const matches = (Array.isArray(evidence.cases) ? evidence.cases : [])
    .filter((entry) => entry?.case_id === PARITY_CASE_ID);
  if (matches.length !== 1) throw failure("production_parity_readback_case_invalid");
  const entry = matches[0];
  const owner = entry.owner_execution_readback;
  const versions = entry.versions;
  const external = entry.external_identity_support;
  const assetId = safeId(entry.asset_id, "production_parity_readback_asset_id_invalid");
  const recognitionSessionId = String(entry.recognition_session_id || "").trim();
  if (!/^csmsess_[0-9a-f]{40}$/.test(recognitionSessionId)
      || entry.codex_parity_exact_match !== true
      || entry.resolution_http_method !== "GET"
      || entry.resolution_request_count !== 1
      || entry.trace_reliable !== true
      || entry.recomposed_matches_stored !== true
      || !exactKeys(owner, ["version", "sha256", "durable_read_after_write"])
      || owner.durable_read_after_write !== true
      || !SHA256.test(String(owner.sha256 || ""))
      || !exactKeys(versions, [
        "resolution_view_schema", "csm_contract", "resolver", "composer", "marketplace_profile"
      ])
      || !exactObject(external)
      || external.applied !== true
      || external.match_basis !== "VERIFIED_ORIGINAL_SET"
      || external.record_id !== "tcdb-2551-hr14"
      || external.registry_release_id !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id
      || external.registry_release_sha256
        !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.content_sha256
      || external.pack_id !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.id
      || external.pack_sha256 !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.sha256
      || external.index_id !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.index.id
      || external.index_sha256 !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.index.sha256
      || external.resolution_contract_sha256
        !== EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.sha256
      || !exactStringSet(external.supported_fields, EXPECTED_FIELDS)
      || external.source_count !== EXTERNAL_IDENTITY_SUPPORT_PACK.sources.length) {
    throw failure("production_parity_readback_case_invalid");
  }
  return Object.freeze({
    asset_id: assetId,
    recognition_session_id: recognitionSessionId,
    owner_execution_receipt_version: safeVersion(
      owner.version,
      "production_parity_readback_owner_version_invalid"
    ),
    owner_execution_receipt_sha256: owner.sha256,
    resolution_view_schema: safeVersion(
      versions.resolution_view_schema,
      "production_parity_readback_view_version_invalid"
    ),
    csm_contract_version: safeVersion(
      versions.csm_contract,
      "production_parity_readback_csm_version_invalid"
    ),
    resolver_version: safeVersion(
      versions.resolver,
      "production_parity_readback_resolver_version_invalid"
    ),
    composer_version: safeVersion(
      versions.composer,
      "production_parity_readback_composer_version_invalid"
    ),
    marketplace_profile_version: safeVersion(
      versions.marketplace_profile,
      "production_parity_readback_marketplace_profile_version_invalid"
    )
  });
}

function standardEvidence(evidence, { deploymentUrl, gitSha }) {
  if (!writerJourneyEvidenceValid(evidence, { deploymentUrl, gitSha })
      || !Number.isInteger(evidence.final_seal?.canonical_naming_active_case_count)
      || evidence.final_seal.canonical_naming_active_case_count < 1
      || evidence.final_seal?.standard_p0_exact_case_count !== 1) {
    throw failure("production_standard_readback_evidence_invalid");
  }
  const matches = (Array.isArray(evidence.cases) ? evidence.cases : [])
    .filter((entry) => entry?.case_id === STANDARD_CASE_ID);
  if (matches.length !== 1) throw failure("production_standard_readback_case_invalid");
  const entry = matches[0];
  const owner = entry.owner_execution_readback;
  const versions = entry.versions;
  const assetId = safeId(entry.asset_id, "production_standard_readback_asset_id_invalid");
  const recognitionSessionId = String(entry.recognition_session_id || "").trim();
  if (entry.expected_grammar !== "NON_TCG"
      || !/^csmsess_[0-9a-f]{40}$/.test(recognitionSessionId)
      || entry.canonical_naming_active !== true
      || entry.source_kind !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_kind
      || entry.source_record_id !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_record_id
      || entry.source_asset_id !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_asset_id
      || entry.hash_provenance !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.hash_provenance
      || !Array.isArray(entry.image_sha256)
      || entry.image_sha256.length !== 2
      || entry.image_sha256.some((image, index) => (
        !exactKeys(image, ["role", "content_sha256"])
        || image.role !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images[index].role
        || image.content_sha256
          !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images[index].content_sha256
      ))
      || !productionStandardP0EvidenceProofValid(entry.standard_p0_identity)
      || entry.resolution_http_method !== "GET"
      || entry.resolution_request_count !== 1
      || entry.provider_attempt_number !== 1
      || entry.provider_retry_count !== 0
      || entry.trace_reliable !== true
      || entry.recomposed_matches_stored !== true
      || !Number.isInteger(entry.title_length)
      || entry.title_length < 1
      || entry.title_length > CANONICAL_NAMING_RELEASE_CONTRACT.character_budget
      || Object.hasOwn(entry, "external_identity_support")
      || !exactKeys(owner, ["version", "sha256", "durable_read_after_write"])
      || owner.durable_read_after_write !== true
      || !SHA256.test(String(owner.sha256 || ""))
      || !exactKeys(versions, [
        "resolution_view_schema", "csm_contract", "resolver", "composer", "marketplace_profile"
      ])
      || versions.composer !== CANONICAL_NAMING_RELEASE_CONTRACT.composer_version
      || versions.marketplace_profile
        !== CANONICAL_NAMING_RELEASE_CONTRACT.marketplace_profile_version) {
    throw failure("production_standard_readback_case_invalid");
  }
  return Object.freeze({
    asset_id: assetId,
    source_asset_exact_match: true,
    writer_journey_standard_p0_exact: true,
    recognition_session_id: recognitionSessionId,
    title_length: entry.title_length,
    owner_execution_receipt_version: safeVersion(
      owner.version,
      "production_standard_readback_owner_version_invalid"
    ),
    owner_execution_receipt_sha256: owner.sha256,
    resolution_view_schema: safeVersion(
      versions.resolution_view_schema,
      "production_standard_readback_view_version_invalid"
    ),
    csm_contract_version: safeVersion(
      versions.csm_contract,
      "production_standard_readback_csm_version_invalid"
    ),
    resolver_version: safeVersion(
      versions.resolver,
      "production_standard_readback_resolver_version_invalid"
    ),
    composer_version: versions.composer,
    marketplace_profile_version: versions.marketplace_profile
  });
}

function verifyExternalIdentityReadback(support, entry) {
  const release = EXTERNAL_IDENTITY_RELEASE_CONTRACT;
  const sourceIds = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map(({ source_id: sourceId }) => sourceId);
  if (!exactObject(support)
      || support.schema_version !== "csm-external-identity-public-receipt.v1"
      || support.status !== "APPLIED"
      || support.match_basis !== "VERIFIED_ORIGINAL_SET"
      || Object.hasOwn(support, "original_set_sha256")
      || support.record_id !== "tcdb-2551-hr14"
      || support.registry_release?.id !== release.registry_release.id
      || support.registry_release?.registry_version
        !== THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.registry_version
      || support.registry_release?.content_sha256 !== release.registry_release.content_sha256
      || support.registry_release?.sem_standard_version
        !== THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.sem_standard_version
      || support.resolver_version !== release.resolution_contract.resolver_version
      || support.conflict_policy_version !== release.resolution_contract.conflict_policy_version
      || support.composer_version !== release.resolution_contract.composer_version
      || support.marketplace_profile_version
        !== release.resolution_contract.marketplace_profile_version
      || support.resolution_contract_sha256 !== release.resolution_contract.sha256
      || support.pack?.id !== release.support_pack.id
      || support.pack?.version !== release.support_pack.version
      || support.pack?.sha256 !== release.support_pack.sha256
      || support.index?.id !== release.index.id
      || support.index?.version !== release.index.version
      || support.index?.sha256 !== release.index.sha256
      || !exactStringSet(support.supported_fields, EXPECTED_FIELDS)
      || !exactStringSet((support.sources || []).map(({ source_id: id }) => id), sourceIds)
      || entry.resolver_version !== support.resolver_version
      || entry.composer_version !== support.composer_version
      || entry.marketplace_profile_version !== support.marketplace_profile_version) {
    throw failure("production_parity_readback_external_identity_mismatch");
  }
}

export function productionParityAssetId({ evidence, deploymentUrl, gitSha } = {}) {
  const target = exactDeploymentUrl(deploymentUrl);
  return parityEvidence(evidence, {
    deploymentUrl: target,
    gitSha: exactGitSha(gitSha)
  }).asset_id;
}

export function productionStandardAssetId({ evidence, deploymentUrl, gitSha } = {}) {
  const target = exactDeploymentUrl(deploymentUrl);
  return standardEvidence(evidence, {
    deploymentUrl: target,
    gitSha: exactGitSha(gitSha)
  }).asset_id;
}

export function verifyProductionParityReadback({
  evidence,
  resolutionView,
  deploymentUrl,
  gitSha,
  now = () => new Date()
} = {}) {
  const target = exactDeploymentUrl(deploymentUrl);
  const sha = exactGitSha(gitSha);
  const entry = parityEvidence(evidence, { deploymentUrl: target, gitSha: sha });
  const owner = resolutionView?.owner_execution_receipt;
  if (!exactObject(resolutionView)
      || resolutionView.asset_id !== entry.asset_id
      || resolutionView.recognition_session_id !== entry.recognition_session_id
      || resolutionView.schema_version !== entry.resolution_view_schema
      || resolutionView.grammar?.contract_version !== entry.resolution_view_schema
      || resolutionView.grammar?.resolver_version !== entry.resolver_version
      || resolutionView.composer?.composer_version !== entry.composer_version
      || resolutionView.composer?.marketplace_profile_version
        !== entry.marketplace_profile_version
      || resolutionView.composer?.stored_title !== PRODUCTION_PARITY_EXPECTED_TITLE
      || resolutionView.composer?.recomposed_matches_stored !== true
      || resolutionView.composer?.trace_reliable !== true
      || !exactKeys(owner, ["version", "sha256"])
      || owner.version !== entry.owner_execution_receipt_version
      || owner.sha256 !== entry.owner_execution_receipt_sha256) {
    throw failure("production_parity_readback_persisted_value_mismatch");
  }
  verifyExternalIdentityReadback(resolutionView.external_identity_support, entry);
  const receipt = Object.freeze({
    schema_version: PRODUCTION_PARITY_READBACK_RECEIPT_SCHEMA,
    canonical_origin: CANONICAL_PRODUCTION_ORIGIN,
    deployment_url: target,
    git_sha: sha,
    read_route: "/api/csm-resolution-view",
    http_method: "GET",
    provider_calls: 0,
    asset_id: entry.asset_id,
    recognition_session_id: entry.recognition_session_id,
    persisted_title_exact_match: true,
    resolution_view_schema: entry.resolution_view_schema,
    csm_contract_version: entry.csm_contract_version,
    resolver_version: entry.resolver_version,
    composer_version: entry.composer_version,
    marketplace_profile_version: entry.marketplace_profile_version,
    registry_release_id: EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id,
    registry_version: THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.registry_version,
    resolution_contract_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.sha256,
    owner_execution_receipt_version: entry.owner_execution_receipt_version,
    owner_execution_receipt_sha256: entry.owner_execution_receipt_sha256,
    durable_read_after_write: true,
    recomposed_matches_stored: true,
    trace_reliable: true,
    verified_at: now().toISOString()
  });
  const serialized = JSON.stringify(receipt);
  if (serialized.includes(PRODUCTION_PARITY_EXPECTED_TITLE)
      || /"(?:stored_title|title|title_sha256|sources)"/.test(serialized)) {
    throw failure("production_parity_readback_receipt_not_sanitized");
  }
  return receipt;
}

export function verifyProductionStandardReadback({
  evidence,
  resolutionView,
  deploymentUrl,
  gitSha,
  now = () => new Date()
} = {}) {
  const target = exactDeploymentUrl(deploymentUrl);
  const sha = exactGitSha(gitSha);
  const entry = standardEvidence(evidence, { deploymentUrl: target, gitSha: sha });
  const composer = resolutionView?.composer;
  const owner = resolutionView?.owner_execution_receipt;
  const storedTitle = String(composer?.stored_title || "").trim();
  const p0Proof = productionStandardP0ResolutionProof(resolutionView);
  if (!exactObject(resolutionView)
      || resolutionView.asset_id !== entry.asset_id
      || resolutionView.recognition_session_id !== entry.recognition_session_id
      || resolutionView.schema_version !== entry.resolution_view_schema
      || resolutionView.grammar?.value !== "NON_TCG"
      || resolutionView.grammar?.raw !== "standard"
      || resolutionView.grammar?.contract_version !== entry.resolution_view_schema
      || resolutionView.grammar?.resolver_version !== entry.resolver_version
      || composer?.composer_version !== entry.composer_version
      || composer?.marketplace_profile_version !== entry.marketplace_profile_version
      || composer?.title !== storedTitle
      || storedTitle.length !== entry.title_length
      || composer?.length !== storedTitle.length
      || composer?.character_budget !== CANONICAL_NAMING_RELEASE_CONTRACT.character_budget
      || composer?.truncated !== false
      || composer?.recomposed_matches_stored !== true
      || composer?.trace_reliable !== true
      || !productionStandardP0ResolutionProofValid(p0Proof)
      || Object.hasOwn(resolutionView, "external_identity_support")
      || !exactKeys(owner, ["version", "sha256"])
      || owner.version !== entry.owner_execution_receipt_version
      || owner.sha256 !== entry.owner_execution_receipt_sha256) {
    throw failure("production_standard_readback_persisted_value_mismatch");
  }
  const receipt = Object.freeze({
    schema_version: PRODUCTION_STANDARD_READBACK_RECEIPT_SCHEMA,
    canonical_origin: CANONICAL_PRODUCTION_ORIGIN,
    deployment_url: target,
    git_sha: sha,
    read_route: "/api/csm-resolution-view",
    http_method: "GET",
    provider_calls: 0,
    asset_id: entry.asset_id,
    recognition_session_id: entry.recognition_session_id,
    persisted_standard_canonical_naming: true,
    source_asset_exact_match: entry.source_asset_exact_match,
    writer_journey_standard_p0_exact: entry.writer_journey_standard_p0_exact,
    full_title_exact_match: p0Proof.stored_title_exact
      && p0Proof.recomposed_title_exact,
    card_number_exact_match: p0Proof.card_number_selected_exact,
    serial_exact_match: p0Proof.serial_selected_exact,
    selected_brackets_exact: p0Proof.selected_brackets_exact,
    resolution_view_schema: entry.resolution_view_schema,
    csm_contract_version: entry.csm_contract_version,
    resolver_version: entry.resolver_version,
    composer_version: entry.composer_version,
    marketplace_profile_version: entry.marketplace_profile_version,
    character_budget: CANONICAL_NAMING_RELEASE_CONTRACT.character_budget,
    truncated: false,
    owner_execution_receipt_version: entry.owner_execution_receipt_version,
    owner_execution_receipt_sha256: entry.owner_execution_receipt_sha256,
    durable_read_after_write: true,
    recomposed_matches_stored: true,
    trace_reliable: true,
    verified_at: now().toISOString()
  });
  const serialized = JSON.stringify(receipt);
  if (serialized.includes(PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title)
      || /"(?:stored_title|title|title_sha256|sources)"/.test(serialized)) {
    throw failure("production_standard_readback_receipt_not_sanitized");
  }
  return receipt;
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
  if (!path.isAbsolute(file)) throw failure("production_parity_readback_output_path_invalid");
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); } finally {
    await handle.close();
  }
  if (((await stat(file)).mode & 0o777) !== 0o600) {
    throw failure("production_parity_readback_output_permissions_invalid");
  }
}

function argumentsFor(argv) {
  const [mode, ...rest] = argv;
  const allowed = {
    "asset-id": ["--evidence", "--deployment-url", "--git-sha"],
    "standard-asset-id": ["--evidence", "--deployment-url", "--git-sha"],
    verify: ["--evidence", "--readback", "--deployment-url", "--git-sha", "--out"],
    "verify-standard": ["--evidence", "--readback", "--deployment-url", "--git-sha", "--out"]
  }[mode];
  if (!allowed || rest.length % 2 !== 0) {
    throw failure("production_parity_readback_arguments_invalid");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!allowed.includes(key) || value == null || values.has(key)) {
      throw failure("production_parity_readback_arguments_invalid");
    }
    values.set(key, value);
  }
  if (allowed.some((key) => !values.has(key))) {
    throw failure("production_parity_readback_arguments_invalid");
  }
  return { mode, values };
}

async function main(argv) {
  const { mode, values } = argumentsFor(argv);
  const evidence = await readJson(
    values.get("--evidence"),
    "production_parity_readback_evidence"
  );
  const input = {
    evidence,
    deploymentUrl: values.get("--deployment-url"),
    gitSha: values.get("--git-sha")
  };
  if (mode === "asset-id" || mode === "standard-asset-id") {
    const assetId = mode === "asset-id"
      ? productionParityAssetId(input)
      : productionStandardAssetId(input);
    process.stdout.write(`${assetId}\n`);
    return;
  }
  const resolutionView = await readJson(
    values.get("--readback"),
    "production_parity_readback_response",
    { privateFile: true }
  );
  const verify = mode === "verify"
    ? verifyProductionParityReadback
    : verifyProductionStandardReadback;
  await writePrivate(values.get("--out"), verify({ ...input, resolutionView }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "production_parity_readback_failed")
    })}\n`);
    process.exitCode = 1;
  });
}
