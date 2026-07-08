# V4 Release Gate

Status: canonical release readiness gate
Source of record: Linear COS-20, COS-22, COS-23
Machine SEM version: `linear-cos-10-23-v25`

V4 is not commercially ready because title-level proxy recall looks good. It is ready only when field-level semantic quality and production workflow stability are both acceptable.

## 1. Field-Level Semantic Quality

Evaluate CSM fields separately:

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

Implementation/evidence terms such as `serial_*`, `print_run_*`, `numbered_to`, `fast_scout`, or provider queue fields must not be scored as new CSM fields.

## 2. Candidate Control Plane Readiness

Catalog / vector / external candidates must record:

```text
participation_level
anchor_agreement
direct_conflicts
field_permissions
applied_fields
blocked_fields
reason_per_field
```

Release requires:

```text
raw vector cannot become truth
raw catalog cannot become truth
marketplace title cannot become semantic GT
reference grade/cert/current-copy values cannot be copied
conflicted candidates are blocked or shadowed
candidate application is explainable per field
```

## 3. Blind, Leak-Resistant Evaluation

Report separately:

```text
raw blind output
policy-fair score
field-level correctness
oracle / upper-bound candidate score
commercial feedback data
reviewed semantic truth when available
```

Seller or eBay titles are weak scoring references, not direct semantic truth.

## 4. Commercial Queue Readiness

Because V4 is a production queue platform, release must include:

```text
queue_wait p50 / p95
time_to_l2_ready p50 / p95
worker_processing p50 / p95
duplicate_processing_count
retry_count
failure_count
tenant_starvation_check
provider_429_rate
provider_slot_saturation
```

An accurate system that waits minutes in queue is not commercially ready.

## 5. Writer-Facing Boundary

Production writer view should show:

```text
loading / progress before L2
L2_ASSISTED_DRAFT when ready
one-line editable title
warnings only when actionably useful
```

Do not show:

```text
L0 internal scout
L1 shadow draft
empty title placeholder
half-baked field output
raw candidate diagnostics
structured field editing form
```

If L1 is enabled, it remains shadow / controlled experiment and must not feed or contaminate L2 by default.

## 6. Shadow-Only Boundaries

These remain diagnostic unless separately promoted:

```text
L1 shadow
raw vector candidates
raw catalog candidates
pre-ingestion evidence
commercial feedback semantic extraction
learning artifacts
reranker shadow score
```

## Release Decision

V4 may be promoted only when:

```text
1. CSM field-level quality is acceptable.
2. Candidate Control Plane is auditable and fail-closed.
3. Queue and provider metrics are stable for multi-tenant production.
4. Writer-facing UI exposes only the approved production surface.
```
