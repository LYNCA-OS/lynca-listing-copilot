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

## Verification

`npm test` completed successfully after all campaign changes. The dedicated
Postgres reliability test was skipped by its existing contract because
`TRACK_C_TEST_DATABASE_URL` is not configured; the deterministic 1,000-job
state-machine test passed with zero external provider calls.
