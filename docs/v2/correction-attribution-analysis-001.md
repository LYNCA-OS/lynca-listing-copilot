# Correction Attribution Analysis #001

Status: Attribution Analysis Only, No Installation
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Source:

- Current ignored export: `data/learning/supabase-feedback-export-current.json`
- Source table: `listing_title_feedback`
- Records analyzed: 351

## Scope

This document analyzes why operators are editing Listing Copilot titles.

It does not analyze specific collectible concepts. It attributes each corrected record to likely changed title fields:

- `year`
- `product`
- `set`
- `insert`
- `parallel`
- `serial`
- `player`
- `team`
- `grade`
- `auto`
- `relic`
- `patch`
- `wording only`

No runtime code, registry, resolver, prompt, deployment, test, or upgrade changes are included.

## Method Notes

All 351 records were evaluated by comparing `generated_title` to `corrected_title`.

Attribution is heuristic because titles are unstructured text. A record may be assigned to multiple categories, so percentages do not sum to 100%.

`wording only` means no structured field category was detected. It does not mean the edit was unimportant.

`player` is interpreted as likely player/subject text changed, including added, removed, reordered, or normalized person names. Multi-subject cards can make this category noisy.

## Direct Answer

If 90% of records are edited, why?

In this export, 100% of records are edited because `listing_title_feedback` only stores submitted corrections. Operators are mostly editing because the generated title is missing or misidentifying structured collectible fields, not because they are polishing prose.

The biggest drivers are:

1. Parallel/variant detail is missing or wrong.
2. Year or season is incomplete or product-specific.
3. Set and product identity are incomplete.
4. Serial numbering is missing or misread.
5. Autograph, relic, patch, and grade semantics need preservation.
6. Insert/subset and SSP-like language is often checklist-dependent.
7. Wording-only edits are a small minority.

## Top Correction Categories

| Rank | Category | Estimated affected records | Estimated share of corrected records |
| ---: | --- | ---: | ---: |
| 1 | `parallel` | 158 | 45.0% |
| 2 | `year` | 85 | 24.2% |
| 3 | `set` | 83 | 23.6% |
| 4 | `product` | 72 | 20.5% |
| 5 | `serial` | 55 | 15.7% |
| 6 | `auto` | 51 | 14.5% |
| 7 | `player` | 51 | 14.5% |
| 8 | `wording only` | 38 | 10.8% |
| 9 | `team` | 37 | 10.5% |
| 10 | `insert` | 32 | 9.1% |
| 11 | `grade` | 20 | 5.7% |
| 12 | `relic` | 18 | 5.1% |
| 13 | `patch` | 8 | 2.3% |

Most common overlapping categories:

| Overlap | Records |
| --- | ---: |
| `parallel` + `set` | 59 |
| `parallel` + `product` | 36 |
| `parallel` + `year` | 34 |
| `set` + `year` | 26 |
| `parallel` + `serial` | 26 |
| `product` + `set` | 22 |
| `parallel` + `team` | 21 |
| `parallel` + `player` | 19 |
| `product` + `year` | 18 |
| `insert` + `set` | 16 |

Interpretation:

Operators usually edit multiple structured fields at once. A single correction often changes set, parallel, serial, and insert wording together.

## Category Interpretation

### Parallel

Estimated affected records: 158, 45.0%.

Why operators edit:

- Missing named parallels.
- Generic color labels need more specific parallel names.
- Shimmer/Sapphire, Raywave/Wave, Geometric, Cosmic, Gold, Red, Blue, and Prizm-style distinctions are difficult.

Likely system cause:

- Visual-recognition problem first.
- Registry problem second, if the system lacks a controlled list of parallel names.

Best improvement surface:

- Visual fixtures and visual regression tests.
- Later registry support only after repeated aligned fixtures.

### Year

Estimated affected records: 85, 24.2%.

Why operators edit:

- Product years and season years differ.
- `2025`, `2026`, and `2025-26` are often corrected.
- Some titles add missing release years.

Likely system cause:

- Registry/product-policy problem.
- Resolver problem only when there is deterministic evidence from a label/card back.

Best improvement surface:

- Product-year policy and checklist-backed fixtures.
- Do not install broad year normalization.

### Set

Estimated affected records: 83, 23.6%.

Why operators edit:

- Product-line names are incomplete or wrong.
- Titles miss line-specific identifiers such as Chrome, Cosmic Chrome, Sapphire Edition, Draft, University, Finest, Optic, or other set/subset language.

Likely system cause:

- Registry problem.
- Visual-recognition problem when set identity is visible on card front/back.

Best improvement surface:

- Set/product registry candidates after more fixtures.
- Image-backed review for visible set text.

### Product

Estimated affected records: 72, 20.5%.

Why operators edit:

- Brand/manufacturer or product family is missing.
- Some titles need `Topps`, `Panini`, `Bowman`, `Upper Deck`, `Leaf`, or other product identity added or corrected.

Likely system cause:

- Registry problem.
- Prompt problem when the model drops visible product text or over-compresses brand names.

Best improvement surface:

- Product identity extraction checks.
- Registry-backed product naming once enough examples exist.

### Serial

Estimated affected records: 55, 15.7%.

Why operators edit:

- Serial numbers are missing, duplicated, or misread.
- Denominators and leading digits change.
- `1/1`, `31/50`, `033/100`, and similar exact values need image accuracy.

Likely system cause:

- Visual/OCR recognition problem.
- Resolver problem only if extracting serials from known visible text.

Best improvement surface:

- Serial-read evaluation track.
- Image-based validation, not learned title rules.

### Auto

Estimated affected records: 51, 14.5%.

Why operators edit:

- Autograph language is missing, generic, or set-specific.
- `Auto`, `Autograph`, `Signatures`, `Signature Shots`, and related title terms are frequently normalized.

Likely system cause:

- Visual-recognition problem when the autograph is visible.
- Registry/checklist problem when exact insert-auto naming is required.
- Prompt problem when the model drops auto language already visible or present in source context.

Best improvement surface:

- Auto preservation tests.
- Knowledge fixtures for card-grade versus auto-grade split.

### Player

Estimated affected records: 51, 14.5%.

Why operators edit:

- Person/subject strings are added, removed, reordered, or normalized.
- Multi-subject cards and entertainment/non-sports cards increase ambiguity.

Likely system cause:

- Prompt problem for title ordering and subject retention.
- Visual-recognition problem when the subject must be read from images.

Best improvement surface:

- Subject-retention evaluation.
- Multi-subject title templates.

### Wording Only

Estimated affected records: 38, 10.8%.

Why operators edit:

- The structured fields are mostly intact, but title wording, ordering, or redundancy is improved.
- Examples include `RC`/`Rookie`, duplicate words, or title cleanup.

Likely system cause:

- Prompt problem.

Best improvement surface:

- Style and compression guidance.
- Low-risk title-format tests.

### Team

Estimated affected records: 37, 10.5%.

Why operators edit:

- Team names are added, removed, or corrected.
- Some corrections remove unnecessary team text when a more precise set/parallel term matters more.

Likely system cause:

- Prompt problem for title prioritization.
- Visual-recognition problem if team is image-derived.
- Registry problem for sport/team normalization only after clear policy.

Best improvement surface:

- Team-retention policy by category.
- Title length/priority rules.

### Insert

Estimated affected records: 32, 9.1%.

Why operators edit:

- Insert or subset names are missing or mispositioned.
- Examples include case-hit and insert-like names such as `Home Advantage`, `Shadow Etch`, `Pixel Burst`, `All Kings`, `Gusto`, and signature-specific inserts.

Likely system cause:

- Registry/checklist problem.
- Visual-recognition problem when insert name is printed on card.

Best improvement surface:

- Checklist-source policy.
- Insert-name fixtures after human review.

### Grade

Estimated affected records: 20, 5.7%.

Why operators edit:

- PSA/BGS/CGC/SGC grade text is missing, changed, or semantically ambiguous.
- Card grade and autograph grade can be collapsed or misrepresented.

Likely system cause:

- Visual/OCR recognition problem for slab labels.
- Knowledge fixture problem for grade semantics.

Best improvement surface:

- Auto-grade split fixture.
- Slab-label read tests.

### Relic

Estimated affected records: 18, 5.1%.

Why operators edit:

- Relic, material, memorabilia, jersey, and player-worn terms are changed or replaced by set-specific names.

Likely system cause:

- Visual-recognition problem when relic window/material is visible.
- Checklist problem for exact relic program names.

Best improvement surface:

- Hybrid fixtures with checklist confirmation.

### Patch

Estimated affected records: 8, 2.3%.

Why operators edit:

- Patch language is added, removed, or replaced by more exact memorabilia language such as jersey, logoman, tag, or relic.

Likely system cause:

- Visual-recognition problem.
- Checklist problem for exact memorabilia subtype.

Best improvement surface:

- Patch/relic distinction fixtures.

## Likely Prompt Problems

Prompt-related edits are mostly about preserving known fields and formatting titles well.

Likely prompt problem categories:

| Category | Why |
| --- | --- |
| `wording only` | Low-structure cleanup, duplicate words, ordering, `RC`/`Rookie` phrasing. |
| `player` | Multi-subject preservation and ordering. |
| `team` | Deciding when team belongs in title versus when it should be dropped for higher-value fields. |
| `auto` | Preserving autograph wording when already evident. |
| `product` | Avoiding dropped manufacturer/product words when source evidence is clear. |

Prompt changes are not recommended yet. These should first become test cases and evaluation criteria.

## Likely Registry Problems

Registry-related edits are about missing controlled knowledge: product lines, set names, insert names, and known parallel terminology.

Likely registry problem categories:

| Category | Why |
| --- | --- |
| `product` | Brand/manufacturer naming needs controlled normalization. |
| `set` | Set/product-line names recur and need stable vocabulary. |
| `insert` | Insert names and case-hit names require product-specific knowledge. |
| `parallel` | Parallel vocabulary is broad and product-sensitive. |
| `year` | Season/year conventions are product-specific. |
| `relic` | Exact relic program names often require checklist knowledge. |

Registry updates are not ready to install. They need repeated aligned fixtures and human approval.

## Likely Resolver Problems

Resolver-related edits are fields that may become deterministic only when required input evidence is available.

Likely resolver problem categories:

| Category | Why |
| --- | --- |
| `serial` | Exact serial values can be extracted from images or trusted text, but should not be inferred. |
| `grade` | Slab labels can be parsed when visible, but card-grade/auto-grade semantics need care. |
| `year` | Some year corrections may be deterministic from card-back copyright or set code. |
| `product` | Visible product text can sometimes be resolved deterministically. |
| `auto` | Visible slab/card text can confirm autograph status. |

Resolver updates are not ready to install. The current cycle shows the need for an extraction/evaluation lane first.

## Likely Visual-Recognition Problems

Visual-recognition problems are fields that depend on seeing the card, slab, serial, pattern, or material.

Likely visual-recognition categories:

| Category | Why |
| --- | --- |
| `parallel` | Pattern/color/foil distinctions are often visible but subtle. |
| `serial` | Exact numbering must be read, not inferred. |
| `grade` | Slab labels carry grade and auto-grade details. |
| `auto` | Autographs and certified-auto text can be visible. |
| `relic` | Material windows and relic text can be visible. |
| `patch` | Patch/jersey/tag distinctions can be visual. |
| `set` | Card-front/back logos and set text can identify product line. |

The strongest immediate response is more visual fixtures and regression tests, not runtime behavior.

## Top 10 Opportunities To Improve Raw Title Accuracy

1. Improve parallel/variant recognition.
   Parallel edits affect about 45.0% of corrected records. This is the largest single category and should drive fixture growth.

2. Build a product/set vocabulary review layer.
   Product plus set edits affect about 20.5% and 23.6% of records respectively, with substantial overlap.

3. Add a serial-read evaluation track.
   Serial edits affect 15.7% of records and should be measured separately from concept fixtures.

4. Preserve autograph language more reliably.
   Auto edits affect 14.5% of records and often interact with insert and grade semantics.

5. Create card-grade versus auto-grade tests.
   Grade edits affect 5.7% overall but are high-value because grade mistakes can materially change listings.

6. Define title rules for multi-subject cards.
   Player/subject changes affect an estimated 14.5% of records and include dual autos, entertainment cards, and multi-player relics.

7. Define team inclusion policy.
   Team edits affect 10.5% of records. The system needs to know when team is useful and when it is lower priority than set/parallel/insert.

8. Create insert/checklist review workflow.
   Insert edits affect 9.1% of records, but many are not safe without checklist confirmation.

9. Separate relic, patch, jersey, and material handling.
   Relic and patch edits are lower frequency but high-value and often checklist/visual dependent.

10. Reduce wording-only cleanup.
   Wording-only edits are 10.8% of records. This is lower priority than structural accuracy but may be the safest prompt-evaluation lane.

## Install Guidance

Do not install changes from this analysis.

This analysis supports:

- future evaluation design
- future fixture selection
- future registry candidate discovery
- future resolver candidate discovery
- future prompt-review questions

It does not support:

- immediate registry updates
- immediate resolver updates
- immediate prompt mutation
- immediate runtime behavior changes

## Non-Goals

This attribution analysis did not:

- modify runtime code
- modify registry data
- modify resolver logic
- modify prompts
- install upgrades
- create fixtures
- download images
- commit exported raw data
