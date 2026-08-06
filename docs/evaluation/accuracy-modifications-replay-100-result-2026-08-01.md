# Accuracy modification bundle — 100-card replay (2026-08-01)

This historical bundle uses the already-paid `thin_canonical_high` and
`exhaustive_observation_high` rows from the 100-card extreme experiment. It
does not call the provider. Each variant is replayed against the same canonical
baseline and scored per card with the existing title metric.

Artifact: `artifacts/extreme-observation-2026-08-01/accuracy-modifications-100.json`

The reusable runner is `scripts/replay-accuracy-modifications-100.mjs`; pass
`--limit 150` and a 150-card canonical/exhaustive pair for the current gate.
The `100` in this historical filename records the original exploratory cohort,
not the future sample-size policy.

## Results

| Variant | Changed cards | Wins | Losses | Ties | Δ macro F1 | Decision |
|---|---:|---:|---:|---:|---:|---|
| Logo observation → empty Set | 19 | 4 | 11 | 85 | -0.006071 | **Reject** |
| Printed `set` observation → empty Set | 6 | 1 | 4 | 95 | -0.002882 | **Reject** |
| Same-value serial observation (including leading zeroes) | 3 | 2 | 0 | 98 | **+0.002000** | **Keep as candidate** |

The serial rule changed only exact serial values. It never replaces a
different numerator or denominator. The two positive cards were:

- `27/150 → 027/150`, +0.1000 F1;
- `38/220 → 038/220`, +0.1000 F1.

The third observed serial was already semantically the same (`01/25` versus
`1/25`) and did not change F1. There were no serial losses or critical false
promotions.

The logo rule's losses explain why visual presence alone is not identity
authority: `SPALDING`, `MLB PLAYERS`, `PTPA`, `Sports Collectors Digest`, and a
jersey Nike swoosh were all visible logos but not the card's marketplace Set.
The printed-set rule also promoted phrases such as `THE PHANTOM MENACE` and
`IMMACULATE COLLECTION` into the wrong title slot.

## Scope decision

Only the serial rule survives this 100-card exploratory replay as a positive
candidate. It is still evaluation-only because the current default thin path does not expose
the exhaustive observation channel. It can be promoted only through a later
candidate-evidence path that preserves the exact observed serial and applies
the same-value constraint; it must not infer a serial from a missing field. The
new promotion gate is 150-card replay followed, if necessary, by 150 real
cards.
