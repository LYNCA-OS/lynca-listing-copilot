# Model residual v3 paid105 — 2026-08-08

## Decision

**FAIL / do not promote.** The higher-confidence conclusion is not that the
canonical schema should be broadly loosened. A bounded residual lane contains
real signal, but this implementation is too low-density and too slow for the
writer path.

The preregistered screen found:

- resolver utility `+0.0071073` macro F1, `4W / 0L / 31T`;
- effectively neutral canonical interference, `+0.0000480` macro F1;
- zero critical, reference-loss, unbacked-token, numeric, or over-80 failures;
- only four title wins, below the required eight;
- one absolute canonical shape defect, although the same defect occurred in
  A, B, and C and therefore was not introduced by the treatment;
- treatment latency p50 `7079ms` versus pooled control `5450ms`, ratio
  `1.298899`, above the `1.15` gate.

This is an enriched 35-card development screen. The resolved score
`0.8157035` is not a Production accuracy estimate and does not satisfy the
independent fresh150 `>=0.90` plus zero-critical promotion gate.

## Frozen run

| Property | Result |
|---|---:|
| Cards | 35 |
| Arms | control A, byte-identical control B, residual C |
| Calls | 105 |
| Attempts | 105 |
| Retries / failures | 0 / 0 |
| Unique response IDs | 105 |
| Model / served effort | `gpt-5.6-luna` / `low` |
| Concurrency | 1 |
| Region / surface | Singapore `sin1` / isolated Vercel Preview |
| Analysis provider calls | 0 |
| Sealed labels | opened only after 105/105 and envelope replay validation |

Independent no-label validation confirmed that every job identity, arm,
image set, request hash, response hash, authorization receipt, served model,
served effort, and structured-output replay matched the frozen contract before
the labels file was read.

## Results by estimand

### A versus B: model self-jitter

The two requests were byte-identical for each card.

| Metric | Result |
|---|---:|
| Exact title equality | 18/35, 51.4% |
| Exact canonical-field equality | 5/35, 14.3% |
| Cards with a field disagreement | 30/35 |
| Differing field cells | 80/1050, 7.62% |
| Macro F1, A | `0.8082120` |
| Macro F1, B | `0.8088844` |
| B minus A | `+0.0006724` |
| W/L/T | 6/8/21 |
| Two-sided sign test | `p=.7905` |

The largest disagreement counts were `low_confidence` 11, `product` 8,
`observed_parallel_family` 7, `withheld_finish_terms` 7,
`observed_surface_color` 7, `print_finish` 6, `parallel_family` 5, and `set` 5.
There is no directional aggregate bias, but single-card output is highly
stochastic.

### C canonical output versus pooled A/B

| Metric | Result |
|---|---:|
| Pooled control macro F1 | `0.8085482` |
| C canonical-only macro F1 | `0.8085962` |
| Delta | `+0.0000480` |
| W/L/T | 8/11/16 |
| Two-sided sign test | `p=.6476` |

The extra response field did not improve canonical accuracy and did not cause a
mean regression larger than the registered `-0.002` bound. The one
`product_looks_like_a_title` defect was present on the same Lamine Yamal asset
in A, B, and C. It still fails the preregistered absolute-zero gate, but it is
not treatment-induced.

### Candidate capture and resolver utility

C returned 71 candidate rows on 31/35 cards:

- role: 36 identity, 16 other-visible, 7 commercial, 6 finish, 6 exact-code;
- region: 34 front, 25 back, 11 slab, 1 front-symbol;
- basis: 69 printed-text, 2 visual-pattern.

Only six cards changed typed fields; four changed the title and improved F1.

| Asset prefix | Applied mechanism | Title effect | F1 delta |
|---|---|---|---:|
| `91524c` | printed `1st Bowman` | appended | `+0.061905` |
| `bc2c29` | printed `1st Bowman` | appended | `+0.088235` |
| `ced894` | printed `1st Bowman` | blocked by Composer/80-char ordering | `0` |
| `87df03` | printed `1st Bowman` | appended | `+0.051948` |
| `0a34c5` | slab `AUTO-RED REFRACTOR` | typed compaction added `Red` | `+0.046667` |
| `a9aadb` | product extension to `Topps Chrome` | Composer output unchanged | `0` |

Aggregate resolver utility was `0.8085962 -> 0.8157035`, or `+0.0071073`,
with `4W / 0L / 31T`, sign test `p=.125`. The effect is real but concentrated:
three wins came from `1st Bowman`, one from a printed slab finish. This is not
broad recovery of the missing 20%.

Four cards returned no residual row at all. That set still contained obvious
unrecovered phrases such as Kershaw `Majestic Tag / Gold` and Leaf Eclectic
`Kaleidoscope / Clown Fish`, demonstrating that the residual schema did not
capture the main missing surface.

## Safety

All treatment-to-resolved safety counters were zero:

- critical cards;
- reference-token losses;
- unbacked new tokens;
- unsupported numeric changes;
- titles over 80 characters;
- candidate or resolver contract defects.

The lone canonical shape defect is described above and was inherited equally
by all three arms.

## Cost and latency

| Metric | Pooled A/B p50 | C p50 | Ratio | Gate |
|---|---:|---:|---:|---|
| Input tokens | 5879 | 6034 | 1.0264 | pass, <=1.06 |
| Output tokens | 364 | 643 | 1.7665 | diagnostic only |
| Total tokens | 6165 | 6523 | 1.0581 | diagnostic only |
| Latency | 5450ms | 7079ms | 1.2989 | **fail**, <=1.15 |

Latency p95 was `8154ms -> 9490ms`, ratio `1.1638`, which passed the `1.20`
gate. The p50 penalty is nevertheless writer-visible and unacceptable for this
amount of recovered coverage.

The evidence points to response length rather than a fixed schema-validation or
network penalty:

- input p50 increased only 2.64%, while output p50 increased 76.65%;
- C output averaged 624 tokens versus about 393 for controls;
- within each arm, output length strongly tracked latency;
- 35/70 control calls received exact-input cache credit, while C received none;
  comparing C with only uncached controls narrows but does not remove the p50
  penalty (`7079ms` versus `5850ms`, about +21.0%).

Therefore the optimization target is information density: fewer, shorter,
title-worthy residuals. Raising concurrency or changing the network does not
fix this single-card critical path.

## Post-hoc diagnostics — no promotion authority

After labels were unsealed, the cleanest unused phrase was printed `PRIZM` on
two Panini cards. A label-assisted counterfactual suggests about `+0.0024943`,
`2W / 0L`; this is below the existing gate and is not an independent result.
`Rookie`-style additions can also increase legacy token F1, but frequently
duplicate an existing `RC` semantic claim. They are rejected as a first
mechanism.

Combining these observations after seeing labels could make the development
set appear to reach eight wins. That would be post-hoc selection, so it is
explicitly forbidden as evidence for this run.

## Action

1. Keep Production `low/high/strict canonical` unchanged.
2. Do not deploy `residual_visible_evidence` v3 to the writer path.
3. Keep the Preview harness, checkpoint, resolver receipts, and six safe typed
   outcomes as research assets.
4. Do not buy another schema experiment now. If `printed_prizm_mark_v1` or a
   compact residual mechanism joins a larger bundle, first run a frozen
   label-blind 150 zero-call replay. A real 150-card call is justified only
   after 5-8 mechanisms survive replay under the user's batching rule.
5. Any future residual schema should optimize safe information per output token:
   at most one or two non-duplicate, marketplace-title-worthy printed spans;
   no teams, positions, certification boilerplate, or generic exact codes.

## Evidence receipts

| Artifact | SHA-256 |
|---|---|
| prereg file | `bb6c651acef754beb7ed260614d4017af981057b7eda3bddeb3e775a7b5590e8` |
| normalized prereg | `18ca54ada2f0183cb475c47bce34149c405108bc6c9c0193a560613d3f43f94d` |
| normalized payload | `3bef79aab729e6de30411bcd34c0e0a4d53c6f810e5ec2b6c8839494ccb16117` |
| payload file | `26684cd3bac9a5dec7748af3cc831afb22bf9b8011ed150a4044def0bb83f843` |
| authorization file | `de7a84fd7d49d692cde8c74a63d954f819aecc8099a968479da407a27285be11` |
| checkpoint file | `5e51bf36f1a8ed444cf2269668821c53abbad594eea286615cae974b69aad0dd` |
| analysis file | `4b9a07f3f29ee00cb7020e35520116ce501bb95af6879e24bf94422e990113be` |
| run fingerprint | `ca4d90b7cf21581097f11d202779bf1df8d91a596bac19046f2cab693ac3670d` |
| dataset | `5aebd6a4bb08665d6601801258e39a5954ec82b7187f71f577f18c71bd27adca` |
| sealed labels | `59669f166180aab0bef24b5133b3cc92b06366f955eae54af0c43f7247436646` |

The raw payload, authorization, checkpoint, and analysis remain ignored
internal artifacts. The tracked document records their exact receipts without
copying provider envelopes or sealed labels into Production.
