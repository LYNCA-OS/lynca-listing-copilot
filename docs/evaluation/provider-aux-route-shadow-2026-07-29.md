# Provider auxiliary-route shadow decision

Date: 2026-07-29

Implementation baseline: `origin/main@c9b962bc1ece519bc491e46dd6b6e1b389690962`.

## Decision

The full-card Provider is not the default architecture target. It remains a
low-frequency auxiliary fallback, teacher, and audit sensor. It is not deleted:
removing it before the targeted route is measured would turn bounded uncertainty
into silent abstention or wrong deterministic output.

The only activation order is:

1. `FAST_DETERMINISTIC` for independently publishable evidence, exact replay,
   or a proven unique identity;
2. `TARGETED_MODEL_ASSIST` for bounded `UNKNOWN` fields;
3. `FULL_PROVIDER_FALLBACK` for unresolved or conflicting novel images;
4. rescan or writer review when no usable image exists or Resolver still cannot
   reconcile the result.

Production remains on the unchanged server-owned writer profile; no auxiliary
route is activated for ordinary requests. The Targeted Visual route executes
only as the candidate arm of an explicitly authorized cold evaluation. Resolver
remains the final field owner. Title and cache contracts, Queue scheduling,
claim/lease semantics, concurrency, and production output are unchanged. The
only Queue-adjacent change is authorization of the evaluation override, not a
scheduling or lease change.

## First-principles objective

For a novel card, Provider slot work is bounded by:

```text
E[W] = p_targeted * E[M_targeted]
     + p_fallback * E[M_full]
```

The current default has `p_fallback = 1`. A targeted route is beneficial only
when it both shortens `M_targeted` and safely reduces the later fallback rate.
Route coverage alone proves neither condition.

Visual observation and world knowledge are physically separate. The first
executable experiment runs only:

```text
targeted visual observation
→ existing normalization / retrieval / selection / Resolver / Renderer
→ conditional full Provider fallback only when the targeted observation is unsafe
```

The visual executor is available only under
`cold_targeted_assist_benchmark + trace_level=evaluation`; production defaults
remain off. It makes one bounded call, never retries internally, and returns to
the existing downstream chain exactly once. The separate world-knowledge
executor has no image, Resolver, or title access and is deliberately disabled in
this first comparison so two variables cannot move together.

The only valid candidate call sequences are:

```text
FULL_PROVIDER_OBSERVATION
TARGETED_VISUAL_OBSERVATION
TARGETED_VISUAL_OBSERVATION → FULL_PROVIDER_OBSERVATION
```

Every paid attempt is recorded in a typed ledger. A targeted partial result is
discarded when fallback owns the final observation.

The targeted model cannot certify its own text as direct card/OCR evidence. Its
value and supporting snippet are one model response, so both remain
`VISION_MODEL` / review-only. This preserves the distinction between a useful
bounded observation and an independently verified printed fact.

## Break-even condition

For targeted-eligible cards, sequential Provider work is:

```text
E[W_candidate] = T_target + (1 - q_safe) * T_full
```

It beats the full path only when:

```text
q_safe > T_target / T_full
```

Using the existing unseen-10 full-Provider mean of `4,577.4 ms`, a `2,000 ms`
target needs safe success above `43.7%`; a `3,000 ms` target needs above `65.5%`.
This is a measured gate, not an architectural assumption.

## Existing unseen-10 evidence

The offline audit used the existing cold baseline artifact only. It made no new
Provider call and did not use holdout or final/reference titles as route input.

| Metric | Result |
| --- | ---: |
| Novel cards | 10 |
| Native frozen pre-Provider route traces | 0/10 |
| Reconstructable empty pre-Provider snapshots | 10/10 |
| Offline targeted-route assignments | 10/10 |
| Proven deterministic fast finals | 0/10 |
| Observed full Provider calls | 10/10 |
| Full Provider slot work | 45,774 ms |
| Full Provider tokens | 39,527 |
| Proven net work/token saving | 0 |
| Final fallback-rate bound | 0–100% |

The 45,774 ms and 39,527 tokens are a gross substitution ceiling, not savings.
The targeted executor has never run, so its latency, token use, accuracy, and
safe-success rate are unknown.

The old packet's visible `8 targeted + 2 writer review` split is inadmissible as
a pre-Provider denominator: late Recognition Worker evidence could replace the
initial route before writer-ready. The new trace preserves the initial route and
stores a later result only as `post_initial_diagnostic_decision`.

## Frozen paired denominator

The executable gate uses two independent frozen development scoreboards, never
holdout:

| Cohort | Cards | Item-set SHA-256 | Sealed-label SHA-256 |
| --- | ---: | --- | --- |
| familiar | 10 | `e280a121c50060918fbc0ea3ba27f755d3c8421f2db66a49cdeccb467253fefe` | `21b094c004a1f25ef5c15a6c62720c8f33a04ec472d91e00d63d797fb2db3599` |
| unseen | 10 | `6f27384f23163f6e40c544271ff01575272fcd4b9c42080408bc866e652b6300` | `b105810bc7dc94bfddb2469d54edb51cc9a4dce7d2f58f8b4a8bfef80d3cb74f` |

All 20 assets are made durably present (uploaded or reused) and canonically
verified before either scoreboard starts, with zero enqueue or Provider calls
during preparation. Every arm must then hit the verified-asset cache, skip
upload, and match its pair on durable asset ID, source fingerprint, image
generation, canonical image-set hash, and the original-image content hashes.
Preparation/upload time therefore cannot be misreported as Provider-route work
and the two arms cannot silently see different bytes.

## Offline contract replay before paid evaluation

The current code replayed the available COMPLETE historical packets without a
GPT call:

- familiar-10: `0/10` admissible because its replay snapshot is the obsolete
  v1 schema and lacks the current provenance contract;
- unseen-10: `10/10` structurally replayable, but two titles safely lost fields
  that existed only as generic `VISION_MODEL` downstream values and never
  entered raw READ transport with independent image/OCR provenance.

The constraint snapshot was present and hash-matched; this was not a missing
catalog-file failure. These historical packets predate Targeted Assist and have
no targeted execution or typed call ledger, so they cannot prove either a
current Targeted Assist regression or a zero-regression gate. They are retained
as an explicit `LEGACY_PROVENANCE_INADMISSIBLE` result. The new paired 10+10
must create current-schema raw traces; any comparable loss in those fresh
packets blocks activation.

## Frozen-input gate

A future activation denominator must prove all of the following:

- every arm has `evaluation-decision-trace-packet-v9` and a COMPLETE
  `evaluation-replay-snapshot-v4` with no missing components;
- route input is frozen and hashed before Provider starts;
- replay input hashes back to the persisted pre-Provider snapshot;
- current-image evidence has an availability manifest at the freeze boundary;
- Provider/post-observation/Resolver/title/ground-truth fields contributed zero
  route inputs;
- late Worker output is diagnostic only and cannot reclassify the initial route;
- targeted latency and accuracy are measured in paired familiar and unseen
  development experiments before any production action changes;
- each result records the exact deployment Git SHA, both arms match, and the SHA
  equals the workflow-pinned production revision;
- both arms use the same canonically verified immutable image bundle;
- familiar rows prove SHA-only same-source reviewed exclusion across the full,
  untruncated and source-observable candidate set; self-retrieval count is zero;
- every result has a complete offline `title-critical-guard-v1`; critical
  candidate failures and critical regressions are zero;
- transient retry, output-cap downgrade, truncation retry, key rotation, and the
  outer empty-result retry are all absent. An explicit targeted-to-full fallback
  remains visible as two typed paid calls and cannot be hidden as a retry;
- Queue-level whole-job retries are also absent: every row proves exactly one
  job attempt and an empty retry history;
- route savings are calculated only over matched targeted-eligible pairs;
  direct-full deployment controls cannot compensate for a losing targeted path;
- output-token coverage is complete, observed safe-success beats the measured
  break-even rate, and a server-normalized nuisance fingerprint matches within
  every pair before the cohort can pass.

Legacy packets fail closed unless their pre-Provider input is explicitly
reconstructable as empty. Exact replay is reported separately and cannot be used
to claim novel-card speed.

## Current activation blockers

- No paired familiar-10 and unseen-10 result exists yet.
- Targeted safe-success, net work saving, and accuracy delta are unproven.
- The targeted owner versions are intentionally absent from the production
  recognition fingerprint while cache read/write are disabled. They must enter
  the fingerprint before any production workload activation.
- World knowledge remains a later, independent ablation.

## Explicit exclusions

- No production route was activated.
- No world-knowledge paid call is made by the targeted visual experiment.
- No fixed-20 or pressure test is authorized before **both** paired scoreboards
  pass. A single fixed-20 then additionally requires the paired artifact, exact
  Actions run ID, and identical production SHA. The paired workflow first
  atomically consumes that deployment SHA, so an unchanged build cannot be
  repeatedly measured. The fixed-20 workflow separately consumes the exact SHA
  with a second Git tag before paid calls and verifies the deployment SHA on
  every returned result, not only before and after the batch.
- No Prompt, OCR, Retrieval weight, Resolver, Renderer, Queue scheduling/lease,
  or concurrency behavior changed. Only the evaluation override's authorization
  boundary changed.
- The separate `set → product` exact-anchor debt remains a different PR.
