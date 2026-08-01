# Open expression v4 → guarded accuracy bundle replay (2026-08-02)

## Result

This is a zero-cost, deterministic replay on the same 150-card development
cohort. It is not a new model run and it is not production authority.

| stage | baseline macro F1 | stage macro F1 | delta | wins | losses | ties |
|---|---:|---:|---:|---:|---:|---:|
| v4 identity facts → identity-v3 resolver | 0.771494 | 0.773681 | +0.002187 | 4 | 0 | 146 |
| + known-manufacturer product extension v2 | 0.771494 | 0.775554 | +0.004061 | 7 | 0 | 143 |
| + guarded single-digit serial v1 | 0.771494 | 0.777385 | +0.005891 | 10 | 0 | 140 |

The final bundle changed 10/150 cards, had zero losses, zero reference-token
loss cards, and zero titles over 80 characters. One serial repair was observed
but withheld because its extra character would have crossed the 80-character
budget and dropped `Manufacturer`, a higher-priority identity bracket.

## Pairing and reproducibility

The replay pairs each asset by `asset_id` across:

- `artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl` (`thin_canonical` and
  its same-cohort `thin_budgeted` control);
- `artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl`;
- `artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl`.

Run without a provider call:

```sh
node scripts/replay-expression-v4-accuracy-bundle.mjs
```

The machine-readable receipt is
`artifacts/candidate-expression-v4/expression-v4-bundle-replay-150-2026-08-02.json`.

## Decision

This is a strong candidate for the independent-150 gate because the open
expression channel is useful only after narrow SEM/CSM admission and the
card-level 80-character/reversal guard. It must remain `evaluation_only` until
the required independent 150-card pool exists; no production prompt, second
provider call, or authority rule is changed by this replay.
