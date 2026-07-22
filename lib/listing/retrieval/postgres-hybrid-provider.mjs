import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { foldLatinDiacritics } from "../pipeline/subject-identity.mjs";
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

function providerConfig(env = process.env) {
  return {
    enabled: truthy(env.ENABLE_ADVANCED_RETRIEVAL, false) || truthy(env.ENABLE_HYBRID_RETRIEVAL, false) || truthy(env.ENABLE_POSTGRES_HYBRID_RETRIEVAL, false),
    url: cleanText(env.SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY),
    timeoutMs: positiveInteger(env.POSTGRES_HYBRID_RETRIEVAL_TIMEOUT_MS || env.VECTOR_QUERY_TIMEOUT_MS, 30000),
    matchCount: positiveInteger(env.ADVANCED_RETRIEVAL_STAGE1_TOP_N || env.POSTGRES_HYBRID_RETRIEVAL_TOP_N, 30)
  };
}

function subjectText(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  if (Array.isArray(normalized.players) && normalized.players.length) return normalized.players.join(" ");
  return normalized.player || normalized.character || "";
}

function productText(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  return [
    normalized.year,
    normalized.brand || normalized.manufacturer,
    normalized.product || normalized.set
  ].filter(Boolean).join(" ");
}

function readBody(fields = {}, query = {}) {
  const ignoreObservedYear = query.ignore_observed_year === true;
  const ignoreObservedProduct = query.ignore_observed_product === true;
  return {
    search_text: foldLatinDiacritics(query.search_text || query.query || [subjectText(fields), productText(fields)].filter(Boolean).join(" ")),
    exact_checklist_code: cleanText(query.exact_checklist_code || fields.checklist_code),
    exact_collector_number: cleanText(query.exact_collector_number || fields.collector_number),
    exact_subject: foldLatinDiacritics(query.exact_subject || subjectText(fields)),
    exact_year: cleanText(query.exact_year || (ignoreObservedYear ? "" : fields.year)),
    exact_product: cleanText(query.exact_product || (ignoreObservedProduct ? "" : fields.product || fields.set)),
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
  if (status === "approved" || status === "reviewed") return retrievalSourceTypes.INTERNAL_APPROVED_HISTORY;
  if (status === "registry") return retrievalSourceTypes.STRUCTURED_DATABASE;
  return retrievalSourceTypes.STRUCTURED_DATABASE;
}

function trustTierForSourceType(sourceType) {
  if (sourceType === retrievalSourceTypes.INTERNAL_APPROVED_HISTORY) return retrievalTrustTiers.APPROVED_HISTORY;
  if (sourceType === retrievalSourceTypes.STRUCTURED_DATABASE) return retrievalTrustTiers.STRUCTURED;
  return retrievalTrustTiers.OPEN_WEB;
}

function candidatesFromRows(rows = [], query = {}) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const fields = normalizeResolvedFields(safeJson(row.fields) || {});
    const sourceType = sourceTypeForRow(row);
    return {
      candidate_id: row.identity_id ? `postgres_hybrid_${row.identity_id}_${index + 1}` : `postgres_hybrid_candidate_${index + 1}`,
      candidate_identity_id: row.identity_id || null,
      source_url: row.identity_id ? `supabase://card-identities/${row.identity_id}` : "",
      domain: "supabase-postgres",
      source_type: sourceType,
      trust_tier: trustTierForSourceType(sourceType),
      title: cleanText(row.canonical_title),
      evidence_excerpt: [
        "postgres hybrid recall",
        cleanText(row.identity_key),
        `score=${Number(row.normalized_score || 0).toFixed(4)}`
      ].filter(Boolean).join(" | "),
      fields,
      matched_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : [],
      supporting_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : [],
      raw_score: Number(row.raw_score || 0),
      normalized_score: Number(row.normalized_score || 0),
      match_score: Number(row.normalized_score || 0),
      channel_id: row.channel_id || "",
      provider_id: retrievalProviderIds.POSTGRES_HYBRID,
      query_family: query.family || "",
      reference_metadata: {
        retrieval_status: row.retrieval_status || "",
        category: row.category || "",
        provider: retrievalProviderIds.POSTGRES_HYBRID
      },
      field_derivation: {
        source: "card_identities_fields_text_trigram",
        corrected_title_used: false,
        ground_truth_used: false
      }
    };
  });
}

function unavailable(reason) {
  return retrievalUnavailable(retrievalProviderIds.POSTGRES_HYBRID, reason);
}

export function postgresHybridProvider({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = providerConfig(env);

  return {
    id: retrievalProviderIds.POSTGRES_HYBRID,
    async search({ query = {}, resolved = {} } = {}) {
      if (!config.enabled) return unavailable("postgres_hybrid_retrieval_disabled");
      if (!config.url || !config.serviceRoleKey) return unavailable("supabase_service_role_not_configured");
      if (typeof fetchImpl !== "function") return unavailable("fetch_unavailable");

      const fields = normalizeResolvedFields(resolved);
      const body = readBody(fields, query);
      if (!body.search_text && !body.exact_checklist_code && !body.exact_collector_number && !body.exact_subject) {
        return unavailable("postgres_hybrid_query_missing");
      }

      const endpoint = `${config.url}/rest/v1/rpc/search_card_identities_hybrid`;

      try {
        const response = await fetchWithTimeout(fetchImpl, endpoint, {
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
        if (!response.ok) {
          return unavailable(`supabase_postgres_hybrid_rpc_${response.status}:${text.slice(0, 80)}`);
        }

        let rows = [];
        try {
          rows = text ? JSON.parse(text) : [];
        } catch {
          return unavailable("supabase_postgres_hybrid_rpc_invalid_json");
        }

        return {
          provider_id: retrievalProviderIds.POSTGRES_HYBRID,
          candidates: candidatesFromRows(rows, query)
        };
      } catch (error) {
        if (error?.name === "AbortError") return unavailable("postgres_hybrid_retrieval_timeout");
        return unavailable("postgres_hybrid_retrieval_error");
      }
    }
  };
}
