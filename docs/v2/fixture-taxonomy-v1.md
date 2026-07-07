# Fixture Taxonomy V1

Status: Taxonomy Draft, No Fixtures Created
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Source Documents:

- `fixtures/visual-fixture-set-001.md`
- `fixture-review-001.md`
- `fixture-set-002-candidates.md`
- `visual-test-fixture-library-v1.md`

## Scope

This document defines the first taxonomy for Listing Copilot fixture types.

It classifies fixture concepts by the kind of evidence needed to review and use them safely. It does not create Fixture Set #002 and does not change any fixture status.

No runtime title generation, registry, resolver, prompt, deployment, or upgrade changes are included.

## Taxonomy Summary

| Fixture type | Primary evidence | Review center | Example concepts |
| --- | --- | --- | --- |
| Visual Fixture | Image-visible card design, pattern, color, label, serial, or text cue | Visual review, then human confirmation | `Sapphire`, `Raywave`, `Geometric`, `Shimmer` |
| Knowledge Fixture | Card-domain rule, product structure, checklist fact, grading convention, or scarcity language | Human/card-domain review, often with checklist support | `SSP`, `Case Hit`, `Auto Grade Split`, `Series 2 Relic` |
| Hybrid Fixture | Both image evidence and card-domain knowledge are required | Visual review plus checklist/domain confirmation | `Bowman Sapphire / Padparadscha Refractor`, `Orange Shimmer, not Orange Sapphire`, `Series 2 / Major League Material Relic`, `SSP case-hit / short-print language` |

## 1. Visual Fixture

Definition:

A Visual Fixture is a reviewed example where the target concept is primarily supported by visible image evidence. The image evidence may come from the card front, card back, slab label, visible serial numbering, visible product code, or visible design pattern.

The key test is whether a reviewer can point to concrete visual cues in the supplied images that support the concept without relying mainly on an external checklist or hidden product knowledge.

Examples:

| Concept | Source | Evidence role |
| --- | --- | --- |
| `Sapphire` | Fixture Set #001 | Positive visual fixture supported by slab/card identifiers and Sapphire-specific labeling. |
| `Gold Geometric` | Fixture Set #001 | Positive visual fixture supported by gold coloration and geometric foil pattern. |
| `Blue Geometric Refractor` | Fixture Set #001 | Positive visual fixture supported by visible blue geometric/checkered refractor pattern. |
| `Purple Raywave Refractor` | Fixture Set #001 | Positive visual fixture supported by visible wavy/raywave foil pattern. |
| `Red Wave Refractor` | Fixture Set #002 candidates | Candidate visual fixture for wave-pattern coverage. |
| `Shimmer` | Fixture Set #002 candidates | Candidate negative/confusion fixture when image evidence favors Shimmer rather than Sapphire. |

Expected review process:

1. Confirm that front and back image URLs are available and reviewable.
2. Identify the visual cue that supports the concept: pattern, color, slab text, card code, serial number, set text, logo, or other visible mark.
3. Compare the concept against its confusion target, such as `Purple Refractor` versus `Purple Raywave Refractor`.
4. Assign an evidence role: `positive`, `negative`, or `confusion`.
5. Keep the review as fixture evidence until a separate human-approved implementation path exists.

Expected future use:

- Regression tests for visual review behavior.
- Guardrails against collapsing specific visual parallels into generic parallel names.
- Negative/confusion tests for nearby visual concepts such as Sapphire versus Shimmer.
- Human-review evidence for later fixture library promotion.

Visual Fixtures should not automatically create registry entries, resolver rules, prompt changes, or runtime title changes.

## 2. Knowledge Fixture

Definition:

A Knowledge Fixture is a reviewed example where the target concept depends primarily on card-domain knowledge rather than image-visible pattern recognition alone.

The evidence may include product checklists, scarcity conventions, grading-label conventions, insert/set taxonomy, release structure, or known case-hit and SSP naming rules. Images can still be useful, but the decisive claim cannot be safely verified from visual cues alone.

Examples:

| Concept | Source | Evidence role |
| --- | --- | --- |
| `SSP` | Fixture Set #002 candidates | Candidate knowledge fixture for short-print language that usually requires product-specific confirmation. |
| `Case Hit` | Fixture Set #002 candidates | Candidate knowledge fixture for product-level scarcity or insert status. |
| `Auto Grade Split` | Fixture Set #002 candidates | Candidate knowledge fixture for preserving separate card grade and autograph grade. |
| `Series 2 Relic` | Fixture Set #002 candidates | Candidate knowledge fixture when set/relic naming depends on checklist or product context. |

Expected review process:

1. Identify the claim that requires domain knowledge, such as SSP status, case-hit status, set membership, or grade interpretation.
2. Separate visible evidence from inferred knowledge. For example, a slab may visibly show `PSA 9` and `Auto 10`, while the rule is that card grade and autograph grade must remain distinct.
3. Check product-specific sources before treating scarcity, insert, or checklist language as approved fixture truth.
4. Mark checklist-dependent concepts as uncertain until the domain evidence is reviewed.
5. Preserve the reviewed example as a candidate, confusion case, or approved knowledge fixture only after human/card-domain review.

Expected future use:

- Regression tests for preserving card-domain distinctions such as card grade versus autograph grade.
- Review queues for checklist-dependent terms such as `SSP`, `Case Hit`, `Home Advantage`, `Shadow Etch`, and `Pixel Burst`.
- Evidence packages for future registry or resolver proposals, without automatically installing those proposals.
- Quality checks that prevent unsupported scarcity or set claims from being added only because they appear in corrected titles.

Knowledge Fixtures should not rely on image confidence alone. They require explicit domain review before they can be used as approved regression examples.

## 3. Hybrid Fixture

Definition:

A Hybrid Fixture is a reviewed example where image evidence and card-domain knowledge are both necessary. The image may show a pattern, label, serial number, autograph, material relic, or product code, while the exact title-safe concept requires domain knowledge such as checklist confirmation, product release structure, or grading/scarcity rules.

Hybrid Fixtures are expected to be common in high-value collectibles because the visible card may prove one part of the title while the precise market term requires product-specific context.

Examples:

| Concept | Source | Evidence role |
| --- | --- | --- |
| `Bowman Sapphire / Padparadscha Refractor` | Fixture Set #001 | Visual evidence supports Sapphire-like design and 1/1 context, while exact parallel naming is high-risk and domain-sensitive. |
| `Orange Shimmer, not Orange Sapphire` | Fixture Set #002 candidates | Image evidence can distinguish Shimmer-like appearance, while exact set/parallel naming may require checklist review. |
| `Series 2 / Major League Material Relic` | Fixture Set #002 candidates | Image evidence can support material/relic status, while `Series 2` and `Gold` language require external confirmation. |
| `SSP case-hit / short-print language` | Fixture Set #002 candidates | Images can identify the card, but SSP/case-hit status generally depends on product-specific knowledge. |

Expected review process:

1. Review images first and record what is directly visible.
2. Record which title claims remain unresolved after visual review.
3. Require checklist or domain verification for exact product, set, insert, scarcity, or parallel language.
4. Assign a conservative status such as `confusion` or `needs_external_checklist` when either evidence side is incomplete.
5. Promote to an approved fixture only after both visual and knowledge evidence are reconciled by human review.

Expected future use:

- Regression tests that preserve uncertainty instead of over-upgrading title language.
- Confusion fixtures for concepts where visual similarity can mislead the system, such as Shimmer versus Sapphire.
- Checklist review queues for high-value title terms before any runtime behavior is proposed.
- Evaluation cases for whether the system can distinguish visible support from domain inference.

Hybrid Fixtures should be treated as the highest-risk category. They are valuable because they preserve difficult cases, but they should remain review artifacts until both evidence paths are resolved.

## Classification Guidance

Use the narrowest safe fixture type:

| If the concept is supported by... | Classify as |
| --- | --- |
| Visible pattern, color, label, serial, code, or text cue in the images | `Visual Fixture` |
| Checklist facts, scarcity conventions, set structure, or grading interpretation | `Knowledge Fixture` |
| A visible cue plus a product-specific or checklist-dependent interpretation | `Hybrid Fixture` |

If a fixture could fit more than one category, classify it as `Hybrid Fixture` until review shows that one evidence path is sufficient.

## Non-Goals

This taxonomy does not:

- create new fixtures
- create Fixture Set #002
- approve Fixture Set #002 candidates
- modify runtime code
- modify the registry
- modify the resolver
- modify prompts
- install upgrades
- treat visual review output as final truth

## Recommended Next Step

Use this taxonomy as the classification layer when the next human-reviewed fixture selection step begins.

Fixture Set #002 candidates should remain candidates until each one receives an explicit fixture type, evidence role, review status, and human-review decision.
