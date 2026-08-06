# Canonical output cap latency screen (20 cards, 2026-08-02)

## Decision

Do not change the production canonical request's `max_output_tokens` from
4096. The 512-token candidate was not a positive asset: it was slower in this
paired screen and had no measurable accuracy advantage. The evaluation arm was
removed after the screen; no production code was changed.

## Paired result

The same 20 outside-development assets were alternated at local concurrency 2
using `gpt-5.6-luna`, reasoning `none`, image detail `high`.

| Arm | F1 | Recall | Precision | Median latency | Median input | Median output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| canonical, 4096 cap | 0.8162 | 0.7921 | 0.8660 | 4.275 s | 5,349 | 105 |
| canonical, 512 cap | 0.8171 | 0.7999 | 0.8602 | 5.626 s | 5,349 | 106 |

Paired delta was `+0.0009` F1: 512 won 4 cards, 4096 won 3, and 13 tied
(`p=1.00`). The 512 cap was approximately 31.6% slower by median latency.
Both arms used the same 5,349-token median input and about 105 output tokens,
so this is not an output-length or input-size recovery.

## Interpretation

The result is a negative screen, not proof that output limits can never affect
latency. It does rule out this particular 512-token cap as a cost-free tail
fix for the current canonical prompt. Keep the single-call CSM/SEM path and
look for the long tail at the provider/network or durable admission boundary,
using the deployed stage receipt rather than another blind request-parameter
change.
