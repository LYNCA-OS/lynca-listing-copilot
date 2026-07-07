# Upgrade Recommendation Review #001

Status: Recommendation Package Only, No Installation
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- Current Supabase dataset: 351 records
- Current image-backed records: 248
- `review-cycle-001-results.md`
- `visual-review-report-001b.md`
- `fixtures/visual-fixture-set-001.md`
- `fixture-set-002-candidates.md`
- `fixture-review-001.md`
- `knowledge-promotion-framework-v1.md`
- `supabase-dataset-analysis-current.md`

## Scope

This document reviews the current learning archive and recommends what is mature enough to install later.

It answers:

```text
Given 351 records, what should actually change?
```

This is a recommendation package only.

No runtime code, registry, resolver, prompts, tests, deployment, or upgrades were modified.

## Executive Answer

The only changes mature enough to recommend now are test-case-only upgrades based on Fixture Set #001.

No registry update, resolver update, or prompt update is mature enough to install from the current evidence.

| Change area | Recommendation | Install recommendation |
| --- | --- | --- |
| Visual regression tests from Fixture Set #001 | Create test cases for the five verified fixtures. | `install now` as tests only, after human approval |
| Registry updates | Do not install any registry entries yet. | `do not install` |
| Resolver updates | Do not install any resolver rules yet. | `do not install` |
| Prompt updates | Do not install prompt changes yet. | `do not install` |
| Fixture Set #002 candidates | Continue evidence review and human selection. | `install later` as fixtures/tests only |

Reason:

The archive now has strong evidence that visual review and fixture creation are useful, but it has not yet crossed the safety threshold for production behavior. The current mature asset is a small set of stable regression examples, not an automatic knowledge upgrade.

## Evidence Baseline

| Metric | Count |
| --- | ---: |
| Current feedback records | 351 |
| Current image-backed records | 248 |
| Current text-only legacy records | 103 |
| Visual Review #001B reviewed candidates | 11 |
| Visual Review #001B visually supported candidates | 9 |
| Visual Review #001B needs external checklist | 2 |
| Fixture Set #001 verified fixtures | 5 |
| Fixture Set #002 candidates | 5 |

Current dataset pressure from `supabase-dataset-analysis-current.md`:

| Correction class | Rows matched | Upgrade implication |
| --- | ---: | --- |
| Parallel corrections | 142 | Strong signal for fixture/test growth; not enough for broad resolver rules. |
| Product/set corrections | 139 | High volume, but often checklist-dependent. |
| Auto/relic/patch corrections | 62 | Good knowledge-fixture queue; too mixed for runtime behavior. |
| Serial corrections | 55 | Needs image/OCR evidence; should not become title rules. |
| SSP/case-hit corrections | 45 | High-value but checklist-dependent. |
| Grade corrections | 19 | Good knowledge-fixture queue, especially card-grade versus auto-grade split. |

## Recommendation Summary

| ID | Classification | Recommendation | Evidence count | Risk | Confidence | Install recommendation |
| --- | --- | --- | ---: | --- | --- | --- |
| `rec-001` | Test Case Only | Install Fixture Set #001 as visual regression test cases. | 5 fixtures | Low/Medium | High | `install now` |
| `rec-002` | Test Case Only | Add a negative/confusion test for `Orange Shimmer, not Orange Sapphire` after human fixture approval. | 2 feedback records | Medium/High | Medium | `install later` |
| `rec-003` | Test Case Only | Add `Red Wave Refractor` as a visual test case after human fixture approval. | 1 feedback record | Medium | Medium/High | `install later` |
| `rec-004` | Needs More Evidence | Develop `Auto Grade Split` as a knowledge fixture before any production change. | 5 feedback records | Medium | Medium | `install later` |
| `rec-005` | Needs More Evidence | Keep `Series 2 / Major League Material Relic` checklist-dependent. | 3 feedback records | High | Medium | `do not install` |
| `rec-006` | Needs More Evidence | Keep `SSP case-hit / short-print language` in checklist review. | 8 feedback records | High | Medium | `do not install` |
| `rec-007` | Registry Update | Do not install visual concept registry updates yet. | 5 fixtures plus candidates | High | High | `do not install` |
| `rec-008` | Resolver Update | Do not install resolver rules for visual or checklist-dependent corrections. | 351 records reviewed | High | High | `do not install` |
| `rec-009` | Prompt Update | Do not install prompt changes from this cycle. | 351 records reviewed | Medium | Medium/High | `do not install` |
| `rec-010` | Needs More Evidence | Treat year/season normalization as a future product-policy project. | 21 added `2025-26`; repeated replacements | High | Medium | `do not install` |

## Recommendations

### rec-001: Install Fixture Set #001 As Test Cases

Classification: `Test Case Only`

Recommendation:

Create regression test cases for all five Fixture Set #001 fixtures. These tests should verify visual-review behavior and title-evidence preservation only. They should not change generated titles at runtime.

Evidence count:

- 5 verified fixtures
- 5 high-confidence visually supported concepts

Supporting fixtures:

| Fixture | Concept | Feedback record |
| --- | --- | --- |
| `visual-fixture-001-001` | `Sapphire` | `602f87e7-7372-4c5b-8115-00c0c91a4b08` |
| `visual-fixture-001-002` | `Bowman Sapphire / Padparadscha Refractor` | `4fa7153f-46c0-422a-946f-08874260eea8` |
| `visual-fixture-001-003` | `Gold Geometric` | `ebb6f765-aaad-4bbe-9001-2fe592d15172` |
| `visual-fixture-001-004` | `Blue Geometric Refractor` | `750306e2-9fa4-4ee9-b0bc-e98154b316cb` |
| `visual-fixture-001-005` | `Purple Raywave Refractor` | `0fa17bec-0996-46ea-bc12-4334eebedb3e` |

Risk level:

- Low for regression-test use.
- Medium if the tests are written too broadly and accidentally encode runtime assumptions.

Expected impact:

- Preserves the first durable learning assets.
- Prevents future visual-review regressions around Sapphire, Geometric, and Raywave concepts.
- Creates a safe path from feedback to reusable test knowledge without changing production behavior.

Confidence:

- High.

Install recommendation:

`install now` as test cases only, after human approval of the test artifact.

Do not install as:

- registry entries
- resolver rules
- prompt changes
- runtime title behavior

### rec-002: Add Orange Shimmer Negative/Confusion Test Later

Classification: `Test Case Only`

Recommendation:

Promote `Orange Shimmer, not Orange Sapphire` to a negative/confusion test only after human fixture approval. The test should guard against over-labeling Shimmer as Sapphire.

Evidence count:

- 2 feedback records in Fixture Set #002 candidates.

Supporting fixtures:

- None yet. This is still a candidate, not Fixture Set #002.

Supporting feedback records:

- `a3b3eb3c-c982-4033-ba51-172d561c1a4b`
- `abd544c9-1667-43aa-9a0f-9ef188e2593a`

Risk level:

- Medium/High.

Expected impact:

- Reduces the largest known Sapphire false-learning risk.
- Provides a necessary guardrail before any future Sapphire registry or resolver proposal.

Confidence:

- Medium.

Install recommendation:

`install later` as a negative/confusion test only.

Do not install as:

- registry update
- resolver update
- Sapphire upgrade rule
- prompt instruction to prefer Sapphire

### rec-003: Add Red Wave Refractor Test Later

Classification: `Test Case Only`

Recommendation:

Promote `Red Wave Refractor` to a visual test case after human fixture approval. It should test Wave versus generic Refractor language.

Evidence count:

- 1 feedback record in Fixture Set #002 candidates.

Supporting fixtures:

- None yet. This is still a candidate, not Fixture Set #002.

Supporting feedback record:

- `07515e36-27e2-4268-bc01-a4e0a61a82cf`

Risk level:

- Medium.

Expected impact:

- Expands pattern coverage beyond Set #001.
- Complements `Purple Raywave Refractor` with a related but distinct wave-pattern concept.

Confidence:

- Medium/High for test-case use.
- Low for registry or resolver use.

Install recommendation:

`install later` as a test case only.

Do not install as:

- registry update
- resolver update
- broad Wave inference rule

### rec-004: Develop Auto Grade Split As Knowledge Fixture

Classification: `Needs More Evidence`

Recommendation:

Prepare `Autograph / card-auto grade split` as a knowledge fixture candidate, not a runtime change. The goal is to preserve card grade and autograph grade as separate title concepts.

Evidence count:

- 5 feedback records in Fixture Set #002 candidates.

Supporting fixtures:

- None yet. This is still a candidate, not Fixture Set #002.

Supporting feedback records:

- `779c2f9d-279b-4e68-96f4-de98b7d4e158`
- `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
- `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`

Risk level:

- Medium.

Expected impact:

- Prevents dropping or merging high-value grade details.
- Improves future title evidence checks for PSA/BGS listings with both card and auto grades.

Confidence:

- Medium.

Install recommendation:

`install later` as a knowledge fixture and test case after human approval.

Do not install now because:

- No approved knowledge fixture exists yet.
- The exact rule boundary needs review across grading companies and slab formats.

### rec-005: Keep Series 2 / Major League Material Relic In Checklist Review

Classification: `Needs More Evidence`

Recommendation:

Do not install any registry, resolver, prompt, or test behavior for `Series 2 / Major League Material Relic` yet. Keep it as a hybrid fixture candidate requiring external checklist review.

Evidence count:

- 3 feedback records in Fixture Set #002 candidates.

Supporting fixtures:

- None yet. This is still a candidate, not Fixture Set #002.

Supporting feedback records:

- `06ec530c-6a20-4e70-9347-5c8770da261c`
- `59bfa141-3795-486d-8e17-6ea8faf3d92f`
- `43895330-8edd-479a-a199-007fd36ae798`

Risk level:

- High.

Expected impact if eventually approved:

- Better handling of relic/material naming.
- Better uncertainty preservation around `Series 2`, `Gold`, and relic checklist names.

Confidence:

- Medium that the candidate is worth review.
- Low that anything should be installed now.

Install recommendation:

`do not install`.

Reason:

Visual Review #001B found relic/material evidence but also uncertainty and external-checklist dependency. That is not enough for any installed behavior.

### rec-006: Keep SSP / Case-Hit Language In Checklist Review

Classification: `Needs More Evidence`

Recommendation:

Do not install SSP, SP, case-hit, Shadow Etch, Home Advantage, Pixel Burst, or similar scarcity language as registry, resolver, or prompt behavior. Continue building checklist-backed evidence packages.

Evidence count:

- 8 feedback records in Fixture Set #002 candidates.
- 45 SSP/case-hit correction matches in current dataset analysis.

Supporting fixtures:

- None yet. This is still a candidate, not Fixture Set #002.

Supporting feedback records:

- `02ba3de0-42f7-4139-9967-748d7c78d5e6`
- `a330845d-4308-4997-b9ab-9667b8899455`
- `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`

Risk level:

- High.

Expected impact if eventually approved:

- High-value listing accuracy for scarcity and case-hit cards.
- Better preservation of SSP/case-hit terms when externally confirmed.

Confidence:

- Medium that this is an important learning category.
- Low for installation now.

Install recommendation:

`do not install`.

Reason:

SSP and case-hit status often require product-specific checklist confirmation. Text diffs and image identification are not enough.

### rec-007: Do Not Install Registry Updates

Classification: `Registry Update`

Recommendation:

Do not install any registry update from this cycle.

Evidence count:

- 5 verified fixtures.
- 5 Fixture Set #002 candidates.
- 351 total feedback records reviewed as dataset context.

Supporting fixtures:

- Fixture Set #001 supports test cases, not registry installation.

Supporting feedback records:

- All Fixture Set #001 feedback IDs listed in `rec-001`.
- Fixture Set #002 candidate IDs listed in `rec-002` through `rec-006`.

Risk level:

- High.

Expected impact:

- No immediate production improvement.
- Prevents premature durable knowledge entries that could over-label Sapphire, SSP, case-hit, season/year, or relic concepts.

Confidence:

- High.

Install recommendation:

`do not install`.

Reason:

The promotion framework requires repeated aligned examples, guardrails, and separate implementation review before registry candidacy. The current fixtures are mature as tests, not as title knowledge entries.

### rec-008: Do Not Install Resolver Updates

Classification: `Resolver Update`

Recommendation:

Do not install resolver rules for any current correction class.

Evidence count:

- 351 current records.
- 248 image-backed records.
- 293 candidates from Review Cycle #001, with 267 marked Needs More Evidence.
- 5 verified fixtures.

Supporting fixtures:

- Fixture Set #001 provides positive visual examples but not enough aligned examples or negative/confusion examples for resolver behavior.

Supporting feedback records:

- `602f87e7-7372-4c5b-8115-00c0c91a4b08`
- `4fa7153f-46c0-422a-946f-08874260eea8`
- `ebb6f765-aaad-4bbe-9001-2fe592d15172`
- `750306e2-9fa4-4ee9-b0bc-e98154b316cb`
- `0fa17bec-0996-46ea-bc12-4334eebedb3e`

Risk level:

- High.

Expected impact:

- Avoids false positives in production title generation.
- Keeps deterministic behavior unchanged until fixture coverage is broader.

Confidence:

- High.

Install recommendation:

`do not install`.

Reason:

The framework requires at least five aligned low-ambiguity examples for resolver candidacy and negative/confusion examples for risky concepts. None of the verified fixture concepts meet that bar yet.

### rec-009: Do Not Install Prompt Updates

Classification: `Prompt Update`

Recommendation:

Do not install prompt changes from this cycle.

Evidence count:

- 351 current records.
- 248 image-backed records.
- 11 Vision-reviewed candidates.
- 5 verified fixtures.

Supporting fixtures:

- Fixture Set #001 can inform future prompt evaluation, but should not directly mutate prompts.

Supporting feedback records:

- Same five Fixture Set #001 records listed in `rec-001`.

Risk level:

- Medium.

Expected impact:

- Avoids changing model behavior based on a small fixture set.
- Keeps learning work in the safer fixture/test layer.

Confidence:

- Medium/High.

Install recommendation:

`do not install`.

Reason:

The archive has identified useful warnings, such as not inferring Sapphire/SSP/checklist concepts too broadly, but those warnings should first be encoded as tests and review criteria. Prompt changes would be harder to scope and rollback.

### rec-010: Do Not Install Year / Season Normalization

Classification: `Needs More Evidence`

Recommendation:

Do not install any year or season normalization rule such as converting `2025` or `2026` to `2025-26`.

Evidence count:

- `2025-26` added 21 times in the current dataset analysis.
- Common replacements include `2026` -> `2025-26` 9 times and `2025` -> `2025-26` 8 times.
- Review Cycle #001 surfaced repeated season/year replacements.

Supporting fixtures:

- None. No approved fixture covers this as a safe product-year rule.

Supporting feedback records:

- Examples from Review Cycle #001 include:
  - `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  - `a330845d-4308-4997-b9ab-9667b8899455`
  - `8cead21f-3620-416b-aa6f-4ef0c6880128`
  - `175d492f-5743-4564-9e10-932164ff6199`
  - `d100faf0-b51d-44cf-8e31-82e0bab919ba`

Risk level:

- High.

Expected impact if eventually approved:

- Could improve sport/year formatting for basketball, soccer, and collegiate products.

Confidence:

- Medium that the pattern is real.
- Low that the pattern is safe as a rule.

Install recommendation:

`do not install`.

Reason:

Year and season conventions are product-specific. Visual Review #001B also showed that year/product corrections can be wrong or visually unsupported in at least some cases.

## What Should Actually Change Now

Recommended now:

1. Convert Fixture Set #001 into five regression test cases after human approval.

Not recommended now:

1. No registry changes.
2. No resolver changes.
3. No prompt changes.
4. No runtime title-generation changes.
5. No checklist-dependent SSP/case-hit upgrades.
6. No broad Sapphire upgrades.
7. No year/season normalization rules.

## Installation Readiness By Category

| Category | Mature enough for install? | Recommended installed surface |
| --- | --- | --- |
| Fixture Set #001 visual concepts | Yes | Tests only |
| Fixture Set #002 visual candidates | Not yet | Later fixtures/tests |
| Sapphire registry knowledge | No | None |
| Shimmer/Sapphire distinction | Not yet | Later negative/confusion test |
| SSP/case-hit language | No | None |
| Auto grade split | Not yet | Later knowledge fixture/test |
| Series 2 relic language | No | None |
| Year/season normalization | No | None |
| Serial correction behavior | No | None |
| Prompt caution rules | No | None |

## Risk Notes

- The dataset is large enough to show recurring patterns, but not enough to justify production rules without fixture-backed guardrails.
- Review Cycle #001 was text-diff-driven and explicitly warned that visual concepts must not be promoted without visual verification.
- Visual Review #001B proved that Vision can produce useful evidence, but also showed unsupported or checklist-dependent corrections.
- Fixture Set #001 is valuable because it is narrow. Its value would be reduced if converted into broad runtime assumptions.
- Fixture Set #002 should be selected next, but it should not be treated as installed knowledge.

## Non-Goals

This recommendation package did not:

- modify runtime code
- modify the registry
- modify the resolver
- modify prompts
- modify tests
- install upgrades
- create new fixtures
- download images
- commit exported raw data

## Recommended Next 3 Actions

1. Human-approve Fixture Set #001 as five visual regression test cases.
2. Create Fixture Set #002 from the current candidates, prioritizing one visual positive, one negative/confusion, one knowledge fixture, and one hybrid fixture.
3. Define checklist-source policy before revisiting SSP, case-hit, Series 2, exact relic names, or season/year normalization.
