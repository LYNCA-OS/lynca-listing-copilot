# Expression overlay v1 — zero-cost 150-card replay (2026-08-02)

## Decision

Keep the bridge as an **evaluation-only candidate**. It implements the intended
shape — free expression is first projected through the existing SEM/CSM field
mapper, then narrow gates decide whether a canonical field overlay reaches the
deterministic Composer. It does not add a provider call, persistence write,
catalog lookup, vector lookup, Cloud Run call, or production authority.

The replay is positive on the already-paid mixed/development pool, but it is
not an independent 150-card confirmation. Do not enable it in production yet.

## Exact replay

Source checkpoints:

- `thin_canonical_high` and `thin_budgeted` from
  `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl`;
- `exhaustive_observation_high` from
  `artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl`;
- 150 paired asset IDs, no provider calls.

| stage | changed | wins | losses | ties | Δ macro F1 | reference loss | over 80 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| identity facts → Set | 5 | 5 | 0 | 145 | +0.003282 | 0 | 0 |
| + registry-attested insert | 6 | 6 | 0 | 144 | +0.003628 | 0 | 0 |
| + finish-family/color | 8 | 8 | 0 | 142 | +0.004564 | 0 | 0 |
| + known-manufacturer product extension | 9 | 9 | 0 | 141 | +0.005032 | 0 | 0 |
| + exact single-digit serial formatting | 11 | 11 | 0 | 139 | **+0.006059** | 0 | 0 |

The final baseline is macro F1 `0.766927`; the combined replay is
`0.772986`. Sixteen cards had an overlay rejected by a gate: seven lot product
extensions and nine free/canonical serial denominator conflicts.

## What changed

- Five logo/symbol observations filled an empty Set (`GRAPHITE`, `STAR WARS`,
  `Disney`, and two VeeFriends examples).
- One high-confidence printed `Kaboom` insert was admitted because the local
  registry attested the term.
- Two grounded finish-family additions recovered visible `Orange Refractor`
  / `Blue Wave`-style terms.
- One accepted product extension exposed a known-manufacturer product phrase.
- Two same-value serial repairs restored `05/20` and `08/25`; no numerator or
  denominator was invented.

The largest individual F1 gains were `VeeFriends Common Sense Cow` (+0.1364),
`Topps Chrome Platinum ... Orange Refractor` (+0.1091), and the two Star Wars /
Graphite identity recoveries (+0.1023 and +0.1026). These are per-card replay
effects, not a claim of generalization.

## Authority and safety

`lib/listing/thin/accuracy-expression-overlay-v1.mjs` returns a copied field
object, CSM's own SEM projection, and the Composer result. It is explicitly
`authority: evaluation_only`, rejects unknown SEM keys, refuses unsafe lot
product extensions, blocks serial denominator conflicts, and rejects a composed
title over 80 characters. The canonical input is never mutated.

The independent gate remains: run this exact bundle on a new 150-card paired
cohort, report per-card/per-field wins, losses, ties, reference-token losses,
length, latency, tokens, and cost. Until then, production remains the one-call
canonical CSM/SEM path.

Replay receipt:

`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/expression-overlay-v1-replay-150.json`
