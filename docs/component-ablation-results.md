# Recognition component ablation results

Generated 2026-07-27 (Asia/Shanghai). Dataset: sealed `cold20`. All online
measurements used preview deployments, cold-algorithm cache bypass, provider
concurrency 2, and interleaved control/candidate arms. Production was not
changed.

## Decision table

Positive accuracy delta means that removing the component improved the score.
Latency deltas are candidate minus baseline, so a negative value is faster.

| component | flag | accuracy delta | verdict | latency delta | recommendation |
|---|---|---:|---|---:|---|
| Evidence completion | `ENABLE_EVIDENCE_COMPLETION=false` | +0.0415 | IMPROVED (3 paired rounds) | -25.8s per card | Remove after an explicit production decision; this is the strongest result. |
| Post-observation retrieval deadline | `ENABLE_POST_OBSERVATION_RETRIEVAL_DEADLINE=false` | n/a | UNMEASURABLE_FLAG_SHADOWED | n/a | Do not change. Request/provider options overrode the environment flag in both empirical probes. |
| Candidate prompt injection | `DISABLE_CANDIDATE_PROMPT_INJECTION=true` | n/a | UNMEASURABLE_NO_ACTIVE_EFFECT | 0 prompt chars | Do not change. Both probes produced the same 16,673-character prompt and candidate behavior. |
| Retrieval application | `ENABLE_RETRIEVAL_APPLICATION=false` | **-0.0231** | **REGRESSED (3 paired rounds)** | run wall median -17.9s; per-card writer-ready median -2.7s | Keep enabled. The small/noisy speed saving does not justify a measured 2.31-point accuracy loss. |
| Vector assist default | `ENABLE_VECTOR_ASSIST_DEFAULT=false` | n/a | UNMEASURABLE_FLAG_SHADOWED | n/a | Do not run an A/B with the current harness. The cold20 payload explicitly enables vector retrieval, overriding this default. |
| Catalog assist default | `ENABLE_CATALOG_ASSIST_DEFAULT=false` | n/a | UNMEASURABLE_FLAG_SHADOWED | n/a | Do not run an A/B with the current harness. The cold20 payload explicitly enables catalog assist, overriding this default. |
| Fast initial provider prompt | `ENABLE_FAST_INITIAL_PROVIDER_PROMPT=false` | +0.0021 median after 2 paired rounds | NOT_PROVEN; round 3 invalid | **+6.7s provider median; +107.1s run-wall median; +26,567 prompt chars** | Keep the fast prompt. Accuracy did not move reliably, while the full prompt was materially slower and larger. |
| Vector lazy mode | `ENABLE_VECTOR_LAZY_MODE=false` | n/a | UNMEASURABLE_FLAG_SHADOWED | n/a | Do not change. Auth later recovered, but both on/off probes still emitted `vector_lazy_provider_catalog_anchor`; the queue/provider snapshot overrides the deployment flag. |
| Catalog lookup cache | `ENABLE_CATALOG_LOOKUP_CACHE=false` | n/a | UNMEASURABLE_TRACE_MISSING | n/a | Do not guess. Current evaluation traces expose no catalog cache hit/miss signature, so the arms cannot be identified empirically. |
| Listing fast path | `ENABLE_LISTING_FAST_PATH=false` | n/a | UNMEASURABLE_NO_ACTIVE_EFFECT | n/a | Do not run an A/B on cold20. All 20 control rows used `COLD_START_SAFE_DRAFT`; the fast route had zero trigger opportunities. |

## Valid measured results

### Evidence completion

- Baseline median: `0.791021`; candidate median: `0.832475`.
- Delta: `+0.041454`, above the `0.006830` decision threshold.
- End-to-end latency changed from about `53.8s` to `28.0s` per card.
- Raw summary: `artifacts/smoke/paired-eval/evidence-completion.json`.

### Retrieval application

- Baseline scores: `0.802092`, `0.797688`, `0.804634`.
- Candidate scores: `0.772525`, `0.785025`, `0.778954`.
- Median delta: `-0.023138`, beyond the `0.008281` decision threshold.
- Baseline/candidate median run wall: `363.3s / 345.4s`.
- Baseline/candidate median per-card writer-ready: `130.2s / 127.6s`.
- Raw summary: `artifacts/smoke/paired-eval/ablate-retrieval-application-v3.json`.

### Fast initial provider prompt

The first two paired rounds were valid. Their accuracy directions disagreed:

- Round 1: fast `0.808763`, full `0.789179`.
- Round 2: fast `0.788438`, full `0.812159`.
- Two-round median: fast `0.798601`, full `0.800669`; delta `+0.002069` for
  removal, which is not a reliable accuracy change.

The cost signal was consistent and large:

- Provider median: fast `20.4s`, full `27.1s` (`+6.7s`).
- Prompt median: fast `16,673` chars, full `43,240` chars (`+26,567`).
- Run-wall median: fast `327.1s`, full `434.3s` (`+107.1s`).
- The one-card signature probe also moved input tokens from `9,276` to
  `15,504` and provider latency from `18.4s` to `22.4s`.

Round 3 was excluded: only 11/20 control jobs reached writer-ready inside the
poll budget, so the strict denominator gate rejected the round. The valid raw
reports are `ablate-fast-initial-provider-prompt-{baseline,candidate}-r1.json`
and `-r2.json` in `artifacts/smoke/paired-eval/`.

## Evaluation and runtime debt discovered

Two failures had previously allowed invalid conclusions and are now fixed in
the working tree:

1. A paired round is accepted only when all expected rows are cold,
   writer-ready L2 results with exactly one provider call and a finite score.
2. A Job cannot be treated as successfully complete before the corresponding
   writer-ready Session snapshot is durably persisted. Due `RETRYING` jobs are
   also eligible for the existing status-poll self-heal wake.

The remaining operational blocker is not a component result:

- Repeated batches still show a long tail after the first 10-13 cards.
- One fast-prompt round had two preparation calls near `50s`.
- The vector-lazy probe first hit two `503 AUTH_UNAVAILABLE` responses. After
  Auth recovered, both on/off arms still emitted the same lazy-skip signature,
  proving that this deployment flag does not control the measured queue path.

These failures must remain separate from algorithm accuracy. No incomplete
round was scored as zero, no holdout was used, and no production deployment or
catalog/database mutation was performed.

## Final recommendation

The evidence supports two decisions only: remove evidence completion after a
morning production decision, and keep retrieval application enabled. Keep the
fast initial prompt because its accuracy effect is unproven while its speed and
token advantage is direct and repeatable. The other flags need either a
non-shadowed harness, missing trace telemetry, or a trigger cohort before they
can be priced honestly.

## Offline loss audit

The three `vocab17-candidate` reports reproduce the original lister-facing
denominators exactly: 60 card-runs, 41 missing serial tokens, and 110 missing
structural tokens. The repeatable audit is
`scripts/audit-offline-benchmark-losses.mjs`; its raw output is
`artifacts/smoke/offline-benchmark-loss-audit.json`.

### Missing serial denominator

- 27/41 retain the correct safe denominator (`#/N`) and miss only the current
  card numerator.
- The remaining 14 rows are five unique cards repeated across rounds.
- 8/14 already hold `numbered_to` in resolver state but do not express it in
  the title: renderer/application boundary loss.
- 6/14 never hold the expected denominator in resolver, observation, field
  flow, or candidate application evidence: reading/evidence loss.

This rejects a single global renderer explanation. The highest-value split is
three unique cards with a held denominator versus two unique cards whose
denominator was never read.

### Missing structural tokens

- `RESOLVER_HELD_NOT_RENDERED`: 49/110.
- `CANDIDATE_HELD_NOT_APPLIED`: 27/110.
- `EVIDENCE_HELD_NOT_RESOLVED`: 4/110.
- `NEVER_HELD`: 30/110.

The largest recoverable bucket is the renderer boundary, but candidate
application is nearly as large. This confirms that adding more OCR or prompt
text alone cannot recover most structural loss.

### Literal placeholder guard

The shared deterministic renderer now drops complete-field placeholders such
as `(none)`, `(null)`, `(unknown)`, and `(n/a)`. Across deterministic replay of
all three 20-card reports:

- literal-placeholder titles: `1 -> 0`;
- only the affected Lionel Messi card changed;
- no model or external API call was used.

The larger reviewed-200 evidence-completion confirmation was not started:
current 20-card execution still has invalid long-tail rounds, so expanding to
200 would violate the existing stability-before-scale gate.
