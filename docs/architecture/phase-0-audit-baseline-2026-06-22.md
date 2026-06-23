# Phase 0 Audit And Baseline

Status: Phase 0 complete
Date: 2026-06-22
Repo: `LYNCA-OS/lynca-listing-copilot`
Baseline commit: `739d9ec5c085a33dacca0096f0549b7ad8c1c76b`

## Scope Reviewed

Required source areas were reviewed before code changes:

- `README.md`
- `package.json`
- `app/`
- `api/`
- `lib/`
- `prompts/`
- `scripts/`
- `docs/foundation/`
- `docs/standards/`
- `docs/architecture/`
- `docs/roadmap/`
- `docs/training/`
- current Supabase feedback implementation in `api/listing-title-feedback.js` and `lib/supabase-feedback.mjs`
- current tests in `scripts/listing-confidence-audit.test.mjs` and `scripts/upload-safety-layer.test.mjs`

`docs/v2/` was also reviewed because it documents the existing Supabase feedback and image-evidence plans.

## Baseline Commands

Before modifying source files:

```text
npm run check
```

Result:

```text
listing confidence audit mock tests passed
upload safety layer tests passed
```

Exit code: `0`

```text
npm test
```

Result before Phase 0 script addition:

```text
npm error Missing script: "test"
```

Exit code: `1`

## Current Architecture Summary

The current app is a native HTML/CSS/JavaScript Vercel application.

Current title flow:

```text
Browser image compression
  -> base64 data URL request
  -> api/listing-copilot-title.js
  -> OpenAI Responses API or filename fallback
  -> model returns title + fields
  -> backend regex/registry cleanup
  -> confidence calibration
  -> editable title textarea
  -> optional changed-title feedback save
```

The current production path is still patch-based. `api/listing-copilot-title.js` owns provider calls, prompt loading, schema normalization, semantic repairs, title cleanup, confidence calibration, fallback handling, and API response formatting.

## Baseline Behavior To Preserve

Existing tests protect these behaviors:

- upload order and front/back pairing order are preserved
- image payloads are compressed before API calls
- background branding is stripped from titles and fields
- serial numbers are preserved and normalized
- checklist codes are suppressed from final titles after resolution
- high-value insert and official card-type names are protected
- RC markers are normalized and preserved
- PSA/BGS card grade and auto grade wording is normalized
- product names such as `Topps Cosmic Chrome` are protected
- visual-only parallel guesses cannot remain `HIGH`

## Phase 0 Gaps And Risks

Commercial architecture gaps:

- Agnes is not implemented and is not the default provider.
- GPT-4.1 legacy remains the only real configured model path when `OPENAI_API_KEY` exists.
- The UI has no provider selector and no explicit GPT emergency retry.
- There is no provider registry, provider contract, model whitelist, or provider metadata trace.
- Images are still sent as browser-compressed base64 data URLs, not private object storage signed URLs.
- There is no capture profile, image quality gate, glare detection, crop workflow, or targeted rescan route.
- There is no EvidenceField schema, runtime validation, resolved-field model, or field provenance.
- `card_number` still mixes checklist code and collector number in the legacy schema.
- Final title is still model-title-first plus cleanup, not deterministic rendering from resolved fields.
- Retrieval is not implemented. There is no LYNCA Retrieval Engine, Brave adapter, eBay Browse adapter, OWS fallback adapter, source policy, cache, or candidate matcher.
- Feedback currently stores only generated/corrected titles in the legacy `listing_title_feedback` table.
- Unchanged titles are skipped, but the commercial target requires `ACCEPTED_UNCHANGED` positive samples.
- There is no versioned analysis run/review/publish table structure.
- There is no B-end publisher contract or approval gate.
- There was no Golden Dataset schema or eval runner before Phase 0.

Security and stability risks:

- API keys are server-side, but provider/model selection is not yet controlled by a dedicated whitelist.
- `api/listing-copilot-title.js` can return provider error text in `reason`; future provider adapters must avoid leaking headers, keys, signed URLs, or full upstream payloads.
- The current fallback result is useful for local development but must not be confused with a production model result.
- Supabase Service Role usage is server-side only, but image storage and signed URL handling are not implemented.

## Phase 0 Additions

Phase 0 adds evaluation scaffolding without changing runtime listing generation:

- `data/golden-dataset.schema.json`
- `data/golden-dataset.json`
- `lib/listing/evaluation/golden-dataset.mjs`
- `scripts/eval-golden.mjs`
- `scripts/smoke-provider.mjs`

The default dataset now contains a small development-only fixture set that exercises metric math and denominator handling. It is not a held-out commercial benchmark. Calibration and held-out commercial splits still require real sampled assets before any accuracy claim is possible.

The evaluator keeps all assets in the denominator. Assets without predictions do not disappear from overall commercial metrics.

## Unverified Real API Areas

No real paid-provider smoke test was performed in Phase 0.

Not yet verified:

- Agnes Chat Completions behavior
- Agnes image URL support
- Agnes JSON/tool-call structured output stability
- Brave Search API
- eBay Browse OAuth and search
- OpenAI Web Search fallback
- Supabase Storage signed upload/read URL flow

Smoke scripts are present but skip unless credentials and implemented adapters are available. A skipped smoke is not a successful real API validation.

## Next Phase Entry Criteria

Phase 1 should start with a provider contract and registry:

- `lib/listing/providers/provider-contract.mjs`
- `lib/listing/providers/provider-registry.mjs`
- `lib/listing/providers/agnes-provider.mjs`
- `lib/listing/providers/openai-emergency-provider.mjs`
- mock tests for provider routing and no silent GPT fallback

The legacy OpenAI path should remain as a compatibility layer while Agnes is introduced as the default provider.
