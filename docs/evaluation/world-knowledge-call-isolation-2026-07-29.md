# World-knowledge call isolation decision

Date: 2026-07-29

Implementation baseline: `origin/main@c9b962bc1ece519bc491e46dd6b6e1b389690962`.

## Decision

The visual observation contract remains byte-stable `read_only_sparse_v4` after the Task A observation-recovery revision.
World knowledge must be a separate post-observation shadow assist. It has no
Resolver or title authority. A bounded text-only executor now exists, but it is
not wired into the production or targeted-visual route. The active shadow
contract therefore still records `NOT_RUN` and `paid_provider_calls=0`.

The legacy `read_only_world_knowledge_v1` mixed response profile is rejected
before any network request. The observation schema has no `k` lane, and an
unexpected `k` value cannot survive canonical expansion.

Against `origin/main@c9b962bc1ece519bc491e46dd6b6e1b389690962`, the fixed test
payload preserves both baselines:

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
   `read_only_sparse_v4` schema, regardless of that request.
3. Only after observation completes may code construct a structured shadow input
   from allowlisted `raw_provider_fields`; product and team are targets, never
   copied into the input.
4. The separate executor accepts only typed `UNKNOWN` product/team outcomes,
   emits server-stamped `QUERY_EXPANSION_ONLY` proposals, and is disabled in the
   first Targeted Visual A/B. The active route contract continues to deny paid
   calls, Resolver access, and title access.
5. Legacy world-knowledge evidence is explicitly blocked at the Identity Resolver
   boundary, including replayed results produced before this change.
6. Shadow-only configuration is excluded from the recognition result fingerprint
   because it cannot change the recognition result.

## Relationship to the first Targeted Visual A/B

World knowledge is not an experimental variable in the first paired A/B. The
candidate benchmark profile sets `enable_world_knowledge_assist_candidate=false`,
and the cold-profile ledger rejects any `WORLD_KNOWLEDGE_ASSIST` stage. Thus the
frozen familiar-10 and unseen-10 scoreboards measure only Targeted Visual versus
the full observation baseline; they cannot be cited as evidence for or against
the separate world-knowledge executor.

That visual experiment independently requires current
`evaluation-decision-trace-packet-v9`, COMPLETE replay snapshots, equal
canonically verified image inputs, per-result deployment SHA, same-source
reviewed exclusion, a complete critical-title guard, and zero hidden
retry/output-cap downgrade. Those are contamination controls for the visual
ablation, not permission to feed any of its sealed labels or title facts into
world knowledge. No fixed-20 is permitted unless both visual paired scoreboards
pass first.

## Reopening condition

The separate executor can be connected only in its own ablation after Targeted
Visual is measured. It must consume the completed structured observation, emit
query-expansion-only output, and prove incremental value before any broader
authority is considered. It must never reintroduce world knowledge into the
visual observation prompt or response schema.
