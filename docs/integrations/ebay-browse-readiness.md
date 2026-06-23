# eBay Browse Readiness

Status: adapter and mock/contract tests exist; live credential smoke and 300-image marketplace candidate collection are not verified in this environment.

## Current Boundary

eBay is a marketplace reference provider only. It can help find candidate listings, image queues, seller wording, and market terminology, but it cannot establish ground truth for card identity.

Do not claim:

- eBay-verified recognition accuracy
- eBay title exact-match accuracy as commercial accuracy
- eBay 300-image evaluation pass without field-level owner labels
- automatic eBay listing creation

## Official API Path

The intended official path is the eBay Buy Browse API `GET /buy/browse/v1/item_summary/search`.

The API supports keyword, category, ePID, GTIN, filter, sort, limit, and offset parameters. The documented resource URI is:

`GET https://api.ebay.com/buy/browse/v1/item_summary/search`

Useful response fields for candidate collection:

- `itemSummaries.itemId`
- `itemSummaries.legacyItemId`
- `itemSummaries.title`
- `itemSummaries.image.imageUrl`
- `itemSummaries.thumbnailImages`
- `itemSummaries.itemWebUrl`
- `itemSummaries.categories`
- `itemSummaries.condition`
- `itemSummaries.price`

## OAuth Requirements

The adapter uses client credentials to mint an Application access token for read-only marketplace reference calls.

Required environment:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_MARKETPLACE_ID=EBAY_US`
- `EBAY_ENVIRONMENT=production` or `sandbox`
- `EBAY_OAUTH_SCOPE=https://api.ebay.com/oauth/api_scope`

Token endpoint:

- production: `POST https://api.ebay.com/identity/v1/oauth2/token`
- sandbox: `POST https://api.sandbox.ebay.com/identity/v1/oauth2/token`

Request requirements:

- `Content-Type: application/x-www-form-urlencoded`
- `Authorization: Basic <base64-client-id-client-secret>`
- body includes `grant_type=client_credentials` and URL-encoded scope

Browse requests require an `Authorization` header. `X-EBAY-C-MARKETPLACE-ID` is required for marketplaces outside the US and is still useful to keep explicit.

## Readiness Checklist

Before enabling eBay-backed collection in production-like runs:

- confirm an active eBay Developer Program account
- configure production Browse API keys in environment only, never in code
- run `npm run smoke:ebay` and retain a sanitized report
- run `npm run ebay:candidates -- --target 300` only with official API credentials
- verify candidate output has no duplicate item IDs
- verify every candidate image URL is from an allowed eBay image host
- label candidates into field-level ground truth before evaluating accuracy
- keep eBay titles as `MARKETPLACE` evidence in resolver or recognition traces
- enforce low evidence weight for marketplace text
- keep marketplace overreliance penalties active in identity resolution

## Rate Limit And Cache Policy

The OAuth endpoint has a daily token-minting limit, so the adapter should reuse application tokens in memory until expiry.

Browse responses should use bounded cache TTL and should be treated as unstable market snapshots. Cache entries cannot become approved card identity records without owner review.

## Failure Mode

If credentials, token minting, Browse request, or live smoke is missing:

- return provider status `unavailable`
- keep `MARKETPLACE_SEARCH_PROVIDER=ebay_browse` configured but inactive
- continue through internal registry, approved history, Brave, official sources, and Agnes paths
- do not block local unit tests
- do not degrade recognition truth by falling back to scraped marketplace pages

## Sources

- eBay Browse API search reference: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
- eBay OAuth authorization guide: https://developer.ebay.com/develop/guides-v2/authorization#the-client-credentials-grant-flow
