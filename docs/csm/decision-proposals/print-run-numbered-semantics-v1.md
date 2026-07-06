# Print Run / Numbered Semantics v1

Observation
↓
Question
↓
Decision
↓
Affected Resources

## Observation

Current code and title modules still use `serial_number` / serial terminology for values like `31/50`, `2/3`, and `1/1`.

But in LYNCA title semantics, `31/50` is not a card serial / checklist number. It is a numbered print-run / limited-numbering value.

Actual card/catalog numbers should be represented by:

- `collector_number`
- `checklist_code`
- `card_number`
- `tcg_card_number`

This ambiguity affects:

- title rendering
- OCR field normalization
- candidate safety
- catalog field semantics
- writer-facing labels
- field-level GT
- future ML training data

## Question

Should LYNCA CSM standardize `31/50`-style values as `print_run_number` / `numbered` / 数字限编, while keeping `serial_number` only as a legacy alias?

## Decision

Adopt print-run semantics.

Use:

- `print_run_number` for full current-card numbered value, e.g. `31/50`
- `print_run_numerator` for `31`
- `print_run_denominator` for `50`
- `numbered_to` for catalog-supported denominator, e.g. `50`
- `one_of_one` for `1/1`

Keep:

- `serial_number` as legacy alias for `print_run_number`
- `serial_denominator` as legacy alias for `print_run_denominator` / `numbered_to`

Rules:

- Current image / OCR / slab / operator / writer confirmation may provide full `print_run_number`.
- Catalog / reference / external candidate may only support `numbered_to` / `print_run_denominator`.
- Reference candidates must never supply `print_run_numerator`.
- If full current-card evidence exists, title may render `31/50`.
- If only denominator exists, title renders `#/50`.
- If `1/1`, title renders `1/1`.
- Writer-facing UI should call this `Numbered / Print Run / 数字限编`, not Serial.
- Card number fields remain `collector_number` / `checklist_code` / `card_number` / `tcg_card_number`.

## Affected Resources

- CSM Field Dictionary
- CSM Title Grammar
- Writer Module Labels
- OCR Field Contract
- Catalog Candidate Contract
- Evaluation Metrics
- Candidate Reranker Dataset Schema
- Field-level GT Schema
