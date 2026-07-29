# Day-one naming: correct route, proof status, and latency budget

Date: 2026-07-29

Decision: `CHANGE_THE_MAIN_ROUTE`

Production activation from this report: `NO_GO`

## Outcome first

The task brief's universal full-Provider route is false. It cannot name every
first-day card in two to three seconds, and shortening that Provider's output
made both familiar and unseen accuracy worse. The higher-confidence route is:

```text
progressive upload / immutable image generation
                |
         decode exactly once
                |
      +---------+----------+
      |                    |
focused Google Vision   local product-mark sensors
(literal image facts)   (query support only)
      |                    |
      +---------+----------+
                |
official + reviewed retrieval, exact-anchor lookup
                |
candidate validation -> Identity Resolver -> 80-char Renderer
                |
     exact answer | partial answer + review | abstain
                |
targeted model assist only for named UNKNOWN fields
```

This is not a declaration that the destination has been reached. One important
sensor has passed a prospective single-product gate; the complete route has not
yet passed a multi-product or end-to-end accuracy/latency gate.

## Why a universal visual-only answer is impossible

Let `X` be the current photograph and `Y` the exact SEM identity. If two cards
can produce the same observable facts in `X`, while the product distinction is
present only in an external product mark or a not-yet-published checklist, then
`P(Y|X)` cannot collapse to one identity. No Prompt can recover information
that is absent from both pixels and prior knowledge.

The loss also is asymmetric:

```text
L(confident wrong proper noun) >> L(omit field / request review)
```

The Bayes-optimal action is therefore not “always answer.” It is:

```text
resolve  when one authoritative candidate has enough direct support
review   when grounded partial facts exist but identity is ambiguous
abstain  when evidence cannot separate candidates
```

PR #150 now makes that boundary writer-visible: an internal `ABSTAIN` with a
partial title is `WRITER_REVIEW`, not an acceptable terminal identity.

## What the data refuted

### 1. Full Provider cannot be the universal two-to-three-second path

The frozen 6,604-row telemetry snapshot has Provider stage p50/p95 of
`10.925 / 26.958 s`. This is before a universal writer-visible three-second
deadline can pay for upload, Queue, Resolver, Renderer, persistence, and status
delivery.

### 2. Output-contract reduction was not a safe shortcut

The exact-SHA paired interleaved run completed 40/40 arms but regressed both
scoreboards:

| Cohort | Baseline token recall | Reduced contract | Delta |
| --- | ---: | ---: | ---: |
| Familiar 10 | 0.787071 | 0.717980 | -0.069091 |
| Unseen 10 | 0.482937 | 0.405556 | -0.077381 |

That Prompt family is `NO_GO`; it is not being retried.

### 3. The current constraint model is safe and fast, but does not cover the
missing product facts

On the same legal replay packet, exact product enumeration was decisive on
only `1/20` cards and that one exact value was wrong. Exact unseen recovery was
`0/10`; product-family recovery was `1/10`. Runtime was p50/p95
`0.0032 / 0.0131 ms`, so computation is not the blocker. Knowledge coverage
and candidate validity are.

### 4. A small product-mark sensor is technically plausible

The precommitted Phoenix prospective gate used an official Phoenix template
and source-separated official product pages. It scored one result-bearing
cohort:

| Metric | Result |
| --- | ---: |
| Phoenix recall | 17/19 = 89.47% |
| Non-Phoenix false positives | 0/46 |
| Precision / specificity | 100% / 100% |
| Local CPU p50 / p95 | 44.5 / 50.6 ms |
| Positive / negative source groups | 2 / 5 |

This passes only as a `shadow query sensor`. Five negative source groups are
far too few to claim universal safety: even zero observed group false
positives leaves a one-sided 95% false-positive-rate upper bound of `45.07%`.

The result is nevertheless route-changing evidence: the product family need
not be guessed by the title model and the sensor is two orders of magnitude
faster than the current Provider stage. The next proof must establish whether
this survives multiple products and independently sourced pages.

### 5. The alleged 10.8-second uninstrumented region was a measurement error

The frozen 6,604-row telemetry export was recomputed with an interval union on
each row, rather than subtracting medians from different populations or adding
overlapping async spans. On the 4,668 rows with an `asset_` id, an OpenAI
provider and a final title:

| Same-clock wall region | p50 | p95 |
| --- | ---: | ---: |
| Total L2 | 27.896 s | 67.446 s |
| Before Provider | 0.288 s | 3.288 s |
| Provider | 10.857 s | 25.427 s |
| After Provider | 14.898 s | 49.612 s |
| Not covered by any existing span | **0.111 s** | **0.629 s** |

The `10.841 s` residual is therefore `INVALID_METHOD`, not an optimisation
budget. The large region is already visible and is after Provider. A new
`recognition-critical-path-v1` contract records non-overlapping lifecycle
boundaries for future runs without changing scheduling or title decisions:

```text
core_started
-> full_path_started
-> provider_waiting / provider_started / provider_completed
-> decision_ready
-> identity_cache_stage_completed
-> core_terminal_ready
-> response_built
```

Exact replay and deterministic fast-final routes use shorter route-specific
segment sets; they never fabricate a zero-millisecond Provider call. Multiple
Provider attempts retain both an active-time union and their internal gap.
The packet scope is explicitly `NATIVE_RECOGNITION_CORE`; it excludes the V4
adapter, session persistence, Queue completion and HTTP serialization, so it
must not be presented as writer-visible latency. Route intent is set by the
route owner before execution. A missing Provider or cache boundary therefore
produces `PARTIAL`, rather than being inferred away from absent observations.
`termination_status` and a bounded reason code distinguish an interrupted route
from a successful route with missing instrumentation. A Provider attempt in
this packet means one capacity-stage invocation; HTTP retries inside that
invocation remain inside its execution window.
Only cold/evaluation persistence retains the full packet; normal status polling
receives a compact summary.
Provider concurrency, distributed capacity leases, Queue claim and worker
behaviour remain separate owners and were not changed.

## The optimal critical path

All optional work is removed from the synchronous route. Work that consumes
the same immutable image runs in parallel:

```text
T_evidence = T_decode + max(T_google_vision_batch, T_product_mark_bank)

T_first_day_ready
  = T_admission
  + T_evidence
  + T_retrieval_and_candidate_validation
  + T_resolver_and_renderer
  + T_commit_and_status
```

Full Provider observation is not in that equation. It is an auxiliary fallback
after the fast route has returned either a deterministic result or an explicit
UNKNOWN set. Increasing Provider concurrency cannot improve this fast route.

### Ownership remains separated

| Stage | Owns | Must not own |
| --- | --- | --- |
| OCR / visual sensors | literal evidence and provenance | identity or title |
| Product-mark bank | product query support with a versioned score | product title field |
| Official/reviewed retrieval | candidates and source trust | current-instance facts |
| Candidate validator | agreement, conflict, and eligibility | final SEM fields |
| Identity Resolver | final fields or abstention | image transport / Queue |
| Renderer | deterministic 80-character expression | identity decisions |
| Targeted model assist | proposals for named UNKNOWN fields | complete title or sole visual authority |

## Stage-by-stage latency budget

The task's `2–3 s` goal must distinguish the network's physical upload clock
from the recognition route. The writer-facing time is always reported as:

```text
T_writer_visible
  = T_upload_elapsed_before_generate
  + max(T_upload_remaining_after_generate,
        T_required_preingestion_remaining_after_generate)
  + T_recognition_route
```

No cache or algorithm can beat the byte-transfer lower bound
`8 * bytes_MB / uplink_Mbps`. The product design therefore previews locally,
uploads progressively, and admits each verified card independently; card 1
must not wait for cards 2–100.

### First-day card: fast knowledge route

The table separates measured components from budgets. A target is not reported
as production evidence.

| Stage | Execution | p50 | p95 | Evidence class |
| --- | --- | ---: | ---: | --- |
| Admission, durable intent, generation verification | serial | 0.15–0.30 s | 0.30–0.60 s | budget; not isolated |
| Fetch/decode one immutable image | serial once | 0.10–0.25 s | 0.20–0.45 s | budget; not isolated |
| Google Vision focused evidence | parallel branch | 0.655–0.983 s | 2.206–2.337 s | measured over 300 crops; field dependent |
| Phoenix product mark | parallel branch | 0.0445 s | 0.0506 s | measured prospective; one product only |
| Retrieval + candidate validation | serial after evidence | 0.10–0.25 s | 0.25–0.50 s | design budget |
| Resolver + 80-char Renderer | serial | 0.05–0.15 s | 0.10–0.30 s | design budget |
| Idempotent commit + status | serial | 0.15–0.35 s | 0.30–0.65 s | design budget |
| **Recognition envelope after readiness** | | **1.21–2.28 s** | **3.36–4.84 s** | mixed measured/budget; not E2E proof |

The p50 design is compatible with the conversational target because the local
mark branch is hidden behind OCR. The current p95 is not: Google Vision's
measured crop tail consumes most of the deadline. The p95 problem must be
solved by one-fetch batching, focused crop scheduling, and bounded retry—not by
pretending the p50 is a universal promise.

Eligibility for a deterministic first-day result is fail-closed:

```text
direct card code or equivalent anchor from this image
+ compatible year / subject facts
+ one Official or Reviewed candidate
+ product-mark/query support when product text is absent
+ zero direct conflict
-----------------------------------------------
= Resolver may resolve

otherwise -> partial review or abstain
```

### Same immutable image: exact terminal replay

The repeat path must perform no OCR, model, Provider, Catalog selection, or
Renderer decision when the complete pipeline fingerprint and active Catalog
revision match:

| Stage | Must run | p50 target | p95 target |
| --- | --- | ---: | ---: |
| Verify generation hash already computed during upload | yes | 0.05–0.15 s | 0.10–0.30 s |
| Writer-final / approved-memory / AI-terminal lookup | parallel, fixed authority | 0.02–0.08 s | 0.05–0.15 s |
| Hydrate immutable Resolver snapshot | yes | 0.02–0.05 s | 0.05–0.10 s |
| Idempotent status publication | yes | 0.10–0.25 s | 0.20–0.50 s |
| **Recognition route after verified image** | | **0.19–0.53 s** | **0.40–1.05 s** |

These are architecture targets, not observed percentiles. The required paired
proof remains `provider_calls: 1 -> 0`, byte-identical title and Resolver state,
and an exact `recognition_pipeline_fingerprint` match. A different photograph
of the same card is not this route: it still needs enough current-image
evidence to establish identity, and entity-specific grade, cert, condition,
and serial numerator must never be replayed from another physical card.

## What is now proven, and what is not

| Claim | State | Evidence |
| --- | --- | --- |
| Universal full Provider is the right main route | **REFUTED** | p50/p95 10.925/26.958 s |
| Short read-only output contract preserves accuracy | **REFUTED** | both paired scoreboards regressed |
| Constraint computation is cheap | **PROVEN** | p95 0.0131 ms |
| Current constraint coverage solves day-one product identity | **REFUTED** | exact recovery 0/10 unseen |
| Phoenix mark can be detected locally on fresh official images | **PROVISIONAL PASS** | 17/19, 0/46, p95 50.6 ms |
| Product marks generalize across products | **NOT PROVEN** | only one positive product and seven page groups |
| Fast route meets end-to-end 2–3 s | **NOT PROVEN** | components only; no sealed E2E run |
| Repeat same-image route makes zero Provider calls | **NOT PROVEN CURRENTLY** | contract exists; paired runtime proof still required |

## Next gate, in the only valid order

1. Pre-register a source-separated multi-product official-mark study with at
   least four products, fixed reference crops, frozen image hashes, an
   `AMBIGUOUS` result when multiple marks pass, macro recall, zero critical
   false positives, source-group confidence bounds, and local p95.
2. If it passes, connect the mark bank in shadow as query expansion only. It
   must not populate a title field.
3. Replay the existing legal familiar/unseen packet offline to measure whether
   correct product candidates enter Retrieval Top-5 and whether Selection can
   consume them. No Provider call is needed.
4. Only after zero shadow regression, run one paired interleaved cold 20 with
   cache disabled and complete trace. Report both accuracy scoreboards,
   abstention, evidence/retrieval/selection/application, writer-visible p50/p95,
   and Provider-call savings.
5. Production remains unchanged until the same immutable commit passes the
   Writer Journey and the accuracy gate separately.

The ambition is retained, but stated precisely: the system should answer like
a top expert whenever the observable card plus versioned expert knowledge make
one identity defensible, and should expose uncertainty rather than fabricate
when the world has not yet supplied enough information.
