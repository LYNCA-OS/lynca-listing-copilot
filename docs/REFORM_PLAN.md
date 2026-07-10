# Reform Plan: v2 Monolith Retirement (R1) & Catalog Entity Resolution (R4)

Status ledger for the two large reforms. Small reforms (security rotation,
CI, dead-job cleanup, OCR worker scaling, env inventory, eval registry,
skeleton-field streaming) shipped 2026-07-09 and are not tracked here.

## R1 — Retire the v2 monolith

`api/listing-copilot-title.js` (~7,300 lines) contains the entire recognition
pipeline; `api/v4/*` reaches it only through adapters (`v2PayloadFor`,
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
| 6 | (prompt) | provider-prompt (bit-identical snapshot) | **6,160** |

Every slice: copy-then-delegate, 97 offline suites, cloud smoke-gate
(GitHub Actions `smoke-gate` workflow — canonical since local egress proved
flaky). Next target: the result-shaping cluster (normalizeAiResult /
withEvidenceCompatibility / withRequestMetadata + the normalizeFields
family, 26 call sites — take the full closure in one slice).

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
