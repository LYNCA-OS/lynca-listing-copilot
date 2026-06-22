# Prompt Opportunity Review #001

Status: Prompt Opportunity Review Only, No Prompt Changes Installed
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `correction-attribution-analysis-001.md`
- `upgrade-recommendation-001.md`
- `review-cycle-001-results.md`

## Scope

This document identifies prompt-only opportunities that may improve raw title accuracy without changing registry or resolver behavior.

It answers:

```text
If we were allowed to improve the prompt only, where would we start?
```

No prompt changes are installed. No runtime code, registry, resolver, tests, deployment, or upgrades are modified.

## Executive Answer

If prompt-only improvement were allowed, start with preservation rules, not new collectible knowledge.

The safest prompt improvements are:

1. Preserve product and set text that is already present or visible.
2. Preserve insert/subset names when they are present in source evidence.
3. Preserve serial numbers exactly; never invent or normalize them.
4. Preserve autograph language and do not collapse card grade with auto grade.
5. Use stable title field ordering so important fields are not dropped.
6. Preserve all named subjects on multi-subject cards.

Avoid prompt changes that ask the model to infer Sapphire, SSP, case-hit, season/year, exact checklist names, or parallel names without evidence.

## Evidence Baseline

From `correction-attribution-analysis-001.md`:

| Category | Estimated affected records | Estimated share |
| --- | ---: | ---: |
| `product` | 72 | 20.5% |
| `set` | 83 | 23.6% |
| `insert` | 32 | 9.1% |
| `serial` | 55 | 15.7% |
| `auto` | 51 | 14.5% |
| `player` / subject | 51 | 14.5% |
| `team` | 37 | 10.5% |
| `wording only` | 38 | 10.8% |

From `upgrade-recommendation-001.md`:

- No prompt updates are mature enough to install now.
- Fixture Set #001 is mature for tests only.
- Registry, resolver, prompt, and runtime changes should not be installed from the current cycle.

From `review-cycle-001-results.md`:

- Text diffs identify candidates.
- Image evidence is required for review.
- Visual verification is required for visual concept promotion.
- Human approval is required before installation.

## Opportunity Summary

| Rank | Category | Evidence count | Estimated impact | Risk | Expected accuracy gain |
| ---: | --- | ---: | --- | --- | --- |
| 1 | Product retention | 72 | High | Low/Medium | Medium |
| 2 | Set retention | 83 | High | Medium | Medium |
| 3 | Serial preservation | 55 | High | Low | Medium |
| 4 | Autograph preservation | 51 | Medium/High | Medium | Low/Medium |
| 5 | Subject retention | 51 | Medium/High | Medium | Low/Medium |
| 6 | Title field ordering | 38 wording-only, plus multi-field overlaps | Medium | Low | Low/Medium |
| 7 | Insert retention | 32 | Medium | High | Low/Medium |
| 8 | Team handling | 37 | Medium | Medium | Low |

## Opportunities

### 1. Product Retention

Category:

`product retention`

Evidence count:

- 72 records, 20.5% of corrected records.

Estimated impact:

- High. Missing or compressed product identity causes downstream corrections in product, set, year, insert, and parallel fields.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2015-16 Immaculate Auto Shaquille O'Neal Dual Signatures Anfernee Hardaway 01/25` | `2015-16 Panini Immaculate Shaquille O'Neal Anfernee Hardaway Dual Signatures 01/25` |
| `2024 Stephen Curry Autographed Pre-Production Proof Crystal Red 1/1` | `2024 Leaf Metal Sports Heroes Stephen Curry Auto Crystal Red 1/1` |
| `Star Wars Masterwork Lucy Liu Bandit Leader Auto 4/5` | `2025 Topps Star Wars Masterwork Lucy Liu Bandit Leader Silver Framed Auto 4/5` |

Proposed prompt change:

```text
Preserve manufacturer and product-family words when they are present in the input or visible evidence. Do not drop brand/product terms such as Topps, Bowman, Panini, Upper Deck, Leaf, Skybox, Chrome, Prizm, Optic, Finest, or similar product identifiers to shorten the title.
```

Risk:

- Low/Medium.
- Risk comes from preserving a product term that was present in noisy input but wrong.

Expected accuracy gain:

- Medium.
- Best gain comes from reducing dropped product/manufacturer terms, not from inferring missing products.

Prompt-only boundary:

- Do not infer a manufacturer or product line from player, year, or parallel alone.

### 2. Set Retention

Category:

`set retention`

Evidence count:

- 83 records, 23.6% of corrected records.

Estimated impact:

- High. Set/product-line terms are a major source of operator correction.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2026 Topps Chrome Mercury Giannis Antetokounmpo Milwaukee Bucks` | `2026 Topps Cosmic Chrome Giannis Antetokounmpo Planetary Pursuit Mercury` |
| `2026 Bowman Chrome Aidan Miller Philadelphia Phillies 1/1` | `2026 Bowman Chrome Sapphire Edition Aidan Miller Padparadscha 1/1` |
| `2024 Donruss Optic Kevin Durant Mythical Gold Vinyl 1/1 PSA 10` | `2024 Donruss Optic Kevin Durant Mythical Gold Vinyl Prizm 1/1 PSA 10` |

Proposed prompt change:

```text
Keep set and product-line names as first-class title fields. If a title includes a set line, subset, edition, or product family, preserve it near the front of the title after year/manufacturer. Do not replace a specific set line with a generic sport or product word.
```

Risk:

- Medium.
- Set names may be checklist-dependent or visually uncertain.

Expected accuracy gain:

- Medium.

Prompt-only boundary:

- Preserve set names that are present; do not upgrade to set names such as Cosmic Chrome, Sapphire Edition, or University unless the evidence explicitly supplies them.

### 3. Serial Preservation

Category:

`serial preservation`

Evidence count:

- 55 records, 15.7% of corrected records.

Estimated impact:

- High. Serial mistakes are small text changes with large listing-value impact.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/150` | `2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/50` |
| `1999 Topps Gold Label Vince Carter Class 1 Red Label 0/100 PSA 8` | `1999 Topps Gold Label Vince Carter Class 1 Red Label 033/100 PSA 8` |
| `2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199 029/199` | `2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199` |

Proposed prompt change:

```text
Preserve serial numbers exactly as provided or visibly read. Do not invent serial numbers, change denominators, remove leading digits, duplicate serial numbers, or normalize serial formatting unless the source evidence explicitly shows the corrected value.
```

Risk:

- Low.
- This is a preservation and non-invention rule.

Expected accuracy gain:

- Medium.

Prompt-only boundary:

- Prompt can discourage invention and duplication, but exact serial extraction needs visual/OCR evaluation.

### 4. Autograph Preservation

Category:

`autograph preservation`

Evidence count:

- 51 records, 14.5% of corrected records.

Estimated impact:

- Medium/High. Missing or collapsed autograph language can materially change listing meaning.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2019-20 Panini Immaculate Collection PJ Washington Jr. Tyler Herro Duo Auto 1/1` | `2019-20 Panini Immaculate PJ Washington Jr. Tyler Herro Duo Dual Logoman Autographs 1/1` |
| `2024 Stephen Curry Autographed Pre-Production Proof Crystal Red 1/1` | `2024 Leaf Metal Sports Heroes Stephen Curry Auto Crystal Red 1/1` |
| `Panini Prizm 20 2 Kobe Bryant Auto PSA 10` | `2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10` |

Proposed prompt change:

```text
Preserve autograph status and autograph-specific wording when present. Do not drop Auto, Autograph, Signed, Signature, Signatures, or certified autograph language. Keep card grade and autograph grade separate when both are present, such as PSA 9/10 or Auto 10.
```

Risk:

- Medium.
- Exact autograph insert names may be checklist-dependent.

Expected accuracy gain:

- Low/Medium.

Prompt-only boundary:

- Preserve autograph evidence; do not infer autograph status from player, product, or serial alone.

### 5. Subject Retention

Category:

`subject retention`

Evidence count:

- 51 records, 14.5% of corrected records.

Estimated impact:

- Medium/High. Subject errors are especially risky for dual autos, multi-player cards, and entertainment cards.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2019-20 Panini Immaculate Collection PJ Washington Jr. Tyler Herro Duo Auto 1/1` | `2019-20 Panini Immaculate PJ Washington Jr. Tyler Herro Duo Dual Logoman Autographs 1/1` |
| `2026 Topps Disney Chrome Authentic Quad Auto Tiana Louis Mama Odie Ray` | `2026 Topps Disney Chrome Quad Auto Tiana Louis Mama Odie Ray SSP` |
| `2024 Skybox Metal Universe Avengers Jim Starlin Comic Cuts Auto 01/10 CGC 9` | Used as a corrected target where the subject and product family both matter. |

Proposed prompt change:

```text
Preserve every named person or character that appears to be a card subject. For dual, triple, quad, or multi-subject cards, keep all subjects in the title and avoid replacing subject names with generic phrases.
```

Risk:

- Medium.
- Some names can be team names, insert names, or character names rather than players.

Expected accuracy gain:

- Low/Medium.

Prompt-only boundary:

- Prompt can preserve named subjects, but cannot verify identity without visual/source evidence.

### 6. Title Field Ordering

Category:

`title field ordering`

Evidence count:

- 38 wording-only records, 10.8%.
- Also relevant to many multi-field corrections where correct terms are present but misplaced or crowded out.

Estimated impact:

- Medium. Better ordering can reduce dropped fields and operator cleanup.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2017-18 Panini Crown Royale Jayson Tatum Auto 095/199` | `2017-18 Panini Crown Royale Jayson Tatum Auto 095/199 RC` |
| `2000 Bowman Chrome Tom Brady RC BGS 9.5` | `2000 Bowman Chrome Tom Brady Rookie RC BGS 9.5` |
| `2018 Topps Chrome Shohei Ohtani RC Refractor PSA 10` | `2018 Topps Chrome Shohei Ohtani RC Refractor Rookie PSA 10` |

Proposed prompt change:

```text
Use a stable title order when evidence is available: year, manufacturer/product, set or subset, subject, rookie/1st designation, insert, parallel, auto/relic/patch, serial, grade. Do not remove high-value fields to improve style.
```

Risk:

- Low.

Expected accuracy gain:

- Low/Medium.

Prompt-only boundary:

- Ordering should preserve fields; it should not force absent fields into the title.

### 7. Insert Retention

Category:

`insert retention`

Evidence count:

- 32 records, 9.1%.

Estimated impact:

- Medium. Insert names are valuable but often checklist-dependent.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid` | `2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP` |
| `2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5` | `2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP` |
| `2025 Topps Finest Shohei Ohtani Gusto 5/5 Los Angeles Dodgers` | `2025 Topps Finest Shohei Ohtani Gusto Red Refractor 5/5 Los Angeles Dodgers` |

Proposed prompt change:

```text
Preserve insert, subset, and named program text when it is provided or visibly present. Do not drop terms such as Home Advantage, Shadow Etch, Pixel Burst, Gusto, Signature Shots, Rookie Ticket, All Kings, or similar named inserts when they are part of the evidence.
```

Risk:

- High.
- Some insert and SSP terms require checklist validation.

Expected accuracy gain:

- Low/Medium.

Prompt-only boundary:

- Preserve insert names already present; do not add SSP, case-hit, or exact insert status unless explicitly supported.

### 8. Team Handling

Category:

`title field ordering` / `subject retention`

Evidence count:

- 37 records, 10.5%.

Estimated impact:

- Medium. Team edits are common, but not always directionally consistent.

Example corrections:

| Generated | Corrected |
| --- | --- |
| `2025 Bowman Chrome Bowman RC Cooper Flagg Bowman Rookie Refresh` | `2025 Bowman Chrome RC Cooper Flagg Rookie Red RC Mavericks` |
| `2026 Topps LeBron James Leviathans Los Angeles Lakers` | `2026 Topps Signatures Class Lebron James Leviathans SSP` |
| `2026 Topps Trey Yesavage Toronto Blue Jays RC Player-Worn Memorabilia 14/50` | `2026 Topps Series 2 Trey Yesavage Gold Major League Material Relic RC 14/50` |

Proposed prompt change:

```text
Include team names when they are important card text or helpful identity context, but do not let team names replace higher-value fields such as set, insert, parallel, serial, autograph, relic, or grade. When title length is tight, preserve scarce/card-specific attributes before team names.
```

Risk:

- Medium.
- Team inclusion is context-dependent.

Expected accuracy gain:

- Low.

Prompt-only boundary:

- This is a prioritization rule, not a team-normalization registry.

## Prompt-Only Starting Point

If one prompt change package were allowed later, the safest draft would be:

```text
When generating a collectible listing title, preserve evidence-backed fields before shortening or rewriting. Use this order when available: year, manufacturer/product, set/subset, subject(s), rookie/1st designation, insert, parallel, auto/relic/patch, serial number, grade.

Do not drop manufacturer, product, set, insert, serial, autograph, relic, patch, grade, or named subject fields when they are present in the source evidence.

Preserve serial numbers exactly. Do not invent, duplicate, or normalize serial numbers.

Preserve autograph status and keep card grade and autograph grade separate.

For multi-subject cards, keep all named subjects.

Do not infer Sapphire, SSP, case-hit, year/season, exact insert, exact relic, or exact parallel language unless the evidence explicitly supports it.
```

This is a proposal only. It should be converted into tests before any prompt installation.

## Risk Ranking

| Opportunity | Risk | Why |
| --- | --- | --- |
| Serial preservation | Low | Mostly a non-invention and exact-preservation instruction. |
| Title field ordering | Low | Encourages consistent formatting without new knowledge. |
| Product retention | Low/Medium | Safe when preserving, risky if inferred. |
| Autograph preservation | Medium | Exact auto-program names can be checklist-dependent. |
| Subject retention | Medium | Multi-subject parsing can be noisy. |
| Team handling | Medium | Direction is context-dependent. |
| Set retention | Medium | Some set names require verification. |
| Insert retention | High | Insert/SSP/case-hit terms can require checklist confirmation. |

## Expected Accuracy Gain

Expected prompt-only gain is real but bounded.

Prompt changes can likely reduce:

- dropped product terms
- dropped set terms already present in evidence
- duplicated or mutated serial numbers
- dropped autograph wording
- lost multi-subject names
- inconsistent ordering

Prompt changes are unlikely to safely solve:

- visual parallel recognition
- exact serial reading from images
- SSP or case-hit confirmation
- checklist-dependent insert names
- broad year/season normalization
- Sapphire/Shimmer distinctions

## Do Not Install

No prompt changes should be installed from this document.

Before installation, each proposed prompt rule should become:

1. a testable assertion,
2. a small evaluation set,
3. a human-approved prompt diff,
4. a rollback plan.

## Non-Goals

This review did not:

- modify prompts
- modify runtime code
- modify registry data
- modify resolver logic
- modify tests
- install upgrades
- create fixtures
- download images
