# Visual Review #001B Summary

Status: Review Summary, No Installation
Owner: LYNCA Listing Intelligence
Source Report: `visual-review-report-001b.md`
Generated: 2026-06-22

## What Was Validated

Visual Review #001B validated that GPT Vision can produce useful collectible-specific visual explanations when it receives front/back image evidence plus generated-title and corrected-title context.

The run reviewed 11 candidates with 22 images. All 11 Vision calls completed. The model produced 10 high-confidence reviews and 1 medium-confidence review. Nine candidates were marked visually supported, two were visually uncertain, zero were text-only, and two needed external checklist verification.

The most important validation is that visual review can separate three different outcomes:

- corrections that are visually supported and can become test-case candidates
- corrections that are contradicted or weakened by the visible card evidence
- corrections that need checklist verification because the image alone does not prove the exact set or parallel

## Strongest Visually Supported Concepts

The strongest testable visual concepts were parallel-pattern and label/text evidence cases where the images contained direct support.

- `learn-0020` Sapphire: PSA label and card back showed `CSA` / `CSAGL` style identifiers, supporting Topps Chrome Sapphire over generic Topps Chrome.
- `learn-0016` Bowman Sapphire / Padparadscha: front design showed pink mosaic/refractor-style Sapphire evidence plus 1/1 and autograph support.
- `learn-0009` Topps Chrome Tennis Gold Geometric: back identified Topps Chrome Tennis, front showed gold geometric pattern, RC logo, autograph, and 16/50.
- `learn-0073` Blue Geometric Refractor: front showed a blue checkered/geometric refractor pattern, supporting a more specific parallel than generic Blue Refractor.
- `learn-0102` Purple Raywave Refractor: front showed a wavy refractor pattern, supporting Raywave over generic Purple Refractor.
- `learn-0124` Red Wave Refractor: front showed a distinct wave foil pattern, supporting Red Wave over generic Red Refractor.
- `learn-0007` PSA card/auto grade split: PSA label and card back supported 2012-13 Panini Prizm Kobe Bryant Autographs with PSA 9 card grade and Auto 10.

## Visually Uncertain Cases

Two cases should remain visually uncertain or checklist-dependent.

- `learn-0011` 2025 -> 2026 / Cosmic Chrome / Star Fractor SSP: visible evidence supported the generated 2025 Topps Chrome WWE Orange Refractor framing more than the corrected 2026 Cosmic Chrome / Star Fractor SSP framing. The images did not visibly support Cosmic Chrome or Star Fractor SSP.
- `learn-0021` Series 2 / Gold Major League Material Relic: the relic/material language and 14/50 were supported, but Series 2 and Gold were not directly visible. This needs checklist verification before becoming any rule.

`learn-0046` Shimmer -> Sapphire was not marked visually uncertain, but it was marked as needing an external checklist. The image evidence favored Orange Shimmer over Orange Sapphire, and no visible Sapphire Edition indicator was present.

## Test-Case Candidates

The following should become human-reviewed regression test-case candidates, not automatic rules:

- Sapphire detection from explicit slab/back identifiers: `learn-0020`
- Sapphire/Padparadscha visual pattern with 1/1 autograph context: `learn-0016`
- Gold Geometric vs generic color parallel: `learn-0009`
- Blue Geometric vs Blue Refractor: `learn-0073`
- Purple Raywave vs Purple Refractor: `learn-0102`
- Red Wave vs Red Refractor: `learn-0124`
- PSA card grade / autograph grade split: `learn-0007`

These are good candidates because the visual evidence is concrete, narrow, and inspectable.

## Not Ready For Registry Or Resolver Rules

Do not turn these into registry or resolver rules yet:

- Broad `Sapphire` inference from pattern alone. `learn-0046` shows that Shimmer vs Sapphire can be ambiguous or even contradicted by the visible pattern.
- Year correction from operator feedback. `learn-0011` showed the corrected title could conflict with visible copyright/set evidence.
- Cosmic Chrome / Star Fractor SSP detection. The #001B evidence did not visually support it in the sampled WWE card.
- Series 2 and Gold relic classification. `learn-0021` needs external checklist confirmation because the images did not directly show those designations.
- Any automatic rule that treats corrected titles as truth. The run proved visual review is useful precisely because it can challenge corrections.

## Recommended Next Step

Create a small human-reviewed test fixture set from the visually supported candidates above. Each fixture should include generated title, corrected title, front/back image evidence, and the visual explanation from #001B.

The next step should be test-case preparation only. Do not install registry, resolver, prompt, or runtime title-generation changes from #001B without separate human approval.

