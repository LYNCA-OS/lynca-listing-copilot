# Safe accuracy bundle screen — 2026-08-02

## Decision

Keep bundle v3 in the evaluation lane. Do not change production or spend a
new paid run from this replay alone.

The bundle contains six narrow, sequential overlays over the already-paid
canonical result:

1. colour-anchored finish-family recovery;
2. single-digit serial leading-zero recovery;
3. exact `SAR` rarity recovery;
4. printed `Trainer Gallery` recovery for TCG;
5. printed `1st Bowman` recovery when the canonical product/set is Bowman;
6. high-confidence, registry-attested insert-name recovery.

None replaces a non-empty canonical field. The last mechanism requires a
high-confidence printed-text observation, an `insert_name` label, and a
matching insert entry in the local knowledge registry. The bundle is
evaluation-only and is not imported by the production path.

## Zero-cost paired replay

The replay used the existing 150-card paid checkpoint at GPT-5.6 Luna,
reasoning `none`, image detail `high`, plus the existing exhaustive observation
checkpoint. No provider call, Cloud Run call, vector lookup, or OCR call was
made.

| Arm | Cards | Macro F1 | Wins / losses / ties | Changed cards | Reference-loss cards | Over 80 | Decision |
|---|---:|---:|---:|---:|---:|---:|---|
| Current canonical Composer | 150 | 0.766927 | — | — | — | — | baseline |
| Bundle v3 replay | 150 | 0.770623 | 7 / 0 / 143 | 8 | 0 | 0 | replay candidate |

The paired delta is `+0.0036965`. This is a replay projection, not an
independent accuracy claim: the candidate mechanisms were selected after
inspecting this same labelled checkpoint.

### Per-mechanism ledger

| Mechanism | Δ macro F1 | Wins / losses / ties | Changed | Reference loss | Over 80 |
|---|---:|---:|---:|---:|---:|
| finish family / colour | +0.0009360 | 2 / 0 / 148 | 2 | 0 | 0 |
| serial single digit | +0.0010272 | 2 / 0 / 148 | 2 | 0 | 0 |
| `SAR` | +0.0002463 | 1 / 0 / 149 | 1 | 0 | 0 |
| `Trainer Gallery` | +0.0009630 | 1 / 0 / 149 | 1 | 0 | 0 |
| `1st Bowman` | +0.0003865 | 1 / 0 / 149 | 1 | 0 | 0 |
| attested insert | +0.0003463 | 1 / 0 / 149 | 1 | 0 | 0 |

The eight changed cards are retained in the machine-readable ledger. One
attested insert changed a field without changing the final title; it is still
counted as a field-level action but contributes a tie.

## Outside-development replay

The source blind pool has only 255 cards. The existing development cohort
already consumes 150, leaving 105 cards outside it; a mixed 150 that reuses 45
development cards cannot be called an independent 150. The same bundle was
therefore replayed on all 105 outside-development cards at zero provider cost.
That result is a cross-cohort stability check, not a substitute for acquiring
45 new sealed cards.

The 105-card ledger is generated with:

```sh
node scripts/replay-accuracy-safe-bundle-150.mjs \
  --limit 105 \
  --asset-ids-file artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105.asset-ids.json \
  --out artifacts/accuracy-bundle-confirmatory-150-2026-08-02/safe-bundle-replay-outside-105.json
```

This partial replay produced no net title change (`ΔF1 = 0`, 0 wins, 0
losses, 105 ties). It is marked `PARTIAL_REPLAY` because the exhaustive
observation channel is absent for these outside-development cards, so the
attested-insert mechanism was not actually tested. The result is therefore a
neutral stability check, not evidence for promotion. It also caught and
removed the v1 finish rule's serial-denominator false positive; bundle v3 now
inherits the v2 compatibility gate.

## Promotion gate

The result earns a place in the next 5–8-mechanism confirmation pool, not a
production promotion. The next gate is a fresh independent 150-card paired
confirmation, with these hard stops:

- any reference-helpful token lost;
- any title over 80 characters;
- any negative card-level F1 delta attributable to the bundle;
- any failure to preserve CSM/SEM canonical authority and replay provenance.

Replay source and output:

- `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl`
- `artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl`
- `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/safe-bundle-replay-150-2026-08-02.json`
