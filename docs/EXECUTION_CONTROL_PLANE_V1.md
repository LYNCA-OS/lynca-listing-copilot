# V4 Execution Control Plane v1

## Decision

Keep the current product and data frameworks:

- Vercel remains the HTTP/control plane.
- Supabase remains the durable state, queue, catalog, and evidence plane.
- Cloud Run remains the OCR/embedding compute boundary.
- OpenAI remains the only title-recognition provider.

Do not migrate the frontend or rewrite the recognition pipeline. The measured
latency is dominated by provider work and catalog coverage, not DOM rendering
or framework startup. A framework rewrite would add risk without shortening the
model call.

The structural change is the execution contract around those components.

## Production Flow

```text
upload/storage verification
  -> preingestion bundle + cache-only scout probe (parallel)
  -> one hidden L1 + paired final L2 job per card
  -> global fair queue claims hidden L1
  -> atomic provider-capacity lease + key assignment
  -> L1 writes reusable same-image evidence, then releases only its paired L2
  -> L2 reuses the evidence for exact-anchor finalize OR focused full recognition
  -> writer-ready title persisted first
  -> non-critical evidence/catalog/learning writes in background
  -> one browser batch-status poll updates all pending cards
```

## Invariants

1. A Vercel instance is never the source of truth for concurrency.
2. Provider capacity is leased in Postgres before a job becomes `RUNNING`.
3. Capacity is `key_count * stable_concurrency_per_key`, capped by the explicit
   global limit.
4. A lease assigns the preferred OpenAI key slot. Provider rotation remains a
   bounded recovery path, while total active requests remain globally bounded.
5. Queue selection interleaves tenants/batches before taking a second job from
   the same tenant. Large batches cannot starve later batches.
6. The browser's direct scout probe is cache-only. A cache miss creates no
   uncontrolled model request; paid hidden L1 work enters the same globally
   capacity-controlled queue as L2.
7. L1 is never writer-visible. The writer receives one final L2 title.
8. Catalog/vector hard conflicts remain fail-closed.
9. Provider capacity is released after the provider path ends; stale leases
   expire with the job lease after crashes.
10. Status polling is aggregated by browser batch rather than one timer and one
    HTTP request per card.
11. A failed hidden L1 is terminal and immediately hands off to its paired L2;
    it cannot retry alongside L2 and duplicate provider work.
12. Multi-card enqueue persists session stubs and jobs in bulk. If PostgREST
    rejects a bulk write, the queue degrades to bounded row writes instead of
    losing the whole batch.
13. Every Supabase read, write, patch, and RPC has an explicit timeout. A
    degraded database returns a classified queue error and never leaves the
    browser waiting on an unbounded HTTP request.
14. Paid blind evaluation freezes every prediction and its SHA-256 before the
    sealed marketplace labels are loaded. One shared batch poller observes the
    production queue exactly as the writer UI does.

## Expected Effects

- Stability: concurrent users share one real global provider budget.
- Throughput: multiple keys add capacity linearly without allowing one key to
  exceed its tested concurrency.
- Fairness: batch-first round robin (tenant fallback) prevents one large upload from monopolizing every worker, even when several writers share one production account.
- Writer latency: a completed title is normally visible within 0.8-1.8 seconds,
  instead of waiting for the previous per-card 5.5-8 second poll interval.
- Cold-start cards: hidden L1 starts during upload/preparation, before the
  writer asks for the result, and focuses the later L2 when exact finalize is
  unavailable.
- Known or catalog-anchored cards: persistent scout evidence lets L2 finish
  through the exact-anchor path without a second model call.

## Migration Boundary

Vercel Queues/Workflow or a dedicated Cloud Run listing worker should replace
the Supabase queue only after measurements show one of these conditions:

- Postgres queue claim p95 exceeds 500 ms under normal database health.
- Queue age grows while provider capacity is available.
- The workload needs more than the current function duration or 24-hour queue
  retention.
- Queue operations, not provider calls, become a material share of total time.

Until then, changing queue products does not improve recognition latency. The
current database queue already provides durable state, `SKIP LOCKED` claims,
retries, leases, and exact status recovery with less migration risk.

## Required Metrics

- queue wait p50/p95/p99
- paired L1 dependency wait vs runnable scheduler wait
- provider-capacity utilization and lease age
- per-key active concurrency
- provider latency and rate-limit headers
- completed-to-writer-visible lag
- exact-anchor/cache-only hit rate
- tenant/batch max queue age
- retry, expired-lease reclaim, and final failure counts
