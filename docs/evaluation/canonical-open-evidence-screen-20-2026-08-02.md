# Canonical open-evidence screen (20 cards, 2026-08-02)

## Decision

Stop this arm before the 150-card gate. It is a useful capture experiment,
but not a positive runtime asset: the raw title lift was not significant, the
response became much larger and slower, and the strict product-only resolver
introduced three reference-token losses. Nothing was wired to production.

## Paid paired screen

Both arms used the same 20 outside-development cards, GPT-5.6 Luna, reasoning
`none`, high image detail, and local concurrency 2.

| Arm | F1 | Recall | Precision | Median latency | Median input | Median output | Total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Canonical high | 0.8172 | 0.8020 | 0.8629 | 5.887 s | 5,349 | 104 | 104,934 |
| Canonical + open evidence | 0.8249 | 0.8051 | 0.8716 | 9.301 s | 5,708 | 460 | 118,720 |

The raw paired delta was `+0.0076`, with 5 treatment wins, 3 control wins and
12 ties (`p=0.7266`). The evidence arm increased median latency by 58% and
total tokens by 13.1%; output tokens were 4.4 times higher. This is not a
cost-free expression increment.

## Resolver replay

The only resolver tested was deliberately narrow: a candidate had to be visible
(`exact_text`, `stamped_text`, or `logo_or_symbol`), certain, image-anchored,
and a strict extension of the canonical manufacturer/product. It could not
overwrite a conflicting value or use model knowledge.

| Metric | Result |
| --- | ---: |
| Replay F1 delta | +0.0072 |
| Wins / losses / ties | 5 / 3 / 12 |
| Candidate product cards | 1 |
| Reference-loss cards | 3 |
| Titles over 80 chars | 0 |
| Mean open facts/card | 9.25 |
| Candidate-defect cards | 0 |

The three losses were not caused by product promotion alone: the open arm's
canonical fields themselves changed unrelated identity/finish choices. The
ledger also retained noise such as biography/statistic text and a wrong
stamped number, showing that “open” does not by itself mean “useful”.

## Interpretation

This validates the learning direction only as an observation asset. It does
not validate this response shape as a production request: the extra schema
made the call materially slower and larger while the deterministic projection
had too little supported product evidence. Keep the artifacts for diagnosis,
but do not spend the independent 150-card gate on this version. The next
experiment must reduce evidence payload and isolate one known loss family
before reopening a paid confirmation.

Artifacts:

- `artifacts/canonical-open-evidence-screen-20-2026-08-02/`
- `lib/listing/thin/canonical-open-evidence-v1.mjs`
- `scripts/replay-canonical-open-evidence-v1.mjs`
