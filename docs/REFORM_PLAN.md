# Reform Plan: v2 Monolith Retirement (R1) & Catalog Entity Resolution (R4)

Status ledger for the two large reforms. Small reforms (security rotation,
CI, dead-job cleanup, OCR worker scaling, env inventory, eval registry,
skeleton-field streaming) shipped 2026-07-09 and are not tracked here.

The production execution framework is documented separately in
`docs/EXECUTION_CONTROL_PLANE_V1.md`. Its first release keeps Vercel,
Supabase, and Cloud Run, while adding database-enforced provider capacity,
fair cross-batch queue claims, cache-only hidden scout probing, and aggregated
writer status updates.

## R1 — Retire the v2 monolith

### 2026-07-14 convergence checkpoint

V4 no longer imports or invokes the V2 HTTP handler. The endpoint calls an
explicit `runListingRecognitionCore` bridge, so request parsing, authentication,
rate limiting, and response emulation are no longer nested. Candidate selection
and safe field application now execute through one atomic decision stage, and a
versioned pipeline contract exposes every remaining transitional bridge.

This is not the end of R1: `api/listing-copilot-title.js` is currently 5,931
lines and still owns bridged observation, retrieval, and resolution work. The
next extraction must remove those owners from the core rather than add another
wrapper. See `docs/architecture/V4-CONVERGENCE-20260714.md`.

Historically, `api/listing-copilot-title.js` (~7,300 lines) contained the entire recognition
pipeline; `api/v4/*` reaches it only through adapters (`recognitionPayloadFor`,
`adaptV2ResultToV4`, `hideTitleFields`, `legacy_v2_result`). Every feature
lands as a patch to one file, and the `resolved_fields || resolved || fields`
triple-naming (18 sites) is seam leakage.

Extraction order (each step keeps the public API bit-identical; offline
suites + a 10-card smoke gate every step):

1. **Stage: provider call.** Move provider selection/invocation/token
   accounting into `lib/listing/pipeline/provider-stage.mjs`. The monolith
   calls the stage; no behavior change.
2. **Stage: evidence assembly.** Preingestion evidence document, OCR patches,
   scout hints → `evidence-stage.mjs` (much already lives in
   `lib/listing/orchestration/evidence-completion-orchestrator.mjs`; the
   monolith-side glue moves out).
3. **Stage: resolution + gate.** The call into
   `lib/identity-resolution/listing-resolution-gate.mjs` plus surrounding
   reconciliation glue.
4. **Stage: render + presentation.** Renderer invocation and response
   shaping; kill `legacy_v2_result` by making v4 the native response and the
   v2 HTTP handler a thin adapter over the stages (inversion of today).
5. **Schema unification.** One `resolved_fields` name end-to-end; delete the
   triple-fallbacks; contract test asserting v4 response shape.
6. **Delete the v2 HTTP surface** once the frontend and queue worker call
   stages/v4 only.

Risks: hidden order-dependencies inside the monolith (mitigate: extract by
copy-then-delegate, never rewrite-in-place); prompt-adjacent code must not
drift (golden prompt snapshot test before step 1).

### R1 progress ledger

| Slice | Landed | Modules | Monolith lines |
|---|---|---|---|
| 0 | c81c834 | golden prompt snapshot guard | 7,261 (start) |
| 1-2 | c81c834 | timing, provider-result-metadata | 7,099 |
| 3 | 666c6ad | flags, text, evidence-merge, provider-stage | 6,982 |
| 4 | 6b02ccb | preingestion-evidence | 6,702 |
| 5 | 6fe2dec | provider-options | 6,565 |
| 6 | (prompt) | provider-prompt (bit-identical snapshot) | 6,160 |
| 7 | (fields) | field-normalization (26 call sites; runtime tendril extractHighValueInsert caught+moved) | 5,859 |
| 8a | (decor) | result-decoration quartet | 5,784 |
| 8b-1 | (text) | text-match primitives + pipeline-module-lint guard | **5,644** |
| 8b-2 | (calibration) | provider-neutral result-calibration + title-grammar | **4,633** |

Every slice: copy-then-delegate, 98 offline suites, cloud smoke-gate
(GitHub Actions `smoke-gate` workflow — canonical since local egress proved
flaky). Gate protocol update: dispatch the cloud smoke-gate >=7 minutes after the
alias switch — first-minutes gates hit the propagation window even from
runners. Slice 8b-2 completed the coordinated calibration/title-grammar cut:
the copied functions now live in `pipeline/result-calibration.mjs` and
`pipeline/title-grammar.mjs`; the HTTP file only imports their public entry
points. The golden prompt, pipeline lint, focused renderer/title tests, and
the full offline suite remain green. Next target is the resolution + gate
reconciliation stage described in extraction step 3 above.

## R4 — Catalog entity resolution

Catalog matching is trigram/substring text matching; players are raw
`text[]`. Name drift ("Jaren Jackson Jr" vs "Jaren Jackson Jr.") does not
cause misidentification in the fail-closed design — it silently breaks
fast-lane uniqueness instead (finalize requires exactly one eligible row).

1. **Write-time normalization** (small, do first): canonical player-name
   normalizer (diacritics fold, suffix normalization Jr/Jr., II/III) applied
   in the promotion pump, writer-title import, and cert-registry upsert.
2. **Alias table**: `catalog_player_aliases(canonical, alias)`; RPC subject
   filter consults aliases. Seed from the distinct players already in
   catalog_cards (16.5k rows) clustered by normalized form.
3. **Duplicate-row audit**: recurring job that flags catalog_cards sharing
   (code, compatible year, overlapping players) — these are exactly the rows
   that kill fast-lane uniqueness. `catalog_entity_clusters` table already
   exists for this and is currently unused.
4. **Product canonicalization**: catalog_products currently accumulates
   near-duplicates ("Panini Prizm" / "Prizm Basketball"); same treatment,
   lower urgency (products don't gate finalize uniqueness).
