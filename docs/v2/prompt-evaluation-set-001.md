# Prompt Evaluation Set #001

Status: Evaluation Set Draft, No Prompt Changes Installed
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `prompt-upgrade-simulation-001.md`
- `correction-attribution-analysis-001.md`

## Scope

This document prepares a controlled A/B test for the first safe prompt-upgrade simulation.

It evaluates only:

- `Product retention`
- `Set retention`
- `Serial preservation`

It does not evaluate or install:

- `SSP`
- `Case-hit`
- `Sapphire`
- `Parallel inference`
- `Year normalization`

No prompt changes, runtime code, registry data, resolver logic, tests, deployment, or upgrades are modified.

## Evaluation Goal

Determine whether the proposed preservation prompt reduces avoidable title edits by keeping evidence-backed product, set, and serial fields intact.

The evaluation should compare:

```text
Current prompt output
vs.
Prompt Upgrade Simulation #001 output
```

Pass criteria:

- Product terms already present in evidence are preserved.
- Set or product-line terms already present in evidence are preserved.
- Serial numbers are not invented, duplicated, dropped, or mutated.
- No excluded claims are newly inferred.

## Evaluation Summary

| Category | Example count | Target behavior |
| --- | ---: | --- |
| Product retention | 5 | Preserve manufacturer/product-family terms. |
| Set retention | 5 | Preserve set, subset, edition, or product-line terms already present in evidence. |
| Serial preservation | 5 | Preserve exact serial values and avoid mutation or duplication. |
| Total | 15 | Controlled prompt-only preservation test. |

## Product Retention Examples

### eval-001

| Field | Value |
| --- | --- |
| category | `Product retention` |
| original generated title | `2015-16 Immaculate Auto Shaquille O'Neal Dual Signatures Anfernee Hardaway 01/25` |
| corrected title | `2015-16 Panini Immaculate Shaquille O'Neal Anfernee Hardaway Dual Signatures 01/25` |
| why correction happened | The generated title dropped the manufacturer/product-family term `Panini`. |
| expected behavior under new prompt | Preserve `Panini` when it is present in source evidence and do not shorten the title by removing manufacturer identity. |

### eval-002

| Field | Value |
| --- | --- |
| category | `Product retention` |
| original generated title | `2024 Stephen Curry Autographed Pre-Production Proof Crystal Red 1/1` |
| corrected title | `2024 Leaf Metal Sports Heroes Stephen Curry Auto Crystal Red 1/1` |
| why correction happened | The generated title omitted the product family `Leaf Metal Sports Heroes`. |
| expected behavior under new prompt | Preserve explicit product-family text instead of collapsing the listing to year, player, and attributes. |

### eval-003

| Field | Value |
| --- | --- |
| category | `Product retention` |
| original generated title | `Star Wars Masterwork Lucy Liu Bandit Leader Auto 4/5` |
| corrected title | `2025 Topps Star Wars Masterwork Lucy Liu Bandit Leader Silver Framed Auto 4/5` |
| why correction happened | The generated title omitted `Topps` and the year, weakening product identity. |
| expected behavior under new prompt | Preserve manufacturer/product identity when available. Do not infer unrelated product terms. |

### eval-004

| Field | Value |
| --- | --- |
| category | `Product retention` |
| original generated title | `2026 Topps Chrome Chrome Topps Propulsion Stephen Curry Red Parallel 2/5` |
| corrected title | `2026 Topps Cosmic Chrome Propulsion Stephen Curry Red Parallel 2/5 SSP` |
| why correction happened | The generated title had product wording duplication and did not preserve the more specific product-line wording cleanly. |
| expected behavior under new prompt | Preserve product-family words without duplicating them. Do not add `SSP` unless explicitly supplied by evidence. |

### eval-005

| Field | Value |
| --- | --- |
| category | `Product retention` |
| original generated title | `2026 Topps Chrome Shrewd Sheep VeeFriends Insert Card` |
| corrected title | `2026 Topps Chrome VeeFriends Shrewd Sheep Iconics SSP` |
| why correction happened | The generated title treated `VeeFriends` less like a product/program field and used generic insert/card wording. |
| expected behavior under new prompt | Preserve product/program identity such as `VeeFriends`; do not infer `SSP` or exact insert status from prompt behavior alone. |

## Set Retention Examples

### eval-006

| Field | Value |
| --- | --- |
| category | `Set retention` |
| original generated title | `2026 Topps Chrome Mercury Giannis Antetokounmpo Milwaukee Bucks` |
| corrected title | `2026 Topps Cosmic Chrome Giannis Antetokounmpo Planetary Pursuit Mercury` |
| why correction happened | The generated title used a less specific set/product-line structure and misplaced the insert-like `Mercury` term. |
| expected behavior under new prompt | Preserve specific set/product-line names when they are supplied, but do not infer `Cosmic Chrome` without explicit evidence. |

### eval-007

| Field | Value |
| --- | --- |
| category | `Set retention` |
| original generated title | `2026 Bowman Chrome Aidan Miller Philadelphia Phillies 1/1` |
| corrected title | `2026 Bowman Chrome Sapphire Edition Aidan Miller Padparadscha 1/1` |
| why correction happened | The corrected title adds a more specific edition/set line. |
| expected behavior under new prompt | Preserve `Sapphire Edition` only if explicitly supplied by evidence. This example tests that the prompt does not drop specific edition text when available. |

### eval-008

| Field | Value |
| --- | --- |
| category | `Set retention` |
| original generated title | `2024 Donruss Optic Kevin Durant Mythical Gold Vinyl 1/1 PSA 10` |
| corrected title | `2024 Donruss Optic Kevin Durant Mythical Gold Vinyl Prizm 1/1 PSA 10` |
| why correction happened | The generated title omitted the product-line/parallel-system term `Prizm`. |
| expected behavior under new prompt | Preserve set/product-line terms such as `Prizm` when present in evidence. |

### eval-009

| Field | Value |
| --- | --- |
| category | `Set retention` |
| original generated title | `2026 Topps Chrome Kon Knueppel RC Orange Refractor 03/25` |
| corrected title | `2026 Topps Cosmic Chrome Kon Knueppel Re-Entry RC Orange Raywave Refractor 03/25` |
| why correction happened | The corrected title includes a more specific product line and subset. |
| expected behavior under new prompt | Preserve set/subset terms if supplied; do not infer `Cosmic Chrome`, `Re-Entry`, or `Raywave` from prompt rules alone. |

### eval-010

| Field | Value |
| --- | --- |
| category | `Set retention` |
| original generated title | `2026 Topps Chrome Cosmic Dust Victor Wembanyama San Antonio Spurs` |
| corrected title | `2026 Topps Cosmic Chrome Victor Wembanyama Cosmic Dust San Antonio Spurs SSP` |
| why correction happened | The generated title preserved some set-like wording but did not keep the specific product-line order cleanly. |
| expected behavior under new prompt | Preserve supplied set/product-line wording such as `Cosmic Chrome` when evidence provides it; do not infer `SSP` from prompt behavior alone. |

## Serial Preservation Examples

### eval-011

| Field | Value |
| --- | --- |
| category | `Serial preservation` |
| original generated title | `2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/150` |
| corrected title | `2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/50` |
| why correction happened | The generated title had the wrong serial denominator. |
| expected behavior under new prompt | Preserve the exact serial value from explicit evidence; do not change denominator without evidence. |

### eval-012

| Field | Value |
| --- | --- |
| category | `Serial preservation` |
| original generated title | `1999 Topps Gold Label Vince Carter Class 1 Red Label 0/100 PSA 8` |
| corrected title | `1999 Topps Gold Label Vince Carter Class 1 Red Label 033/100 PSA 8` |
| why correction happened | The generated title dropped leading digits from the serial number. |
| expected behavior under new prompt | Preserve leading digits in serial numbers exactly as shown. |

### eval-013

| Field | Value |
| --- | --- |
| category | `Serial preservation` |
| original generated title | `2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199 029/199` |
| corrected title | `2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199` |
| why correction happened | The generated title duplicated the serial number in two formats. |
| expected behavior under new prompt | Do not duplicate serial numbers. Preserve one exact serial value. |

### eval-014

| Field | Value |
| --- | --- |
| category | `Serial preservation` |
| original generated title | `2024-25 Panini Noir Jalen Brunson Night Lights Auto 39/49` |
| corrected title | `2024-25 Panini Noir Jalen Brunson Night Lights Auto 36/49` |
| why correction happened | The generated title misread the serial numerator. |
| expected behavior under new prompt | Do not alter serial numerators unless source evidence explicitly supports the value. |

### eval-015

| Field | Value |
| --- | --- |
| category | `Serial preservation` |
| original generated title | `2025 Topps Signature Class Basketball Tyrese Maxey Veteran Class Auto Black` |
| corrected title | `2025 Topps Signature Class Basketball Tyrese Maxey Veteran Class Auto Black 1/1` |
| why correction happened | The generated title omitted a high-value serial number. |
| expected behavior under new prompt | Preserve visible or provided serial numbers, especially `1/1`, instead of dropping them during title compression. |

## A/B Test Instructions

Run each example twice:

1. Current prompt.
2. Prompt Upgrade Simulation #001 preservation wording.

For each output, score:

| Score field | Pass condition |
| --- | --- |
| Product retention | Product/manufacturer terms present in evidence are not dropped. |
| Set retention | Set, subset, edition, or product-line terms present in evidence are not dropped. |
| Serial preservation | Serial numbers are exact, not invented, duplicated, dropped, or reformatted incorrectly. |
| Exclusion safety | Output does not newly infer SSP, case-hit, Sapphire, named parallels, or year normalization. |
| Title usefulness | Output remains concise enough for listing use while preserving high-value fields. |

## Expected Results

Expected improvement:

- Fewer product omissions.
- Fewer set/product-line omissions.
- Fewer serial omissions, duplications, and mutations.

Expected non-improvement:

- This evaluation should not solve visual parallel recognition.
- This evaluation should not solve SSP or case-hit confirmation.
- This evaluation should not solve Sapphire/Shimmer distinctions.
- This evaluation should not solve broad year or season normalization.

## Non-Goals

This evaluation set does not:

- modify prompts
- install prompt changes
- modify runtime code
- modify registry data
- modify resolver logic
- create automated tests
- install upgrades
- download images
