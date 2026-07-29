# V4 Targeted Model Assist v1

Date: 2026-07-29

Implementation baseline: `origin/main@c9b962bc1ece519bc491e46dd6b6e1b389690962`.

## Architectural decision

The full-card Provider is an auxiliary fallback, not the target default route.
The model remains useful in two narrow roles:

1. read explicitly missing facts from the current card image;
2. later propose search aliases from world knowledge, without identity or title
   authority.

The first role is executable only in a cold evaluation profile. The second role
is implemented as a physically separate text-only component and remains
disconnected from this experiment. Resolver is still the sole final field owner.

## Single downstream

The route branches only at the observation executor:

```text
frozen pre-Provider evidence
          |
          +-- targeted visual observation --+
          |                                 |
          +-- full Provider fallback -------+
                                            |
normalization -> retrieval -> selection -> application -> Resolver -> Renderer
```

There is no second Resolver, Renderer, title contract, cache path, Queue
scheduler, lease policy, or field-application policy. A fallback discards the
targeted partial payload and uses the full Provider as the sole observation
owner. Queue scheduling, claim, lease, and concurrency semantics are unchanged;
the only Queue-adjacent change is stricter authorization for the evaluation
profile override. The existing lease abort signal is propagated through both
Provider calls; an abort after the targeted call fails closed before fallback,
so a worker that lost its lease cannot begin a second paid call.

The targeted safety check proves only that the requested visual observation is
admissible. It does **not** prove that Retrieval, Selection, Resolver, or
Renderer will produce an acceptable terminal title. In v1, full-Provider
fallback occurs before those downstream stages, so a downstream abstention or
conflict cannot trigger a late fallback. This is an explicit production
activation blocker: the paired terminal-title gate must first show no loss, and
any later activation must either prove the eligible route is downstream-safe or
introduce a separately reviewed post-resolution recovery design. The v1
experiment does not duplicate the downstream chain to hide this limitation.

## Targeted visual contract

- Input: at most two original images plus up to four relevant crops.
- Fields: server-owned READ-only field allowlist.
- Requirements: scalar fields remain mandatory, while the server-owned
  `card_name_or_insert_or_code` group is satisfied by any one independently
  evidenced literal identity field; expansion never turns the group into seven
  mandatory readings.
- Known values: only the route owner's `PUBLISHABLE` projection may satisfy a
  requirement; raw pre-ingestion `resolved` values are not trusted shortcuts.
- Prompt: literal current-image reading only; no product/team/world knowledge,
  marketplace text, or title generation.
- Output: strict sparse JSON with an image reference and model-returned support
  text for every emitted value. Because value and support text come from the
  same response, the server always labels them `VISION_MODEL`, review-required,
  and non-direct; only independent OCR/catalog corroboration may raise trust.
- Deadline: `3,500 ms`.
- Automatic retries/repair/key rotation: none.
- Production default: off.
- Evaluation cache/replay shortcuts: off.
- Writer title maximum: unchanged at 80 characters.

The evaluator separately gates the observed output at no more than 150 tokens. The
transport cap is a failure ceiling, not the success budget.

Both cold benchmark profiles also fail closed when any hidden Provider work is
observed: transient retry, output-cap downgrade, truncation retry, key rotation,
the outer GPT-5 empty-result retry, or a Queue-level whole-job retry. Every row
must prove `attempt_count = 1` and an empty retry history. A fallback is not a hidden retry: it is a
second, explicitly typed `FULL_PROVIDER_OBSERVATION` ledger row and its work is
charged to the candidate.

## World-knowledge boundary

The world-knowledge executor is text-only and receives only an allowlisted
structured observation plus single typed `UNKNOWN` outcomes from Forward
Enumeration. It cannot receive images, OCR dumps, an existing title, product or
team guesses, or sealed labels.

Every proposal is server-stamped:

```text
source_type = MODEL_WORLD_KNOWLEDGE
source_trust = HEURISTIC_MODEL_PRIOR
permission = QUERY_EXPANSION_ONLY
```

It cannot support a candidate without independent corroboration and has no path
to Resolver or Renderer. It is not called in Targeted Visual v1.

## Paired-evaluation evidence contract

The paid comparison is admissible only when every arm produces
`evaluation-decision-trace-packet-v9` with an
`evaluation-replay-snapshot-v4` whose status is `COMPLETE` and whose
`missing_components` list is empty. The packet must record the exact benchmark
profile and a full 40-character `deployment_git_sha`. Both arms must report the
same deployment SHA, and every result must equal the workflow's expected
production SHA; checking only the production alias before and after the run is
not sufficient.

All 20 image bundles are prepared and canonically verified before the first
recognition request. That preparation phase is forbidden from enqueueing a job
or calling a Provider. During each AB/BA pair, both arms must reuse the prepared
asset and skip upload, then prove equality of:

- durable `asset_id`;
- source fingerprint;
- `image_generation_id`, equal to `asset_id`;
- canonical image-set SHA-256;
- one or two canonical original-image content SHA-256 values.

The familiar cohort also fails closed unless its own reviewed source row is
excluded from Retrieval. The trace stores only the SHA-256 of
`source_feedback_id`, audits the complete untruncated candidate set, requires
source identity to be observable for reviewed/internal candidates, and permits
zero same-source candidates. The unseen cohort may legitimately have no
reviewed-source identifier, but the source identity state must still match
between arms.

Token recall is only the first accuracy score. After both predictions are
frozen, the offline-only `title-critical-guard-v1` checks critical title facts
(`year`, `manufacturer`, `product`, `subject`, and `card_number`) against the
reviewed title projection and independent exact-identity truth when available.
The guard has no runtime authority. Incomplete guard coverage, any candidate
critical failure, or any critical regression makes the cohort fail closed.

The two frozen development cohorts are:

| Cohort | Cards | Item-set SHA-256 | Sealed-label SHA-256 |
| --- | ---: | --- | --- |
| familiar | 10 | `e280a121c50060918fbc0ea3ba27f755d3c8421f2db66a49cdeccb467253fefe` | `21b094c004a1f25ef5c15a6c62720c8f33a04ec472d91e00d63d797fb2db3599` |
| unseen | 10 | `6f27384f23163f6e40c544271ff01575272fcd4b9c42080408bc866e652b6300` | `b105810bc7dc94bfddb2469d54edb51cc9a4dce7d2f58f8b4a8bfef80d3cb74f` |

Both are explicitly `development`; holdout remains sealed.

## Evaluation and activation

Baseline and candidate use the same deployed code and differ only by benchmark
profile. The frozen familiar and unseen development cohorts are scored
separately, ten cards each, in deterministic per-card AB/BA order.

Activation requires both scoreboards to show:

- zero critical regressions;
- non-negative token recall delta;
- positive net Provider work saving on the targeted-eligible matched subset,
  including fallback work; direct-full control rows cannot subsidize the route;
- observed safe-success rate strictly above the measured break-even
  `T_target / T_full`;
- at least five real targeted attempts;
- complete output-token ledger coverage for every targeted attempt and output at
  or below 150 tokens;
- complete typed call-ledger reconciliation.

The full recognition fingerprint remains an audit field and is expected to
differ between the two experimental profiles. A server-generated
`targeted-assist-nuisance-fingerprint-v1` removes only the three declared
targeted-assist switches, retains all other owners plus deployment revision, and
must match pairwise. Production SHA is checked before and after the run and on
every result packet.

Benchmark overrides require both the scoped secret and the database-verified
legacy Owner principal. A Manager or another Owner holding the bearer secret is
rejected with a uniform 403; ordinary requests without the header retain the
unchanged server-owned writer profile.

Only after **both** familiar-10 and unseen-10 gates pass may one final fixed-20
cold run occur. The fixed-20 workflow mechanically requires the successful
paired workflow artifact, its exact run ID, and the same production SHA. The
paired workflow atomically consumes the exact SHA before its first paid call,
so the unchanged build cannot mint repeated gates. The fixed-20 workflow then
consumes that SHA with a separate Git tag before its first paid call; a second
dispatch for the same build fails closed. Every fixed-20 result must also carry
the exact expected deployment SHA, so a production alias that moves away and
back during the run cannot create a mixed-version pass.
Production activation would also require the Targeted Assist owner, prompt, and
schema versions to be added to the recognition pipeline fingerprint. No cache
contract changes are made by this evaluation-only implementation. For
multi-call candidates, the typed `provider_call_ledger` is the timing and
paid-call authority; the legacy top-level `provider_slot_timing` describes only
the final observation result.
