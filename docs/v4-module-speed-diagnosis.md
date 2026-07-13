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

## 2026-07-13 Production Decision

The product no longer exposes L1. Writers receive one writer-ready title only;
L1 remains an internal observation/cache primitive when it produces measurable
L2 benefit.

Current critical-path policy:

```text
upload/pre-ingestion
-> provider capacity queue (single GPT-5-mini key, capacity 2)
-> GPT-5-mini L2 observation
-> catalog/vector post-observation deadline (250 ms)
-> OCR post-provider deadline (750 ms)
-> resolver + renderer
-> one writer-visible title

background:
late catalog/vector/OCR completion, persistence, learning sidecars
```

Measured capacity experiment:

- concurrency 2: provider p50 13.1s, provider p95 17.0s, about 4.0 completed cards/minute;
- concurrency 3: provider p50 23.9s, provider p95 40.8s, 3.83 completed cards/minute;
- concurrency 3 had no 429s, but single-key provider contention made both latency and throughput worse.

Therefore production stays at concurrency 2 until another GPT-5-mini key or
fresh provider-capacity evidence changes the constraint. Client concurrency is
not allowed to redefine server capacity.

OCR remains active and durable, but it must not hold the writer path until all
crop jobs finish. Patches already available when GPT completes are consumed;
late patches continue in the background for review, learning, and later reuse.

## 2026-07-13 Provider Transport Ablation

A paired cloud ablation used the same three blind cards, the same deployment,
the same GPT-5-mini key, and concurrency 2. The only changed variables were the
L2 prompt mode and OpenAI transport settings.

| Mode | Provider p50 | Provider p95 | Writer p50 | Writer p95 | Tokens | Weak policy avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| compact L2 + high detail + default tier | 17.071s | 19.040s | 20.626s | 28.841s | 25,578 | 0.738889 |
| ultra-fast L2 + high detail + priority tier | 9.770s | 10.074s | 12.091s | 25.213s | 24,862 | 0.827778 |

Both arms completed 3/3 without transport or field errors. The candidate arm
reduced provider p50 by 42.8%, provider p95 by 47.1%, and writer p50 by 41.4%.
It also produced three weak-label recoveries and zero regressions. This is
paired evidence for making the candidate mode the production default, subject
to a fresh production smoke after deployment.

Production configuration is centralized through:

```text
ENABLE_V4_ULTRA_FAST_L2=true
V4_ULTRA_FAST_IMAGE_DETAIL=high
V4_ULTRA_FAST_SERVICE_TIER=priority
```

Request payload options still override these defaults so controlled A/B and
rollback tests remain possible without branching the production path.
