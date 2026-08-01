# Open expression v4 rerun — 2026-08-02

This report is a zero-provider-cost analysis of the already-paid
`development-150-merged-2026-08-02.jsonl` checkpoint. It measures the open
expression channel before CSM/SEM admission; its expression F1 must not be
confused with the final marketplace-title F1.

Artifact: `artifacts/candidate-expression-v4/expression-v4-merged-150-report-rerun-2026-08-02.json`.

## What the model actually expressed

| Measure | Result |
|---|---:|
| Cards | 150 |
| Cards with candidate hypotheses | 147 |
| Cards with model-knowledge hypotheses | 8 |
| Cards with candidate defects | 15 |
| Raw expression macro F1 | 0.54035 |
| Best single-hypothesis macro F1 | 0.55946 |
| Median output tokens | 398 |
| Median total tokens | 4,266 |
| Median latency | 66,194 ms |
| P95 latency | 330,606 ms |

The useful evidence is mostly literal: 709 `exact_text` facts, 518
`stamped_text` facts and 221 `logo_or_symbol` facts. Only 8 cards used a
`model_knowledge` hypothesis. This is evidence for keeping expression open,
but it is not evidence for globally adding a world-knowledge call.

The largest reference misses in this channel are still `auto` (49),
`refractor` (34), `PSA` (30), `RC` (19), `gold` (13), `SSP` (13), `red` (12),
and `blue` (8). These are exactly the fields that need CSM/SEM typed admission;
the raw expression itself is not a publishable title.

## Decision

Global v4 expression is a **cost/latency negative** production strategy: the
median is roughly an order of magnitude slower than the canonical high arm and
the P95 is a long-tail failure mode. Keep the expression channel as an
evaluation/capture lane and admit only narrow, source-grounded candidates after
CSM/SEM filtering. Do not add it as a second production call or use its raw
hypotheses directly.
