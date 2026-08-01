# Candidate expression v4 vocabulary screen — 2026-08-02

## Decision: stop expansion for now

The strict vocabulary gate is safe in this screen but has no measured lift.
That is a **neutral result**, not a positive result: do not spend another paid
150-card run on this mechanism until more trigger coverage or a better
pre-registered field target exists.

The screen used 20 cards from the outside-development pool, one
`candidate_expression_v4_high` call per card, GPT-5.6 Luna, reasoning `none`,
image detail `high`, c2 concurrency. The resolver then replayed those facts
against the already-paid canonical control for the same 20 cards.

| Metric | Result |
|---|---:|
| Candidate calls | 20 |
| Completed / failed | 20 / 0 |
| Candidate changes | 0 |
| Wins / losses / ties | **0 / 0 / 20** |
| Baseline and replay macro F1 | `0.818503 → 0.818503` |
| New canonical calls | 0 |
| Median / p95 candidate latency | 8.698 s / 9.748 s |
| Median / p95 total tokens | 4,189 / 4,359 |

## Why it did not fire

| Slot | Admitted | Already occupied | Not attested / wrong gate |
|---|---:|---:|---:|
| `card_name` | 0 | 7 | 13 |
| `parallel_exact` | 0 | 3 | 17 |
| `descriptive_rarity` | 0 | 3 | 17 |

Examples explain the neutral result:

- `Refractor` was printed, but the gate intentionally rejects a bare finish
  head; the canonical title already had the same semantic finish.
- `Red Sparkle` was only a visual interpretation, so it was correctly not
  promoted as printed parallel evidence.
- `1st Edition` was observed on LeBron James, but the canonical rarity slot
  was already occupied.
- `Road to FIFA World Cup 26` was captured as an attribute, not as an
  attested insert/card-name value.

The result therefore validates the stop conditions, not the mechanism's
commercial value. The raw paid checkpoint and replay ledger are kept at:

- `artifacts/candidate-expression-v4/fresh-outside-screen-20-2026-08-02/`
