# Phase 16 - Identity Resolution State And Conflict Graph

Status: core identity consistency layer implemented.

## Purpose

This layer solves card identity consistency. It does not improve OCR, visual recognition, retrieval, or title rendering directly.

The intended flow is:

`Image -> Evidence -> Identity State -> Constraint Solve -> Identity -> Title`

The previous `Image -> LLM -> Title` path is still supported by providers, but final card identity must be explainable through structured evidence and resolver decisions.

## Public Contract

`resolveIdentity()` now returns:

- `identity`
- `resolved_identity`
- `identity_state`
- `fields`
- `field_states`
- `field_candidates`
- `field_conflicts`
- `field_uncertainty`
- `uncertainty_map`
- `conflict_graph`
- `status`
- `ambiguity_status`
- `conflict_map`
- `resolution_trace`
- `confidence_report`

`ambiguity_status` remains backward-compatible:

- `CONFIRMED`
- `RESOLVED`
- `AMBIGUOUS`

`status` is the new operational route:

- `CONFIRMED`
- `RESOLVED`
- `ABSTAIN`

`ABSTAIN` means the card should enter manual review or targeted rescan. It is a designed path for the hard minority of cases, not a runtime failure.

## Identity State

`identity_state` is the durable state object:

```json
{
  "state_version": "identity-state-v1",
  "fields": {},
  "field_states": {},
  "field_candidates": {},
  "field_conflicts": {},
  "field_uncertainty": {},
  "conflict_graph": {
    "nodes": [],
    "edges": []
  },
  "uncertainty_map": {},
  "resolution_trace": [],
  "status": "CONFIRMED|RESOLVED|ABSTAIN"
}
```

The key identity fields are:

- `year`
- `product`
- `players`
- `card_type`
- `insert`
- `parallel`
- `serial_number`
- `collector_number`
- `checklist_code`
- `grade_company`
- `card_grade`
- `auto_grade`
- `grade_type`

## Field State

Each field state contains:

- `candidates`
- `conflicts`
- `conflict_items`
- `entropy`
- `conflict_intensity`
- `evidence_dispersion`
- `uncertainty_score`
- `field_uncertainty`
- `resolved_value`
- `resolution_confidence`
- `resolution_reason`
- `ambiguity`
- `decision_route`
- `supporting_sources`
- `conflicting_sources`
- `source_summary`

`resolution_confidence` is produced from weighted evidence and constraints. It is not an LLM self-rating and cannot be used as a standalone fact.

## Conflict Graph

The graph includes:

Node types:

- `OCR_RESULT`
- `SLAB_INFO`
- `REGISTRY_MATCH`
- `RETRIEVAL_RESULT`
- `MARKETPLACE_RESULT`
- `VISION_INFERENCE`
- `FIELD_CANDIDATE`
- `IDENTITY_FIELD`

Edge types:

- `support`
- `contradict`
- `override`
- `derived_from`

The graph makes conflicts explicit instead of overwriting them. A slab override still records the OCR contradiction and the override edge.

## Abstention Rules

The solver returns `ABSTAIN` when:

- a critical field cannot be resolved
- a high-severity unresolved conflict exists
- high conflict intensity combines with high entropy
- no high-confidence anchor exists from slab, registry, or multi-view printed text agreement

The solver may return `RESOLVED` when conflicts exist but a rule-based override explains the selected value.

The solver returns `CONFIRMED` only when critical fields are high-confidence and conflict-free.

## Source Policy

Marketplace evidence is low-weight supporting context only. It cannot override slab, printed card text, registry, checklist, or direct OCR evidence.

LLMs can be used as:

- semantic understanding
- evidence extraction
- evidence organization

LLMs cannot be used as:

- final truth judge
- hidden identity resolver
- source of generated missing fields

## Tests

`scripts/identity-resolution.test.mjs` covers:

- same-card OCR conflict detection
- conflict graph contradiction edges
- slab override OCR with explanation and override edge
- registry override OCR
- multi-view OCR fusion
- ambiguous critical fields routed to `ABSTAIN`
- invalid serial rejection
- `1/1` canonicalization
- checklist/schema mismatch conflict
- marketplace cannot override OCR/slab-style grounded evidence
- field trace coverage
- field supporting/conflicting source explainability
