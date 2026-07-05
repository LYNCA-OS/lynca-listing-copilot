import { retrievalProviderIds } from "./retrieval-contract.mjs";

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function boundedLimit(value) {
  return Math.max(1, Math.min(20, positiveNumber(value, 10)));
}

function envFlag(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(value).trim().toLowerCase());
}

function createBraveError(message, code, status = null) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function braveErrorCode(status) {
  if (status === 408) return "brave_timeout";
  if (status === 429) return "brave_rate_limited";
  if (status === 401 || status === 403) return "brave_unauthorized";
  if (status >= 500) return "brave_server_error";
  return "brave_search_error";
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 8000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller ? controller.signal : options.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createBraveError("Brave Search request timed out", "brave_timeout");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function braveFetchWithRetry({
  fetchImpl,
  url,
  options,
  timeoutMs,
  maxRetries,
  retryBaseMs
}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchWithTimeout(fetchImpl, url, options, timeoutMs);
    if (response.ok || !retryableStatus(response.status) || attempt === maxRetries) {
      return response;
    }
    await wait(retryBaseMs * (2 ** attempt));
  }

  throw createBraveError("Brave Search retry loop exhausted", "brave_search_error");
}

function evidenceExcerpt(item = {}, includeExtraSnippets = true) {
  return [
    item.description,
    includeExtraSnippets && Array.isArray(item.extra_snippets) ? item.extra_snippets.join(" ") : ""
  ].filter(Boolean).join(" ");
}

function moreResultsAvailable(payload = {}, {
  offset = 0,
  limit = 10,
  resultCount = 0
} = {}) {
  if (typeof payload.web?.more_results_available === "boolean") return payload.web.more_results_available;
  const total = Number(payload.web?.total || payload.query?.total_results || 0);
  if (Number.isFinite(total) && total > 0) return total > offset + resultCount;
  return resultCount >= limit;
}

export function braveSearchProvider({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const configured = Boolean(env.BRAVE_SEARCH_API_KEY);
  const baseUrl = String(env.BRAVE_SEARCH_BASE_URL || "https://api.search.brave.com/res/v1").replace(/\/+$/, "");
  const endpoint = env.BRAVE_SEARCH_ENDPOINT || "/web/search";
  const maxResults = boundedLimit(env.BRAVE_SEARCH_MAX_RESULTS);
  const timeoutMs = positiveNumber(env.BRAVE_SEARCH_TIMEOUT_MS, 8000);
  const maxRetries = Math.min(3, nonNegativeInteger(env.BRAVE_SEARCH_MAX_RETRIES, 0));
  const retryBaseMs = positiveNumber(env.BRAVE_SEARCH_RETRY_BASE_MS, 250);
  const includeExtraSnippets = envFlag(env.BRAVE_SEARCH_EXTRA_SNIPPETS, true);

  return {
    id: retrievalProviderIds.BRAVE_SEARCH,
    configured,
    enabled: true,
    async search({ query }) {
      if (!configured) {
        return {
          provider_id: retrievalProviderIds.BRAVE_SEARCH,
          unavailable: true,
          reason: "BRAVE_SEARCH_API_KEY is not configured",
          candidates: []
        };
      }

      if (!fetchImpl) {
        return {
          provider_id: retrievalProviderIds.BRAVE_SEARCH,
          unavailable: true,
          reason: "fetch is unavailable",
          candidates: []
        };
      }

      const offset = nonNegativeInteger(query.offset, 0);
      const freshness = query.freshness || env.BRAVE_SEARCH_FRESHNESS || "";
      const url = new URL(`${baseUrl}${endpoint}`);
      url.searchParams.set("q", query.query);
      url.searchParams.set("count", String(maxResults));
      if (offset) url.searchParams.set("offset", String(offset));
      if (freshness) url.searchParams.set("freshness", String(freshness));
      if (includeExtraSnippets) url.searchParams.set("extra_snippets", "true");
      if (env.BRAVE_SEARCH_COUNTRY) url.searchParams.set("country", env.BRAVE_SEARCH_COUNTRY);
      if (env.BRAVE_SEARCH_LANG) url.searchParams.set("search_lang", env.BRAVE_SEARCH_LANG);

      const response = await braveFetchWithRetry({
        fetchImpl,
        url,
        timeoutMs,
        maxRetries,
        retryBaseMs,
        options: {
        headers: {
          accept: "application/json",
          "x-subscription-token": env.BRAVE_SEARCH_API_KEY
        }
        }
      });

      if (!response.ok) {
        throw createBraveError(`Brave Search failed: ${response.status}`, braveErrorCode(response.status), response.status);
      }

      const payload = await response.json();
      const results = payload.web?.results || [];
      return {
        provider_id: retrievalProviderIds.BRAVE_SEARCH,
        unavailable: false,
        more_results_available: moreResultsAvailable(payload, {
          offset,
          limit: maxResults,
          resultCount: results.length
        }),
        offset,
        count: maxResults,
        candidates: results.map((item) => ({
          source_url: item.url,
          title: item.title,
          evidence_excerpt: evidenceExcerpt(item, includeExtraSnippets),
          source_type: "OPEN_WEB"
        }))
      };
    }
  };
}
