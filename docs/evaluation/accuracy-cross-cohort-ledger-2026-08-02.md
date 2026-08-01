# Accuracy mechanism cross-cohort ledger — 2026-08-02

This ledger separates measured evidence from promotion authority. Every row is
an offline replay or a fresh provider result; no row by itself changes the
production CSM/SEM path. The production checkout remains on the canonical thin
path until an independent 150-card confirmation clears the stated safety gates.

## Evidence table

| Cohort and source | Mechanism | n | Wins | Losses | Ties | Delta macro F1 | Reference loss | Over 80 | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Fresh outside-development subset, paired response | Known-manufacturer product extension | 105 | 5 | 0 | 100 | +0.003419 | 0 | 0 | Confirmation candidate; not a full independent 150 |
| Fresh mixed 150, paired response | Known-manufacturer product extension | 150 | 6 | 0 | 144 | +0.002826 | 0 | 0 | Confirmation candidate; cohort mix is documented |
| Development v4 candidate facts, team-veto replay | Open identity expression | 150 | 4 | 0 | 146 | +0.002187 | 0 | 0 | Evaluation-only; development overlap |
| Existing paired 150 replay | Identity v3 + product v2 + narrow serial | 150 | 8 | 0 | 142 | +0.004777 | 0 | 0 | Evaluation-only bundle; requires independent 150 |

The outside-development subset is the strongest evidence for the narrow
product extension because it uses fresh provider responses outside the
development asset set. It is still only 105 cards, so it cannot satisfy the
150-card promotion gate by itself. The mixed 150 result is supportive but not a
clean independent cohort and is therefore recorded separately rather than
used to inflate the claim.

## Decision boundary

1. Keep the production route unchanged: one Luna call, CSM/SEM admission, and
   deterministic Composer.
2. Keep open identity expression and the combined bundle evaluation-only.
3. Pre-register one independent 150-card confirmation for the narrow product
   extension and any other mechanism that remains positive after replay.
4. Reject promotion if any card loses a reference token, any title exceeds 80
   characters, or the field-level ledger has a negative critical loss. A
   positive aggregate without these gates is insufficient.

The paid run and all replay artifacts remain append-only under
artifacts/accuracy-mechanism-confirmatory-2026-08-02/ and
artifacts/extreme-observation-2026-08-02/. No cloud service, vector store,
OCR sidecar, or second model call is part of this evidence.

## Next lowest-cost experiment

Before spending another 150 provider calls, run the candidate Composer and
SEM recovery mechanisms against the already-paid 150-card replay. Keep only a
small bundle with zero reference-token loss, zero over-budget titles, and no
negative changed-card ledger. If replay cannot distinguish the candidates,
hold them and test the accumulated batch once on a fresh 150-card cohort.
