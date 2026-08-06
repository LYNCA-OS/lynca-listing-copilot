# Open expression v4 + narrow overlay interaction replay (2026-08-02)

## Result

This is a zero-cost deterministic replay on the same 150-card development
cohort. It tests interaction order, not independent-card generalization.

| cumulative stage | delta macro F1 | wins | losses | ties |
|---|---:|---:|---:|---:|
| identity-v3 admission of v4 facts | +0.002187 | 4 | 0 | 146 |
| + SAR-only rarity | +0.002452 | 5 | 0 | 145 |
| + 1st Bowman printed marker | +0.002847 | 6 | 0 | 144 |
| + known-manufacturer product extension | +0.004720 | 9 | 0 | 141 |
| + guarded single-digit serial | **+0.006551** | **12** | **0** | **138** |

The finish-family and Trainer Gallery proposals made no additional title change
after identity-v3 on this cohort. The final bundle changed 12 cards, had zero
reference-token losses, and produced zero titles over 80 characters. Proposals
are rejected per card when they would cross the character budget or remove a
token already present in the preceding title.

The replay observed 6 finish, 7 product, and 1 serial proposals that were
blocked. That is useful evidence: the gate is doing work, rather than merely
reporting a favorable aggregate.

## Reproduce

```sh
node scripts/replay-expression-v4-narrow-bundle.mjs
```

Receipt:
`artifacts/candidate-expression-v4/expression-v4-narrow-bundle-replay-150-2026-08-02.json`.

The paired sources are the canonical-v3 `thin_canonical`/`thin_budgeted` rows,
the v4 open-expression facts, and the stored exhaustive observations, matched
by `asset_id`. No provider call, prompt change, CSM schema change, or
production authority change occurred.

## Decision

Keep this as a pre-registered independent-150 candidate bundle. It is not yet
production authority: the current source pool has only 105 image-backed cards
outside development, and the 30 observe-only writer events are not sealed
review labels.
