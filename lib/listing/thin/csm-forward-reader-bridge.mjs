import { createHash } from "node:crypto";

import {
  CANONICAL_FIELD_NAMES,
  CANONICAL_FIELD_SOURCE_FIELDS,
  CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
} from "./canonical-fields.mjs";
import {
  externalIdentityReplayReleaseForReceipt,
  validateExternalIdentityDecisionObservation,
  validateExternalIdentityEvidenceSourceRef,
  validateExternalIdentityFieldDecisions,
  validateExternalIdentitySourceProvenance
} from "../knowledge/csm-external-identity-support.mjs";
import { SEM_STANDARD_VERSION } from "../csm/sem-definition.mjs";
import { validateLotTerminalReceipt } from "./lot-terminal-contract.mjs";
import { validatePublicationCoverage } from "./publication-coverage.mjs";
import { validateSetCardNameRelationReceipt } from "./set-card-name-contract.mjs";
import {
  validateVerifiedOriginalObservationReceipt,
  validateVerifiedOriginalObservationReceiptShape,
  validateVerifiedOriginalObservationSourceRef,
  verifiedOriginalObservationComposerContractForReceipt,
  verifiedOriginalObservationReplayProjection,
  VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
} from "./verified-original-observation-support.mjs";

export const CSM_DURABLE_PROJECTION_CONTRACT_VERSION = "csm-stage-shadow-v3";
export const CSM_LEGACY_PROJECTION_CONTRACT_VERSION = "csm-stage-shadow-v2";
export const CSM_FORWARD_READER_BRIDGE_VERSION = "csm-durable-forward-reader-v1";
export const FOUNDER_BETA_WEB_RECEIPT_V1_VERSION = "founder-beta-web-receipt-v1";
export const FOUNDER_BETA_WEB_RECEIPT_VERSION = "founder-beta-web-receipt-v2";
export const FOUNDER_BETA_WEB_RECEIPT_OUTCOME = Object.freeze({
  NOT_USED: "NOT_USED",
  USED_WITH_FIELD_EVIDENCE: "USED_WITH_FIELD_EVIDENCE",
  USED_WITHOUT_FIELD_EVIDENCE: "USED_WITHOUT_FIELD_EVIDENCE"
});

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalValue(value[key])]));
};

const sameValue = (left, right) => JSON.stringify(canonicalValue(left))
  === JSON.stringify(canonicalValue(right));

const safeUrl = (value) => {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  return url.protocol === "https:" && !url.username && !url.password && !url.port
    && String(value).length <= 2_048
    && String(value) === `${url.origin}${url.pathname}`;
};
const exactTextList = (value, max = Infinity) => Array.isArray(value)
  && value.length <= max
  && value.every((entry) => typeof entry === "string" && entry === entry.trim() && entry)
  && new Set(value).size === value.length;

const clean = (value) => String(value ?? "").normalize("NFC")
  .replace(/\s+/g, " ").trim();

function traceSearchQueries(action = {}) {
  if (clean(action.type).toLowerCase() !== "search") return [];
  const values = [action.query, ...(Array.isArray(action.queries) ? action.queries : [])]
    .map(clean).filter(Boolean);
  if (values.some((value) => value.length > 500)) {
    throw new TypeError("founder_beta_web_query_too_long");
  }
  return values;
}

function traceActionUrl(action = {}) {
  const type = clean(action.type).toLowerCase();
  if (type !== "open_page" && type !== "find_in_page") return null;
  if (!clean(action.url)) throw new TypeError("founder_beta_web_action_url_missing");
  return action.url;
}

function sanitizeTraceUrl(value) {
  let url;
  try { url = new URL(clean(value)); } catch {
    throw new TypeError("founder_beta_web_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port
      || clean(value).length > 2_048) {
    throw new TypeError("founder_beta_web_url_unsafe");
  }
  return `${url.origin}${url.pathname}`;
}

const GOVERNED_IDENTITY_AUTHORITY_HOSTS = new Set([
  "paniniamerica.net", "topps.com", "pokemon.com"
]);
const WEB_IDENTITY_FIELDS = new Set([
  "year", "manufacturer", "product", "set", "subjects", "card_name"
]);

export function governedIdentityAuthorityUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  return [...GOVERNED_IDENTITY_AUTHORITY_HOSTS].some(
    (authority) => host === authority || host.endsWith(`.${authority}`)
  );
}

/**
 * Derive the durable receipt from the provider trace, never from model JSON.
 * One Responses request may choose zero, one, or two bounded Web actions.
 */
function founderBetaCanonicalAuthorityAudit(body, {
  rawOutput,
  request,
  fieldSources,
  originalImageCount
} = {}) {
  const output = Array.isArray(body?.output) ? body.output : [];
  const calls = output.filter((item) => item?.type === "web_search_call");
  if (calls.length > CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS) {
    throw new TypeError("founder_beta_web_call_budget_exceeded");
  }
  const actionTypes = new Set(["search", "open_page", "find_in_page"]);
  for (const call of calls) {
    if (call?.status !== "completed") {
      throw new TypeError("founder_beta_web_call_incomplete");
    }
    if (!actionTypes.has(clean(call?.action?.type).toLowerCase())) {
      throw new TypeError("founder_beta_web_action_unsupported");
    }
  }
  const queries = [...new Set(calls.flatMap((item) => (
    traceSearchQueries(item.action)
  )))];
  const rawUrls = [];
  for (const call of calls) {
    for (const source of Array.isArray(call?.action?.sources) ? call.action.sources : []) {
      if (source?.url) rawUrls.push(source.url);
    }
    const actionUrl = traceActionUrl(call.action);
    if (actionUrl) rawUrls.push(actionUrl);
  }
  for (const item of output) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations)
        ? content.annotations : []) {
        if (annotation?.url) rawUrls.push(annotation.url);
      }
    }
  }
  // The complete trace is the authority-membership universe, not the durable
  // evidence packet. Search may return many safe candidates that no canonical
  // field uses; they still cross URL safety validation here but must not spend
  // the receipt's bounded evidence budget.
  const returnedUrls = [...new Set(rawUrls.map(sanitizeTraceUrl))].sort();
  const returnedUrlSet = new Set(returnedUrls);
  if (!calls.length && returnedUrls.length) {
    throw new TypeError("founder_beta_web_sources_without_call");
  }
  const sourceRows = Array.isArray(fieldSources) ? fieldSources : null;
  const imageCount = Number(originalImageCount);
  if (!sourceRows || !Number.isInteger(imageCount) || imageCount < 1 || imageCount > 2) {
    throw new TypeError("founder_beta_field_sources_invalid");
  }
  const allowedImages = new Set(Array.from(
    { length: imageCount }, (_, index) => `original_image_${index + 1}`
  ));
  const sourceBoundFields = new Set(CANONICAL_FIELD_SOURCE_FIELDS);
  const originalImageRequiredFields = new Set([
    "language", "team", "release_variant", "surface_color", "parallel_family",
    "parallel_exact", "descriptive_rarity", "card_number", "serial", "attributes",
    "grading_info", "grammar", "lot_count", "special_stamp", "description"
  ]);
  let parsed;
  try { parsed = JSON.parse(String(rawOutput || "")); }
  catch { throw new TypeError("founder_beta_provider_output_invalid_json"); }
  const payload = structuredClone(parsed);
  const byField = new Map();
  const fieldEvidence = [];
  const withheldIdentityFields = [];
  // `field_sources` is a ledger, so row partitioning is not semantic. Models
  // may split one field across rows or emit an empty placeholder row. Fold all
  // rows for a field into one ordered source union before applying authority;
  // every non-empty claim still crosses the exact same safety gates below.
  const normalizedSourceRows = new Map();
  for (const row of sourceRows) {
    const field = clean(row?.field);
    if (!sourceBoundFields.has(field) || !Array.isArray(row?.source_ids)) {
      throw new TypeError("founder_beta_field_sources_invalid");
    }
    const sourceIds = normalizedSourceRows.get(field) || [];
    for (const sourceId of row.source_ids.map(clean).filter(Boolean)) {
      if (!sourceIds.includes(sourceId)) sourceIds.push(sourceId);
    }
    normalizedSourceRows.set(field, sourceIds);
  }
  for (const [field, sourceIds] of normalizedSourceRows) {
    // An empty union is equivalent to an omitted row. If the field has a value,
    // the existing omission pass below withholds it before SEM/Composer.
    if (!sourceIds.length) continue;
    const imageSourceIds = sourceIds.filter((sourceId) => allowedImages.has(sourceId));
    const nonImageSourceIds = sourceIds.filter((sourceId) => !allowedImages.has(sourceId));
    // Grammar is a structural classification, not a sourced identity fact.
    // An image trace is allowed, but Web output may never author it.
    if (field === "grammar" && nonImageSourceIds.length) {
      throw new TypeError("founder_beta_web_authority_forbidden:grammar");
    }
    const referenceUrls = nonImageSourceIds.map(sanitizeTraceUrl);
    const returnedReferenceUrls = referenceUrls.filter((url) => returnedUrlSet.has(url));
    const returnedWebUrls = [...new Set(returnedReferenceUrls)].sort();
    const unreturnedReferenceCount = referenceUrls.length - returnedReferenceUrls.length;
    if (nonImageSourceIds.length && !calls.length) {
      throw new TypeError("founder_beta_field_source_not_returned");
    }
    if (!WEB_IDENTITY_FIELDS.has(field) && unreturnedReferenceCount) {
      throw new TypeError("founder_beta_field_source_not_returned");
    }
    if (originalImageRequiredFields.has(field)
        && !imageSourceIds.length) {
      throw new TypeError(`founder_beta_current_copy_source_required:${field}`);
    }
    if (WEB_IDENTITY_FIELDS.has(field)) {
      const governedUrls = returnedWebUrls.filter(governedIdentityAuthorityUrl);
      const unresolvedUrls = returnedWebUrls.filter((url) => !governedUrls.includes(url));
      const admitted = imageSourceIds.length > 0
        || governedUrls.length > 0;
      if (!admitted) {
        // A search result can still be useful to the writer without becoming a
        // canonical title fact. Withhold every unsupported field independently;
        // the URL remains in the durable receipt as unresolved evidence.
        payload[field] = Array.isArray(payload[field]) ? [] : "";
        withheldIdentityFields.push(field);
      }
      if (returnedWebUrls.length || (!admitted && unreturnedReferenceCount)) {
        fieldEvidence.push({
          field,
          support_urls: admitted ? governedUrls : [],
          conflict_urls: [],
          unresolved_urls: unresolvedUrls
        });
      }
    } else if (returnedWebUrls.length) {
      fieldEvidence.push({
        field,
        support_urls: [],
        conflict_urls: [],
        unresolved_urls: returnedWebUrls
      });
    }
    byField.set(field, sourceIds);
  }
  const hasValue = (field) => {
    const value = parsed?.[field];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") {
      return Object.values(value).some((entry) => clean(entry));
    }
    return Boolean(clean(value));
  };
  const unreadableFieldNames = new Set(CANONICAL_FIELD_NAMES);
  for (const field of sourceBoundFields) {
    if (field !== "grammar" && hasValue(field) && !byField.has(field)) {
      // An omitted ledger row makes the value unsupported, not malicious. Do
      // not turn a model-side omission into a 502 and do not let the unsupported
      // value reach SEM or the Composer. The existing unreadable channel is the
      // durable CSM vocabulary for "a value appeared to exist, but there was
      // insufficient evidence to admit it"; lot_count has its own durable
      // unresolved terminal and grammar is derived above this source contract.
      payload[field] = Array.isArray(parsed[field])
        ? []
        : parsed[field] && typeof parsed[field] === "object" ? null : "";
      if (unreadableFieldNames.has(field)) {
        payload.unreadable = [...new Set([
          ...(Array.isArray(payload.unreadable) ? payload.unreadable : []),
          field
        ])];
        if (Array.isArray(payload.low_confidence)) {
          payload.low_confidence = payload.low_confidence.filter((name) => clean(name) !== field);
        }
      }
    }
  }
  const providerModel = clean(body?.model);
  const providerEffort = clean(body?.reasoning?.effort).toLowerCase();
  if (providerModel !== clean(request?.model) || providerEffort !== "low"
      || providerEffort !== clean(request?.reasoning?.effort).toLowerCase()) {
    throw new TypeError("founder_beta_provider_execution_mismatch");
  }
  fieldEvidence.sort((a, b) => a.field.localeCompare(b.field));
  const usedEvidenceUrls = [...new Set(fieldEvidence.flatMap((row) => [
    ...row.support_urls, ...row.conflict_urls, ...row.unresolved_urls
  ]))].sort();
  if (usedEvidenceUrls.length > 20) {
    throw new TypeError("founder_beta_web_source_budget_exceeded");
  }
  const webSearchUsed = calls.length > 0;
  const outcome = !webSearchUsed
    ? FOUNDER_BETA_WEB_RECEIPT_OUTCOME.NOT_USED
    : fieldEvidence.length > 0
      ? FOUNDER_BETA_WEB_RECEIPT_OUTCOME.USED_WITH_FIELD_EVIDENCE
      : FOUNDER_BETA_WEB_RECEIPT_OUTCOME.USED_WITHOUT_FIELD_EVIDENCE;
  const receipt = {
    schema_version: FOUNDER_BETA_WEB_RECEIPT_VERSION,
    outcome,
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: providerModel,
    reasoning_effort: providerEffort,
    web_search_used: webSearchUsed,
    web_search_call_count: calls.length,
    queries,
    urls: usedEvidenceUrls,
    field_evidence: fieldEvidence,
    semantic_state_sha256: createHash("sha256")
      .update(String(rawOutput || ""))
      .digest("hex")
  };
  validateFounderBetaWebReceiptAgainstFields(receipt, payload);
  return Object.freeze({
    payload: Object.freeze(payload),
    receipt: Object.freeze(receipt),
    withheld_identity_fields: Object.freeze(withheldIdentityFields.sort())
  });
}

/**
 * Audit Web identity authority before canonical parsing or relation receipts.
 * Unsupported search-only identity remains review evidence but cannot enter a
 * title; current-copy fields and malformed source ledgers still fail closed.
 */
export function auditFounderBetaCanonicalPayload(body, options = {}) {
  return founderBetaCanonicalAuthorityAudit(body, options);
}

export function buildFounderBetaWebReceipt(body, options = {}) {
  return founderBetaCanonicalAuthorityAudit(body, options).receipt;
}

// Exact PR243 receipt shape. Read-only and optional: absence means the joint
// request did not use Web Search, while an unknown/tampered receipt fails.
function validateFounderBetaWebReceiptV1(receipt) {
  const keys = [
    "field_evidence", "isolated_model_call_count", "provider_model",
    "provider_request_count", "queries", "reasoning_effort", "schema_version",
    "semantic_state_sha256", "urls", "web_search_call_count", "web_search_used"
  ];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(keys)
      || receipt.schema_version !== FOUNDER_BETA_WEB_RECEIPT_V1_VERSION
      || receipt.provider_request_count !== 1
      || receipt.isolated_model_call_count !== 0
      || receipt.provider_model !== "gpt-5.6-luna"
      || receipt.reasoning_effort !== "low"
      || typeof receipt.web_search_used !== "boolean"
      || !Number.isInteger(receipt.web_search_call_count)
      || receipt.web_search_call_count < 0
      || receipt.web_search_call_count > CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
      || receipt.web_search_used !== (receipt.web_search_call_count > 0)
      || !exactTextList(receipt.queries)
      || !exactTextList(receipt.urls, 20)
      || receipt.queries.some((query) => query.length > 500)
      || receipt.urls.some((url, index) => index > 0 && receipt.urls[index - 1] >= url)
      || !Array.isArray(receipt.field_evidence)
      || receipt.field_evidence.some((row) => {
        const rowKeys = ["conflict_urls", "field", "support_urls", "unresolved_urls"];
        const urls = [
          ...(Array.isArray(row?.support_urls) ? row.support_urls : []),
          ...(Array.isArray(row?.conflict_urls) ? row.conflict_urls : []),
          ...(Array.isArray(row?.unresolved_urls) ? row.unresolved_urls : [])
        ];
        return !row || typeof row !== "object" || Array.isArray(row)
          || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(rowKeys)
          || typeof row.field !== "string" || !row.field || row.field !== row.field.trim()
          || !exactTextList(row.support_urls, 20)
          || !exactTextList(row.conflict_urls, 20)
          || !exactTextList(row.unresolved_urls, 20)
          || [row.support_urls, row.conflict_urls, row.unresolved_urls].some((urls) => (
            urls.some((url, index) => index > 0 && urls[index - 1] >= url)
          ))
          || [...row.support_urls, ...row.conflict_urls, ...row.unresolved_urls]
            .some((url) => !safeUrl(url) || !receipt.urls.includes(url))
          || row.support_urls.some((url) => !governedIdentityAuthorityUrl(url))
          || (urls.length === 0 && (
            !receipt.web_search_used || !WEB_IDENTITY_FIELDS.has(row.field)
          ));
      })
      || receipt.field_evidence.some((row, index) => index > 0
        && receipt.field_evidence[index - 1].field >= row.field)
      || (!receipt.web_search_used && (
        receipt.queries.length || receipt.urls.length || receipt.field_evidence.length
      ))
      || (receipt.web_search_used && receipt.queries.length === 0
        && receipt.field_evidence.length === 0)
      || receipt.field_evidence.some((row) => {
        const all = [...row.support_urls, ...row.conflict_urls, ...row.unresolved_urls];
        return new Set(all).size !== all.length;
      })
      || receipt.urls.some((url) => !safeUrl(url))
      || !/^[0-9a-f]{64}$/.test(String(receipt.semantic_state_sha256 || ""))) {
    throw new TypeError("founder_beta_web_receipt_invalid");
  }
  return receipt;
}

function validateFounderBetaWebReceiptV2(receipt) {
  const keys = [
    "field_evidence", "isolated_model_call_count", "outcome", "provider_model",
    "provider_request_count", "queries", "reasoning_effort", "schema_version",
    "semantic_state_sha256", "urls", "web_search_call_count", "web_search_used"
  ];
  const evidenceUrls = Array.isArray(receipt?.field_evidence)
    ? [...new Set(receipt.field_evidence.flatMap((row) => [
      ...(Array.isArray(row?.support_urls) ? row.support_urls : []),
      ...(Array.isArray(row?.conflict_urls) ? row.conflict_urls : []),
      ...(Array.isArray(row?.unresolved_urls) ? row.unresolved_urls : [])
    ]))].sort()
    : [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(keys)
      || receipt.schema_version !== FOUNDER_BETA_WEB_RECEIPT_VERSION
      || !Object.values(FOUNDER_BETA_WEB_RECEIPT_OUTCOME).includes(receipt.outcome)
      || receipt.provider_request_count !== 1
      || receipt.isolated_model_call_count !== 0
      || receipt.provider_model !== "gpt-5.6-luna"
      || receipt.reasoning_effort !== "low"
      || typeof receipt.web_search_used !== "boolean"
      || !Number.isInteger(receipt.web_search_call_count)
      || receipt.web_search_call_count < 0
      || receipt.web_search_call_count > CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
      || receipt.web_search_used !== (receipt.web_search_call_count > 0)
      || !exactTextList(receipt.queries)
      || !exactTextList(receipt.urls, 20)
      || JSON.stringify(receipt.urls) !== JSON.stringify(evidenceUrls)
      || receipt.queries.some((query) => query.length > 500)
      || receipt.urls.some((url, index) => index > 0 && receipt.urls[index - 1] >= url)
      || !Array.isArray(receipt.field_evidence)
      || receipt.field_evidence.some((row) => {
        const rowKeys = ["conflict_urls", "field", "support_urls", "unresolved_urls"];
        const urls = [
          ...(Array.isArray(row?.support_urls) ? row.support_urls : []),
          ...(Array.isArray(row?.conflict_urls) ? row.conflict_urls : []),
          ...(Array.isArray(row?.unresolved_urls) ? row.unresolved_urls : [])
        ];
        return !row || typeof row !== "object" || Array.isArray(row)
          || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(rowKeys)
          || typeof row.field !== "string" || !row.field || row.field !== row.field.trim()
          || !CANONICAL_FIELD_SOURCE_FIELDS.includes(row.field)
          || !exactTextList(row.support_urls, 20)
          || !exactTextList(row.conflict_urls, 20)
          || !exactTextList(row.unresolved_urls, 20)
          || [row.support_urls, row.conflict_urls, row.unresolved_urls].some((urls) => (
            urls.some((url, index) => index > 0 && urls[index - 1] >= url)
          ))
          || [...row.support_urls, ...row.conflict_urls, ...row.unresolved_urls]
            .some((url) => !safeUrl(url) || !receipt.urls.includes(url))
          || row.support_urls.some((url) => !governedIdentityAuthorityUrl(url))
          || (!WEB_IDENTITY_FIELDS.has(row.field) && (
            row.support_urls.length > 0 || row.conflict_urls.length > 0
            || (row.field === "grammar" && row.unresolved_urls.length > 0)
          ))
          || (urls.length === 0 && (
            !receipt.web_search_used || !WEB_IDENTITY_FIELDS.has(row.field)
          ));
      })
      || receipt.field_evidence.some((row, index) => index > 0
        && receipt.field_evidence[index - 1].field >= row.field)
      || (!receipt.web_search_used && (
        receipt.queries.length || receipt.urls.length || receipt.field_evidence.length
      ))
      || (receipt.outcome === FOUNDER_BETA_WEB_RECEIPT_OUTCOME.NOT_USED
        && receipt.web_search_used)
      || (receipt.outcome === FOUNDER_BETA_WEB_RECEIPT_OUTCOME.USED_WITH_FIELD_EVIDENCE
        && (!receipt.web_search_used || receipt.field_evidence.length === 0))
      || (receipt.outcome === FOUNDER_BETA_WEB_RECEIPT_OUTCOME.USED_WITHOUT_FIELD_EVIDENCE
        && (!receipt.web_search_used || receipt.urls.length > 0
          || receipt.field_evidence.length > 0))
      || (receipt.web_search_used
        && receipt.outcome === FOUNDER_BETA_WEB_RECEIPT_OUTCOME.NOT_USED)
      || (!receipt.web_search_used
        && receipt.outcome !== FOUNDER_BETA_WEB_RECEIPT_OUTCOME.NOT_USED)
      || receipt.field_evidence.some((row) => {
        const all = [...row.support_urls, ...row.conflict_urls, ...row.unresolved_urls];
        return new Set(all).size !== all.length;
      })
      || receipt.urls.some((url) => !safeUrl(url))
      || !/^[0-9a-f]{64}$/.test(String(receipt.semantic_state_sha256 || ""))) {
    throw new TypeError("founder_beta_web_receipt_invalid");
  }
  return receipt;
}

export function validateFounderBetaWebReceipt(receipt) {
  if (receipt?.schema_version === FOUNDER_BETA_WEB_RECEIPT_V1_VERSION) {
    return validateFounderBetaWebReceiptV1(receipt);
  }
  return validateFounderBetaWebReceiptV2(receipt);
}

export function validateFounderBetaWebReceiptAgainstFields(receipt, fields) {
  validateFounderBetaWebReceipt(receipt);
  for (const row of receipt.field_evidence.filter((entry) => (
    WEB_IDENTITY_FIELDS.has(entry.field)
    && entry.support_urls.length === 0
    && entry.conflict_urls.length === 0
    && entry.unresolved_urls.length === 0
  ))) {
    const value = fields?.[row.field];
    const present = Array.isArray(value) ? value.length > 0
      : value && typeof value === "object" ? Object.values(value).some((entry) => clean(entry))
        : Boolean(clean(value));
    if (present) throw new TypeError("founder_beta_withheld_identity_state_invalid");
  }
  return receipt;
}

function canonicalIdentityFieldsFromSem(sem) {
  return Object.freeze({
    year: sem?.year || "",
    manufacturer: sem?.manufacturer || "",
    product: sem?.product || "",
    set: sem?.set || "",
    subjects: Array.isArray(sem?.subject) ? sem.subject : [],
    card_name: sem?.card_name || ""
  });
}

const EXTERNAL_IDENTITY_FIELDS = Object.freeze([
  "year", "manufacturer", "product", "set", "subjects", "team", "card_number"
]);

const identityBracket = (field) => ({
  subjects: "subject",
  team: "search_optimization"
})[field] || field;

const valuePresent = (value) => Array.isArray(value)
  ? value.length > 0
  : value !== undefined && value !== null && String(value).trim() !== "";

function visualIdentityValue(field, value, components = []) {
  if (field !== "team") return value;
  if (!Array.isArray(value)) return null;
  const remaining = [...value];
  for (const component of components.filter((entry) => (
    ["RC", "Auto", "Patch", "Relic"].includes(entry)
  ))) {
    const index = remaining.indexOf(component);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining.length === 0 ? "" : remaining.length === 1 ? remaining[0] : null;
}

function exactObservedIdentity(rows, expected, fields = WEB_IDENTITY_FIELDS) {
  const sessionId = String(rows?.output?.recognition_session_id || "");
  const components = Array.isArray(rows?.output?.structured_output?.components)
    ? rows.output.structured_output.components : [];
  const observed = {};
  for (const field of fields) {
    const bracket = identityBracket(field);
    const matching = (Array.isArray(rows?.evidence) ? rows.evidence : []).filter(
      (entry) => entry?.modality === "WHOLE_CARD_VISUAL" && entry?.bracket === bracket
    );
    const expectedValue = expected?.[field] ?? (field === "subjects" ? [] : "");
    const expectedCount = field === "team"
      ? (components.length || valuePresent(expectedValue) ? 1 : 0)
      : (valuePresent(expectedValue) ? 1 : 0);
    if (matching.length !== expectedCount) {
      throw new TypeError("founder_beta_observed_identity_cardinality_invalid");
    }
    if (matching.length === 0) {
      observed[field] = expectedValue;
      continue;
    }
    const row = matching[0];
    const lowConfidence = row.normalization_reason_code === "LOW_CONFIDENCE_OBSERVATION";
    const direct = row.normalization_reason_code === "DIRECT_OBSERVATION";
    const rawValue = visualIdentityValue(field, row.raw_value, components);
    const normalizedValue = visualIdentityValue(field, row.normalized_value, components);
    if (rawValue == null
        || !sameValue(rawValue, expectedValue)
        || !sameValue(normalizedValue, expectedValue)
        || !sameValue(row.raw_value, row.normalized_value)
        || row.normalization_version !== SEM_STANDARD_VERSION
        || row.normalization_outcome !== "KEPT"
        || (!direct && !lowConfidence)
        || row.observation_confidence !== (lowConfidence ? 0.5 : 0.8)
        || !row.source_ref || typeof row.source_ref !== "object"
        || Array.isArray(row.source_ref)
        || !sameValue(Object.keys(row.source_ref).sort(), ["images"])
        || row.source_ref.images !== sessionId) {
      throw new TypeError("founder_beta_observed_identity_evidence_invalid");
    }
    observed[field] = rawValue;
  }
  return Object.freeze(observed);
}

function exactResolvedIdentity(rows, expected, fields = WEB_IDENTITY_FIELDS) {
  const components = Array.isArray(rows?.output?.structured_output?.components)
    ? rows.output.structured_output.components : [];
  const resolved = {};
  for (const field of fields) {
    const matching = (Array.isArray(rows?.resolved) ? rows.resolved : [])
      .filter((entry) => entry?.bracket === identityBracket(field));
    if (matching.length !== 1) {
      throw new TypeError("post_observation_resolved_identity_cardinality_invalid");
    }
    const row = matching[0];
    const expectedValue = expected?.[field] ?? (field === "subjects" ? [] : "");
    const actual = row.selected_kind === "EMPTY"
      ? (field === "subjects" ? [] : "")
      : visualIdentityValue(field, row.canonical_value, components);
    if (actual == null
        || !sameValue(actual, expectedValue)
        || row.selected_kind !== (valuePresent(expectedValue) || (field === "team" && components.length)
          ? "VALUE" : "EMPTY")
        || (row.selected_kind === "EMPTY" && row.canonical_value !== null)) {
      throw new TypeError("post_observation_resolved_identity_invalid");
    }
    resolved[field] = actual;
  }
  return Object.freeze(resolved);
}

function validateExternalAppliedTransition(rows, metadata, observedIdentity) {
  const release = externalIdentityReplayReleaseForReceipt(metadata);
  if (!release || !validateExternalIdentityFieldDecisions(metadata)) {
    throw new TypeError("external_identity_receipt_invalid");
  }
  const optionalKeys = metadata.original_set_sha256 == null ? [] : ["original_set_sha256"];
  const expectedKeys = [
    ...Object.keys(release.receipt), "record_id", "match_mode", "field_decisions", ...optionalKeys
  ].sort();
  if (!sameValue(Object.keys(metadata).sort(), expectedKeys)
      || Object.entries(release.receipt).some(([field, value]) => metadata[field] !== value)
      || Object.entries(release.output).some(([field, value]) => rows?.output?.[field] !== value)
      || Object.entries(release.resolution).some(
        ([field, value]) => rows?.resolution?.[field] !== value
      )) {
    throw new TypeError("external_identity_release_binding_invalid");
  }

  const registryEvidence = (rows?.evidence || []).filter((row) => (
    row?.source_ref?.support_type === "EXACT_EXTERNAL_IDENTITY"
  ));
  const sources = new Map();
  for (const field of Object.keys(metadata.field_decisions)) {
    const matching = registryEvidence.filter((row) => row?.source_ref?.field === field);
    if (matching.length !== 1
        || !validateExternalIdentityEvidenceSourceRef(metadata, matching[0]?.source_ref)) {
      throw new TypeError("external_identity_evidence_invalid");
    }
    for (const source of matching[0].source_ref.sources || []) {
      if (source?.source_id) sources.set(source.source_id, source);
    }
  }
  if (registryEvidence.length !== Object.keys(metadata.field_decisions).length) {
    throw new TypeError("external_identity_evidence_cardinality_invalid");
  }
  const privateReceipt = {
    ...metadata,
    status: "APPLIED",
    source_ids: [...sources.keys()].sort(),
    sources: [...sources.values()].sort((left, right) => (
      left.source_id.localeCompare(right.source_id)
    ))
  };
  if (!validateExternalIdentitySourceProvenance(privateReceipt)) {
    throw new TypeError("external_identity_source_provenance_invalid");
  }
  const expectedObserved = { ...observedIdentity };
  for (const [field, decision] of Object.entries(metadata.field_decisions)) {
    expectedObserved[field] = decision.observed_value;
  }
  const observed = exactObservedIdentity(rows, expectedObserved, EXTERNAL_IDENTITY_FIELDS);
  const expectedResolved = Object.fromEntries(Object.entries(metadata.field_decisions)
    .map(([field, decision]) => [field, decision.canonical_value]));
  const resolved = exactResolvedIdentity(rows, expectedResolved, EXTERNAL_IDENTITY_FIELDS);
  if (!validateExternalIdentityDecisionObservation(privateReceipt, observed, resolved)) {
    throw new TypeError("external_identity_transition_invalid");
  }
}

function validateVerifiedAppliedTransition(rows, receipt) {
  if (!validateVerifiedOriginalObservationReceiptShape(receipt)) {
    throw new TypeError("verified_original_receipt_invalid");
  }
  const composer = verifiedOriginalObservationComposerContractForReceipt(receipt);
  if (!composer
      || rows?.resolution?.resolver_version !== VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
      || rows?.resolution?.conflict_policy_version
        !== VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION
      || rows?.resolution?.grammar !== "NON_TCG"
      || rows?.output?.composer_version !== composer.composer_version
      || rows?.output?.marketplace_profile_version !== composer.marketplace_profile_version
      || rows?.output?.structured_output?.composition_grammar !== "standard") {
    throw new TypeError("verified_original_release_binding_invalid");
  }
  const observedProjection = verifiedOriginalObservationReplayProjection(receipt.observed_fields);
  const observedIdentity = exactObservedIdentity(
    rows, canonicalIdentityFieldsFromSem(observedProjection.sem)
  );
  const resolvedProjection = {
    sem: rows.output.structured_output.sem,
    components: [...(rows.output.structured_output.components || [])],
    search_optimization: [...(rows.output.structured_output.search_optimization || [])],
    print_finish_layers: rows.output.structured_output.print_finish_layers,
    grammar: rows.output.structured_output.composition_grammar,
    lot_count: rows.output.structured_output.lot_count || ""
  };
  if (!validateVerifiedOriginalObservationReceipt(receipt, {
    observedFields: receipt.observed_fields,
    resolvedProjection
  })) {
    throw new TypeError("verified_original_transition_invalid");
  }
  exactResolvedIdentity(rows, canonicalIdentityFieldsFromSem(resolvedProjection.sem));
  const supportEvidence = (rows?.evidence || []).filter((row) => (
    row?.source_ref?.support_type === "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"
  ));
  if (supportEvidence.length !== 1
      || supportEvidence[0]?.modality !== "REGISTRY"
      || supportEvidence[0]?.bracket !== VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET
      || !validateVerifiedOriginalObservationSourceRef(
        receipt, supportEvidence[0]?.source_ref, VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET
      )) {
    throw new TypeError("verified_original_evidence_invalid");
  }
  return observedIdentity;
}

/**
 * Validate future durable metadata while projecting only read-only flags.
 *
 * The active v2 writer never imports this function. The bridge is invoked by
 * replay only after a stored output says it is v3; it neither derives nor
 * modifies a title or receipt.
 */
export function readDurableProjectionReceipt(rows) {
  const output = rows?.output;
  const version = String(output?.contract_version || "");
  if (String(rows?.resolution?.contract_version || "") !== version) {
    throw new TypeError("durable_projection_row_family_mismatch");
  }
  for (const collection of [rows?.evidence, rows?.candidates, rows?.resolved]) {
    for (const row of Array.isArray(collection) ? collection : []) {
      if (row?.contract_version != null && row.contract_version !== version) {
        throw new TypeError("durable_projection_row_family_mismatch");
      }
    }
  }
  const profile = String(output?.marketplace_profile_version || "");
  const futureKeys = [
    "publication_coverage", "lot_terminal", "founder_beta_web_receipt",
    "set_card_name_relation_receipt"
  ];
  if (version === CSM_LEGACY_PROJECTION_CONTRACT_VERSION) {
    if (profile === "lynca-standard-name-v0.3") {
      throw new TypeError("canonical_naming_v03_stage_contract_mismatch");
    }
    if (futureKeys.some((key) => output?.structured_output?.[key] != null)) {
      throw new TypeError("durable_projection_receipt_outside_contract");
    }
    return null;
  }
  if (version !== CSM_DURABLE_PROJECTION_CONTRACT_VERSION) {
    throw new TypeError("csm_stage_contract_version_unsupported");
  }
  const grammar = String(output?.structured_output?.composition_grammar || "").trim();
  const publicationCoverage = output?.structured_output?.publication_coverage;
  try { validatePublicationCoverage(publicationCoverage); }
  catch { throw new TypeError("publication_coverage_receipt_invalid"); }

  const lotTerminal = output?.structured_output?.lot_terminal;
  if (grammar === "lot") {
    if (lotTerminal == null) throw new TypeError("lot_terminal_receipt_missing");
    try {
      validateLotTerminalReceipt(lotTerminal, {
        lotCount: output?.structured_output?.lot_count || ""
      });
    } catch {
      throw new TypeError("lot_terminal_receipt_invalid");
    }
  } else if (lotTerminal != null) {
    throw new TypeError("lot_terminal_receipt_outside_lot");
  }
  const webReceipt = output?.structured_output?.founder_beta_web_receipt ?? null;
  if (webReceipt == null) throw new TypeError("founder_beta_web_receipt_missing");
  const externalReceipt = output?.structured_output?.external_identity_support ?? null;
  const verifiedReceipt =
    output?.structured_output?.verified_original_observation_support ?? null;
  const externalApplied = externalReceipt != null;
  const verifiedApplied = verifiedReceipt != null;
  if (externalApplied && verifiedApplied) {
    throw new TypeError("post_observation_resolution_overlap");
  }
  const finalIdentity = canonicalIdentityFieldsFromSem(output?.structured_output?.sem);
  let observedIdentity;
  if (verifiedApplied) {
    observedIdentity = validateVerifiedAppliedTransition(rows, verifiedReceipt);
  } else if (externalApplied) {
    const expected = { ...finalIdentity };
    for (const [field, decision] of Object.entries(externalReceipt?.field_decisions || {})) {
      if (WEB_IDENTITY_FIELDS.has(field)) expected[field] = decision.observed_value;
    }
    observedIdentity = exactObservedIdentity(rows, expected);
    validateExternalAppliedTransition(rows, externalReceipt, observedIdentity);
  } else {
    observedIdentity = exactObservedIdentity(rows, finalIdentity);
    exactResolvedIdentity(rows, finalIdentity);
    if (!sameValue(observedIdentity, finalIdentity)) {
      throw new TypeError("post_observation_resolution_receipt_missing");
    }
  }
  validateFounderBetaWebReceiptAgainstFields(webReceipt, observedIdentity);
  const relationReceipt = output?.structured_output?.set_card_name_relation_receipt ?? null;
  if (relationReceipt == null) {
    throw new TypeError("set_card_name_relation_receipt_missing");
  }
  try {
    validateSetCardNameRelationReceipt(relationReceipt, {
      set: output?.structured_output?.sem?.set || "",
      card_name: output?.structured_output?.sem?.card_name || ""
    });
  } catch {
    throw new TypeError("set_card_name_relation_receipt_invalid");
  }
  return Object.freeze({
    bridge_version: CSM_FORWARD_READER_BRIDGE_VERSION,
    publication_coverage: publicationCoverage,
    lot_terminal: lotTerminal ?? null,
    founder_beta_web_receipt: webReceipt,
    set_card_name_relation_receipt: relationReceipt
  });
}

export function assertDurableProjectionReplayed(receipt, recomposed, {
  normalizedPublicationCoverage = null
} = {}) {
  if (!receipt) return;
  try { validatePublicationCoverage(recomposed.composed?.publication_coverage); }
  catch { throw new TypeError("publication_coverage_recompute_invalid"); }
  if (!sameValue(
    normalizedPublicationCoverage?.stored ?? receipt.publication_coverage,
    normalizedPublicationCoverage?.recomposed ?? recomposed.composed.publication_coverage
  )) {
    throw new TypeError("publication_coverage_replay_mismatch");
  }
  if (receipt.lot_terminal) {
    const replayed = [...new Set(recomposed.composed?.lot_unshared_attributes || [])].sort();
    if (!sameValue(replayed, receipt.lot_terminal.lot_unshared_attributes)
        || recomposed.composed?.lot_quantity_unresolved
          !== receipt.lot_terminal.lot_quantity_unresolved
        || recomposed.composed?.lot_single_card !== receipt.lot_terminal.lot_single_card) {
      throw new TypeError("lot_terminal_replay_mismatch");
    }
  }
}
