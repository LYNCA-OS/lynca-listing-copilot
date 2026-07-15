# Retrieval ON/OFF 100-Card Paired Evaluation

Date: 2026-07-15  
GitHub Actions run: [29407791641](https://github.com/LYNCA-OS/lynca-listing-copilot/actions/runs/29407791641)  
Production SHA: `a80421add0582798cd229434938f23f3c9d3f6f0`  
Model: `gpt-5-mini` / `gpt-5-mini-2025-08-07`  
Concurrency: 2

## Experiment Contract

- Same sealed 100-card cohort in both arms.
- Same production deployment, model, prompt core, and concurrency.
- Retrieval OFF disables catalog, vector, external candidates, and retrieval application.
- Retrieval ON enables catalog, vector, and Retrieval Application Layer.
- Corrected titles were not sent to the cloud.
- Accuracy evidence is `REVIEWED_TITLE_DERIVED_SEM_PROXY`, not manually reviewed field-level Ground Truth. It is valid for relative ON/OFF diagnosis, not the formal 87% SEM launch gate.

The original run had one schema failure in each arm after three attempts because the model emitted unknown `field_evidence` keys. Only those two cards were retried. Both recovered. The completed reports include retry wall time; failed schema responses did not expose token usage and remain unmetered.

## Executive Result

| Metric | Retrieval OFF | Retrieval ON | Delta |
| --- | ---: | ---: | ---: |
| Technical success | 100/100 | 100/100 | 0 |
| Title-derived SEM field proxy | 335/627 (53.43%) | 334/627 (53.27%) | -0.16 pp |
| Critical-field proxy | 168/306 (54.90%) | 170/306 (55.56%) | +0.65 pp |
| Throughput | 4.96 cards/min | 2.80 cards/min | -43.5% |
| Per-card p50 | 17.67 s | 35.64 s | +101.7% |
| Per-card p95 | 29.09 s | 51.06 s | +75.5% |
| Metered tokens | 1,004,065 | 1,007,343 | +3,278 |

Decision: full synchronous Retrieval ON is not production-default eligible. It does not improve the overall field proxy and nearly doubles median latency. Retrieval should remain available behind anchor/lazy routing and deterministic field application.

## Field Effects

| Field | OFF | ON | Delta |
| --- | ---: | ---: | ---: |
| Card Name (n=24) | 29.17% | 58.33% | +29.17 pp |
| Product (n=100) | 46.00% | 53.00% | +7.00 pp |
| Print Finish (n=36) | 58.33% | 63.89% | +5.56 pp |
| Year (n=100) | 74.00% | 74.00% | 0 |
| Grade (n=28) | 67.86% | 67.86% | 0 |
| Numerical Rarity (n=47) | 63.83% | 61.70% | -2.13 pp |
| Subject (n=95) | 54.74% | 48.42% | -6.32 pp |
| Manufacturer (n=95) | 90.53% | 80.00% | -10.53 pp |

`Set` and `Card Number` had no evaluable denominator in the title-derived SEM proxy. `ip_sport` is also excluded from interpretation because the current parser/output shape produced an artificial 0/100 in both arms.

## Retrieval Application Funnel

- Retrieved candidates: 711
- Eligible candidates: 367
- Field decision rows: 4,685
- Resolver evidence rows: 478
- Cards with selected candidate: 57
- Cards with APPLY decision: 12
- Cards with resolved change: 9
- Actual applied fields: 13, all from catalog
- Titles changed by actual application: 8
- Correct candidate fields not applied: 26
- Wrong candidate fields applied: 0

The safety policy prevented wrong candidate application, but participation is still inefficient. Arm titles differed on 91 cards while actual retrieval application changed only 8 titles. Most variation came from candidate context changing model behavior, not from controlled field application.

Correct-but-not-applied fields:

- Product: 13
- Year: 6
- Print Finish: 5
- Manufacturer: 1
- Card Name: 1

Main blocking/rejection causes:

- `post_observation_evidence_conflict_blocked`: 2,310
- `post_observation_anchor_filter_blocked`: 1,528
- `candidate_not_selected`: 162
- `field_not_in_safe_application_plan`: 143
- `unsafe_replacement_blocked`: 34
- `support_only_cannot_fill_or_replace`: 13

## Required Architecture Change

1. Keep catalog/vector retrieval, but do not synchronously inject broad candidate context into every GPT request.
2. Route retrieval by exact anchor or unresolved identity field; otherwise use the faster OFF path.
3. Apply high-trust `product` and `card_name` evidence deterministically after field-level compatibility checks.
4. Do not let retrieval context rewrite `subject` or `manufacturer` without direct image/printed-text agreement.
5. Continue blocking instance fields such as serial numerator, grade, and cert from reference candidates.

This targets the observed positive fields while removing the latency and context-drift regressions.
