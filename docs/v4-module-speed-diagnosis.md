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
-> consume only OCR evidence already settled (0 ms post-provider wait)
-> release provider capacity after all provider calls for this card finish
-> resolver + renderer
-> one writer-visible title

background:
late catalog/vector/OCR completion, persistence, learning sidecars
the next card may use the released provider slot while the prior card finishes
local resolution, rendering, and persistence
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

Image detail and text verbosity are separate controls. OpenAI image input uses
`low`, `auto`, or `high`; there is no `middle` image tier. Text serialization
uses `low`, `medium`, or `high`. Production keeps `high` image detail while a
seeded, same-image blind ablation compares `high` against `auto` and the known
lower-bound `low`. The experiment records field presence, slab-grade
preservation, input/output tokens, provider latency, weak-label recovery and
regression. A faster image tier is eligible only when critical-field quality
does not regress.

Routine eBay smoke uses a seeded random blind card group. Historical novelty is
not required unless the explicit `fresh_generalization` mode is selected.
Paired A/B and defect regression still reuse the same sealed images by design.

## 2026-07-14 OCR First-Wave Fairness

GPT capacity remains globally bounded at 2. PaddleOCR has an independent pool:
10 global slots, one concurrent slot per card, and a three-job per-card batch.
This lets ten cards begin one hard-text read each before any card consumes a
second OCR slot. Within a card, serial, slab grade, and printed card code run
sequentially in the same background dispatch. Unused anchor/detail lane slots
may be borrowed, but their combined concurrency cannot exceed the shared OCR
capacity.

The OCR execution ledger records claimed-card count, maximum claimed jobs per
card, first-wave distinct-card count, lane allocation, capacity waits, partial
slab-label fallback use, and target recovery. A partial slab label is never
rendered as a grade: the worker may re-read the missing company or score from a
narrow component crop, but the atomic `company + grade` publication rule stays
unchanged.

## 2026-07-13 Provider-Stage Capacity Handoff

The queue now separates the scarce provider stage from the rest of the card
pipeline. A card releases its database-backed provider lease only after every
provider call for that card has finished. Local evidence fusion, deterministic
rendering, persistence, and learning sidecars may overlap the next card's
provider stage. The global and per-key provider capacity remain 2.

Safety properties:

- the release RPC is idempotent;
- focused verifier calls finish before release, so real provider concurrency
  cannot exceed the lease count;
- release or refill failure falls back to the worker-tail release and periodic
  global drain;
- OCR uses its own durable pre-ingestion queue and adds 0 ms post-provider wait;
- writer output remains atomic and appears only after L2 is complete.

Paired blind run `29222152996` used six identical cards in both arms, the same
GPT-5-mini model, prompt, deployment, image detail, priority tier, catalog,
vector, OCR, and concurrency 2.

| Mode | Cards | Run wall | Cards/min | Writer p50 / p95 | Queue p50 / p95 | Tokens | Weak recovery / regression |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| writer-ready release | 6/6 | 94.173s | 3.82 | 63.841s / 86.121s | 16.667s / 63.399s | 45,904 | baseline |
| provider-stage handoff | 6/6 | 57.739s | 6.23 | 16.696s / 43.867s | 5.786s / 32.004s | 45,872 | 1 / 0 |

The candidate released and refilled 6/6 slots, had zero transport or field
errors, and preserved the same token budget. Production confirmation run
`29222510146` completed 3/3 in 29.420s with provider-stage release/refill 3/3,
zero missing refills, writer p50/p95 15.786s/22.045s, and queue p95 6.895s.
`V4_PROVIDER_DONE_CAPACITY_HANDOFF_ENABLED=true` is therefore the current
production default; setting it to `false` rolls back to writer-ready release.
