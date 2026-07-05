# Phase 6 Evidence Completion Orchestration

Date: 2026-06-22

## Scope

This phase adds the first Evidence Completion Orchestrator foundation. The goal is to stop treating an incomplete first recognition pass as an immediate terminal `LOW`, `FAILED`, or manual-only result. The new layer keeps a per-asset completion state, chooses the next evidence action, records trace entries, applies recovery budgets, and lightly integrates retrieval into the title API response.

## Added Modules

- `lib/listing/orchestration/completion-state.mjs`
- `lib/listing/orchestration/resolution-budget.mjs`
- `lib/listing/orchestration/completion-policy.mjs`
- `lib/listing/orchestration/candidate-verifier.mjs`
- `lib/listing/orchestration/next-best-action.mjs`
- `lib/listing/orchestration/resolution-trace.mjs`
- `lib/listing/orchestration/evidence-completion-orchestrator.mjs`

The orchestrator tracks:

- `verified_fields`
- `missing_fields`
- `weak_fields`
- `conflicting_fields`
- `candidate_cards`
- `attempted_actions`
- `next_best_action`
- `estimated_information_gain`
- `resolution_state`

## Action Policy

The supported action vocabulary follows the commercial spec:

- focused image actions: `CROP_AND_READ_SUBJECT`, `CROP_AND_READ_SERIAL`, `CROP_AND_READ_CARD_CODE`, `CROP_AND_READ_GRADE_LABEL`, `CROP_AND_READ_YEAR_PRODUCT`
- retrieval actions: `SEARCH_INTERNAL_APPROVED_HISTORY`, `SEARCH_INTERNAL_REGISTRY`, `SEARCH_EXACT_CHECKLIST_CODE`, `SEARCH_PLAYER_AND_COLLECTOR_NUMBER`, `SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR`, `SEARCH_OFFICIAL_SOURCES`, `SEARCH_BRAVE`, `SEARCH_EBAY`, `SEARCH_OWS_FALLBACK`
- verification and terminal actions: `VERIFY_CANDIDATE`, `LEGACY_PROVIDER_FOCUSED_RECHECK`, `REQUEST_TARGETED_RESCAN`, `ROUTE_TO_MANUAL`

GPT-4.1 emergency is intentionally not part of the normal completion action set. It remains only an explicit provider selection path.

## Current Execution Boundary

Retrieval actions execute through `runRetrieval()` and are filtered to the selected query family. The retrieval engine now accepts optional `allowedFamilies` and `maxQueries` parameters while keeping existing unfiltered behavior unchanged.

Focused crop/reread actions execute when the API supplies a primary-provider focused reread runner. The listing title API wires this for legacy vision provider only: the initial legacy vision provider pass receives primary front/back images, derived crop images are retained for completion, and focused actions call legacy vision provider with the matching crop or the bounded primary image fallback. The orchestrator only merges requested focus fields, records provider-call budget usage, and still emits planned or unavailable traces when no focused runner, readable image, or legacy vision provider budget is available.

Technical failures are separated from business non-standard routing. Missing credentials, disabled providers, and unregistered optional providers are recorded as unavailable and the orchestrator can continue through other configured paths. Actual retrieval or provider execution errors are captured in `resolution_trace` and `technical_failures`; if they prevent evidence closure and the asset is not already in targeted-rescan recovery, the final route is `FAILED_TECHNICAL` rather than `NON_STANDARD_MANUAL`.

For glare or other critical-region occlusion, targeted rescan is deliberately late in the sequence. The policy first tries the matching crop/reread action, then available retrieval constraints, then legacy vision provider focused recheck. `REQUEST_TARGETED_RESCAN` is selected only if those automated recovery paths cannot close the evidence gap, and once requested the final route remains `TARGETED_RESCAN_REQUIRED` rather than being downgraded to manual.

The orchestrator now verifies retrieval candidates before the next completion action is chosen. A selected non-market trusted source can fill missing fields, confirm matching weak fields, or mark conflicts when it disagrees with current resolved fields. Two independent trusted sources that agree can also close a missing or weak field even when no single selected candidate is available. Independent trusted disagreement marks the field `CONFLICT`. Low-margin candidate ties are preserved as ranking conflicts in retrieval and candidate-verification output, but do not mutate `resolved`. Marketplace and open-web candidates remain reference-only and are recorded in candidate-verification output without mutating `resolved`.

When completion changes `resolved` or `evidence`, the listing title API rerenders modules and the deterministic title so legacy `title` / `fields` compatibility reflects the verified state.

## API Response Additions

`api/listing-copilot-title.js` now appends:

- `route`
- `route_reason`
- `retrieval`
- `completion_state`
- `completion_trace`
- appended `resolution_trace`
- `technical_failures`
- normalized `usage.provider_calls`, `usage.retrieval_calls`, `usage.resolution_rounds`, and related budget usage
- updated `resolved`, `evidence`, `fields`, modules, and deterministic title when trusted retrieval closes gaps

Legacy fields remain available:

- `title`
- `fields`
- `confidence`
- `reason`
- `unresolved`

## Budget Defaults

The existing environment names are now consumed:

- `MAX_RESOLUTION_ROUNDS`
- `MAX_EXTERNAL_QUERIES`
- `MAX_LEGACY_PROVIDER_CALLS_PER_ASSET`
- `MAX_RETRIEVAL_TIME_MS`
- `MAX_RESOLUTION_TIME_MS`
- `MAX_RESOLUTION_COST_USD`

Budgets stop runaway loops. They are not used as a shortcut to reject an asset before applicable recovery paths have been considered.

## Tests

Added:

- `scripts/orchestration.test.mjs`

Coverage includes:

- incomplete first pass chooses retrieval instead of immediate manual routing
- no duplicate action selection after a no-information attempt
- critical serial occlusion chooses focused crop/read
- focused serial reread can execute through an injected legacy vision provider-compatible runner and merge `serial_number`
- unresolved critical occlusion tries retrieval constraints before targeted rescan
- targeted rescan remains the final route once requested
- budget exhaustion routes explicitly
- unavailable Brave retrieval is recorded
- retrieval execution errors are captured and route unresolved assets to `FAILED_TECHNICAL`
- GPT emergency is absent from completion traces and actions
- selected trusted candidates can fill missing fields
- two independent trusted candidates can close a missing field
- marketplace candidates stay reference-only
- trusted selected or independent conflicts mark evidence `CONFLICT`
- evidence that closes on the final budgeted round is not routed to manual merely because the budget is now exhausted
- API responses expose route, retrieval, completion trace, and appended resolution trace

## Known Gaps

- Focused legacy vision provider reread has mock coverage and API wiring, but live legacy vision provider behavior on derived crop images still depends on configured signed storage and real credential smoke validation.
- Candidate verification is conservative: independent closure requires two trusted non-market source keys that agree. Retrieval now follows discovery-provider official or trusted structured URLs through the Source Fetcher and extracts fields from explicit labels or exact resolved-value echoes. It still does not perform page-specific manufacturer checklist parsing or infer serial numbers from denominator-only references.
- Route policy is conservative and does not prove commercial AI-complete precision.
- eBay Browse has an OAuth-backed market-reference adapter, and OWS has a Responses API hosted web-search fallback adapter, but live credential validation for both is still environment-dependent.
- Supabase persistence for completion traces, analysis runs, reviews, and accepted-unchanged records is still Phase 7 work.
- No production accuracy claim is made.
