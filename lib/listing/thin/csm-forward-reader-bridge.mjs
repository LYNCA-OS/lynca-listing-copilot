import { validateLotTerminalReceipt } from "./lot-terminal-contract.mjs";
import { validatePublicationCoverage } from "./publication-coverage.mjs";

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
    "publication_coverage", "lot_terminal", "founder_beta_web_receipt"
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
  if (webReceipt != null) validateFounderBetaWebReceipt(webReceipt);
  return Object.freeze({
    bridge_version: CSM_FORWARD_READER_BRIDGE_VERSION,
    publication_coverage: publicationCoverage,
    lot_terminal: lotTerminal ?? null,
    founder_beta_web_receipt: webReceipt
  });
}

export function assertDurableProjectionReplayed(receipt, recomposed) {
  if (!receipt) return;
  try { validatePublicationCoverage(recomposed.composed?.publication_coverage); }
  catch { throw new TypeError("publication_coverage_recompute_invalid"); }
  if (!sameValue(
    receipt.publication_coverage,
    recomposed.composed.publication_coverage
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
