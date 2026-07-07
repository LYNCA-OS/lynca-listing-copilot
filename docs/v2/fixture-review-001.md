# Fixture Review #001

Status: Human-Reviewable Upgrade Candidate Triage, No Installation
Source Fixture Set: `fixtures/visual-fixture-set-001.md`
Source Visual Review: `visual-review-report-001b.md`
Source Summary: `visual-review-001b-summary.md`

## Scope

This review evaluates the first five vision-verified visual fixtures and assigns one recommended path per fixture.

No runtime title generation, registry, resolver, prompt, deployment, or upgrade changes are included.

## Decision Summary

All five fixtures are useful first as test case candidates. None should become registry or resolver rules yet because #001B validates visual review value, not production rule safety.

| fixture_id | concept | recommended path | risk level |
| --- | --- | --- | --- |
| `visual-fixture-001-001` | Sapphire | Test Case Candidate | Medium |
| `visual-fixture-001-002` | Bowman Sapphire / Padparadscha Refractor | Test Case Candidate | High |
| `visual-fixture-001-003` | Gold Geometric | Test Case Candidate | Medium |
| `visual-fixture-001-004` | Blue Geometric Refractor | Test Case Candidate | Medium |
| `visual-fixture-001-005` | Purple Raywave Refractor | Test Case Candidate | Medium |

## Fixture Decisions

### visual-fixture-001-001

| Field | Value |
| --- | --- |
| fixture_id | `visual-fixture-001-001` |
| concept | `Sapphire` |
| source feedback id | `602f87e7-7372-4c5b-8115-00c0c91a4b08` |
| visual confidence | `High` |
| confusion target | `Topps Chrome without Sapphire` |
| recommended path | `Test Case Candidate` |
| risk level | `Medium` |
| suggested affected area | Visual review regression fixtures; future title evidence tests |

Reason:

The fixture has strong direct evidence from PSA slab text and card-back identifiers. `CSA` / `CSAGL` and the slab description support Sapphire more concretely than visual pattern alone. It is a good regression example for preserving explicit Sapphire evidence.

Recommended test:

Given the fixture's front/back image URLs and title pair, a visual review test should identify `Sapphire` as visually supported and should not collapse the card to generic `Topps Chrome`. The test should assert high or medium confidence, `visually_supported=true`, and `text_only=false`.

### visual-fixture-001-002

| Field | Value |
| --- | --- |
| fixture_id | `visual-fixture-001-002` |
| concept | `Bowman Sapphire / Padparadscha Refractor` |
| source feedback id | `4fa7153f-46c0-422a-946f-08874260eea8` |
| visual confidence | `High` |
| confusion target | `standard Bowman Chrome` |
| recommended path | `Test Case Candidate` |
| risk level | `High` |
| suggested affected area | Visual review regression fixtures; high-value parallel review |

Reason:

The fixture is valuable because it includes a high-value 1/1 autograph parallel and a specific Sapphire/Padparadscha distinction. It should not become a registry or resolver rule yet because the visual review summary warns against broad Sapphire inference from pattern alone, and nearby Sapphire/Shimmer cases can be ambiguous.

Recommended test:

Given the fixture's images and title pair, a visual review test should preserve the distinction between `Bowman Sapphire / Padparadscha Refractor` and standard `Bowman Chrome`. The test should require an explanation that cites visual pattern evidence plus 1/1/autograph context, while keeping the result as review evidence rather than an automatic title rule.

### visual-fixture-001-003

| Field | Value |
| --- | --- |
| fixture_id | `visual-fixture-001-003` |
| concept | `Gold Geometric` |
| source feedback id | `ebb6f765-aaad-4bbe-9001-2fe592d15172` |
| visual confidence | `High` |
| confusion target | `Purple parallel` |
| recommended path | `Test Case Candidate` |
| risk level | `Medium` |
| suggested affected area | Visual review regression fixtures; color/pattern parallel distinction |

Reason:

The fixture has concrete visual cues: Topps Chrome Tennis identification, gold tint, geometric pattern, RC logo, autograph, and 16/50 numbering. It is useful for testing whether visual review can distinguish a named pattern/color parallel from a generic or incorrect color label.

Recommended test:

Given the fixture's images and title pair, a visual review test should identify `Gold Geometric` as visually supported over `Purple`. The test should assert that the explanation mentions both gold coloration and geometric pattern evidence.

### visual-fixture-001-004

| Field | Value |
| --- | --- |
| fixture_id | `visual-fixture-001-004` |
| concept | `Blue Geometric Refractor` |
| source feedback id | `750306e2-9fa4-4ee9-b0bc-e98154b316cb` |
| visual confidence | `High` |
| confusion target | `Blue Refractor` |
| recommended path | `Test Case Candidate` |
| risk level | `Medium` |
| suggested affected area | Visual review regression fixtures; geometric pattern detection |

Reason:

The fixture isolates a narrow visual distinction: a blue refractor with a checkered/geometric pattern. This is ideal as a regression fixture because it tests whether visual review can move from a generic parallel name to a more specific visual pattern without requiring registry or resolver installation.

Recommended test:

Given the fixture's images and title pair, a visual review test should identify `Blue Geometric Refractor` as visually supported and distinguish it from generic `Blue Refractor`. The explanation should cite the visible checkered or geometric pattern.

### visual-fixture-001-005

| Field | Value |
| --- | --- |
| fixture_id | `visual-fixture-001-005` |
| concept | `Purple Raywave Refractor` |
| source feedback id | `0fa17bec-0996-46ea-bc12-4334eebedb3e` |
| visual confidence | `High` |
| confusion target | `Purple Refractor` |
| recommended path | `Test Case Candidate` |
| risk level | `Medium` |
| suggested affected area | Visual review regression fixtures; wave/raywave pattern distinction |

Reason:

The fixture captures a clean pattern distinction: a purple refractor with visible wavy/raywave foil behavior. It is useful as a regression example for recognizing Raywave as a specific visual pattern rather than treating all purple serialed refractors as generic Purple Refractors.

Recommended test:

Given the fixture's images and title pair, a visual review test should identify `Purple Raywave Refractor` as visually supported over generic `Purple Refractor`. The test should require an explanation that cites the wavy or raywave pattern.

## Not Installed

These fixtures are not installed as registry rules, resolver rules, prompt edits, or runtime title-generation behavior.

The next useful action is to convert these five fixture reviews into a regression-test artifact or test harness proposal, with human approval before any runtime behavior changes.

