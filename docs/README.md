# Listing Copilot Documentation

This folder contains product specs, architecture decisions, roadmap notes, standards, and training records for Listing Copilot.

The documentation is organized so permanent source-of-truth docs are separate from raw training evidence and historical notes.

## Recommended Reading Order

1. `foundation/foundation-v1.md`
2. `standards/sports-card-title-standard-v1.md`
3. `architecture/architecture-decisions-v1.md`
4. `roadmap/listing-copilot-roadmap-v1.md`
5. `architecture/prompt-modernization-plan-v1.md`
6. `architecture/phase-1-provider-routing-2026-06-22.md`
7. `architecture/phase-2-storage-image-quality-2026-06-22.md`
8. `architecture/phase-3-evidence-architecture-2026-06-22.md`
9. `architecture/phase-4-renderer-writer-modules-2026-06-22.md`
10. `architecture/phase-5-retrieval-engine-2026-06-22.md`
11. `architecture/phase-6-evidence-completion-2026-06-22.md`
12. `architecture/phase-7-feedback-metrics-2026-06-22.md`
13. `architecture/phase-8-publishing-boundary-2026-06-22.md`
14. `architecture/phase-9-commercial-readiness-audit-2026-06-22.md`
15. `architecture/phase-10-delivery-report-2026-06-22.md`
16. `architecture/phase-11-ebay-image-candidate-collection-2026-06-22.md`
17. `architecture/phase-12-public-card-image-reference-eval-2026-06-22.md`
18. `architecture/phase-13-commercial-title-acceptance-policy-2026-06-23.md`
19. `architecture/phase-14-uploaded-storage-memory-gate-2026-06-23.md`
20. `architecture/phase-15-recognition-accuracy-r0-r1-2026-06-23.md`
21. `architecture/phase-16-identity-resolution-state-graph-2026-06-23.md`
22. `architecture/phase-17-recognition-r2-geometry-quality-2026-06-23.md`
23. `recognition/supabase-feedback-data-connection.md`
24. `recognition/data-needed-from-owner.md`
25. `integrations/ebay-browse-readiness.md`
26. `compliance/recognition-dependencies.md`

## Foundation

### `foundation/foundation-v1.md`

Top-level map of Listing Copilot.

Use this as the first stop for future engineers and future Codex sessions.

### `foundation/spec-v1.md`

Original MVP product and workflow specification.

Use this for initial product context. Newer sports-card title behavior should defer to the standard, ADRs, and roadmap.

## Standards

### `standards/sports-card-title-standard-v1.md`

Source of truth for future sports card title generation rules, including:

- evidence layers
- evidence hierarchy
- canonical title grammar
- cleanup standards
- PSA/BGS grading semantics

## Architecture

### `architecture/architecture-decisions-v1.md`

Approved V1.x architecture decisions and future boundaries.

### `architecture/prompt-modernization-plan-v1.md`

Plan for reducing prompt complexity over time while preserving output quality.

### `architecture/phase-0-audit-baseline-2026-06-22.md`

Baseline audit and evaluation scaffold added before the commercial-evidence migration.

### `architecture/phase-1-provider-routing-2026-06-22.md`

Backend provider routing history; current mainline uses the GPT-4.1-primary cascade with legacy vision provider as auxiliary focused verifier.

### `architecture/phase-2-storage-image-quality-2026-06-22.md`

Supabase Storage signed upload/read URL slice and remaining image-quality work.

### `architecture/phase-3-evidence-architecture-2026-06-22.md`

EvidenceField and ResolvedFields schema bridge for the legacy title API.

### `architecture/phase-4-renderer-writer-modules-2026-06-22.md`

Deterministic title renderer, editable writer modules, and title override boundary for the Evidence First API response.

### `architecture/phase-5-retrieval-engine-2026-06-22.md`

Retrieval Engine contracts, query planning, provider routing, source policy, cache, and candidate matching.

### `architecture/phase-6-evidence-completion-2026-06-22.md`

Evidence Completion state, budget, next-best-action selection, retrieval integration, route policy, and completion trace boundaries.

### `architecture/phase-7-feedback-metrics-2026-06-22.md`

Versioned Supabase feedback tables, accepted-unchanged review persistence, server-side field diffs, review outcomes, and eval diagnostics for provider/retrieval contribution.

### `architecture/phase-8-publishing-boundary-2026-06-22.md`

ListingDraft contract, approval gate, mock B-end publisher, idempotency, retry, and publish audit boundary.

### `architecture/phase-9-commercial-readiness-audit-2026-06-22.md`

Machine-readable commercial readiness audit covering held-out commercial evidence, legacy vision provider smoke, provider default safety, mock-only publishing, and external retrieval validation gaps.

### `architecture/phase-10-delivery-report-2026-06-22.md`

Repeatable 28-section final-delivery report generator that reads readiness, eval, smoke, migration, and documentation evidence without claiming blocked gates are complete.

### `architecture/phase-11-ebay-image-candidate-collection-2026-06-22.md`

Official eBay Browse API path for collecting a 300-image marketplace-reference candidate queue, plus the ground-truth boundary required before any accuracy claim.

### `architecture/phase-12-public-card-image-reference-eval-2026-06-22.md`

Repeatable 300-image public Pokémon card reference evaluation for legacy vision provider card-name recognition, including the current 296/300 strict exact-match result and its commercial-gate boundary.

### `architecture/phase-13-commercial-title-acceptance-policy-2026-06-23.md`

Semantic commercial title acceptance policy: non-standard wording can pass when critical facts are correct, while wrong name, color/parallel, serial, grade, or conflicting critical fields fail.

### `architecture/phase-14-uploaded-storage-memory-gate-2026-06-23.md`

Uploaded-image storage stays enabled for legacy vision provider recognition, while feedback retention, approved-memory reuse, and training data collection remain opt-in and default off until commercial rollout.

### `architecture/phase-15-recognition-accuracy-r0-r1-2026-06-23.md`

Recognition Accuracy Program R0/R1 audit, dataset/eval tooling, worker contract, and current commercial-gate boundaries.

### `architecture/phase-16-identity-resolution-state-graph-2026-06-23.md`

Identity Resolution state object, conflict graph, field uncertainty, and `CONFIRMED/RESOLVED/ABSTAIN` routing.

### `architecture/phase-17-recognition-r2-geometry-quality-2026-06-23.md`

Recognition Worker R2 geometry, glare, quality, region proposal, and worker-level eval entry.

## Recognition

### `recognition/supabase-feedback-data-connection.md`

Live Supabase feedback table counts, storage bucket mapping, and REST plus MCP/SQL/session export commands for Recognition Dataset candidates.

### `recognition/data-needed-from-owner.md`

Owner-reviewed, image-backed, field-level data requirements for turning Supabase feedback or test candidates into valid recognition ground truth.

## Integrations

### `integrations/ebay-browse-readiness.md`

Official eBay Browse API readiness checklist and marketplace-reference boundary. eBay remains reference evidence, not ground truth.

## Compliance

### `compliance/recognition-dependencies.md`

Dependency and model-use policy for the Python Recognition Worker, including the current Unlimited-OCR decision.

## Roadmap

### `roadmap/listing-copilot-roadmap-v1.md`

Phased implementation roadmap from current production behavior toward Evidence, Resolver, Grammar Engine, and Knowledge Database architecture.

## Training

### `training/README.md`

Training archive guide.

### `training/training-index-v1.md`

Consolidated operating summary of recurring QA learnings.

### `training/registry-candidates-v1.md`

Registry backlog for official card types, inserts, product-family terms, parallels, and commercially meaningful terms.

### `training/qa-findings-2026-06.md`

Monthly QA summary for the June 2026 Subset A-F training cycle.

### `training/subsets/`

Raw subset reports. These are evidence records and should remain mostly immutable after creation.

## Archive

### `archive/training-legacy/`

Older one-off training notes, confidence calibration notes, and category-specific historical records.

These remain useful context, but they are not the current source of truth when they conflict with foundation, standards, architecture, roadmap, or the consolidated training index.
