# Accuracy mechanism bundle candidates — 150-card zero-cost replay (2026-08-02)

This is the pre-screen before a paid 150-card real-card confirmation. Every
result below is a paired replay over the stored `thin_canonical` 150-card
cohort; no provider call and no production write occurred.

## Five mechanisms with positive replay evidence

| Mechanism | Comparison | Wins | Losses | Ties | Δ macro F1 | Over 80 | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Component semantic de-duplication | Composer on vs off | 1 | 0 | 149 | +0.00026455 | 0 | candidate |
| Product hierarchy parent fallback | Composer on vs off | 1 | 0 | 149 | +0.00107023 | 0 | candidate |
| Typed manufacturer/product identity | Composer on vs off | 3 | 0 | 147 | +0.00124648 | 0 | candidate |
| Same-value serial formatting | Exhaustive observation replay | 6 | 0 | 144 | +0.00377124 | 0 accepted | candidate with safety gate |
| Strict free-title product extension | CSM projection field ablation | 6 | 0 | 144 | +0.00334130 | 0 | candidate |

Composer feature ablation artifact:
`artifacts/canonical-v3/composer-feature-ablation-150-2026-08-02.json`.

Free-title projection artifact, rerun against the current Composer:
`artifacts/canonical-v3/free-title-csm-projection-analysis-current-2026-08-02.json`.

The first three mechanisms are separately ablated against the current
Composer, so their gains are not being falsely attributed to the aggregate
Composer recovery. The serial result is the strict same-numeric-pair resolver
from the extreme-observation replay. The product result is the existing
same-call, source-anchored, strict token-extension overlay; it never replaces
a conflicting canonical product.

## What is not in the bundle

- Logo→Set: 4/19/127, Δ **−0.00465928** on the paired extreme-observation
  replay. Rejected.
- Printed Set: 1/2/147, Δ **−0.00110416**. Rejected.
- Broad print-finish merge: +0.00655 but 24 wins and **11 losses**. It is not a
  safe mechanism until a compatibility/world constraint removes the wrong
  parallel substitutions.
- Language: 0/0/150. The strict gate saw no exact supported language label; this
  is no evidence of model inability, but it is not a measured gain.
- Broad free-expression merge: 35/28/87, Δ +0.00487, sign-test p≈0.45. The
  aggregate is not promotion evidence; only the strict product sub-variant is
  retained as a candidate.

## Bundle gate

These five are enough to form the requested 5–8-mechanism real-card bundle,
but “positive replay” is not yet “positive runtime asset.” Before any
production promotion, run exactly 150 real cards with the unchanged baseline
and the bundle, then report per-card and per-field wins/losses/ties, critical
false promotions, title length, token provenance, latency, tokens, and cost.
If the bundle is negative or has a critical false promotion, retain the useful
mechanism-level evidence and revert the losing mechanism instead of shipping
the bundle wholesale.

## Paired bundle result on the existing provider-backed 150

Using the same 150 canonical model rows and the matching 150 exhaustive
observation rows (no additional provider call), the complete bundle scored:

- baseline Composer at `d8bc6590bc542ab7be0a0395e41d9a1bac344240`: **0.76876538**
- bundle candidate: **0.77863340**
- Δ macro F1: **+0.00986802**
- paired cards: **18 wins / 0 losses / 132 ties**
- accepted serial repairs: 6; one serial repair was rejected by the budget /
  reference-token safety gate
- titles over 80: **0**; lost reference-token proxy: **0**; unbacked-token
  proxy: **0**

Artifact:
`artifacts/canonical-v3/accuracy-bundle-replay-150-2026-08-02.json`.

This is strong enough to justify one fresh 150-card real confirmation, but not
to merge into production: the bundle is still evaluation-only and the current
cohort is reused evidence rather than an independent holdout.
