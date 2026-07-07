# Listing Copilot Knowledge Metrics V1

Status: Metrics Definition and Baseline
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `dataset-snapshot-002.md`
- `visual-review-report-001b.md`
- `fixtures/visual-fixture-set-001.md`
- `fixture-review-001.md`

## Purpose

Knowledge Metrics V1 defines the core measurements for tracking Listing Copilot's learning asset growth over time.

The goal is to manage the learning system as a durable knowledge asset, not as scattered feedback rows, review reports, and fixture documents.

No runtime title generation, registry, resolver, prompt, deployment, or upgrade changes are included.

## Core Metrics

| Metric | Definition | Current Baseline |
| --- | --- | ---: |
| `total_feedback_count` | Total rows in `listing_title_feedback` | 336 |
| `image_backed_feedback_count` | Feedback rows with front image evidence | 233 |
| `legacy_text_only_count` | Feedback rows without front image evidence | 103 |
| `image_backed_ratio` | `image_backed_feedback_count / total_feedback_count` | 69.3% |
| `vision_reviewed_candidate_count` | Candidates reviewed by Vision in #001B | 11 |
| `vision_success_count` | Vision calls completed successfully | 11 |
| `visually_supported_count` | Vision-reviewed candidates marked visually supported | 9 |
| `verified_fixture_count` | Fixture records created from reviewed visual evidence | 5 |
| `fixture_conversion_ratio` | `verified_fixture_count / vision_reviewed_candidate_count` | 45.5% |
| `new_feedback_since_last_snapshot` | New feedback records since Review Cycle #001 | 57 |
| `new_image_backed_since_last_snapshot` | New image-backed records since Review Cycle #001 | 57 |

## Current Baseline From Snapshot #002

| Baseline Item | Value |
| --- | ---: |
| Total feedback | 336 |
| Image-backed | 233 |
| Legacy text-only | 103 |
| New since #001 | 57 |
| Vision-reviewed | 11 |
| Verified fixtures | 5 |

Derived baseline:

| Derived Metric | Value |
| --- | ---: |
| Image-backed ratio | 69.3% |
| Vision success ratio | 100.0% |
| Visually supported ratio | 81.8% |
| Fixture conversion ratio | 45.5% |
| New image-backed ratio since #001 | 100.0% |

## Metric Meanings

`total_feedback_count` measures raw memory volume. It is useful for growth tracking, but it does not prove the feedback is visually useful.

`image_backed_feedback_count` measures how much of the memory base can support evidence-first visual review. This is the key upstream health metric because text-only rows cannot validate collectible-specific visual concepts.

`legacy_text_only_count` measures historical debt. This number should stay flat or become less important over time as new rows are image-backed.

`image_backed_ratio` measures the quality of the feedback memory pool. A rising ratio means the knowledge base is becoming more reviewable.

`vision_reviewed_candidate_count` measures how many candidate concepts have gone through visual review.

`vision_success_count` measures whether the visual review pipeline is operational.

`visually_supported_count` measures how many reviewed candidates had image evidence that supported the concept.

`verified_fixture_count` measures durable learning assets created from reviewed evidence.

`fixture_conversion_ratio` measures how efficiently reviewed candidates become reusable regression examples.

`new_feedback_since_last_snapshot` measures total feedback growth since the last checkpoint.

`new_image_backed_since_last_snapshot` measures useful evidence growth since the last checkpoint.

## Most Important Metric

The most important metric is `verified_fixture_count`.

Reason:

Raw feedback rows show activity, but verified fixtures are the first durable learning assets. A fixture has image evidence, a concept, a visual explanation, confidence, source feedback, confusion target, and review status. That makes it reusable for regression testing and human review.

In other words:

```text
feedback rows are memory
vision-reviewed candidates are analysis
verified fixtures are reusable knowledge assets
```

`fixture_conversion_ratio` is the companion metric. It shows whether visual review is turning candidate evidence into stable testable examples, rather than producing reports that do not become assets.

## Operating Interpretation

Snapshot #002 shows a healthy direction:

- total feedback grew by 57 rows
- all new rows were image-backed
- Vision successfully reviewed 11 candidates
- 9 candidates were visually supported
- 5 verified fixtures were created
- no registry, resolver, prompt, or runtime upgrades were installed

This means Listing Copilot now has a measurable path from raw feedback to image-backed evidence to Vision review to fixture assets.

The next management objective should be to grow `verified_fixture_count` while keeping fixture quality high. Runtime changes should remain downstream of fixture review, not upstream of it.

