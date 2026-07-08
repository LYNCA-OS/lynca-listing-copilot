# Serial Evidence vs Semantic Fields

Status: canonical boundary clarification
Source of record: Linear COS-10, COS-21
Machine SEM version: `linear-cos-10-23-v25`

## Decision

Do not add CSM fields named:

```text
Serial Number
serial_number
serial_numerator
serial_denominator
print_run_*
numbered_to
```

These names are implementation or evidence terms. They may support the existing CSM field `Numerical Rarity`.

## CSM Boundary

```text
Card Number = checklist / design / card-type identifier
Numerical Rarity = production quantity / limited-numbering semantics
```

Examples:

```text
PAU, SWS, TCAR, TAEV-EN006, OP01-120 -> Card Number
04/10, 2/3, 15/150, #/50, 1/1 -> Numerical Rarity
```

TCG set numbering such as `139/205` can be `Card Number` only when the card/listing context is a TCG checklist/set-number context. In standard cards, visible `N/D` limited numbering is `Numerical Rarity`.

## Implementation Terms

Implementation may store:

```text
print_run_number
print_run_numerator
print_run_denominator
numbered_to
serial_number
serial_denominator
one_of_one
```

These values are evidence artifacts or renderer inputs, not editable CSM categories.

## Renderer Behavior

The renderer may display:

```text
2/3
31/50
#/50
1/1
```

Display format does not create a new CSM field. The semantic category remains `Numerical Rarity`.

## Candidate Safety

Current uploaded image, slab label, OCR crop, or writer-confirmed current-copy evidence may provide full current-card limited numbering.

Catalog, vector, marketplace, or reference candidates may support only denominator / production quantity. They must never provide or overwrite current-copy numerator, grade, cert number, or condition.

## Governance Filter

Before any implementation term becomes a CSM decision, classify it:

```text
implementation detail
recognition schema
evidence artifact
renderer behavior
workflow queue behavior
CSM boundary clarification
CSM definition proposal
founder decision
```

Only repeated real collectible outliers can justify a new CSM field proposal.
