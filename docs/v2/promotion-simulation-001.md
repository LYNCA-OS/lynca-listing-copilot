# Promotion Simulation #001

Status: Simulation Only, No Promotions Installed
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Source Documents:

- `fixture-review-001.md`
- `fixtures/visual-fixture-set-001.md`
- `knowledge-promotion-framework-v1.md`

## Scope

This document simulates the first knowledge promotion cycle for the five verified fixtures in Fixture Set #001.

It does not install test cases, registry entries, resolver rules, prompt changes, runtime behavior, or upgrades.

## Simulation Rules

This simulation applies `knowledge-promotion-framework-v1.md` conservatively:

- A fixture may become a `Test Case` with one strong fixture, vision review, and human approval as a test artifact.
- A fixture should not become a `Registry Candidate` unless it has repeated aligned evidence or exceptionally explicit authoritative evidence plus guardrails.
- A fixture should not become a `Resolver Candidate` unless it has at least five aligned examples, low ambiguity, and reviewed negative/confusion examples.
- Human-review-pending fixtures can be recommended for promotion, but actual promotion still requires human approval.

## Decision Summary

| Fixture | Concept | Simulated decision | Registry candidate? | Resolver candidate? | Reason |
| --- | --- | --- | --- | --- | --- |
| `visual-fixture-001-001` | `Sapphire` | Promote to Test Case | No | No | Strong explicit evidence, but Sapphire has known false-positive risk. |
| `visual-fixture-001-002` | `Bowman Sapphire / Padparadscha Refractor` | Promote to Test Case | No | No | High-value hybrid-like example; exact naming is too risky for registry/resolver promotion. |
| `visual-fixture-001-003` | `Gold Geometric` | Promote to Test Case | No | No | Clean visual pattern/color distinction, but only one fixture example. |
| `visual-fixture-001-004` | `Blue Geometric Refractor` | Promote to Test Case | No | No | Clear visual confusion target, but needs more examples before stronger promotion. |
| `visual-fixture-001-005` | `Purple Raywave Refractor` | Promote to Test Case | No | No | Strong wave-pattern regression value, but not enough evidence for resolver or registry. |

Simulation result:

| Outcome | Count |
| --- | ---: |
| Promote to Test Case | 5 |
| Promote to Registry Candidate | 0 |
| Promote to Resolver Candidate | 0 |
| Remain Fixture only | 0 |
| Needs More Evidence before Test Case | 0 |
| Needs More Evidence before Registry/Resolver | 5 |

## Fixture Decisions

### visual-fixture-001-001

| Field | Value |
| --- | --- |
| concept | `Sapphire` |
| source feedback id | `602f87e7-7372-4c5b-8115-00c0c91a4b08` |
| fixture role | `positive` |
| visual confidence | `High` |
| confusion target | `Topps Chrome without Sapphire` |
| simulated decision | `Promote to Test Case` |
| risk level | `Medium` |

Why promote to Test Case:

The fixture has strong direct evidence from the PSA slab and card identifiers. It is useful as a regression case to confirm that explicit Sapphire evidence is preserved and not collapsed into generic `Topps Chrome`.

Why not Registry Candidate:

Sapphire is a known false-learning risk because nearby concepts such as Shimmer can be over-labeled as Sapphire. The promotion framework requires guardrails and repeated aligned evidence for high-risk concepts before registry candidacy.

Why not Resolver Candidate:

There is only one verified fixture in this set for this exact Sapphire correction. A resolver path would need repeated aligned examples, runtime-available evidence, and negative/confusion fixtures.

Promotion criteria met:

- Stable source feedback row.
- Front and back image URLs available.
- High-confidence visual review.
- Clear generated/corrected title pair.
- Clear confusion target.

Rollback criteria for simulated test case:

- Demote if the image URLs become unavailable.
- Demote if human review rejects the Sapphire interpretation.
- Demote if the test assertion starts implying broad Sapphire inference from generic Chrome evidence.

### visual-fixture-001-002

| Field | Value |
| --- | --- |
| concept | `Bowman Sapphire / Padparadscha Refractor` |
| source feedback id | `4fa7153f-46c0-422a-946f-08874260eea8` |
| fixture role | `positive` |
| visual confidence | `High` |
| confusion target | `standard Bowman Chrome` |
| simulated decision | `Promote to Test Case` |
| risk level | `High` |

Why promote to Test Case:

The fixture protects a valuable distinction between standard Bowman Chrome and a more specific Sapphire/Padparadscha-style high-value parallel. It is useful for regression testing because the explanation must cite visual pattern evidence, 1/1 context, and autograph context without turning that evidence into an automatic rule.

Why not Registry Candidate:

The exact `Bowman Sapphire / Padparadscha Refractor` naming is high-risk and domain-sensitive. One fixture is not enough to prove a stable registry concept, especially when nearby Sapphire/Shimmer and standard Chrome distinctions can be ambiguous.

Why not Resolver Candidate:

The framework requires at least five aligned low-ambiguity examples for resolver candidacy. This fixture is too rare, too valuable, and too context-dependent for deterministic resolver behavior.

Promotion criteria met:

- Stable source feedback row.
- Front and back image URLs available.
- High-confidence visual review.
- Clear confusion target.
- Strong regression value as a high-risk test case.

Rollback criteria for simulated test case:

- Demote if checklist or human review contradicts the exact parallel naming.
- Demote if the fixture overstates what is visible on the card back.
- Demote if it causes broad Sapphire inference from mosaic/pink refractor appearance alone.

### visual-fixture-001-003

| Field | Value |
| --- | --- |
| concept | `Gold Geometric` |
| source feedback id | `ebb6f765-aaad-4bbe-9001-2fe592d15172` |
| fixture role | `positive` |
| visual confidence | `High` |
| confusion target | `Purple parallel` |
| simulated decision | `Promote to Test Case` |
| risk level | `Medium` |

Why promote to Test Case:

The fixture has concrete image-visible cues: Topps Chrome Tennis identification, gold tint, geometric pattern, RC logo, autograph, and visible serial numbering. It is a strong regression test for distinguishing a named geometric parallel from an incorrect generic color label.

Why not Registry Candidate:

The framework normally expects three aligned examples for registry candidacy. This fixture currently provides one verified example, so it should first become a test case and collect more evidence.

Why not Resolver Candidate:

Resolver candidacy requires at least five aligned examples and reviewed negative/confusion cases. This fixture has a clear confusion target, but not enough repeated evidence for deterministic behavior.

Promotion criteria met:

- Stable source feedback row.
- Front and back image URLs available.
- High-confidence visual review.
- Clear visual pattern and color cue.
- Clear confusion target.

Rollback criteria for simulated test case:

- Demote if human review rejects the `Gold Geometric` reading.
- Demote if later evidence shows the color/pattern label is product-specific in a way the test does not capture.
- Demote if the test encourages broad color inference from serial numbering alone.

### visual-fixture-001-004

| Field | Value |
| --- | --- |
| concept | `Blue Geometric Refractor` |
| source feedback id | `750306e2-9fa4-4ee9-b0bc-e98154b316cb` |
| fixture role | `positive` |
| visual confidence | `High` |
| confusion target | `Blue Refractor` |
| simulated decision | `Promote to Test Case` |
| risk level | `Medium` |

Why promote to Test Case:

The fixture isolates a narrow visual distinction: `Blue Geometric Refractor` versus generic `Blue Refractor`. The visible checkered/geometric pattern makes it a clean test case for pattern specificity.

Why not Registry Candidate:

One fixture is not enough for registry candidacy under the framework. The concept needs additional aligned examples and ideally negative cases showing generic Blue Refractors that should not be labeled Geometric.

Why not Resolver Candidate:

The resolver path would need at least five aligned examples and at least two negative/confusion examples for this pattern family. This fixture should remain a regression example until that evidence exists.

Promotion criteria met:

- Stable source feedback row.
- Front and back image URLs available.
- High-confidence visual review.
- Tight visual confusion boundary.
- Narrow test assertion available.

Rollback criteria for simulated test case:

- Demote if human review rejects the geometric interpretation.
- Demote if later examples show the pattern name is not stable across product lines.
- Demote if the test causes every blue patterned refractor to be treated as Geometric.

### visual-fixture-001-005

| Field | Value |
| --- | --- |
| concept | `Purple Raywave Refractor` |
| source feedback id | `0fa17bec-0996-46ea-bc12-4334eebedb3e` |
| fixture role | `positive` |
| visual confidence | `High` |
| confusion target | `Purple Refractor` |
| simulated decision | `Promote to Test Case` |
| risk level | `Medium` |

Why promote to Test Case:

The fixture captures the distinction between a generic `Purple Refractor` and a specific `Purple Raywave Refractor`. It has strong regression value because the visible wavy/raywave pattern is the decisive cue.

Why not Registry Candidate:

The framework suggests that `Purple Raywave Refractor` may become a future registry candidate only after more Raywave examples and negative generic-refractor cases. One fixture is not enough.

Why not Resolver Candidate:

Resolver candidacy needs repeated aligned examples, low ambiguity, and negative/confusion examples. This fixture should test review behavior first rather than change deterministic output.

Promotion criteria met:

- Stable source feedback row.
- Front and back image URLs available.
- High-confidence visual review.
- Clear visual pattern cue.
- Clear confusion target.

Rollback criteria for simulated test case:

- Demote if human review rejects the Raywave interpretation.
- Demote if the image evidence becomes unavailable.
- Demote if the test starts implying that all purple serialed refractors are Raywave.

## Simulated Promotion Output

If this simulation were converted into an approved test artifact later, it would produce five visual review regression test cases:

| Test case concept | Expected assertion |
| --- | --- |
| `Sapphire` | Identify explicit Sapphire evidence and do not collapse to generic `Topps Chrome`. |
| `Bowman Sapphire / Padparadscha Refractor` | Preserve the high-risk Sapphire/Padparadscha distinction as review evidence, not a runtime rule. |
| `Gold Geometric` | Identify gold coloration and geometric pattern over `Purple`. |
| `Blue Geometric Refractor` | Identify geometric/checkered pattern over generic `Blue Refractor`. |
| `Purple Raywave Refractor` | Identify wavy/raywave foil over generic `Purple Refractor`. |

## Not Promoted

This simulation does not promote any fixture to:

- registry candidate
- resolver candidate
- runtime rule
- prompt behavior
- installed test file
- deployed behavior

## Recommended Next Step

Request human approval to convert these five simulated `Test Case` promotions into a concrete regression-test artifact. Keep registry and resolver candidacy blocked until additional aligned examples and negative/confusion fixtures are reviewed.

## Non-Goals

This simulation did not:

- install any test case
- modify runtime code
- modify the registry
- modify the resolver
- modify prompts
- install upgrades
- download images
