# Candidate-expression v4 unseen-product screen — 2026-08-02

This is a small, paid diagnostic on the separate 17-card
`unseen_product_benchmark`. It made 17 new candidate-expression v4 provider
calls at GPT-5.6 Luna, reasoning `none`, image detail `high`, concurrency 2.
The canonical control was not called again: it is the already stored
`thin_canonical` result for the same 17 asset IDs. No production request or
write used this arm.

## Raw expression result

The v4 arm intentionally returns candidate facts and hypotheses rather than a
title, so its raw title F1 is `0` by design and must not be read as a title
failure. The expression report found:

| Measure | Result |
| --- | ---: |
| Cards | 17 |
| Candidate defects | 0 |
| Cards with hypotheses | 17 |
| Cards with model-knowledge hypotheses | 1 |
| Visible-expression macro F1 | 0.330100 |
| Best-hypothesis macro F1 | 0.372050 |
| Median latency | 3.678 s |
| Median input / output tokens | 2,725 / 208 |

## Deterministic identity projection

The stored visible facts were replayed through the existing evaluation-only v3
identity resolver and the current Composer. This is not a new model result.

| Baseline | Candidate projection | Delta | Paired result | Reference loss |
| ---: | ---: | ---: | --- | ---: |
| 0.442087 | 0.453722 | +0.011635 | 2 wins / 0 losses / 15 ties | 0 cards |

Both changes admitted the visible `FIFA` mark into an empty Set field:

- `2025 Panini Prizm FIFA Talismen Lautaro Martinez #6`
- `2025 Panini Prizm FIFA Prizm Flashback - 2015 Lionel Messi #2`

That is a useful, source-shaped signal, but it is only two cards from one
Panini Prizm/FIFA slice. Earlier v4 identity replay on 102 development cards
was negative (`4/12/86`, ΔF1 `−0.004188`), mainly because team, rights-body,
grader, and logo fragments were promoted as Set. Therefore this screen does
not reopen the generic identity resolver.

## Decision

Keep candidate-expression v4 and the `FIFA` observation as evaluation-only.
Do not add a second production call: the separate arm adds a median 3.678 s and
about 2,725 input tokens per card. The next valid test is a same-call candidate
lane with an explicit allowlist/attestation gate, followed by the required
independent 150-card confirmation. Until that source exists, this result is a
diagnostic positive, not a production promotion.

Artifacts:

- `artifacts/accuracy-unseen17-candidate-v4-2026-08-02/thin-path-gpt-5.6-luna.jsonl`
- `artifacts/accuracy-unseen17-candidate-v4-2026-08-02/expression-report.json`
- `artifacts/accuracy-unseen17-candidate-v4-2026-08-02/identity-replay.json`
