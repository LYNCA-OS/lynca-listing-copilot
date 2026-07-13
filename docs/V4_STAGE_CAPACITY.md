# V4 Stage Capacity Contract

The production pipeline uses independent resource pools. `concurrency=2` is the
measured GPT-5-mini provider limit, not a global limit for every module.

| Stage | Production candidate | Scope | Overload behavior |
| --- | ---: | --- | --- |
| GPT-5-mini | 2 | global provider leases | durable queue |
| PaddleOCR | 8 | global stage leases | requeue unfinished crop jobs |
| Catalog card lookups | 4 cards, 4 queries/card | global stage leases + local query pool | bounded wait, then shadow/defer |
| Query vector embedding | 4 | global stage leases | bounded wait, then skip vector for this pass |
| Offline vector indexing | 2 | batch-local | resume from persisted index state |

The OCR value is supported by a Cloud Run capacity sweep: concurrency 8 was the
highest zero-failure throughput point; concurrency 10 produced timeouts. Catalog
and vector values are candidates until their own stage sweeps pass the production
guardrail.

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
