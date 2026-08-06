# Thin-path evaluation concurrency decision — 2026-08-01

## Decision

Use **c2** as the default concurrency for local paid thin-path recognition and
accuracy evaluation. An explicit `--concurrency` remains available for a
capacity experiment, but ordinary 150-card runs must not inherit c10 or c120.

This is a latency-constrained sweet spot, not the raw-throughput winner. On the
valid 20-card CSM thin-direct screen:

| concurrency | success | throughput cards/min | p50 | p95 |
|---:|---:|---:|---:|---:|
| 2 | 20/20 | 17.2354 | 6.769s | 8.610s |
| 4 | 20/20 | 15.7746 | 13.592s | 19.406s |
| 6 | 20/20 | 15.7707 | 21.031s | 26.433s |
| 10 | 20/20 | 18.8813 | 22.884s | 37.290s |

c10 is only 9.55% above c2 in throughput while its p95 is 4.33x higher. A
latency budget therefore rejects c10 even though a throughput-only selector
would choose it. c2 remains above 90% of the observed peak throughput and has
the lowest stable tail.

The candidate-expression-v4 c10 run confirmed that this is not just a title
endpoint artifact: 69/150 rows completed before manual stop, with zero
transport failures, but median latency was 48.422s and p95 was 59.418s. The
partial run is a latency diagnostic only, not a 150-card accuracy result.

The hosted canonical capacity screen's c120 is a separate hosted global-pool
boundary. It must not be copied into this local signed-image evaluation route.

## Implementation

`DEFAULT_THIN_PATH_EVAL_CONCURRENCY = 2` in
`scripts/run-thin-path-eval.mjs` is the single default. The shell entry point
and accuracy strategy document point to this decision. No production service,
Cloud Run, vector, OCR, or persistence path changed.
