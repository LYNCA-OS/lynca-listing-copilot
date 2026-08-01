# Same-call canonical + free-title screen — STOP (2026-08-02)

## Decision

Stop this arm. Do not spend the 150-card confirmation budget and do not add
`free_title` to the production canonical response. The small average F1 lift is
not paired evidence, the strict product resolver produced no title change, and
the response was slower and larger.

## Paid screen

- Cohort: 20 paired blind cards, alternating arm order, concurrency 2.
- Baseline: `thin_canonical_high`.
- Treatment: `thin_canonical_free_product_v1_high`.
- Completed: 20/20 pairs, 40/40 checkpoint rows, no retry or derivation failure.
- Artifact directory:
  `artifacts/canonical-free-product-v1-2026-08-02/screen-20/`.

| Arm | F1 | Recall | Precision | Median latency | Median input tokens | Median output tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Canonical high | 0.78177 | 0.75172 | 0.82937 | 5.323s | 5,402 | 103 |
| Canonical + free title | 0.78694 | 0.74384 | 0.85575 | 6.972s | 5,529 | 132 |

Paired result: **3 treatment wins / 4 baseline wins / 13 ties**, ΔF1
**+0.005175**, two-sided sign-test **p=1.0**. This is directionally
undecidable at n=20, not a positive result.

## Resolver result

The free title was non-empty on all 20 cards, but strict product admission
changed only 3 canonical product values and changed **zero composed titles**:

**0 wins / 0 losses / 20 ties, ΔF1 0.**

The model's free expression mostly repeated the canonical product or added
tokens that were not safe strict extensions. The extra output therefore bought
no measured recovery while increasing latency by 31% and output tokens by 28%.

## Boundary

This rejects the particular same-call `free_title` response shape, not the
broader expression-first strategy. The earlier zero-cost replay remains valid
for the existing `thin_budgeted` title arm, but that gain does not transfer to
this more expensive combined schema. Keep the existing canonical production
contract unchanged and spend future accuracy budget on evidence that can
actually reach a resolver, not on a second string that merely repeats fields.
