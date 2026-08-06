# Open expression v4 + registry-attested insert interaction replay — 2026-08-02

## Result

This is a zero-cost replay on the same 150-card development cohort. It adds
one previously screened mechanism before the six narrow overlays:
`attested_insert` admits an empty `card_name` only when exhaustive observation
has a high-confidence printed `insert_name` and the local knowledge registry
attests the value. The canonical object is copied before every overlay; a
proposal is rejected if it crosses 80 characters or removes a reference token.

| cumulative stage | delta macro F1 | wins | losses | ties |
|---|---:|---:|---:|---:|
| identity-v3 | +0.002187 | 4 | 0 | 146 |
| + registry-attested insert | +0.002536 | 5 | 0 | 145 |
| + all six narrow overlays | **+0.006900** | **13** | **0** | **137** |

The final replay changed 13 cards, had zero reference-token losses, and
produced zero titles over 80 characters. The insert mechanism itself produced
three changes: two were F1-neutral because the reference already contained the
insert, and one recovered `Kaboom-Horizontal` tokens. This is a positive
development interaction, not independent generalization.

### Production-base control

The experiment checkout currently has an additional `product_leaf_recovery`
Composer feature that is not present on production `main`. Replaying the same
receipt with `--disable-product-leaf` produced the identical result:
`13/0/137`, Δ macro F1 `+0.006900`, zero reference-token loss, and zero
over-80 titles. This switch is an evaluation control; it does not promote the
candidate or the unpromoted feature.

## Decision

Keep `attested_insert` as an evaluation candidate for the same preregistered
independent 150-card confirmation as the existing six-mechanism bundle. Do not
wire it into production: the replay reuses the development cards and the
exhaustive observation channel is not present in the production canonical
response.

## Reproduce

```sh
node scripts/replay-expression-v4-narrow-bundle.mjs \
  --include-attested-insert \
  --disable-product-leaf \
  --out artifacts/candidate-expression-v4/expression-v4-narrow-bundle-attested-insert-replay-150-2026-08-02.json
```

Receipt:
`artifacts/candidate-expression-v4/expression-v4-narrow-bundle-attested-insert-replay-150-2026-08-02.json`.
