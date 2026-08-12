import { createHash } from "node:crypto";

import { CANONICAL_FIELD_SOURCE_FIELDS } from "./canonical-fields.mjs";
import { validateLotTerminalReceipt } from "./lot-terminal-contract.mjs";
import { validatePublicationCoverage } from "./publication-coverage.mjs";
import { validateSetCardNameRelationReceipt } from "./set-card-name-contract.mjs";

export const CSM_DURABLE_PROJECTION_CONTRACT_VERSION = "csm-stage-shadow-v3";
export const CSM_LEGACY_PROJECTION_CONTRACT_VERSION = "csm-stage-shadow-v2";
export const CSM_FORWARD_READER_BRIDGE_VERSION = "csm-durable-forward-reader-v1";
export const FOUNDER_BETA_WEB_RECEIPT_VERSION = "founder-beta-web-receipt-v1";

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

function traceQuery(action = {}) {
  const values = [action.query, ...(Array.isArray(action.queries) ? action.queries : [])]
    .map(clean).filter(Boolean);
  if (values.some((value) => value.length > 500)) {
    throw new TypeError("founder_beta_web_query_too_long");
  }
  return values;
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

function governedIdentityAuthorityUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  return [...GOVERNED_IDENTITY_AUTHORITY_HOSTS].some(
    (authority) => host === authority || host.endsWith(`.${authority}`)
  );
}

/**
 * Derive the durable receipt from the provider trace, never from model JSON.
 * One Responses request may choose zero or one built-in Web Search call.
 */
function founderBetaCanonicalAuthorityAudit(body, {
  rawOutput,
  request,
  fieldSources,
  originalImageCount
} = {}) {
  const output = Array.isArray(body?.output) ? body.output : [];
  const calls = output.filter((item) => item?.type === "web_search_call");
  if (calls.length > 1) throw new TypeError("founder_beta_web_call_budget_exceeded");
  const queries = [...new Set(calls.flatMap((item) => traceQuery(item.action)))];
  const rawUrls = [];
  for (const call of calls) {
    for (const source of Array.isArray(call?.action?.sources) ? call.action.sources : []) {
      if (source?.url) rawUrls.push(source.url);
    }
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
  for (const row of sourceRows) {
    const field = clean(row?.field);
    const sourceIds = Array.isArray(row?.source_ids)
      ? [...new Set(row.source_ids.map(clean).filter(Boolean))] : [];
    if (!sourceBoundFields.has(field) || byField.has(field) || !sourceIds.length) {
      throw new TypeError("founder_beta_field_sources_invalid");
    }
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
        support_urls: returnedWebUrls,
        conflict_urls: [],
        unresolved_urls: []
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
  for (const field of sourceBoundFields) {
    if (field !== "grammar" && hasValue(field) && !byField.has(field)) {
      throw new TypeError(`founder_beta_field_source_required:${field}`);
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
  const receipt = {
    schema_version: FOUNDER_BETA_WEB_RECEIPT_VERSION,
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: providerModel,
    reasoning_effort: providerEffort,
    web_search_used: calls.length === 1,
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
export function validateFounderBetaWebReceipt(receipt) {
  const keys = [
    "field_evidence", "isolated_model_call_count", "provider_model",
    "provider_request_count", "queries", "reasoning_effort", "schema_version",
    "semantic_state_sha256", "urls", "web_search_call_count", "web_search_used"
  ];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(keys)
      || receipt.schema_version !== FOUNDER_BETA_WEB_RECEIPT_VERSION
      || receipt.provider_request_count !== 1
      || receipt.isolated_model_call_count !== 0
      || receipt.provider_model !== "gpt-5.6-luna"
      || receipt.reasoning_effort !== "low"
      || typeof receipt.web_search_used !== "boolean"
      || receipt.web_search_call_count !== (receipt.web_search_used ? 1 : 0)
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
          || (urls.length === 0 && (
            !receipt.web_search_used || !WEB_IDENTITY_FIELDS.has(row.field)
          ));
      })
      || receipt.field_evidence.some((row, index) => index > 0
        && receipt.field_evidence[index - 1].field >= row.field)
      || (!receipt.web_search_used && (
        receipt.queries.length || receipt.urls.length || receipt.field_evidence.length
      ))
      || (receipt.web_search_used && receipt.queries.length === 0)
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
    year: sem?.year,
    manufacturer: sem?.manufacturer,
    product: sem?.product,
    set: sem?.set,
    subjects: sem?.subject,
    card_name: sem?.card_name
  });
}

function validateWithheldIdentityRowsAgainstResolvedRows(receipt, rows) {
  const bracketForField = (field) => field === "subjects" ? "subject" : field;
  for (const marker of receipt.field_evidence.filter((entry) => (
    WEB_IDENTITY_FIELDS.has(entry.field)
    && entry.support_urls.length === 0
    && entry.conflict_urls.length === 0
    && entry.unresolved_urls.length === 0
  ))) {
    const matchingRows = (Array.isArray(rows?.resolved) ? rows.resolved : [])
      .filter((entry) => entry?.bracket === bracketForField(marker.field));
    if (matchingRows.length !== 1
        || matchingRows[0].selected_kind !== "EMPTY"
        || matchingRows[0].canonical_value != null) {
      throw new TypeError("founder_beta_withheld_identity_state_invalid");
    }
  }
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
  validateFounderBetaWebReceiptAgainstFields(
    webReceipt,
    canonicalIdentityFieldsFromSem(output?.structured_output?.sem)
  );
  validateWithheldIdentityRowsAgainstResolvedRows(webReceipt, rows);
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
