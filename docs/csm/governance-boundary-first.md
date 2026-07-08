# CSM Boundary-First Governance

Status: canonical governance rule
Source of record: Linear COS-21, COS-23
Machine SEM version: `linear-cos-10-23-v25`

## Rule

CSM V2.5 is boundary-first, not field-expansion-first.

The current risk is no longer primarily missing fields. The bigger risk is promoting engineering terms, OCR artifacts, renderer choices, or queue implementation details into semantic definitions too quickly.

## Frozen Editable Fields

The current canonical editable CSM field set is:

```text
Year
IP / Sport
Language
Manufacturer
Product
Set
Subject
Card Name
Card Number
Descriptive Rarity
Numerical Rarity
Release Variant
Print Finish
Special Stamp
Grading Info
Description
Search Optimization
```

## Not Automatically CSM Fields

These may exist in code, traces, prompts, OCR contracts, or renderer inputs, but they are not automatically CSM fields:

```text
serial_number
serial_denominator
print_run_*
numbered_to
fast_scout
candidate_control_plane
participation_level
l1_shadow
provider_slot
queue_wait
time_to_l2_ready
```

## Classification First

Every new term must first be labeled as one of:

```text
Implementation detail
Recognition schema
Evidence artifact
Renderer behavior
Workflow / queue behavior
CSM boundary clarification
CSM definition proposal
Founder decision
```

Only boundary clarifications, definition proposals, or founder decisions should enter the CSM project.

## Definition Template

When a term is a real CSM candidate, use:

```text
Definition
Includes
Excludes
Boundary
Examples
Counter Examples
Common Mistakes
Outlier Evidence
```

## Promotion Standard

New fields require repeated real collectible outlier evidence. Implementation convenience, prompt wording, seller-title phrasing, or renderer display formats are not enough.

Most current failures should be treated as:

```text
boundary problems
fusion problems
absence problems
multi-match problems
catalog coverage problems
renderer compression problems
```

They are not automatically ontology gaps.
