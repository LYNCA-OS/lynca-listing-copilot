# Conditional product evidence screen — STOP (2026-08-02)

## Decision

Stop the conditional `product_evidence` arm. Do not spend the 150-card
confirmation budget and do not add this field to the production canonical
response.

The field was empty on all 20 treatment cards, so the intended expression
channel was never exercised. The treatment still changed unrelated canonical
fields and produced two clear paired losses. This is a failed mechanism, not a
small positive effect that needs more sample size.

## Paired screen

- Cohort: the same fixed 20-card screen used for the earlier free-title arm.
- Control: `thin_canonical_high`.
- Treatment: `thin_canonical_product_evidence_v1_high`.
- Model / effort / detail: GPT-5.6 Luna / `none` / `high`.
- Completed: 20/20 pairs, checkpointed locally.

| Arm | F1 | Recall | Precision | Median latency | Median input | Median output |
|---|---:|---:|---:|---:|---:|---:|
| Canonical high | 0.7847 | 0.7513 | 0.8360 | 4.494s | 5,402 | 104 |
| Product evidence v1 | 0.7766 | 0.7568 | 0.8168 | 5.960s | 5,577 | 117 |

Paired result: treatment wins 2, control wins 3, ties 15, ΔF1 `-0.0081`.
Latency increased 32.7% and output tokens increased 12.5%.

## Per-card evidence audit

`product_evidence` was empty on all 20 treatment rows. Therefore no product
extension, resolver replay, or accuracy recovery can be attributed to this
field. The two treatment losses were:

| Card | Control → treatment | ΔF1 | Cause |
|---|---|---:|---|
| Holger Rune | `Topps Chrome ... Green Refractor` → `Topps Chrome ...` | −0.03096 | treatment dropped finish without providing product evidence |
| Jalen Brunson | `Topps All Kings` → `Topps ... All Kings` | −0.09907 | treatment moved Product into Set and lost the Product token |

Other field drift occurred on cards whose `product_evidence` was also empty;
the treatment schema therefore added cost without adding an executable signal.

## Cleanup boundary

The arm implementation and cohort helper were removed after the screen. This
report and its ignored checkpoint artifacts remain as the audit trail. The
production canonical schema, prompt, Composer, and CSM/SEM authority path are
unchanged.
