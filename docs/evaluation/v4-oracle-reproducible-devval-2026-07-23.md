# V4 Oracle reproducible development/validation audit — 2026-07-23

## Decision

Do not tune Retrieval weights and do not reopen the 45-card holdout yet. The old development/validation report counted ten cards as Retrieval-evaluable, but the current no-leakage truth contract proves that only one has an independent exact-identity catalog label. That one identity was retrieved at rank 1 and selected correctly. The limiting factor is independent identity-label coverage, not demonstrated ranking failure.

This report changes evaluation assets only. It does not change the recognition strategy, queue, storage, renderer, frontend, database schema, or production deployment.

## Reconstructed source

- Source table: `listing_title_feedback`.
- Stable cutoff: `2026-06-29T08:53:20.365+00:00`.
- Writer-reviewed titles: 358/358.
- Image-backed rows: 255.
- Source fingerprint: `de22823c312cfddb75c4e6e2a8dcc005c8bc511457918ced22a015df2045a6e4`.
- Trusted catalog snapshot: 26,584 cards; SHA-256 `f8cd6969dc586ea616df481d2cc45b8d4f889aab811f0754543a1e2e8090669f`.

The deterministic image-backed split is development 173, validation 37, holdout 45. It contains 164, 35, and 45 semantic identity groups respectively, with zero identity-group overlap. The holdout remains temporary and sealed; the split builder does not make strategy decisions permanent.

## Trusted truth promotion

Re-running `trusted-catalog-sem-promotion-v2` against all 358 reviewed titles produced:

- 78 fully approved rows, including 53 image-backed rows.
- 69 independently matched catalog contexts.
- 13 independently corroborated exact identities eligible for formal Retrieval evaluation.
- 345 rows whose catalog identity is only the same feedback record; those IDs are provenance only and are not Retrieval ground truth.

This distinction prevents a current evaluation title from silently becoming its own candidate answer.

## Rebased development/validation result

The unchanged ten-card trace was rebased onto the current truth contract:

| Metric | Old report | Rebased formal result |
| --- | ---: | ---: |
| Retrieval-evaluable cards | 10 | 1 |
| Retrieval Recall@1 | 30% | 100% (1/1) |
| Retrieval Recall@5 | 40% | 100% (1/1) |
| Retrieval Recall@20 | 40% | 100% (1/1) |
| Selection given Recall | 75% (3/4) | 100% (1/1) |
| Safe Application Recall | 33.33% (1/3) | 33.33% (1/3), recorded trace |

The 100% Retrieval/Selection values are not a launch claim because the denominator is one. They only disprove the previous claim that this sample demonstrates a 40% Retrieval ceiling.

The three recorded Application opportunities were product replacement, print finish fill, and year fill. The current branch separately fixes the exact print-finish application disconnect while continuing to block unsafe product replacement and physical-instance copying. A new paid run is unnecessary until the independent Retrieval truth denominator is enlarged.

## Next gate

1. Preserve the existing 45-card holdout and do not tune on it.
2. Increase independently corroborated exact-identity coverage on development/validation without using same-feedback self-corroboration.
3. Require a meaningful Retrieval denominator before comparing scorer changes; report coverage alongside Recall.
4. Run the final 45-card full-information Oracle once after development/validation coverage and runtime gates pass.
