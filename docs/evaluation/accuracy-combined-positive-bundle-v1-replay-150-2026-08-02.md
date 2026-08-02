# Combined positive bundle v1 — zero-cost 150-card replay (2026-08-02)

## Decision

The tempting opposing claim is that every mechanism previously called positive can simply be added together. The unified replay rejects that shortcut: it replays the exact 150 paired IDs under one fixed order, measures every marginal step, and separately records overlap, title displacement, and isolated-vs-sequential interaction.

The combined result is **0.766927 -> 0.785051** (**+0.018124**), with **28 wins / 0 losses / 122 ties**. It changes 28 cards and has zero reference-token loss, zero unbacked new token, zero numeric mutation, zero unrelated field drift, and zero title over 80. This is an evaluation candidate, not a production promotion. Provider calls: 0.

## Positive-asset count

**12 mechanisms** meet the same-cohort replay gate: they fired, improved macro F1, had at least one win, no F1 loss, and passed the reference/backing/numeric/drift/80 safety checks. No-change, deferred, stopped, world-ranker no-title, residual-unmeasured, and diagnostic-oracle mechanisms are not counted.

Literal title-token-lossless subset (6): attested_insert, finish_family_color_only, product_known_manufacturer_extension, exact_season_suffix, phrase_aware_resolver_guard, exact_parallel_color_compaction. The larger 12-mechanism count permits typed formatting/compaction when reference tokens and numeric meaning are preserved; all raw title losses remain listed below rather than hidden.

Eligible for the independent paid fresh-150 bundle (11): attested_insert, finish_family_color_only, product_known_manufacturer_extension, serial_single_digit_v1, exact_season_suffix, front_same_value_serial, typed_exact_admission, phrase_aware_resolver_guard, typed_product_finish_compaction, exact_parallel_color_compaction, compact_lot_quantity. Same-cohort only: candidate_identity_v3 (generic_logo_does_not_prove_set_role_and_one_card_displaces_visible_finish_tokens). The exact-identity generic-logo branch inside the phrase resolver is held as candidate-only and contributes neither title changes nor the count.

## Stage ledger

| mechanism | macro F1 | step delta | W/L/T | changed | reference loss | title loss | unbacked new | numeric mutations | unrelated drift | >80 | gate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| candidate_identity_v3 | 0.766927 -> 0.770209 | +0.003282 | 5/0/145 | 5 | 0 | 1 | 0 | 0 | 0 | 0 | KEEP |
| attested_insert | 0.770209 -> 0.770555 | +0.000346 | 1/0/149 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | KEEP |
| finish_family_color_only | 0.770555 -> 0.771491 | +0.000936 | 2/0/148 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | KEEP |
| product_known_manufacturer_extension | 0.771491 -> 0.771959 | +0.000468 | 1/0/149 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | KEEP |
| serial_single_digit_v1 | 0.771959 -> 0.772986 | +0.001027 | 2/0/148 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | KEEP |
| exact_season_suffix | 0.772986 -> 0.773982 | +0.000996 | 3/0/147 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | KEEP |
| front_same_value_serial | 0.773982 -> 0.775255 | +0.001273 | 2/0/148 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | KEEP |
| typed_exact_admission | 0.775255 -> 0.777871 | +0.002616 | 5/0/145 | 5 | 0 | 2 | 0 | 0 | 0 | 0 | KEEP |
| phrase_aware_resolver_guard | 0.777871 -> 0.778185 | +0.000314 | 1/0/149 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | KEEP |
| typed_product_finish_compaction | 0.778185 -> 0.779723 | +0.001538 | 1/0/149 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | KEEP |
| exact_parallel_color_compaction | 0.779723 -> 0.780031 | +0.000308 | 1/0/149 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | KEEP |
| compact_lot_quantity | 0.780031 -> 0.785051 | +0.005020 | 6/0/144 | 6 | 0 | 6 | 0 | 0 | 0 | 0 | KEEP |

## Final safety

| metric | value |
|---|---:|
| paired cards | 150 |
| changed cards | 28 |
| reference-loss cards / tokens | 0 / 0 |
| raw title-loss cards / tokens | 14 / 30 |
| sanctioned / unsanctioned title-loss cards | 13 / 1 |
| unbacked-new-token cards | 0 |
| unbacked-numeric cards | 0 |
| numeric-mutation cards | 0 |
| unrelated-field-drift cards | 0 |
| titles over 80 | 0 |

## Every changed card

| asset | mechanisms that changed title | final delta F1 | reference tokens lost | raw title tokens lost |
|---|---|---:|---|---|
| `reviewed_blind_dfba61396ec82f2b864e` | exact_season_suffix | +0.047619 | none | none |
| `reviewed_blind_3215d29874a3dad22bbb` | typed_exact_admission | +0.066176 | none | none |
| `reviewed_blind_a38ced8b163264d9d95a` | exact_season_suffix | +0.043333 | none | none |
| `reviewed_blind_5edfef737b8f58f5253b` | finish_family_color_only | +0.109091 | none | none |
| `reviewed_blind_72e1bdac368317a7c3b1` | candidate_identity_v3 | +0.102564 | none | none |
| `reviewed_blind_bcc4e7ac4ac23e1e69d3` | compact_lot_quantity | +0.145455 | none | 4, card, lot |
| `reviewed_blind_f371844dc1d0c6e49f92` | candidate_identity_v3 | +0.102336 | none | none |
| `reviewed_blind_6d227f82fdcb2ded4b6d` | compact_lot_quantity | +0.128696 | none | 3, card, lot |
| `reviewed_blind_940144961215fef91c18` | front_same_value_serial, typed_exact_admission | +0.209091 | none | 27/150 |
| `reviewed_blind_d3bcbaa288c732ffed37` | front_same_value_serial | +0.090909 | none | 82/100 |
| `reviewed_blind_12f2d135218a7ca35d3e` | typed_exact_admission | +0.046154 | none | none |
| `reviewed_blind_646c3f4af20b9ee7fe07` | compact_lot_quantity | +0.134615 | none | 3, card, lot |
| `reviewed_blind_c279329f2f78d7f65071` | exact_season_suffix | +0.058480 | none | none |
| `reviewed_blind_4aa0c1e7f7e95ed8ae49` | typed_product_finish_compaction | +0.230769 | none | uefa, club, competitions |
| `reviewed_blind_d768c8f01fbfdd779bb0` | compact_lot_quantity | +0.048696 | none | 9, card, lot |
| `reviewed_blind_c6ecb08d49256335aa6b` | finish_family_color_only, typed_exact_admission | +0.111304 | none | autograph |
| `reviewed_blind_ee03ba06dd634655b4ba` | attested_insert | +0.051948 | none | none |
| `reviewed_blind_8922f71c190ac8dbeca8` | candidate_identity_v3 | +0.070175 | none | none |
| `reviewed_blind_7059d3b39d01402f0e61` | candidate_identity_v3 | +0.136364 | none | rainbow, cracked, ice |
| `reviewed_blind_1ab36981fdce86771040` | candidate_identity_v3 | +0.080882 | none | none |
| `reviewed_blind_8cabcafd0596fbab0bb0` | typed_exact_admission | +0.090909 | none | cowboys |
| `reviewed_blind_1b6c3c565cffb8fb3442` | compact_lot_quantity | +0.154545 | none | 4, card, lot |
| `reviewed_blind_f246b38058854d10b78a` | phrase_aware_resolver_guard | +0.047101 | none | none |
| `reviewed_blind_70559ba85193165a2f95` | exact_parallel_color_compaction | +0.046154 | none | none |
| `reviewed_blind_7815e1aeda1f8e00dd4e` | product_known_manufacturer_extension | +0.070175 | none | none |
| `reviewed_blind_77f1063c48c35c3d3583` | serial_single_digit_v1 | +0.074074 | none | 5/20 |
| `reviewed_blind_5bbc14c582d6f0b34f77` | compact_lot_quantity | +0.141026 | none | 3, card, lot |
| `reviewed_blind_1638841b99625325c7d4` | serial_single_digit_v1 | +0.080000 | none | 8/25 |

## All detected interactions

An interaction is recorded when two or more isolated mechanisms affect the same card, when sequential and isolated firing differ, or when the final per-card delta differs from the sum of isolated deltas. Deduplicated means an earlier mechanism already supplied the same result; nonlinear metric overlap means both mechanisms survived but set-F1 is not additive.

| asset | isolated changes | sequential changes | kind | final - sum(isolated) |
|---|---|---|---|---:|
| `reviewed_blind_dfba61396ec82f2b864e` | exact_season_suffix, phrase_aware_resolver_guard | exact_season_suffix | deduplicated | -0.047619 |
| `reviewed_blind_a38ced8b163264d9d95a` | exact_season_suffix, phrase_aware_resolver_guard | exact_season_suffix | deduplicated | -0.043333 |
| `reviewed_blind_940144961215fef91c18` | front_same_value_serial, typed_exact_admission, phrase_aware_resolver_guard | front_same_value_serial, typed_exact_admission | deduplicated | -0.127273 |
| `reviewed_blind_c6ecb08d49256335aa6b` | finish_family_color_only, typed_exact_admission | finish_family_color_only, typed_exact_admission | nonlinear_metric_overlap | -0.006957 |
| `reviewed_blind_ee03ba06dd634655b4ba` | attested_insert, phrase_aware_resolver_guard | attested_insert | deduplicated | -0.051948 |
| `reviewed_blind_7059d3b39d01402f0e61` | candidate_identity_v3, product_known_manufacturer_extension | candidate_identity_v3 | deduplicated | -0.136364 |

## Explicitly excluded from the count

| mechanism | reason |
|---|---|
| generic_logo_exact_identity_admission | selection_biased_role_routing_held_candidate_only |
| typed_grade_compaction | no_change_on_fresh150 |
| typed_patch_relic_compaction | defer_semantic_equivalence_unproven |
| typed_product_parent | no_change_on_fresh150 |
| manufacturer_product_set | stop_replay_loss |
| shared_observable_components | stop_mixed_lot_semantics |
| shared_grading_info | defer_no_measured_effect |
| asset_token_diagnostic_oracle | overfit_and_reference_loss |
| world_compatibility_ranker | no_title_authority |
| residual_evidence_lane | not_yet_measured |

## Evidence boundary

- Input SHA-256: `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5`.
- Exhaustive SHA-256: `96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9`.
- Cohort SHA-256: `c63287ca0d76f669385a720987b36f49a4495b40fe82b1133287fe2c4f272bf7`.
- Exactly 150 unique paired IDs; image fingerprints and labels match across all three arms.
- Rules receive no scoring labels or cohort identifiers.
- World ranker changes no title and residual evidence is not yet measured, so neither contributes to F1 or the positive count.
- Default and production paths are unchanged. A genuinely new paid 150 cohort remains the independent promotion gate.
