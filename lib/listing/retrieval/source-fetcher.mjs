import { assertSourceAllowed, defaultSourcePolicy } from "./source-policy.mjs";

const DEFAULT_ALLOWED_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "application/xhtml+xml",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/xml"
];

const PROMPT_INJECTION_PATTERNS = [
  {
    id: "ignore_previous_instructions",
    pattern: /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions?\b/gi
  },
  {
    id: "system_prompt_reference",
    pattern: /\b(system|developer)\s+(prompt|message|instructions?)\b/gi
  },
  {
    id: "roleplay_override",
    pattern: /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\b/gi
  },
  {
    id: "instruction_exfiltration",
    pattern: /\b(reveal|print|return|show)\s+(the\s+)?(system|developer)\s+(prompt|message|instructions?)\b/gi
  }
];

function createSourceFetchError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw createSourceFetchError("Invalid retrieval source URL", "retrieval_source_invalid_url");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw createSourceFetchError("Retrieval source fetch only allows HTTP and HTTPS", "retrieval_source_protocol");
  }

  if (url.username || url.password) {
    throw createSourceFetchError("Retrieval source URL must not contain credentials", "retrieval_source_credentials_in_url");
  }

  return url;
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
      throw createSourceFetchError("Retrieval source fetch timed out", "retrieval_source_timeout");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchWithRetry({
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
      if (error?.code !== "retrieval_source_timeout" || attempt === maxRetries) {
        throw error;
      }
    }
    await wait(retryBaseMs * (2 ** attempt));
  }

  throw createSourceFetchError("Retrieval source retry loop exhausted", "retrieval_source_retry_error");
}

function contentType(response) {
  return String(response.headers?.get?.("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isAllowedContentType(type, allowedTypes) {
  if (!type) return false;
  return allowedTypes.includes(type);
}

function contentLength(response) {
  const value = response.headers?.get?.("content-length");
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function sanitizeFetchedText(value, {
  maxTextChars = 12_000
} = {}) {
  let text = decodeBasicEntities(stripHtml(value)).replace(/\s+/g, " ").trim();
  const promptInjectionSignals = [];

  for (const item of PROMPT_INJECTION_PATTERNS) {
    if (item.pattern.test(text)) {
      promptInjectionSignals.push(item.id);
      text = text.replace(item.pattern, "[removed retrieval instruction]");
    }
    item.pattern.lastIndex = 0;
  }

  const truncated = text.length > maxTextChars;
  return {
    text: truncated ? text.slice(0, maxTextChars).trim() : text,
    truncated,
    prompt_injection_signals: [...new Set(promptInjectionSignals)]
  };
}

async function readBoundedText(response, {
  maxBytes,
  maxTextChars
}) {
  const declaredLength = contentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw createSourceFetchError("Retrieval source exceeds configured byte limit", "retrieval_source_too_large", {
      declared_length: declaredLength
    });
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw createSourceFetchError("Retrieval source exceeds configured byte limit", "retrieval_source_too_large", {
      actual_length: buffer.byteLength
    });
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  return {
    bytes: buffer.byteLength,
    ...sanitizeFetchedText(decoded, { maxTextChars })
  };
}

export async function fetchRetrievalSource({
  sourceUrl,
  fetchImpl = globalThis.fetch,
  policy = defaultSourcePolicy(),
  maxRedirects = 3,
  allowedContentTypes = DEFAULT_ALLOWED_CONTENT_TYPES,
  now = () => new Date().toISOString()
} = {}) {
  if (!fetchImpl) {
    throw createSourceFetchError("fetch is unavailable", "retrieval_source_fetch_unavailable");
  }

  const timeoutMs = positiveNumber(policy.timeout_ms, 8000);
  const maxBytes = positiveNumber(policy.max_fetch_bytes, 200_000);
  const maxTextChars = positiveNumber(policy.max_text_chars, 12_000);
  const maxRetries = nonNegativeInteger(policy.max_retries, 1);
  const retryBaseMs = positiveNumber(policy.retry_base_ms, 250);
  const originalUrl = normalizeUrl(sourceUrl);
  let currentUrl = originalUrl;
  let classification = assertSourceAllowed(currentUrl.href, { policy });
  const redirects = [];

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchWithRetry({
      fetchImpl,
      url: currentUrl,
      options: {
        redirect: "manual",
        headers: {
          accept: allowedContentTypes.join(", ")
        }
      },
      timeoutMs,
      maxRetries,
      retryBaseMs
    });

    if (response.status >= 300 && response.status < 400 && response.headers?.get?.("location")) {
      if (redirectCount >= maxRedirects) {
        throw createSourceFetchError("Retrieval source exceeded redirect limit", "retrieval_source_redirect_limit");
      }

      const nextUrl = normalizeUrl(new URL(response.headers.get("location"), currentUrl).href);
      const nextClassification = assertSourceAllowed(nextUrl.href, { policy });
      redirects.push({
        from: currentUrl.href,
        to: nextUrl.href,
        status: response.status
      });
      currentUrl = nextUrl;
      classification = nextClassification;
      continue;
    }

    if (!response.ok) {
      throw createSourceFetchError(`Retrieval source fetch failed: ${response.status}`, "retrieval_source_http_error", {
        status: response.status
      });
    }

    const type = contentType(response);
    if (!isAllowedContentType(type, allowedContentTypes)) {
      throw createSourceFetchError(`Unsupported retrieval source content type: ${type || "unknown"}`, "retrieval_source_content_type", {
        content_type: type || null
      });
    }

    const textResult = await readBoundedText(response, {
      maxBytes,
      maxTextChars
    });

    return {
      source_url: currentUrl.href,
      original_url: originalUrl.href,
      domain: classification.domain,
      source_type: classification.source_type,
      trust_tier: classification.trust_tier,
      fetched_at: now(),
      status: response.status,
      content_type: type,
      bytes: textResult.bytes,
      redirected: redirects.length > 0,
      redirects,
      text: textResult.text,
      truncated: textResult.truncated,
      prompt_injection_signals: textResult.prompt_injection_signals
    };
  }

  throw createSourceFetchError("Retrieval source exceeded redirect limit", "retrieval_source_redirect_limit");
}
