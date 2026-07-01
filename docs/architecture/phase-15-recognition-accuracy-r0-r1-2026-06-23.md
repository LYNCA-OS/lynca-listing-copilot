# Phase 15 - Recognition Accuracy R0/R1

Status: R0/R1 infrastructure implemented; real accuracy claims remain blocked until owner-reviewed ground truth is populated.

## Scope

This phase adds the Recognition Accuracy Program foundation without replacing legacy vision provider, retrieval, renderer, writer modules, storage, or the identity resolver.

Implemented boundaries:

- field-level recognition dataset schema and local tooling
- recognition evaluation metrics and ablation runner
- independent Python Recognition Worker contract skeleton
- Node client, feature flags, request/response validation, and safe unavailable behavior
- eBay and public-image evidence remains candidate/reference only, never ground truth
- no model calls in unit tests
- no upload or retention of manual test feedback for training

## R0 Audit

Existing implementation before this phase already included:

- legacy vision provider as the default vision provider, with GPT-4.1 emergency retry gated behind explicit controls
- provider status, usage accounting, smoke-provider contract tests, and response normalization
- Supabase image upload, signed read URLs, retention cleanup, and storage verification records
- evidence schema, resolver modules, deterministic renderer modules, and writer module edit surfaces
- retrieval engine contracts and adapters for internal history, registry, Brave, eBay Browse, and OpenAI Web Search fallback
- commercial readiness audit, delivery report, public 300-card image collection, real-photo pilot, and title acceptance policy
- Identity Resolution System under `lib/identity-resolution/`

Still mock, unavailable, or prompt-dependent:

- eBay Browse live credential smoke is not verified in this environment
- eBay 300-image candidate queue is not ground truth until reviewed field labels exist
- held-out commercial split is empty, so commercial accuracy gates must stay blocked
- recognition worker OCR, embeddings, candidate verification, and geometric checks are explicit placeholders
- PaddleOCR and Unlimited-OCR are not enabled by default
- Supabase feedback rows can be exported as `NEEDS_REVIEW` candidates only; corrected titles are not field-level truth
- legacy vision provider still performs the main semantic extraction until the worker has proven field-level gains

## Baseline

The latest local `npm run check` run before the R0/R1 worker changes passed the existing suite and produced the current non-commercial baseline:

- card-level exact accuracy: `0.2857142857142857`
- field-level accuracy: `0.72`
- manual critical-field rate: `0.2857142857142857`
- provider calls per asset: `1.2857142857142858`
- retrieval rounds per asset: `0.8571428571428571`
- cost per asset: `0.010286`
- held-out commercial assets: `0`

Commercial gate status from that baseline:

- blocked because the held-out commercial split is empty
- blocked because required strata are missing
- blocked because there is not enough owner-reviewed evidence to claim 95 percent commercial readiness

## New Local Surfaces

Dataset:

- schema: `data/recognition/schema/recognition-item.schema.json`
- tooling library: `lib/listing/recognition/recognition-dataset.mjs`
- metrics library: `lib/listing/recognition/recognition-evaluation.mjs`
- local dirs: `data/recognition/development`, `calibration`, `held-out`, `manifests`, `reports`

CLIs:

- `npm run eval:recognition -- --input <dataset.json>`
- `npm run eval:recognition:ablation -- --variants-dir <dir>`
- `node scripts/validate-recognition-dataset.mjs --input <dataset.json>`
- `node scripts/generate-recognition-splits.mjs --input <dataset.json> --output <manifest.json>`
- `node scripts/check-recognition-leakage.mjs --input <dataset.json>`
- `node scripts/build-recognition-dataset-report.mjs --input <dataset.json>`
- `node scripts/export-recognition-dataset-candidates.mjs --input <feedback-export.json>`

Node worker client:

- `lib/listing/recognition/recognition-contract.mjs`
- `lib/listing/recognition/recognition-client.mjs`
- `lib/listing/recognition/recognition-feature-flags.mjs`
- `lib/listing/recognition/recognition-errors.mjs`

Python worker:

- `services/recognition-worker/app/main.py`
- `services/recognition-worker/app/contracts.py`
- `services/recognition-worker/app/security.py`
- `services/recognition-worker/app/pipelines/*`
- `services/recognition-worker/Dockerfile`

## Metrics Contract

The evaluator reports:

- AI overall exact resolution rate
- card-level exact accuracy
- field-level accuracy
- human-authored critical resolution rate
- accepted critical error rate
- false AI-complete rate
- AI-complete precision
- targeted rescan recovery rate
- glare recovery rate
- OCR exact accuracy
- serial, checklist code, collector number, grade, and parallel exact accuracy
- candidate top-1 accuracy and top-5 recall
- latency p50/p95/p99
- cost per asset
- provider calls and retrieval calls per asset
- denominator breakdowns for technical, provider, OCR, retrieval, manual, and unrecovered-rescan cases
- Wilson 95 percent intervals for key rates
- breakdowns by category, product, year, field, difficulty tag, glare, slab, serial, and complex parallel

## Recognition Worker Boundary

The worker accepts only short-lived signed image URLs from allowed hosts. It requires an internal bearer token, HTTPS URLs, and no embedded URL credentials.

Current placeholder behavior is deliberate:

- OCR returns `UNAVAILABLE`
- visual embeddings return `DISABLED`
- candidate verification returns `DISABLED`
- no model output is fabricated
- no test feedback is uploaded or retained for training

The Node app can call the worker only when all are true:

- `ENABLE_RECOGNITION_WORKER=true`
- `RECOGNITION_WORKER_URL` is configured
- `RECOGNITION_WORKER_TOKEN` is configured
- request payload validates against the shared contract

## Gate Policy

This phase improves the ability to measure recognition, not the measured recognition quality itself.

Do not claim commercial readiness until:

- at least 300 owner-reviewed image-backed cards are converted into field-level ground truth
- the held-out commercial split has required strata
- leakage checks pass across physical card, capture session, and source feedback IDs
- the evaluator shows confidence intervals compatible with the target gate
- accepted critical error rate is below the target
- false AI-complete cases are reviewed and bounded
- live smoke evidence exists for enabled external providers

## Unlimited-OCR Decision

`baidu/Unlimited-OCR` is suitable for a future experimental worker adapter only. It is not a default dependency or production path in this phase.

Reasons:

- it is a new model with no release artifacts in the GitHub release tab at review time
- Hugging Face marks it as custom code and examples require `trust_remote_code=True`
- it is a 3B BF16 model, so CPU/Vercel execution is unrealistic
- the repo positions it for long-horizon document parsing, while this product needs reliable tiny printed card fields
- it can help as a recall-oriented OCR candidate source, but cannot override slab, card text, registry, checklist, or resolver constraints

## Next Work

R2 should implement one OCR adapter at a time behind ablation flags:

1. PaddleOCR adapter for text regions and slab labels.
2. Region proposal and crop quality scoring.
3. Serial, checklist, collector number, and grade parsers wired into worker output.
4. Candidate verification against registry/checklist evidence.
5. Optional Unlimited-OCR experimental branch only after GPU environment and license/security review.
