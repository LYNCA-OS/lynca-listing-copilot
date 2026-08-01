# Accuracy gated projection rerun — 2026-08-02

This is a zero-provider-cost replay over the existing paired 150-card
checkpoint. It was rerun after the production merge to catch script/data drift;
it does not add a new card cohort and it does not change the production path.

Artifact: `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/gated-projection-screen-rerun-2026-08-02.json`.

Reproduction (no API key and no provider call):

```sh
node scripts/analyze-accuracy-150-gated-projections.mjs \
  --input artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl \
  --exhaustive artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl \
  --out artifacts/accuracy-bundle-confirmatory-150-2026-08-02/gated-projection-screen-rerun-2026-08-02.json \
  --limit 150
```

## Result

The baseline is canonical high, macro F1 `0.7669266`. A mechanism is retained
as a replay candidate only when it has no per-card loss, no reference-token
loss, and no title over 80 characters.

| Mechanism | Changed | Wins | Losses | Ties | Δ macro F1 | Decision |
|---|---:|---:|---:|---:|---:|---|
| Finish family + compatible colour | 2 | 2 | 0 | 148 | +0.000936 | candidate |
| Single-digit serial zero restoration | 2 | 2 | 0 | 148 | +0.001027 | candidate |
| `SAR` only | 1 | 1 | 0 | 149 | +0.000246 | candidate |
| `Trainer Gallery` marker | 1 | 1 | 0 | 149 | +0.000963 | candidate |
| `1st Bowman` marker | 1 | 1 | 0 | 149 | +0.000386 | candidate |
| Known-manufacturer Product extension | 2 | 2 | 0 | 148 | +0.001377 | candidate |
| All six narrow overlays | 8 | 8 | 0 | 142 | +0.004727 | candidate |

The strongest changes are still the same eight cards already visible in the
replay ledger: Dalton Rushing (Orange Refractor), Brayden Burries (Blue Wave
and 1st Bowman), Justin Herbert and Kobe Bryant (leading-zero serial),
Eternatus (Trainer Gallery), Mega Absol (SAR), and the two VeeFriends product
extensions. The rerun produces the identical counts and deltas as the prior
artifact.

## Explicit stops

These broad overlays are not safe even though some cards improve: empty Product
(`1 win / 1 loss`), generic Product extension (`2 / 1`), short Card Name
(`1 / 3`), component RC (`3 / 19`), `SSP` (`2 / 3`), and `SP` (`0 / 4`). They
remain stopped rather than being folded into the positive bundle.

## Gate

All rows remain `authority: evaluation_only`. The existing development and
mixed cohorts are not an independent 150-card confirmation. No overlay is
imported into the production CSM route until a fresh, non-overlapping 150-card
pool with sealed references is available.
