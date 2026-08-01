# Zero-cost replay of small accuracy mechanisms — 2026-08-02

## Decision

This is a replay ledger, not a new model run. It pairs the already-paid
`thin_canonical_high` 150-card checkpoint with the already-paid
`exhaustive_observation_high` checkpoint and applies deterministic resolvers
after the fact. No provider, storage, OCR, vector, Cloud Run, or production
path was touched.

Keep two mechanisms as **evaluation candidates**:

1. same-value single-digit serial formatting (`5/20 → 05/20`, `8/25 → 08/25`);
2. an empty `card_name` may receive a high-confidence printed `insert_name` only
   when the existing local knowledge registry attests the phrase.

The combined replay is directionally positive, but it is still the same
reviewed/mixed pool and cannot replace an independent label-blind 150-card
confirmation.

## Paired replay result

| Mechanism | Changed cards | Wins | Losses | Ties | Δ macro F1 | Safety | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Single-digit serial only | 2 | 2 | 0 | 148 | +0.001027 | no reference loss, no title >80 | candidate |
| Registry-attested insert only | 2 | 1 | 0 | 149 | +0.000346 | no reference loss, no title >80 | candidate |
| Serial + registry-attested insert | 4 | 3 | 0 | 147 | +0.001373 | no reference loss, no title >80 | candidate |
| Exact language observation | 0 | 0 | 0 | 150 | 0 | no changes | neutral |
| Printed Set → Set | 8 | 1 | 4 | 145 | −0.001535 | four reference-loss cards | **STOP** |

The result is a prioritisation signal only. The positive rows are not
independent evidence and are not production authority.

## Changed-card audit

The registry insert resolver changed only two cards. One was a real gain:

- `Kaboom Horizontal` was printed on the card and was added to an empty
  `card_name`, recovering the reference identity tokens.

The other was a tie because `Downtown` was already present in the title. The
serial resolver changed only the two single-digit leading-zero cases and never
changed the numeric pair.

The rejected printed-Set rule demonstrates why a broad “more text is better”
resolver is unsafe: it inserted `The Phantom Menace`, `Disney100 Chrome`, and
other longer phrases, displacing useful manufacturer, product, or finish
tokens under the 80-character contract.

## Reproducibility

```sh
node scripts/analyze-accuracy-replay-candidates.mjs
```

Output:

`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/replay-candidate-mechanisms.json`

Next gate: pre-register these two candidates with the other independently
positive zero-call mechanisms, then run one genuinely independent 150-card
paired confirmation. Until that cohort exists, leave production on the
deployed canonical route.
