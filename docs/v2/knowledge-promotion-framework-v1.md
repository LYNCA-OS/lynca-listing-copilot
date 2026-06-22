# Knowledge Promotion Framework V1

Status: Promotion Framework Draft, No Promotions Installed
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Source Documents:

- `dataset-snapshot-002.md`
- `supabase-dataset-analysis-current.md`
- `fixture-taxonomy-v1.md`
- `fixtures/visual-fixture-set-001.md`
- `fixture-review-001.md`
- `fixture-set-002-candidates.md`

## Scope

This document defines how knowledge should move through the Listing Copilot system.

Current learning layers:

```text
Feedback
↓
Evidence
↓
Vision Review
↓
Fixture
```

This framework defines when a Fixture may become one of the following:

- `Test Case`
- `Registry Candidate`
- `Resolver Candidate`
- `Knowledge Fixture`
- `Hybrid Fixture`

No runtime title generation, registry, resolver, prompt, deployment, or upgrade changes are included.

## Layer Definitions

| Layer | Definition | Promotion gate |
| --- | --- | --- |
| Feedback | Raw operator correction row from `listing_title_feedback`. | Must include generated and corrected title. |
| Evidence | Feedback row with reviewable evidence: image URLs, repeated correction pattern, or checklist/domain source. | Must be grouped into a concept or confusion class. |
| Vision Review | Image-backed evidence reviewed for visible support, uncertainty, and checklist dependency. | Must produce an explanation and confidence. |
| Fixture | Human-reviewable example with stable source feedback, concept, evidence role, and review status. | Must be approved for a downstream path before use. |
| Test Case | Fixture used to prevent regression in review or title-evidence behavior. | Requires human approval as a test artifact. |
| Registry Candidate | Fixture-backed concept that may later become a controlled title knowledge entry. | Requires repeated evidence and separate implementation review. |
| Resolver Candidate | Fixture-backed deterministic correction pattern that may later become resolver behavior. | Requires high repeatability, low ambiguity, and separate implementation review. |
| Knowledge Fixture | Fixture whose decisive claim depends on card-domain knowledge. | Requires domain/checklist approval. |
| Hybrid Fixture | Fixture requiring both image evidence and card-domain knowledge. | Requires visual and domain approval. |

## Promotion Principles

1. Feedback is not knowledge until evidence is reviewed.
2. Vision support is evidence, not final truth.
3. Fixtures are review artifacts before they are system behavior.
4. Test cases are the first safe downstream use of a fixture.
5. Registry and resolver candidates are proposals only; they require a separate implementation decision.
6. Checklist-dependent claims must not be promoted from title text alone.
7. Negative and confusion fixtures are as important as positive fixtures because they prevent false learning.

## Path Summary

| Destination | Minimum evidence count | Vision review | Human approval | Risk level |
| --- | ---: | --- | --- | --- |
| `Test Case` | 1 strong fixture | Required for image-backed visual/hybrid cases; optional for text-only knowledge cases | Required | Low to Medium |
| `Registry Candidate` | 3 aligned examples, or 1 exceptionally explicit checklist-backed example | Required when concept has visual component | Required, plus implementation review | Medium to High |
| `Resolver Candidate` | 5 aligned examples with low ambiguity | Required when resolver uses image-visible concept | Required, plus implementation review | High |
| `Knowledge Fixture` | 2 aligned examples, or 1 explicit authoritative source-backed example | Optional unless images are part of the claim | Required domain/checklist approval | Medium to High |
| `Hybrid Fixture` | 2 aligned image-backed examples preferred; 1 allowed for rare/high-value cases | Required | Required visual and domain approval | High |

Minimum counts are gates for review eligibility, not automatic approval.

## 1. Fixture To Test Case

Definition:

A Test Case is a fixture used for regression testing. It verifies that future review or title-evidence changes do not lose known distinctions.

Minimum evidence count:

- 1 fixture is sufficient if the image evidence is clear or the domain claim is explicit.
- Negative/confusion test cases may also be created from 1 high-value ambiguity case.

Vision review requirement:

- Required for visual fixtures and hybrid fixtures.
- Optional for pure knowledge fixtures when no image claim is being tested.
- Vision output must include confidence, supported/uncertain status, and an explanation.

Human approval requirement:

- Required.
- Approval should say what the test protects and what it must not imply.

Risk level:

- Low for visual pattern regression tests.
- Medium for high-value, ambiguous, or checklist-dependent tests.

Promotion criteria:

- Source feedback is stable and includes generated/corrected title pair.
- Expected concept and confusion target are clear.
- Evidence role is assigned as `positive`, `negative`, or `confusion`.
- Test assertion is narrow enough to avoid becoming a runtime rule.

Rollback criteria:

- Source image URLs become inaccessible and no approved replacement exists.
- Human reviewer later rejects the concept or explanation.
- Checklist review contradicts the fixture claim.
- The test is found to encode an overbroad rule rather than a specific evidence expectation.

Examples:

| Example | Source | Test case posture |
| --- | --- | --- |
| `Sapphire` | Fixture Set #001 | Good test case for preserving explicit Sapphire evidence and avoiding generic `Topps Chrome`. |
| `Gold Geometric` | Fixture Set #001 | Good test case for color plus geometric pattern recognition. |
| `Blue Geometric Refractor` | Fixture Set #001 | Good test case for distinguishing geometric pattern from generic `Blue Refractor`. |
| `Purple Raywave Refractor` | Fixture Set #001 | Good test case for distinguishing wavy/raywave foil from generic `Purple Refractor`. |
| `Red Wave Refractor` | Fixture Set #002 candidates | Good next test case candidate after human fixture approval. |
| `Orange Shimmer, not Orange Sapphire` | Fixture Set #002 candidates | Good negative/confusion test case candidate after human review. |

## 2. Fixture To Registry Candidate

Definition:

A Registry Candidate is a fixture-backed concept that may later become a controlled knowledge entry for title generation or title validation.

This status does not install the registry entry. It only means the concept is ready for a separate registry proposal.

Minimum evidence count:

- 3 aligned examples for normal concepts.
- 5 aligned examples for high-risk concepts such as `Sapphire`, `SSP`, `Case Hit`, or product/year inference.
- 1 example may be enough only when the evidence is explicit, authoritative, and narrow, such as readable slab text plus card code for a specific product.

Vision review requirement:

- Required when the candidate depends on visual evidence.
- Required for visual parallels, product design patterns, and image-visible set identifiers.
- Not sufficient by itself for checklist-dependent claims.

Human approval requirement:

- Required for candidate status.
- Separate approval is required before any actual registry change.

Risk level:

- Medium for visually distinct parallels with clear confusion boundaries.
- High for product/set, scarcity, checklist, or case-hit concepts.

Promotion criteria:

- Concept has stable naming and a known confusion boundary.
- Evidence examples agree on the same concept and do not include unresolved contradictions.
- Negative/confusion examples are available or queued for risky neighboring concepts.
- The proposed registry entry can be scoped narrowly enough to avoid broad inference.

Rollback criteria:

- New feedback shows repeated false positives for the concept.
- Checklist evidence contradicts the proposed concept.
- The concept name is found to be product-specific rather than globally reusable.
- A negative/confusion fixture shows that the registry candidate would over-label similar cards.

Examples:

| Example | Source | Registry candidate posture |
| --- | --- | --- |
| `Sapphire` | Fixture Set #001 | Not ready for registry installation; possible future candidate only with Shimmer/Sapphire guardrails. |
| `Gold Geometric` | Fixture Set #001 | Possible future registry candidate if additional examples confirm stable visual naming. |
| `Purple Raywave Refractor` | Fixture Set #001 | Possible future registry candidate after more Raywave examples and negative generic-refractor cases. |
| `Red Wave Refractor` | Fixture Set #002 candidates | Candidate discovery only; needs fixture approval and more examples before registry candidacy. |
| `SSP case-hit / short-print language` | Fixture Set #002 candidates | Not registry-ready; requires product-specific checklist proof and strict scoping. |

## 3. Fixture To Resolver Candidate

Definition:

A Resolver Candidate is a fixture-backed deterministic correction pattern that may later become rule-based behavior.

This is the highest-risk promotion path because resolver behavior changes system output directly.

Minimum evidence count:

- 5 aligned examples with the same correction pattern and low ambiguity.
- 10 examples preferred for product/year normalization, scarcity terms, or common parallel families.
- At least 2 negative/confusion examples should be reviewed for high-risk concepts.

Vision review requirement:

- Required if resolver behavior would depend on visual cues.
- Required for visual parallel distinctions such as `Raywave`, `Geometric`, `Wave`, `Shimmer`, or `Sapphire`.
- Not enough for checklist-dependent concepts.

Human approval requirement:

- Required for resolver candidate status.
- Separate implementation approval is required before any resolver change.

Risk level:

- High by default.
- Very high for scarcity, case-hit, product/year normalization, and checklist-dependent corrections.

Promotion criteria:

- Correction is repeatable and narrowly scoped.
- Required input evidence is available to the resolver path.
- False-positive cost is understood and accepted.
- Rollback plan exists before implementation.
- Candidate has fixtures proving both positive behavior and nearby negative/confusion behavior.

Rollback criteria:

- Any production or review example shows the resolver over-applies the correction.
- Required evidence is unavailable at runtime.
- A checklist or product update invalidates the mapping.
- Human reviewers cannot explain the rule in a narrow, auditable way.

Examples:

| Example | Source | Resolver candidate posture |
| --- | --- | --- |
| `Blue Geometric Refractor` over `Blue Refractor` | Fixture Set #001 | Not resolver-ready; useful test case first. |
| `Purple Raywave Refractor` over `Purple Refractor` | Fixture Set #001 | Not resolver-ready; needs more examples and negative cases. |
| `Orange Shimmer, not Orange Sapphire` | Fixture Set #002 candidates | Better as a negative/confusion test than resolver behavior for now. |
| `Series 2 / Major League Material Relic` | Fixture Set #002 candidates | Not resolver-ready; checklist-dependent and visually uncertain. |
| `SSP case-hit / short-print language` | Fixture Set #002 candidates | Not resolver-ready; high false-positive cost. |

## 4. Fixture To Knowledge Fixture

Definition:

A Knowledge Fixture is a fixture where the decisive claim depends on card-domain knowledge, such as checklist status, grading convention, insert taxonomy, set structure, season naming, or scarcity language.

Minimum evidence count:

- 2 aligned examples for repeatable domain concepts.
- 1 example allowed if it has authoritative external confirmation or explicit slab/checklist support.
- 5 examples preferred before using the knowledge fixture as evidence for registry or resolver candidacy.

Vision review requirement:

- Optional if the claim is purely text/checklist/domain based.
- Required if image evidence is used to identify the card, slab, grade, or set.
- Vision should separate visible evidence from inferred domain knowledge.

Human approval requirement:

- Required.
- Must include card-domain or checklist approval when the concept depends on external product knowledge.

Risk level:

- Medium for grading conventions such as card grade versus autograph grade.
- High for `SSP`, `Case Hit`, set identity, exact insert names, or scarcity language.

Promotion criteria:

- Domain rule is explicit and narrow.
- Evidence identifies which part is visible and which part is knowledge-based.
- Checklist-dependent terms have a cited or recorded authoritative confirmation.
- The fixture includes enough context to prevent broad inference.

Rollback criteria:

- Checklist/source is later contradicted or deemed non-authoritative.
- The fixture merges visible evidence and inferred knowledge in a misleading way.
- New examples show the same text pattern maps to multiple product meanings.
- Human reviewer cannot reproduce the domain decision.

Examples:

| Example | Source | Knowledge fixture posture |
| --- | --- | --- |
| `Autograph / card-auto grade split` | Fixture Set #002 candidates | Strong knowledge fixture candidate; preserves PSA/BGS card grade versus auto grade distinction. |
| `SSP case-hit / short-print language` | Fixture Set #002 candidates | Strong candidate queue, but requires checklist/product confirmation before approval. |
| `Series 2 Relic` | Fixture Set #002 candidates | Knowledge component exists, but likely hybrid because relic evidence is visual. |
| `2025` / `2026` to `2025-26` season corrections | Current dataset analysis | Candidate family only; needs product-release policy before promotion. |

## 5. Fixture To Hybrid Fixture

Definition:

A Hybrid Fixture requires both image evidence and card-domain knowledge. The image may prove the card, design, serial, autograph, slab label, or relic, while exact title-safe language requires checklist or product-specific interpretation.

Minimum evidence count:

- 2 aligned image-backed examples preferred.
- 1 rare or high-value example allowed if the uncertainty is clearly recorded.
- Additional negative/confusion examples required before registry or resolver candidacy.

Vision review requirement:

- Required.
- Vision must state what is visually supported, what is uncertain, and what needs checklist review.

Human approval requirement:

- Required.
- Must include approval of both the visual claim and the domain claim.

Risk level:

- High by default.

Promotion criteria:

- Front and back image evidence are available unless the missing side is irrelevant.
- Visual evidence and domain evidence are recorded separately.
- Checklist-dependent claims are not treated as visually proven.
- Fixture role is clear: `positive`, `negative`, or `confusion`.
- Human reviewer agrees that the fixture should preserve uncertainty where needed.

Rollback criteria:

- Either the visual claim or domain claim is later rejected.
- Checklist review cannot confirm the title-safe concept.
- The fixture causes over-promotion of ambiguous concepts.
- The concept is better represented as two separate fixtures, one visual and one knowledge.

Examples:

| Example | Source | Hybrid fixture posture |
| --- | --- | --- |
| `Bowman Sapphire / Padparadscha Refractor` | Fixture Set #001 | Already useful as a high-risk test case; exact parallel naming remains domain-sensitive. |
| `Orange Shimmer, not Orange Sapphire` | Fixture Set #002 candidates | Strong negative/confusion hybrid candidate; visual evidence plus checklist-sensitive naming. |
| `Series 2 / Major League Material Relic` | Fixture Set #002 candidates | Strong hybrid candidate; material/relic evidence may be visible, while Series 2/Gold language needs checklist review. |
| `SSP case-hit / short-print language` | Fixture Set #002 candidates | Hybrid when image identifies the card but SSP/case-hit status comes from product knowledge. |

## Promotion Decision Table

| Candidate | Current layer | Next safe path | Reason |
| --- | --- | --- | --- |
| `Sapphire` | Fixture Set #001 | Test Case | Good visual evidence, but registry/resolver promotion needs Shimmer/Sapphire guardrails. |
| `Bowman Sapphire / Padparadscha Refractor` | Fixture Set #001 | Test Case / Hybrid Fixture | High-value and high-risk; keep exact naming under review. |
| `Gold Geometric` | Fixture Set #001 | Test Case | Clear visual pattern and color evidence. |
| `Blue Geometric Refractor` | Fixture Set #001 | Test Case | Clear visual confusion target: generic `Blue Refractor`. |
| `Purple Raywave Refractor` | Fixture Set #001 | Test Case | Clear visual confusion target: generic `Purple Refractor`. |
| `Red Wave Refractor` | Fixture Set #002 candidate | Test Case candidate | Clean uncovered visual pattern, but only one evidence example. |
| `Auto Grade Split` | Fixture Set #002 candidate | Knowledge Fixture candidate | Five examples and high-value grade semantics. |
| `Orange Shimmer, not Orange Sapphire` | Fixture Set #002 candidate | Hybrid Fixture / negative Test Case candidate | Prevents false Sapphire learning. |
| `Series 2 / Major League Material Relic` | Fixture Set #002 candidate | Hybrid Fixture candidate | Needs checklist review before any stronger promotion. |
| `SSP case-hit / short-print language` | Fixture Set #002 candidate | Knowledge/Hybrid Fixture candidate | Eight examples, but checklist-dependent and high-risk. |

## Rollback Standards

Every promoted artifact should retain:

- source feedback IDs
- generated and corrected titles
- image URLs when available
- evidence role
- review status
- reviewer decision
- reason for promotion
- reason for rollback if demoted

Rollback is required when:

- evidence becomes unavailable
- visual review was wrong or incomplete
- checklist review contradicts the fixture
- a promoted candidate creates false positives
- the concept boundary is broader than originally understood
- the fixture cannot be reproduced by a later reviewer

Rollback should demote the artifact to the safest previous layer:

| Problem | Roll back to |
| --- | --- |
| Runtime behavior is unsafe | Fixture or Test Case |
| Registry concept is too broad | Fixture |
| Resolver rule over-applies | Test Case or Fixture |
| Checklist evidence is unresolved | Hybrid Fixture candidate or Evidence |
| Image evidence is missing or inaccessible | Feedback or Evidence |

## Non-Goals

This framework does not:

- promote any fixture
- create Fixture Set #002
- modify runtime code
- modify the registry
- modify the resolver
- modify prompts
- install upgrades
- treat Vision output as final truth

## Recommended Next Step

Use this framework to review Fixture Set #001 as test cases and Fixture Set #002 candidates as either visual, knowledge, or hybrid fixture candidates before any registry, resolver, prompt, or runtime proposal is considered.
