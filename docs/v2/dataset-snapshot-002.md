# Dataset Snapshot #002

Status: Knowledge Base Growth Snapshot
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

## Scope

This snapshot records the current Supabase `listing_title_feedback` state and the current visual-review artifacts after Visual Review #001B.

No runtime title generation, registry, resolver, prompt, deployment, or upgrade changes are included.

## Current Feedback Dataset

| Metric | Count |
| --- | ---: |
| Total feedback records | 336 |
| Image-backed records | 233 |
| Legacy text-only records | 103 |
| New records since Review Cycle #001 | 57 |
| New image-backed records since Review Cycle #001 | 57 |
| New legacy text-only records since Review Cycle #001 | 0 |

Current feedback date range:

```text
2026-06-21T09:30:11.126+00:00 to 2026-06-22T10:59:21.041+00:00
```

Review Cycle #001 baseline:

| Baseline Metric | Count |
| --- | ---: |
| Feedback rows exported | 279 |
| Image-backed rows reviewed | 176 |
| Legacy text-only rows preserved | 103 |

## Growth Since Last Snapshot

| Metric | Growth |
| --- | ---: |
| Total feedback records | +57 |
| Image-backed records | +57 |
| Legacy text-only records | +0 |

Interpretation:

The knowledge base grew entirely through image-backed feedback after Review Cycle #001. The legacy text-only population stayed flat at 103 rows, while usable image-backed review evidence increased from 176 to 233 rows.

## Vision-Reviewed Concepts

Visual Review #001B reviewed 11 concepts using 22 images. All 11 Vision calls completed.

| Candidate | Concept | Confidence | Supported | Uncertain | Needs checklist |
| --- | --- | --- | --- | --- | --- |
| `learn-0016` | Chrome -> Sapphire | High | Yes | No | No |
| `learn-0020` | Sapphire | High | Yes | No | No |
| `learn-0046` | Shimmer -> Sapphire | High | No | No | Yes |
| `learn-0011` | 2025 -> 2026 | High | No | Yes | No |
| `learn-0068` | Cosmic | High | Yes | No | No |
| `learn-0009` | Tennis | High | Yes | No | No |
| `learn-0073` | Geometric | High | Yes | No | No |
| `learn-0102` | Raywave | High | Yes | No | No |
| `learn-0124` | Wave | High | Yes | No | No |
| `learn-0007` | Autograph | High | Yes | No | No |
| `learn-0021` | Series 2 | Medium | Yes | Yes | Yes |

Aggregate visual review counts:

| Metric | Count |
| --- | ---: |
| Vision-reviewed concepts | 11 |
| High confidence | 10 |
| Medium confidence | 1 |
| Low confidence | 0 |
| Visually supported | 9 |
| Visually uncertain | 2 |
| Text-only | 0 |
| Needs external checklist | 2 |

## Verified Fixtures

Fixture Set #001 created five human-review-pending visual fixtures from #001B evidence.

| Fixture | Concept | Source status |
| --- | --- | --- |
| `visual-fixture-001-001` | Sapphire | Vision-supported, human review pending |
| `visual-fixture-001-002` | Bowman Sapphire / Padparadscha Refractor | Vision-supported, human review pending |
| `visual-fixture-001-003` | Gold Geometric | Vision-supported, human review pending |
| `visual-fixture-001-004` | Blue Geometric Refractor | Vision-supported, human review pending |
| `visual-fixture-001-005` | Purple Raywave Refractor | Vision-supported, human review pending |

Fixture review outcome:

| Metric | Count |
| --- | ---: |
| Verified fixture records created | 5 |
| Recommended as test case candidates | 5 |
| Recommended as registry candidates | 0 |
| Recommended as resolver candidates | 0 |
| Installed upgrades | 0 |

## Snapshot Conclusion

Dataset Snapshot #002 shows that the feedback memory is now growing through image-backed records, not legacy text-only corrections. The first Vision-reviewed concepts and first verified fixture set exist, but they remain review artifacts only.

The knowledge base is ready for controlled regression-test preparation. It is not yet ready for automatic registry, resolver, prompt, or runtime title-generation changes.

