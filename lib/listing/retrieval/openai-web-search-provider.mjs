import { openAiWebSearchModelConfig, retrievalProviderIds } from "./retrieval-contract.mjs";

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function boundedLimit(value) {
  return Math.max(1, Math.min(20, positiveNumber(value, 5)));
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function envList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function responsesEndpoint(env) {
  const baseUrl = String(env.OPENAI_WEB_SEARCH_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${baseUrl}/responses`;
}

function createOpenAiWebSearchError(message, code, status = null) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function openAiWebSearchErrorCode(status) {
  if (status === 408) return "openai_web_search_timeout";
  if (status === 429) return "openai_web_search_rate_limited";
  if (status === 401 || status === 403) return "openai_web_search_unauthorized";
  if (status >= 500) return "openai_web_search_server_error";
  return "openai_web_search_error";
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
      throw createOpenAiWebSearchError("OpenAI Web Search request timed out", "openai_web_search_timeout");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function openAiWebSearchFetchWithRetry({
  fetchImpl,
  url,
  options,
  timeoutMs,
  maxRetries,
  retryBaseMs
}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, options, timeoutMs);
      if (response.ok || !retryableStatus(response.status) || attempt === maxRetries) {
        return response;
      }
    } catch (error) {
      if (error?.code !== "openai_web_search_timeout" || attempt === maxRetries) {
        throw error;
      }
    }
    await wait(retryBaseMs * (2 ** attempt));
  }

  throw createOpenAiWebSearchError("OpenAI Web Search retry loop exhausted", "openai_web_search_retry_error");
}

function buildSearchTool(env = {}) {
  const tool = {
    type: "web_search"
  };
  const allowedDomains = envList(env.OPENAI_WEB_SEARCH_ALLOWED_DOMAINS);
  if (allowedDomains.length) {
    tool.filters = {
      allowed_domains: allowedDomains
    };
  }
  if (env.OPENAI_WEB_SEARCH_CONTEXT_SIZE) {
    tool.search_context_size = env.OPENAI_WEB_SEARCH_CONTEXT_SIZE;
  }
  return tool;
}

function outputText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text;

  return (Array.isArray(payload.output) ? payload.output : [])
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join(" ");
}

function extractSources(payload = {}) {
  const sources = [];
  const output = Array.isArray(payload.output) ? payload.output : [];

  output.forEach((item) => {
    const actionSources = item?.action?.sources;
    if (Array.isArray(actionSources)) {
      actionSources.forEach((source) => {
        if (source?.url) {
          sources.push({
            url: source.url,
            title: source.title || source.source || "",
            snippet: source.snippet || source.description || source.summary || ""
          });
        }
      });
    }

    if (Array.isArray(item.content)) {
      item.content.forEach((content) => {
        const annotations = Array.isArray(content.annotations) ? content.annotations : [];
        annotations.forEach((annotation) => {
          if (annotation?.url) {
            sources.push({
              url: annotation.url,
              title: annotation.title || "",
              snippet: content.text || ""
            });
          }
        });
      });
    }
  });

  const byUrl = new Map();
  sources.forEach((source) => {
    const key = String(source.url || "").trim();
    if (!key) return;
    const existing = byUrl.get(key);
    if (!existing || (!existing.snippet && source.snippet)) {
      byUrl.set(key, source);
    }
  });

  return [...byUrl.values()];
}

function normalizeOwsCandidate(source = {}, {
  fallbackText = ""
} = {}) {
  return {
    source_url: source.url || "",
    title: source.title || "",
    evidence_excerpt: source.snippet || fallbackText,
    fields: {}
  };
}

export function openAiWebSearchProvider({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = String(env.ENABLE_OPENAI_WEB_SEARCH_FALLBACK || "true").toLowerCase() !== "false";
  const model = openAiWebSearchModelConfig(env.OPENAI_WEB_SEARCH_MODEL);
  const configured = enabled && Boolean(env.OPENAI_API_KEY && model.allowed);
  const timeoutMs = positiveNumber(env.OPENAI_WEB_SEARCH_TIMEOUT_MS, 8000);
  const maxResults = boundedLimit(env.OPENAI_WEB_SEARCH_MAX_RESULTS);
  const maxRetries = nonNegativeInteger(env.OPENAI_WEB_SEARCH_MAX_RETRIES, 1);
  const retryBaseMs = positiveNumber(env.OPENAI_WEB_SEARCH_RETRY_BASE_MS, 250);

  return {
    id: retrievalProviderIds.OPENAI_WEB_SEARCH,
    configured,
    enabled,
    async search({ query = {} } = {}) {
      if (!enabled) {
        return {
          provider_id: retrievalProviderIds.OPENAI_WEB_SEARCH,
          unavailable: true,
          reason: "OpenAI Web Search fallback is disabled",
          candidates: []
        };
      }

      if (!configured) {
        return {
          provider_id: retrievalProviderIds.OPENAI_WEB_SEARCH,
          unavailable: true,
          reason: !env.OPENAI_API_KEY || !model.configured
            ? "OPENAI_API_KEY or OPENAI_WEB_SEARCH_MODEL is not configured"
            : "OPENAI_WEB_SEARCH_MODEL is not in the retrieval model whitelist",
          candidates: []
        };
      }

      if (!fetchImpl) {
        return {
          provider_id: retrievalProviderIds.OPENAI_WEB_SEARCH,
          unavailable: true,
          reason: "fetch is unavailable",
          candidates: []
        };
      }

      const body = {
        model: model.model_id,
        input: query.query || "",
        tools: [buildSearchTool(env)],
        tool_choice: "required",
        include: ["web_search_call.action.sources"]
      };

      const response = await openAiWebSearchFetchWithRetry({
        fetchImpl,
        url: responsesEndpoint(env),
        options: {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify(body)
        },
        timeoutMs,
        maxRetries,
        retryBaseMs
      });

      if (!response.ok) {
        throw createOpenAiWebSearchError(`OpenAI Web Search failed: ${response.status}`, openAiWebSearchErrorCode(response.status), response.status);
      }

      const payload = await response.json();
      const fallbackText = outputText(payload).slice(0, 700);
      const sources = extractSources(payload).slice(0, maxResults);

      return {
        provider_id: retrievalProviderIds.OPENAI_WEB_SEARCH,
        unavailable: false,
        model_id: payload.model || model.model_id,
        response_id: payload.id || "",
        candidates: sources.map((source) => normalizeOwsCandidate(source, { fallbackText }))
      };
    }
  };
}
