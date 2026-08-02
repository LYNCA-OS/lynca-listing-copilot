# Current combined candidate precision-loss audit — fresh150

## Decision

The contrary claim is that all 285 candidate tokens missing from writer review titles are factual hallucinations. The stored evidence rejects that shortcut. Review titles are target marketplace outputs, not exhaustive card transcriptions.

The ledger therefore separates factual adjudication from marketplace consumption. Only same-role contradictions count as obvious factual errors; COS suppression and Composer equivalence remain separate even when the underlying fact may be true. Provider calls: 0. Runtime changes: 0.

## Primary disposition

| disposition | occurrences | cards |
|---|---:|---:|
| unresolved_reference_absence | 142 | 82 |
| possibly_useful_writer_omitted | 86 | 57 |
| obvious_factual_error | 33 | 26 |
| composer_redundancy | 12 | 12 |
| reference_tokenization_or_spelling | 12 | 10 |
| grammar_should_suppress | 0 | 0 |

Baseline combined candidate macro F1 is 0.785051. The impossible oracle that deletes every reference-absent token reaches 0.856724 (285 token occurrences on 117 cards). This is a label oracle, not a runtime target.

## Field distribution

| field | occurrences | cards |
|---|---:|---:|
| print_finish | 86 | 55 |
| card_name | 37 | 26 |
| manufacturer | 26 | 25 |
| serial | 21 | 21 |
| product | 20 | 15 |
| subjects | 19 | 8 |
| components | 18 | 18 |
| set | 17 | 12 |
| year | 15 | 14 |
| grade | 11 | 6 |
| descriptive_rarity | 5 | 4 |
| card_number | 3 | 3 |
| lot_count | 3 | 2 |
| release_variant | 3 | 3 |
| language | 1 | 1 |

## Source distribution

| source | occurrences | cards |
|---|---:|---:|
| canonical_model | 279 | 117 |
| replay_mechanism | 4 | 3 |
| composer_literal | 1 | 1 |
| composer_normalization | 1 | 1 |

279/285 occurrences came from the canonical model. The retained replay mechanisms contribute 4; they are not the main precision-loss source.

## Semantic distribution

| semantic category | occurrences | cards |
|---|---:|---:|
| parallel_finish_or_color | 86 | 55 |
| card_name_or_design | 37 | 26 |
| product_set_or_ip | 37 | 27 |
| manufacturer_or_brand | 26 | 25 |
| serial_or_numbered_print | 21 | 21 |
| subject_or_name | 19 | 8 |
| attribute_or_component | 18 | 18 |
| year_or_season | 15 | 14 |
| grading_info | 11 | 6 |
| rarity_or_marker | 5 | 4 |
| card_number | 3 | 3 |
| lot_notation | 3 | 2 |
| release_variant | 3 | 3 |
| language | 1 | 1 |

## Diagnostic buckets

| diagnostic | occurrences | cards |
|---|---:|---:|
| same_role_visible_support | 85 | 56 |
| finish_competes_with_specific_reference_value | 55 | 38 |
| unverified_core_csm_field | 50 | 39 |
| finish_unverified_no_reference_counterpart | 19 | 14 |
| different_reference_serial | 18 | 18 |
| card_name_unverified | 17 | 10 |
| different_reference_year_or_season | 9 | 8 |
| known_title_synonym | 8 | 8 |
| candidate_split_reference_joined | 5 | 3 |
| false_lot_grammar | 5 | 1 |
| singular_plural_equivalent | 4 | 4 |
| reference_spelling_variant | 3 | 3 |
| reference_split_candidate_joined | 3 | 3 |
| exact_official_support | 1 | 1 |
| lot_quantity_conflict | 1 | 1 |
| reference_missing_word_boundary | 1 | 1 |
| serial_unverified_without_reference_counterpart | 1 | 1 |

## Largest precision head

- 63 finish tokens on 39 cards compete with a specific writer-title finish or rarity value. Their label-removal oracle delta is 0.015002.
- Only 7 of those occurrences have exact same-role visible support, and 0 have exact official support. Competition alone does not establish falsehood because multiple finish properties can coexist.

## World model and Release graph

- Typed world-model corrections: 1 token occurrence / 1 card. Removal-only oracle delta: 0.000202; replacing it with the reference-supported ranked alternative gives 0.000606.
- Product-year changed 15 candidate ranks in the earlier screen but corrects 0 current combined-title precision errors. It cannot modify CSM without a phrase-role resolver.
- Release graph exactly supports 5 candidate values on 5 cards, all already present in the combined title; current precision corrections: 0.
- COS-9 manufacturer/product suppression leaves 0 current violations. The grammar is already doing its job in this cohort.
- Official and world edges are positive support only. Asset absence remains UNKNOWN and cannot hard-reject visible text.

## Evidence boundary

- Exactly 150 paired cards; 117 contain reference-absent tokens.
- Candidate titles are reproduced from the stored canonical/free/exhaustive rows and must byte-match the retained combined-candidate artifact.
- Each ledger row keeps asset, token, bracket, field, field value, source mechanism, semantic class, visible-evidence pointers, same-role alternatives, world rank support, official support, truth assessment, and marketplace disposition.
- A missing review-title word never becomes a factual-error label by itself.
- Constraint absence and official-directory absence remain UNKNOWN.
- World and Release assets can rank existing candidates only; neither generates a fact nor overrides visible text.

Machine-readable per-card and per-token ledger: `docs/evaluation/combined-precision-loss-ledger-150-2026-08-02.json`.

## Single-reference observability

- Exact-match F1 has a mathematical ceiling of 1.0 if the system imitates this writer. It does **not** identify factual accuracy from one selective marketplace title.
- 86 occurrences on 57 cards have positive visible or official support but are omitted by the reference. Suppressing them by reading the label would add 0.019401 to this metric while potentially deleting valid evidence.
- 24 occurrences on 20 cards are synonym, plurality, token-boundary, or spelling-normalization mismatches; their label-removal oracle is 0.005683.
- Therefore 0.90 is not mathematically blocked, but title F1 alone cannot certify factual accuracy. The minimum calibration is a second independent, field-level adjudication of the 285 disputed occurrences, not another free-form title: `VISIBLE_TRUE / FALSE / OPTIONAL_TITLE / REQUIRED_TITLE / UNKNOWN`, with adjudication only where writers disagree.
