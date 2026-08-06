# Visual bottom-band v1 — paid 105-card validation (2026-08-02)

## Decision

The additive visual view is a **capture-positive but cost-negative candidate**.
It raised title F1 by `+0.004805` on the 105-card holdout, but the paired result
was not decisive (`27` treatment wins, `19` control wins, `59` ties; exact
two-sided sign test `p=0.302`). The median latency increased from `5,545 ms` to
`8,177 ms`, and mean input tokens increased from `5,165` to `6,394` (`+23.8%`).
That does not meet the current 6–8 second writer-facing budget, so it is not a
production change.

The result is still worth retaining as a bounded visual evidence mechanism:
the gain is concentrated in year, card name, serial and descriptive markers,
while product, parallel family and print finish are mixed or negative. It must
be re-tested only after a cheaper transport/packing design exists, not by buying
another full arm now.

## Paid contract

- Cohort: the complete outside-development 105-card holdout; no new 150-card
  purchase was made.
- Model: `gpt-5.6-luna`, reasoning `none`, `high` image detail.
- Control: two original images.
- Treatment: the same two original images plus one deterministic native-pixel
  sheet containing the available original-side bottom 35% bands stacked
  vertically; 104 cards had three images, one source card had only one original
  image and therefore two images total.
- Calls: 210 successful provider calls, durable checkpointed output.
- Storage: Singapore Supabase project only; no Cloud Run, OCR, vector store or
  second model call.

## Overall result

| Metric | Control | Bottom-band treatment | Delta |
| --- | ---: | ---: | ---: |
| Cards | 105 | 105 | — |
| Macro F1 | 0.785180 | 0.789985 | **+0.004805** |
| Recall | 0.7672 | 0.7724 | +0.0052 |
| Precision | 0.8196 | 0.8249 | +0.0053 |
| Paired wins / losses / ties | — | 27 / 19 / 59 | p=0.302 |
| Median latency | 5,545 ms | 8,177 ms | **+2,632 ms** |
| Mean input tokens | 5,165 | 6,394 | **+23.8%** |
| Mean output tokens | 107.2 | 107.4 | +0.2% |
| Titles over 80 chars | 0 | 0 | — |

The score is a screen, not a production promotion: the control and treatment
are independent model responses. The paired card result is useful for direction
and cost, but it is not a proof that every extra view caused its title change.

## Where the gain came from

The field audit compares each typed field's reference-token hits, not merely
whether the JSON value changed:

| Field head | Treatment better | Control better | Net reference-token hits |
| --- | ---: | ---: | ---: |
| `card_name` | 6 | 5 | +6 |
| `year` | 5 | 1 | +4 |
| `serial` | 6 | 2 | +4 |
| `descriptive_rarity` | 3 | 0 | +4 |
| `set` | 5 | 4 | +3 |
| `team` | 2 | 0 | +2 |
| `surface_color` | 3 | 1 | +2 |
| `attributes` | 3 | 2 | +2 |
| `product` | 10 | 11 | -3 |
| `parallel_family` | 0 | 4 | -4 |
| `print_finish` | 3 | 5 | -2 |

This is exactly why it is not a blanket “send more pixels” promotion: the view
helps some small-print and identity cases, but it also makes parallel/finish
classification less stable. The highest positive examples recover `Rookie RC`,
`07/25`, `1st Bowman`, `047/499`, `Star Cluster`, and `Green Prizm`; the worst
regressions include `ProCards` → `Pro`, incorrect Disney parallel naming, and
serial/parallel hallucinations on a Brady card.

## Integrity and reproducibility

- Original images were retained first; the extra view was additive and had a
  content SHA-256 in the cohort dataset.
- All treatment rows had `image_count=3` except the one source card with one
  original side (`image_count=2`).
- The treatment arm is evaluation-only (`visual-bottom-two-band-v1`); it does
  not alter CSM/SEM, Composer, persistence or Production authority.
- The full paired rows, field audit, cost data and top wins/losses are in
  [`analysis.json`](../../artifacts/accuracy-visual-bottom-band-v1-105-2026-08-02/analysis.json).
- The reproducible cohort builder is
  [`build-visual-bottom-band-cohort-105.mjs`](../../scripts/build-visual-bottom-band-cohort-105.mjs).

## Next action

Keep this as a candidate in the accuracy portfolio, but do not spend another
paid 105-card run yet. First design a zero-cost packing/resolution screen that
can preserve the positive identity/serial signal without adding `~2.6s` median
latency or `~24%` input tokens. If that cannot be done, the mechanism is a
long-term negative for the writer path despite its small F1 gain.

