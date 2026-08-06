# Hosted Luna concurrency capacity — 2026-08-01

## Decision

The hosted path can admit far more than 100 simultaneous lightweight requests,
but production card capacity must be governed by token throughput, not by that
admission ceiling.

- Verified lightweight text burst: `5,600 / 5,600` succeeded across fourteen
  parallel Vercel Preview shards, with no 429, 5xx, or network error.
- Verified real image-input burst: `100 / 100` succeeded in one Preview
  function at concurrency 100.
- Initial production card-pool target: approximately `80` global in-flight
  Luna calls, screened at `60 / 80 / 100 / 120` before promotion.
- Thousands of uploaded cards are backlog. They must not become thousands of
  simultaneous provider calls.

This is an isolated Preview capacity experiment. It is not a production SLO,
an accuracy claim, or evidence that the current product API is ready for these
levels. The product API still has legacy client-side concurrency and rate-limit
coupling that must be removed separately.

## Boundary and method

All hosted controls used `gpt-5.6-luna`, reasoning `none`, and the OpenAI
Responses endpoint from Vercel region `syd1`. The Preview deployment remained
protected and Production was not promoted. Cloud Run, OCR, vector retrieval,
and the old recognition worker were not called.

The text control returns a strict one-field JSON object and costs about 46 input
plus 15 output tokens per request. It measures Vercel-to-provider admission and
tail behavior; it does not reproduce image fetching, the canonical prompt,
CSM persistence, Supabase contention, or browser scheduling.

For totals above 400, independent 400-concurrency function invocations were
started together. This explicitly tests horizontal fan-out rather than a
single process opening every connection.

## Stored results

| Requested concurrency | Shape | Success | Failure | p50 | p95 | p99 | Max | Interpretation |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 2 | 1 x c2, 100 tasks | 100 | 0 | 1.089s | 2.281s | — | 3.606s | local cap 2 is not a provider knee |
| 10 | 1 x c10, 100 tasks | 100 | 0 | 1.052s | 2.003s | — | 3.457s | healthy |
| 50 | 1 x c50, 100 tasks | 100 | 0 | 1.119s | 1.594s | — | 4.933s | healthy |
| 100 | 1 x c100, 100 tasks | 100 | 0 | 1.366s | 1.900s | — | 3.733s | no knee |
| 200 | 1 x c200, 200 tasks | 200 | 0 | 1.655s | 2.465s | — | 4.233s | no failure |
| 400 | 1 x c400, 400 tasks | 400 | 0 | 2.031s | 3.378s | 4.499s | 27.731s | first isolated extreme tail |
| 800 | 2 x c400 | 799 | 1 x 503 | 2.011s | 3.629s | 4.766s | transient failure, not a hard wall |
| 1,600 | 4 x c400 | 1,600 | 0 | 2.107s | 3.252s | 4.386s | all admitted |
| 3,200 | 8 x c400 | 3,200 | 0 | 1.831s | 2.885s | 4.230s | all admitted |
| 4,800 | 12 x c400 | 4,800 | 0 | 2.201s | 4.204s | 5.905s | all admitted; tails increase |
| 5,600 | 14 x c400 | 5,600 | 0 | 1.947s | 3.080s | 4.321s | admission lower bound exceeds 5,600 |

The sole 503 at 800 is not a capacity boundary: 15,200 later requests at
1,600 through 5,600 completed without another failure. It still justifies a
bounded autonomous retry after operation-key lookup, because an HTTP or
network ambiguity must not cause a duplicate paid call.

The account headers reported 5,000 RPM and 4,000,000 TPM. The successful 5,600
burst does not contradict 5,000 RPM: a rate quota is not a literal in-flight
socket limit, and simultaneous response headers are not a serialized global
counter. Sustained throughput must remain below the quota even when a short
burst is admitted.

## True-card mathematical limit

The stored 50-card canonical-high arm used, per card on average:

- 5,154.88 input tokens;
- 107.42 output tokens;
- 5,262.30 total tokens;
- 6.19986 seconds observed mean latency.

Using total tokens conservatively:

`lambda_max = 4,000,000 / 5,262.30 = 760.12 cards/minute`

The request quota would allow 5,000 cards/minute, so TPM is the binding
provider resource. Little's law then gives the useful in-flight population:

`L = (760.12 / 60) * 6.19986 = 78.54 cards`

This makes roughly 80 global in-flight calls the theoretical starting point;
100 is reasonable screening headroom, not a proven production setting. Four
thousand real calls would demand about 21.05 million tokens, 5.26 times the
one-minute token budget. Repeating a few images 4,000 times would therefore be
an expensive quota test and could be biased by image-URL caching.

## Multi-tenant pool

The long-term positive design is one work-conserving, token-weighted pool:

1. all tenant uploads enter durable per-tenant backlogs;
2. a global token/in-flight gate starts only the approximately 80 permitted
   Luna calls;
3. deficit or weighted fair scheduling prevents starvation;
4. an idle tenant's share is immediately borrowed by tenants with backlog;
5. retries keep the same operation key and consume a bounded low-priority
   retry budget;
6. 429 feedback decreases the active target multiplicatively, while clean
   windows raise it slowly.

At the theoretical maximum, a 4,000-card backlog needs at least 5.26 minutes to
drain. Horizontal Vercel fan-out can remove a local process bottleneck, but it
cannot remove the account token budget.

## Promotion gate

Before wiring the pool into the UI, use a small real-card cohort at global
targets 60, 80, 100, and 120. Reuse cards only for capacity calibration, issue
fresh signed URLs to reduce cache bias, and do not treat repeated images as an
accuracy sample. Record full canonical prompt tokens, p50/p95/p99 latency,
429/5xx, retry rate, Supabase signing/readiness/persistence latency, and tenant
fairness. Promote the smallest target that reaches the TPM throughput plateau
without an unacceptable tail or duplicate paid operation.
