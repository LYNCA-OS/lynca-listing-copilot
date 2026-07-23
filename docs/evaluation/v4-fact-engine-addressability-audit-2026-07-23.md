# V4 Fact Engine Addressability Audit — 2026-07-23

## Decision

**NO-GO. Do not build or integrate the Canonical Fact Engine yet.**

The read-only Oracle diagnostic contains many apparent temporal and product mismatches, but only two Retrieval misses are currently backed by an official or independent writer source strongly enough to satisfy the proposed Fact permissions. Their theoretical Recall@5 improvement is 4.44 percentage points, below the 5-point Go threshold. No production shadow, query expansion, candidate filtering, or title behavior should be added from this result.

This audit changes evaluation tooling only. It does not modify the frontend, assets, queue, OCR, GPT prompt, SEM contract, Resolver, Renderer, database, or production deployment.

## Scope and boundary

The completed 45-card Oracle is used once as a read-only diagnostic. It is not used to tune aliases or rules. Any future rule construction and Replay must use development/validation only.

The audit treats each layer opportunity as a diagnostic unit, not as an independent card. A field can contribute to more than one layer, so the combined 154-unit rate must not be presented as end-to-end card accuracy.

## Failure inventory

| Layer | Diagnostic units |
| --- | ---: |
| Evidence | 102 |
| Retrieval misses | 32 |
| Selection misses given Recall | 10 |
| Safe Application misses | 10 |
| Total diagnostic units | 154 |

| Category | Units |
| --- | ---: |
| Trace / engineering failure | 64 |
| OCR or visual miss | 31 |
| Potential product alias | 17 |
| Query planning failure | 15 |
| Selection failure | 10 |
| Application failure | 10 |
| Evidence classification unknown | 4 |
| Temporal normalization | 2 |
| Code semantics | 1 |

## Addressability

- Potential strict fact-addressable rate: 20/154 = 12.99%.
- Potential broad rate including query planning: 35/154 = 22.73%.
- Source-backed strict fact-addressable rate: 6/154 = 3.90%.
- Evidence strict addressability: 4/102 = 3.92%.
- Potential Retrieval strict addressability: 16/32 = 50%.
- **Source-backed Retrieval strict addressability: 2/32 = 6.25%.**

The gap between potential 50% and source-backed 6.25% is the central finding. Product-token overlap is not enough to create an authorized fact. Most proposed aliases still lack an official or independent reviewed mapping and therefore remain heuristic query ideas, not facts permitted to filter, rank, or support fields.

## Theoretical ceiling

| Metric | Recorded | Perfect strict potential facts | Perfect source-backed strict facts |
| --- | ---: | ---: | ---: |
| Evidence Oracle Recall | 60.92% | 62.45% | not separately claimed |
| Retrieval Recall@5 | 28.89% | 64.44% | **33.33%** |

The source-backed absolute Retrieval improvement is 4.44 points, below the required 5 points. At recorded Selection Accuracy 23.08%, the source-backed gain yields only about 0.46 additional selected cards. Even the unproven 16-card potential yields only about 3.69. With recorded Safe Application at 0%, the currently demonstrated title-level realization is zero.

## Go / No-Go gate

The MVP may be reconsidered only after development/validation provides enough source-backed mappings to satisfy all of these:

- Validation Retrieval Recall@5 absolute delta at least 5 points.
- Selection Accuracy does not decline.
- Fact precision at least 99%.
- Critical regression count is zero.
- Incorrect candidate filters are zero.
- Runtime p95 below 10 ms.
- No paid external API calls.

Until then, priority remains engineering trace recovery, Selection, and Safe Application. A generic `2025 => 2024-25` rule remains forbidden.
