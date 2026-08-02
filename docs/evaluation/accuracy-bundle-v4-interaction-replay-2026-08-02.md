# Identity plus narrow SEM recovery interaction replay — 2026-08-02

## Decision

Keep this interaction bundle as an evaluation candidate. Do not import it into
production CSM/SEM yet. It is a zero-cost replay over the already-paid
canonical and exhaustive checkpoints, not a new provider result and not an
independent-card confirmation.

## Composition

The replay applies two layers in a fixed order:

1. `candidate_identity_replay_v3`: fill an empty Set only from a visible logo /
   symbol fact, with measured team, rights, sponsor, grader, boilerplate and
   product-fragment vetoes;
2. `accuracy_mechanism_bundle_v3`: the eight existing narrow overlays for
   finish, single-digit serial, SAR, Trainer Gallery, 1st Bowman, guarded
   product extension, attested insert, and exact TCG IP logo.

No model-knowledge fact becomes a field value. The result remains explicitly
`authority: evaluation_only` and `production_promoted: false`.

## Paired replay result

| Cards | Baseline F1 | Candidate F1 | Delta | Wins / losses / ties | Changed cards | Reference-loss cards | Over 80 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 150 | 0.766927 | 0.774373 | **+0.007446** | **13 / 0 / 137** | 13 | 0 | 0 |

The candidate made 35 field actions. Every changed card improved the paired F1
score; there were no reference-token losses and no budget violations. The
identity layer contributed five safe Set recoveries, while the existing narrow
overlays supplied the remaining eight changed-card wins. One card received two
independent safe overlays (Disney Set plus exact Disney IP), but it was scored
once at the final title to avoid double-counting.

## Boundary

This is stronger than the earlier separate replays because it checks that the
two positive layers do not conflict when composed. It is still drawn from the
same reviewed/mixed development pool and uses already-paid observation output.
The required next step is one new label-blind 150-card paired confirmation,
with the same hard stops:

- any reference-helpful token loss;
- any title over 80 characters;
- any negative critical field ledger;
- no positive paired result after per-card attribution.

Until that cohort exists, production stays on the deployed canonical thin path.

## Reproduction

```sh
npm run check:thin-path
npm run test:thin-path
node scripts/replay-accuracy-bundle-v4.mjs
```

Artifact:
`artifacts/extreme-observation-2026-08-02/accuracy-bundle-v4-interaction-replay-150.json`
