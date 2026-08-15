#!/usr/bin/env node

import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readVercelProductionRollbackReceipt
} from "./vercel-production-rollback-receipt.mjs";
import {
  governedIdentityAuthorityUrl,
  validateFounderBetaWebReceipt
} from "../lib/listing/thin/csm-forward-reader-bridge.mjs";
import {
  CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
} from "../lib/listing/thin/canonical-fields.mjs";
import { validateSetCardNameRelationReceipt } from
  "../lib/listing/thin/set-card-name-contract.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V2
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V2,
  THIN_RESOLVER_VERSION
} from
  "../lib/listing/thin/csm-persistence.mjs";
import {
  TCG_GRAMMAR_CONTEXT_NORMALIZATION_VERSION,
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";
import {
  validateVerifiedOriginalObservationPublicReceipt,
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import {
  productionStandardP0EvidenceProofValid,
  productionStandardP0ResolutionProof,
  productionStandardP0ResolutionProofValid
} from "./production-standard-p0-verifier.mjs";
import {
  COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE,
  COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
  COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
  EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_DESCRIPTOR_ID,
  EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_MARKER,
  EXTERNAL_IDENTITY_V3_CHECKPOINT_READER_BRIDGE_DESCRIPTOR_ID,
  EXTERNAL_IDENTITY_V3_CHECKPOINT_READER_BRIDGE_MARKER,
  EXTERNAL_IDENTITY_V3_CHECKPOINT_READER_BRIDGE_WRITER_PROJECTION_MODE,
  TCG_GRAMMAR_CONTEXT_READER_BRIDGE_DESCRIPTOR_ID,
  TCG_GRAMMAR_CONTEXT_READER_BRIDGE_MARKER,
  TCG_GRAMMAR_CONTEXT_READER_BRIDGE_WRITER_PROJECTION_MODE
} from "./compatibility-bridge-release.mjs";
export const PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA =
  "production-forward-readback-expectation-v1";
export const PRODUCTION_FORWARD_READBACK_RECEIPT_SCHEMA =
  "production-forward-readback-receipt-v1";
export const PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_EXPECTATION_SCHEMA =
  "production-forward-readback-expectation-v2";
export const PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_RECEIPT_SCHEMA =
  "production-forward-readback-receipt-v2";
export const PRODUCTION_FORWARD_READBACK_TCG_GRAMMAR_CONTEXT_EXPECTATION_SCHEMA =
  "production-forward-readback-expectation-v3";
export const PRODUCTION_FORWARD_READBACK_TCG_GRAMMAR_CONTEXT_RECEIPT_SCHEMA =
  "production-forward-readback-receipt-v3";
export const TCG_GRAMMAR_CONTEXT_AUTHORITY_PUBLIC_RECEIPT_SCHEMA =
  "csm-tcg-grammar-context-authority-public-receipt.v1";
export const PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE =
  COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE;
const PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_PROVENANCE = Object.freeze([{
  descriptorId: EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_DESCRIPTOR_ID,
  marker: EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_MARKER,
  writerProjectionMode: PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE,
  historicalDescriptorOptional: true
}, {
  descriptorId: EXTERNAL_IDENTITY_V3_CHECKPOINT_READER_BRIDGE_DESCRIPTOR_ID,
  marker: EXTERNAL_IDENTITY_V3_CHECKPOINT_READER_BRIDGE_MARKER,
  writerProjectionMode:
    EXTERNAL_IDENTITY_V3_CHECKPOINT_READER_BRIDGE_WRITER_PROJECTION_MODE,
  historicalDescriptorOptional: false
}, {
  descriptorId: TCG_GRAMMAR_CONTEXT_READER_BRIDGE_DESCRIPTOR_ID,
  marker: TCG_GRAMMAR_CONTEXT_READER_BRIDGE_MARKER,
  writerProjectionMode: TCG_GRAMMAR_CONTEXT_READER_BRIDGE_WRITER_PROJECTION_MODE,
  historicalDescriptorOptional: false
}]);
const PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_EVIDENCE_MODES = new Set(
  PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_PROVENANCE.map(
    (entry) => entry.writerProjectionMode
  )
);
const PRODUCTION_FORWARD_READBACK_COMPATIBILITY_WRITER_MODES = new Set([
  COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE,
  COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
  ...PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_EVIDENCE_MODES
]);

const WRITER_JOURNEY_EVIDENCE_SCHEMA = "production-writer-journey-evidence-v7";
const STANDARD_CASE_ID = "NON_TCG";
const WEB_CASE_ID = "NON_TCG_WEB_IDENTITY";
const ORDINARY_SEMANTIC_CASE_IDS = Object.freeze([
  "EXTERNAL_IDENTITY", "LOT_SHARED_ONLY", "NON_TCG", "NON_TCG_WEB_IDENTITY", "TCG"
]);
export const WEB_IDENTITY_VISIBLE_QUERY_ANCHORS = Object.freeze({
  subject: "anthony edwards",
  card_number: "105",
  product_set: "contenders"
});
export const WEB_IDENTITY_CONTENT_ACCEPTANCE = Object.freeze({
  original_set_sha256:
    "f2c21929f45fc664aa0136bb5f3ef045018b53bbe05ada9cf799bb914213f2a0",
  set: "Rookie Ticket",
  card_name: "Variation Autograph",
  card_number: "105"
});
const CANONICAL_PRODUCTION_ORIGIN = "https://listing.lyncafei.team";
const RELEASE_CLASSES = new Set(["ordinary", "compatibility-bridge"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SESSION_ID = /^csmsess_[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const TCG_GRAMMAR_CONTEXT_PUBLIC_RECEIPT_KEYS = Object.freeze([
  "claim_id", "conflict_codes", "ip_action", "normalization_version",
  "normalized_card_number", "normalized_set", "policy_version", "raw_grammar",
  "reason_code", "registry_content_sha256", "registry_record_sha256",
  "registry_release_id", "resolved_grammar", "schema_version",
  "source_authority", "status", "web_authority_used"
]);
const TCG_GRAMMAR_CONTEXT_SOURCE_AUTHORITY_KEYS = Object.freeze([
  "authority_used", "field_authority"
]);
const TCG_GRAMMAR_CONTEXT_FIELD_AUTHORITY_KEYS = Object.freeze([
  "current_image_source_present", "field", "web_source_present"
]);

const normalizedQueryText = (queries) => (Array.isArray(queries) ? queries : [])
  .map((query) => String(query ?? "").normalize("NFC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim())
  .filter(Boolean).join(" ");

/**
 * The provider owns query wording, but the designated live search still has to
 * be about the visible card. Match semantic anchors, never one frozen sentence.
 */
export function webIdentityQueryHasVisibleAnchors(queries) {
  const query = ` ${normalizedQueryText(queries)} `;
  const has = (anchor) => query.includes(` ${anchor} `);
  const subject = has(WEB_IDENTITY_VISIBLE_QUERY_ANCHORS.subject);
  const cardNumber = has(WEB_IDENTITY_VISIBLE_QUERY_ANCHORS.card_number);
  const productSet = has(WEB_IDENTITY_VISIBLE_QUERY_ANCHORS.product_set);
  return cardNumber && (subject || productSet);
}

export const governedIdentityAppliedSupportUrl = (value) => {
  if (!governedIdentityAuthorityUrl(value)) return false;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (host === "paniniamerica.net" || host.endsWith(".paniniamerica.net")) {
    return pathname.includes("/checklist");
  }
  if (host === "topps.com" || host.endsWith(".topps.com")) {
    return /(?:checklists?|card[-_]?lists?)(?:[./_-]|$)/.test(pathname);
  }
  if (host === "pokemon.com" || host.endsWith(".pokemon.com")) {
    return /(?:card[-_]?database|card[-_]?lists?)(?:[./_-]|$)/.test(pathname);
  }
  return false;
};

const canonicalBracket = (resolutionView, field) => {
  const matches = resolutionView?.brackets?.filter((bracket) => (
    bracket?.canonical_field === field
      || bracket?.canonical_fields?.includes?.(field)
  )) || [];
  return matches.length === 1 ? matches[0] : null;
};
const canonicalBracketValue = (resolutionView, field) => (
  canonicalBracket(resolutionView, field)?.selected_candidate
);

const publishedBracket = (resolutionView, field) => {
  const bracket = canonicalBracket(resolutionView, field);
  const canonical = String(bracket?.selected_candidate || "").normalize("NFC");
  const renderedText = String(bracket?.rendered_text || "").normalize("NFC");
  const coverage = bracket?.publication_coverage;
  const atom = Array.isArray(coverage) && coverage.length === 1 ? coverage[0] : null;
  const published = atom
    && Object.keys(atom).sort().join("\0") === [
      "bracket", "canonical_value", "disposition", "source_field", "source_index"
    ].sort().join("\0")
    && atom.bracket === bracket.bracket
    && atom.source_field === field
    && atom.source_index === 0
    && atom.canonical_value === canonical
    && atom.disposition === "PUBLISHED";
  return bracket?.state === "VALUE"
    && bracket.partially_published === false
    && canonical && renderedText && published
    && ["INCLUDED", "NORMALIZED"].includes(bracket.composer_disposition)
    ? Object.freeze({ canonical, rendered: renderedText })
    : null;
};

const exactRenderedSpan = (title, rendered) => {
  const text = String(title || "").normalize("NFC");
  const token = String(rendered || "").normalize("NFC");
  if (!token) return null;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"
  ))];
  return matches.length === 1
    ? Object.freeze({ index: matches[0].index, end: matches[0].index + token.length })
    : null;
};

export function webIdentityContentProjectionProof(resolutionView) {
  const relation = resolutionView?.set_card_name_relation_receipt;
  const set = publishedBracket(resolutionView, "set");
  const cardName = publishedBracket(resolutionView, "card_name");
  const subject = publishedBracket(resolutionView, "subjects");
  const cardNumber = publishedBracket(resolutionView, "card_number");
  const title = String(resolutionView?.composer?.stored_title || "").normalize("NFC");
  const setSpan = exactRenderedSpan(title, set?.rendered);
  const cardNameSpan = exactRenderedSpan(title, cardName?.rendered);
  const subjectSpan = exactRenderedSpan(title, subject?.rendered);
  const cardNumberSpan = exactRenderedSpan(title, cardNumber?.rendered);
  try {
    validateSetCardNameRelationReceipt(relation, {
      set: set?.canonical || "",
      card_name: cardName?.canonical || ""
    });
  } catch { return false; }
  return Boolean(set?.canonical === WEB_IDENTITY_CONTENT_ACCEPTANCE.set
    && cardName?.canonical === WEB_IDENTITY_CONTENT_ACCEPTANCE.card_name
    && cardNumber?.canonical === WEB_IDENTITY_CONTENT_ACCEPTANCE.card_number
    && Boolean(subject?.canonical)
    && relation?.set?.value === set.canonical
    && relation?.card_name?.value === cardName.canonical
    && setSpan && cardNameSpan && subjectSpan && cardNumberSpan
    && setSpan.end < cardNameSpan.index
    && cardNameSpan.end < subjectSpan.index
    && subjectSpan.end < cardNumberSpan.index);
}

export function strictNoSearchReceipt(receipt) {
  try { validateFounderBetaWebReceipt(receipt); } catch { return false; }
  return receipt.web_search_used === false
    && receipt.provider_request_count === 1
    && receipt.isolated_model_call_count === 0
    && receipt.web_search_call_count === 0
    && receipt.queries.length === 0
    && receipt.urls.length === 0
    && receipt.field_evidence.length === 0;
}

export function governedAppliedWebSupportProof(receipt, resolutionView, {
  originalSetSha256
} = {}) {
  try { validateFounderBetaWebReceipt(receipt); } catch { return false; }
  const appliedOfficialIdentitySupport = receipt.field_evidence.some((row) => (
    (row.field === "set" || row.field === "card_name")
    && row.support_urls.length > 0
    && row.support_urls.some(governedIdentityAppliedSupportUrl)
  ));
  return receipt.web_search_used === true
    && originalSetSha256 === WEB_IDENTITY_CONTENT_ACCEPTANCE.original_set_sha256
    && receipt.web_search_call_count >= 1
    && receipt.web_search_call_count <= CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
    && receipt.queries.length >= 1
    && webIdentityQueryHasVisibleAnchors(receipt.queries)
    && receipt.urls.length >= 1
    && appliedOfficialIdentitySupport
    && webIdentityContentProjectionProof(resolutionView);
}

export const FOUNDER_WEB_SEARCH_CLASSIFICATION = Object.freeze({
  STRICT_NO_SEARCH: "STRICT_NO_SEARCH",
  GOVERNED_APPLIED_SUPPORT: "GOVERNED_APPLIED_SUPPORT",
  USED_WITHOUT_GOVERNED_APPLIED_SUPPORT: "USED_WITHOUT_GOVERNED_APPLIED_SUPPORT"
});

export function classifyFounderWebSearchSignals({
  webSearchUsed,
  governedAppliedSupport,
  strictNoSearch
} = {}) {
  const matches = [
    [FOUNDER_WEB_SEARCH_CLASSIFICATION.GOVERNED_APPLIED_SUPPORT,
      webSearchUsed === true && governedAppliedSupport === true && strictNoSearch === false],
    [FOUNDER_WEB_SEARCH_CLASSIFICATION.STRICT_NO_SEARCH,
      webSearchUsed === false && governedAppliedSupport === false && strictNoSearch === true],
    [FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT,
      webSearchUsed === true && governedAppliedSupport === false && strictNoSearch === false]
  ].filter(([, matched]) => matched === true);
  return matches.length === 1 ? matches[0][0] : null;
}

export function classifyFounderWebSearch(receipt, resolutionView, {
  originalSetSha256
} = {}) {
  try { validateFounderBetaWebReceipt(receipt); } catch { return null; }
  const governedAppliedSupport = governedAppliedWebSupportProof(receipt, resolutionView, {
    originalSetSha256
  });
  const strictNoSearch = strictNoSearchReceipt(receipt);
  const usedWithoutGovernedAppliedSupport = receipt.web_search_used
    && !governedAppliedSupport;
  const classification = classifyFounderWebSearchSignals({
    webSearchUsed: receipt.web_search_used,
    governedAppliedSupport,
    strictNoSearch
  });
  if (!classification) return null;
  return Object.freeze({
    classification,
    governed_applied_support: governedAppliedSupport,
    strict_no_search: strictNoSearch,
    used_without_governed_applied_support: usedWithoutGovernedAppliedSupport
  });
}

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

const sha256Stable = (value) => createHash("sha256")
  .update(stableJson(value), "utf8").digest("hex");
const TCG_GRAMMAR_CONTEXT_REGISTRY_RECORD_SHA256 = sha256Stable(
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.records[0]
);

function exactTcgGrammarContextAuthorityReceipt(value) {
  const source = value?.source_authority;
  const fieldAuthority = source?.field_authority;
  return exactKeys(value, TCG_GRAMMAR_CONTEXT_PUBLIC_RECEIPT_KEYS)
    && value.schema_version === TCG_GRAMMAR_CONTEXT_AUTHORITY_PUBLIC_RECEIPT_SCHEMA
    && value.status === "APPLIED"
    && value.claim_id === TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.records[0].claim_id
    && value.raw_grammar === "standard"
    && value.resolved_grammar === "tcg"
    && value.normalized_set === "Trainer Gallery"
    && value.normalized_card_number === "TG22/TG30"
    && value.registry_release_id === TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id
    && value.registry_content_sha256
      === TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.content_sha256
    && value.registry_record_sha256 === TCG_GRAMMAR_CONTEXT_REGISTRY_RECORD_SHA256
    && value.normalization_version === TCG_GRAMMAR_CONTEXT_NORMALIZATION_VERSION
    && value.policy_version
      === TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.conflict_policy_version
    && value.reason_code === "EXACT_JOINT_SET_NUMBER_NAMESPACE"
    && Array.isArray(value.conflict_codes)
    && value.conflict_codes.length === 0
    && value.ip_action === "UNCHANGED"
    && value.web_authority_used === false
    && exactKeys(source, TCG_GRAMMAR_CONTEXT_SOURCE_AUTHORITY_KEYS)
    && source.authority_used === "CURRENT_IMAGE"
    && Array.isArray(fieldAuthority)
    && stableJson(fieldAuthority.map((row) => row?.field))
      === stableJson(["card_number", "set"])
    && fieldAuthority.every((row) => (
      exactKeys(row, TCG_GRAMMAR_CONTEXT_FIELD_AUTHORITY_KEYS)
      && row.current_image_source_present === true
      && typeof row.web_source_present === "boolean"
    ));
}

export function productionTcgGrammarContextAuthorityReceiptExact(value) {
  return exactTcgGrammarContextAuthorityReceipt(value);
}

/**
 * Exact public acceptance proof for the frozen Production TCG case. The Web
 * may have been used as support, but it is never admitted as Grammar authority.
 */
export function productionTcgGrammarContextAuthorityProof(resolutionView) {
  const receipt = resolutionView?.tcg_grammar_context_authority_receipt;
  const set = canonicalBracketValue(resolutionView, "set");
  const cardNumber = canonicalBracketValue(resolutionView, "card_number");
  if (!exactTcgGrammarContextAuthorityReceipt(receipt)
      || resolutionView?.grammar?.value !== "TCG"
      || resolutionView?.grammar?.raw !== "standard"
      || resolutionView?.grammar?.resolver_version
        !== TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.resolver_version
      || set !== receipt.normalized_set
      || cardNumber !== receipt.normalized_card_number) return null;
  return structuredClone(receipt);
}

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

function sanitizedCandidateReadbackCase(evidence, entry, {
  writerProjectionMode = null
} = {}) {
  const owner = entry?.owner_execution_readback;
  const versions = entry?.versions;
  const assetId = safeId(entry?.asset_id,
    "production_forward_readback_asset_id_invalid");
  const recognitionSessionId = String(entry?.recognition_session_id || "").trim();
  const tcgGrammarContextV4 = versions?.csm_contract
    === CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
  const tcgGrammarContextAuthorityReceipt =
    entry?.tcg_grammar_context_authority_receipt;
  if (!["NON_TCG", "TCG", "LOT"].includes(entry?.expected_grammar)
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
      ])
      || (tcgGrammarContextV4 && (
        entry.case_id !== "TCG"
        || !exactTcgGrammarContextAuthorityReceipt(
          tcgGrammarContextAuthorityReceipt
        )
      ))
      || (!tcgGrammarContextV4
        && tcgGrammarContextAuthorityReceipt != null)) {
    throw failure("production_forward_readback_standard_case_invalid");
  }
  return Object.freeze({
    release_class: evidence.release_class,
    ...(writerProjectionMode ? { writer_projection_mode: writerProjectionMode } : {}),
    case_id: entry.case_id,
    expected_grammar: entry.expected_grammar,
    original_set_sha256: entry.original_set_sha256 || null,
    asset_id: assetId,
    recognition_session_id: recognitionSessionId,
    title_length: entry.title_length,
    owner_execution_receipt: {
      version: safeVersion(owner.version,
        "production_forward_readback_owner_version_invalid"),
      sha256: owner.sha256
    },
    ...(tcgGrammarContextV4 ? {
      tcg_grammar_context_authority_receipt:
        structuredClone(tcgGrammarContextAuthorityReceipt)
    } : {}),
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

function candidateReadbackCase(evidence, { deploymentUrl, gitSha }) {
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
  const cases = Array.isArray(evidence.cases) ? evidence.cases : [];
  if (evidence.release_class === "compatibility-bridge"
      && !PRODUCTION_FORWARD_READBACK_COMPATIBILITY_WRITER_MODES.has(
        evidence.writer_projection_mode
      )) {
    throw failure("production_forward_readback_writer_projection_mode_invalid");
  }
  const transportOnlyCases = cases.filter((entry) => entry?.transport_only === true);
  if (transportOnlyCases.length !== 1
      || transportOnlyCases[0]?.case_id !== "LARGE_STAGED_TRANSPORT"
      || transportOnlyCases[0]?.founder_web_search != null
      || cases.some((entry) => entry?.case_id === "LARGE_STAGED_TRANSPORT"
        ? entry.transport_only !== true : entry?.transport_only === true)) {
    throw failure("production_forward_readback_standard_case_invalid");
  }
  const semanticCases = cases.filter((entry) => entry?.transport_only !== true);
  const capturedProductionWriterMode =
    PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_EVIDENCE_MODES.has(
      evidence.writer_projection_mode
    );
  const capturedProductionWriter = evidence.release_class === "compatibility-bridge"
    && capturedProductionWriterMode;
  if (!capturedProductionWriter && capturedProductionWriterMode) {
    throw failure("production_forward_readback_captured_writer_evidence_invalid");
  }
  if (capturedProductionWriter) {
    const bridgeProvenance = PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_PROVENANCE.find(
      (candidate) => candidate.writerProjectionMode === evidence.writer_projection_mode
    );
    const entry = semanticCases.find((candidate) => candidate?.case_id === STANDARD_CASE_ID);
    const tcgEntry = semanticCases.find((candidate) => candidate?.case_id === "TCG");
    const largeEntry = transportOnlyCases[0];
    const finalSeal = evidence.final_seal;
    if (!bridgeProvenance
        || evidence.compatibility_bridge_marker !== bridgeProvenance.marker
        || (evidence.compatibility_bridge_descriptor_id !== bridgeProvenance.descriptorId
          && !(bridgeProvenance.historicalDescriptorOptional
            && evidence.compatibility_bridge_descriptor_id == null))
        || cases.map((candidate) => candidate?.case_id).sort().join("\0")
          !== "LARGE_STAGED_TRANSPORT\0NON_TCG\0TCG"
        || semanticCases.map((candidate) => candidate?.case_id).sort().join("\0")
          !== "NON_TCG\0TCG"
        || cases.some((candidate) => Object.prototype.hasOwnProperty.call(
          candidate || {}, "founder_web_search"
        ))
        || entry?.expected_grammar !== "NON_TCG"
        || entry?.captured_e1ae_standard_active !== true
        || entry?.canonical_naming_active !== false
        || entry?.compatibility_bridge_standard_active !== false
        || entry?.verified_original_observation_active !== true
        || !productionStandardP0EvidenceProofValid(entry?.standard_p0_identity)
        || entry?.versions?.resolution_view_schema !== "csm-resolution-view-v1"
        || entry?.versions?.csm_contract !== "csm-stage-shadow-v2"
        || entry?.versions?.resolver !== VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
        || entry?.versions?.composer
          !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version
        || entry?.versions?.marketplace_profile
          !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
        || tcgEntry?.expected_grammar !== "TCG"
        || tcgEntry?.versions?.resolution_view_schema !== "csm-resolution-view-v1"
        || tcgEntry?.versions?.csm_contract !== "csm-stage-shadow-v2"
        || tcgEntry?.versions?.resolver !== THIN_RESOLVER_VERSION
        || tcgEntry?.versions?.composer !== THIN_COMPOSER_VERSION_V2
        || tcgEntry?.versions?.marketplace_profile !== EBAY_PROFILE_VERSION
        || tcgEntry?.captured_e1ae_standard_active !== false
        || tcgEntry?.canonical_naming_active !== false
        || tcgEntry?.compatibility_bridge_standard_active !== true
        || tcgEntry?.verified_original_observation_active !== false
        || largeEntry?.expected_grammar !== "NON_TCG"
        || largeEntry?.transport_only !== true
        || largeEntry?.versions?.resolution_view_schema !== "csm-resolution-view-v1"
        || largeEntry?.versions?.csm_contract !== "csm-stage-shadow-v2"
        || largeEntry?.versions?.resolver !== THIN_RESOLVER_VERSION
        || largeEntry?.versions?.composer
          !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version
        || largeEntry?.versions?.marketplace_profile
          !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
        || largeEntry?.captured_e1ae_standard_active !== true
        || largeEntry?.canonical_naming_active !== false
        || largeEntry?.overlap_observed !== true
        || largeEntry?.relay_durable_before_recognition_response !== true
        || ![entry, tcgEntry, largeEntry].every((candidate) => (
          exactKeys(candidate?.owner_execution_readback, [
            "version", "sha256", "durable_read_after_write"
          ])
          && candidate.owner_execution_readback.version === "csm-owner-execution-receipt-v1"
          && SHA256.test(String(candidate?.owner_execution_readback?.sha256 || ""))
          && candidate?.owner_execution_readback?.durable_read_after_write === true
        ))
        || finalSeal?.provider_case_count !== 3
        || finalSeal?.durable_owner_execution_readback_count !== 3
        || finalSeal?.captured_e1ae_standard_active_case_count !== 2
        || finalSeal?.canonical_naming_active_case_count !== 0
        || finalSeal?.compatibility_bridge_standard_case_count !== 1
        || finalSeal?.verified_original_observation_active_case_count !== 1
        || finalSeal?.standard_p0_exact_case_count !== 1
        || finalSeal?.qualified_governed_web_support_case_count !== 0
        || finalSeal?.strict_no_search_case_count !== 0
        || finalSeal?.used_without_governed_applied_support_case_count !== 0
        || finalSeal?.semantic_web_case_count !== 0
        || finalSeal?.transport_only_web_excluded_case_count !== 1
        || finalSeal?.selected_forward_readback_case_id !== null
        || finalSeal?.durable_projection_receipts_absent !== true
        || finalSeal?.durable_projection_receipt_omission_case_count !== 3) {
      throw failure("production_forward_readback_captured_writer_evidence_invalid");
    }
    return sanitizedCandidateReadbackCase(evidence, entry, {
      writerProjectionMode: PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE
    });
  }
  const webClassifications = semanticCases.map((entry) => {
    const proof = entry?.founder_web_search;
    const classification = exactKeys(proof, [
      "classification", "governed_applied_support", "governed_support_fields",
      "governed_support_url_count", "query_recorded", "query_visible_anchor_match",
      "source_url_count", "strict_no_search", "unresolved_authority_fields",
      "used_without_governed_applied_support", "web_search_call_count", "web_search_used"
    ]) ? classifyFounderWebSearchSignals({
        webSearchUsed: proof.web_search_used,
        governedAppliedSupport: proof.governed_applied_support,
        strictNoSearch: proof.strict_no_search
      }) : null;
    return Object.freeze({ entry, proof, classification });
  });
  const tcgGrammarContextCase = semanticCases.find(
    (entry) => entry?.case_id === "TCG"
  );
  const ordinaryTcgGrammarContextV4 = evidence.release_class === "ordinary"
    && cases.every((entry) => entry?.versions?.csm_contract
      === CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION);
  const tcgGrammarContextReceiptExact = exactTcgGrammarContextAuthorityReceipt(
    tcgGrammarContextCase?.tcg_grammar_context_authority_receipt
  );
  const matches = evidence.release_class === "ordinary"
    ? ordinaryTcgGrammarContextV4
      ? [tcgGrammarContextCase].filter(Boolean)
      : webClassifications.filter(({ entry, classification }) => (
        classification === FOUNDER_WEB_SEARCH_CLASSIFICATION.GOVERNED_APPLIED_SUPPORT
        && entry?.original_set_sha256
          === WEB_IDENTITY_CONTENT_ACCEPTANCE.original_set_sha256
      )).map(({ entry }) => entry).sort((left, right) => Number(right.case_id === WEB_CASE_ID)
        - Number(left.case_id === WEB_CASE_ID))
    : webClassifications.filter(({ entry }) => entry?.case_id === STANDARD_CASE_ID)
      .map(({ entry }) => entry);
  const strictNoSearchCount = webClassifications.filter(({ classification }) => (
    classification === FOUNDER_WEB_SEARCH_CLASSIFICATION.STRICT_NO_SEARCH
  )).length;
  const governedClassificationCount = webClassifications.filter(({ classification }) => (
    classification === FOUNDER_WEB_SEARCH_CLASSIFICATION.GOVERNED_APPLIED_SUPPORT
  )).length;
  const usedWithoutGovernedAppliedSupportCount = webClassifications.filter(
    ({ classification }) => (
      classification
        === FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT
    )
  ).length;
  if (webClassifications.some(({ proof, classification }) => (
    !classification || proof.classification !== classification
    || proof.used_without_governed_applied_support !== (
      classification
        === FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT
    )
  ))
      || matches.length !== 1
      || (ordinaryTcgGrammarContextV4 && (
        !tcgGrammarContextReceiptExact
        || semanticCases.some((entry) => entry?.case_id !== "TCG"
          && Object.prototype.hasOwnProperty.call(
            entry || {}, "tcg_grammar_context_authority_receipt"
          ))
      ))
      || (!ordinaryTcgGrammarContextV4 && semanticCases.some((entry) => (
        Object.prototype.hasOwnProperty.call(
          entry || {}, "tcg_grammar_context_authority_receipt"
        )
      )))
      || governedClassificationCount + strictNoSearchCount
        + usedWithoutGovernedAppliedSupportCount !== semanticCases.length
      || (evidence.release_class === "ordinary" && (
        semanticCases.length !== 5
        || semanticCases.map((entry) => entry?.case_id).sort().join("\0")
          !== ORDINARY_SEMANTIC_CASE_IDS.join("\0")
        || strictNoSearchCount < 1
        || governedClassificationCount !== 1
        || evidence.final_seal?.qualified_governed_web_support_case_count
          !== governedClassificationCount
        || evidence.final_seal?.strict_no_search_case_count !== strictNoSearchCount
        || evidence.final_seal?.used_without_governed_applied_support_case_count
          !== usedWithoutGovernedAppliedSupportCount
        || evidence.final_seal?.semantic_web_case_count !== semanticCases.length
        || evidence.final_seal?.transport_only_web_excluded_case_count
          !== transportOnlyCases.length
        || evidence.final_seal?.selected_forward_readback_case_id
          !== matches[0]?.case_id
      ))) {
    throw failure("production_forward_readback_standard_case_invalid");
  }
  return sanitizedCandidateReadbackCase(evidence, matches[0]);
}

function capturedProductionProjectionReceiptsAbsent(resolutionView) {
  return [
    "founder_beta_web_receipt", "set_card_name_relation_receipt",
    "publication_coverage", "lot_terminal",
    "tcg_grammar_context_authority_receipt"
  ].every((key) => !Object.prototype.hasOwnProperty.call(resolutionView || {}, key))
    && (resolutionView?.brackets || []).every((bracket) => (
      !Object.prototype.hasOwnProperty.call(bracket || {}, "publication_coverage")
    ));
}

function capturedProductionVerifiedSupportExact(resolutionView) {
  const support = resolutionView?.verified_original_observation_support;
  let valid = false;
  try { valid = validateVerifiedOriginalObservationPublicReceipt(support); } catch { return false; }
  return valid
    && support.release_id === VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT.release_id
    && support.pack_sha256 === VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT.pack_sha256
    && support.resolver_version === VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
    && support.resolution_contract_sha256
      === VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT.resolution_contract_sha256
    && !Object.prototype.hasOwnProperty.call(
      resolutionView || {}, "external_identity_support"
    );
}

function validateResolutionView(resolutionView, entry) {
  const composer = resolutionView?.composer;
  const storedTitle = typeof composer?.stored_title === "string"
    ? composer.stored_title : "";
  const legacyV2View = entry.versions.composer === "thin-marketplace-composer-v2"
    && entry.versions.marketplace_profile === "ebay-profile-v1"
    && composer?.marketplace_profile_version == null;
  let webReceipt = null;
  let webClassification = null;
  let relationReceipt = null;
  const tcgGrammarContextV4 = entry.versions.csm_contract
    === CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
  if (entry.release_class === "ordinary") {
    try {
      webReceipt = validateFounderBetaWebReceipt(
        resolutionView?.founder_beta_web_receipt
      );
      webClassification = classifyFounderWebSearch(webReceipt, resolutionView, {
        originalSetSha256: entry.original_set_sha256
      });
      if (entry.release_class === "ordinary") {
        const publicRelation = resolutionView?.set_card_name_relation_receipt;
        relationReceipt = validateSetCardNameRelationReceipt(publicRelation, {
          set: canonicalBracketValue(resolutionView, "set") || "",
          card_name: canonicalBracketValue(resolutionView, "card_name") || ""
        });
      }
    } catch {
      throw failure("production_forward_readback_web_receipt_invalid");
    }
  }
  const expectedRawGrammar = tcgGrammarContextV4
    ? "standard" : entry.expected_grammar === "NON_TCG"
      ? "standard" : entry.expected_grammar.toLowerCase();
  const capturedProductionWriter = entry.writer_projection_mode
    === PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE;
  if (!exactObject(resolutionView)
      || resolutionView.asset_id !== entry.asset_id
      || resolutionView.recognition_session_id !== entry.recognition_session_id
      || resolutionView.schema_version !== entry.versions.resolution_view_schema
      || resolutionView.grammar?.value !== entry.expected_grammar
      || resolutionView.grammar?.raw !== expectedRawGrammar
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
        !== stableJson(entry.owner_execution_receipt)
      || (tcgGrammarContextV4 && (
        stableJson(productionTcgGrammarContextAuthorityProof(resolutionView))
          !== stableJson(entry.tcg_grammar_context_authority_receipt)
      ))
      || (!tcgGrammarContextV4 && Object.prototype.hasOwnProperty.call(
        resolutionView || {}, "tcg_grammar_context_authority_receipt"
      ))
      || (capturedProductionWriter && (
        entry.versions.csm_contract !== "csm-stage-shadow-v2"
        || entry.versions.resolver !== VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
        || entry.versions.composer !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version
        || entry.versions.marketplace_profile
          !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
        || !capturedProductionProjectionReceiptsAbsent(resolutionView)
        || !capturedProductionVerifiedSupportExact(resolutionView)
        || !productionStandardP0ResolutionProofValid(
          productionStandardP0ResolutionProof(resolutionView)
        )
      ))
      || (entry.release_class === "ordinary" && !tcgGrammarContextV4 && (
        entry.versions.csm_contract !== "csm-stage-shadow-v3"
        || webReceipt.web_search_used !== true
        || webReceipt.web_search_call_count < 1
        || webReceipt.web_search_call_count > CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
        || webReceipt.provider_request_count !== 1
        || webReceipt.isolated_model_call_count !== 0
        || webReceipt.queries.length < 1
        || !webIdentityQueryHasVisibleAnchors(webReceipt.queries)
        || webReceipt.urls.length < 1
        || webReceipt.field_evidence.length < 1
        || webClassification?.classification
          !== FOUNDER_WEB_SEARCH_CLASSIFICATION.GOVERNED_APPLIED_SUPPORT
      ))
      || (entry.release_class === "ordinary" && tcgGrammarContextV4 && (
        entry.case_id !== "TCG"
        || entry.versions.resolver
          !== TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.resolver_version
        || entry.versions.composer !== THIN_COMPOSER_VERSION_V2
        || entry.versions.marketplace_profile !== EBAY_PROFILE_VERSION
      ))) {
    throw failure("production_forward_readback_resolution_view_invalid");
  }
  return structuredClone(resolutionView);
}

function validateExpectation(expectation, { evidence, deploymentUrl, gitSha }) {
  const entry = candidateReadbackCase(evidence, { deploymentUrl, gitSha });
  const capturedProductionWriter = entry.writer_projection_mode
    === PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE;
  const tcgGrammarContextV4 = entry.versions.csm_contract
    === CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
  const expectationKeys = [
    "schema_version", "candidate_deployment_origin", "candidate_git_sha",
    "release_class", "case_id", "asset_id", "recognition_session_id",
    "resolution_view",
    ...(capturedProductionWriter ? ["writer_projection_mode"] : [])
  ];
  if (!exactKeys(expectation, expectationKeys)
      || expectation.schema_version !== (capturedProductionWriter
        ? PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_EXPECTATION_SCHEMA
        : tcgGrammarContextV4
          ? PRODUCTION_FORWARD_READBACK_TCG_GRAMMAR_CONTEXT_EXPECTATION_SCHEMA
          : PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA)
      || (capturedProductionWriter && expectation.writer_projection_mode
        !== PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE)
      || expectation.candidate_deployment_origin !== deploymentUrl
      || expectation.candidate_git_sha !== gitSha
      || expectation.release_class !== entry.release_class
      || expectation.case_id !== entry.case_id
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
  const entry = candidateReadbackCase(evidence, {
    deploymentUrl: candidateOrigin,
    gitSha: sha
  });
  const capturedProductionWriter = entry.writer_projection_mode
    === PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE;
  const tcgGrammarContextV4 = entry.versions.csm_contract
    === CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
  return Object.freeze({
    schema_version: capturedProductionWriter
      ? PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_EXPECTATION_SCHEMA
      : tcgGrammarContextV4
        ? PRODUCTION_FORWARD_READBACK_TCG_GRAMMAR_CONTEXT_EXPECTATION_SCHEMA
        : PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA,
    candidate_deployment_origin: candidateOrigin,
    candidate_git_sha: sha,
    release_class: entry.release_class,
    case_id: entry.case_id,
    asset_id: entry.asset_id,
    recognition_session_id: entry.recognition_session_id,
    ...(capturedProductionWriter ? {
      writer_projection_mode: PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE
    } : {}),
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
  const capturedProductionWriter = validated.entry.writer_projection_mode
    === PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE;
  const tcgGrammarContextV4 = validated.entry.versions.csm_contract
    === CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
  const receipt = Object.freeze({
    schema_version: capturedProductionWriter
      ? PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_RECEIPT_SCHEMA
      : tcgGrammarContextV4
        ? PRODUCTION_FORWARD_READBACK_TCG_GRAMMAR_CONTEXT_RECEIPT_SCHEMA
        : PRODUCTION_FORWARD_READBACK_RECEIPT_SCHEMA,
    canonical_origin: CANONICAL_PRODUCTION_ORIGIN,
    canonical_read_scope: readScope,
    canonical_read_deployment_git_sha: readDeploymentGitSha,
    candidate_deployment_origin: candidateOrigin,
    candidate_git_sha: sha,
    release_class: validated.entry.release_class,
    ...(capturedProductionWriter ? {
      writer_projection_mode: PRODUCTION_FORWARD_READBACK_CAPTURED_WRITER_MODE
    } : {}),
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
    founder_beta_web_receipt_exact_match:
      validated.entry.release_class === "ordinary" || capturedProductionWriter,
    web_search_used: validated.entry.release_class === "ordinary"
      ? readback.founder_beta_web_receipt.web_search_used : false,
    web_search_call_count: validated.entry.release_class === "ordinary"
      ? readback.founder_beta_web_receipt.web_search_call_count : 0,
    ...(tcgGrammarContextV4 ? {
      tcg_grammar_context_authority_receipt_exact_match: true,
      tcg_grammar_context_registry_release_id:
        TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
      tcg_grammar_context_registry_content_sha256:
        TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.content_sha256,
      tcg_grammar_context_resolution_contract_sha256:
        TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.contract_sha256,
      tcg_grammar_context_web_authority_used: false
    } : {}),
    ...(capturedProductionWriter ? {
      durable_projection_receipts_absent: true,
      verified_original_observation_support_exact_match: true
    } : {}),
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
