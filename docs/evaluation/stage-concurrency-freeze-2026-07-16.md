# Production Stage Concurrency Freeze - 2026-07-16

## Decision

The production concurrency contract is frozen at the following values. Runtime
environment variables may lower a value as a circuit breaker, but cannot raise
it without reopening the corresponding capacity sweep.

| Stage | Frozen concurrency | Scope | Decision basis |
| --- | ---: | --- | --- |
| Upload validation | 4 | browser tab | fused into the measured image preprocessing pool |
| Image preprocessing | 4 | browser tab | historical browser sweep |
| Storage upload | 3 | browser tab | historical storage sweep |
| Background preparation | 4 | browser tab | bounded preparation pool |
| Signed URL preparation | 4 | per card | bounded inside the same measured preparation pool; normally two source images |
| Queue submission | 2 | browser tab | higher values increased production tail failures |
| GPT-5-mini | 2 | global | single-key paired provider sweep |
| PaddleOCR | 8 | global | 8 was the highest zero-timeout point; 10 timed out |
| OCR work per card | 1 | per card | first-wave fairness across later cards |
| OCR jobs per batch | 3 | per card | anchor-first bounded batch |
| Catalog cards | 1 | global | lowest p95 arm that exceeded 12 tasks/minute |
| Catalog queries | 4 | per card | best stable query-lane throughput and p95 knee |
| Vector query embedding | 3 | global | cold-cache 8/8 success; concurrency 4 failed 7/12 |
| Offline vector indexing | 2 | batch local | resumable production seed run |

## Production Measurements

Catalog used the same sealed 10-card reviewed set, two repetitions, no GPT
calls, and identical prompt-visible candidate fingerprints across every arm.

| Catalog stage | C | Success | Throughput | p95 |
| --- | ---: | ---: | ---: | ---: |
| Internal query lanes | 1 | 20/20 | 24.8/min | 8,673 ms |
| Internal query lanes | 2 | 20/20 | 29.6/min | 8,160 ms |
| Internal query lanes | **4** | **20/20** | **32.4/min** | **8,052 ms** |
| Internal query lanes | 6 | 20/20 | 29.4/min | 8,282 ms |
| Global card lanes | **1** | **20/20** | **31.7/min** | **8,177 ms** |
| Global card lanes | 2 | 20/20 | 33.8/min | 8,809 ms |
| Global card lanes | 4 | 20/20 | 35.0/min | 13,201 ms |
| Global card lanes | 6 | 20/20 | 32.9/min | 16,825 ms |
| Global card lanes | 8 | 20/20 | 31.1/min | 18,151 ms |

The small throughput gain above one global catalog lane did not justify a
61%-122% p95 increase. Four local queries inside one card keeps the database
busy without letting multiple cards multiply the same query fan-out.

Vector was measured separately because the first ascending sweep warmed the
worker cache. A reverse-order sweep exposed concurrency 4 as unstable. Two new,
non-overlapping, zero-cache batches then compared the remaining knees.

| Vector condition | C | Success | Cache hit | Throughput | Batch p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Reverse-order cold start | 4 | 5/12 | 9.1% | 5.2/min | 124,974 ms |
| Independent cold batch | **3** | **8/8** | **0%** | **25.0/min** | **19,200 ms** |
| Independent cold batch | 2 | 8/8 | 0% | 21.3/min | 22,507 ms |

Concurrency 3 is the highest verified zero-error cold-cache arm. Concurrency 4
is rejected rather than hidden behind retries or warm-cache averages.

## Guardrails

- Non-provider stages must exceed 12 tasks/minute, twice the six-card/minute
  launch target.
- Accuracy-affecting stages also require decision consistency; catalog produced
  identical prompt-visible candidate decisions for every arm.
- Missing telemetry remains `null`; it is never converted to a fake zero.
- Capacity is stage-specific. OCR never borrows GPT slots, and catalog/vector
  cannot silently exceed their own global limits across users or Vercel replicas.
- Reopen a value only when its model, worker shape, RPC/index, storage protocol,
  provider capacity, or queue architecture materially changes.

## Evidence Files

- `data/eval/capacity/2026-07-16/catalog-production-sweep.json`
- `data/eval/capacity/2026-07-16/vector-warm-order-sweep.json`
- `data/eval/capacity/2026-07-16/vector-counterbalanced-sweep.json`
- `data/eval/capacity/2026-07-16/vector-cold-c3.json`
- `data/eval/capacity/2026-07-16/vector-cold-c2.json`

The machine-readable production owner is
`lib/listing/v4/orchestration/concurrency-contract.mjs`.
