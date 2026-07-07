# V4 Module Speed Diagnosis

Source report:
`data/eval/workflow-sidecar-smoke/v4-module-speed-smoke-5-2026-07-07T06-13-09-173Z.json`

## Summary

The previous V4 smoke did not prove progressive generation. All five eBay blind
cards returned `L1_WRITER_SAFE_DRAFT`, but the L1 return time was effectively
the full provider result time.

Observed:

| Card | Route | Stage | Total ms | Provider ms | L1 ms | Blocking modules |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | ASSISTED_FULL | L1_WRITER_SAFE_DRAFT | 20679 | 15576 | 15799 | signed URL, full-card GPT, resolver, renderer |
| 2 | ASSISTED_FULL | L1_WRITER_SAFE_DRAFT | 19754 | 14557 | 14768 | signed URL, full-card GPT, resolver, renderer |
| 3 | ASSISTED_FULL | L1_WRITER_SAFE_DRAFT | 21945 | 17672 | 17762 | signed URL, full-card GPT, resolver, renderer |
| 4 | ASSISTED_FULL | L1_WRITER_SAFE_DRAFT | 35399 | 31224 | 31326 | signed URL, full-card GPT, resolver, renderer |
| 5 | ASSISTED_FULL | L1_WRITER_SAFE_DRAFT | 36486 | 32099 | 32214 | signed URL, full-card GPT, resolver, renderer |

## Why 5/5 Routed To ASSISTED_FULL

The prior route planner treated enabled catalog/vector assist as a reason to
choose `ASSISTED_FULL`, even when no approved catalog identity was available.
For marketplace blind/eBay image-only cards this is too heavy: weak or absent
candidates should not make the first response wait for the full assisted path.

## Why L1 p50 Was Still 21.9s

`L1_WRITER_SAFE_DRAFT` was assigned after the V2 listing handler completed.
That handler still performed a full-card GPT observation, resolver, renderer,
and any enabled assist orchestration before V4 adaptation. In other words:

```text
full result completed -> V4 wrapper labeled it L1 -> response returned
```

The measured `time_to_writer_safe_draft_ms` was therefore provider-bound:

```text
time_to_writer_safe_draft_ms ~= provider_total_ms
```

## What L1 Was Blocking On

Previous L1 blocking modules:

- signed read URL preparation
- full-card GPT observation
- resolver safety check
- deterministic renderer

The critical blocker was the full-card GPT observation. Vector, external
retrieval, exact parallel research, and sidecars were marked background in the
response, but V4 still called the full V2 path before returning.

## Required Architecture Change

L1 must become a separate early-return path:

```text
image access
-> FAST_SCOUT_OBSERVATION
-> minimal safety resolver
-> deterministic renderer
-> return L1_WRITER_SAFE_DRAFT

background:
full assisted observation / catalog / vector / retrieval / sidecars
-> update session with L2_ASSISTED_DRAFT
```

For eBay blind or no approved catalog support, the route should normally be
`COLD_START_SAFE_DRAFT`, not `ASSISTED_FULL`.
