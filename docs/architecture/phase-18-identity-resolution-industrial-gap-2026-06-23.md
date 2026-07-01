# Phase 18 Identity Resolution Industrial Gap Report

Date: 2026-06-23
Branch: `v2_pai`

## Scope

This is the Phase 0 audit for turning Listing Copilot from a provider-driven title generator into a card identity resolution system.

The audited production-facing paths were:

- `api/listing-copilot-title.js`
- `lib/listing/evidence/provider-evidence-normalizer.mjs`
- `lib/listing/orchestration/evidence-completion-orchestrator.mjs`
- `lib/listing/renderer/listing-renderer.mjs`
- `lib/identity-resolution/*`
- `lib/listing/retrieval/*`

`origin/main` was fetched during the audit. It contains useful benchmark, visual review, and learning-cycle work, but it also removes many `v2_pai` provider, recognition, storage, retrieval, and identity modules. It must not be merged wholesale into `v2_pai`; evaluation ideas should be ported selectively.

## Current Fact Path

Before this patch, the runtime path was:

1. image upload
2. legacy vision provider or emergency OpenAI vision provider
3. provider JSON parsed into legacy fields and resolved fields
4. deterministic renderer generated a title from those provider-derived fields
5. feedback could store generated and corrected titles

That path already avoided using the provider's title string as the final title when the deterministic renderer could render one, but it still allowed provider-derived fields to become final resolved facts without an identity-level abstention gate.

## Existing Strengths

The branch already has the core local identity engine:

- `IdentityState`
- field candidates
- field conflicts
- uncertainty map
- conflict graph
- constraint engine
- field-level solver
- `CONFIRMED`, `RESOLVED`, `ABSTAIN` status
- deterministic renderer
- retrieval engine with marketplace policy separation
- Supabase feedback export path with 351 raw rows and 248 image-backed candidates

The strongest existing rule is that marketplace evidence cannot become ground truth. The resolver also handles slab override, registry override, invalid serial rejection, checklist mismatch, and multi-view OCR conflict.

## Critical Gaps Found

1. Provider-derived fields were still able to flow into final rendering without a top-level `resolveIdentity` gate.
2. legacy vision provider/OpenAI confidence was still indirectly influencing listing readiness before identity resolution.
3. API output did not expose the full `identity_resolution` object on normal generation responses.
4. `ABSTAIN` existed in the core resolver but was not enforced as the final production title gate.
5. Provider evidence was represented as `EvidenceDocument`, but there was no adapter from that structure into identity resolver `EvidenceItems`.
6. Current image-provider output does not yet distinguish true OCR text, slab label text, card front text, and visual inference at the field level.
7. Origin `main` has evaluation infrastructure that should be ported, but direct merging would delete important `v2_pai` systems.

## Patch Applied

This patch adds:

- `lib/identity-resolution/listing-resolution-gate.mjs`
- `scripts/identity-resolution-gate.test.mjs`

The title API now applies `applyIdentityResolutionGate()` after provider analysis and evidence completion.

Final title rules are now:

- `CONFIRMED` or `RESOLVED`: final title comes from deterministic renderer using identity-resolved fields.
- `ABSTAIN`: no final title is emitted; model title remains only as `model_title_suggestion`.
- legacy vision provider-only or GPT-only evidence cannot create a final title by itself.
- marketplace-only evidence cannot create a final title by itself.
- field states, conflict graph, conflict map, confidence report, and full resolution trace are returned as `identity_resolution`.

## Remaining Industrial Work

The system is now structurally safer, but it is not yet a proven 95% exact resolution system.

Next required work:

1. Convert recognition worker OCR and slab-label outputs into explicit `CARD_FRONT_PRINTED_TEXT`, `CARD_BACK_PRINTED_TEXT`, `SLAB_LABEL`, and `OCR_ONLY` evidence sources.
2. Feed Supabase storage images through the recognition worker so the 248 image-backed rows can produce real OCR evidence instead of provider-only inference.
3. Port benchmark runner concepts from `origin/main` without deleting `v2_pai` modules.
4. Build a full 351-row evaluation report that counts all records, with 103 no-image rows reported separately instead of silently dropped.
5. Add persistence for approved identity states only; do not store current test feedback as training data.
6. Add per-field critical error metrics for year, product, subject, parallel, serial, checklist, and grade.

## Acceptance Impact

This patch directly addresses:

- no LLM direct final fact decision
- explicit `ABSTAIN` final path
- deterministic final title from resolved identity only
- traceable field-level identity object on API responses
- marketplace not becoming ground truth

It does not claim 95% commercial accuracy yet. That must be measured after real OCR/slab/registry evidence is wired into the Supabase-backed evaluation set.
