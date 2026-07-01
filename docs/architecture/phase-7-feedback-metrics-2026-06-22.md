# Phase 7 Feedback And Metrics

Date: 2026-06-22

## Scope

This phase adds the first versioned feedback and review persistence layer required by the commercial Evidence First migration. It preserves the existing legacy `listing_title_feedback` write path for changed-title compatibility, but the primary review record is now written to versioned tables.

## Added Tables

Migration:

- `supabase/migrations/20260622_listing_feedback_v2.sql`

Rollback:

- `supabase/migrations/20260622_listing_feedback_v2_rollback.sql`

Tables:

- `listing_assets`
- `listing_analysis_runs`
- `listing_reviews`

The migration enables Row Level Security on all three new tables. The current app writes through trusted server-side Supabase REST calls using `SUPABASE_SERVICE_ROLE_KEY`; the service role key remains server-only.

## Rollback And Recovery

Rollback scripts:

- `supabase/migrations/20260622_listing_feedback_v2_rollback.sql`
- `supabase/migrations/20260622_listing_publish_jobs_rollback.sql`

If both Phase 7 and Phase 8 migrations have been applied, run the publish-job rollback first because `listing_publish_jobs` references `listing_reviews` and `listing_assets`.

Production rollback procedure:

1. Export any rows that must be retained from `listing_publish_jobs`, `listing_reviews`, `listing_analysis_runs`, and `listing_assets`.
2. Run `20260622_listing_publish_jobs_rollback.sql` if the publish jobs table exists.
3. Run `20260622_listing_feedback_v2_rollback.sql`.
4. Confirm the legacy `listing_title_feedback` table still exists and changed-title feedback remains available.
5. To recover the versioned schema, reapply `20260622_listing_feedback_v2.sql`, then `20260622_listing_publish_jobs.sql` if publishing audit storage is needed.
6. Restore exported rows only after checking foreign-key order: assets, analysis runs, reviews, then publish jobs.

The rollback scripts intentionally drop only the new versioned tables. They do not modify legacy `listing_title_feedback`, but any unexported data in the new tables will be lost when the rollback is executed.

## Review Save Behavior

The existing endpoint remains:

- `POST /api/listing-title-feedback`

The endpoint requires the signed internal session cookie before it reads or writes review data. `operator_id` is derived from that trusted session; unauthenticated requests return `401` and do not write Supabase rows.

It now saves:

- asset snapshot and object paths
- analysis run metadata
- generated evidence/resolved/modules snapshots
- corrected resolved/modules snapshots
- server-computed `field_changes`
- rendered and corrected title
- `title_override`
- review outcome
- operator id
- review duration
- retrieval and resolution trace snapshots
- provider/model/schema/version metadata where present

`ACCEPTED_UNCHANGED` is no longer skipped. It is saved as a positive review sample in `listing_reviews`.

Changed-title saves also write the legacy `listing_title_feedback` row so existing raw-memory consumers are not broken.

Approved review rows now also feed Retrieval. When Supabase feedback storage is configured, the internal approved-history provider reads approved `listing_reviews` rows, uses `corrected_resolved_fields` and `corrected_title` as trusted internal candidates, and runs before registry, Brave, eBay, or OWS.

## Server-Side Diffing

`lib/listing/feedback/review-records.mjs` computes field diffs on the server from generated and corrected resolved snapshots. Client-provided `field_changes` are not trusted as the authoritative diff.

Supported review outcomes:

- `ACCEPTED_UNCHANGED`
- `CORRECTED_FIELDS`
- `TITLE_ONLY_OVERRIDE`
- `TARGETED_RESCAN_RECOVERED`
- `NON_STANDARD_MANUAL`
- `REJECTED`
- `TECHNICAL_FAILURE`

`TARGETED_RESCAN_RECOVERED` is reserved for a post-rescan analysis that has returned to a resolved review route and includes a recovery signal. A still-pending `TARGETED_RESCAN_REQUIRED` route is not inferred as recovered or approved; if it is saved as-is, the server records it as `REJECTED` with no `approved_at` timestamp so it cannot inflate positive review or recovery metrics.

## Frontend Payload

The save action now sends:

- `asset_id`
- `analysis_run_id`
- generated/corrected title
- generated/corrected resolved fields
- generated/corrected modules
- generated evidence
- rendered title
- title override
- provider/model/version metadata
- route
- capture quality
- retrieval trace
- resolution trace
- usage
- recovery flags when present
- review duration
- image object path references

The frontend does not send browser-only `File` objects or signed URLs in the feedback payload.

## Metrics

`lib/listing/feedback/review-metrics.mjs` provides a small review summary helper:

- total reviews
- outcome counts
- accepted unchanged rate
- field correction rate
- title-only override rate
- average review duration
- correction counts by field

This is a review-metrics foundation, not a held-out commercial accuracy report.

`lib/listing/evaluation/golden-dataset.mjs` now also reports the commercial metric families required by the migration spec:

- AI overall exact resolution rate and card-level exact accuracy
- field-level accuracy
- AI-complete precision and false AI-complete count
- final approved publish accuracy, using corrected/final resolved fields when present
- human-authored critical resolution rate
- accepted critical error rate
- technical failure rate
- routing accuracy and non-standard recall
- retrieval, focused reread, targeted rescan, and glare recovery rates
- average review duration, provider calls, retrieval rounds, latency, and cost per asset
- provider, category, and difficulty breakdowns with coverage and exact-resolution rate
- glare impact against the rest of the dataset
- Wilson 95% confidence intervals for headline rate metrics
- failure root-cause counts and field error distribution
- correction rate per field
- retrieval-provider contribution diagnostics for Brave, eBay Browse, and OWS
- legacy vision provider vs GPT-4.1 emergency provider comparison diagnostics

`npm run eval:golden` prints the breakdowns in the default console output as `provider_breakdown`, `category_breakdown`, and `difficulty_breakdown`. The optional JSON report written with `--report` keeps the same values under `breakdowns.provider`, `breakdowns.category`, and `breakdowns.difficulty`.

The evaluator also stores interval details under `confidence_intervals` and prints representative CLI lines for `ai_overall_exact_resolution_rate_ci95`, `ai_complete_result_precision_ci95`, `accepted_critical_error_rate_ci95`, and `final_approved_publish_accuracy_ci95`. These intervals do not permit a commercial claim by themselves; the held-out commercial split must still be populated and evaluated.

The report now separates regression diagnostics from commercial acceptance evidence. The legacy top-level metric lines remain all configured splits for development visibility, while `held_out_commercial_evidence` is scoped only to the held-out commercial split. `commercial_acceptance_gate` records the configured minimum held-out size, required strata, threshold checks, and failure reasons; `dataset.commercial_claim_allowed` is true only when that gate passes.

When the development or commercial set misses target thresholds, the evaluator now emits `failure_root_causes` and `field_error_distribution` in the CLI output. The JSON report stores the same information under `failure_analysis.root_causes` and `failure_analysis.field_error_distribution`. Future prediction fixtures may provide explicit `prediction.failure_root_causes`; otherwise the evaluator derives causes from route mismatches, technical failures, human critical corrections, false AI-complete assets, accepted critical errors, and critical-field mismatches.

The evaluator also emits `retrieval_provider_gains`, `vision_provider_comparison`, and `legacy-vision-provider_vs_openai_legacy`. Retrieval contribution is explicit-trace based: Brave and OWS can count recovered assets only when the prediction metadata says that provider recovered the asset, while eBay Browse can separately count market-reference help without treating marketplace titles as ground truth. The provider comparison reports exact rate, AI-complete precision, false AI-complete assets, technical failures, and accepted critical errors for legacy vision provider and GPT-4.1 emergency results.

The evaluator emits `glare_impact` as a separate diagnostic so glare samples remain visible even when the overall denominator includes every asset. It reports glare coverage, exact rate, non-glare comparison, human-critical rate, accepted critical errors, technical failures, glare recovery, and final approved accuracy for glare-tagged assets.

The default `data/golden-dataset.json` contains development-only fixtures for metric validation. The held-out commercial split remains empty, so the evaluator emits an explicit warning that current metrics are not commercial acceptance evidence.

## Held-Out Commercial Intake

`lib/listing/evaluation/commercial-heldout-builder.mjs` and `scripts/build-held-out-commercial.mjs` add the intake path for real commercial gate evidence. The command reads exported asset, analysis, and approved review rows, converts them to `splits.held_out_commercial`, and writes a new golden dataset file. `supabase/queries/export_commercial_heldout_reviews.sql` is the read-only SQL template for producing the source JSON from approved `listing_reviews` rows.

Example:

```bash
npm run commercial:heldout -- --source exports/commercial-reviews.json --out data/golden-dataset.commercial.json --replace
npm run eval:golden -- --dataset data/golden-dataset.commercial.json
```

The builder deliberately keeps two separate records:

- `prediction.resolved_fields` is the model output at analysis time.
- `ground_truth_fields` is the corrected reviewer-approved field set plus final-title quality flags.

This means corrected commercial rows do not become fake model passes. If legacy vision provider predicted `37/50` and the reviewer corrected the serial to `31/50`, the held-out item keeps `37/50` in `prediction.resolved_fields`, stores `31/50` in `ground_truth_fields`, and the commercial gate counts the asset as a model miss while still allowing final-approved publish accuracy to use the corrected fields.

The importer rejects rows that are missing asset, analysis, or review ids; generated or corrected resolved fields; safe object paths; or explicit `final_title_required_fields` and `final_title_unsubstantiated_fields` booleans. It also rejects asset ids that already exist in development or calibration splits. This is intentional: the gate should only pass after real, stratified, held-out commercial samples exist with auditable predictions and reviewer truth.

## Tests

Added:

- `scripts/feedback-review.test.mjs`
- `scripts/commercial-heldout-builder.test.mjs`

Coverage includes:

- unauthenticated review saves are rejected before Supabase writes
- `ACCEPTED_UNCHANGED` review rows are saved
- changed critical fields produce server-side diffs
- untrusted client diffs do not become authoritative
- pending targeted rescan is not saved as recovered or approved
- post-rescan recovered outcomes require an explicit recovery signal
- title-only overrides are separated from field corrections
- changed titles still write the legacy feedback table
- object paths are captured without signed URLs
- review metrics summarize outcomes and field correction counts
- commercial held-out rows preserve generated predictions separately from corrected ground truth
- unsafe signed image URLs and missing title quality flags are rejected before import
- duplicate commercial asset ids cannot be appended into the held-out split
- the commercial gate remains failed when imported held-out predictions miss configured thresholds

## Known Gaps

- No live Supabase migration was applied in this local run.
- No production database contents were backfilled.
- The app still lacks a dedicated review analytics dashboard.
- Publishing tables and B-end upload boundary remain Phase 8.
- The default held-out commercial dataset is still empty, so no commercial accuracy claim is possible until real approved review exports are imported and the commercial acceptance gate passes.
