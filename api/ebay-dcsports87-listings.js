import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { ebayBrowseProvider } from "../lib/listing/retrieval/ebay-browse-provider.mjs";
import {
  filterSportsCardListings,
  sportsCardFilterVersion
} from "../lib/listing/retrieval/sports-card-filter.mjs";

const cookieName = "lynca_metaverse_session";
const defaultSeller = "dcsports87";

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function isValidSession(cookie, secret) {
  if (!cookie || !secret) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload, secret)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function boundedLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.max(1, Math.min(50, Math.trunc(number)));
}

function boundedProviderLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.max(1, Math.min(200, Math.trunc(number)));
}

function boundedOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(10_000, Math.trunc(number)));
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function requestUrl(req) {
  const host = req.headers.host || "localhost";
  return new URL(req.url || "/", `https://${host}`);
}

function normalizeSeller(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCategoryIds(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .join(",");
}

function queryBoolean(value) {
  return /^(?:1|true|yes)$/i.test(String(value || ""));
}

function sellerFilterMatchesExpected(env = {}, expectedSeller = defaultSeller) {
  const filter = normalizeSeller(env.EBAY_BROWSE_FILTER || "");
  return filter.includes("sellers:") && filter.includes(normalizeSeller(expectedSeller));
}

function imageUrlsFromCandidate(candidate = {}) {
  const fields = candidate.fields || {};
  return [
    ...(Array.isArray(fields.marketplace_image_urls) ? fields.marketplace_image_urls : []),
    fields.marketplace_image_url
  ]
    .map((url) => String(url || "").trim())
    .filter((url) => /^https:\/\//i.test(url))
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function normalizedListing(candidate = {}) {
  const fields = candidate.fields || {};
  const imageUrls = imageUrlsFromCandidate(candidate);
  return {
    item_id: String(fields.marketplace_item_id || "").trim(),
    seller: String(fields.marketplace_seller_username || "").trim(),
    title: String(candidate.title || "").trim(),
    item_web_url: String(candidate.source_url || "").trim(),
    image_urls: imageUrls,
    marketplace_id: String(fields.marketplace_id || "").trim(),
    condition: String(fields.marketplace_condition || "").trim(),
    price: String(fields.marketplace_price || "").trim()
  };
}

function listingComplete(listing = {}) {
  return Boolean(
    listing.item_id &&
    listing.seller &&
    listing.title &&
    listing.item_web_url &&
    Array.isArray(listing.image_urls) &&
    listing.image_urls.length > 0
  );
}

function sellerVerified(listing = {}, expectedSeller = defaultSeller, filterMatchesExpected = false) {
  if (normalizeSeller(listing.seller) === expectedSeller) return true;
  return Boolean(filterMatchesExpected && listing.seller);
}

function publicListing(listing = {}, expectedSeller = defaultSeller, filterMatchesExpected = false) {
  if (normalizeSeller(listing.seller) === expectedSeller) {
    return {
      ...listing,
      seller_verification: "EXACT_RESPONSE"
    };
  }
  if (filterMatchesExpected && listing.seller) {
    return {
      ...listing,
      seller: expectedSeller,
      seller_verification: "EBAY_SELLER_FILTER",
      marketplace_seller_alias: listing.seller
    };
  }
  return listing;
}

function listingMissingVerifiableSeller(listing = {}) {
  return !String(listing.seller || "").trim();
}

function mergeListing(primary = {}, fallback = {}) {
  return {
    ...fallback,
    ...primary,
    seller: primary.seller || fallback.seller || "",
    image_urls: Array.isArray(primary.image_urls) && primary.image_urls.length
      ? primary.image_urls
      : Array.isArray(fallback.image_urls)
        ? fallback.image_urls
        : []
  };
}

async function detailEnrichedListings(provider, candidates = []) {
  const normalized = candidates.map(normalizedListing);
  if (typeof provider.item !== "function") {
    return {
      listings: normalized,
      detail_attempted_count: 0,
      detail_success_count: 0
    };
  }

  let detailAttemptedCount = 0;
  let detailSuccessCount = 0;
  const listings = await Promise.all(normalized.map(async (listing) => {
    if (!listing.item_id || (!listingMissingVerifiableSeller(listing) && listingComplete(listing))) {
      return listing;
    }
    try {
      detailAttemptedCount += 1;
      const detail = await provider.item({ itemId: listing.item_id });
      if (detail.unavailable || !detail.candidate) return listing;
      detailSuccessCount += 1;
      return mergeListing(listing, normalizedListing(detail.candidate));
    } catch {
      return listing;
    }
  }));
  return {
    listings,
    detail_attempted_count: detailAttemptedCount,
    detail_success_count: detailSuccessCount
  };
}

function discardReason(listing = {}, expectedSeller = defaultSeller, filterMatchesExpected = false) {
  if (!sellerVerified(listing, expectedSeller, filterMatchesExpected)) return "seller";
  if (!listing.item_id) return "item_id";
  if (!listing.title) return "title";
  if (!listing.item_web_url) return "item_web_url";
  if (!Array.isArray(listing.image_urls) || !listing.image_urls.length) return "image_urls";
  return "unknown";
}

function publicProviderError(error) {
  return {
    code: error?.code || "ebay_browse_error",
    status: error?.status || null,
    message: error?.status
      ? `eBay Browse request failed with HTTP ${error.status}`
      : "eBay Browse request failed"
  };
}

export function createEbayDcsports87ListingsHandler({
  providerFactory = ebayBrowseProvider,
  env = process.env
} = {}) {
  return async function handler(req, res) {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, message: "Method not allowed" });
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const authenticated = isValidSession(cookies[cookieName], env.METAVERSE_AUTH_SECRET);

    if (!authenticated) {
      sendJson(res, 401, { ok: false, message: "Unauthorized" });
      return;
    }

    if (!enforceApiRateLimit(req, res, {
      scope: "ebay_dcsports87_listings",
      limit: 60,
      windowMs: 60_000,
      message: "Too many eBay listing smoke requests. Please try again shortly."
    })) return;

    const url = requestUrl(req);
    const limit = boundedLimit(firstQueryValue(url.searchParams.get("limit")));
    const offset = boundedOffset(firstQueryValue(url.searchParams.get("offset")));
    const diagnostics = queryBoolean(firstQueryValue(url.searchParams.get("diagnostics")));
    const sportsOnly = queryBoolean(firstQueryValue(url.searchParams.get("sports_only")));
    const query = String(firstQueryValue(url.searchParams.get("q")) || env.EBAY_BROWSE_SMOKE_QUERY || "card").trim() || "card";
    const categoryIds = normalizeCategoryIds(firstQueryValue(url.searchParams.get("category_ids")) || env.EBAY_BROWSE_CATEGORY_IDS || "");
    const providerLimit = boundedProviderLimit(sportsOnly ? Math.max(limit * 3, limit + 20) : limit);
    const expectedSeller = normalizeSeller(env.EBAY_SELLER_USERNAME || defaultSeller);
    const filterMatchesExpected = sellerFilterMatchesExpected(env, expectedSeller);
    const provider = providerFactory({ env });

    try {
      const result = await provider.search({
        query: {
          query_id: "cloud_ebay_dcsports87_listings",
          query,
          offset,
          limit: providerLimit,
          category_ids: categoryIds
        }
      });

      if (result.unavailable) {
        sendJson(res, 503, {
          ok: false,
          provider_id: result.provider_id || "ebay_browse",
          message: result.reason || "eBay Browse is unavailable"
        });
        return;
      }

      const rawCandidates = Array.isArray(result.candidates) ? result.candidates : [];
      const detailResult = await detailEnrichedListings(provider, rawCandidates);
      const enrichedListings = detailResult.listings;
      const sellerListings = enrichedListings
        .filter((listing) => sellerVerified(listing, expectedSeller, filterMatchesExpected))
        .filter(listingComplete);
      const sportsFilter = sportsOnly
        ? filterSportsCardListings(sellerListings)
        : {
          listings: sellerListings,
          discarded: [],
          discarded_count: 0,
          discard_reasons: {},
          filter_version: sportsCardFilterVersion
        };
      const listings = sportsFilter.listings.slice(0, limit);
      const discardedCount = rawCandidates.length - listings.length;
      const discard_reasons = enrichedListings
        .filter((listing) => !sellerVerified(listing, expectedSeller, filterMatchesExpected) || !listingComplete(listing))
        .reduce((counts, listing) => {
          const reason = discardReason(listing, expectedSeller, filterMatchesExpected);
          counts[reason] = (counts[reason] || 0) + 1;
          return counts;
        }, {});
      for (const [reason, count] of Object.entries(sportsFilter.discard_reasons)) {
        const key = `non_sports:${reason}`;
        discard_reasons[key] = (discard_reasons[key] || 0) + count;
      }

      sendJson(res, 200, {
        ok: true,
        provider_id: result.provider_id || "ebay_browse",
        marketplace_id: result.marketplace_id || env.EBAY_MARKETPLACE_ID || "EBAY_US",
        seller: expectedSeller,
        query,
        offset,
        category_ids: categoryIds,
        sports_only: sportsOnly,
        sports_filter_version: sportsCardFilterVersion,
        seller_filter_configured: Boolean(env.EBAY_BROWSE_FILTER),
        seller_filter_matches_expected: filterMatchesExpected,
        requested_limit: limit,
        provider_requested_limit: providerLimit,
        total_reported: Number(result.total || rawCandidates.length),
        returned_count: listings.length,
        discarded_count: discardedCount,
        discard_reasons,
        sports_filtered_count: sportsFilter.discarded_count,
        detail_attempted_count: detailResult.detail_attempted_count,
        detail_success_count: detailResult.detail_success_count,
        more_results_available: Boolean(result.more_results_available),
        listings: listings.map((listing) => publicListing(listing, expectedSeller, filterMatchesExpected)),
        diagnostics: diagnostics
          ? {
            discarded_seller_samples: enrichedListings
              .map((listing) => listing.seller)
              .filter(Boolean)
              .filter((seller, index, sellers) => sellers.indexOf(seller) === index)
              .slice(0, 5),
            sports_filtered_samples: sportsFilter.discarded.slice(0, 5)
          }
          : undefined
      });
    } catch (error) {
      sendJson(res, error?.status === 401 || error?.status === 403 ? 502 : 502, {
        ok: false,
        provider_id: "ebay_browse",
        error: publicProviderError(error)
      });
    }
  };
}

export default createEbayDcsports87ListingsHandler();
