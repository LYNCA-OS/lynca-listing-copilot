# Listing Copilot V2 Learning Checkpoint #001

Status: Historical Learning Checkpoint
Owner: LYNCA Listing Intelligence
Date: 2026-06-22
Companion Documents:

- `learning-console-v2.1.md`
- `learning-review-runbook.md`
- `review-cycle-001.md`
- `review-cycle-001-results.md`
- `visual-registry-v1.md`
- `visual-concept-extraction-001.md`
- `visual-verification-layer-v1.md`

## Purpose

Learning Checkpoint #001 packages the first V2.1 review cycle into a clean historical record.

It records what was built, what was learned, what is safe to do next, and what must not be done yet.

No upgrades were installed during this checkpoint.

## What Was Built

V2.1 added an offline learning review pipeline around V2.0B feedback records.

Built artifacts:

- `scripts/v2-learning-review.mjs`
- `docs/v2/learning-console-v2.1.md`
- `docs/v2/learning-review-runbook.md`
- `docs/v2/review-cycle-001.md`
- `docs/v2/review-cycle-001-results.md`
- `docs/v2/visual-registry-v1.md`
- `docs/v2/visual-concept-extraction-001.md`
- `docs/v2/visual-verification-layer-v1.md`
- `data/learning/.gitkeep`

Generated Cycle #001 artifacts:

- `data/learning/supabase-feedback-export-cycle-001.json`
- `data/learning/supabase-feedback-export-cycle-001-evidence.json`
- `data/learning/review-candidates-2026-06-22.json`
- `data/learning/review-candidates-2026-06-22.md`

## What Was Reviewed

Review Cycle #001 processed the first exported Supabase feedback dataset.

Final counts:

| Metric | Count |
| --- | ---: |
| Feedback rows exported | 279 |
| Image-backed rows reviewed | 176 |
| Legacy text-only rows preserved | 103 |
| Review candidates generated | 293 |
| Priority 1 candidates | 0 |
| Priority 2 candidates | 23 |
| Needs More Evidence candidates | 267 |

## What Was Learned

The feedback loop is producing usable learning evidence.

The strongest repeated patterns were medium-risk, not low-risk. Cycle #001 therefore produced no Priority 1 upgrade candidates.

Repeated correction themes included:

- year and season normalization, such as `2026` vs `2025-26`
- product and release identity, such as Chrome, Sapphire, Cosmic Chrome, and Platinum
- visual parallel and finish language, such as Refractor, Shimmer, Geometric, Wave, Star Fractor, Gold Refractor, and Orange Refractor
- auto, autograph, patch, relic, and memorabilia wording
- rookie and RC wording
- serial and SSP handling

The review also revealed a major safety requirement:

```text
Generated/corrected title diffs can identify candidates, but they cannot verify visual concepts.
```

Example risk:

```text
Generated: Bowman Chrome
Corrected: Bowman Sapphire
```

This correction does not prove that the card is visually Sapphire. It may reflect product checklist knowledge, back text, operator preference, or an incorrect correction.

## Approved Next Operating Rule

```text
Text diffs may identify candidates.
Image evidence is required for review.
Visual verification is required for visual concept promotion.
Human approval is required before installation.
```

This is the key operating rule coming out of Checkpoint #001.

## What Is Safe To Do Next

Safe next steps:

- Continue collecting image-backed feedback records.
- Use `scripts/v2-learning-review.mjs` for offline candidate generation.
- Treat Review Cycle #001 candidates as review inputs only.
- Draft Visual Registry candidates only after visual verification.
- Build a Visual Review Prototype design after enough image-backed evidence exists.
- Prepare test case proposals from image-specific examples, with human approval.
- Preserve legacy text-only rows as historical context, not visual proof.

Next data collection goal:

```text
500 image-backed feedback records before Visual Review Prototype #001.
```

## What Must Not Be Done Yet

Do not:

- install registry updates from Cycle #001
- install resolver rules from Cycle #001
- modify prompts from Cycle #001
- treat title diffs as visual proof
- promote visual concepts without the Visual Verification Layer
- fine-tune models from this dataset
- build RAG from this dataset
- mutate raw feedback records
- require operators to label corrections
- deploy any automatic learning loop

## Deferred Work

The following work is deferred:

- Visual Review Prototype
- Visual Registry population
- Registry updates
- Resolver updates
- Prompt updates
- Fine-tuning
- RAG

## Checkpoint Status

Checkpoint #001 is complete as a historical learning package.

System behavior remains unchanged.

