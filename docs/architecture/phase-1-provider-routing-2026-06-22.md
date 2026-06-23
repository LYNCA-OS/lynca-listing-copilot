# Phase 1 Provider Routing

Status: provider transition UI and backend implemented; live Agnes depends on configured Storage and credentials
Date: 2026-06-22

## What Changed

Phase 1 adds a provider boundary around the legacy title API:

- `lib/listing/providers/provider-contract.mjs`
- `lib/listing/providers/provider-registry.mjs`
- `lib/listing/providers/provider-errors.mjs`
- `lib/listing/providers/provider-response-normalizer.mjs`
- `lib/listing/providers/provider-usage.mjs`
- `lib/listing/providers/agnes-provider.mjs`
- `lib/listing/providers/openai-emergency-provider.mjs`
- `scripts/provider-routing.test.mjs`
- `scripts/agnes-provider-errors.test.mjs`
- `scripts/provider-usage.test.mjs`
- `scripts/smoke-provider.test.mjs`

`api/listing-copilot-title.js` now selects a provider, calls the provider adapter, then passes the parsed provider JSON through the existing title cleanup and confidence audit logic.

The browser now loads `/api/listing-provider-status` and renders server-whitelisted provider controls:

- `Agnes · 默认`
- `GPT-4.1 · 应急`

The selected provider is sent with each asset request. GPT-4.1 requests are marked with `explicitEmergency`, and failed assets can expose a per-asset GPT-4.1 emergency retry button when the server reports that provider as selectable.

## Provider Policy

- Agnes is the intended primary provider.
- GPT-4.1 is the legacy emergency provider.
- Agnes is the default selected provider button when it is selectable.
- GPT-4.1 is exposed as an emergency provider button when enabled, but it is not selected by default.
- A request for `openai_legacy` must include an explicit emergency flag.
- Agnes image inputs must be HTTP(S) URLs. Base64 data URLs are rejected instead of silently falling through to GPT.
- Missing Agnes credentials, unavailable Agnes storage, invalid Agnes inputs, or an env-selected OpenAI default do not make GPT-4.1 the implicit default.
- Existing local fallback remains only when no provider key is configured and the request does not explicitly choose a provider.
- Provider availability is determined server-side. The browser does not expose arbitrary endpoint or model ID inputs.
- `ENABLE_GPT41_EMERGENCY_PROVIDER=false` hides GPT-4.1 from the ordinary UI. `ALLOW_EXPLICIT_GPT41_RETRY=false` keeps the provider visible only as unavailable when it is otherwise enabled and configured.
- Model IDs are allowlisted server-side. Agnes accepts `agnes-2.0-flash`; the OpenAI emergency path accepts `gpt-4.1-mini` or `gpt-4.1`. Invalid model env values mark the provider unavailable and direct adapter calls fail before fetch.
- Agnes is marked unavailable to the browser when Supabase image storage readiness is missing.
- Provider adapter usage is normalized into provider-call count, token counts, image count, latency, and optional `estimated_cost_usd`. Cost estimates remain zero until per-million token or per-image cost variables are configured.

## Agnes Contract Verified

Official Agnes docs were checked before implementation:

- Quick start: `https://agnes-ai.com/doc/quick-start`
- Agnes 2.0 Flash: `https://agnes-ai.com/doc/agnes-20-flash`

Relevant confirmed contract:

- Chat Completions endpoint: `https://apihub.agnes-ai.com/v1/chat/completions`
- Uses the standard bearer `Authorization` header with the server-side Agnes key.
- Request body supports `model`, `messages`, `temperature`, `top_p`, `max_tokens`, `stream`, `tools`, and `tool_choice`.
- Image understanding uses `messages[].content[]` blocks with `type: "image_url"`.
- Image URLs must be accessible to the model. Login-protected, hotlink-blocked, or private URLs can fail.
- Malformed JSON content or `submit_card_evidence` tool-call arguments are treated as response-format failures. Agnes gets one repair retry with stricter JSON-only instructions; a second malformed response fails with a provider error.
- Schema-invalid JSON is not retried as a format issue. It fails fast so invalid evidence cannot flow into Resolver.
- Provider response runtime validation now checks the documented `ProviderEvidenceResponse` contract before compatibility conversion, including legacy fields, unresolved arrays, EvidenceField maps, provider shorthand evidence, partial resolved fields, and image-quality report shape.
- Mock coverage now exercises single-image and multi-image request shape, controlled `submit_card_evidence` tool calls, empty and non-JSON responses, 400/401/403/408/429/5xx status mapping, retryable 429 recovery, timeout handling, unreadable-image 400 handling, and normalized provider-call accounting.
- The Agnes smoke command now emits a sanitized capability report. With `AGNES_API_KEY` and `AGNES_SMOKE_IMAGE_URL`, it checks single-image JSON and tool-call paths. `AGNES_SMOKE_BACK_IMAGE_URL` enables front/back multi-image capability reporting; `AGNES_SMOKE_ERROR_IMAGE_URL` enables provider-error capability reporting. Missing optional inputs are reported as skipped, not as live validation. Tool-call, multi-image, and error-response checks are recorded as capabilities and only fail the smoke command when the corresponding `AGNES_SMOKE_REQUIRE_*` flag is true. JSON text remains a required fallback path even when tool-call smoke passes. `--report <path>`, `SMOKE_PROVIDER_REPORT_PATH`, or `AGNES_SMOKE_REPORT_PATH` writes the same capability report as sanitized JSON without API keys, Authorization headers, image URLs, or Base64 payloads.
- Current live Agnes smoke result: `passed` on 2026-06-22T12:27:58.668Z. Single-image JSON, front/back multi-image JSON, controlled tool-call output, and provider error response checks passed with `agnes-2.0-flash`.
- `/api/listing-provider-status` reads the Agnes smoke report when present and returns only sanitized smoke capability fields for Agnes. This lets the UI or operators distinguish "configured" from "actually smoke-verified" without exposing report paths, secrets, image URLs, or raw provider error text.
- The provider segmented control renders the sanitized Agnes smoke summary alongside the model status. A selectable Agnes provider therefore still shows whether JSON baseline, multi-image, tool-call, and error-response paths have been live verified.

## Still Pending

The frontend now has a storage upload path, but Agnes still cannot be called live unless Supabase Storage, `AGNES_API_KEY`, and a real private bucket are configured and verified.

Still not implemented:

- real Supabase bucket migration/policy verification
- capture quality, glare, crop, and targeted rescan checks
- EvidenceField schema and source-backed field provenance
- resolver and deterministic renderer
- Brave Search, eBay Browse, and OpenAI Web Search fallback adapters
- shadow compare, provider audit table, and production observability
- live provider pricing calibration for cost estimates

## Validation

Current validation commands:

```text
npm run check
npm test
npm run smoke:agnes
npm run smoke:openai
npm run smoke:brave
npm run smoke:ebay
npm run smoke:ows
```

In an environment without provider credentials or smoke image URLs, smoke commands must skip cleanly. A skipped smoke is not a live provider validation.
