# Listing Copilot

Internal LYNCA webtool for turning collectible card images into copy-paste-ready English eBay listing titles.

Listing Copilot is not an eBay auto-listing system and does not publish to eBay. It is an operator assistant: upload card images, generate title candidates, review confidence, and copy accepted titles into the listing workflow. When configured, it can call the eBay Browse API only as a read-only marketplace reference source.

## Product State

- Frontend: native HTML / CSS / JavaScript in `app/`
- Backend: Vercel API functions in `api/`
- Auth: simple internal login via environment variables
- AI pipeline: provider-routed vision/title generation using prompts in `prompts/`
- Knowledge support: local registry in `lib/listing-knowledge-registry.mjs`
- Tests: mock title audit, upload safety, and Golden Dataset validation scripts in `scripts/`
- Phase 0 commercial-evidence migration baseline: [docs/architecture/phase-0-audit-baseline-2026-06-22.md](docs/architecture/phase-0-audit-baseline-2026-06-22.md)
- Phase 1 provider routing note: [docs/architecture/phase-1-provider-routing-2026-06-22.md](docs/architecture/phase-1-provider-routing-2026-06-22.md)
- Phase 2 storage note: [docs/architecture/phase-2-storage-image-quality-2026-06-22.md](docs/architecture/phase-2-storage-image-quality-2026-06-22.md)
- Phase 3 evidence note: [docs/architecture/phase-3-evidence-architecture-2026-06-22.md](docs/architecture/phase-3-evidence-architecture-2026-06-22.md)
- Phase 4 renderer note: [docs/architecture/phase-4-renderer-writer-modules-2026-06-22.md](docs/architecture/phase-4-renderer-writer-modules-2026-06-22.md)
- Phase 5 retrieval note: [docs/architecture/phase-5-retrieval-engine-2026-06-22.md](docs/architecture/phase-5-retrieval-engine-2026-06-22.md)
- Phase 6 evidence completion note: [docs/architecture/phase-6-evidence-completion-2026-06-22.md](docs/architecture/phase-6-evidence-completion-2026-06-22.md)
- Phase 7 feedback note: [docs/architecture/phase-7-feedback-metrics-2026-06-22.md](docs/architecture/phase-7-feedback-metrics-2026-06-22.md)
- Phase 8 publishing note: [docs/architecture/phase-8-publishing-boundary-2026-06-22.md](docs/architecture/phase-8-publishing-boundary-2026-06-22.md)
- Phase 9 commercial readiness audit: [docs/architecture/phase-9-commercial-readiness-audit-2026-06-22.md](docs/architecture/phase-9-commercial-readiness-audit-2026-06-22.md)
- Phase 10 delivery report generator: [docs/architecture/phase-10-delivery-report-2026-06-22.md](docs/architecture/phase-10-delivery-report-2026-06-22.md)
- Phase 11 eBay image candidate collection: [docs/architecture/phase-11-ebay-image-candidate-collection-2026-06-22.md](docs/architecture/phase-11-ebay-image-candidate-collection-2026-06-22.md)
- Phase 12 public card image reference eval: [docs/architecture/phase-12-public-card-image-reference-eval-2026-06-22.md](docs/architecture/phase-12-public-card-image-reference-eval-2026-06-22.md)
- Phase 13 commercial title acceptance policy: [docs/architecture/phase-13-commercial-title-acceptance-policy-2026-06-23.md](docs/architecture/phase-13-commercial-title-acceptance-policy-2026-06-23.md)
- Phase 14 uploaded storage and memory gate: [docs/architecture/phase-14-uploaded-storage-memory-gate-2026-06-23.md](docs/architecture/phase-14-uploaded-storage-memory-gate-2026-06-23.md)

Current workflow:

1. Upload card images.
2. Choose Single Image or Front / Back Pair mode.
3. Generate English eBay-ready titles.
4. Review confidence: `HIGH`, `MEDIUM`, `LOW`, or `FAILED`.
5. Copy individual titles or the V1.2 Batch Generated Titles list.
6. Save an approved review before sending a dry-run draft to the mock B-end publishing adapter.

## Local Development

```bash
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

If no vision provider is configured and no default provider is forced, the app uses filename fallback so upload, pairing, and copy flows can still be tested locally.

Provider routing is intentionally single-model by default. GPT-4.1 mini is the production vision provider, and the listing recognition path has no secondary vision provider. The browser renders only server-whitelisted provider buttons and sends explicit provider metadata with each request. There is no automatic mixed-model cascade in the production path. Model IDs are allowlisted server-side: the OpenAI path accepts `gpt-4.1-mini-2025-04-14`, `gpt-4.1-mini`, or `gpt-4.1`.

When Supabase Storage is configured, the browser asks the server for signed upload URLs, sends MIME, byte size, dimensions, first-byte file signature metadata, and a client-side SHA-256 for validation, uploads original images to the private bucket, then asks the server to verify the stored object prefix before the object path is used in the title request. Successful verification returns a server-signed storage verification token scoped to that object path and metadata. The title API can create short-lived signed read URLs for provider calls, but it does not persist those signed URLs.

When Supabase REST storage is configured and migrated, successful image verification also upserts `listing_image_verifications` with object metadata and hash verification status. The title API still prefers the short-lived verification token, but it can use a matching durable verification record after token expiry for later reprocessing. It does not persist signed read URLs.

The default Supabase Storage migration is `supabase/migrations/20260622_listing_image_storage.sql`; it creates the private `listing-card-images` bucket with the supported image MIME family and a 25MB object limit. Use the matching rollback only after exporting or deleting any Storage objects that must be retained. Custom bucket names require adapting the migration to match `LISTING_IMAGE_BUCKET`.

Storage retention cleanup is available as a server-side script and a protected Vercel Cron API route. Set `LISTING_IMAGE_RETENTION_DAYS` and `CRON_SECRET`; `vercel.json` schedules `GET /api/listing-storage-retention-cleanup` daily at `0 9 * * *`, and the route only runs when the `Authorization` header contains the bearer value derived from `CRON_SECRET`. Manual operators can run `node scripts/storage-retention-cleanup.mjs` for a dry run; add `--apply` only when the listed expired `listing-assets/YYYY-MM-DD` objects should be deleted. The script and API route return sanitized summaries and do not print service keys, object-level delete lists, or Authorization headers.

The browser also sends a first-pass `capture_quality` report with blur, glare, crop, readability, resolution, and critical-region occlusion scores. When one view has a glare-occluded critical region but another view has that same region clear, the asset quality summary records `GLARE_RECOVERED`; unresolved critical occlusion still creates targeted crop images for later focused reread and targeted rescan. This is a conservative heuristic gate for routing and future targeted rescan work, not a claim of production-grade glare segmentation.

The title API now also returns an Evidence First compatibility layer: `evidence`, `resolved`, `model_title_suggestion`, and `evidence_schema_version`. It also returns deterministic renderer output: `modules`, `rendered_title`, `final_title`, `renderer_version`, and `title_length_policy`. Legacy `title`, `fields`, `confidence`, `reason`, and `unresolved` remain available while the resolver and feedback migration continue.

The first resolver bridge separates `card_number` into `serial_number`, `collector_number`, and `checklist_code`, and separates card grade from auto grade into `card_grade`, `auto_grade`, and `grade_type`.

Writer modules are editable through a server-side rerender endpoint. Module edits update corrected resolved fields, mark edited evidence as operator-confirmed, rerender modules, and refresh the deterministic title. Manual final-title edits are tracked separately as `title_override` in browser state and do not mutate resolved fields.

Commercial title acceptance is semantic rather than exact-string based. Non-standard wording, different ordering, omitted low-risk words, season shorthand, and subject last-name shorthand can pass when critical facts remain present and supported. Principle-level errors still fail: wrong subject name, wrong color or parallel, missing serial number, wrong grade, or model fields that conflict with reviewer-approved critical fields. Marketplace seller titles remain reference-only and cannot become acceptance ground truth.

The first Retrieval Engine layer now exists under `lib/listing/retrieval/`. It plans query families, reads Supabase-backed approved review history first when configured, routes internal registry second, uses Brave as the default external discovery provider, treats eBay Browse as a read-only marketplace reference provider, keeps OWS as a replaceable fallback provider, classifies source trust, follows Brave/OWS-discovered official or trusted structured URLs through a bounded HTTP/HTTPS-only safety layer, conservatively extracts explicit fields from fetched official/trusted text, normalizes candidates, scores candidate matches, records unavailable providers, and caches query results. Retrieval provider IDs are allowlisted server-side to internal memory, internal registry, official source, Brave, eBay Browse, and OpenAI web search; OWS model IDs are allowlisted to `gpt-4.1-mini` and `gpt-4.1`. The default cache is in-memory; an optional JSON file cache can persist bounded query results across process restarts when `RETRIEVAL_CACHE_BACKEND=file` is configured. Low-margin top-two retrieval ties are recorded as ranking conflicts instead of selecting a ground-truth candidate. Marketplace and open-web URLs are not fetched by the official-source follow-up path.

The first Evidence Completion Orchestrator now exists under `lib/listing/orchestration/` and is wired into the listing title API behind an explicit flag. It tracks missing, weak, and conflicting fields; chooses a next best action; runs selected retrieval query families through the retrieval engine; verifies selected or independently corroborated trusted retrieval candidates into field-level evidence; rerenders modules and deterministic titles when trusted evidence closes gaps; records unavailable providers; avoids duplicate no-information actions; and appends completion trace entries. Marketplace and open-web candidates remain reference-only and do not overwrite resolved fields.

Focused crop/reread execution remains conservative and is not part of the default single-model production path. The orchestrator can still emit planned focused-recovery traces and request targeted rescans when image evidence is blocked, but it does not automatically call a second vision model. eBay Browse now has an OAuth-backed live adapter path, but it remains market reference only and still needs real credential smoke validation. OWS now has a Responses API hosted web-search fallback path, but it still needs real credential smoke validation in this environment. Advanced image-quality recovery, review analytics dashboards, and real B-end publishing adapters are still pending. Their environment variables are listed so future phases have stable names.

The versioned feedback endpoint is present, but durable feedback retention is disabled by default. With `LISTING_FEEDBACK_RETENTION_ENABLED=false`, the endpoint validates the review payload and returns the computed outcome without writing `listing_assets`, `listing_analysis_runs`, `listing_reviews`, or legacy `listing_title_feedback` rows; this prevents agent tests and manual tests from becoming training data. When retention is explicitly enabled for commercial operation, it saves `ACCEPTED_UNCHANGED`, server-computed field diffs, title-only overrides, object paths and content hashes, provider/version metadata, traces, and review duration. A pending `TARGETED_RESCAN_REQUIRED` route is not treated as recovered; only a post-rescan resolved result with recovery evidence can save `TARGETED_RESCAN_RECOVERED`. Approved-memory retrieval is also disabled by default and requires `LISTING_APPROVED_MEMORY_ENABLED=true`.

The publishing boundary now exists under `lib/listing/publishing/` and `POST /api/listing-publish-draft`. It accepts only approved `ListingDraft` payloads, uses idempotency keys, writes publish audit jobs, supports bounded retry, and publishes only to a mock B-end adapter until real B-end API documentation exists. The frontend exposes this only after a retained review save returns a server-approved review id, operator id, and `approved_at`; skipped feedback-retention responses do not unlock mock publishing. It sends `dry_run: true` to the mock destination and never publishes raw AI output directly.

The API boundary now applies per-client rate limits to login, title generation, signed image upload/verification, provider status, module rendering, feedback saves, and publish requests. Buckets are keyed by a hash of the signed session cookie when present, otherwise by network headers, and 429 responses include bounded rate-limit headers without exposing identifiers or secrets.

## Environment Variables

Required for local and Vercel environments:

```text
METAVERSE_USERNAME=listing
METAVERSE_PASSWORD=change-me
METAVERSE_AUTH_SECRET=replace-with-a-long-random-secret
CRON_SECRET=replace-with-a-long-random-cron-secret
API_RATE_LIMIT_WINDOW_MS=60000
LISTING_LOGIN_RATE_LIMIT=20
LISTING_TITLE_RATE_LIMIT=30
LISTING_IMAGE_UPLOAD_RATE_LIMIT=120
LISTING_IMAGE_VERIFY_RATE_LIMIT=120
LISTING_PROVIDER_STATUS_RATE_LIMIT=180
LISTING_RENDER_TITLE_RATE_LIMIT=120
LISTING_FEEDBACK_RATE_LIMIT=120
LISTING_FEEDBACK_RETENTION_ENABLED=false
LISTING_APPROVED_MEMORY_ENABLED=false
LISTING_IDENTITY_CACHE_ENABLED=false
LISTING_IDENTITY_CACHE_READ_ENABLED=false
LISTING_IDENTITY_CACHE_WRITE_ENABLED=false
LISTING_IDENTITY_INFLIGHT_DEDUP_ENABLED=true
LISTING_PRE_PROVIDER_RESCAN_GATE_ENABLED=true
LISTING_PUBLISH_RATE_LIMIT=60
DEFAULT_VISION_PROVIDER=openai_legacy
ENABLE_GPT41_EMERGENCY_PROVIDER=true
SMOKE_PROVIDER_REPORT_PATH=
OPENAI_API_KEY=
OPENAI_LISTING_MODEL=gpt-4.1-mini-2025-04-14
OPENAI_LISTING_TIMEOUT_MS=75000
OPENAI_LISTING_MAX_OUTPUT_TOKENS=409600
OPENAI_LISTING_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS=819200
OPENAI_SMOKE_IMAGE_URL=
OPENAI_SMOKE_IMAGE_DATA_URL=
OPENAI_LISTING_INPUT_TOKEN_COST_PER_1M=
OPENAI_LISTING_OUTPUT_TOKEN_COST_PER_1M=
OPENAI_LISTING_IMAGE_COST_USD=
DEFAULT_WEB_SEARCH_PROVIDER=brave
FALLBACK_WEB_SEARCH_PROVIDER=openai_web_search
MARKETPLACE_SEARCH_PROVIDER=ebay_browse
RETRIEVAL_MODE=auto
RETRIEVAL_OFFICIAL_DOMAINS=
RETRIEVAL_TRUSTED_STRUCTURED_DOMAINS=
RETRIEVAL_GRADING_DOMAINS=
RETRIEVAL_MARKETPLACE_DOMAINS=
RETRIEVAL_BLOCKED_DOMAINS=
RETRIEVAL_SOURCE_MAX_BYTES=
RETRIEVAL_SOURCE_MAX_TEXT_CHARS=
RETRIEVAL_SOURCE_TIMEOUT_MS=
RETRIEVAL_SOURCE_MAX_RETRIES=
RETRIEVAL_SOURCE_RETRY_BASE_MS=
ENABLE_RETRIEVAL_OFFICIAL_FOLLOWUP=true
RETRIEVAL_OFFICIAL_FOLLOWUP_MAX=3
INTERNAL_APPROVED_HISTORY_LIMIT=100
RETRIEVAL_CACHE_BACKEND=memory
RETRIEVAL_CACHE_FILE=
RETRIEVAL_CACHE_TTL_MS=900000
RETRIEVAL_CACHE_MAX_ENTRIES=500
BRAVE_SEARCH_API_KEY=
BRAVE_SEARCH_TIMEOUT_MS=
BRAVE_SEARCH_MAX_RESULTS=10
BRAVE_SEARCH_EXTRA_SNIPPETS=true
BRAVE_SEARCH_FRESHNESS=
BRAVE_SEARCH_MAX_RETRIES=
BRAVE_SEARCH_RETRY_BASE_MS=
BRAVE_SEARCH_SMOKE_QUERY=
BRAVE_SMOKE_REPORT_PATH=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_ENVIRONMENT=production
EBAY_OAUTH_SCOPE=https://api.ebay.com/oauth/api_scope
EBAY_OAUTH_URL=
EBAY_BROWSE_BASE_URL=
EBAY_BROWSE_TIMEOUT_MS=
EBAY_BROWSE_MAX_RESULTS=
EBAY_BROWSE_MAX_RETRIES=
EBAY_BROWSE_RETRY_BASE_MS=
EBAY_BROWSE_FILTER=
EBAY_BROWSE_SORT=
EBAY_BROWSE_SMOKE_QUERY=
EBAY_SMOKE_REPORT_PATH=
EBAY_IMAGE_CANDIDATES_OUT=
EBAY_IMAGE_CANDIDATE_TARGET=300
EBAY_IMAGE_CANDIDATE_QUERY_LIMIT=50
EBAY_IMAGE_CANDIDATE_MAX_PAGES=3
EBAY_IMAGE_CANDIDATE_QUERIES=
EBAY_ACCEPT_LANGUAGE=
ENABLE_OPENAI_WEB_SEARCH_FALLBACK=true
OPENAI_WEB_SEARCH_BASE_URL=
OPENAI_WEB_SEARCH_MODEL=
OPENAI_WEB_SEARCH_ALLOWED_DOMAINS=
OPENAI_WEB_SEARCH_TIMEOUT_MS=
OPENAI_WEB_SEARCH_MAX_RESULTS=
OPENAI_WEB_SEARCH_MAX_RETRIES=
OPENAI_WEB_SEARCH_RETRY_BASE_MS=
OPENAI_WEB_SEARCH_CONTEXT_SIZE=
OPENAI_WEB_SEARCH_SMOKE_QUERY=
OWS_SMOKE_REPORT_PATH=
PUBLIC_CARD_IMAGE_CANDIDATES_OUT=
PUBLIC_CARD_IMAGE_CANDIDATE_TARGET=300
PUBLIC_CARD_IMAGE_CANDIDATE_PAGE_SIZE=250
PUBLIC_CARD_IMAGE_CANDIDATE_MAX_PAGES=10
PUBLIC_CARD_IMAGE_CANDIDATE_QUERY=supertype:Pokémon
PUBLIC_CARD_IMAGE_CANDIDATE_ORDER_BY=-set.releaseDate,number
POKEMON_TCG_API_BASE_URL=https://api.pokemontcg.io/v2
POKEMON_TCG_API_KEY=
PUBLIC_CARD_IMAGE_CANDIDATES_PATH=
REAL_PHOTO_CARD_PILOT_DATASET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LISTING_IMAGE_BUCKET=listing-card-images
LISTING_IMAGE_SIGNED_URL_TTL_SECONDS=600
LISTING_IMAGE_MAX_UPLOAD_BYTES=262144000
LISTING_IMAGE_MAX_DIMENSION_PIXELS=12000
LISTING_IMAGE_MAX_TOTAL_PIXELS=500000000
LISTING_IMAGE_VERIFICATION_SECRET=
LISTING_IMAGE_VERIFICATION_TOKEN_TTL_SECONDS=7200
LISTING_IMAGE_RETENTION_DAYS=
LISTING_IMAGE_RETENTION_LIST_PAGE_SIZE=
LISTING_IMAGE_RETENTION_DELETE_BATCH_SIZE=
MAX_RESOLUTION_ROUNDS=
MAX_EXTERNAL_QUERIES=
MAX_RETRIEVAL_TIME_MS=
MAX_RESOLUTION_TIME_MS=
MAX_RESOLUTION_COST_USD=
PUBLISH_MAX_ATTEMPTS=2
```

V2.0 Memory Layer uses server-side Supabase access only. `SUPABASE_SERVICE_ROLE_KEY` must stay server-side in Vercel/API environments and must not be exposed to browser code.

Rate-limit defaults can be overridden globally with `API_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`, or per scope with `API_RATE_LIMIT_<SCOPE>_MAX` / `API_RATE_LIMIT_<SCOPE>_WINDOW_MS`. The `LISTING_*_RATE_LIMIT` names shown above are stable deployment shortcuts for the current listing endpoints.

Provider responses normalize token usage, image counts, provider-call counts, and latency into the API `usage` object. `estimated_cost_usd` remains `0` unless the relevant per-million token or per-image cost variables are configured.

The memory write path is implemented but gated. In the current non-commercial phase, the feedback endpoint can accept and validate review payloads without persisting memory rows. Commercial memory writes require `LISTING_FEEDBACK_RETENTION_ENABLED=true`.

The feedback endpoint requires the existing signed internal session and derives `operator_id` from that session before writing review rows. Requests without a valid session are rejected before any Supabase write.

Feedback saves do not persist by default. Set `LISTING_FEEDBACK_RETENTION_ENABLED=true` only when commercial data retention is approved; unchanged accepted reviews then persist as `ACCEPTED_UNCHANGED` rows in `listing_reviews`, and changed-title saves also write the legacy `listing_title_feedback` table for compatibility. Set `LISTING_APPROVED_MEMORY_ENABLED=true` only when approved commercial history should participate in retrieval reuse.

## V2.0 Memory Layer Manual Test

To verify one Supabase memory row after commercial feedback retention is approved:

1. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. Set `LISTING_FEEDBACK_RETENTION_ENABLED=true`; leave it unset or `false` during agent tests and manual non-commercial tests.
3. Confirm Supabase has the Phase 7 feedback tables and the legacy `listing_title_feedback` table.
4. Start the app and log in with the internal Listing Copilot credentials.
5. Upload one front image, or a front/back pair.
6. Generate a title.
7. Edit the title text.
8. Click the per-result Save button.
9. Confirm one new review row exists with generated and corrected resolved fields, safe object paths, content hashes when available, operator id, and timestamp.
10. Repeat Save without changing the title and confirm a `listing_reviews.review_outcome = ACCEPTED_UNCHANGED` row is created. Changed-title saves should also continue to create the legacy `listing_title_feedback` row.
11. After a retained saved review with a non-null `approved_at`, click the per-result Mock publish button and confirm a `listing_publish_jobs` audit row is created for destination `mock_b_end`. Reviews saved as rejected, pending targeted rescan, or skipped because retention is disabled must not expose a publish action.

## Validation

Run the full check suite:

```bash
npm run check
```

Run the default local tests:

```bash
npm test
```

Validate the Golden Dataset development fixture and metric report:

```bash
npm run eval:golden
```

The default dataset contains development-only metric fixtures. The held-out commercial split is intentionally empty, so `eval:golden` must keep warning that the report is not commercial acceptance evidence. The JSON report now separates legacy all-split diagnostics from true commercial evidence:

- `all_configured_splits_evidence` keeps development/calibration/held-out diagnostics together for regression tracking.
- `held_out_commercial_evidence` is the only metric scope intended for commercial acceptance claims.
- `commercial_acceptance_gate` fails unless held-out commercial assets exist, all held-out predictions are present, the configured strata are covered, and the acceptance thresholds are met.

Build a commercial held-out dataset from real approved review exports:

```bash
npm run commercial:heldout -- --source exports/commercial-reviews.json --out data/golden-dataset.commercial.json --replace
npm run eval:golden -- --dataset data/golden-dataset.commercial.json
```

`supabase/queries/export_commercial_heldout_reviews.sql` is a read-only template for producing the source JSON from approved `listing_reviews` rows. The source export may be an array, or an object with `rows`, `reviews`, `items`, or `data`. Each row should include asset, analysis, and review sections with safe Supabase object paths, generated resolved fields, corrected resolved fields, and explicit final-title quality booleans. The builder stores generated fields under `prediction.resolved_fields` and corrected reviewer fields under `ground_truth_fields`, so model mistakes remain visible instead of being hidden by the final approved title. By default, rejected rows or duplicate assets make the command fail before writing the output; use `--allow-rejections` only after reviewing the printed rejection reasons.

Collect 300 eBay Browse image candidates for a future held-out review queue:

```bash
npm run ebay:candidates -- --target 300 --out data/ebay-candidates/ebay-image-candidates-latest.json
```

This uses the official eBay Browse API and requires `EBAY_CLIENT_ID` plus `EBAY_CLIENT_SECRET`. It does not scrape eBay pages. The output is an unlabeled candidate queue with `ground_truth_status: "unlabeled"` and `accuracy_eval_eligible: false`; seller titles are market-reference text only and must not be used as ground truth. Accuracy can be computed only after operator or official-source labeling converts those candidates into approved held-out rows.

Collect 300 public card image candidates from the Pokémon TCG API:

```bash
npm run public:cards -- --target 300 --out data/public-card-candidates/public-card-image-candidates-latest.json
```

This path collects only card records with `category = "pokemon_card"` and HTTPS card image URLs. It creates an unlabeled candidate queue; it is not commercial acceptance evidence and does not run a provider evaluation by default.

Run the commercial readiness audit:

```bash
npm run readiness:audit
```

The default result is expected to exit non-zero until real commercial evidence exists. The audit reports `held_out_commercial_assets`, `commercial_acceptance_gate`, provider default policy, mock-only publishing status, and external retrieval live-smoke evidence. GPT-4.1 mini is the default and only automatic listing vision provider.

The commercial evaluator uses `lib/listing/evaluation/title-acceptance-policy.mjs` for `final_title_required_fields` and `final_title_unsubstantiated_fields`. This lets held-out commercial rows accept non-standard but factually correct titles while still failing wrong names, wrong color/parallel, missing serials, wrong grades, and conflicting critical fields.

Write a machine-readable report when handing off gate status:

```bash
npm run readiness:audit -- --report data/commercial-readiness-latest.json
```

Generate the 28-section final-delivery report required by the commercial migration spec:

```bash
npm run delivery:report
npm run delivery:report -- --out docs/reports/listing-copilot-delivery-report.md
```

The delivery report reads current readiness, eval, smoke, migration, and architecture evidence. It does not execute tests and does not claim commercial readiness while the held-out split, B-end adapter, or live retrieval smoke evidence remain blocked.

The eval output includes provider, category, and difficulty breakdowns with exact asset coverage and rate. These breakdowns are diagnostic only and do not replace the overall denominator.

The eval output also includes Wilson 95% confidence intervals for representative headline metrics, including final approved publish accuracy. Confidence intervals are required for a future commercial acceptance report, but they still do not permit a claim while the held-out commercial split is empty.

When metrics miss target thresholds, the eval output includes `failure_root_causes` and `field_error_distribution` so failed assets and recurring field errors remain visible instead of being hidden behind aggregate accuracy.

The eval output also includes `final_approved_publish_accuracy`, `glare_impact`, `retrieval_provider_gains`, and `vision_provider_comparison`. These are diagnostics for final approved rows, glare samples, Brave recovery, eBay market-reference help, OWS fallback contribution, and provider-path differences; they do not replace the overall commercial denominator.

Provider smoke commands exist but do not claim real validation when credentials, model config, or smoke inputs are missing. Smoke commands write sanitized capability reports by default under `data/smoke/`; pass `--report <path>` or set `SMOKE_PROVIDER_REPORT_PATH` to override the path. Reports do not include API keys, Authorization headers, image URLs, or Base64 payloads. OpenAI listing smoke requires `OPENAI_API_KEY` plus `OPENAI_SMOKE_IMAGE_URL` or `OPENAI_SMOKE_IMAGE_DATA_URL`; Brave smoke requires `BRAVE_SEARCH_API_KEY`; eBay Browse requires `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`; OWS requires `OPENAI_API_KEY` and `OPENAI_WEB_SEARCH_MODEL`. Missing retrieval credentials produce a `skipped` report, not a pass.

`/api/listing-provider-status` returns only sanitized GPT provider metadata and storage readiness. It does not expose API keys, Authorization headers, image URLs, or arbitrary provider error text.

```bash
npm run smoke:openai
npm run smoke:brave
npm run smoke:ebay
npm run smoke:ows
```

Default smoke report paths:

- `data/smoke/openai-smoke-latest.json`
- `data/smoke/brave-smoke-latest.json`
- `data/smoke/ebay-smoke-latest.json`
- `data/smoke/ows-smoke-latest.json`

Useful direct commands:

```bash
node --check api/listing-copilot-title.js
node --check scripts/listing-confidence-audit.test.mjs
node scripts/listing-confidence-audit.test.mjs
node scripts/upload-safety-layer.test.mjs
node scripts/eval-golden.mjs
node scripts/evaluation-metrics.test.mjs
node scripts/commercial-heldout-builder.test.mjs
node scripts/commercial-readiness-audit.test.mjs
node scripts/build-delivery-report.test.mjs
node scripts/evidence-schema.test.mjs
node scripts/resolver.test.mjs
node scripts/renderer.test.mjs
node scripts/writer-module-edit.test.mjs
node scripts/retrieval.test.mjs
node scripts/orchestration.test.mjs
node scripts/feedback-review.test.mjs
node scripts/publishing.test.mjs
node scripts/provider-routing.test.mjs
node scripts/provider-response-normalizer.test.mjs
node scripts/provider-usage.test.mjs
node scripts/provider-status.test.mjs
node scripts/provider-ui.test.mjs
node scripts/smoke-provider.test.mjs
node scripts/storage-signed-url.test.mjs
node scripts/storage-migration.test.mjs
node scripts/storage-verification-record.test.mjs
node scripts/storage-retention.test.mjs
node scripts/storage-retention-api.test.mjs
node scripts/image-quality-gate.test.mjs
node scripts/image-crop-planner.test.mjs
```

## Documentation

Start with:

- [docs/README.md](docs/README.md) — documentation index
- [docs/foundation/foundation-v1.md](docs/foundation/foundation-v1.md) — foundation overview
- [docs/standards/sports-card-title-standard-v1.md](docs/standards/sports-card-title-standard-v1.md) — sports card title source-of-truth
- [docs/architecture/architecture-decisions-v1.md](docs/architecture/architecture-decisions-v1.md) — approved V1.x architecture decisions
- [docs/architecture/phase-1-provider-routing-2026-06-22.md](docs/architecture/phase-1-provider-routing-2026-06-22.md) — historical provider-routing boundary, not the current single-model production path
- [docs/architecture/phase-2-storage-image-quality-2026-06-22.md](docs/architecture/phase-2-storage-image-quality-2026-06-22.md) — Supabase Storage signed URL path and image-quality gaps
- [docs/architecture/phase-3-evidence-architecture-2026-06-22.md](docs/architecture/phase-3-evidence-architecture-2026-06-22.md) — EvidenceField and ResolvedFields compatibility bridge
- [docs/architecture/phase-4-renderer-writer-modules-2026-06-22.md](docs/architecture/phase-4-renderer-writer-modules-2026-06-22.md) — deterministic renderer, editable writer modules, and title override boundary
- [docs/architecture/phase-5-retrieval-engine-2026-06-22.md](docs/architecture/phase-5-retrieval-engine-2026-06-22.md) — Retrieval Engine contracts, query planning, provider routing, source policy, cache, and candidate matching
- [docs/architecture/phase-11-ebay-image-candidate-collection-2026-06-22.md](docs/architecture/phase-11-ebay-image-candidate-collection-2026-06-22.md) — official eBay Browse image candidate queue and ground-truth boundary
- [docs/architecture/phase-12-public-card-image-reference-eval-2026-06-22.md](docs/architecture/phase-12-public-card-image-reference-eval-2026-06-22.md) — historical public 300-card image reference eval
- [docs/architecture/phase-13-commercial-title-acceptance-policy-2026-06-23.md](docs/architecture/phase-13-commercial-title-acceptance-policy-2026-06-23.md) — semantic commercial title acceptance policy
- [docs/roadmap/listing-copilot-roadmap-v1.md](docs/roadmap/listing-copilot-roadmap-v1.md) — phased implementation roadmap
- [docs/foundation/spec-v1.md](docs/foundation/spec-v1.md) — original MVP product spec

Training and calibration docs are organized under `docs/training/`; older notes live in `docs/archive/training-legacy/`.

## Prompt Files

OpenAI title generation loads prompt files at runtime:

```text
prompts/listing-intelligence-v1.md
prompts/examples/
```

Prompt edits can change generation behavior without frontend changes, so validate with `node scripts/listing-confidence-audit.test.mjs` after any prompt or title-standard change.

## Deployment

This repo should remain an independent Vercel project.

```text
Production domain: listing.lyncafei.team
Root Directory: ./
```

Configure the same environment variables listed above in Vercel.
