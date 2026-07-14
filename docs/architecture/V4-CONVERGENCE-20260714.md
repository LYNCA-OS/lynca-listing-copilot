# V4 Convergence Architecture

Status: active migration. This document defines the target ownership model and
the measurable boundary between native V4 stages and the remaining transitional
recognition core.

## Decision

Do not replace Node, Vercel, Supabase, or the queue framework. The dominant
problem is duplicate decision ownership, not the runtime. A framework rewrite
would move the same ambiguity into new files while adding operational risk.

Converge on one typed pipeline instead:

```text
Input Contract
  -> Pre-ingestion Evidence
  -> Typed Anchor Route
  -> Observation || Retrieval
  -> Candidate Decision
  -> Field Resolution
  -> Deterministic Renderer
  -> Persistence
```

Observation and retrieval may run concurrently after routing. Candidate
selection waits for the evidence it needs; persistence never changes the title.

## One Owner Per Decision

| Decision | Owner |
|---|---|
| Input shape and sealed-label exclusion | V4 Input Contract |
| Evidence bundle and OCR patches | Pre-ingestion Evidence |
| Anchor type and route | Typed Anchor Route Planner |
| Provider observations | Provider Observation |
| Catalog/vector candidate retrieval | Retrieval Orchestrator |
| Candidate selection and safe field application | Candidate Control Plane |
| Final field values and conflicts | Identity Resolution |
| Field ordering, composition, and 80-character policy | Deterministic Renderer |
| Durable records and learning artifacts | V4 Persistence |

Downstream stages may consume a decision but may not reimplement it. In
particular, route planning cannot infer an exact anchor from serial or print-run
regexes, and renderer code cannot apply candidate fields.

## Current Boundary

V4 no longer calls the V2 HTTP handler or simulates an internal HTTP request.
It invokes an explicit `runListingRecognitionCore` bridge. This removes auth,
rate-limit, body parsing, and response emulation from the inner pipeline, but it
does not make the remaining core native V4.

`v4_pipeline_contract` is emitted with every V4 result. It identifies each
stage as:

- `NATIVE_V4`
- `NATIVE_V4_EXACT_ANCHOR`
- `EXTRACTED_SHARED_MODULE`
- `TRANSITIONAL_CORE_BRIDGE`
- `NOT_RUN`

Migration is complete only when `bridged_stage_count` is zero. The contract
fails closed on untyped exact routes, unversioned candidate heuristics, candidate
selection/application identity mismatches, and candidate fields applied outside
the atomic decision stage.

## Candidate Decision Contract

The Candidate Control Plane atomically records:

```json
{
  "selected_candidate": {},
  "resolved_before": {},
  "field_application": {
    "applied_fields": [],
    "blocked_fields": [],
    "reason_per_field": {}
  },
  "resolved_after": {},
  "title_before": "",
  "title_after": ""
}
```

Physical-instance fields such as serial numerator, grade, certificate number,
and condition cannot be copied from a catalog or vector reference.

## Learning Boundary

The production candidate heuristic is frozen and versioned. LightGBM remains a
shadow challenger: it records the candidate it would choose, whether that differs
from the heuristic, and its score, but cannot affect production fields or title.
Promotion requires a fixed reviewed holdout showing positive net benefit without
increased critical regressions.

## Release Gate

Every release must use frozen manifests for:

1. `CORE_HOLDOUT`
2. `COLD_START_HOLDOUT`
3. `PRODUCTION_REPLAY`

All are excluded from training, reference indexing, and catalog promotion. A
cold-start identity is also excluded from catalog candidates. Only these five
metrics decide release direction:

1. Writer first-pass accept rate
2. Critical identity error rate
3. Core-field exact accuracy
4. Active recognition p95
5. Cost per accepted title

Seller-title recall, node counts, queue time, and candidate funnels remain
diagnostic metrics. They cannot establish accuracy by themselves.

## Remaining Migration

1. Extract observation and retrieval from `runListingRecognitionCore`.
2. Move identity resolution behind one typed stage interface.
3. Remove `legacy_v2_result` after all callers use the V4 contract.
4. Make the old HTTP endpoint a compatibility adapter over native V4.
5. Delete the compatibility endpoint after frontend and queue callers migrate.

Every migration slice must remove an old owner, preserve the golden prompt and
renderer contracts, pass offline suites, and pass the fixed release gate before
deployment.
