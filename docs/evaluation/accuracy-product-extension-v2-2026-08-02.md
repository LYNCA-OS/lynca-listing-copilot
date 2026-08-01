# Accuracy mechanism: guarded product extension — 2026-08-02

## Decision

Keep the guarded product extension as a **confirmation candidate**. It is the
strongest current low-cost recovery mechanism, but it is not production
authority yet: the 150-card paid run is a fresh response run on the mixed
cohort, not an independent 150-card card cohort.

The rule is evaluation-only and has two hard stops:

- manufacturer must be a known manufacturer (`Topps`, `Panini`, `Upper Deck`,
  or `Leaf`);
- the existing product must be a strict prefix/subsequence of the free-title
  product, and all lot cards are rejected.

No provider calls were added by this replay. The source is the already-paid
`thin_budgeted` / `thin_canonical_high` pair; no Cloud Run, vector, OCR, or
second model is involved.

## Measured results

| Cohort | Cards | Changed | Wins / losses / ties | Δ macro F1 | Reference-loss cards | Over 80 |
|---|---:|---:|---:|---:|---:|---:|
| Fresh mixed paid run | 150 | 6 | **6 / 0 / 144** | **+0.002826** | 0 | 0 |
| Outside-development subset | 105 | 5 | **5 / 0 / 100** | **+0.003419** | 0 | 0 |

Baseline/replay on the full fresh run was `0.772129 → 0.774955`. The outside
subset was `0.771023 → 0.774441`.

This is a positive **candidate mechanism**, not proof of independent-card
generalization. It must still pass a pre-registered independent 150-card
confirmation before any CSM/SEM admission change.

## Changed-card ledger — full fresh 150

| Card | Baseline → replay | ΔF1 | Recovered product token |
|---|---|---:|---|
| Shohei Ohtani Sapphire | `Topps Chrome Ohtani…` → `Topps Chrome Sapphire Ohtani…` | +0.047431 | Sapphire |
| Paul Atreides Dune | `Topps Chrome Paul Atreides…` → `Topps Chrome Dune Paul Atreides…` | +0.078431 | Dune |
| Penta WWE | `Topps Chrome Penta…` → `Topps Chrome WWE Penta…` | +0.084211 | WWE |
| VeeFriends Hustling Hamster | `Topps Chrome Hustling Hamster…` → `Topps Chrome VeeFriends Hustling Hamster…` | +0.063158 | VeeFriends |
| Lionel Messi MLS | `Topps Chrome Lionel Messi…` → `Topps Chrome MLS Lionel Messi…` | +0.085714 | MLS |
| VeeFriends Common Sense Cow | `Topps Chrome Common Sense Cow…` → `Topps Chrome VeeFriends Common Sense Cow…` | +0.064935 | VeeFriends |

The five-card outside-development ledger is the same except that Common Sense
Cow is not in that subset. All six changes add a product identity token; none
removes a reference token, exceeds the 80-character contract, or touches a
lot card.

## Why this is not shipped

The positive rows are concentrated in recognizable product/IP extensions. The
same family previously produced false product extensions on lot cards and
wrong product identity, so the lot guard is necessary but not yet sufficient
for promotion. The current evidence supports running the rule through an
independent 150-card gate, not wiring it into production.

Replay artifacts:

- `artifacts/accuracy-mechanism-confirmatory-2026-08-02/fresh-nonserial-confirmation-v3.json`
- `artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105-nonserial-confirmation-v3.json`
