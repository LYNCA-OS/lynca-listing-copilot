# Accuracy mechanism confirmation — fresh mixed response cohort (2026-08-02)

## Cohort boundary

The reviewed blind set contains 255 cards. The development cohort already used
150, leaving 105 unseen cards. This confirmation deliberately uses all 105
unseen cards plus 45 deterministic development cards, selected by a fixed salt.
It is a **fresh-response mixed cohort**, not an independent-card claim. The
cohort manifest is [mixed-150.cohort-manifest.json](/Users/paidaxin/lynca-thin-path/artifacts/accuracy-mechanism-confirmatory-2026-08-02/mixed-150.cohort-manifest.json).

All paid responses were new and checkpointed separately. No sealed labels were
used for cohort selection.

## Canonical versus free expression

The paired run completed 150/150 cards. One transient `fetch failed` interrupted
the first pass after 136 cards; the exact manifest and output directory resumed
only missing card-arms.

| Arm | F1 | Recall | Precision | Median latency | Median total tokens |
|---|---:|---:|---:|---:|---:|
| `thin_budgeted` | 0.7207 | 0.7805 | 0.6796 | 3,947 ms | 3,544 |
| `thin_canonical_high` | 0.7731 | 0.7557 | 0.8064 | 5,746 ms | 5,402 |

Paired result: canonical wins 102, free wins 39, ties 9, Δ F1 `+0.0525`,
two-sided sign-test `p=1.10e-7`. This confirms the CSM/SEM admission path on
fresh responses; it does not by itself prove the six overlays.

## v1 mechanism result and correction

The original v1 rules produced two explainable losses:

1. `finish_family_color_only`: 1 win / 1 loss. The loss had canonical serial
   `2/15` but free expression `/75`; the finish candidates were not mutually
   compatible.
2. `product_known_manufacturer_extension`: 6 wins / 1 loss. The loss was a
   three-card Lot; extending Product displaced two subjects in the Lot bracket.

The negative rows are retained in the ledger; they are not hidden.

## v2 safety refinement

`accuracy-mechanism-bundle-v2.mjs` adds only two deterministic gates:

- a finish extension is blocked when both canonical and free serials expose
  different denominators;
- Product extension is blocked for Lot grammar or a non-empty Lot count.

On the same fresh 150-card responses, with no new provider calls:

| Mechanism | Changed | Wins | Losses | Ties | Δ macro F1 | Decision |
|---|---:|---:|---:|---:|---:|---|
| Finish family + compatible serial | 1 | 1 | 0 | 149 | +0.000167 | candidate |
| `SAR` | 0 | 0 | 0 | 150 | 0 | no change |
| `Trainer Gallery` | 0 | 0 | 0 | 150 | 0 | no change |
| `1st Bowman` | 0 | 0 | 0 | 150 | 0 | no change |
| Known-manufacturer Product extension | 6 | 6 | 0 | 144 | +0.002826 | candidate |
| Five-mechanism bundle, without serial | 7 | 7 | 0 | 143 | +0.002993 | candidate |

The old development 150 replay also remains positive after the v2 gates: the
five-mechanism bundle is 6 wins / 0 losses / 144 ties, Δ macro F1 `+0.003700`.

## Serial follow-up

Exhaustive output was not run for all 150 cards: its median output was about
1,367 tokens versus 108 for canonical, so doing it globally would be a cost
negative for a mechanism that only applies to a small serial subset. The
canonical response pre-registered 23 cards with a one-digit serial numerator;
only those 23 received exhaustive observation calls.

Targeted result: 1 win / 0 losses / 22 ties, Δ macro F1 `+0.004831`, no title
over 80 characters. The one F1 win is `2/99 → 02/99`; the other changed row
was F1-neutral. This remains evaluation-only because the cohort is targeted
and mixed rather than independent.

## Decision

The v2 five-mechanism bundle and the targeted serial resolver are **confirmation
candidates**, not production changes. The mixed cohort is strong evidence that
the v1 losses have a deterministic cause and can be removed, but it cannot
establish an independent-card generalization claim. Do not merge these overlays
into the production CSM route until a new card pool or an explicitly accepted
independent confirmation cohort is available.
