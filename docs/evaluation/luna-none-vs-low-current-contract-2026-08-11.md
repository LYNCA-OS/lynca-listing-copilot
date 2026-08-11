# Luna none versus low on the current Production contract

Date: 2026-08-11

Decision: keep Production on `gpt-5.6-luna` with `reasoning.effort=low`
Scope: Subset A, 16 front/back card pairs, current prompt/schema/transport

## Contrary hypothesis and result

The reasonable contrary hypothesis was that `none` could preserve current
quality while removing avoidable reasoning latency. The paired cloud run did
not support that hypothesis. `none` was materially faster, but it introduced
new visible-fact errors that are disqualifying for a listing writer.

The experiment used protected cloud credentials and two server-side arms. The
same original WebP bytes, image order, `detail=high`, output budget, prompt,
schema and application path were used for each pair. The recursive normalized
wire diff allowed only the effort value and the corresponding immutable
optimization-pack identity to differ. No local OpenAI key participated.

## Execution integrity

- 16 valid low/none pairs; 32 fresh paid operations.
- Every valid operation reported attempt `1`, retry `0`, `PERSISTED`, one paid
  request and zero feedback submissions.
- Each arm used the same two original image hashes for a case.
- All assets, sessions and provider-authority operation receipts were distinct.
- One formal low run for case `k` was discarded after a pre-upload harness
  failure; the preregistered recovery run supplied both valid `k` arms.
- The immutable none candidate was never promoted and was deleted after the
  experiment. Canonical Production remained on the low arm.

Evidence SHA-256:

- formal run, valid `a-j` (`k` stopped before upload): `dbab65be5f7421683bf63c648ffddd016787b7e26369e3e2c2a38f3694b94c61`
- recovery `k-p`: `12ffd04e74a858d29266f48a90a23989a4a3cef7c8c0b12bc1cd0be680ad5c7f`

## Latency

The preregistered percentile function uses nearest rank. For `n=16`, its p50
is the eighth sorted observation and its p95 is the maximum.

| Metric | low p50 / p95 | none p50 / p95 | Paired geometric mean ratio |
| --- | ---: | ---: | ---: |
| upload to visible title | 6418.180 / 9558.528 ms | 3831.456 / 7606.399 ms | 0.646918 |
| provider | 4785 / 7012 ms | 2132 / 4236 ms | 0.457848 |
| request total | 5161 / 7372 ms | 2506 / 4523 ms | 0.49282 |
| non-provider server work | 418 / 570 ms | 343 / 535 ms | not material |
| CSM persistence | 122 / 211 ms | 126 / 237 ms | not material |

`none` was faster on upload-to-title for 15 of 16 pairs and on provider time
for all 16. The sole slower upload-to-title observation had a fast none server
receipt and a client/body-read tail, so it is not evidence that none reasoning
was slower.

An earlier apparent 69.882-second low outlier was a harness artifact: the case
clock included a caught 60-second `networkidle` wait before upload. It is not a
Production model-latency observation.

## Quality decision

Only 9 of 16 paired titles were identical. `none` introduced hard factual
regressions that low did not:

- case `a`: visible `50/50` became `30/50`;
- case `l`: an unsupported `Refractor` was added to a base card;
- case `g`: explicit jersey evidence was rendered as `Patch`.

There were also real none improvements, including better RC or colour/finish
recognition on several cases. They do not compensate for newly fabricated or
misread identity facts. COS-58 keeps anti-fabrication absolute, so `none` is
not promotion-eligible.

## Shared projection defect

Both arms persisted a supported Card Number on all 16 cases, yet both output
profiles omitted it on all 16 titles. The database trace identifies the common
cause as `SUPPRESSED_BY_PROFILE`, not a Luna recognition failure. This defect is
handled separately by COS-59/COS-60 through a versioned Canonical Naming Layer.

The five raw Codex reference titles for `b`, `c`, `m`, `o` and `p` exceed the
Production 80-character limit. Therefore raw string equality cannot be the only
quality gate. The admissible target is evidence-grounded semantic parity under
the explicit 80-character LYNCA profile, with no unsupported token.
