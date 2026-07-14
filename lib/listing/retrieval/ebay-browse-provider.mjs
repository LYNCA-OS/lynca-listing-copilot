import { retrievalProviderIds, retrievalSourceTypes, retrievalTrustTiers } from "./retrieval-contract.mjs";

const DEFAULT_SCOPE = "https://api.ebay.com/oauth/api_scope";

function ebayEnvironment(env) {
  return String(env.EBAY_ENVIRONMENT || "production").toLowerCase() === "sandbox"
    ? "sandbox"
    : "production";
}

function ebayApiHost(env) {
  return ebayEnvironment(env) === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback).replace(/\/+$/, "");
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function boundedLimit(value) {
  return Math.max(1, Math.min(200, positiveNumber(value, 10)));
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

export function normalizeEbaySellerUsername(value = "") {
  const seller = String(value || "").trim();
  if (!seller) return "";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(seller)) return "";
  return seller;
}

export function ebaySellerFilter(value = "") {
  const seller = normalizeEbaySellerUsername(value);
  return seller ? `sellers:{${seller}}` : "";
}

function createEbayError(message, code, status = null) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function ebayErrorCode(status) {
  if (status === 408) return "ebay_timeout";
  if (status === 429) return "ebay_rate_limited";
  if (status === 401 || status === 403) return "ebay_unauthorized";
  if (status >= 500) return "ebay_server_error";
  return "ebay_browse_error";
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
      throw createEbayError("eBay Browse request timed out", "ebay_browse_timeout");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function ebayFetchWithRetry({
  fetchImpl,
  url,
  options,
  timeoutMs,
  maxRetries,
  retryBaseMs,
  errorLabel
}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchWithTimeout(fetchImpl, url, options, timeoutMs);
    if (response.ok || !retryableStatus(response.status) || attempt === maxRetries) {
      return response;
    }
    await wait(retryBaseMs * (2 ** attempt));
  }

  throw createEbayError(`${errorLabel} retry loop exhausted`, "ebay_retry_error");
}

function tokenEndpoint(env) {
  return env.EBAY_OAUTH_URL || `${ebayApiHost(env)}/identity/v1/oauth2/token`;
}

function browseEndpoint(env) {
  return `${normalizeBaseUrl(env.EBAY_BROWSE_BASE_URL, `${ebayApiHost(env)}/buy/browse/v1`)}/item_summary/search`;
}

function buildBasicCredential(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function amountText(amount) {
  if (!amount?.value) return "";
  return [amount.value, amount.currency].filter(Boolean).join(" ");
}

function categoryText(categories = []) {
  return categories
    .map((category) => category.categoryName)
    .filter(Boolean)
    .join(" > ");
}

function imageUrls(item = {}) {
  return [
    item.image?.imageUrl,
    ...(Array.isArray(item.additionalImages) ? item.additionalImages.map((image) => image.imageUrl) : []),
    ...(Array.isArray(item.thumbnailImages) ? item.thumbnailImages.map((image) => image.imageUrl) : [])
  ]
    .map((url) => String(url || "").trim())
    .filter((url) => /^https:\/\//i.test(url))
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function normalizeEbayItem(item = {}, {
  marketplaceId
} = {}) {
  const price = amountText(item.price || item.currentBidPrice);
  const categories = categoryText(item.categories);
  const images = imageUrls(item);
  const evidenceExcerpt = [
    item.shortDescription,
    item.condition,
    price ? `market price ${price}` : "",
    categories ? `category ${categories}` : "",
    Array.isArray(item.buyingOptions) && item.buyingOptions.length
      ? `buying options ${item.buyingOptions.join(", ")}`
      : ""
  ].filter(Boolean).join(" | ");

  return {
    source_url: item.itemWebUrl || item.itemAffiliateWebUrl || item.itemHref || "",
    source_type: retrievalSourceTypes.MARKETPLACE,
    trust_tier: retrievalTrustTiers.MARKET_REFERENCE,
    title: item.title || "",
    evidence_excerpt: evidenceExcerpt,
    fields: {
      marketplace_item_id: item.itemId || item.legacyItemId || "",
      marketplace_seller_username: item.seller?.username || "",
      marketplace_seller_user_id: item.seller?.userId || "",
      marketplace_id: item.listingMarketplaceId || marketplaceId,
      marketplace_condition: item.condition || "",
      marketplace_price: price,
      marketplace_buying_options: Array.isArray(item.buyingOptions) ? item.buyingOptions.join(", ") : "",
      marketplace_item_group_href: item.itemGroupHref || "",
      marketplace_item_group_type: item.itemGroupType || "",
      marketplace_image_url: images[0] || "",
      marketplace_image_urls: images.slice(0, 8)
    }
  };
}

export function ebayBrowseProvider({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now()
} = {}) {
  const configured = Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET);
  const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const timeoutMs = positiveNumber(env.EBAY_BROWSE_TIMEOUT_MS, 8000);
  const defaultLimit = boundedLimit(env.EBAY_BROWSE_MAX_RESULTS);
  const maxRetries = nonNegativeInteger(env.EBAY_BROWSE_MAX_RETRIES, 1);
  const retryBaseMs = positiveNumber(env.EBAY_BROWSE_RETRY_BASE_MS, 250);
  const scope = env.EBAY_OAUTH_SCOPE || DEFAULT_SCOPE;
  const tokenCache = {
    accessToken: "",
    expiresAt: 0
  };

  async function getAccessToken() {
    if (tokenCache.accessToken && tokenCache.expiresAt - 60_000 > now()) {
      return tokenCache.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope
    });
    const response = await ebayFetchWithRetry({
      fetchImpl,
      url: tokenEndpoint(env),
      options: {
        method: "POST",
        headers: {
          authorization: `Basic ${buildBasicCredential(env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET)}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json"
        },
        body
      },
      timeoutMs,
      maxRetries,
      retryBaseMs,
      errorLabel: "eBay OAuth"
    });

    if (!response.ok) {
      throw createEbayError(`eBay OAuth failed: ${response.status}`, ebayErrorCode(response.status), response.status);
    }

    const payload = await response.json();
    if (!payload?.access_token) {
      throw createEbayError("eBay OAuth response did not include an access token", "ebay_oauth_token_missing");
    }

    tokenCache.accessToken = payload.access_token;
    tokenCache.expiresAt = now() + positiveNumber(payload.expires_in, 3600) * 1000;
    return tokenCache.accessToken;
  }

  return {
    id: retrievalProviderIds.EBAY_BROWSE,
    configured,
    enabled: true,
    async search({ query = {} } = {}) {
      if (!configured) {
        return {
          provider_id: retrievalProviderIds.EBAY_BROWSE,
          unavailable: true,
          reason: "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured",
          candidates: []
        };
      }

      if (!fetchImpl) {
        return {
          provider_id: retrievalProviderIds.EBAY_BROWSE,
          unavailable: true,
          reason: "fetch is unavailable",
          candidates: []
        };
      }

      const accessToken = await getAccessToken();
      const limit = boundedLimit(query.limit || defaultLimit);
      const offset = Math.max(0, Number(query.offset || 0));
      const requestedSeller = String(query.seller_username || "").trim();
      const normalizedSeller = normalizeEbaySellerUsername(requestedSeller);
      if (requestedSeller && !normalizedSeller) {
        throw createEbayError("Invalid eBay seller username", "ebay_invalid_seller");
      }
      const explicitSellerFilter = ebaySellerFilter(normalizedSeller);
      const url = new URL(browseEndpoint(env));
      url.searchParams.set("q", query.query || "");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      if (query.category_ids) url.searchParams.set("category_ids", String(query.category_ids));
      if (explicitSellerFilter) url.searchParams.set("filter", explicitSellerFilter);
      else if (query.disable_env_filter !== true && env.EBAY_BROWSE_FILTER) {
        url.searchParams.set("filter", env.EBAY_BROWSE_FILTER);
      }
      if (env.EBAY_BROWSE_SORT) url.searchParams.set("sort", env.EBAY_BROWSE_SORT);

      const headers = {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "x-ebay-c-marketplace-id": marketplaceId
      };
      if (env.EBAY_ACCEPT_LANGUAGE) headers["accept-language"] = env.EBAY_ACCEPT_LANGUAGE;

      const response = await ebayFetchWithRetry({
        fetchImpl,
        url,
        options: { headers },
        timeoutMs,
        maxRetries,
        retryBaseMs,
        errorLabel: "eBay Browse"
      });

      if (!response.ok) {
        throw createEbayError(`eBay Browse failed: ${response.status}`, ebayErrorCode(response.status), response.status);
      }

      const payload = await response.json();
      const items = Array.isArray(payload.itemSummaries) ? payload.itemSummaries : [];
      return {
        provider_id: retrievalProviderIds.EBAY_BROWSE,
        unavailable: false,
        marketplace_id: marketplaceId,
        seller_filter_applied: Boolean(explicitSellerFilter),
        seller_filter_seller: normalizedSeller.toLowerCase(),
        more_results_available: Boolean(payload.next || Number(payload.total || 0) > offset + limit),
        total: Number(payload.total || items.length),
        candidates: items.map((item) => normalizeEbayItem(item, { marketplaceId }))
      };
    }
  };
}
