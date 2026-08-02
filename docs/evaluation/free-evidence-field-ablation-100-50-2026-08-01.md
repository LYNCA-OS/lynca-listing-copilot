# Free-expression field ablation — 100-card development / 50-card screen

## Question

Which already-expressed model values can be added to the canonical result at
the lowest marginal provider cost?  This is a zero-call replay of the stored
`canonical-v3` checkpoint.  It does **not** establish that bounded-evidence v2
will emit the same spans; it chooses the first same-call hypothesis to test.

The 100 cards that overlap the high-100 audit are the development population.
The remaining 50 ordered cards are a directional screen, not a randomized or
stratified holdout.  Each field was merged by the existing evidence-anchored
counterfactual and recomposed with the same current Composer on both sides.

## Per-field result

| Added field only | Development 100 ΔF1 (W/L/T) | Screen 50 ΔF1 (W/L/T) | Decision |
|---|---:|---:|---|
| product | +0.001204 (2/0/98) | +0.007616 (4/0/46) | first same-call target |
| print_finish | +0.006460 (15/9/76) | +0.006723 (9/2/39) | useful but unsafe without compatibility data |
| serial | +0.000858 (2/1/97) | 0 (0/0/50) | exact-current-copy resolver only |
| card_name | -0.001064 (1/2/97) | -0.003873 (1/2/47) | reject |
| descriptive_rarity | -0.001126 (0/3/97) | -0.001385 (1/3/46) | reject |
| components | -0.000483 (2/5/93) | -0.004673 (1/8/41) | reject broad merge |
| year | -0.000129 (0/1/99) | -0.000421 (0/1/49) | reject |
| language, manufacturer, set, release_variant, card_number, grade, team | 0 | 0 | no measured title effect |

Across all 150 rows, `product` alone is `+0.003341` F1 with six wins, zero
losses and 144 ties (exploratory two-sided sign `p=0.03125`).  Fourteen field
families were inspected, so this p-value is hypothesis-generating rather than
confirmatory.  The more useful fact is directional consistency: product was
2/0 on development and 4/0 on the unused remainder.

The top development subset was `product + print_finish + serial`
(`+0.008470`, 18/10/72).  It also moved the 50-card screen by `+0.014340`
(13/2/35), but the two losses are commercially material parallel errors:

- `Green Prizm` displaced the reference `Lucky Hyper`;
- `Red Shimmer` displaced the reference `Padparadscha Refractor`.

The larger aggregate gain therefore does not pass the critical-error gate.

## Six product-title wins

| Asset | Canonical product | Evidence extension | Reference-supported addition |
|---|---|---|---|
| `reviewed_blind_8945fde9c65cb1b9f3a8` | Metal | Leaf Metal Draft | Draft |
| `reviewed_blind_7059d3b39d01402f0e61` | Topps Chrome | Topps Chrome VeeFriends | VeeFriends |
| `reviewed_blind_7c93444e09007eaec82f` | empty | Upper Deck MJx | Upper Deck MJx |
| `reviewed_blind_7815e1aeda1f8e00dd4e` | Topps Chrome | Topps Chrome VeeFriends | VeeFriends |
| `reviewed_blind_a4051a222e9be2cf8149` | Chrome Black | Topps Star Wars Chrome Black | Star Wars |
| `reviewed_blind_a8a73b44f77bf6e823e2` | Chrome | Topps Chrome UFC | UFC |

The Star Wars row still contains a wrong baseline `Chrome Black`; the product
extension adds the correct `Star Wars` token but does not repair that existing
error.  It must not be reported as a fully correct title.

## Resulting experiment rule

Test product completion before world-model injection or broad finish recovery.
In evaluation only, accept a product proposal when it is exact source-anchored
evidence and either fills an empty product or is a strict token extension of
the canonical product.  Preserve the canonical object, expose the overlay and
manually review every active extension.  Any false/critical product extension
stops promotion.  `year` remains prohibited; `print_finish` remains a candidate
until a catalog/temporal compatibility check can distinguish visually plausible
but wrong parallels.
