# Composer downstream 53 recovery v1 — 2026-08-02

## Decision

The attractive opposing claim is that the old `53` should simply be restored
one by one. That produces a larger number, but it confuses a labelled oracle
with a reusable mechanism. An asset/token allow-list can lift the discovery
set to `48/53`; it is not a production asset and it is not allowed to count
toward the ten-mechanism promotion bundle.

The higher-confidence result is smaller:

- the current Composer already retains `12/53` old downstream occurrences;
- five **asset-agnostic typed rules** recover another `6/53` on the old audit;
- on the saved fresh 150, the rules that actually fire produce `3 wins / 0
  losses / 147 ties`, macro F1 `+0.002359`;
- all three changed fresh-150 rows have zero reference-token loss, zero
  unbacked new token, zero numeric mutation, and zero over-80 title;
- another `30/53` can be exposed only by sample-specific attestations. That is
  a diagnostic ceiling, not an accepted mechanism;
- the final five are blocked by the current Lot grammar / 80-character
  contract and are deliberately not forced through another field.

No provider request, deployment, production-checkout edit, Supabase/Vercel
write, OCR, retrieval, or second model call occurred. The implementation is an
evaluation overlay; the shared Composer was not changed.

## Evidence boundary

| Artifact | Population | SHA-256 |
|---|---:|---|
| fresh canonical replay rows | 150 | `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5` |
| high-100 canonical/exhaustive rows | 200 rows / 100 paired cards | `11bba8e2e756f41cee2b3f8c384e0cb0efebffe9130664877c7e7de7805ecfa7` |
| high-100 loss diagnosis | 296 audited occurrences | `07c183c18b953585a7ca96ea3f1116abadd65d8e2dd5bf2e94478895b0084f18` |

The machine-readable replay is
`artifacts/composer-downstream-recovery-v1-2026-08-02/replay-fresh-150.json`.
The earlier canonical-v3 150 replay is retained beside it. It is a complete
no-op for these narrow source shapes (`0/0/150`), which is compatibility
evidence but not positive accuracy evidence.

## The old 53, split by authority

| Authority lane | Incremental occurrences | Cumulative | What it establishes |
|---|---:|---:|---|
| Current Composer | 12 | 12/53 | Already measured recovery |
| Asset-agnostic typed overlay | 6 | 18/53 | Reusable mechanism candidates |
| Asset/token diagnostic oracle | 30 | 48/53 | Recoverability ceiling only |
| Contract-blocked | 5 | 5 remain | Cannot be restored without a different Lot/budget decision |

### Six generalizable old-53 recoveries

| Mechanism | Old token occurrence(s) | Gate |
|---|---|---|
| Typed grade compaction | `Donruss` | Exact `PSA Authentic, Auto N -> PSA Auto N`; Manufacturer must be restored with no new drop |
| Typed product + finish compaction | `Violet`, `Speckle` | Exact Chrome/UCC hierarchy plus exact plural `Refractors -> Refractor`; Finish must be restored within 80 |
| Exact-parallel color compaction | `Orange` | Color must occur inside `parallel_exact`; full Finish was dropped; compact display restores it with no new drop |
| Typed Patch/Relic compaction | `Panini` | Both typed components exist; removing generic `Relic` restores Manufacturer while retaining `Patch` |
| Typed product parent | `UEFA` | Exact `UEFA Club Competitions [season] -> UEFA`; Product must be restored with no new drop |

The overlay does not receive asset id, reference title, or score. A candidate
is accepted only when it removes an existing dropped bracket, creates no new
drop, is not truncated, and remains at most 80 characters.

### Thirty sample-specific oracle recoveries

| Oracle family | Occurrences | Cards | Why it is not a mechanism |
|---|---:|---:|---|
| Team exception | 12 | 11 | The saved canonical field does not distinguish printed short team from inferred/long team; global replay was strongly negative |
| Finish exception | 11 | 11 | Most are bare colors without source-region provenance; the old reviewed title supplies the missing authority |
| Subject shortening | 5 | 2 | Selecting `Polanco`, `Ryan`, `Luis Cova`, and `David` is reference-specific identity compression |
| Card-number exception | 2 | 1 | `DF-3` is useful here, but the old reviewed title is what selects this exception against the measured-positive suppression policy |

On fresh 150, the diagnostic oracle scores `23 wins / 0 F1 losses / 127 ties`
and `+0.012697`, but it loses the reference-helpful `Refractor` on one card
while adding three subject tokens. Aggregate F1 hides that trade. The oracle
therefore fails the reference-loss gate and is **STOP** as a bundle.

## Fresh-150 generalizable replay

| Metric | Result |
|---|---:|
| Baseline -> candidate macro F1 | `0.767764 -> 0.770123` (`+0.002359`) |
| Baseline -> candidate macro recall | `0.744084 -> 0.746819` |
| Baseline -> candidate macro precision | `0.806318 -> 0.808369` |
| Paired cards | `3 wins / 0 losses / 147 ties` |
| Changed cards | 3 |
| Reference-loss cards | 0 |
| Unbacked-new-token cards | 0 |
| Numeric-mutation cards | 0 |
| Titles over 80 | 0 |

### Every changed card

| Mechanism | Before -> after | Drop trace | Delta F1 |
|---|---|---|---:|
| Typed product + finish | `... Chrome UEFA Club Competitions ...` -> `... Chrome ... Violet Speckle Refractor ...` | `print_finish -> none` | `+0.230769` |
| Typed Patch/Relic | `2017 Impeccable ... Auto Patch Relic ...` -> `2017 Panini Impeccable ... Auto Patch ...` | `manufacturer -> none` | `+0.076923` |
| Exact-parallel color | `... 1983 Chrome Promo 018/150 ...` -> `... 1983 Chrome Promo Blue 018/150 ...` | `print_finish -> none` | `+0.046154` |

### Isolated ablation

| Mechanism | Wins / losses / ties | Delta F1 | Safety | Decision |
|---|---:|---:|---|---|
| Typed product + finish | `1 / 0 / 149` | `+0.001538` | all zero | Keep as evaluation candidate; exact hierarchy still needs an independent cohort |
| Typed Patch/Relic | `1 / 0 / 149` | `+0.000513` | all zero | **DEFER**: one replay cannot prove that `Patch` and `Relic` are never distinct components |
| Exact-parallel color | `1 / 0 / 149` | `+0.000308` | all zero | Keep as evaluation candidate; requires exact-parallel provenance |
| Typed grade compaction | `0 / 0 / 150` | `0` | no changes | Unmeasured on fresh 150; do not promote |
| Typed product parent | `0 / 0 / 150` | `0` | no changes | Unmeasured on fresh 150; do not promote |

The full three-rule interaction is positive, but only product/finish and exact
parallel color are clean candidates for the next independent bundle. The
Patch/Relic rule stays separate until SEM defines the relationship or an
adversarial component cohort shows no semantic loss.

## The five that remain

| Asset | Token(s) | Hard blocker |
|---|---|---|
| `reviewed_blind_6d227f82fdcb2ded4b6d` | `refractor` | The same 80-character Lot cannot retain the three compacted extra-subject tokens, `Briefing`, and `Refractor` under the current priority order. The fresh replay demonstrates the trade by losing `Refractor` when subjects are restored. |
| `reviewed_blind_646c3f4af20b9ee7fe07` | `rc` | Lot grammar has no Observable Components bracket. |
| `reviewed_blind_0dd3315a29711425e71b` | `promo`, `psa`, `10` | Current Lot grammar has no Set/release or Grading Info bracket for these values. |

Restoring these by copying them into Card Name or Print Finish would be silent
field-role corruption. Adding new Lot brackets is a CSM/SEM contract change,
not a Composer replay patch. They remain explicit contract debt.

## Reproduction

```sh
node scripts/composer-downstream-recovery-v1.test.mjs
node scripts/replay-composer-downstream-recovery-v1.mjs
```

The replay fails closed unless the fresh cohort contains exactly 150 unique
canonical rows and the old downstream ledger still totals exactly 53.
