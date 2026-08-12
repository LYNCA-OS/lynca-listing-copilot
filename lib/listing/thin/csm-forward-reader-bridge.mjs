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
export function buildFounderBetaWebReceipt(body, {
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
  if (rawUrls.length > 20) throw new TypeError("founder_beta_web_source_budget_exceeded");
  const urls = [...new Set(rawUrls.map(sanitizeTraceUrl))].sort();
  if (!calls.length && urls.length) {
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
  const webIdentityFields = new Set([
    "year", "manufacturer", "product", "set", "subjects", "card_name"
  ]);
  const byField = new Map();
  for (const row of sourceRows) {
    const field = clean(row?.field);
    const sourceIds = Array.isArray(row?.source_ids)
      ? [...new Set(row.source_ids.map(clean).filter(Boolean))] : [];
    if (!sourceBoundFields.has(field) || byField.has(field) || !sourceIds.length) {
      throw new TypeError("founder_beta_field_sources_invalid");
    }
    if (sourceIds.some((sourceId) => (
      !allowedImages.has(sourceId) && !urls.includes(sanitizeTraceUrl(sourceId))
    ))) {
      throw new TypeError("founder_beta_field_source_not_returned");
    }
    if (originalImageRequiredFields.has(field)
        && !sourceIds.some((sourceId) => allowedImages.has(sourceId))) {
      throw new TypeError(`founder_beta_current_copy_source_required:${field}`);
    }
    if (webIdentityFields.has(field)
        && !sourceIds.some((sourceId) => allowedImages.has(sourceId))
        && !sourceIds.some((sourceId) => governedIdentityAuthorityUrl(
          sanitizeTraceUrl(sourceId)
        ))) {
      throw new TypeError(`founder_beta_identity_authority_required:${field}`);
    }
    byField.set(field, sourceIds);
  }
  let parsed;
  try { parsed = JSON.parse(String(rawOutput || "")); }
  catch { throw new TypeError("founder_beta_provider_output_invalid_json"); }
  const hasValue = (field) => {
    const value = parsed?.[field];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") {
      return Object.values(value).some((entry) => clean(entry));
    }
    return Boolean(clean(value));
  };
  for (const field of sourceBoundFields) {
    if (hasValue(field) && !byField.has(field)) {
      throw new TypeError(`founder_beta_field_source_required:${field}`);
    }
  }
  const providerModel = clean(body?.model);
  const providerEffort = clean(body?.reasoning?.effort).toLowerCase();
  if (providerModel !== clean(request?.model) || providerEffort !== "low"
      || providerEffort !== clean(request?.reasoning?.effort).toLowerCase()) {
    throw new TypeError("founder_beta_provider_execution_mismatch");
  }
  const fieldEvidence = [...byField.entries()].map(([field, sourceIds]) => ({
    field,
    support_urls: sourceIds.filter((sourceId) => !allowedImages.has(sourceId))
      .map(sanitizeTraceUrl).sort(),
    conflict_urls: [],
    unresolved_urls: []
  })).filter((row) => row.support_urls.length).sort((a, b) => a.field.localeCompare(b.field));
  const receipt = {
    schema_version: FOUNDER_BETA_WEB_RECEIPT_VERSION,
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: providerModel,
    reasoning_effort: providerEffort,
    web_search_used: calls.length === 1,
    web_search_call_count: calls.length,
    queries,
    urls,
    field_evidence: fieldEvidence,
    semantic_state_sha256: createHash("sha256")
      .update(String(rawOutput || ""))
      .digest("hex")
  };
  validateFounderBetaWebReceipt(receipt);
  return Object.freeze(receipt);
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
            .some((url) => !safeUrl(url) || !receipt.urls.includes(url));
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
  validateFounderBetaWebReceipt(webReceipt);
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
