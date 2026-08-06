# Candidate identity replay v1 — mechanism result (2026-08-01)

## What changed

This is an evaluation-only, zero-call replay. It copies the canonical fields,
then considers only a visible `identity`/`affiliation` candidate whose basis is
`logo_or_symbol` and whose target `set` field is empty. Exact legal/copyright
text, model knowledge, product overwrites, and conflicting fields remain
evidence-only. The source canonical object is never mutated and the result is
not production-promoted.

Implementation:

- `lib/listing/thin/candidate-identity-replay-v1.mjs`
- `scripts/replay-candidate-identity-v1.mjs`
- `scripts/candidate-identity-replay-v1.test.mjs`
- `artifacts/candidate-expression-v3/mechanism6/identity-replay-v1.json`

## Paired result

The six cards are the pre-registered mechanism cohort, not an accuracy
estimate. The baseline is the existing canonical Composer title.

| Metric | Result |
|---|---:|
| Cards | 6 |
| Changed cards | 2 |
| Wins / losses / ties | 2 / 0 / 4 |
| Baseline macro F1 | 0.666165 |
| Replay macro F1 | 0.688391 |
| Delta | **+0.022226** |
| Critical false promotions | 0 |
| New model calls | 0 |

Both gains are the same mechanism: the visible `VeeFriends` logo was absent
from the canonical Set field.

| Card | Source candidate | Baseline → replay | ΔF1 |
|---|---|---|---:|
| Common Sense Cow | `VeeFriends` / logo | `…Chrome Common Sense Cow…` → `…Chrome VeeFriends Common Sense Cow…` | +0.064935 |
| Adaptable Alien | `VeeFriends` / logo | `…Chrome Adaptable Alien…` → `…Chrome VeeFriends Adaptable Alien…` | +0.068421 |

The Leaf `Brian Gray`, Star Wars `Lucasfilm`, and UFC legal/identity strings
were not promoted. A preceding broad version did promote those and produced
2 wins / 3 losses with `-0.001099` macro F1; that version is discarded. This
negative trial is why the logo-only gate exists.

## Decision

**Keep as a measured candidate rule, not production authority.** The result is
positive with no observed critical false promotion, but n=6 and the cohort was
selected for known identity mechanisms. It earns a label-blind confirmatory
experiment only after the next identity-hypothesis channel is independently
measured; it does not justify wiring the resolver into the live CSM path.

