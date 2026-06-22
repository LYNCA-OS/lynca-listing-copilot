# Visual Test Fixture Library V1

Status: Design Draft v1
Owner: LYNCA Listing Intelligence
Companion Documents:

- `visual-review-001b-summary.md`
- `visual-review-report-001b.md`
- `visual-registry-v1.md`
- `visual-verification-layer-v1.md`

## Purpose

The Visual Test Fixture Library stores human-reviewed and vision-reviewed collectible concepts as permanent regression examples.

It is an evidence library, not a runtime knowledge source. Its purpose is to preserve known visual examples such as Sapphire, Gold Wave, Geometric, Cosmic Chrome, and Raywave so future title-generation changes can be tested against stable visual references.

## Non-Goals

Visual Test Fixture Library V1 does not:

- modify runtime title generation
- update the title registry
- add resolver behavior
- edit prompts
- install upgrades
- auto-approve corrected titles
- train or fine-tune a model
- replace human review

## Fixture Model

Each fixture represents one collectible visual concept in one reviewed example.

Required fields:

| Field | Purpose |
| --- | --- |
| `fixture_id` | Stable fixture identifier |
| `expected_concept` | Human-approved concept, such as `Sapphire` or `Purple Raywave Refractor` |
| `front_image_url` | Front image evidence |
| `back_image_url` | Back image evidence |
| `visual_explanation` | Reviewed explanation of the visual cues |
| `confidence` | Review confidence: `high`, `medium`, or `low` |
| `source_feedback_id` | Feedback row that supplied the image/title evidence |
| `review_status` | Human review state |

Recommended fields:

| Field | Purpose |
| --- | --- |
| `generated_title` | Listing Copilot title before correction |
| `corrected_title` | Operator-corrected title |
| `concept_family` | Parallel, product, insert, grade, relic, autograph, set, or other |
| `evidence_role` | `positive`, `negative`, or `confusion` |
| `vision_review_id` | Source visual review run, such as `visual-review-001b` |
| `vision_supported` | Whether Vision marked the concept visually supported |
| `vision_uncertain` | Whether Vision marked the concept visually uncertain |
| `needs_external_checklist` | Whether checklist/manual source verification is still required |
| `human_reviewed_by` | Admin reviewer |
| `human_reviewed_at` | Human review timestamp |
| `notes` | Admin-only notes |

## Review Status

Recommended fixture statuses:

| Status | Meaning |
| --- | --- |
| `candidate` | Fixture was suggested but not human-reviewed |
| `human_review_needed` | Vision result exists but admin has not approved it |
| `approved_fixture` | Human approved as a permanent regression example |
| `negative_fixture` | Human approved as an example that should not match the concept |
| `confusion_fixture` | Human approved as a known neighboring-confusion case |
| `needs_external_checklist` | Image evidence is insufficient without checklist confirmation |
| `rejected` | Should not be used as a fixture |
| `deprecated` | Previously useful but no longer valid |

Only `approved_fixture`, `negative_fixture`, and `confusion_fixture` should be eligible for regression tests.

## Fixture Shape

Example JSON shape:

```json
{
  "fixture_id": "visual-fixture-0001",
  "expected_concept": "Purple Raywave Refractor",
  "concept_family": "parallel",
  "front_image_url": "",
  "back_image_url": "",
  "generated_title": "",
  "corrected_title": "",
  "visual_explanation": "",
  "confidence": "high",
  "source_feedback_id": "",
  "vision_review_id": "visual-review-001b",
  "vision_supported": true,
  "vision_uncertain": false,
  "needs_external_checklist": false,
  "evidence_role": "positive",
  "review_status": "human_review_needed",
  "human_reviewed_by": "",
  "human_reviewed_at": "",
  "notes": ""
}
```

## Evidence Roles

`positive` fixtures show what a concept should look like.

Examples:

- Sapphire with visible Sapphire identifiers or clearly supported Sapphire design evidence
- Gold Wave with a gold wave foil pattern
- Geometric with a visible geometric/checkered refractor pattern
- Raywave with a visible wavy refractor pattern

`negative` fixtures show what should not match a concept.

Examples:

- Orange Shimmer that should not be treated as Orange Sapphire
- generic Topps Chrome that should not be treated as Cosmic Chrome
- relic card with no visible Gold indicator that should not be treated as Gold without checklist support

`confusion` fixtures show neighboring concepts that are commonly mixed up.

Examples:

- Sapphire vs Shimmer
- Red Refractor vs Red Wave Refractor
- Purple Refractor vs Purple Raywave Refractor
- Blue Refractor vs Blue Geometric Refractor

## Initial Fixture Candidates From #001B

Recommended positive fixture candidates:

| Candidate | Expected concept | Evidence role | Review status |
| --- | --- | --- | --- |
| `learn-0020` | Sapphire | positive | human_review_needed |
| `learn-0016` | Bowman Sapphire / Padparadscha Refractor | positive | human_review_needed |
| `learn-0009` | Gold Geometric | positive | human_review_needed |
| `learn-0073` | Blue Geometric Refractor | positive | human_review_needed |
| `learn-0102` | Purple Raywave Refractor | positive | human_review_needed |
| `learn-0124` | Red Wave Refractor | positive | human_review_needed |

Recommended negative or confusion fixture candidates:

| Candidate | Expected concept | Evidence role | Review status |
| --- | --- | --- | --- |
| `learn-0046` | Orange Shimmer, not Orange Sapphire | negative | needs_external_checklist |
| `learn-0011` | 2025 Topps Chrome WWE Orange Refractor, not 2026 Cosmic Chrome | negative | human_review_needed |
| `learn-0021` | Major League Material Relic, Series 2 / Gold unconfirmed | confusion | needs_external_checklist |

## Storage Design

V1 should begin as a committed review artifact rather than a production database table.

Recommended path:

```text
docs/v2/fixtures/visual-test-fixtures-v1.json
```

Recommended companion notes:

```text
docs/v2/fixtures/visual-test-fixtures-v1.md
```

Image files should not be copied into the repo by default. Fixtures should reference existing durable image URLs. If image permanence becomes a concern, create a separate controlled artifact-storage policy rather than committing downloaded images.

## Regression Use

Future tests may use the fixture library to verify that visual review or title-generation changes do not regress known concepts.

Allowed regression checks:

- expected concept appears in the reviewed explanation or structured output
- negative fixture does not get labeled as the excluded concept
- checklist-dependent fixture remains uncertain unless external evidence is supplied
- visual confidence does not silently upgrade uncertain cases to high confidence

Disallowed V1 uses:

- automatic registry insertion
- automatic resolver insertion
- prompt mutation
- runtime title changes
- treating Vision output as final truth without human review

## Recommended Next Step

Create `docs/v2/fixtures/visual-test-fixtures-v1.json` with only #001B fixture candidates in `human_review_needed` or `needs_external_checklist` status.

Do not wire the fixture library into runtime behavior until a separate implementation proposal is reviewed and approved.

