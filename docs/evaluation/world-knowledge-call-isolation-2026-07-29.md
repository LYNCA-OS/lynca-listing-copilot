# World-knowledge call isolation decision

Date: 2026-07-29

## Decision

The visual observation contract remains byte-stable `read_only_sparse_v3`.
World knowledge must be a separate post-observation shadow assist. It has no
Resolver or title authority. The separate paid call is not implemented in this
change, so the shadow contract records `NOT_RUN` and `paid_provider_calls=0`.

The legacy `read_only_world_knowledge_v1` mixed response profile is rejected
before any network request. The observation schema has no `k` lane, and an
unexpected `k` value cannot survive canonical expansion.

Against `origin/main@c9921be8`, the fixed test payload preserves both baselines:

- observation prompt: 2,459 characters, SHA-256
  `c8824b9c18b493f9ec2de47e1ee46c29ff73967423663cd098e5a8f617911d6f`;
- response schema: 2,251 JSON characters, SHA-256
  `2b4bf18635c199c3b7e59065471daa2746260feed1c231f073d043155d7d0a34`.

## Counter-evidence that closed the mixed path

The hosted unseen-10 interleaved rerun compared the same read-only observation
path with and without world-knowledge proposals:

| Metric | Baseline | Mixed prompt candidate | Delta |
| --- | ---: | ---: | ---: |
| Policy-fair token recall | 0.3609125 | 0.3341268 | -0.0267857 (-2.68 pp) |
| Prompt characters | 2,533 | 3,417 | +884 |
| Total tokens | 39,527 | 43,249 | +3,722 |

The candidate produced 18 proposals: 0 accepted, 11 unchecked, and 7 invalid.
Card-level movement was 1 improvement, 3 regressions, 6 ties, and 1 catastrophic
regression. One round is not a general estimate of model world knowledge, but it
is sufficient to reject a design that perturbs the only visual observation while
yielding no admissible knowledge evidence.

## Physical boundary

1. The flag may request an evaluation trace packet only under
   `cold_algorithm_benchmark` plus `trace_level=evaluation`.
2. The full visual provider always receives the baseline prompt and
   `read_only_sparse_v3` schema, regardless of that request.
3. Only after observation completes may code construct a structured shadow input
   from allowlisted `raw_provider_fields`; product and team are targets, never
   copied into the input.
4. There is no executor in this version. The contract denies paid calls, Resolver
   access, and title access.
5. Legacy world-knowledge evidence is explicitly blocked at the Identity Resolver
   boundary, including replayed results produced before this change.
6. Shadow-only configuration is excluded from the recognition result fingerprint
   because it cannot change the recognition result.

## Reopening condition

A separate call can be added only as a new executor behind this contract. It must
consume the completed structured observation, emit trace-only output, and prove
incremental value offline before any candidate-support authority is considered.
It must never reintroduce world knowledge into the visual observation prompt or
response schema.
