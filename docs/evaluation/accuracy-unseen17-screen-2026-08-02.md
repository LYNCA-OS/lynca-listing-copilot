# Unseen-product screen — 2026-08-02

This is a small cross-distribution screen, not the independent-150 gate. The
source is the existing 17-card `unseen_product_benchmark`: local original
images, no overlap with the 255-card reviewed blind pool, and sealed
manufacturer-checklist titles. The cards are concentrated in 2023–2025 Panini
Phoenix/Prizm football and soccer, so the result is not a marketplace-wide
accuracy claim.

## Paid paired response

| Arm | Cards | Macro F1 | Recall | Precision | Median latency | Median output tokens |
|---|---:|---:|---:|---:|---:|---:|
| `thin_budgeted` | 17 | 0.4610 | 0.5462 | 0.4042 | 3,898 ms | 22 |
| `thin_canonical` | 17 | 0.4421 | 0.3385 | 0.6990 | 4,177 ms | 91 |

Paired comparison was 7 canonical wins / 7 budgeted wins / 3 ties,
`ΔF1 = -0.0189`, exact sign-test `p = 1.00`. Canonical is more precise but
misses too much identity on this low-resolution/single-image cohort; this is
not evidence to change the production arm.

## Product-extension replay

The guarded known-manufacturer product extension was replayed through the
production-base Composer (`product_leaf_recovery` disabled): 1 win / 0 losses /
16 ties, `ΔF1 = +0.000566`, zero reference-token loss and zero over-80 titles.
The sample is too small and too concentrated to promote the mechanism; it is
supportive only. The stronger current evidence remains the fresh external-105
screen (`5/0/100`, `ΔF1 = +0.003419`).

The full paid checkpoint is preserved at
`artifacts/accuracy-unseen17-thin-canonical-2026-08-02/`. Local image data URLs
are an evaluation-only input mode in `scripts/run-thin-path-eval.mjs`; the
production route still uses Supabase signed image URLs.
