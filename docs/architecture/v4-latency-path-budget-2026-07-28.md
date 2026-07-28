# V4 latency path budget: first-time cards, exact anchor, and replay

Date: 2026-07-28
Status: architecture budget only; no runtime feature is enabled by this document.

## Decision

The higher-confidence conclusion is the opposite of a universal two-to-three
second target: the current full-Provider route cannot meet it. Provider
observation alone has exceeded three seconds at p50 in every relevant cohort.
Two to three seconds is a property of a different route, not a tuning target
for the same route.

The three route budgets are therefore separate:

| Route | Provider calls | Budget p50 | Budget p95 | Evidence status |
| --- | ---: | ---: | ---: | --- |
| Current compatibility fallback, full Provider | 1 | 11.407 s | 20.046 s | measured lower-bound component; not the target main route |
| Targeted model assist for explicit UNKNOWN fields | at most 1 bounded call | unproven | unproven | auxiliary route; no complete-title output |
| First-time image, exact anchor already ready | 0 | 1.300 s | 3.000 s | shadow target only; not a production measurement |
| Verified same-image terminal replay | 0 | 1.550 s | 3.000 s | target only; requires a paired cold/replay benchmark |

These values are budget envelopes: adding p50 or p95 stage budgets does not
mathematically produce a measured end-to-end percentile. Release evidence must
measure the entire route. The sums below are used to expose ownership and slack,
not to substitute for that measurement.

Target ownership is: current-image evidence -> deterministic constraints and
reviewed or official knowledge -> a targeted model proposal for explicit
UNKNOWN fields only -> Identity Resolver -> 80-character Renderer.

The model does not own identity or the title. A full-card Provider response is
the current compatibility fallback while the replacement is proved; it is not
the desired destination for every first-time card.

## Clocks and evidence classes

Upload and route execution are different diagnostic clocks, but they must be
recombined for the writer-facing measure:

```text
T_upload:
local file selected -> immutable image generation verified

T_route_recognition:
required image/evidence readiness gate -> L2_READY visible

T_post_click_recognition
= max(T_upload_remaining_after_click,
      T_required_preingestion_remaining_after_click)
  + T_route_recognition

T_writer_visible_from_initial_upload
= T_upload_elapsed_before_click + T_post_click_recognition
```

If upload and required preingestion are complete before the click, the `max()`
term is zero. If either is incomplete, its remaining time is visible to the
writer and must not be hidden by reporting only the route clock. Optional OCR
or enrichment is not a required readiness gate and must not delay a route that
can safely proceed without it.

Local preview should be immediate and does not prove that image bytes are
durable. Paid recognition starts only after the writer's generate intent and a
verified canonical generation exist. The three route totals below start at the
readiness gate; every route table also carries an explicit upload/readiness row
so the writer-facing composition remains visible.

Current latency evidence is deliberately separated from targets:

- The offline structural audit's 60 familiar observations recorded Provider
  p50/p95 of `20.921 / 36.471 s`. They are 20 identities replayed three times,
  so they prove mechanics and latency, not 60 independent accuracy labels.
- The 17 unseen observations in the same report recorded Provider p50/p95 of
  `5.922 / 11.434 s`. Even the faster p50 is above three seconds before
  Resolver, Renderer, persistence, or network time.
- Sealed cold fixed-20 run `30106164647` recorded one Provider call per card,
  Provider p50/p95 `9.107 / 15.546 s`, total Provider execution `199.4 s`,
  writer-ready p50/p95 `120.902 / 299.457 s`, throughput `3.236 cards/min`, and
  three retrying jobs.
- The later sealed cold fixed-20 run `30110868181` removed those retries and
  improved writer-ready p50/p95 to `86.366 / 158.756 s` and throughput to
  `5.457 cards/min`. It did not prove either fast route.
- The capacity comparison in
  [`docs/v4-module-speed-diagnosis.md`](../v4-module-speed-diagnosis.md) is the
  reason Provider concurrency remains fixed at `2`; increasing it to `3`
  worsened Provider tail latency and completed throughput in the controlled
  comparison.

No exact-anchor or exact-replay latency in this document is reported as an
observed production percentile.

## Upload physical budget

The byte-transfer lower bound is independent of Queue or model design:

```text
T_upload >= 8 * total_file_size_MB / uplink_Mbps
           + signing RTT + PUT RTT + verification RTT
```

At a 20 Mbps uplink, one 6 MB image requires at least `2.4 s` for bytes alone;
two 6 MB sides require at least `4.8 s`. The `2.4 s` number excludes signing,
TLS setup, request round trips, verification, retry, and backoff, so it is a
physical lower bound rather than a p50 or p95 promise. Upload concurrency can
overlap round trips, but it cannot beat the shared-link bit budget. For 100
two-sided cards at 6 MB per side, the same uplink must carry 1,200 MB, whose
byte-only lower bound is `480 s`.

The product response is progressive: preview locally, upload with bounded
parallelism and retry, verify each card generation independently, then admit
that card when durable generate intent exists. The first verified card need not
wait for the remaining 99 cards, but the system must not call an incomplete
upload a completed recognition input.

## Critical-path notation

The budgets use these symbols:

```text
A = auth, intent admission, canonical generation validation
P = immutable evidence-snapshot preparation
R = writer-final / approved-memory / AI-terminal replay lookup
E = ready exact-anchor branch
Q = bounded Provider-capacity acquisition after preparation
V = full Provider visual observation
K = Catalog/Vector/Selection/Application/Resolver/Renderer
C = idempotent commit, status publication, and network reserve
B = additional Queue backlog beyond the bounded acquisition budget
```

`R` and `E` may execute as a fan-out after the immutable snapshot exists, so
their critical-path cost is `max(R, E)`. Snapshot preparation is not inside that
`max()`; it is a required predecessor. Authority can still be deterministic
when lookups run in parallel: writer final wins over approved memory, which wins
over AI terminal replay.

## Current compatibility path: first-time image, full Provider observation

The deployed executor currently takes this route after replay and deterministic
fast lanes miss. The target architecture does not make it mandatory: a bounded
model assist may propose only missing fields, and an unresolved card may return
PENDING / ABSTAIN instead of fabricating a complete title.

| Stage | Must run | Current evidence | Budget p50 | Budget p95 |
| --- | --- | --- | ---: | ---: |
| Upload and required-preingestion remainder after click | only when not already ready | physical/network clock; added to writer-facing total | separate | separate |
| Auth, persist intent, validate canonical generation (`A`) | yes | not isolated | 0.250 s | 0.500 s |
| Prepare immutable evidence snapshot (`P`) | yes | Queue and preparation remain partly confounded | 0.600 s | 1.000 s |
| Exact replay lookup (`R`) | yes; expected miss | cold fixed-20 bypassed cache | 0.050 s | 0.150 s |
| Ready exact-anchor shadow check (`E`) | yes; miss or ambiguity continues | shadow only; production fast final unproven | 0.100 s | 0.250 s |
| Bounded Provider-capacity acquisition (`Q`) | yes | historical Queue tail exceeded this target | 0.200 s | 0.500 s |
| Provider visual observation (`V`) | yes | fixed-20 observed `9.107 / 15.546 s` | 9.107 s | 15.546 s |
| Knowledge, selection, resolution, rendering (`K`) | yes | Resolver/Renderer are millisecond-scale; combined stage not isolated | 0.750 s | 1.500 s |
| Idempotent commit and writer-visible status (`C`) | yes | persistence/network not cleanly isolated in fixed-20 | 0.400 s | 0.750 s |
| **Critical-path envelope, excluding extra backlog (`B`)** |  | target, not production proof | **11.407 s** | **20.046 s** |

The explicit equations are:

```text
T_full = A + P + max(R, E) + Q + V + K + C + B

p50 envelope, B=0
= 0.250 + 0.600 + max(0.050, 0.100) + 0.200
  + 9.107 + 0.750 + 0.400
= 11.407 s

p95 envelope, B=0
= 0.500 + 1.000 + max(0.150, 0.250) + 0.500
  + 15.546 + 1.500 + 0.750
= 20.046 s
```

Any real backlog is additive. A timeout or retry is a separately reported
long-tail class, not hidden slack. The Provider component alone falsifies a
universal two-to-three second target.

The writer-facing composition for this path is:

```text
T_writer_full
= max(upload_remaining_after_click, required_preingestion_remaining_after_click)
  + 11.407 s p50 route envelope

T_writer_full_p95_envelope
= max(upload_remaining_after_click, required_preingestion_remaining_after_click)
  + 20.046 s p95 route envelope
```

Those equations do not assign a percentile to upload; the upload term must be
measured in the real writer Journey. For illustration only, if one 6 MB image
starts at the click on a 20 Mbps link, even the byte-only lower bound makes the
p50 route sum at least `2.4 + 11.407 = 13.807 s`, before any RTT.

## Target path: bounded model assist

This path is intentionally narrower than the current full Provider call:

- call only when one or more named fields remain UNKNOWN;
- send only the primary image and relevant crops needed for those fields;
- permit ordinary world knowledge only in the bounded knowledge lane;
- return field proposals with basis and confidence, never a complete title;
- allow at most one model call;
- let the existing Resolver accept, reject, or abstain.

The non-model stages already consume most of a universal three-second p95
budget:

    T_targeted_assist
    = A + P + max(R, deterministic_route_check)
      + M_targeted + validation_resolution_render + C

    p50 envelope = 1.17 s + M_targeted
    p95 envelope = 2.55 s + M_targeted

Therefore a three-second p95 would leave only 0.45 seconds for the networked
model call. Existing measurements do not support that. The honest product
behavior is:

    deterministic answer ready by deadline -> L2_READY
    otherwise                              -> PENDING / ABSTAIN
    targeted model assist completes        -> Resolver -> L2_READY

No latency number is assigned to M_targeted until the shadow route reports its
field-target distribution and a paired benchmark measures the bounded call.
Full Provider latency cannot be used as proof for this new path.

## Path 2: first-time image, exact anchor already ready

This is not cache replay. The image has never produced an L2 result, but direct
current-image evidence is already available before the click and selects
exactly one authoritative identity with zero direct conflict. If OCR or another
external visual read must begin after the click, its latency must be added and
this path cannot promise three seconds.

| Stage | Must run | Budget p50 | Budget p95 | Gate |
| --- | --- | ---: | ---: | --- |
| Upload and required direct-anchor preingestion remainder | eligibility requires this to be zero | separate | separate | otherwise this is not the exact-anchor route |
| Auth, intent, canonical generation (`A`) | yes | 0.250 s | 0.500 s | verified full-content generation |
| Prepare ready evidence snapshot (`P`) | yes | 0.350 s | 0.700 s | no post-click OCR wait |
| Exact replay miss (`R`) | yes; parallel branch | 0.050 s | 0.150 s | complete pipeline fingerprint |
| Read direct anchor evidence | yes; anchor branch | 0.030 s | 0.100 s | direct provenance from this image |
| Unique authoritative local-index lookup | yes; after anchor read | 0.100 s | 0.350 s | exactly one Official/Reviewed identity |
| Conflict validation, Candidate permission, Resolver, Renderer | yes | 0.120 s | 0.250 s | no current-instance field copied; title <=80 characters |
| Idempotent commit, status, network reserve (`C`) | yes | 0.450 s | 1.100 s | Provider calls = 0 |
| **Critical-path envelope** |  | **1.300 s** | **3.000 s** | shadow target only |

The replay lookup and anchor lookup start from the same prepared snapshot. The
anchor branch is serial internally, so its branch cost is direct read plus index
lookup:

```text
T_exact_anchor
= A + P + max(R, direct_anchor_read + index_lookup)
  + validation_resolution_render + C

p50
= 0.250 + 0.350 + max(0.050, 0.030 + 0.100)
  + 0.120 + 0.450
= 1.300 s

p95
= 0.500 + 0.700 + max(0.150, 0.100 + 0.350)
  + 0.250 + 1.100
= 3.000 s
```

This path remains Shadow. It cannot skip Provider until independent identity
labels prove zero wrong eligibility, current-instance fields remain image-only,
and Resolver/Renderer output is identical to the validated deterministic path.

Its three-second p95 target applies only when the writer-facing readiness term
is zero. If direct-anchor preingestion is still running after the click, the
card either waits visibly for that remainder or takes the full-Provider route;
the system cannot report the exact-anchor budget while hiding that wait.

## Path 3: verified same-image terminal replay

This route requires the same immutable image generation to have already
produced a terminal L2 under the same complete pipeline fingerprint.

| Stage | Must run | Budget p50 | Budget p95 | Gate |
| --- | --- | ---: | ---: | --- |
| Upload/hash-verification remainder after click | only when generation is not already verified | separate | separate | added to writer-facing total |
| Auth and canonical generation verification | yes | 0.250 s | 0.500 s | verified full-content hash |
| Active Catalog revision bind | yes, once per batch admission | 0.400 s | 0.800 s | promoted database revision, immutable for batch jobs |
| Writer-final, approved-memory, AI-cache lookups | yes; parallel reads with fixed authority | 0.050 s | 0.150 s | exact key and pipeline fingerprint |
| Resolver snapshot hydration | yes | 0.050 s | 0.200 s | byte-equivalent authoritative state |
| Idempotent commit, status, network reserve | yes | 0.800 s | 1.350 s | Provider calls = 0 |
| **Critical-path envelope** |  | **1.550 s** | **3.000 s** | target only |

The equation is:

```text
T_exact_replay
= generation_verify + catalog_revision_bind
  + max(writer_final_lookup, approved_memory_lookup, AI_cache_lookup)
  + resolver_hydration + commit_status

p50 = 0.250 + 0.400 + 0.050 + 0.050 + 0.800 = 1.550 s
p95 = 0.500 + 0.800 + 0.150 + 0.200 + 1.350 = 3.000 s
```

The target becomes evidence only after a paired benchmark proves:

1. cold phase: `provider_calls=1` and the terminal snapshot is persisted;
2. replay phase: `provider_calls=0`, cache hit and version match are true;
3. image hash, cache key, pipeline fingerprint, title, SEM/Resolver state, and
   replay authority are identical across the pair.

An L2 replay is idempotent response reuse, not independent identity truth and
not automatically training-eligible.

Its writer-facing composition is:

```text
T_writer_replay
= max(upload_remaining_after_click, required_preingestion_remaining_after_click)
  + T_exact_replay
```

For an already verified generation, the first term is zero. For a writer who
must upload the same 6 MB image again over a 20 Mbps link, the byte-only lower
bound makes the p50 target at least `2.4 + 1.550 = 3.950 s`, before RTT and
verification. Cache speed does not erase the upload the writer still performs.

## Batch lower bounds

With Provider concurrency fixed at `2`:

```text
T_provider_batch >= sum(provider_execution_i) / 2
```

For cold fixed-20 run `30106164647`:

```text
T_provider_batch >= 199.4 / 2 = 99.7 s
provider-only ideal throughput <= 2 * 60 / 9.97 = 12.04 cards/min
```

That is a physical Provider-work lower bound, not a promised completion rate.
Queue gaps, retries, downstream work, and writer-status persistence make the
actual wall clock longer. At the familiar-cohort Provider p50 of `20.921 s`, a
different operating-point ceiling is:

```text
provider-only throughput <= 2 * 60 / 20.921 = 5.74 cards/min
```

The correct optimization order is to keep the two existing slots productive,
remove proven retry and idle-gap causes, and let independently proven zero-call
routes exit before Provider. Increasing Provider concurrency is not part of
this budget.

## Proof gates and non-changes

| Route | Required proof before calling the budget real |
| --- | --- |
| Full Provider | cold end-to-end route measurement with bounded Queue, no cache shortcut, one Provider call per card, stage-complete trace, and no retry |
| Targeted model assist | pre-Provider snapshot only, explicit field targets, at most one call, no complete title, paired familiar/unseen accuracy, and measured M_targeted p50/p95 |
| Exact anchor | shadow evaluation on independent labels, zero wrong eligibility, zero direct conflicts, deterministic Resolver/Renderer parity, and Provider still called during proof |
| Exact replay | paired cold/replay measurement with Provider `1 -> 0` and byte-equivalent terminal state |
| Upload | real browser Journey with real cookie, real files, durable verification, retry recovery, and per-card progressive admission |

This document changes no application code, Queue behavior, lease boundary,
Provider setting, or production title. Provider concurrency remains `2`.
