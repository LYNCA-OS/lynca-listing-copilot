# Field-specific observation v2 — paid 105-card screen (2026-08-02)

## Decision

The same-call lane is a **capture-positive, resolver-unproven** asset. It
captured 25 typed candidate rows on 23/105 cards while leaving CSM fields and
final-title authority untouched. It is not a production change, and the raw
paired title score must not be interpreted as the lane's causal accuracy: the
control and treatment are separate model responses, so the model can change
canonical fields even when the observation array is ignored.

## Paid contract

- Cohort: the complete 105-card outside-development holdout; no new 150-card
  purchase was made.
- Model: `gpt-5.6-luna`, reasoning `none`, image detail `high`.
- Arms: `thin_canonical_high` versus
  `thin_canonical_field_observation_v2_high`.
- Storage: Singapore Supabase project `irpgnhkslrsiucybkufc`; the stopped
  Sydney project was not used.
- Calls: 210 successful provider calls, with durable resume after transient
  transport failures. No Cloud Run, OCR, vector or second model call.

## What the model actually expressed

| Observation role | Rows | Cards | Typical evidence | Causal interpretation |
| --- | ---: | ---: | --- | --- |
| `identity_phrase` | 14 | 13 | slab/back product and set phrases | useful evidence, but several rows are compressed slab shorthand or boilerplate |
| `finish_phrase` | 3 | 3 | `ORANGE WAVE`, `GREEN GEO`, `BLACK PANDORA` shorthand | potentially useful for finish resolver, not safe to admit as-is |
| `exact_code` | 8 | 8 | `05/50`, `No. 10`, `8 OF 15 JB` | only a pure fraction can enter a same-value serial gate; the rest are checklist-like codes or unrelated back text |
| **Total** | **25** | **23** | all `printed_text` | candidate-only until typed resolution |

18/25 candidates share at least one token with the reviewed title. This is a
diagnostic overlap count, not a promotion metric: 7 candidates have no such
overlap, and title references are not available to runtime resolution.

## Downstream and cost measurements

| Metric | Canonical control | Observation arm | Difference |
| --- | ---: | ---: | ---: |
| Macro F1 | 0.78235 | 0.77860 | -0.00375 (confounded by independent responses) |
| Median input tokens | 5,402 | 5,663 | +4.8% |
| Median output tokens | 107 | 167 | +56.1% |
| Median latency | 5,763 ms | 6,712 ms | +949 ms |
| Median title length | 63 | 59 | — |

The treatment's 23 wins / 25 losses / 57 ties (`p=0.885`) is a non-causal
paired final-title screen, not evidence that the lane is negative. No
resolver was applied, so the experiment answered only whether the model will
use the extra capacity to emit typed evidence.

## Contract audit

- 105/105 canonical field objects were unchanged by parsing the added array.
- 25/25 candidate rows carry `authority=candidate_only` and all three
  automatic-authority flags are false.
- 105/105 rows reparse to the same candidate count; no schema defects.
- No candidate was sent to CSM, Composer, persistence, or Production.

## Next bounded action

Do not buy another paid arm for this schema yet. First run a zero-cost
resolver replay over these 25 rows with three fail-closed rules:

1. accept only a pure `numerator/denominator` exact-code candidate for a
   same-value serial-format repair;
2. require complete, non-boilerplate identity phrases before proposing a typed
   Product/Set/Card Name candidate;
3. require a controlled finish vocabulary and preserve the source phrase as
   provenance; no abbreviation expansion or numeric mutation.

If that replay cannot show at least eight wins with zero losses and zero
reference-token displacement, the observation lane remains a useful evidence
side-channel but is not a positive accuracy mechanism. The next large head is
then the additive bottom-band visual arm, separately measured on the same
105-card budget.

Full per-card evidence, candidate text, role, region, token-overlap diagnostic,
latency, and integrity rows are in
[`analysis.json`](../../artifacts/accuracy-field-observation-v2-105-2026-08-02/analysis.json).
