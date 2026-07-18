# V4 Optimal Recognition Policy v1

## 1. Objective

The recognition chain is a constrained sequential decision problem, not a fixed list of modules.

For evidence state `s`, the policy chooses the next action `a` from the feasible action set:

```text
cheap evidence / OCR
exact catalog lookup
GPT observation
vector retrieval
focused verifier
external retrieval
stop and render
writer deep review
```

The online action optimizer uses a Lagrangian objective:

```text
minimize expected semantic error + critical error + latency + capacity + cost + manual effort

Release selection is a separate strict feasibility filter:
SEM accuracy >= 87% (target 90%)
throughput >= 6 cards/minute
terminal technical failure <= the release reliability limit
all hard invariants pass
```

Accuracy remains the first priority. Latency and capacity are optimized only inside the feasible accuracy region.
The weighted online objective is not allowed to waive a release constraint. A policy profile is launchable only when the offline Pareto audit proves every constraint simultaneously.

## 2. Hard Invariants

Optimization cannot trade away:

- durable asset identity
- verified tenant ownership
- immutable image generation
- complete canonical image references
- server-reconstructed storage scope
- one execution identity per tenant + asset + image generation

Candidate, catalog, vector, and marketplace records remain evidence, never truth. Physical-instance fields such as serial numerator, grade, and cert number must come from the current card image or writer confirmation.

Unknown invariant state fails closed. This prevents a low-latency policy from becoming a data-integrity shortcut.

## 3. Bellman / Value-of-Information Rule

For finite horizon `T`:

```text
V_t(s) = min(
  safe_stop_loss(s),
  writer_review_loss(s),
  min_a [execution_cost(a) + E(V_(t+1)(s' | s,a))]
)
```

An action has positive value of information only when its expected risk reduction is larger than its latency, capacity, cost, failure, and regression exposure.

This yields the intended behavior:

- a unique exact catalog match can skip vector
- ambiguous or low-margin catalog state may request vector
- direct critical-field conflict requests a focused verifier
- already-safe evidence stops instead of running every module
- missing hard invariants reject rather than guess

## 4. Full-Information Replay

The policy can only be calibrated from same-card action observations:

```json
{
  "query_card_id": "...",
  "truth": {
    "provenance": "REVIEWED_FIELD_GT",
    "fields": {},
    "critical_fields": []
  },
  "expected_actions": [],
  "action_observations": [
    {
      "action": "RUN_GPT_OBSERVATION",
      "latency_ms": 0,
      "technical_success": true,
      "field_predictions": {},
      "state_before": {},
      "state_after": {}
    }
  ]
}
```

The replay computes:

- Chain Oracle SEM upper bound
- Chain Oracle critical-field upper bound
- correct evidence source per field
- missing fields that no module can recover
- minimum-latency / minimum-capacity / minimum-cost action cover
- static action-set Pareto frontier
- 85% / 87% / 90% / 95% target frontier
- empirical latency, failure, and risk-transition parameters

`corrected_title`, seller title, and token recall are proxy labels only. They cannot enter the Chain Oracle denominator.

## 5. Current Calibration Evidence

The first local calibration combined current workflow smoke, retrieval audit 100, image-detail A/B, and development fixtures:

- 117 unique cards represented
- 7 development cards have field-level fixture truth
- 0 cards have both reviewed field GT and complete same-card action observations
- GPT latency observations: 17; median approximately 18.8s
- vector latency observations: 2; median approximately 7.1s
- legacy vector technical failure observations: approximately 7.27%

Therefore the current data can calibrate part of the cost model, but cannot honestly prove a Chain Oracle accuracy or production policy improvement. Promotion remains blocked.

## 6. Historical Three-Champion Fusion

Historical winners are evidence about action design, not separate production chains:

- Accuracy champion contributes high-information observations and strict field fidelity.
- Speed champion contributes early stopping, exact-anchor routing, and removal of unnecessary actions.
- Stability champion contributes immutable asset identity, bounded retry, idempotent queue execution, and explicit terminal states.

No historical endpoint is restored wholesale. A behavior survives only if it can be represented as one action or one invariant in the unified V4 lifecycle and improves the fixed release benchmark.

## 7. Shadow-First Graduation

The optimizer is exposed through `v4ProductionStrategy.shadow_recognition_policy` with `can_execute=false`.

It can execute production actions only after all of the following are true:

1. Fixed 10-card Full-Information Replay has reviewed field GT and complete action coverage.
2. Shadow policy recovery exceeds regression.
3. Fixed 10 passes the accuracy, throughput, and technical stability gates.
4. Random 100 (including cold-start eBay cards) passes the same gates.
5. A final friction audit finds no duplicate decision owner or bypass path.
6. The policy profile, transition model, and benchmark hashes are frozen together.

Until then, the existing production strategy remains authoritative.

## 8. Commands

```bash
npm run build:full-information-replay -- \
  --input <report-a.json> \
  --input <report-b.json> \
  --output-dir data/eval/optimal-policy/<run>

npm run eval:optimal-policy -- \
  --replay data/eval/optimal-policy/<run>/full-information-replay.json \
  --transition data/eval/optimal-policy/<run>/transition-model.json \
  --out data/eval/optimal-policy/<run>/shadow-policy-evaluation.json
```
