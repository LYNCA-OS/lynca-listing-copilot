import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  retrievalProviderIds,
  retrievalSourceTypes,
  retrievalTrustTiers,
  retrievalUnavailable
} from "./retrieval-contract.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function safeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function serialDenominator(value) {
  return cleanText(value).match(/\/\s*(\d{1,4})\b/)?.[1] || cleanText(value).replace(/[^0-9]/g, "");
}

function subjectText(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  if (Array.isArray(normalized.players) && normalized.players.length) return normalized.players.join(" ");
  return normalized.character || "";
}

function providerConfig(env = process.env) {
  return {
    enabled: truthy(env.ENABLE_BASKETBALL_CATALOG_RETRIEVAL ?? env.ENABLE_CATALOG_RETRIEVAL, true),
    url: cleanText(env.SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY),
    timeoutMs: positiveInteger(env.CATALOG_RETRIEVAL_TIMEOUT_MS || env.POSTGRES_HYBRID_RETRIEVAL_TIMEOUT_MS, 12000),
    matchCount: positiveInteger(env.CATALOG_RETRIEVAL_TOP_N || env.ADVANCED_RETRIEVAL_STAGE1_TOP_N, 30)
  };
}

function readBody(fields = {}, query = {}) {
  const normalized = normalizeResolvedFields(fields);
  return {
    search_text: cleanText(query.search_text || query.query || ""),
    exact_checklist_code: cleanText(query.exact_checklist_code || normalized.checklist_code),
    exact_card_number: cleanText(query.exact_card_number || normalized.collector_number),
    exact_subject: cleanText(query.exact_subject || subjectText(normalized)),
    exact_year: cleanText(query.exact_year || normalized.year),
    exact_product: cleanText(query.exact_product || normalized.product || normalized.set),
    exact_serial_denominator: serialDenominator(query.exact_serial_denominator) || serialDenominator(normalized.serial_number),
    match_count: query.match_count || null
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function sourceTypeForRow(row = {}) {
  const status = cleanText(row.retrieval_status).toLowerCase();
  if (status === "reviewed") return retrievalSourceTypes.INTERNAL_APPROVED_HISTORY;
  if (cleanText(row.source_type) === "TOPPS_OFFICIAL_CHECKLIST") return retrievalSourceTypes.OFFICIAL_CHECKLIST;
  return retrievalSourceTypes.STRUCTURED_DATABASE;
}

function trustTierForSourceType(sourceType) {
  if (sourceType === retrievalSourceTypes.INTERNAL_APPROVED_HISTORY) return retrievalTrustTiers.APPROVED_HISTORY;
  if (sourceType === retrievalSourceTypes.OFFICIAL_CHECKLIST) return retrievalTrustTiers.OFFICIAL;
  return retrievalTrustTiers.STRUCTURED;
}

function candidatesFromRows(rows = [], query = {}) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const expectedSerialDenominator = serialDenominator(row.expected_serial_denominator);
    const rawFields = safeJson(row.fields) || {};
    const fields = normalizeResolvedFields({
      ...rawFields,
      serial_number: expectedSerialDenominator ? `/${expectedSerialDenominator}` : rawFields.serial_number
    });
    const sourceType = sourceTypeForRow(row);
    return {
      candidate_id: row.identity_id ? `catalog_${row.identity_id}_${index + 1}` : `catalog_candidate_${index + 1}`,
      candidate_identity_id: row.identity_id || null,
      source_url: row.identity_id ? `supabase://catalog-cards/${row.identity_id}` : "",
      domain: "supabase-catalog",
      source_type: sourceType,
      trust_tier: trustTierForSourceType(sourceType),
      title: cleanText(row.canonical_title),
      evidence_excerpt: [
        "catalog-first identity candidate",
        cleanText(row.identity_key),
        cleanText(row.source_type),
        `score=${Number(row.normalized_score || 0).toFixed(4)}`
      ].filter(Boolean).join(" | "),
      fields,
      matched_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : [],
      supporting_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : [],
      raw_score: Number(row.raw_score || 0),
      normalized_score: Number(row.normalized_score || 0),
      match_score: Number(row.normalized_score || 0),
      channel_id: "catalog_first",
      provider_id: retrievalProviderIds.CATALOG,
      query_family: query.family || "",
      reference_metadata: {
        retrieval_status: row.retrieval_status || "",
        source_type: row.source_type || "",
        source_status: row.source_status || "",
        expected_serial_denominator: expectedSerialDenominator || row.expected_serial_denominator || "",
        provider: retrievalProviderIds.CATALOG
      },
      field_derivation: {
        source: "basketball_catalog_v0",
        corrected_title_used: row.source_type === "INTERNAL_CORRECTED_TITLE",
        corrected_title_used_as_ground_truth: false,
        reviewed_ground_truth_used: false
      }
    };
  });
}

function unavailable(reason) {
  return retrievalUnavailable(retrievalProviderIds.CATALOG, reason);
}

export function catalogProvider({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = providerConfig(env);

  return {
    id: retrievalProviderIds.CATALOG,
    async search({ query = {}, resolved = {} } = {}) {
      if (!config.enabled) return unavailable("catalog_retrieval_disabled");
      if (!config.url || !config.serviceRoleKey) return unavailable("supabase_service_role_not_configured");
      if (typeof fetchImpl !== "function") return unavailable("fetch_unavailable");

      const fields = normalizeResolvedFields(resolved);
      const body = readBody(fields, query);
      if (!body.search_text && !body.exact_checklist_code && !body.exact_card_number && !body.exact_subject && !body.exact_year && !body.exact_product && !body.exact_serial_denominator) {
        return unavailable("catalog_query_missing");
      }

      try {
        const response = await fetchWithTimeout(fetchImpl, `${config.url}/rest/v1/rpc/search_catalog_candidates`, {
          method: "POST",
          headers: {
            apikey: config.serviceRoleKey,
            authorization: `Bearer ${config.serviceRoleKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            ...body,
            match_count: positiveInteger(body.match_count, config.matchCount)
          })
        }, config.timeoutMs);

        const text = await responseText(response);
        if (!response.ok) return unavailable(`supabase_catalog_rpc_${response.status}:${text.slice(0, 80)}`);

        let rows = [];
        try {
          rows = text ? JSON.parse(text) : [];
        } catch {
          return unavailable("supabase_catalog_rpc_invalid_json");
        }

        return {
          provider_id: retrievalProviderIds.CATALOG,
          candidates: candidatesFromRows(rows, query)
        };
      } catch (error) {
        if (error?.name === "AbortError") return unavailable("catalog_retrieval_timeout");
        return unavailable("catalog_retrieval_error");
      }
    }
  };
}
