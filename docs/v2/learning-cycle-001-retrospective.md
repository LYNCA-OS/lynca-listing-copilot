# Learning Cycle #001 Retrospective

Status: Retrospective and Checkpoint, No Installation
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `upgrade-recommendation-001.md`
- `supabase-dataset-analysis-current.md`
- `visual-review-report-001b.md`
- `fixtures/visual-fixture-set-001.md`
- `knowledge-promotion-framework-v1.md`

## Scope

This document summarizes what was learned from the first 351-record Listing Copilot learning cycle.

It is a retrospective and checkpoint document only.

No runtime code, registry, resolver, prompts, deployment, or upgrades are modified.

## Dataset Baseline

| Metric | Count |
| --- | ---: |
| Total feedback records | 351 |
| Image-backed records | 248 |
| Text-only legacy records | 103 |
| Vision-reviewed candidates | 11 |
| Visually supported candidates | 9 |
| Vision-reviewed candidates needing external checklist | 2 |
| Verified fixtures | 5 |
| Production upgrades installed | 0 |

The dataset now has enough image-backed feedback to support evidence-first review. It does not yet have enough repeated aligned fixtures to justify production behavior changes.

## Main Conclusion

The system should install test cases only, not registry, resolver, prompt, or runtime changes.

Fixture Set #001 is mature enough to become regression-test coverage after human approval. The rest of the learning archive should remain in evidence review, fixture creation, and checklist validation.

The 351-record cycle produced usable learning assets, but not production-ready knowledge rules.

## What Worked

Image storage worked:

- Newer feedback rows include durable front/back image URLs.
- 248 of 351 records are image-backed.
- The system can preserve visual evidence without downloading or committing images.

Supabase feedback capture worked:

- The current export contains complete `generated_title` and `corrected_title` values for all 351 records.
- New records after Dataset Snapshot #002 were all image-backed.
- The feedback table is now functioning as a growing learning memory.

Visual review pipeline worked:

- Visual Review #001B reviewed 11 candidates.
- All 11 Vision calls completed.
- 9 candidates were marked visually supported.
- The review produced useful distinction-making evidence for Sapphire, Geometric, Raywave, Wave, autograph-grade, and checklist-dependent concepts.

Fixture creation worked:

- Fixture Set #001 created 5 verified visual fixtures.
- Each fixture preserved source feedback, image URLs, generated/corrected title pair, visual confidence, confusion target, and fixture role.
- The first reusable knowledge unit now exists.

Promotion framework worked:

- The framework separated feedback, evidence, vision review, fixture, test case, registry candidate, resolver candidate, knowledge fixture, and hybrid fixture.
- It prevented premature registry/resolver/prompt recommendations.
- It clarified that Fixture Set #001 belongs in the test layer first.

## What Remains Immature

Registry promotion remains immature:

- The archive has strong concepts, but not enough repeated aligned fixtures.
- Sapphire, Raywave, Geometric, and related parallel terms still need guardrails and negative/confusion examples before registry candidacy.

Resolver promotion remains immature:

- Resolver updates require repeated low-ambiguity examples and reviewed negative/confusion cases.
- No current concept has enough aligned fixtures to justify deterministic production behavior.

Prompt mutation remains immature:

- The cycle produced useful cautions, but not prompt-ready instructions.
- Prompt changes would be broader and harder to rollback than test cases.
- Cautions should first become regression tests and review criteria.

Checklist-dependent concepts remain immature:

- `SSP`, `Case Hit`, `Series 2`, `Major League Material Relic`, `Home Advantage`, `Shadow Etch`, and `Pixel Burst` need external product/checklist confirmation.
- Text diffs and visual card identification are not enough to approve scarcity or exact checklist language.

Broad year/season normalization remains immature:

- The dataset shows repeated `2025`, `2026`, and `2025-26` corrections.
- These are product-specific and sport-specific.
- No broad year normalization rule should be installed.

## Most Important Principle

Feedback is evidence, not truth.

Fixtures are the first reusable knowledge unit.

Production behavior should not change without repeated aligned fixtures and human approval.

This principle should govern every future cycle. A corrected title may point to a possible truth, but it does not prove the concept. Image evidence, visual review, checklist support, and human review decide whether the correction becomes durable knowledge.

## Durable Lessons

1. Text diffs are good for candidate discovery.
2. Image-backed feedback is required for visual concept review.
3. Vision review is useful, but it is not an installation decision.
4. Fixtures convert raw feedback into reusable review assets.
5. Negative and confusion fixtures are necessary before risky concepts can move toward production.
6. Checklist-dependent concepts need a source policy before promotion.
7. Tests are the safest first installation surface.

## Current Safe Installation Surface

| Surface | Current status | Decision |
| --- | --- | --- |
| Test cases | Mature for Fixture Set #001 after human approval | Proceed next |
| Registry | Not mature | Do not install |
| Resolver | Not mature | Do not install |
| Prompt | Not mature | Do not install |
| Runtime behavior | Not mature | Do not install |

## Recommended Next Phase

Continue collecting toward 500 image-backed records.

Grow verified fixtures from 5 to 20.

Install Fixture Set #001 as regression tests only after human approval.

Define checklist-source policy before SSP, case-hit, Series 2, exact relic-name, or scarcity upgrades.

Recommended fixture growth targets:

| Fixture type | Target |
| --- | ---: |
| Visual fixtures | 10 |
| Negative/confusion fixtures | 4 |
| Knowledge fixtures | 3 |
| Hybrid fixtures | 3 |
| Total verified fixtures | 20 |

Priority next candidates:

| Candidate | Recommended next role |
| --- | --- |
| `Red Wave Refractor` | Visual fixture / test case candidate |
| `Orange Shimmer, not Orange Sapphire` | Negative/confusion fixture |
| `Autograph / card-auto grade split` | Knowledge fixture |
| `Series 2 / Major League Material Relic` | Hybrid fixture with checklist review |
| `SSP case-hit / short-print language` | Knowledge/hybrid candidate with checklist review |

## Checkpoint Decision

Learning Cycle #001 should be considered successful as an evidence and fixture-building cycle.

It should not be considered a production-upgrade cycle.

The system learned how to collect, review, and preserve knowledge. It did not yet learn enough to safely change production behavior.

## Non-Goals

This retrospective does not:

- modify runtime code
- modify the registry
- modify the resolver
- modify prompts
- install upgrades
- create new fixtures
- create tests
- download images
- commit exported raw data

## Next Review Gate

The next upgrade recommendation should wait until at least one of these conditions is met:

- 500 image-backed records are available.
- 20 verified fixtures exist.
- Fixture Set #001 is installed as tests and produces stable regression results.
- Checklist-source policy is defined.
- At least one concept has repeated aligned positive fixtures plus negative/confusion coverage.
