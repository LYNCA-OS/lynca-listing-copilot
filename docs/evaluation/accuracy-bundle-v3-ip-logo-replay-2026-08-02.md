# Exact TCG IP logo recovery replay — 2026-08-02

## Decision

Keep `tcg_ip_logo_exact` in the evaluation-only 5–8 mechanism pool. Do not
import it into production or spend a new paid run from this replay alone.

This is an eighth, narrow overlay over the existing v3 bundle. It can write
`ip` only when all of these are already true:

- canonical `grammar` is already `tcg`;
- canonical `ip` is empty;
- exhaustive evidence contains a high-confidence `printed_text` observation
  labelled `logo`;
- the exact observed value is `DISNEY` or `DISNEY LORCANA`.

It never changes grammar, never infers VeeFriends/Star Wars from a broad
keyword, and never replaces a non-empty canonical field. The implementation is
evaluation-only and is not imported by the production thin path.

## Zero-cost paired replay

The replay reused the already-paid 150-card canonical checkpoint and the
already-paid exhaustive observation checkpoint. No provider, Cloud Run, vector,
or OCR call was made.

| Arm | Cards | Macro F1 | Wins / losses / ties | Changed cards | Field actions | Reference-loss cards | Over 80 | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Existing v3 bundle | 150 | 0.766927 | 9 / 0 / 141 | 25 | 28 | 0 | 0 | baseline |
| v3 + exact TCG IP logo | 150 | 0.773007 | 11 / 0 / 139 | 27 | 30 | 0 | 0 | replay candidate |

The incremental delta over the unchanged Composer is `+0.0060805`. The IP
mechanism itself changed exactly two cards, both by adding the missing `Disney`
token, with no reference-token loss and no title over 80 characters:

- `2026 Topps Chrome Disney Elsa Blue Sparkle Refractor 025/150`: F1
  `0.666667 → 0.736842`;
- `2026 Topps Chrome Disney Mufasa Dalmatian Refractor 004/101`: F1
  `0.625000 → 0.705882`.

The per-mechanism replay ledger reports `2 / 0 / 148`, Δ macro F1
`+0.0010071`, two `ip` field actions, zero reference-loss cards, and zero
over-80 titles. This is a paired replay selected from the same labelled
checkpoint, not an independent accuracy claim.

## Promotion gate

Keep the candidate with the existing bundle, but require a fresh independent
150-card, label-blind confirmation before any production consideration. Stop
on any reference-helpful token loss, over-80 title, negative card-level delta,
or grammar mutation. The current blind source pool has only 105 cards outside
the development cohort, so it cannot satisfy that gate.

Replay artifact:

`artifacts/extreme-observation-2026-08-02/accuracy-bundle-v3-ip-logo-replay-150.json`
