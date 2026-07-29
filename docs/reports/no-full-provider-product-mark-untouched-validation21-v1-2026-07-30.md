# Product-mark untouched Validation-21 v1

Status: **`FIELD_SENSOR_EVIDENCE_ONLY`**

This was the single frozen product-field evaluation. Predictions were generated
before the Validation Product truth was opened. Provider, network, production,
and holdout IO were all zero.

| Slice | Result |
| --- | ---: |
| Supported positives | 1/5 correct; 3 abstain; 1 wrong class |
| Open-set products | 14/16 correctly rejected; 2 false positive |
| Joint Product field | 15/21 = 71.43% |
| Precision when emitting a supported product | 0.25 |
| Sensor latency | p50 84.28 ms; p95 119.088 ms |

The denominator is exactly **5 supported positives + 16 open-set items** from
the frozen Validation split. Image SHA overlap with the 17-row tuning cohort is
zero. The truth is a `CONFIRMED` Product field backed by the recorded
writer-reviewed-title bounded-span provenance; it is not an independently
reconstructed full-card identity.

## Interpretation boundary

This result evaluates one Product-mark field sensor only. It does **not** test
Year, Subject, Card Number, Retrieval, Selection, Resolver, Renderer, the
80-character title contract, or writer-visible end-to-end latency. Therefore it
cannot prove, and must not be presented as, **85% title accuracy** or production
readiness.
