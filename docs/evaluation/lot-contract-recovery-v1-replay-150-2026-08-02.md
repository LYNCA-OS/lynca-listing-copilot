# Lot contract recovery v1 — 150-card replay

## Decision

Only `compact_lot_quantity` is a promotable replay candidate. It changes
`N Card Lot` to the source-derived `lotxN`, while keeping the existing bracket
priority walk unchanged. On the full 150-card cohort it produces six wins,
zero losses, and 144 ties: macro F1 `+0.005020`. Reference-token loss,
unbacked-token addition, numeric mutation, and titles over 80 characters are
all zero.

The other three Lot contract candidates stop here:

| Mechanism | Delta macro F1 | Wins / losses / ties | Decision | Why |
|---|---:|---:|---|---|
| compact lot quantity | +0.005020 | 6 / 0 / 144 | REPLAY CANDIDATE | positive on 6/7 Lot rows; one structurally guarded no-op |
| manufacturer + product + set | -0.000554 | 0 / 2 / 148 | STOP | Set consumed budget and displaced `Refractor` once; neither changed row won |
| shared observable components | +0.000509 | 2 / 1 / 147 | STOP | canonical `components` does not prove the component is shared by every card in the Lot |
| shared grading info | 0 | 0 / 0 / 150 | DEFER | the only grade-bearing Lot had no remaining budget, so there is no measured effect |

Enabling all four is also rejected: `+0.004897`, six wins and one loss, with
one reference-token-loss card. The positive mean does not override the loss.

## What the positive mechanism changed

The cohort contains seven Lot rows. Six changed and all six improved; the
remaining row was deliberately left untouched because its dropped Card Name
started with `Card`. Removing the filler word in `Card Lot` there would have
erased the only surviving `card` token while the real Card Name was still over
budget.

| Asset suffix | Quantity | Per-card F1 delta | Reference token lost |
|---|---:|---:|---|
| `bcc4e7ac4ac23e1e69d3` | lotx4 | +0.145455 | none |
| `6d227f82fdcb2ded4b6d` | lotx3 | +0.128696 | none |
| `646c3f4af20b9ee7fe07` | lotx3 | +0.134615 | none |
| `d768c8f01fbfdd779bb0` | lotx9 | +0.048696 | none |
| `1b6c3c565cffb8fb3442` | lotx4 | +0.154545 | none |
| `5bbc14c582d6f0b34f77` | lotx3 | +0.141026 | none |

The mechanism does not claim that the canonical Lot count is correct. One row
contains canonical `9` while the reviewed title says `lotx10`; the serializer
correctly preserves the observed canonical value and does not invent `10`.
Its score still improves because it removes two marketplace-noise tokens.

## Why the apparent contract fixes did not pass

`semLotTitleOrder` names a merged `manufacturer_product_set` bracket, while the
thin alias currently serializes only Manufacturer and Product. Mechanical Set
restoration looked like contract alignment, but the replay found a real budget
trade: adding `Bowman Briefing` displaced the reference-backed `Refractor` on
one card and added an unneeded `Briefing` token on both affected cards. It is a
long-term negative asset until Set correctness and typed compaction improve.

Likewise, a Lot-level `components: ["RC"]` field does not carry a “shared by
all cards” assertion. It helped two rookie Lots but hurt a mixed BBM row.
Promoting it would turn an aggregate observation into false shared semantics.

## Reproducibility

- Population: 150 unique assets from the `thin_canonical_high` arm; 7 Lot rows.
- Provider calls: 0.
- Machine result: `artifacts/lot-contract-recovery-v1-2026-08-02/replay-fresh-150.json`.
- Replay: `node scripts/replay-lot-contract-recovery-v1.mjs`.
- Contract test: `node scripts/lot-contract-recovery-v1.test.mjs`.
- Production default: unchanged.

