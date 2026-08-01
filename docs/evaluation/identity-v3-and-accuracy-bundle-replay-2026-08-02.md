# Open identity v3 and three-mechanism replay — 2026-08-02

## Scope and claim boundary

This is a zero-provider-cost replay. The canonical and exhaustive rows were
already paid for and share the same 150 asset IDs. The replay never calls Luna,
never writes CSM/SEM, and remains evaluation-only. It is evidence for choosing
the next independent 150-card confirmation cohort, not a production accuracy
claim.

## Why v2 was rejected

The v2 rule admitted a visible identity/affiliation into an empty `set` slot
when it was not a known team, grader, rights mark, or product fragment. On the
paired 150-card exhaustive checkpoint it changed 16 cards:

| Replay | F1 | Wins | Losses | Ties |
|---|---:|---:|---:|---:|
| canonical baseline | 0.7669268 | — | — | — |
| identity v2 | 0.7666778 | 5 | 10 | 135 |

The ten losses were not visual misses. They were semantic role errors: `PTPA`,
`MLB PLAYERS`, `PLAYERS`, `Sports Collectors Digest`/`SCD`, `adidas`, `Wilson`,
and `bibigo` are a tennis association, rights/provenance labels, slab/grader
text, or sponsor marks rather than the card set.

## v3 semantic veto

v3 keeps the open expression channel but rejects only the measured non-set
roles above plus generic organization/rights/sponsor/product markers. It also
normalizes punctuation before admission. It does not use model knowledge as a
field value and does not replace a non-empty canonical set.

| Replay | Changed | Wins | Losses | Ties | Δ macro F1 | Reference loss | Over 80 |
|---|---:|---:|---:|---:|---:|---:|---:|
| identity v3 | 5 | 5 | 0 | 145 | **+0.003282** | 0 | 0 |

Changed positive cards:

| Card | Baseline → replay | Δ F1 |
|---|---|---:|
| Diana Shnaider | `Topps Diana…` → `Topps GRAPHITE Diana…` | +0.1026 |
| Star Wars | `Topps Chrome …` → `Topps Chrome STAR WARS …` | +0.1023 |
| Disney Elsa | `…Chrome Elsa…` → `…Chrome Disney Elsa…` | +0.0702 |
| VeeFriends Cow | `…Chrome Common Sense Cow…` → `…Chrome VeeFriends Common Sense Cow…` | +0.1364 |
| Disney Mufasa | `…Chrome Mufasa…` → `…Chrome Disney Mufasa…` | +0.0809 |

## Orthogonal three-mechanism bundle

The bundle applies, in order: identity v3, the already-screened
known-manufacturer product extension v2, and the narrow single-digit serial
format rule (`5/20 → 05/20`, `8/25 → 08/25`). The bundle is deliberately not
the stopped broad serial rule and does not include the stopped free-product
overlay.

| Stage | Changed | Wins | Losses | Ties | Δ macro F1 |
|---|---:|---:|---:|---:|---:|
| identity v3 | 5 | 5 | 0 | 145 | +0.003282 |
| + product v2 | 6 | 6 | 0 | 144 | +0.003750 |
| + serial single-digit | 8 | 8 | 0 | 142 | **+0.004777** |

Bundle safety checks: 0 reference-token losses, 0 titles over 80 characters.
The full per-card/per-stage ledger is in
`artifacts/extreme-observation-2026-08-02/accuracy-bundle-v3-replay-150.json`.

## Decision

Keep v3 and the three-mechanism bundle evaluation-only. Pre-register one
independent 150-card confirmation with the same safety gates:

1. no reference-token loss;
2. no title over 80 characters;
3. no negative field-level ledger;
4. positive paired result, not just aggregate mean.

If any safety gate fails, retain the useful evidence but do not admit the
mechanism into CSM/SEM or production. Production remains on the deployed
canonical thin path.
