# Hosted canonical capacity sequential stop — 2026-08-01

## Decision

Stop paid escalation after the completed single `c150` and concurrent
`2 x c150` arms. Do not run `4 x c150` / aggregate 600 from this screen.

The lowest-cost **screened** global in-flight candidate is `c120`:

- it is the only high-throughput point repeated across the prior and current
  telemetry deployments (`1,410.0` and `1,332.3` tasks/minute);
- its observed p95 stayed between `3.756s` and `4.008s`, and p99 stayed between
  `4.656s` and `4.765s`;
- current-deployment `c150` fell to `527.7` tasks/minute, `60.4%` below current
  `c120`, and produced a `17.037s` maximum;
- concurrent aggregate 300 completed without error, but its common runner
  envelope was `16.211s`, or `1,110.4` tasks/minute: `16.7%` below current
  `c120`. Its merged p95/p99 were also worse at `4.281s` / `6.126s`.

This is a burst-screen recommendation, not a sustained production SLO or a
production `GO` decision.

## Paid work added in this screen

| Arm | Requests | Result | Input tokens | Cached input | Uncached input | Output tokens |
|---|---:|---:|---:|---:|---:|---:|
| single `c150` | 150 | 150 HTTP 200 | 775,440 | 670,577 | 104,863 | 16,110 |
| aggregate 300 shard A | 150 | 150 HTTP 200 | 775,440 | 671,369 | 104,071 | 16,115 |
| aggregate 300 shard B | 150 | 150 HTTP 200 | 775,440 | 670,611 | 104,829 | 16,171 |
| **Total added** | **450** | **450 HTTP 200; 0 failures; 0 network errors** | **2,326,320** | **2,012,557** | **313,763** | **48,396** |

The added runs averaged `5,169.6` input tokens, `4,472.35` cached input tokens,
`697.25` uncached input tokens, and `107.55` output tokens per request. The
observed input cache ratio was `86.51%`. These token counts are the cost proxy;
no currency estimate is asserted here.

## Sequential stop and confidence boundary

The deterministic early-stop rule is to retain the smallest repeated point on
the throughput plateau and stop increasing load when a higher point loses
throughput without improving the tail. `c150` triggered that rule, and
aggregate 300 did not overturn it when throughput was computed from the
processes' common start and final end rather than by summing shard throughput.

The 450 newly added requests had zero failures. Under an independent Bernoulli
approximation, the exact one-sided 95% upper failure-rate bound is:

`1 - 0.05^(1 / 450) = 0.6635%`.

Adding the already-stored current-deployment `c120` arm gives 600/600 successes
and a one-sided 95% upper bound of `0.4980%` for the **heterogeneous tested
mix**. That does not prove `<0.5%` at any single sustained operating point:
current-deployment `c120` alone has only 150 observations, whose corresponding
upper bound is `1.977%`. Burst-correlated requests also make the independent
Bernoulli interval optimistic.

## Cache and evidence limits

The same 150 images were repeated. Image URL, fetch, and provider-side image
cache effects can therefore make this capacity screen optimistic for a
high-cardinality production stream. Shared canonical-prompt cached input is a
realistic production benefit and should remain in capacity accounting, but it
must not be conflated with repeated-image cache benefit.

No aggregate 600 arm was started. No sustained multi-window soak was run. No
Production deployment, Cloud Run service, Supabase schema, or signed payload
was changed or exposed.

## One necessary promotion retest

Only if a formal production-capacity gate is required, run one sustained
`c120` campaign on the isolated Preview with fresh, non-repeated image sets and
at least 450 additional homogeneous requests (three sequential 150-task
windows). Together with the current 150-request `c120` arm, 600 zero-failure
observations would place the one-sided 95% Bernoulli upper bound just below
`0.5%`, while the sequential windows would test sustained quota recovery and
tail stability. Do not spend on aggregate 600 before that test.

## Stored evidence

- `artifacts/hosted-canonical-capacity-c150-single-150-2026-08-01.json`
- `artifacts/hosted-canonical-capacity-aggregate300-shard-a-2026-08-01.json`
- `artifacts/hosted-canonical-capacity-aggregate300-shard-b-2026-08-01.json`
- `artifacts/hosted-canonical-capacity-c120-warm-cache-telemetry-150-2026-08-01.json`
