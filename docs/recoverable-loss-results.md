# Recoverable loss campaign results

Updated 2026-07-27. This report separates offline diagnosis from the live
paired-evaluation gate. A renderer replay is evidence about deterministic
rendering only; it is not reported as a live accuracy win.

## Executive result

The original `88 recoverable tokens` premise is an upper-bound inventory, not
a single cheap accuracy opportunity. The four buckets are heterogeneous. The
only new narrow candidate found in this pass is deterministic product-name
compaction (`UEFA Club Competitions` to `UCC`). It has positive offline replay
evidence but does **not** yet have a valid live verdict.

The live gate is currently unavailable because the production Supabase REST
and Storage planes degraded under the evaluation load. The database itself
remained healthy and directly queryable. The failed half-round was discarded;
no incomplete score is used below.

| Work item | Result | Live verdict |
| --- | --- | --- |
| Parallel family | Unsafe visual-family widening regressed 5.39 pp and remains reverted (`9237e0f`) | REGRESSED |
| Remaining resolver-held tokens | Multiple causes; one narrow UCC renderer candidate (`eb21685`) | UNVALIDATED |
| Candidate-held tokens | Multiple independent safety gates; no safe common widening | NO CHANGE |
| Serial denominator | Existing three-state fixes already cover the safe cases (`f14f7df`, `78cf4d8`) | EXISTING FIX |
| Evidence-held tokens | Provider drift and heterogeneous field paths; no single safe fix | NO CHANGE |
| Catalog “zero candidates” | Premise corrected: zero belongs only to the pre-provider exact-anchor lane | DIAGNOSED |
| Smoke retrieval controls | Catalog, catalog cache, vector, and vector mode are now request-controllable (`e7fdfc1`) | TESTED |
| Catalog cache trace | Hit, miss, and bypass counters added (`3414ff5`) | TESTED |
| Paired-eval validity | Both arms now receive a bounded auth/status preflight (`4c7595a`) | TESTED |

## 1. RESOLVER_HELD_NOT_RENDERED

The 49-token count repeats the same cold-20 cards across three provider runs
and mixes at least four causes:

- semantic equivalence (`Rookie` versus `RC`), which is an audit false positive;
- deliberate 80-character prioritisation, including lower-priority team text;
- lot/multi-card conflicts where a single-card surface attribute is unsafe;
- vocabulary compaction, especially `UEFA Club Competitions` versus `UCC`.

Per the campaign stop rule, this bucket was declared multi-cause after the
third distinct card instead of widening a shared gate.

### UCC candidate

`eb21685` compacts the exact product phrase during deterministic rendering. A
parent-versus-candidate renderer replay changed exactly one card in each of
the three recorded rounds:

| Round | Baseline replay | Candidate replay | Card recall delta | 20-card average delta |
| --- | --- | --- | ---: | ---: |
| 1 | `... UEFA Club Competitions ... Orange Lava PSA 9` | `... UCC ... Orange Lava #CA RC PSA 9` | +0.142857 | +0.007143 |
| 2 | `... UEFA Club Competitions ... Orange RC PSA 9` | `... UCC ... Orange Lava Refractor #CA RC PSA 9` | +0.214286 | +0.010714 |
| 3 | `... UEFA Club Competitions 2023/24 ... RC PSA 9` | `... UCC 2023/24 ... Orange #CA RC PSA 9` | +0.142857 | +0.007143 |

The abbreviation both matches the reviewed vocabulary and releases enough of
the 80-character budget for other already-resolved fields. This remains
`UNVALIDATED`, because the mandatory live paired run did not complete.

## 2. CANDIDATE_HELD_NOT_APPLIED

The 27 tokens are not one application bug. Recorded decisions include:

- `candidate_not_selected`;
- `not_in_provider_prompt_safe_candidate_ids`;
- `post_observation_anchor_filter_blocked`;
- `unsafe_replacement_blocked`;
- `field_not_in_safe_application_plan`.

They also mix visual-vector references, reviewed internal history, and official
checklist rows. The recurring `Lava Refractor` opportunity is a parallel-family
field without an exact identity authorisation. Opening it globally would repeat
the already-measured parallel-family regression. No application permission was
widened.

## 3. Serial resolver-held tokens

The eight repeated entries reduce to three cards. Current deterministic replay
already preserves an uncontradicted denominator as `#/D` when the numerator is
not verified. The remaining examples are either lot/conflict routes or provider
evidence gaps. The safe renderer behaviour is already owned by `f14f7df` and
`78cf4d8`; no second implementation was added.

## 4. EVIDENCE_HELD_NOT_RESOLVED

The four entries reduce to two unstable cases across repeated runs:

- Lorcana product/card-name/collector-number vocabulary that is present in one
  run's final title and absent in another;
- `Rated` on the Travis Hunter card while the final title already carries the
  stronger `Throwback RC` identity.

This is provider/evidence drift plus field-specific normalisation, not one
resolver gate. No speculative fix was made.

## 5. Catalog candidate diagnosis

The statement “catalog returns zero candidates” conflated two different lanes.
Across the 60 recorded rows:

- `pre_l2_anchor_catalog_candidate_count = 0`: 60/60;
- post-observation catalog query attempted: 60/60;
- post-observation raw catalog candidates greater than zero: 50/60;
- a catalog candidate reached the provider prompt: 44/60;
- a catalog candidate was selected: 44/60;
- catalog fields were applied: 25/60.

Raw post-observation counts were 0 on 10 rows, 1 on 3, 2 on 7, 4 on 3, and 5
on 37. The zero metric therefore describes only the pre-provider exact-anchor
fast lane. It does not show that the main catalog retrieval lane is disconnected.

The pre-provider lane runs before asynchronous OCR evidence is available. In
59/60 recorded rows it had no evidence patches to form a unique exact anchor.
Waiting for OCR here is not justified by an accuracy proof and would add cold
latency, so this campaign does not change that ordering.

## 6. Measurement tooling completed

The smoke harness now accepts explicit or omitted request values for:

- `--catalog-assist true|false|omit`;
- `--catalog-cache true|false|omit`;
- `--vector-retrieval true|false|omit`;
- `--vector-retrieval-mode off|shadow|assist|omit`.

Defaults remain byte-for-byte compatible with prior runs. Catalog timing now
contains `catalog_cache_hit_count`, `catalog_cache_miss_count`, and
`catalog_cache_bypass_count`.

The paired runner now performs a 15-second bounded login plus authenticated
status probe on each arm before uploading any card. A 401, 403, or 5xx aborts
the round before provider or storage cost is incurred.

## 7. Invalid live attempt and service-plane blocker

Candidate preview `https://lynca-listing-copilot-1679znedr-lyncafei-s-projects.vercel.app`
was deployed from the isolated UCC commit with per-deployment credentials. Its
login and authenticated status probes passed before the paired run.

Production round 1 then failed during preparation:

- four cards enqueued;
- card 5 returned `queue_enqueue_failed:503: Authentication is temporarily unavailable`
  after 166.752 seconds;
- the run was stopped and produces no valid candidate score or paired verdict.

In the latest 200 production Vercel log rows, the failure window contained at
least 40 preingest 503s, 36 enqueue 503s, 28 pump 503s, 28 preingest-worker
500s, and 4 login 503s. Supabase API logs for the same interval show REST 504s
and Storage 544s, while a direct SQL `select 1` succeeded. A direct PostgREST
read subsequently timed out at 15 seconds.

This is a hosted REST/Storage service-plane failure, not a model, renderer,
queue-policy, or credential failure. Postgres logs add evidence that the
benchmark itself amplified the failure: one checkpoint took 124.333 seconds,
provider-claim RPCs took 15–25 seconds, a `vector_query_logs` insert took about
16 seconds, and multiple idle-in-transaction connections were terminated.

Two in-scope mitigations are now implemented:

1. fail-fast preflight before any upload or provider cost;
2. cold-benchmark suppression of nonessential vector telemetry, workflow
   sidecars, automatic annotation tasks, and quality-finding writes (`c014b73`).

The suppression is request-scoped to the cold algorithm benchmark and leaves
retrieval, selection, resolver, renderer, and the evaluation decision trace
unchanged. Production workloads retain their existing telemetry behaviour.
Restoring or replacing the production data plane would be a production
operation and is prohibited by this campaign.

## 8. Gates not yet run

The following measurements require a healthy production baseline and remain
open; running them during the current service-plane failure would create only
invalid data:

- UCC live paired verdict;
- catalog assist A/B;
- vector assist A/B;
- vector lazy-mode A/B;
- catalog cache A/B with empirical hit/miss/bypass arm proof;
- warm-path populate-then-measure evaluation;
- four paired rounds of reviewed-200 cumulative validation.

They must resume in this order after both arms pass preflight. No holdout,
production deployment, or database write was used in this campaign.

## 9. Warm-path contract and renewed preflight

The warm path is now executable as a first-class paired benchmark through
`scripts/run-warm-path-paired-eval.mjs`. Each arm warms itself and is measured
immediately afterwards; arm order reverses on alternating rounds. The exact
replay gate now requires, per card:

- provider calls `1 -> 0`;
- `identity_cache_hit = true` on replay;
- `provider_call_skipped = true` on replay;
- `cached_result_version_match = true` on replay;
- byte-identical title and resolver state;
- the same image-generation identity and pipeline fingerprint.

The report separates cold and replay accuracy, writer-visible p50/p95,
writer-ready p50/p95, cache-hit rate, and provider-call totals. Both Cold
Algorithm and Exact Replay profiles suppress only nonessential evaluation
writes; production workload behaviour remains unchanged.

Renewed preflight found two environment issues before any card was uploaded:

1. the checked-in execution environment did not inject the frozen `metaverse`
   administrator credential, although production passed when that credential
   was supplied explicitly;
2. Preview was behind Vercel Authentication and the local process had no
   automation bypass secret.

The second issue is fixed without making Preview public: the project's existing
automation bypass was stored in macOS Keychain for the evaluator, and an
accidentally generated duplicate was revoked. Administrator username and
password use the same environment-first, Keychain-fallback resolver, so a new
shell or conversation no longer silently loses them. The first explicit probes
still observed intermittent `AUTH_UNAVAILABLE 503`, but after fixing an env
propagation bug in the preflight helper both Candidate and Production passed
login plus authenticated status probes in the same window (7.7s and 10.0s).
No card was uploaded before both arms reached that state.

The replacement Preview `dpl_GHAwHcoJka1o1KZKzu95vtm2Ttmm` was then built
from commit `35f9264`, so UCC and request-scoped evaluation-write suppression
were present together. The first UCC paired round still stopped at the
Production preflight's 15-second timeout. This second live attempt also made
zero uploads and zero provider calls, so it remains invalid rather than being
scored as a regression.

A later simultaneous preflight passed both arms, but the smoke process then
performed a redundant second login and immediately received
`AUTH_UNAVAILABLE 503`. This third attempt also stopped before upload. The
paired runners now pass the already-authenticated preflight session to the
smoke child through an ephemeral environment variable. No cookie is written to
disk, command arguments, artifacts, or logs, and one full arm run now requires
one login instead of two.

With session reuse enabled, the next baseline attempt entered the real queue:
three cards were enqueued, then two concurrent preparation requests failed
after 155.5s and 170.0s with `queue_enqueue_failed:503 AUTH_UNAVAILABLE`.
Candidate was not started and the partial baseline has no score. Paired and
warm benchmarks now enable an evaluation-only preparation fail-fast switch:
after the first failed preparation, the process exits and no new cards are
started beyond the at-most-two requests already in flight. Writer production
retry behaviour is unchanged.

The paired runner now also supports independent arm values for catalog assist,
catalog cache, vector retrieval, and vector retrieval mode. This makes the four
remaining A/Bs executable against the same deployment and source version; their
arm configuration is persisted in the summary rather than inferred from a
deployment name.

Finally, the previously referenced reviewed-200 files did not exist. They are
now deterministically generated from the 255-row reviewed image-backed source,
with all 20 cold20 identities excluded. The resulting ignored evaluation pack
contains 200 image-only inputs, 200 sealed labels, zero cold20 overlap, and zero
reviewed-title leakage. Its `PAIRED_ABLATION` policy requires both arms to use
the identical item set.

## 10. Latest cold-20 reconciliation after workflow hardening

A new cold-algorithm run completed 20/20 cards on the isolated Preview after
the queue checkpoint, Field Lineage, OCR rendezvous, and Provider-capacity
work. The original run accidentally referenced an ephemeral `/tmp` sealed
label file that no longer existed. Predictions were already frozen, so they
were rescored offline against the repository-owned
`artifacts/smoke/cold20-labels.jsonl`; this added zero Provider calls and
changed zero prediction rows.

The durable rescored artifact is
`artifacts/smoke/fixed20-final-late-binding-serial-v23-rescored.json`.

| Metric | Previous lineage run | Latest run |
| --- | ---: | ---: |
| Confirmed SEM fields | 122 | 122 |
| Preserved fields | 89 | 97 |
| Missing fields | 33 | 25 |
| SEM preservation | 72.95% | 79.51% |
| Provider-not-observed | 11 | 2 |
| Policy-fair token recall | 0.796364 | 0.796283 |

The field-flow improvement is real, but it did not increase title-level token
recall. The release gate therefore remains closed: `0.796283 < 0.85`.

### Catalog item 7 is no longer an open zero-candidate diagnosis

The latest run proves that the main post-observation Catalog lane is active:

- raw Catalog candidates: 79 total, nonzero on 18/20 cards;
- approved Catalog candidates: 78;
- Catalog candidates entering the Provider prompt: 23 total, nonzero on 15/20;
- selected Catalog identity: 16/20 cards;
- at least one candidate field applied: 10/20 cards;
- pre-provider exact-anchor Catalog candidates: still 0/20.

Thus the old “Catalog returns zero” statement is true only for the pre-provider
exact-anchor lane. It is false for the main decision lane and must not be used
again to justify reconnecting or widening Catalog globally.

### Candidate-held item 2 has no safe common widening

Across the latest decision trace there were 1,087 field decisions: 25 APPLY,
71 SUPPORT, 44 BLOCK, and 947 REJECT. The large reject count is not evidence
that 947 fields should be opened. It is dominated by 869
`not_in_provider_prompt_safe_candidate_ids` decisions across unselected
candidates.

Three representative failures prove distinct identity-selection causes:

1. Dalton Rushing: the correct `Orange Refractor` reviewed candidate exists,
   but ranks behind another Catalog identity.
2. VeeFriends: multiple official/reviewed rows agree on the base identity but
   conflict on `Red Sparkle`, `Lava`, and print-run values; the current image
   observation itself conflicts with the reviewed title (`14/25` versus
   `4/5`). Applying an unselected candidate would create a critical entity
   regression.
3. Lorcana: the correct reviewed `Disney Lorcana JP` row exists beside unrelated
   Pokemon and Topps vector candidates. This is identity disambiguation, not an
   Application permission failure.

Per the campaign stop rule, no global Application gate was widened. The next
algorithmic owner is Selection/identity disambiguation with direct-conflict
evidence; opening `candidate_not_selected` or post-observation candidates as a
class would repeat the parallel-family mistake.

### Evaluation debt removed

`scripts/rescore-v4-smoke-report.mjs` now provides deterministic offline
rescoring from frozen predictions, dataset, and sealed labels. Explicit
`--sealed-labels` input is also validated before image upload, queue mutation,
or Provider use. Missing, empty, or incomplete labels now fail closed instead
of producing a paid run with an empty accuracy denominator. Job created,
started, and completed timestamps are retained during diagnostic hydration so
idle-gap reports no longer silently lose their classification inputs.

## 11. Current queue status

| Item | Current state |
| --- | --- |
| 0 Parallel family | REGRESSED and reverted; closed |
| 1 Remaining resolver-held | Multi-cause; UCC candidate still lacks valid paired verdict |
| 2 Candidate-held | Diagnosed as heterogeneous Selection/identity failures; no safe common widening |
| 3 Serial resolver-held | Safe denominator behaviour retained; Vision numerator recovery remains incomplete |
| 4 Evidence-held | Multi-cause; no common resolver fix |
| 5 Reviewed-200 cumulative | Pack exists; not run because 20-card release gate is below 0.85 |
| 6 Warm path | Harness exists; measurement not completed |
| 7 Catalog zero | Closed: only pre-provider exact-anchor is zero; main lane is active |
| 8 Retrieval controls | Completed |
| 9 Catalog cache trace | Completed |

## 12. Warm replay terminal-snapshot audit

The first real three-card Exact Replay run reached the intended fast path:
all three replay jobs reported an identity-cache hit, skipped the Provider,
matched the pipeline fingerprint, and changed Provider calls from `3` to `0`.
The gate still failed because all three replay titles differed from their cold
writer-visible L2 titles.

The failure was not an accuracy-model regression. The cache write occurred
before the final deterministic presentation boundary, while the cold API
response was finalized afterwards. The stored row could therefore omit fields
that the writer had already received. A second independent defect then ran the
Resolver/Renderer again on a terminal cache hit; this could turn a deliberately
suppressed serial such as `#/5` back into `5/5` even when cached fields were
otherwise identical.

The repair is split across two ownership boundaries:

- cache writes now persist the terminal deterministic L2 snapshot and prefer
  terminal `resolved_fields` over a stale provider `resolved` object;
- `TERMINAL_L2_IDEMPOTENT` cache hits are returned byte-for-byte without a
  second Resolver/Renderer pass.

The cache contract is now
`identity-result-cache-v5-terminal-l2-snapshot`, which changes the pipeline
fingerprint and prevents older pre-terminal rows from being accepted as exact
replays. Cache authority remains unchanged: a replay is still non-training,
non-catalog-promotion, and non-identity-truth data. Writer-final and approved
memory authority were not reordered.

The same audit exposed two evaluation debts. Cache-write suppression in the
replay phase no longer overwrites cache-read diagnostics, and warm-pair
identity comparison now falls back to the stable source asset ID when a failed
cold write has no image-generation hash. A proposed direct-mode shortcut was
removed after the API correctly rejected it with
`V4_DURABLE_ENQUEUE_REQUIRED`; durable Queue remains a hard contract.

Live Preview attempts proved the operational halves separately but not the
complete post-fix gate:

- Queue replay proved `3 -> 0` Provider calls on three cards;
- the post-fix terminal snapshot and no-rerender behavior pass dedicated unit
  and benchmark-contract tests;
- an isolated Preview pump did not complete its preflight, so no post-fix
  three-card cloud verdict was produced.

Therefore item 6 remains open and the sample is not expanded to 20. Production,
production traffic, and the frozen accuracy policy remain unchanged.

## 13. Serial resolver-held remainder: multi-subject grammar

The latest cold-20 audit reduced the old serial bucket to five missing
denominators. Three were labelled `RESOLVER_HELD_NOT_RENDERED`; they do not
share a safe global Serial gate:

- D'Angelo Russell and Tyran Stokes were routed to
  `MULTI_SUBJECT_REVIEW`. This is still one physical card, but the
  multi-subject title grammar had no Numerical Rarity slot.
- Walker Jenkins was routed as a real `multi_card` lot. Its `01/25` observation
  also disagreed with the reviewed `11/25`, so applying that serial to the lot
  would be unsafe.

Commit `1b414e5` adds Numerical Rarity only to the single-card multi-subject
grammar. True lots remain unchanged. On the frozen 20-card renderer replay it
changed exactly the two single-card rows, changed zero lot rows, and produced
zero row-level regressions relative to the immediately preceding renderer
replay:

| Metric | Before | After |
| --- | ---: | ---: |
| Policy-fair token recall | 0.793025 | 0.803126 |
| Absolute delta | — | +0.010101 |
| Changed rows | — | 2 |
| Regressed rows | — | 0 |

The required live paired evaluation used Preview deployment
`dpl_J9XR9Zcv9m9UaJn2ge9goW4qcf99`. Production completed 20/20 with score
`0.843786`; Candidate produced only 13/20 legal cold results. Seven rows were
invalid, including three `lease_expired_after_max_attempts`, one
`v4_job_execution_timeout_100000ms`, and one
`late_provider_capacity_not_acquired`. The runner correctly refused to score
the incomplete arm.

Verdict: **NOT_PROVEN**. The structured record is
`artifacts/smoke/paired-eval/serial-multisubject.json`. Per protocol, the same
paired run was not repeated in search of a cleaner result. Production was not
changed, and the commit remains explicitly unvalidated rather than being
called an accuracy improvement.

## 14. Evidence-held remainder: duplicate of the reverted finish-family path

The latest cold-20 audit has two
`EVIDENCE_HELD_NOT_RESOLVED` structural rows: Dalton Rushing and Lamine Yamal,
both missing `Refractor`. They are not a new recoverable cause.

For Dalton Rushing the Provider observed `Orange`; for Lamine Yamal it observed
`Orange Lava` plus `Orange`. In both rows `Refractor` appeared only after
normalization or on an unselected Catalog candidate. Identity Resolver
therefore retained the directly observed color/exact wording and dropped the
unsupported family.

This is exactly the path changed by `2b1b7f4`, which regressed the live paired
score by 5.4 points and was reverted in `9237e0f`. Reopening the same gate under
a different bucket name would repeat the known error. Verdict: **NO-GO, no
code change**. A focused crop/direct read or a correctly selected trusted
Catalog identity may establish `Refractor` in the future; normalized presence
alone may not.

## 15. Queue long-tail containment and evaluation isolation

The invalid Candidate arm was not evidence that the Provider became slower.
Successful Provider calls still completed in roughly 12--27 seconds. The
seven illegal rows were amplified by two separate control-plane defects:

- a transient heartbeat/RPC failure aborted work even while the original job
  lease was still safely live, replaying the same card up to four times;
- the paired runner authenticated each arm independently but did not compare
  their execution controls before starting paid work. The old Preview had
  Catalog and Vector stage-capacity control disabled while Production had both
  enabled, so the run was infrastructure-confounded before its first card.

Commit `268014b` adds lease-aware heartbeat degradation: a transport failure
does not imply ownership loss, so a live original lease absorbs the outage and
retries the heartbeat shortly. A clean negative ownership response still
fences immediately. Supabase RPC calls now receive the task cancellation
signal, including Late Provider Capacity acquisition, so an aborted attempt
does not leave an unbounded control-plane request behind.

The same commit adds a fail-closed paired-evaluation preflight. Before either
arm uploads a card it compares the administrator-visible execution controls,
including Provider concurrency, Late Binding, capacity handoff and every stage
capacity plan. The old Preview was rejected without uploading, enqueueing, or
calling the Provider. Preview configuration was then fixed to match Production:
Late Binding off, Catalog stage capacity on, and Vector stage capacity on.

Preview deployment `dpl_4t11WoeWsVM3MvZq7epubfLfDeeV` reported an equivalent
control snapshot to Production. A three-card cold engineering canary then
produced:

| Metric | Result |
| --- | ---: |
| L2 terminal | 3/3 |
| Provider calls | 3/3, exactly one per card |
| Retried cards / retry attempts | 0 / 0 |
| Lease, execution-timeout or capacity errors | 0 |
| Preparation p50 / p95 | 5.782 s / 7.773 s |
| Writer-ready p50 / p95 | 45.522 s / 54.637 s |
| Provider-slot idle gap total | 2.540 s |

This is an engineering containment result, not an accuracy verdict and not a
20-card throughput claim. It proves the previous 109--153 second preparation
tail and 8--12 minute retry amplification did not recur in the bounded canary.
Production and the frozen accuracy policy remain unchanged.

## 16. Provider-not-observed reconciliation

The earlier 20-card report counted 15 fields as `PROVIDER_NOT_OBSERVED`. That
number is stale after the trace and evidence repairs. The latest frozen audit
has only two such outcomes out of 122 confirmed SEM fields; `CATALOG_NOT_RETRIEVED`
is now the larger evidence/retrieval cause with five fields.

Direct inspection of both remaining image pairs shows why
`PROVIDER_NOT_OBSERVED` is a sensor outcome, not automatically a Provider root
cause:

- the Star Wars Duel of the Fates card shows `DF-3` but no `15/50` on either
  side; the reviewed serial is not visible in the supplied images;
- the Shohei Ohtani card shows the subject, autograph and `24/25`, but neither
  side prints `Image Variation`; that release variant requires identity/catalog
  comparison rather than OCR.

Therefore no Prompt or OCR patch is justified for this remainder. Treating
these two rows as visible-text misses would train the system to invent
non-visible facts. Their safe recovery path is independent trusted identity
retrieval. The old “15 Provider misses” conclusion is closed and must not be
used as the next optimization target.

## Verification

`npm test` completed successfully after all campaign changes. The dedicated
Postgres reliability test was skipped by its existing contract because
`TRACK_C_TEST_DATABASE_URL` is not configured; the deterministic 1,000-job
state-machine test passed with zero external provider calls.
