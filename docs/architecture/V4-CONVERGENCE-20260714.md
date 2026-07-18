# V4 Convergence Architecture

Status: native-core convergence complete. Strategy calibration remains active.
This document defines the production ownership model and the boundary between
the frozen execution chain and independently calibrated decision policy.

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

V4 owns the recognition core at
`lib/listing/v4/pipeline/native-recognition-core.mjs` and invokes
`runNativeV4Recognition` directly. The retired endpoint at
`api/listing-copilot-title.js` is a `410` compatibility guard only: it neither
imports nor exports recognition code. This reverses the former V4-to-V2
dependency and leaves one implementation of provider observation, retrieval,
candidate application, identity resolution, and deterministic presentation.

`v4_pipeline_contract` is emitted with every V4 result. It identifies each
stage as:

- `NATIVE_V4`
- `NATIVE_V4_EXACT_ANCHOR`
- `EXTRACTED_SHARED_MODULE`
- `NOT_RUN`

Native migration is complete when `bridged_stage_count` is zero and
`legacy_core_dependency=false`. The contract
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

## Completed Native Migration

1. V4 imports its native recognition core directly.
2. Observation, retrieval, candidate decision, field resolution, renderer, and
   persistence have one declared owner in `v4_pipeline_contract`.
3. `legacy_v2_result`, `adaptV2ResultToV4`, and transitional bridge execution
   modes have been removed from the runtime contract.
4. Tests import the native core rather than using the retired HTTP endpoint as
   an algorithm module.
5. The compatibility endpoint remains only as an authenticated `410` guard and
   can be removed after external legacy callers have aged out.

The next phase is not another pipeline rewrite. It is theoretical-to-empirical
policy calibration through full-information replay, fixed 10-card validation,
and random 100-card validation while the execution chain remains stable.

Every migration slice must remove an old owner, preserve the golden prompt and
renderer contracts, pass offline suites, and pass the fixed release gate before
deployment.
