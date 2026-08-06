# Same-call canonical plus candidate lane — 17-card screen — 2026-08-02

This was an evaluation-only same-call experiment. One GPT-5.6 Luna request
returned both the existing canonical CSM-shaped fields and a separate
non-authoritative `visible_facts` / `identity_hypotheses` lane. It used 17
sealed unseen-product cards, original local images at `high` detail, reasoning
`none`, and concurrency 2. Production was not called or changed.

## Paired result against the already-paid canonical control

| Arm | F1 | Paired result | Reference-loss cards | Median latency | Median input / output |
| --- | ---: | --- | ---: | ---: | ---: |
| Existing canonical control | 0.442087 | — | — | 4.177 s | 4,197 / 91 |
| Same-call canonical + candidate | 0.437096 | 1 win / 2 losses / 14 ties | 1 | 5.957 s | 4,544 / 272 |

The same-call channel did produce candidate material on 17/17 cards and
hypotheses on 15/17, but the canonical title was worse by `−0.004991`. It also
added about 1.78 seconds median latency and 181 median output tokens per card.

## Failure ledger

- `unseen_40b6057985f303926690`: canonical changed `Contours Jason Dart RC`
  to `Jason Dart RC`, losing the reference token `Contours`.
- `unseen_bbfc75a6ba32ffe48343`: canonical added `Gold` from a visual guess;
  F1 fell from `0.4000` to `0.3333`.
- `unseen_39194858fc5eeec7d09d`: the identity projection admitted
  `Inter Milan crest` as Set and fell from `0.6154` to `0.5000`. This is the
  same affiliation-versus-identity failure class already seen in the v4
  development audit.
- The apparent hybrid win on `unseen_5aaa54c150b4479171cb` was a token-score
  improvement from `Conteurs` to `Contenders`, while the reviewed reference is
  `Archetype`; it is not semantic evidence of a correct product recovery.

## Decision

Stop the same-call candidate lane as a production change. It demonstrates that
the model can emit extra facts, but those facts perturb the canonical answer and
do not survive the current admission boundary. Do not add this payload to the
production schema, do not run a second-call fallback, and do not promote the
generic identity resolver. Preserve the raw evidence for later design of a
strictly isolated capture channel with field-level attestation and a fresh
independent 150-card gate.

Artifacts:

- `artifacts/accuracy-unseen17-canonical-candidate-v1-2026-08-02/canonical-candidate-gpt-5.6-luna.jsonl`
- `artifacts/accuracy-unseen17-canonical-candidate-v1-2026-08-02/paired-analysis.json`
- `lib/listing/thin/canonical-candidate-v1.mjs`
