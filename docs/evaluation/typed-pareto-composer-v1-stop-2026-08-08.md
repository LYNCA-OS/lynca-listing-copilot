# Typed Pareto Composer v1 — 150-card replay decision

Date: 2026-08-08

Decision: **STOP / EVALUATION ONLY**

Provider calls: **0**

Production Composer changed: **no**

## Decision

Do not connect `typed-pareto-composer-v1` to the production Composer. The safe
selector is non-destructive, but its only enabled compaction changed one of 150
cards and produced no measured title-score gain. Keeping a second production
selector for a zero-gain mechanism would be long-term complexity without value.

The evaluation implementation remains isolated so the failed mechanism, its
guards, and its evidence can be reproduced instead of rediscovered.

## Complete replay

The replay recomposes the current baseline from stored canonical fields. It
does not compare the candidate to the historical stored title: nine of 150
stored titles predate later verified Composer fixes and are recorded as
historical baseline drift.

| Measure | Result |
|---|---:|
| Cards | 150 |
| Current baseline macro F1 | 0.7746130350 |
| Candidate macro F1 | 0.7746130350 |
| Delta | 0 |
| Wins / losses / ties | 0 / 0 / 150 |
| Changed cards | 1 |
| Semantic reference-loss cards | 0 |
| Numeric semantic-error cards | 0 |
| Subject-drift cards | 0 |
| Titles over 80 characters | 0 |
| Historical baseline-drift cards | 9 |

The diagnostic label-reading oracle is restricted to candidates that already
pass the semantic, bracket, and numeric guards. Its delta is also `0`, with
`0 / 0 / 150` signs. The unconstrained search frontier contained 27 unsafe
candidates; they are counted for diagnosis but are never offered to the oracle
or selector.

## Evidence and reproduction

The tracked manifest
`docs/evaluation/typed-pareto-composer-v1-evidence-manifest-2026-08-08.json`
pins the external paid corpus, selected arm, row count, and SHA-256. The corpus
is intentionally not copied into the Production checkout.

By default the replay resolves the sibling `lynca-thin-path` checkout. Set
`LYNCA_TYPED_PARETO_SOURCE_CHECKOUT` or pass `--input ... --sha256 ...` when
the paid corpus lives elsewhere.

```bash
node scripts/typed-pareto-composer-v1.test.mjs
node scripts/replay-typed-pareto-composer-v1.mjs \
  --out artifacts/typed-pareto-composer-v1/replay-150.json
```

Expected replay SHA-256:
`e9f749d73df0154a95515f81103b9c54d72c11310415d1b84e774ec243aca2a6`.

The output belongs under ignored `artifacts/`; the manifest, decision, code,
and tests are the durable repository record.
