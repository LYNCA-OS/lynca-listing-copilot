# Provider auxiliary-route shadow decision

Date: 2026-07-29

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

Every route in this change is `SHADOW_ONLY`. Resolver remains the final field
owner. Title, cache, Queue, concurrency, and production output are unchanged.

## First-principles objective

For a novel card, Provider slot work is bounded by:

```text
E[W] = p_targeted * E[M_targeted]
     + p_fallback * E[M_full]
```

The current default has `p_fallback = 1`. A targeted route is beneficial only
when it both shortens `M_targeted` and safely reduces the later fallback rate.
Route coverage alone proves neither condition.

Visual observation and world knowledge are physically separate. A mixed target
runs, at most:

```text
targeted visual observation
→ deterministic constraint recomputation
→ conditional text-only world-knowledge assist
```

The world-knowledge step has no image, Resolver, or title access. Both targeted
executors are currently `NOT_IMPLEMENTED`; the existing full Provider remains
the observed production action.

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

## Frozen-input gate

A future activation denominator must prove all of the following:

- route input is frozen and hashed before Provider starts;
- replay input hashes back to the persisted pre-Provider snapshot;
- current-image evidence has an availability manifest at the freeze boundary;
- Provider/post-observation/Resolver/title/ground-truth fields contributed zero
  route inputs;
- late Worker output is diagnostic only and cannot reclassify the initial route;
- targeted latency and accuracy are measured in a paired development/validation
  experiment before any production action changes.

Legacy packets fail closed unless their pre-Provider input is explicitly
reconstructable as empty. Exact replay is reported separately and cannot be used
to claim novel-card speed.

## Explicit exclusions

- No targeted model executor was added.
- No world-knowledge paid call was added.
- No card was rerun.
- No fixed-20 or pressure test was run.
- No Prompt, OCR, Retrieval weight, Resolver, Renderer, Queue, or concurrency
  behavior changed.
- The separate `set → product` exact-anchor debt remains a different PR.
