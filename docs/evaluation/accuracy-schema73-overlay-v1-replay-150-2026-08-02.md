# Schema73 safe recovery overlay — zero-cost 150 replay (2026-08-02)

## Decision

The opposing view is that all `73` schema-compression occurrences should be
forced back into the title. The completed human audit rules that out: the raw
73 contain only 37 correctly scoped incremental occurrences, alongside 8
canonical synonyms, 19 ambiguous candidates, and 9 wrong-role collisions.
Promoting all 73 would deliberately add known false roles and metric-only
duplicates.

The higher-confidence action is narrower. This evaluation-only overlay adds
three typed, provenance-bearing resolvers on top of the existing expression
overlay. On the retained 150 cards it recovers **10 additional occurrences
from the old direct 37**. The candidate changes nine cards and produces 9 wins /
0 losses / 141 ties. It remains a development replay candidate, not a
production promotion.

No provider, database, storage, catalog, vector, OCR, Cloud Run, Vercel, or
second-model request was made. Production code and the production checkout
were not touched.

## Exact incremental result

The correct baseline for this test is the current positive expression overlay,
not the older raw canonical title. That isolates what this new overlay adds.

| Metric | Existing expression overlay | + schema73 overlay | Increment |
|---|---:|---:|---:|
| Macro F1 | 0.772986 | 0.777871 | **+0.004884** |
| Winning / losing / tied cards | — | **9 / 0 / 141** | 9 changed cards |
| Field actions | — | 11 | Year 3; Set 2; Serial 2; Card Name 2; Release Variant 1; Product 1 |
| Reference-loss cards | — | **0** | pass |
| Unrelated title-token-loss cards | — | **0** | pass |
| Explicitly sanctioned semantic/format replacements | — | 4 tokens on 4 cards | two zero-padding replacements; `Autograph → Auto`; duplicate team-role removal |
| Unbacked numeric-addition cards | — | **0** | pass |
| Serial numeric-mutation cards | — | **0** | pass |
| Titles over 80 characters | — | **0** | pass |

For lineage only, raw canonical on these rows is 0.766927. The cumulative
existing overlay plus this candidate reaches 0.777871: 19 wins / 0 losses /
131 ties, `+0.010944`. That cumulative number includes mechanisms selected on
development-exposed data and is not an independent accuracy estimate.

## Isolated mechanisms

| Mechanism | Typed gate | Wins / losses / ties | Delta F1 | Old-direct occurrences newly recovered |
|---|---|---:|---:|---:|
| Exact season suffix | Existing four-digit year; high-confidence printed Set/season line on back or slab; exact `YYYY-YY`; suffix must equal the next calendar year | 3 / 0 / 147 | +0.000996 | 3 (`19`, `21`, `19`) |
| Front same-value serial | High-confidence exact front stamp; canonical is two-digit numerator and observation is its zero-padded three-digit form; numerator and denominator must be numerically identical | 2 / 0 / 148 | +0.001273 | 1 (`027/150`); the second win is `082/100`, outside the old direct 37 |
| Typed exact admission and compaction | Versioned product-context registry: exact front `NBL` logo → empty Set; Topps Tribute exact Home Run Derby event → empty Release Variant; Signature Class exact `PICK n` → empty Card Name; printed Bowman `1ST` replaces duplicated `Chrome … Autograph` while Product retains Chrome and Components retain Auto; exact `OPTIC` repairs Product while removing a Card Name identical to Team | 5 / 0 / 145 | +0.002676 | 6 (`nbl`, `pick`, `2`, `derby`, `1st`, `optic`) |

Every field action retains the full source observation (`evidence`, kind,
region, label, confidence) and an explicit reason code. The input canonical
object is copied, never mutated. The module is not imported by the runtime thin
path.

Four lexical replacements are explicit rather than hidden as “no loss”:

- `27/150 → 027/150` and `82/100 → 082/100` preserve the exact numeric pair;
- `Autograph` leaves the title only where the retained Components field still
  emits its canonical synonym `Auto`, while exact printed `1ST` enters;
- `Cowboys` leaves Card Name only because Card Name exactly duplicated Team,
  the marketplace profile already suppresses Team, and exact printed `OPTIC`
  enters Product. Purple Prizm remains in the title.

None is a reference-token loss. The JSON separately records sanctioned and
unrelated title-token losses; the latter remains zero.

## Changed-card ledger

| Asset suffix | Field action | Before → after | Per-card F1 delta | Old-direct count |
|---|---|---|---:|---:|
| `dfba61396ec82f2b864e` | Year `2018 → 2018-19` | `2018 Panini…` → `2018-19 Panini…` | +0.047619 | 1 |
| `3215d29874a3dad22bbb` | Set `"" → NBL` | `Topps Chrome Karim…` → `Topps Chrome NBL Karim…` | +0.066176 | 1 |
| `a38ced8b163264d9d95a` | Year `2020 → 2020-21` | `2020 Panini…` → `2020-21 Panini…` | +0.043333 | 1 |
| `940144961215fef91c18` | Serial `27/150 → 027/150`; Card Name `"" → Pick 2` | adds exact `Pick 2 027/150` | +0.209091 | 3 |
| `d3bcbaa288c732ffed37` | Serial `82/100 → 082/100` | same numeric value, exact front stamp | +0.090909 | 0; useful outside this old-37 ledger |
| `12f2d135218a7ca35d3e` | Release Variant `"" → Derby` | appends exact event identity | +0.046154 | 1 |
| `c279329f2f78d7f65071` | Year `2018 → 2018-19` | `2018 Panini…` → `2018-19 Panini…` | +0.058480 | 1 |
| `c6ecb08d49256335aa6b` | Set `Chrome Prospect Autograph → Prospect 1st` | Product still emits Chrome; Components still emit Auto; Blue Wave retained | +0.080000 | 1 |
| `8cabcafd0596fbab0bb0` | Product adds `Optic`; Card Name identical to Team is cleared | exact logo admitted without dropping Purple Prizm | +0.090909 | 1 |

There are no changed losing or neutral cards. The complete 150-row ledger,
including unchanged rows, fields, reason codes, sources, stage titles, and all
safety checks, is in the adjacent JSON result.

## What happened to the old direct 37

The old 37 are token occurrences, not 37 fields or cards. `Star Wars` counts
as two occurrences, as does `Pick 2`.

| Fresh150 state after this replay | Occurrences | Meaning |
|---|---:|---|
| Already in fresh canonical | 7 | Sampling/baseline drift already recovered them |
| Recovered by the prior expression overlay | 6 | `Graphite`, `Star Wars` (2), `Kaboom`, `Disney`, `VeeFriends` |
| **Newly recovered here** | **10** | Three season suffixes, `027/150`, `NBL`, `Pick 2` (2), `Derby`, `1st`, `Optic` |
| Still schema-compressed | 11 | Unsafe or budget-coupled under current evidence |
| Exhaustive no longer expressed | 2 | `5` and `5/5`; no retained resolver input exists in this sample |
| Moved to downstream composition | 1 | `Kings` is in a canonical value but Composer does not emit it |
| **Total** | **37** | exact reconciliation |

This means the candidate title now contains `7 + 6 + 10 = 23` of the old direct
37. The **incremental claim is ten**, not 23 and not “10 of all raw 73.”

## Why the remaining 11 were not forced in

| Remaining family | Occurrences | Boundary |
|---|---:|---|
| Team extensions: `FC`, `KC`, two `Los Angeles` pairs | 6 | Global team restoration is already a measured negative policy; these need a separately source-gated team exception |
| `1st` | 1 | The remaining row is Lot grammar and a single visible mark does not establish a shared lot-wide value |
| `Redemption Card` | 2 | Adding it displaced reference-helpful Red/Parallel terms under the 80-character budget |
| `Draft` | 1 | The direct slab value improved score but displaced the separate `Edition` identity; it fails the no-unrelated-drift gate |
| `04/25` | 1 | Evidence is medium confidence and conflicts numerically with canonical `4/35`; this is not formatting-only |

Those are not “missed easy wins.” They require a new Composer compaction,
stronger physical evidence, or a separately measured exception. The rule is
deliberately fail-closed: aggregate F1 cannot buy a numeric mutation,
reference loss, or unrelated-field displacement.

The other 36 raw-73 occurrences remain outside this automatic target by human
classification: eight synonyms should not be duplicated, 19 candidates need
catalog/world compatibility, and nine wrong-role collisions must stay
rejected.

## Reproduction and fingerprints

```sh
node scripts/accuracy-schema73-overlay-v1.test.mjs
node scripts/replay-accuracy-schema73-overlay-v1.mjs
```

The replay fails unless all three retained arms contain the same 150 unique
asset IDs. The result is deterministic: two consecutive executions produced
the same JSON SHA-256
`84e6beaf3d553699cc1b4c0ab0cc9f5131c231c361792bae10a68f3160c265df`.

| Evidence | SHA-256 |
|---|---|
| canonical/free checkpoint | `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5` |
| exhaustive checkpoint | `96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9` |
| paired cohort | `c63287ca0d76f669385a720987b36f49a4495b40fe82b1133287fe2c4f272bf7` |
| overlay module | `6ff618b8173624d9b352f53b154b603dedd2bd866e15a7682c7995611d8043da` |

Files:

- `lib/listing/thin/accuracy-schema73-overlay-v1.mjs`
- `scripts/accuracy-schema73-overlay-v1.test.mjs`
- `scripts/replay-accuracy-schema73-overlay-v1.mjs`
- `docs/evaluation/accuracy-schema73-overlay-v1-replay-150-2026-08-02.json`

## Promotion boundary

Status is **REPLAY_CANDIDATE**, not production-ready. The same 150 cards and
the old 73 audit informed mechanism selection. Keep this exact bundle frozen
with the other replay-positive mechanisms; only an independent pre-registered
real-card cohort can establish generalization. A future negative card,
reference-token loss, unsupported numeric change, unrelated-field drop, or
over-80 title stops the whole new mechanism.
