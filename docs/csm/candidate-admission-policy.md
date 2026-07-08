# Candidate Admission Policy

Status: canonical V4 implementation policy
Source of record: Linear COS-11, COS-20
Machine SEM version: `linear-cos-10-23-v25`

## Principle

Catalog, vector, official checklist, marketplace, and external-directory rows are candidate evidence. They are not canonical card truth.

The production question is not just whether a candidate entered the prompt. V4 must record how far the candidate was allowed to participate:

```text
LEVEL_0_SHADOW
LEVEL_1_PROMPT_ASSIST
LEVEL_2_EVIDENCE_SUPPORT
LEVEL_3_FIELD_APPLICATION
```

## Required Trace

Every catalog/vector/external candidate trace must expose:

```text
candidate_id
source_type
source_trust
participation_level
anchor_agreement
direct_conflicts
field_permissions
applied_fields
blocked_fields
reason_per_field
```

Reports must answer:

```text
Did Catalog participate?
Did Vector participate?
At what participation level?
Which fields were applied?
Which fields were blocked?
Why was the candidate shadow-only, prompt-only, support-only, or applied?
Did it change resolved fields or rendered title?
```

## Field Permissions

Each candidate field receives one of:

```text
can_apply
support_only
suggest_only
forbidden
```

`can_apply` is still not a license to overwrite current-image truth. It means the candidate field is eligible for Identity Resolution to consider after source, anchor, and conflict checks.

## Allowed Support

Catalog or reference candidates may support:

```text
year
manufacturer
product
set
subject
card_name
card_number / checklist identifier
Numerical Rarity denominator / production quantity support
release_variant candidate
print_finish candidate
```

## Forbidden Overrides

No candidate may override:

```text
visible current-card evidence
OCR evidence
grading label evidence
current-copy identifiers
current physical condition
grade
certificate number
serial / print-run numerator
```

Vector-only candidates remain `LEVEL_0_SHADOW` or support/reranker evidence by default unless linked to an approved or reviewed identity candidate and admitted by anchor agreement.

Marketplace rows are never semantic truth. They may be used for candidate generation or noisy commercial feedback only.

## V4 Flow

```text
candidate retrieved
-> source trust checked
-> anchor agreement checked
-> direct conflicts checked
-> field permissions assigned
-> support / suggest / apply / forbid decision
-> Identity Resolution verifies
-> Renderer consumes resolved fields only
```

Fast path is allowed only after current-image anchors agree and material conflicts are absent. Blind catalog trust is not allowed.
