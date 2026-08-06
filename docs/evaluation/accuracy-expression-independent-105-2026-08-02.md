# Expression bridge: independent confirmation (105 cards, 2026-08-02)

## Decision

Keep `accuracy-expression-overlay-v1` evaluation-only. The independent cohort
is positive after the evidence gate, but it is not a production promotion:
production currently has one paid canonical Luna call and does not emit the
separate free-expression plus exhaustive-observation inputs consumed by this
bridge.

The dataset contains 255 cards: 150 development cards and 105 cards outside
that development cohort. A duplicated or reweighted 150-card result would not
be independent, so this confirmation uses the complete 105-card holdout.

## Paid inputs

- Canonical arm: `thin_canonical_high`, 105 unique holdout assets.
- Expression arm: `thin_budgeted`, the same 105 assets.
- Observation arm: `exhaustive_observation_high`, the same 105 assets.
- All three checkpoints were isolated by output directory and paired by asset
  ID. The replay itself made no provider calls.

The exhaustive arm is diagnostic evidence, not a title candidate: F1 was
`0.1138`, median output was 1,552 tokens, and median latency was 18,922 ms.
Its role here is to provide visible facts that the expression bridge can gate.

## Replay result

The baseline is the canonical high result composed by the deterministic
Composer. The candidate is the same CSM/SEM projection plus the capture-only
overlay, with the identity, insert, finish, product, and serial mechanisms
applied in order.

| Stage | Delta macro F1 | Wins | Losses | Ties | Reference-loss cards | >80 chars |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| identity | +0.002209 | 3 | 0 | 102 | 0 | 0 |
| insert | +0.002209 | 3 | 0 | 102 | 0 | 0 |
| finish | +0.004628 | 6 | 0 | 99 | 0 | 0 |
| product | +0.006617 | 8 | 0 | 97 | 0 | 0 |
| combined | **+0.009503** | **10** | **0** | **95** | **0** | **0** |

Baseline macro F1 was `0.770658`; combined macro F1 was `0.780162`.

## Safety correction

The first replay exposed three identity false positives from medium/low or
sentence-like logo spans. The source-confidence gate removed those. The
remaining single identity loss was a high-confidence back-logo `LEGENDARY`
being treated as a Set; the v3 replay now rejects only a lone `LEGENDARY`
affiliation value while preserving full phrases such as `Legendary
Collection`. The corrected replay has zero losses at every stage.

## Promotion gate

This is a positive, zero-cost replay result, not proof of commercial accuracy.
Do not wire it into the production request path yet. A future promotion needs
the same evidence fields to be present in the production contract, followed by
another isolated holdout confirmation; until then CSM/SEM canonical output and
the deterministic Composer remain authoritative.
