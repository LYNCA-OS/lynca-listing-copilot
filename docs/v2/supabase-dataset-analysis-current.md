# Supabase Dataset Analysis Current

Status: Current Supabase Dataset Analysis, No Runtime Changes
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Source:

- Supabase table: `listing_title_feedback`
- Local ignored export: `data/learning/supabase-feedback-export-current.json`
- Baseline: `dataset-snapshot-002.md`
- Fixture sources: `fixtures/visual-fixture-set-001.md`, `fixture-set-002-candidates.md`, `fixture-taxonomy-v1.md`

## Scope

This report analyzes the current Supabase `listing_title_feedback` dataset exported on 2026-06-22.

Exported fields:

- `id`
- `generated_title`
- `corrected_title`
- `front_image_url`
- `back_image_url`
- `operator_id`
- `created_at`

No images were downloaded. Image evidence is represented by URLs only.

No runtime title generation, registry, resolver, prompt, deployment, or upgrade changes are included.

## Method Notes

Correction patterns are based on word-level diffs between `generated_title` and `corrected_title`.

Category counts are keyword-assisted and are not mutually exclusive. A single row can count as a product/set correction, parallel correction, serial correction, and checklist-dependent correction at the same time.

Counts identify review pressure, not approved learning rules.

## Dataset Summary

| Metric | Count |
| --- | ---: |
| Total records | 351 |
| Image-backed records, front or back image present | 248 |
| Image-backed records, both front and back present | 247 |
| Text-only legacy records | 103 |
| New records since Dataset Snapshot #002 | 15 |
| New image-backed records since Dataset Snapshot #002 | 15 |
| New text-only records since Dataset Snapshot #002 | 0 |
| Rows with missing `generated_title` | 0 |
| Rows with missing `corrected_title` | 0 |
| Rows with missing `front_image_url` | 103 |
| Rows with missing `back_image_url` | 104 |
| Distinct non-empty `operator_id` values | 1 |

Current dataset date range:

```text
2026-06-21T09:30:11.126+00:00 to 2026-06-22T11:25:29.12+00:00
```

Dataset Snapshot #002 baseline:

| Baseline metric | Snapshot #002 | Current | Change |
| --- | ---: | ---: | ---: |
| Total records | 336 | 351 | +15 |
| Image-backed records | 233 | 248 | +15 |
| Text-only legacy records | 103 | 103 | 0 |

The 15 rows after Snapshot #002 are all image-backed and were created between `2026-06-22T11:19:53.392+00:00` and `2026-06-22T11:25:29.12+00:00`.

One image-backed row has a front image but no back image:

| ID | Created at | Correction |
| --- | --- | --- |
| `57fd6bea-157e-4ebe-be6a-ff7219c06d9b` | `2026-06-22T10:41:57.718+00:00` | `2023 Topps Chrome Jaxson Dart RC New York Giants` -> `2023 Topps Chrome Jaxson Dart Refractor RC` |

## Correction Pattern Summary

Most common added phrases:

| Phrase | Count |
| --- | ---: |
| `rookie` | 26 |
| `2025-26` | 21 |
| `rc` | 21 |
| `sapphire` | 17 |
| `panini` | 16 |
| `ssp` | 16 |
| `2026` | 12 |
| `cosmic` | 10 |
| `chrome` | 9 |
| `auto` | 8 |
| `rookie rc` | 8 |
| `series 2` | 8 |
| `tennis` | 8 |
| `autograph` | 7 |
| `gold refractor` | 7 |

Most common removed phrases:

| Phrase | Count |
| --- | ---: |
| `rc` | 26 |
| `2025` | 21 |
| `chrome` | 13 |
| `2026` | 9 |
| `auto` | 6 |
| `card` | 6 |
| `relic` | 6 |
| `2003` | 5 |
| `parallel` | 5 |
| `signed` | 5 |
| `2018` | 4 |
| `basketball` | 4 |
| `bowman` | 4 |
| `gem mt` | 4 |
| `patch` | 4 |

Most common replacements:

| Replacement | Count |
| --- | ---: |
| `2025` -> `2026` | 10 |
| `2026` -> `2025-26` | 9 |
| `2025` -> `2025-26` | 8 |
| `2003` -> `2003-04` | 5 |
| `rc` -> `rookie` | 5 |
| `2018` -> `2018-19` | 4 |
| `chrome` -> `sapphire` | 4 |
| `2024-25` -> `2025-26` | 3 |
| `refractor` -> `sapphire` | 3 |
| `shimmer` -> `sapphire` | 2 |

Correction category pressure:

| Category | Rows matched | Interpretation |
| --- | ---: | --- |
| Product/set corrections | 139 | Product identity, year, brand, sport, release, and set naming remain a major correction source. |
| Parallel corrections | 142 | Parallel naming is the largest visible learning pressure, including Sapphire, Wave/Raywave, Geometric, Shimmer, Cosmic, and color refractors. |
| Serial corrections | 55 | Serial numbers are often added or corrected and should remain evidence-checked against images. |
| Grade corrections | 19 | Grade changes are lower-volume but high-risk, especially where card grade and auto grade are separate. |
| Auto/relic/patch corrections | 62 | Autograph, signature, relic, material, jersey, and patch terms frequently need preservation or correction. |
| SSP/case-hit corrections | 45 | Scarcity and case-hit language is recurring and high-value, but often checklist-dependent. |
| Checklist-dependent corrections | 65 | Set/insert/scarcity corrections often require product-specific validation before fixture promotion. |

Product/set corrections:

- The strongest recurring product/year pattern is season normalization, especially `2025` or `2026` becoming `2025-26`.
- Other repeated corrections include adding `Panini`, `Chrome`, `Topps Chrome`, `UCC`, `Tennis`, `Series 2`, and sport/product qualifiers.
- These corrections should be treated as knowledge or hybrid fixture candidates when the precise product identity is not fully visible.

Parallel corrections:

- The dataset continues to show heavy pressure around `Sapphire`, `Cosmic`, `Wave`, `Raywave`, `Geometric`, `Shimmer`, and color-specific refractors.
- `chrome` -> `sapphire`, `refractor` -> `sapphire`, and `shimmer` -> `sapphire` appear as recurring replacements, but these are also false-learning risk areas.
- Parallel corrections are good visual fixture candidates only when the image shows direct pattern, slab, card-code, or product evidence.

Serial corrections:

- Serial fixes include both additions and corrections, such as `0/100` -> `033/100`, `03/150` -> `03/15`, `13/15` -> `13/75`, and `29/199 029/199` -> `29/199`.
- Serial fields should not become title rules. They should be read directly from image evidence or preserved from trusted operator correction.

Grade corrections:

- Grade-related corrections include `PSA`, `BGS`, `Gem Mint`, numeric grade changes, and auto-grade preservation.
- The dataset supports a knowledge fixture class for `Auto Grade Split`, because card grade and autograph grade can be visually present but semantically distinct.

Auto/relic/patch corrections:

- Corrections include `Signed` -> `Signature Shots`, `Patch Auto Relic` -> `Jersey Auto`, `Relic` -> `Major League Material Relic`, and generic autograph phrasing becoming set-specific autograph language.
- This category often becomes hybrid because the autograph or relic may be visible, while the exact insert name requires product knowledge.

SSP/case-hit corrections:

- `ssp` was added 16 times in the current full export.
- Case-hit and scarcity language appears across concepts such as `Home Advantage`, `Shadow Etch`, `Pixel Burst`, and similar high-value insert/scarcity terms.
- These should remain checklist-dependent until product-specific confirmation is available.

Checklist-dependent corrections:

- The dataset repeatedly asks for corrections that cannot be safely learned from text diff alone: SSP status, case-hit status, Series 2 attribution, exact relic checklist names, and some Sapphire/Shimmer distinctions.
- These are valuable review queues, not direct runtime rules.

## Visual Candidate Summary

Concepts already covered by Fixture Set #001:

| Concept | Current role |
| --- | --- |
| `Sapphire` | Covered as a human-review-pending visual fixture. Still needs guardrails because Sapphire also appears in confusion patterns. |
| `Bowman Sapphire / Padparadscha Refractor` | Covered as a high-risk visual/hybrid fixture. Exact parallel naming should remain human-reviewed. |
| `Gold Geometric` | Covered as a visual fixture for geometric pattern plus gold coloration. |
| `Blue Geometric Refractor` | Covered as a visual fixture for blue geometric/checkered refractor pattern. |
| `Purple Raywave Refractor` | Covered as a visual fixture for wavy/raywave foil behavior. |

Concepts not yet covered:

| Concept area | Evidence in current dataset | Fixture posture |
| --- | ---: | --- |
| `Red Wave Refractor` / Wave variants | 8 rows matched `Wave` language | Strong visual candidate when image evidence shows wave foil. |
| `Orange Shimmer, not Orange Sapphire` | 6 rows matched `Shimmer` language | Strong negative/confusion candidate, but exact naming may need checklist support. |
| `Cosmic` / `Cosmic Chrome` | 15 rows matched `Cosmic` language | Good future visual candidate if image pattern and product identity are clear. |
| Color refractor specificity | Frequent parallel replacements | Good visual candidate family, but avoid broad color inference. |
| Serial-number read accuracy | 55 serial correction rows | Useful evaluation class, not a fixture concept by itself. |
| `Topps Chrome UCC` and sport/product qualifiers | Product/set corrections in newest rows | Knowledge or hybrid candidates, depending on visible card text. |

Strongest Fixture Set #002 candidates:

| Candidate concept | Fixture type | Why it is strong |
| --- | --- | --- |
| `Red Wave Refractor` | Visual Fixture | Clean extension of Set #001 pattern coverage; tests Wave versus generic Refractor. |
| `Autograph / card-auto grade split` | Knowledge Fixture | Repeated high-value correction class; prevents collapsing card grade and autograph grade. |
| `Orange Shimmer, not Orange Sapphire` | Hybrid Fixture, negative/confusion | Directly guards against over-promoting Sapphire from visually similar foil. |
| `Series 2 / Major League Material Relic` | Hybrid Fixture | Relic/material evidence may be visible, while Series 2/Gold language needs checklist support. |
| `SSP case-hit / short-print language` | Knowledge or Hybrid Fixture | Recurrent high-value correction class, but unsafe without product-specific confirmation. |

Concepts that need external checklist review:

- `SSP`
- `Case Hit`
- `Home Advantage`
- `Shadow Etch`
- `Pixel Burst`
- `Series 2`
- `Major League Material Relic` exact checklist naming
- `Gold` relic or variation language when not directly visible
- `Sapphire` versus `Shimmer` when visual evidence is ambiguous
- Exact insert names such as `Signature Shots`, `Hoopla Signatures`, `Rookie Ticket`, and `All Kings`

Concepts that should not be promoted yet:

- Broad `Sapphire` upgrades from `Chrome`, `Refractor`, or `Shimmer` without explicit image or checklist support.
- Broad `SSP` or `Case Hit` rules based only on corrected-title text.
- Generic year normalization rules such as always converting `2025` to `2025-26`.
- Relic/patch/material naming rules without checklist validation.
- Serial-number transformations without image-readable serial evidence.
- Product/set replacements where the corrected title may reflect domain knowledge not visible in the images.

## Knowledge Fixture Candidate Summary

| Candidate | Evidence pressure | Recommended fixture type | Review status recommendation |
| --- | ---: | --- | --- |
| `Auto Grade Split` | 33 rows matched auto-grade/card-grade language | Knowledge Fixture | Human-review queue, with slab-label verification where images exist. |
| `SSP / SP` | 43 rows matched SSP/SP or short-print language | Knowledge Fixture | Checklist-dependent; do not approve from title text alone. |
| `Case Hit` and named case-hit inserts | 16 rows matched case-hit style language | Knowledge Fixture or Hybrid Fixture | Checklist-dependent; requires product-specific confirmation. |
| `Series 2 Relic` / material relic language | 45 rows matched relic/material/Series 2-style language | Hybrid Fixture | Needs image review plus checklist confirmation. |
| Season/year normalization | Common replacements include `2025` -> `2025-26` and `2026` -> `2025-26` | Knowledge Fixture candidate family | Needs product-release rules, not visual-only promotion. |
| Insert-name preservation | Seen in new rows such as `Signature Shots`, `Gusto`, `Next Stop Signatures`, `Rookie Ticket`, `1983 Topps` | Knowledge or Hybrid Fixture | Candidate queue only until specific product checklists are reviewed. |

## Risk / False Learning Warnings

1. `Sapphire` is both a fixture concept and a confusion risk. The dataset shows recurring pressure to add Sapphire, but Fixture Set #002 already flags Shimmer-versus-Sapphire as unsafe without careful review.
2. `SSP` and `Case Hit` are high-value terms, but they are not reliably image-only concepts. Promoting them without checklist evidence would create expensive false positives.
3. Year corrections are common, especially `2025-26`, but broad year normalization can be wrong across sports, products, and release calendars.
4. Serial corrections should be treated as OCR/image evidence tasks, not learned title-generation rules.
5. Text-only legacy records still make up 103 rows. They are useful for pattern discovery but weak for visual fixture approval.
6. Back-image coverage is nearly complete for current image-backed rows, but one front-only row exists and should be excluded from any review requiring back-side evidence.
7. Diff counts can overstate concept confidence because added terms may come from operator domain knowledge rather than visible evidence.

## Questions for Fei

1. Should Fixture Set #002 prioritize high-confidence visual expansion first (`Red Wave Refractor`, `Orange Shimmer` negative) or high-value knowledge fixtures first (`Auto Grade Split`, `SSP`, `Case Hit`)?
2. For checklist-dependent concepts, what source should be considered authoritative: manufacturer checklist, Cardboard Connection/Beckett-style checklist, grading label, or operator judgment?
3. Should text-only legacy rows remain eligible for knowledge fixture discovery, or should all approved fixtures require image-backed evidence going forward?
4. Should serial-number corrections become a separate evaluation track distinct from visual-concept fixtures?
5. Should exact insert-name corrections from the 15 newest rows be queued for a future product/set taxonomy pass?

## Recommended Next 3 Actions

1. Create a human-review queue for Fixture Set #002 using the five strongest candidates: `Red Wave Refractor`, `Auto Grade Split`, `Orange Shimmer, not Orange Sapphire`, `Series 2 / Major League Material Relic`, and `SSP case-hit / short-print language`.
2. Split the next review cycle into two lanes: visual fixtures for image-visible parallels, and knowledge/hybrid fixtures for checklist-dependent concepts.
3. Define a checklist-source policy before promoting `SSP`, `Case Hit`, `Series 2`, exact relic names, or exact insert names into approved fixtures.

## Not Changed

This analysis did not:

- modify runtime code
- modify the registry
- modify the resolver
- modify prompts
- install upgrades
- create new fixtures
- download images
- commit raw exported data
