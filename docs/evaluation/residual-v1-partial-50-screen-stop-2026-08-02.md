# Residual v1 partial-50 screen — STOP as a standalone paid mechanism

Date: 2026-08-02  
Authority: evaluation-only screen; not a cloud verdict and not production evidence  
Additional provider calls made by this analysis: 0

## Decision

The contrary case was to finish a new 105-card cloud control/treatment run because the existing run stopped early. That would spend 210 more Luna calls on one mechanism.

The observed evidence supports stopping that standalone run. Residual v1 is safe and slightly positive, but its recall is much too small to be an accuracy head:

- 50 cards have both control and treatment responses; one additional card is control-only and another is treatment-only;
- 43/50 paired cards still miss at least one reviewed-title token after the treatment canonical title;
- only 5/43 have any residual phrase containing a missing token;
- only 4/43 have such a phrase in the replay-eligible residual subset;
- the bundle changes 3/50 titles: 3 wins, 0 losses, 47 ties;
- candidate macro F1 is 0.815560, only +0.002844 over the treatment canonical title;
- only 2/50 candidate titles are token-set exact matches to the reviewed title.

This screen must remain append-only evidence. It must not be merged with a later cloud cohort or described as production-simulated. The isolated sin1 Preview harness remains useful, but the next paid accuracy run should wait until 5–8 large mechanisms are frozen and should use the full 150-card gate.

## Paired score decomposition

| Arm | Macro token-set F1 | Meaning |
|---|---:|---|
| Canonical control | 0.812141 | Same Luna model, effort none, high image detail. |
| Residual treatment, residual ignored | 0.812716 | Canonical interference is +0.000575 on this partial screen. |
| Treatment plus frozen offline bundle | 0.815560 | Final diagnostic candidate. |
| Bundle marginal over treatment canonical | **+0.002844** | 3 wins / 0 losses / 47 ties. |

The current paid gate requires final macro F1 at least 0.90. Given 0.815560 on the first 50 complete pairs, the unobserved 55 would have to average:

```text
(0.90 * 105 - 0.8155603094203174 * 50) / 55
= 0.9767633550724387
```

That is not a plausible rescue path. This is not merely a pessimistic prefix: on the older zero-call replay over the same 105 IDs, these first 50 were the easier subset (candidate 0.807848), while the remaining 55 averaged 0.744072 and only two were exact. The older replay is used only as a cohort-difficulty diagnostic; it is not substituted for fresh responses.

## What the model expressed

The 50 treatment rows emitted 58 retained residual candidates:

| Target | Candidates |
|---|---:|
| identity | 22 |
| card_name | 15 |
| marker | 10 |
| subject | 5 |
| finish | 3 |
| card_number | 3 |
| **Total** | **58** |

- 39 are `resolver_candidate` / replay-eligible.
- 19 are candidate-only.
- Only five cards have any candidate token that intersects a token missing from the canonical treatment title.
- Only four cards retain such an intersection after the replay-eligibility boundary.

The bottleneck is therefore not primarily admission. The same call still fails to express the needed complete product, set, year, serial, and related identity phrases on most error cards. Loosening the resolver around the 58 rows cannot move the system from roughly 0.81 to 0.90.

## Next accuracy heads

1. Increase same-call observation recall with typed, field-specific attention slots for printed marker, stamped serial, and parallel/finish cue. These remain candidate-only until independently resolved.
2. Add a local, source-versioned release/parallel graph that supports or ranks Luna candidates; absence is `UNKNOWN`, never a hard rejection.
3. Replace one-off title compactions with a typed Pareto Composer that preserves CSM tier, existing helpful tokens, numeric meaning, and the 80-character contract.
4. Run zero-cost screens first. Only after 5–8 genuinely large mechanisms survive should they share one fresh 150-card cloud run.

## Evidence and boundaries

| Source | SHA-256 | Use |
|---|---|---|
| `artifacts/paid105-residual-v1-2026-08-02/thin-path-gpt-5.6-luna.jsonl` | `7fcbaf1a91a898c2ffb8e6a5e76ba78a618a01d78aa0d94e7746e0f7b94eab19` | 102 durable rows: 50 complete pairs plus two singletons. |
| `artifacts/paid105-residual-v1-2026-08-02/thin-path-gpt-5.6-luna.manifest.json` | `565a95d4798e6d38a3ce320e96d9214e879723adb85a8d3327f7b869c06db363` | Frozen request/cohort contract; incomplete run manifest. |
| `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/safe-bundle-replay-outside-105.json` | `04c0750e261952e86b665e3a97e229787f58860988b0121695144ee79885f98b` | Historical same-ID difficulty split only. |

The two singletons are preserved but excluded from every paired metric. The local partial screen is not independent confirmation, not a hosted latency result, and not permission to promote residual v1. Its only promotion decision is **STOP as a standalone paid mechanism because recall is insufficient**.
