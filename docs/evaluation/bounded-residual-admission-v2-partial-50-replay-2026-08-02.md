# Bounded residual admission v2 — partial-50 zero-call replay

**Verdict: STOP.** The mechanism changed 2/50 cards with 1 win, 1 loss, and 48 ties. Its marginal macro-F1 was -0.000764 (0.815560 -> 0.814797).

The measured mean is negative and the arm has one regression, so it cannot be banked or promoted. This checkpoint also contains only 2 supported, parser-approved marker candidates across 2 cards, making the observed support ceiling lower than the required 8 wins. This is a **measured STOP with a severe coverage limit**; it does not establish that every narrower printed-marker rule is harmful.

## Boundary

- Zero provider calls; no model, catalog, vector, OCR, world-knowledge, persistence, or production path was invoked.
- Comparison: current frozen 11-mechanism combined bundle vs the same output plus bounded printed-marker admission.
- Source: 102 durable rows, 50 identity-matched pairs; 2 singleton rows were excluded.
- Closed admission vocabulary: RC/Rookie Card/Rated Rookie -> CSM RC; SP/SSP/1st Bowman/1st Edition -> descriptive_rarity.
- Auto/Patch/Relic/Jersey and all serial evidence remain candidate-only.
- This is reused learning evidence from a partial disjoint-105 checkpoint, not independent confirmation and not production authority.

## Score and safety

| Metric | Result |
|---|---:|
| Current combined macro F1 | 0.815560 |
| Bounded-marker macro F1 | 0.814797 |
| Marginal macro F1 | -0.000764 |
| Wins / losses / ties | 1 / 1 / 48 |
| Reference-loss cards | 1 |
| Numeric-mutation cards | 0 |
| Subject-mutation cards | 0 |
| Unrelated-field-drift cards | 0 |
| Titles over 80 | 0 |

Numeric mutation excludes the sanctioned ordinal token in an exact printed marker such as `1st Bowman`; year, card number, serial, grade, lot quantity, and all other title numbers must remain unchanged.

## Gate

| Gate | Result |
|---|---|
| marginal_macro_f1_at_least_0003 | FAIL |
| at_least_8_wins_zero_losses | FAIL |
| zero_reference_loss | FAIL |
| zero_numeric_mutation | PASS |
| zero_subject_mutation | PASS |
| zero_unrelated_field_drift | PASS |
| zero_over_80 | PASS |
| all_cards_pass_internal_safety_guards | PASS |

Stop reasons: `marginal_macro_f1_below_0.003`, `fewer_than_8_wins_or_nonzero_losses`, `checkpoint_parser_approved_marker_support_ceiling_below_8_cards`, `nonzero_reference_loss`.

## Coverage

| Funnel | Count |
|---|---:|
| Complete pairs | 50 |
| Cards with any residual candidate | 29 |
| All residual candidates | 58 |
| Parser replay candidates | 39 |
| Marker candidates | 10 |
| Supported parser-approved marker candidates | 2 |
| Cards with supported parser-approved marker | 2 |
| Admission ceiling in this checkpoint | 2 |

Residual targets: card_name 15, card_number 3, finish 3, identity 22, marker 10, subject 5.

| Marker text | Count |
|---|---:|
| 1st Bowman | 2 |
| Authentic piece of a jersey used by Dmitri Young | 1 |
| AUTO 9 | 1 |
| Autograph Issue | 1 |
| CONGRATULATIONS! | 1 |
| GEM MT 10; AUTO 10 | 1 |
| Topps Certified Autograph Issue | 2 |
| TOPPS CERTIFIED AUTOGRAPH ISSUE | 1 |

Decision dispositions: admitted 2, candidate_only 56.

## Field-level impact

| Field | Cards | Wins | Losses | Ties | Mean delta F1 |
|---|---:|---:|---:|---:|---:|
| descriptive_rarity | 2 | 1 | 1 | 0 | -0.019088 |

Only `attributes`, `components`, and `descriptive_rarity` are writable by the isolated mechanism. No unrelated field moved.

## Changed cards

### reviewed_blind_2d76df9a350dae4a44cb — LOSS -0.066667

- Reference: 2026 Bowman Chrome Sapphire Edition Parks Harper 1st Bowman Orange Sapphire 18/25
- Before: 2025 Topps Bowman Chrome Parks Harber Orange Prismatic 18/25 1st Edition
- After: 2025 Topps Bowman Chrome Parks Harber Orange Prismatic 18/25 1st Bowman
- Fields: descriptive_rarity
- Marker decisions: 1st Bowman -> 1st Bowman (printed_marker_specializes_generic_first_edition)
- Drift: reference losses edition; numeric no; subject no; unrelated none; over80 no.

### reviewed_blind_ced894c69f355380019a — WIN 0.028490

- Reference: 2024 Bowman Draft Nick Kurtz Chrome Auto Blue Refractor 1st 049/150 PSA 10
- Before: 2024 Topps Bowman Draft Nick Kurtz CHR Prospect Auto 049/150 1st Edition PSA 10
- After: 2024 Topps Bowman Draft Nick Kurtz CHR Prospect Auto 049/150 1st Bowman PSA 10
- Fields: descriptive_rarity
- Marker decisions: 1st Bowman -> 1st Bowman (printed_marker_specializes_generic_first_edition)
- Drift: reference losses none; numeric no; subject no; unrelated none; over80 no.

## Interpretation

Both observed changes are the narrow specialization `1st Edition -> 1st Bowman` backed by exact front text. Because Composer already carried “Bowman” in Product, duplicate suppression rendered the new marker as “1st”. One card gained by removing the unsupported extra token “Edition”; the other lost because that same token happened to match the missing product phrase “Sapphire Edition” in the reviewed title. The label-free internal guards therefore passed, while the external reference-loss gate correctly failed. With one win, one loss, a negative macro delta, and only two eligible paired cards, this rule is not a positive asset. Keep it evaluation-only; do not add it to the 10-mechanism bank. A future experiment must split empty-field admission from `1st Edition -> 1st Bowman` replacement and must first improve same-call RC/SP/SSP marker capture coverage.

The JSON companion contains all 50 card classifications and every marker decision, including all ties and candidate-only rows.
