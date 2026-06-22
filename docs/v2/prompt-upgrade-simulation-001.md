# Prompt Upgrade Simulation #001

Status: Simulation Only, No Prompt Changes Installed
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `prompt-opportunity-review-001.md`
- `correction-attribution-analysis-001.md`

## Scope

This document designs the first safe prompt upgrade package.

It includes only:

- `Product retention`
- `Set retention`
- `Serial preservation`

It explicitly excludes:

- `SSP`
- `Case-hit`
- `Sapphire`
- `Parallel inference`
- `Year normalization`

No prompt changes are installed. No runtime code, registry, resolver, tests, deployment, or upgrades are modified.

## Simulation Summary

The safest first prompt package should improve field preservation, not domain inference.

| Proposed change | Estimated affected records | Expected benefit | Risk | Install status |
| --- | ---: | --- | --- | --- |
| Product retention | 72 | Reduce dropped manufacturer/product-family terms. | Low/Medium | Simulation only |
| Set retention | 83 | Reduce dropped set/product-line terms already present in evidence. | Medium | Simulation only |
| Serial preservation | 55 | Reduce invented, duplicated, or mutated serial numbers. | Low | Simulation only |

Expected total impact:

These categories affect a meaningful share of corrected records, but they overlap with each other and with visual/checklist-dependent categories. The expected gain is bounded: this package should reduce avoidable omissions and mutations, not solve visual recognition or registry knowledge.

## Guardrails

This simulation package must not ask the prompt to infer new collectible facts.

Do not add instructions that:

- infer `SSP`
- infer `Case Hit`
- infer `Sapphire`
- infer named parallels from color or pattern
- normalize `2025`, `2026`, or `2025-26`
- add checklist-dependent insert, relic, or scarcity language
- replace registry or resolver behavior

The prompt should preserve evidence-backed fields. It should not create new knowledge.

## Proposed Prompt Package

If this were later converted into a prompt diff, the combined safe package would be:

```text
Preserve manufacturer, product-family, set, and product-line words when they are present in the input or visible evidence. Do not drop brand, product, set, subset, or edition terms to shorten the title.

Preserve serial numbers exactly as provided or visibly read. Do not invent serial numbers, change denominators, remove leading digits, duplicate serial numbers, or normalize serial formatting unless the source evidence explicitly shows the corrected value.

Do not infer SSP, case-hit, Sapphire, named parallels, or year/season normalization unless the evidence explicitly supplies that exact language.
```

This wording is not installed.

## Change 1: Product Retention

Category:

`Product retention`

Exact wording:

```text
Preserve manufacturer and product-family words when they are present in the input or visible evidence. Do not drop brand/product terms such as Topps, Bowman, Panini, Upper Deck, Leaf, Skybox, Chrome, Prizm, Optic, Finest, or similar product identifiers to shorten the title.
```

Why it exists:

Operators frequently add or correct manufacturer and product-family terms. The model appears to compress or omit product identity when trying to create a concise title.

Estimated affected records:

- 72 records
- 20.5% of corrected records

Expected benefit:

- Reduces missing product/manufacturer terms.
- Preserves product identity when already present.
- Helps prevent later ambiguity in set, insert, and parallel interpretation.

Expected risk:

- Low/Medium.
- The main risk is preserving a noisy product term from input when that term is wrong.
- The prompt must preserve evidence-backed product terms, not infer product terms.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2015-16 Immaculate Auto Shaquille O'Neal Dual Signatures Anfernee Hardaway 01/25` | `2015-16 Panini Immaculate Shaquille O'Neal Anfernee Hardaway Dual Signatures 01/25` |
| `2024 Stephen Curry Autographed Pre-Production Proof Crystal Red 1/1` | `2024 Leaf Metal Sports Heroes Stephen Curry Auto Crystal Red 1/1` |
| `Star Wars Masterwork Lucy Liu Bandit Leader Auto 4/5` | `2025 Topps Star Wars Masterwork Lucy Liu Bandit Leader Silver Framed Auto 4/5` |

Rollback strategy:

- Remove this prompt sentence if review shows product terms are being preserved from noisy input when they should be dropped.
- Roll back to the previous prompt if product false positives increase.
- Keep any useful examples as test cases rather than broad prompt instructions.

## Change 2: Set Retention

Category:

`Set retention`

Exact wording:

```text
Keep set and product-line names as first-class title fields. If a title includes a set line, subset, edition, or product family, preserve it near the front of the title after year/manufacturer. Do not replace a specific set line with a generic sport or product word.
```

Why it exists:

Operators often correct missing or weakened set/product-line language. The model may keep generic brand words while dropping the more specific set line that makes the listing accurate.

Estimated affected records:

- 83 records
- 23.6% of corrected records

Expected benefit:

- Reduces lost set and product-line terms.
- Improves preservation of specific titles when the set is already supplied.
- Helps raw titles keep important listing context without registry changes.

Expected risk:

- Medium.
- Some set names are checklist-dependent or visually uncertain.
- If the source evidence is noisy, preserving the set may preserve an incorrect claim.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2026 Topps Chrome Mercury Giannis Antetokounmpo Milwaukee Bucks` | `2026 Topps Cosmic Chrome Giannis Antetokounmpo Planetary Pursuit Mercury` |
| `2026 Bowman Chrome Aidan Miller Philadelphia Phillies 1/1` | `2026 Bowman Chrome Sapphire Edition Aidan Miller Padparadscha 1/1` |
| `2024 Donruss Optic Kevin Durant Mythical Gold Vinyl 1/1 PSA 10` | `2024 Donruss Optic Kevin Durant Mythical Gold Vinyl Prizm 1/1 PSA 10` |

Rollback strategy:

- Remove this prompt sentence if set names become over-preserved from uncertain input.
- Add a stricter qualifier requiring the set to be explicitly present in user input, source text, slab text, or visible card text.
- Keep set corrections in registry/fixture review if prompt-only preservation causes ambiguity.

## Change 3: Serial Preservation

Category:

`Serial preservation`

Exact wording:

```text
Preserve serial numbers exactly as provided or visibly read. Do not invent serial numbers, change denominators, remove leading digits, duplicate serial numbers, or normalize serial formatting unless the source evidence explicitly shows the corrected value.
```

Why it exists:

Serial-number edits are frequent and high-value. Operators correct missing, duplicated, or mutated serials, including denominator changes and leading-digit fixes.

Estimated affected records:

- 55 records
- 15.7% of corrected records

Expected benefit:

- Reduces invented serial numbers.
- Reduces duplicated serial numbers.
- Reduces denominator changes without evidence.
- Encourages exact preservation of `1/1`, `031/50`, `033/100`, and similar values.

Expected risk:

- Low.
- This is a non-invention and exact-preservation rule.
- It cannot solve visual serial reading by itself.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/150` | `2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/50` |
| `1999 Topps Gold Label Vince Carter Class 1 Red Label 0/100 PSA 8` | `1999 Topps Gold Label Vince Carter Class 1 Red Label 033/100 PSA 8` |
| `2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199 029/199` | `2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199` |

Rollback strategy:

- Remove this prompt sentence only if it causes the model to retain clearly wrong serials from noisy input.
- Prefer tightening wording over full rollback, for example by requiring exact preservation only from explicit source evidence.
- Track serial-specific regressions separately from product/set regressions.

## Excluded From This Simulation

The following opportunities are intentionally excluded even though they may be important:

| Excluded area | Reason |
| --- | --- |
| `SSP` | Checklist-dependent and high false-positive risk. |
| `Case-hit` | Checklist-dependent and not safe as prompt-only inference. |
| `Sapphire` | Known confusion risk, especially against Shimmer. |
| `Parallel inference` | Requires visual review and fixture coverage. |
| `Year normalization` | Product/sport-specific and unsafe as a broad prompt rule. |
| `Insert retention` | Often overlaps with SSP/case-hit language; safer after checklist-source policy. |
| `Autograph preservation` | Useful, but held for a later package to keep Simulation #001 narrow. |
| `Subject retention` | Useful, but needs better multi-subject examples and tests. |

## Expected Evaluation Before Installation

Before this package is installed, create a small prompt evaluation set with:

- product-retention examples
- set-retention examples
- serial-preservation examples
- negative examples where product/set/serial source evidence is noisy
- examples that include excluded concepts such as SSP, Sapphire, and year normalization to ensure the prompt does not infer them

Pass criteria:

- Product terms already present in source evidence are preserved.
- Set terms already present in source evidence are preserved.
- Serial numbers are not invented, duplicated, or reformatted incorrectly.
- No new SSP, case-hit, Sapphire, named-parallel, or year-normalization claims are added without explicit evidence.

## Simulated Install Recommendation

| Change | Install recommendation |
| --- | --- |
| Product retention | `install later` after evaluation |
| Set retention | `install later` after evaluation |
| Serial preservation | `install later` after evaluation |

No prompt change should be installed directly from this simulation.

## Non-Goals

This simulation did not:

- modify prompts
- modify runtime code
- modify registry data
- modify resolver logic
- install upgrades
- create tests
- create fixtures
- download images
