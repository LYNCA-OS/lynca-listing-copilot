# V4 Stage Capacity Contract

The production pipeline uses independent resource pools. `concurrency=2` is the
measured GPT-5-mini provider limit, not a global limit for every module.

| Stage | Capacity | Evidence state | Scope | Overload behavior |
| --- | ---: | --- | --- | --- |
| Upload validation | 4 | frozen; fused with preprocessing | browser tab | no independent queue or extra network hop |
| Browser image preprocessing | 4 | frozen | browser tab | bounded local pool |
| Storage upload | 3 | frozen | browser tab | retry failed objects only |
| Background preparation | 4 | frozen | browser tab | continue in background, one promise per card |
| Signed URL preparation | 4 | frozen; bounded inside background preparation | per card | preserve input order, fail only the affected image |
| Queue submission | 2 | frozen | browser tab | durable queue |
| GPT-5-mini | 2 | frozen | global provider leases | durable queue |
| PaddleOCR | 8 | frozen | global stage leases | requeue unfinished crop jobs |
| Catalog card lookups | 1 | frozen | global cards + local query pool | bounded wait, then shadow/defer |
| Catalog queries within one card | 4 | frozen | per card | preserve query order, merge after all bounded lanes settle |
| Query vector embedding | 3 | frozen | global cards | bounded wait, then skip vector for this pass |
| Offline vector indexing | 2 | frozen | batch-local | resume from persisted index state |

The OCR value is supported by a Cloud Run capacity sweep: concurrency 8 was the
highest zero-failure throughput point; concurrency 10 produced timeouts. The
2026-07-16 production catalog sweep selected one global card lane and four
queries within that card: one card lane already cleared the 12 tasks/minute
non-provider demand floor with the lowest p95, while extra card lanes increased
database and Vercel tail contention. The cold-cache vector sweep selected three:
it completed 8/8 at 25 tasks/minute, while four failed 7/12. The machine-readable owner is
`lib/listing/v4/orchestration/concurrency-contract.mjs`; production constants and
documentation are regression-tested against it.

OCR uses one global eight-slot lease pool. `anchor=8` and `detail=2` are lane
ceilings, not ten reserved slots; the work-conserving allocator always keeps
their combined active work at or below eight. Per-card OCR concurrency remains
one with a three-job batch so later cards receive a first hard-text read before
one card consumes the queue.

Frozen does not mean permanent under every architecture. A stage is re-opened
only when its listed dependency changes (model, worker shape, storage protocol,
queue architecture, or retrieval RPC/index). A new value must be supported by a
paired sweep; environment edits alone cannot redefine the contract.

## Scheduling rules

1. Pre-ingestion starts OCR before the provider request.
2. Catalog lookup, signed image preparation, and provider vision run in parallel
   whenever their input dependencies allow it.
3. The GPT lease is released after the initial provider stage. Evidence work for
   the current card continues while GPT starts the next queued card.
4. Every controlled stage acquires a durable Supabase lease with a job id and a
   TTL, and releases it in `finally`.
5. A stage timeout never marks the whole card as complete. Critical missing
   evidence remains reviewable; noncritical vector assistance can be skipped.
6. No stage is allowed to borrow GPT capacity or silently exceed its own global
   capacity when multiple users or Vercel replicas are active.

## Promotion guardrail

A higher stage capacity becomes the production default only when a cloud sweep
shows all of the following on the same sealed sample and deployment:

- all jobs have unique ids and reach a terminal state;
- zero missing capacity releases and zero lost queue refills;
- zero provider or worker timeouts;
- throughput improves without a worse writer-ready p95;
- reviewed accuracy remains at least 0.87;
- no increase in unflagged critical errors.

Seller-title overlap is diagnostic only and cannot satisfy the reviewed accuracy
gate.

The current launch target is six completed cards per minute. Non-provider stages
must demonstrate at least two times that demand (12 tasks/minute) before they
can be frozen. Among stable arms that clear this floor, the contract chooses the
lowest-p95 arm; it does not maximize concurrency for its own sake.
