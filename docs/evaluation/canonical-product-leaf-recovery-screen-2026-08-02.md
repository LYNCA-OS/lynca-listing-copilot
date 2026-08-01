# Canonical Product leaf recovery screen — 2026-08-02

## Decision

Keep the mechanism in the experiment Composer behind its existing
`product_leaf_recovery` feature switch. Do not promote it to production yet.

The mechanism is intentionally narrow: when the current policy would delete
both `[Manufacturer]` and `[Product]`, and the canonical Product is exactly
`<Manufacturer> <one-word-leaf>`, try the leaf alone. It never invents a
registry value, changes the canonical object, or abbreviates a multi-word
product. `Donruss` + `Donruss Elite` can therefore retain `Elite` when the full
pair does not fit.

## Evidence

| Cohort | Cards | Changed | Wins / losses / ties | Δ macro F1 | Over 80 | Reference-loss proxy |
|---|---:|---:|---:|---:|---:|---:|
| Extreme high-100 control replay | 100 | 1 additional card | 10 / 0 / 90 | +0.006061 overall Composer candidate | 0 | 0 |
| Current layered schema replay | 148 | 1 tie-only title change | 6 / 0 / 142 | +0.002698 | 0 | 0 |
| Earlier v3 schema replay | 150 | 0 | 6 / 0 / 144 | +0.002728 | 0 | 0 |
| Fresh paid canonical confirmation | 150 | 0 | 0 / 0 / 150 | 0 | 0 | 0 |

The extreme control moved from macro F1 `0.769802` to `0.775863`; the total
Composer recovery moved from `11/53` to `12/53` downstream reference-helpful
occurrences. The extra recovery is the `Elite` token on the Donruss Elite card.
The fresh paid 150-card canonical arm did not contain a matching shape, so it
provides a neutral coverage result, not independent confirmation of benefit.

## Safety and boundary

- The 100-card result has 10 wins, 0 losses, 0 over-80 titles, and no lost
  reference-helpful token proxy.
- The 148/150 stored-field replays remain non-negative; these are robustness
  replays with overlapping cards, not independent confirmation.
- The mechanism is serialization-only. CSM/SEM canonical fields are unchanged.
- Production remains on the current mainline. This candidate is not a request
  for a second model call, OCR, retrieval, or world-knowledge lookup.

The next promotion gate is a fresh independent 150-card label-blind cohort. If
that cohort has no coverage, keep the mechanism as a harmless candidate but do
not claim a measured production gain.
