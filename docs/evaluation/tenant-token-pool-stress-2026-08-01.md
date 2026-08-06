# Multi-tenant token pool offline stress — 2026-08-01

## Decision boundary

The global admitted/backlog pool is not the provider concurrency window. This
offline run admitted 4,000 logical operations per seed while the provider
window remained bounded by 440,000 estimated in-flight tokens (about 83 jobs at
the 5,262-token demand mean, but about 71 active jobs after service-time size
bias) plus the selected c120 active-attempt soft ceiling.

This is process-local scheduler evidence only. It does not establish hosted
OpenAI capacity. A production multi-instance deployment still needs one durable
global admission authority or lease; otherwise every instance can multiply the
same window.

## Reproduction

```sh
node scripts/run-tenant-token-pool-stress.mjs \
  --seeds 50 \
  --out artifacts/tenant-token-pool-stress-2026-08-01.json
```

The artifact is deterministic. Verified SHA-256:
`a32cecaf663c4dcb0b43fb90f50d70a4f917640376f88282caa487a7b501bda9`.

## Workload

- 50 deterministic seeds; 40 tenants and 4,000 operations per seed (200,000
  admitted operations total).
- Tenant mix per seed: one 1,600-job whale, seven 200-job medium tenants, and
  thirty-two 31–32-job small tenants.
- Token weights use a seeded long-tail distribution around the measured card
  request scale: aggregate mean 5,257.55, maximum per-seed p95 10,596, hard
  maximum 20,000.
- Each seed injects 40 queued cancellations, 80 first-attempt 503s, and four
  first-attempt 429s. Retries are automatic, finite, lower-priority, and their
  admission is capped to 20% of the current token window (with a one-job
  oversize escape hatch). An AIMD decrease does not preempt work already active.

## Results

| Gate / diagnostic | Result |
| --- | ---: |
| Completed operations | 198,000 |
| Explicitly cancelled operations | 2,000 |
| Provider attempts, including bounded retries | 202,200 |
| Duplicate successful operations | 0 |
| Maximum active jobs | 104 / 120 |
| Maximum active tokens | 440,000 / 440,000 |
| Provider job/token bound violations | 0 / 0 |
| Work-conserving violations outside explicit reservations (197,923 checks) | 0 |
| Anti-starvation reservation checks | 19,222 |
| Retry-admission-share violations | 0 |
| Seeds with tenant starvation | 0 |
| Clean weighted-admission max share error | 0.4616 percentage points |
| Fault-path weighted-admission max share error | 0.7897 percentage points |
| Fault-path error within the 20% retry-share bound | yes |
| Maximum weighted occupancy error | 1.2721 percentage points |
| Virtual drain time p50 / p95 / max | 404,934 / 414,545 / 419,416 ms |

The scheduler uses tenant-head packetized dominant-resource WFQ finish tags:
each attempt is charged `max(1 / count_limit, estimated_tokens / token_limit)`
before tenant weight. An idle boundary resets the virtual epoch, and a head
that cannot fit a fragmented window may be bypassed only eight times before it
reserves the drain. This removes the observed
10-token-head-versus-200-small-packets starvation counterexample. Reservations
deliberately trade a bounded amount of instantaneous packing for a hard
anti-starvation property; work conservation remains exact outside those 19,222
explicitly observed reservation checks.

The clean fairness gate is a same-jobs shadow without injected provider faults.
The fault path is now better rather than hidden: its maximum prefix share error
fell from the earlier 9.3426pp diagnostic to 0.7897pp; weighted occupancy error
fell from 7.1352pp to 1.2721pp. When fresh backlog is empty, retries borrow the
idle token window; the 20% retry share applies only while fresh work is queued.

Compared with the original deterministic c100 run, the corrected c120 policy
changed virtual p50/p95/max by -1.28%/-1.33%/-1.10%. The count ceiling itself
did not bind (observed maximum 104): the token gate, AIMD, tenant heads, and
anti-starvation reservation determined execution. c120 therefore remains a
safe soft ceiling rather than a promised operating point; the measurable win
comes primarily from the scheduling correction, not from adding 20 slots.

The production boundary is per physical provider attempt: a durable global
queue must choose the weighted-fair claimant, then atomically enforce active
count, tokens, retry share, and AIMD with a fenced expiring lease. The lease is
settled before retry backoff. Eligible attempts enter that durable queue at
intake, and all of them may wait for a global claim; a process-local claim cap
would hide the fair head and reintroduce cross-instance bias. The isolated
dispatcher now requires this admission seam and remains the sole
retry/ambiguity owner. No such durable Luna authority is wired to the direct
API yet, so production-global c120 is not claimed and must fail closed when
that composition is attempted.

No network, paid request, UI, database, legacy V4, Cloud Run, vector, or OCR
path participated in this stress run.
