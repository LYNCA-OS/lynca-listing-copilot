# Serial Evidence vs Numerical Rarity Boundary v1

Status: Superseded by Linear COS-21 boundary clarification.

This file is kept to preserve the old implementation decision trail. It should
not be read as a proposal to add `print_run_*`, `serial_number`, or
`serial_denominator` as canonical editable CSM fields.

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

How should implementation fields such as `print_run_number`, `numbered_to`, `serial_number`, and `serial_denominator` support the existing CSM field `Numerical Rarity` without becoming new canonical CSM fields?

## Decision

Adopt a boundary clarification, not a field expansion.

CSM uses:

- `Numerical Rarity` for production quantity / limited-numbering semantics.
- `Card Number` for checklist, set, design, or card-type identifiers.

Implementation may store evidence as:

- `print_run_number` for a directly observed full current-card value, e.g. `31/50`
- `print_run_numerator` for current-copy numerator evidence, e.g. `31`
- `print_run_denominator` for denominator evidence, e.g. `50`
- `numbered_to` for catalog-supported production quantity, e.g. `50`
- `serial_number` and `serial_denominator` as legacy aliases for compatibility

Rules:

- Current image / OCR / slab / operator / writer confirmation may provide full `print_run_number`.
- Catalog / reference / external candidate may only support `numbered_to` / `print_run_denominator`.
- Reference candidates must never supply `print_run_numerator`.
- If full current-card evidence exists, title may render `31/50`.
- If only denominator exists, title renders `#/50`.
- If `1/1`, title renders `1/1`.
- Writer-facing UI should call this `Numbered / Print Run / 数字限编`, not Serial.
- Card number fields remain `collector_number` / `checklist_code` / `card_number` / `tcg_card_number`.
- None of the implementation/evidence names above are canonical editable CSM fields.

## Affected Resources

- CSM Field Dictionary
- CSM Title Grammar
- Writer Module Labels
- OCR Field Contract
- Catalog Candidate Contract
- Evaluation Metrics
- Candidate Reranker Dataset Schema
- Field-level GT Schema
