import { fileURLToPath } from "node:url";

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = String(env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

export function normalizeBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("API_BASE_URL is required.");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("API_BASE_URL must start with http:// or https://.");
  return baseUrl;
}

export function optionalProtectionHeaders(env = process.env) {
  const headers = {};
  const bypassSecret = envValue(env, "VERCEL_AUTOMATION_BYPASS_SECRET");
  if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;
  const apiToken = envValue(env, "API_TOKEN");
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  return headers;
}

function cookieHeaderFromSetCookie(setCookieHeaders = []) {
  return setCookieHeaders
    .map((cookie) => String(cookie || "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

export function cookieHeaderFromResponse(response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return cookieHeaderFromSetCookie(setCookies);
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned non-JSON response: HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} ${body?.message || body?.error?.code || ""}`.trim());
  }
  return body;
}

function listingErrors(listing = {}, expectedSeller = "dcsports87") {
  const errors = [];
  if (String(listing.seller || "").trim().toLowerCase() !== expectedSeller.toLowerCase()) errors.push("seller");
  if (!listing.item_id) errors.push("item_id");
  if (!listing.title) errors.push("title");
  if (!listing.item_web_url) errors.push("item_web_url");
  if (!Array.isArray(listing.image_urls) || listing.image_urls.length === 0) errors.push("image_urls");
  return errors;
}

export function validateListingsPayload(payload = {}, { expectedSeller = "dcsports87" } = {}) {
  if (!payload || payload.ok !== true) throw new Error("listing endpoint did not return ok=true.");
  if (!Array.isArray(payload.listings)) throw new Error("listing endpoint did not return listings array.");
  if (payload.listings.length === 0) throw new Error("listing endpoint returned zero usable seller listings.");

  const failures = payload.listings
    .map((listing, index) => ({ index, errors: listingErrors(listing, expectedSeller) }))
    .filter((row) => row.errors.length > 0);
  if (failures.length) {
    throw new Error(`listing schema validation failed: ${failures.map((row) => `#${row.index}:${row.errors.join(",")}`).join(" ")}`);
  }
  return {
    listing_count: payload.listings.length,
    discarded_count: Number(payload.discarded_count || 0),
    seller: payload.seller,
    marketplace_id: payload.marketplace_id,
    sample_titles: payload.listings.slice(0, 3).map((listing) => listing.title)
  };
}

async function login({ baseUrl, env, fetchImpl }) {
  const username = envValue(env, "API_USERNAME", "METAVERSE_USERNAME");
  const password = envValue(env, "API_PASSWORD", "METAVERSE_PASSWORD");
  if (!username || !password) {
    throw new Error("API_USERNAME/API_PASSWORD or METAVERSE_USERNAME/METAVERSE_PASSWORD are required for cookie auth.");
  }
  const response = await fetchImpl(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...optionalProtectionHeaders(env)
    },
    body: JSON.stringify({ username, password })
  });
  await parseJsonResponse(response, "login");
  const cookie = cookieHeaderFromResponse(response);
  if (!cookie) throw new Error("login succeeded but no session cookie was returned.");
  return cookie;
}

export async function runSmoke({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = normalizeBaseUrl(env.API_BASE_URL);
  const limit = Math.max(1, Math.min(50, Number(env.EBAY_SMOKE_LIMIT || 5) || 5));
  const searchParams = new URLSearchParams({ limit: String(limit) });
  if (/^(?:1|true|yes)$/i.test(String(env.EBAY_SMOKE_SPORTS_ONLY || ""))) {
    searchParams.set("sports_only", "1");
  }
  if (env.EBAY_SMOKE_QUERY) searchParams.set("q", env.EBAY_SMOKE_QUERY);
  if (env.EBAY_SMOKE_CATEGORY_IDS) searchParams.set("category_ids", env.EBAY_SMOKE_CATEGORY_IDS);

  const healthResponse = await fetchImpl(`${baseUrl}/api/health`, {
    headers: optionalProtectionHeaders(env)
  });
  const health = await parseJsonResponse(healthResponse, "health");
  if (health?.ok !== true) throw new Error("health endpoint did not return ok=true.");

  const cookie = await login({ baseUrl, env, fetchImpl });
  const listingsResponse = await fetchImpl(`${baseUrl}/api/ebay-dcsports87-listings?${searchParams}`, {
    headers: {
      cookie,
      ...optionalProtectionHeaders(env)
    }
  });
  const listingsPayload = await parseJsonResponse(listingsResponse, "dcsports87 listings");
  const listingSummary = validateListingsPayload(listingsPayload, { expectedSeller: "dcsports87" });

  return {
    ok: true,
    base_url: baseUrl,
    endpoints: [
      "GET /api/health",
      "POST /api/login",
      "GET /api/ebay-dcsports87-listings"
    ],
    listingSummary
  };
}

function printSummary(summary) {
  console.log("deployed eBay API smoke passed");
  console.log(`base_url=${summary.base_url}`);
  console.log(`endpoints=${summary.endpoints.join(", ")}`);
  console.log(`seller=${summary.listingSummary.seller}`);
  console.log(`marketplace_id=${summary.listingSummary.marketplace_id}`);
  console.log(`listing_count=${summary.listingSummary.listing_count}`);
  console.log(`discarded_count=${summary.listingSummary.discarded_count}`);
  summary.listingSummary.sample_titles.forEach((title, index) => {
    console.log(`sample_${index + 1}=${title}`);
  });
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  runSmoke().then(printSummary).catch((error) => {
    console.error(`deployed eBay API smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
