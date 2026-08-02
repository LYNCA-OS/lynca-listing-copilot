# Printed Refractor exactness replay — 2026-08-02

## Decision

Keep `printed_refractor_exact` as an evaluation-only candidate. Do not import
it into production CSM/SEM and do not call this an independent confirmation.

The candidate is deliberately narrower than the first ad-hoc finish test. It
only acts when all of these are true:

- the canonical family is exactly `Refractor`;
- `parallel_exact` is empty;
- the current display is exactly `${surface_color} Refractor`;
- an already-paid exhaustive observation is high-confidence printed text,
  labelled `parallel`, `parallel_label`, or `finish`, whose exact value is
  `REFRACTOR` or `REFRACTORS`.

It then sets `parallel_exact` to `Refractor`. This lets the Composer prefer the
printed family over a model-inferred colour. Richer printed names such as
`100-Year Diamond Refractor` and `Violet Speckle Refractors` are not touched.

## Paired replay result

The replay uses the same 150-card paid canonical + exhaustive checkpoint as the
v4 interaction bundle. It is a zero-cost replay, not a new provider call.

| Comparison | Baseline F1 | Candidate F1 | Delta | Wins / losses / ties | Changed cards | Reference-loss cards | Over 80 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Canonical → v4 + exact Refractor | 0.766927 | 0.775143 | **+0.008216** | **15 / 0 / 135** | 15 | 0 | 0 |
| v4 → v4 + exact Refractor (incremental) | 0.774373 | 0.775143 | **+0.000770** | **2 / 0 / 148** | 2 | 0 | 0 |

The full candidate made 37 field actions. The new mechanism made two actions,
both wins:

| Asset | Reference | Before | After | Delta F1 |
|---|---|---|---|---:|
| `reviewed_blind_e0ee4e7070fe806e72b5` | `2025 Topps Chrome Tyler Booker Rookie Refractor RC` | `2025 Topps Chrome Tyler Booker Silver Refractor RC` | `2025 Topps Chrome Tyler Booker Refractor RC` | +0.058333 |
| `reviewed_blind_59c73afe530cf56006c3` | `2025 Bowman Draft Konnor Griffin Chrome Refractor` | `2025 Topps Bowman Chrome Konnor Griffin Silver Refractor` | `2025 Topps Bowman Chrome Konnor Griffin Refractor` | +0.057143 |

There were no reference-token losses and no length violations. The result is
still development-pool evidence; the required next gate remains a fresh,
label-blind 150-card paired confirmation before any authority change.

## Reproduction

```sh
npm run check:thin-path
npm run test:thin-path
node scripts/replay-accuracy-bundle-v4.mjs \
  --out artifacts/extreme-observation-2026-08-02/accuracy-bundle-v4-printed-refractor-exact-replay-150.json
```

Artifact:
`artifacts/extreme-observation-2026-08-02/accuracy-bundle-v4-printed-refractor-exact-replay-150.json`
