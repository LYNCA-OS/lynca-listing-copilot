# Phase 5 Retrieval Engine

Status: retrieval contracts, query planning, provider routing, source policy, memory/file cache, candidate matching, Brave adapter, bounded official-source follow-up, eBay Browse adapter, OWS fallback adapter, and first completion integration implemented
Date: 2026-06-22

## What Changed

This phase adds the first LYNCA Retrieval Engine foundation:

- `lib/listing/retrieval/retrieval-contract.mjs`
- `lib/listing/retrieval/retrieval-engine.mjs`
- `lib/listing/retrieval/retrieval-provider-registry.mjs`
- `lib/listing/retrieval/internal-memory-provider.mjs`
- `lib/listing/retrieval/internal-registry-provider.mjs`
- `lib/listing/retrieval/official-source-provider.mjs`
- `lib/listing/retrieval/official-source-field-extractor.mjs`
- `lib/listing/retrieval/brave-search-provider.mjs`
- `lib/listing/retrieval/ebay-browse-provider.mjs`
- `lib/listing/retrieval/openai-web-search-provider.mjs`
- `lib/listing/retrieval/query-planner.mjs`
- `lib/listing/retrieval/query-families.mjs`
- `lib/listing/retrieval/source-policy.mjs`
- `lib/listing/retrieval/source-fetcher.mjs`
- `lib/listing/retrieval/candidate-normalizer.mjs`
- `lib/listing/retrieval/candidate-matcher.mjs`
- `lib/listing/retrieval/retrieval-cache.mjs`
- `lib/listing/retrieval/retrieval-trace.mjs`
- `scripts/retrieval.test.mjs`

The retrieval layer is separate from Vision providers. legacy vision provider and GPT-4.1 do not choose search providers, do not access arbitrary web content, and do not decide source trust tiers.

## Provider Routing

Implemented routing boundaries:

- internal approved history is planned first
- internal registry is planned second
- Brave is the default external web discovery provider
- official-source provider can fetch a direct source URL through the Source Fetcher safety boundary
- eBay Browse is a marketplace reference provider backed by the official Browse API when OAuth credentials are configured
- OWS is only planned when configured as fallback and unresolved fields remain

The retrieval provider registry only exposes allowlisted provider IDs: internal memory, internal registry, official source, Brave, eBay Browse, and OpenAI web search. Unknown override providers are ignored, and known overrides are normalized back to their canonical provider ID. The internal approved-history provider uses explicit `approvedRecords` when supplied, and otherwise reads approved `listing_reviews` rows through Supabase REST when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured. It turns `corrected_resolved_fields` and `corrected_title` from approved outcomes into `INTERNAL_APPROVED_HISTORY` candidates. The OWS provider has a live adapter path through OpenAI Responses API hosted web search when `OPENAI_API_KEY` and `OPENAI_WEB_SEARCH_MODEL` are configured with an allowlisted model (`gpt-4.1-mini` or `gpt-4.1`). It stays separate from GPT-4.1 emergency vision, is only planned as fallback when enabled and unresolved fields remain, retries retryable Responses API failures with bounded exponential backoff, and records unavailable when disabled, unconfigured, or configured with a non-allowlisted model. eBay Browse supports client-credentials OAuth and Browse item summary search, retries retryable OAuth and Browse responses with bounded exponential backoff, but records unavailable when credentials or `fetch` are missing.

Brave has a live adapter path using `BRAVE_SEARCH_API_KEY`. It sends bounded `count` and optional `offset`, `freshness`, country, language, and extra-snippet parameters; applies a request timeout; maps 429, 401/403, 408, and 5xx responses to provider-specific errors; and supports bounded retry for retryable statuses. Discovery results from Brave, and later OWS, are inspected against Source Policy. Official or trusted structured URLs are followed through the official-source provider and Source Fetcher with `ENABLE_RETRIEVAL_OFFICIAL_FOLLOWUP` and `RETRIEVAL_OFFICIAL_FOLLOWUP_MAX`. Source Fetcher applies domain, redirect, content-type, byte-size, timeout, prompt-injection, and bounded retry controls for retryable 408, 429, 5xx, and timeout failures. Marketplace and open-web URLs are skipped by this follow-up path.

Fetched official/trusted pages now pass through a conservative field extractor before candidate normalization. It emits fields only when a value is explicitly labeled in the fetched text, or when an existing resolved value is echoed verbatim by the fetched source. It can extract labeled checklist code, collector number, full serial number, product identity, subject, grade labels, and explicit boolean attributes such as RC, Auto, Patch, Relic, SSP, Case Hit, Redemption, Sketch, 1st Bowman, and 1/1. It does not infer a serial numerator from denominator-only references such as `/50`.

## Query Planner

Query planning follows the required priority:

1. checklist code
2. collector number
3. player / character
4. year
5. product
6. serial denominator
7. grade label text
8. official card type text

The planner generates query families such as:

- `SEARCH_INTERNAL_APPROVED_HISTORY`
- `SEARCH_INTERNAL_REGISTRY`
- `SEARCH_EXACT_CHECKLIST_CODE`
- `SEARCH_PLAYER_AND_COLLECTOR_NUMBER`
- `SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR`
- `SEARCH_OFFICIAL_SOURCES`
- `SEARCH_BRAVE`
- `SEARCH_EBAY`
- `SEARCH_OWS_FALLBACK`

## Source Policy

External sources are classified through a configurable source policy:

- official domains
- trusted structured domains
- grading domains
- marketplace domains
- blocked domains
- source fetch size and timeout limits
- official-source follow-up enablement and max attempts

Source policy prevents blocked local domains such as `localhost` and `127.0.0.1`.

External content remains untrusted. Candidate normalization keeps title, excerpt, URL, domain, source type, trust tier, and fields as structured data. Source fetching is constrained to HTTP/HTTPS, validates redirects through source policy, rejects blocked domains and unsafe content types, enforces byte/text limits, strips executable markup, and masks prompt-injection language before returning bounded text. Fetched page bodies are not used as system prompts.

## Retrieval Cache

Retrieval uses a bounded TTL cache through `lib/listing/retrieval/retrieval-cache.mjs`.

The default backend is in-memory. Operators can opt into a JSON file-backed cache with:

- `RETRIEVAL_CACHE_BACKEND=file`
- `RETRIEVAL_CACHE_FILE=/writable/path/retrieval-cache.json` or the default `.cache/lynca/retrieval-cache.json`
- `RETRIEVAL_CACHE_TTL_MS=900000`
- `RETRIEVAL_CACHE_MAX_ENTRIES=500`

The file cache writes only normalized query results, source URLs, excerpts, and provider IDs; it does not persist API keys or Authorization headers. If the cache file is missing, expired, corrupt, or unwritable, retrieval continues with in-process cache behavior and providers still record normal trace entries.

## Candidate Matching

The first matcher scores candidates using:

- checklist code exact match
- collector number
- subject match
- year
- brand / manufacturer
- product / set
- card type / insert / parallel
- serial denominator compatibility
- grade label compatibility
- source trust tier

The engine records:

- `match_score`
- `matched_fields`
- `conflicting_fields`
- `candidate_margin`
- `selected_candidate`
- `low_margin_conflict`
- `retrieval.trace`

Low candidate margin prevents automatic selection and is recorded as `LOW_MARGIN_CANDIDATE_CONFLICT` with the top two candidate IDs, scores, threshold, and any differing candidate fields. Marketplace sources can appear as candidates, but they remain `MARKETPLACE` / market reference and do not establish ground truth.

## Current Limits

Implemented:

- retrieval provider contract
- query family planner
- internal registry provider
- internal approved-history provider backed by supplied records or Supabase `listing_reviews`
- official-source direct URL fetch provider
- official-source field extraction from explicit labels and resolved-value echoes
- automatic official/trusted structured URL follow-up from discovery providers
- Brave Search live adapter path
- eBay Browse OAuth and Browse API adapter
- OWS Responses API hosted web-search fallback adapter
- source policy classification and blocked domains
- source fetcher safety boundary
- bounded in-memory query cache
- optional JSON file-backed query cache
- candidate normalization
- candidate scoring and margin
- retrieval trace entries
- mock tests for routing, memory/file cache, source policy, matching, and unavailable providers
- mock tests for Supabase-backed approved-history retrieval

Still pending:

- deeper page-specific extraction for manufacturer-specific checklist layouts
- live eBay credential smoke validation in this environment
- Supabase-backed retrieval cache, if the file backend is insufficient for the production runtime

## Validation

Current validation commands:

```text
npm run check
npm test
node scripts/retrieval.test.mjs
npm run smoke:brave
npm run smoke:ebay
```

`npm run smoke:brave` skips when `BRAVE_SEARCH_API_KEY` is absent. It writes a sanitized capability report to `data/smoke/brave-smoke-latest.json` by default and does not output API keys, Authorization headers, source URLs, or full result payloads.

`npm run smoke:ebay` skips when `EBAY_CLIENT_ID` or `EBAY_CLIENT_SECRET` is absent. It writes a sanitized capability report to `data/smoke/ebay-smoke-latest.json` by default. When configured, it mints an application token with client credentials, calls the official Browse search endpoint, and returns only `MARKETPLACE` / `MARKET_REFERENCE` candidates.

`npm run smoke:ows` skips when `OPENAI_API_KEY` or `OPENAI_WEB_SEARCH_MODEL` is absent or when the model is not allowlisted. It writes a sanitized capability report to `data/smoke/ows-smoke-latest.json` by default. When configured, it calls the OpenAI Responses API with the hosted web-search tool and returns citation/source URL candidates only; retrieved source trust and any official follow-up remain handled by the Retrieval Engine.

Skipped reports are evidence that credentials or config were absent. They are not live provider validation and do not satisfy commercial readiness.
