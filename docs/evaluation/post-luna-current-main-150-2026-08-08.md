# Post-Luna current-main 150-card zero-call replay — 2026-08-08

## Decision

The four measured removals (withheld finish, search optimization, card number, and both profile suppressions) are negative on the same stored provider responses. This does **not** prove that every constraint is beneficial. The exact current-main replay preserves the historical 109 schema-compression and 63 downstream-composition occurrence counts; current code changes which individual downstream tokens move, so historical rows must not be treated as current output.

Provider calls: **0**. Production runtime changes: **none**.

Current macro F1 is **0.781142**; the stored historical titles score 0.767764. Current recomposition is 36/4/110 versus historical.

## Earliest boundary

| boundary | occurrences | cards | reference-oracle F1 delta |
|---|---:|---:|---:|
| exhaustive_not_expressed | 254 | 118 | +0.096946 |
| canonical_schema_compression | 109 | 76 | +0.042304 |
| downstream_composition | 63 | 47 | +0.023803 |

The deltas restore reviewed-title tokens by reading the label. They are add-only, stage-scoped upper bounds, not mechanisms or promotion evidence.

## Current accuracy-loss ledger

| field | current-main admission status counts |
|---|---|
| year | unchanged=148, empty=2 |
| ip_sport | empty=147, derived=3 |
| language | empty=145, unchanged=5 |
| manufacturer | unchanged=147, empty=3 |
| product | unchanged=137, empty=13 |
| set | empty=114, unchanged=36 |
| subject | unchanged=148, normalized=2 |
| card_name | empty=81, unchanged=69 |
| card_number | unchanged=140, dropped=5, empty=5 |
| descriptive_rarity | empty=144, derived=4, unchanged=2 |
| numerical_rarity | unchanged=71, empty=77, derived=1, dropped=1 |
| release_variant | empty=144, unchanged=6 |
| print_finish | normalized=66, dropped=67, empty=17 |
| special_stamp | empty=148, derived=2 |
| grading_info | empty=105, normalized=45 |
| description | empty=150 |
| search_optimization | normalized=138, empty=12 |

| non-routine reason | occurrences |
|---|---:|
| CSM_ADMISSION_REJECTED | 67 |
| BARE_COLOUR_NOT_TAXONOMY_CONFIRMED | 43 |
| BASE_APPEARANCE_NOT_PARALLEL | 24 |
| DESCRIBES_SURFACE_NOT_PARALLEL | 19 |
| PARSER_REJECTED | 6 |
| FINISH_NOT_MARKET_RECOGNIZED_FOR_PRODUCT | 4 |
| PARSER_DEFECT_CARD_NUMBER_HOLDS_MULTIPLE_CODES | 4 |
| PARSER_DEFECT_CARD_NUMBER_IS_A_PRINT_RUN | 1 |
| PARSER_DEFECT_SERIAL_NOT_A_PRINT_RUN | 1 |

## Constraint removal

| removal | macro F1 delta | W/L/T | changed | title-loss / ref-loss / unbacked / numeric-add / numeric-loss / unbacked-numeric / >80 cards |
|---|---:|---:|---:|---:|
| all_withheld_finish | -0.006228 | 4/15/131 | 20 | 0/0/0/0/0/0/0 |
| search_optimization | -0.029473 | 20/96/34 | 119 | 28/25/0/0/1/0/0 |
| card_number | -0.039668 | 1/112/37 | 113 | 0/0/0/91/0/0/0 |
| both_profile_suppressions | -0.061252 | 16/119/15 | 137 | 28/25/0/83/1/0/0 |

## Existing Composer recovery

| lane | macro F1 delta | W/L/T | changed | title-loss / ref-loss / unbacked / numeric-add / numeric-loss / unbacked-numeric / >80 cards |
|---|---:|---:|---:|---:|
| generalizable | 0.002359 | 3/0/147 | 3 | 2/0/0/0/0/0/0 |
| diagnostic_reference_oracle | 0.009825 | 18/0/132 | 18 | 2/0/0/1/0/0/0 |

The generalizable lane is source-only evaluation code. The diagnostic lane contains asset-bound, reviewed-label attestations and is an oracle only.

Numeric additions and losses are counted separately. Numeric-looking identity words such as `49ers` and `76ers` are not numeric claims; unbacked numeric means an added claim absent from the provider's value fields. Provider metadata (`grammar`, `low_confidence`, `unreadable`, and unknown keys) is never treated as source evidence.

The JSON artifact records every changed card's asset id, reference, before/after title, win/loss/tie outcome, F1 delta, recovery reasons, and safety signals. Omitted cards are unchanged ties.

## Evidence boundary

- Canonical input SHA-256: `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5`.
- Exhaustive input SHA-256: `96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9`.
- Corpus manifest SHA-256: `d2ca5eb34f09c736fd92d04133656b0a2fdfbde6f25a63ea017051025441c155`.
- Replay source graph: 32 local modules, aggregate SHA-256 `9e4ec0d51c138de47e7ce0d05b68a07beb5a308c7ab447a418f9150da80e94f8`.
- Pairing verified reference, exact image set, model, served model, image detail/count, and requested/served effort for all 150 cards.
- The raw corpora are git-ignored internal inputs, not part of a clean checkout. Replay therefore requires the exact authorized local files above and fails closed when either is absent or hash-mismatched; this work does not copy them into Production.

## Reproduce

```bash
node scripts/analyze-post-luna-current-150.mjs
node scripts/analyze-post-luna-current-150.test.mjs
```
