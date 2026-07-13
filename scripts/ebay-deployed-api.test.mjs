import assert from "node:assert/strict";
import crypto from "node:crypto";
import healthHandler from "../api/health.js";
import { createEbayDcsports87ListingsHandler } from "../api/ebay-dcsports87-listings.js";
import {
  normalizeBaseUrl,
  optionalProtectionHeaders,
  validateListingsPayload
} from "./smoke-deployed-ebay-api.mjs";

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function sessionCookie(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload, secret)}`;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value) {
      this.body = value || "";
    }
  };
}

async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body ? JSON.parse(res.body) : null
  };
}

let response = await call(healthHandler, {
  method: "GET",
  headers: {},
  url: "/api/health"
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.ok, true);
assert.equal(response.body.service, "lynca-listing-copilot");

const secret = "test-auth-secret";
const handler = createEbayDcsports87ListingsHandler({
  env: {
    METAVERSE_AUTH_SECRET: secret,
    EBAY_SELLER_USERNAME: "dcsports87",
    EBAY_MARKETPLACE_ID: "EBAY_US"
  },
  providerFactory: () => ({
    search: async ({ query }) => ({
      provider_id: "ebay_browse",
      marketplace_id: "EBAY_US",
      total: 3,
      more_results_available: false,
      query,
      candidates: [{
        source_url: "https://www.ebay.com/itm/1",
        title: "2025 Topps Chrome Test Card",
        fields: {
          marketplace_item_id: "v1|1|0",
          marketplace_seller_username: "dcsports87",
          marketplace_id: "EBAY_US",
          marketplace_item_group_href: "https://api.ebay.com/item-group/1",
          marketplace_item_group_type: "SELLER_DEFINED_VARIATIONS",
          marketplace_image_urls: ["https://i.ebayimg.com/images/1.jpg"]
        }
      }, {
        source_url: "https://www.ebay.com/itm/2",
        title: "Wrong Seller Card",
        fields: {
          marketplace_item_id: "v1|2|0",
          marketplace_seller_username: "other_seller",
          marketplace_id: "EBAY_US",
          marketplace_image_urls: ["https://i.ebayimg.com/images/2.jpg"]
        }
      }, {
        source_url: "https://www.ebay.com/itm/3",
        title: "Missing Images",
        fields: {
          marketplace_item_id: "v1|3|0",
          marketplace_seller_username: "dcsports87",
          marketplace_id: "EBAY_US"
        }
      }]
    })
  })
});

response = await call(handler, {
  method: "GET",
  headers: {},
  url: "/api/ebay-dcsports87-listings?limit=5"
});
assert.equal(response.statusCode, 401);

response = await call(handler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-dcsports87-listings?limit=5"
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.ok, true);
assert.equal(response.body.returned_count, 1);
assert.equal(response.body.discarded_count, 2);
assert.equal(response.body.listings[0].seller, "dcsports87");
assert.equal(response.body.listings[0].item_id, "v1|1|0");
assert.equal(response.body.listings[0].item_group_type, "SELLER_DEFINED_VARIATIONS");
assert.match(response.body.listings[0].item_group_href, /item-group/);

let sportsSearchQuery = null;
const sportsOnlyHandler = createEbayDcsports87ListingsHandler({
  env: {
    METAVERSE_AUTH_SECRET: secret,
    EBAY_SELLER_USERNAME: "dcsports87",
    EBAY_MARKETPLACE_ID: "EBAY_US"
  },
  providerFactory: () => ({
    search: async ({ query }) => {
      sportsSearchQuery = query;
      return {
        provider_id: "ebay_browse",
        marketplace_id: "EBAY_US",
        total: 3,
        more_results_available: false,
        candidates: [{
          source_url: "https://www.ebay.com/itm/sports",
          title: "2025 Topps Chrome Basketball Test Player Gold Refractor",
          fields: {
            marketplace_item_id: "v1|sports|0",
            marketplace_seller_username: "dcsports87",
            marketplace_id: "EBAY_US",
            marketplace_image_urls: ["https://i.ebayimg.com/images/sports.jpg"]
          }
        }, {
          source_url: "https://www.ebay.com/itm/pokemon",
          title: "Pokemon Charizard Holo PSA 10",
          fields: {
            marketplace_item_id: "v1|pokemon|0",
            marketplace_seller_username: "dcsports87",
            marketplace_id: "EBAY_US",
            marketplace_image_urls: ["https://i.ebayimg.com/images/pokemon.jpg"]
          }
        }, {
          source_url: "https://www.ebay.com/itm/yugioh",
          title: "Yu-Gi-Oh Dark Magician PSA 10",
          fields: {
            marketplace_item_id: "v1|yugioh|0",
            marketplace_seller_username: "dcsports87",
            marketplace_id: "EBAY_US",
            marketplace_image_urls: ["https://i.ebayimg.com/images/yugioh.jpg"]
          }
        }]
      };
    }
  })
});
response = await call(sportsOnlyHandler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-dcsports87-listings?limit=2&sports_only=1&category_ids=212,261328&q=card"
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.sports_only, true);
assert.equal(response.body.returned_count, 1);
assert.equal(response.body.sports_filtered_count, 2);
assert.equal(response.body.listings[0].item_id, "v1|sports|0");
assert.equal(sportsSearchQuery.category_ids, "212,261328");
assert.equal(sportsSearchQuery.limit, 22);

let itemDetailCalls = 0;
const detailFallbackHandler = createEbayDcsports87ListingsHandler({
  env: {
    METAVERSE_AUTH_SECRET: secret,
    EBAY_SELLER_USERNAME: "dcsports87",
    EBAY_MARKETPLACE_ID: "EBAY_US"
  },
  providerFactory: () => ({
    search: async () => ({
      provider_id: "ebay_browse",
      marketplace_id: "EBAY_US",
      seller_filter_applied: true,
      seller_filter_seller: "dcsports87",
      total: 1,
      candidates: [{
        source_url: "https://www.ebay.com/itm/detail",
        title: "Detail Fallback Card",
        fields: {
          marketplace_item_id: "v1|detail|0",
          marketplace_id: "EBAY_US",
          marketplace_image_urls: ["https://i.ebayimg.com/images/detail.jpg"]
        }
      }]
    }),
    item: async ({ itemId }) => {
      itemDetailCalls += 1;
      assert.equal(itemId, "v1|detail|0");
      return {
        provider_id: "ebay_browse",
        unavailable: false,
        candidate: {
          source_url: "https://www.ebay.com/itm/detail",
          title: "Detail Fallback Card",
          fields: {
            marketplace_item_id: "v1|detail|0",
            marketplace_seller_username: "dcsports87",
            marketplace_id: "EBAY_US",
            marketplace_image_urls: ["https://i.ebayimg.com/images/detail.jpg"]
          }
        }
      };
    }
  })
});
response = await call(detailFallbackHandler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-dcsports87-listings?limit=1"
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.returned_count, 1);
assert.equal(response.body.listings[0].seller, "dcsports87");
assert.equal(itemDetailCalls, 1);
assert.equal(response.body.detail_attempted_count, 1);
assert.equal(response.body.detail_success_count, 1);

const maskedSellerHandler = createEbayDcsports87ListingsHandler({
  env: {
    METAVERSE_AUTH_SECRET: secret,
    EBAY_SELLER_USERNAME: "dcsports87",
    EBAY_BROWSE_FILTER: "sellers:{dcsports87}",
    EBAY_MARKETPLACE_ID: "EBAY_US"
  },
  providerFactory: () => ({
    search: async () => ({
      provider_id: "ebay_browse",
      marketplace_id: "EBAY_US",
      seller_filter_applied: true,
      seller_filter_seller: "dcsports87",
      total: 1,
      candidates: [{
        source_url: "https://www.ebay.com/itm/masked",
        title: "Masked Seller Card",
        fields: {
          marketplace_item_id: "v1|masked|0",
          marketplace_seller_username: "masked_seller_token",
          marketplace_id: "EBAY_US",
          marketplace_image_urls: ["https://i.ebayimg.com/images/masked.jpg"]
        }
      }]
    })
  })
});
response = await call(maskedSellerHandler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-dcsports87-listings?limit=1"
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.returned_count, 1);
assert.equal(response.body.seller_filter_matches_expected, true);
assert.equal(response.body.listings[0].seller, "dcsports87");
assert.equal(response.body.listings[0].seller_verification, "EBAY_SELLER_FILTER");
assert.equal(response.body.listings[0].marketplace_seller_alias, "masked_seller_token");

const sellerFilterMissingSellerHandler = createEbayDcsports87ListingsHandler({
  env: {
    METAVERSE_AUTH_SECRET: secret,
    EBAY_SELLER_USERNAME: "dcsports87",
    EBAY_BROWSE_FILTER: "sellers:{dcsports87}",
    EBAY_MARKETPLACE_ID: "EBAY_US"
  },
  providerFactory: () => ({
    search: async () => ({
      provider_id: "ebay_browse",
      marketplace_id: "EBAY_US",
      seller_filter_applied: true,
      seller_filter_seller: "dcsports87",
      total: 1,
      candidates: [{
        source_url: "https://www.ebay.com/itm/filter-only",
        title: "Seller Filter Only Card",
        fields: {
          marketplace_item_id: "v1|filter-only|0",
          marketplace_id: "EBAY_US",
          marketplace_image_urls: ["https://i.ebayimg.com/images/filter-only.jpg"]
        }
      }]
    })
  })
});
response = await call(sellerFilterMissingSellerHandler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-dcsports87-listings?limit=1"
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.returned_count, 1);
assert.equal(response.body.listings[0].seller, "dcsports87");
assert.equal(response.body.listings[0].seller_verification, "EBAY_SELLER_FILTER");
assert.equal(response.body.listings[0].marketplace_seller_alias, "");
const dcsportsPayload = response.body;

let dynamicSellerQuery = null;
const dynamicSellerHandler = createEbayDcsports87ListingsHandler({
  env: {
    METAVERSE_AUTH_SECRET: secret,
    EBAY_MARKETPLACE_ID: "EBAY_US"
  },
  allowSellerOverride: true,
  requireSeller: true,
  providerFactory: () => ({
    search: async ({ query }) => {
      dynamicSellerQuery = query;
      return {
        provider_id: "ebay_browse",
        marketplace_id: "EBAY_US",
        seller_filter_applied: true,
        seller_filter_seller: "the-poke-store",
        total: 1,
        candidates: [{
          source_url: "https://www.ebay.com/itm/dynamic",
          title: "Dynamic Seller Card",
          fields: {
            marketplace_item_id: "v1|dynamic|0",
            marketplace_id: "EBAY_US",
            marketplace_image_urls: ["https://i.ebayimg.com/images/dynamic.jpg"]
          }
        }]
      };
    }
  })
});
response = await call(dynamicSellerHandler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-seller-listings?limit=1&seller=The-Poke-Store"
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.returned_count, 1);
assert.equal(response.body.seller, "the-poke-store");
assert.equal(response.body.listings[0].seller_verification, "EBAY_SELLER_FILTER");
assert.equal(dynamicSellerQuery.seller_username, "The-Poke-Store");

response = await call(dynamicSellerHandler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-seller-listings?limit=1"
});
assert.equal(response.statusCode, 400);
assert.match(response.body.message, /seller is required/);

response = await call(dynamicSellerHandler, {
  method: "GET",
  headers: { cookie: sessionCookie(secret), host: "example.test" },
  url: "/api/ebay-seller-listings?limit=1&seller=bad%7D%2Cprice%3A%5B0..1%5D"
});
assert.equal(response.statusCode, 400);
assert.match(response.body.message, /Invalid eBay seller/);

assert.equal(normalizeBaseUrl("https://example.com/"), "https://example.com");
assert.throws(() => normalizeBaseUrl(""), /API_BASE_URL/);
assert.deepEqual(optionalProtectionHeaders({
  VERCEL_AUTOMATION_BYPASS_SECRET: "bypass",
  API_TOKEN: "token"
}), {
  "x-vercel-protection-bypass": "bypass",
  authorization: "Bearer token"
});

const summary = validateListingsPayload(dcsportsPayload);
assert.equal(summary.listing_count, 1);
assert.equal(summary.seller, "dcsports87");
assert.throws(() => validateListingsPayload({
  ok: true,
  listings: [{
    seller: "other",
    item_id: "1",
    title: "x",
    item_web_url: "https://example.com",
    image_urls: ["https://example.com/a.jpg"]
  }]
}), /seller/);

console.log("deployed ebay API tests passed");
