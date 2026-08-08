# Compact residual v4 cloud prereg — 2026-08-09

## Decision

**PREREGISTERED / NOT AUTHORIZED / 0 provider calls.** The opposing result comes
first: the old A/B controls cannot be combined with a later compact C to claim
causal latency or canonical non-interference. Provider time, cache state and
deployment state are not exchangeable.

The final evaluation-only property is one required nullable string,
`residual_printed_phrase`, with `maxLength=64`. Its frozen schema SHA-256 is
`2ec797216b90df9c8d4ab634325f6a1dee4959cc58f4064dca4c5f7b4e5b628b`.
The provider-free replay preserves 35/35 titles, 35/35 canonical field sets,
`+0.0071072793` macro F1 and `4W/0L/31T`; it emits 31 strings / 1,597 aggregate
wire bytes. This proves compression fidelity only, not fresh provider capture.

## Cost-optimal design under the 105-call ceiling

The v3 development rate is `4/35`. A 50-card treatment with an eight-win gate
has only 20.7% optimistic power. Fully pairing enough cards for 80% power at
eight wins requires 88 pairs / 176 calls and violates the budget.

The frozen design therefore uses all 70 cards outside the v3 development35:

- compact treatment on 70 cards;
- a fresh contemporaneous canonical control on a fixed hash-selected 35-card
  subset;
- 35 balanced three-job blocks, concurrency 1, no retry, one attempt per job;
- total: 70 treatment + 35 control = **105 provider calls**.

Resolver utility is paired inside each treatment response, so all 70 treatment
cards contribute to that estimate. Fresh controls are used only for canonical
interference, token and latency comparisons. At the observed `4/35` rate, the
probability of at least six wins is 82.52%. Six wins and zero losses give a
two-sided exact sign p-value of 0.03125. The prior eight-win threshold would
have only 55.56% power on 70 cards and is not used as a negative decision gate.

## Frozen decisions

- `PASS_FOR_FRESH150_BUNDLE_ONLY`: at least 6 wins, 0 losses,
  `delta F1 >= 0.003`, exact sign `p <= 0.05`, all field/factual gates zero,
  canonical delta at least `-0.002`, and all token/latency ratios pass.
- `HOLD`: insufficient utility or inconclusive/non-economic interference with
  no factual regression. HOLD is not evidence that the mechanism is negative.
- `STOP`: any reference, factual, canonical-field, ambiguity-application,
  request, retry or execution-contract regression.

An ambiguous single-string route must be a no-op; `ambiguous_route_applied=0`
is a hard gate. Missing safety fields are invalid input, not an implicit zero.

## Execution boundary

The prereg remains `execution_authorized=false`. Before a paid adapter can be
authorized it must reuse the proven v3 boundaries for: an exact assets-only
physical manifest; sealed label receipts; immutable Preview project/hostname/
`sin1`; signed-payload and per-job TTL receipts; authorization receipt hashes;
served model/effort and response identity validation; and complete structured
output/raw-response hashes for deterministic replay.

The checkpoint contract fsyncs an `ATTEMPTED` event before invoking a provider.
Any unmatched attempted, ambiguous or contract-violating event blocks resume
for reconciliation and can never be automatically reinvoked.

Neither the zero-call replay nor this 105-call mechanism screen can authorize
Production. A pass may only place this mechanism in a new shared-control
fresh150 bundle. Production still requires the independent >=0.90 / zero
critical-error release gate and the full protected release sequence.

## Reproduce without network

```bash
node scripts/analyze-model-residual-compact-v4-zero-call.mjs
node scripts/preregister-model-residual-compact-v4-cloud.mjs
node scripts/model-residual-compact-v4-cloud-gate.test.mjs
```
