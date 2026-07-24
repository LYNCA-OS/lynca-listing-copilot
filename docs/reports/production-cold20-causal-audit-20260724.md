# Production Cold-20 Causal Audit — 2026-07-24

## Decision

Do not implement Persistent Queue Consumer yet. The sealed production run proves 73.576 seconds of runnable-backlog wake gap, while reaching 6 cards/minute requires 75.897 seconds of recovery. The strict threshold misses by 2.321 seconds.

The remaining 21.840-second interval has an unconfirmed capacity-release boundary. It is not legal to count that interval as Consumer-recoverable without historical lease transitions.

No additional Provider call was made for this audit.

## Source boundary

- GitHub Actions run: `30087244187`
- Artifact: `reviewed-cold-20-report`
- Source commit: `01841fb`
- Production deployment under test: `dpl_5x3zV25Ap9NxyrCJmGvMhBXFimTv`
- Cards: 20/20 reached L2
- Raw Provider idle gap: 184.301 seconds
- Audit script: `scripts/analyze-provider-idle-gap-causes.mjs`

The audit uses sealed `job_created_at`, `job_started_at`, Provider capacity slot, Provider started/completed timestamps, and recorded capacity-release results. It does not reconstruct state that was never persisted.

## Provider idle-gap attribution

| Category | Duration | Meaning |
| --- | ---: | --- |
| `RUNNABLE_BACKLOG_WAKE_GAP` | 73.576s | Capacity release confirmed and at least one enqueued job remained unclaimed |
| `UPSTREAM_PRE_PROVIDER` | 82.281s | Worker already claimed the next job, but Provider had not started |
| `RETRY_OR_PRIOR_ATTEMPT` | 0.790s | Next terminal result required more than one attempt |
| `CAPACITY_RELEASE_LATENCY` | 5.814s | Time attributed to the recorded release operation |
| `CAPACITY_LEASE_RELEASE_UNCONFIRMED` | 21.840s | Previous job did not record a successful release; causal ownership is unknown |
| `NO_ENQUEUED_BACKLOG_OBSERVED` | 0s | No such interval was observed |

The categories reconcile exactly to 184.301 seconds.

The largest confirmed wake gap is 36.530 seconds on Provider slot 2. One 34.346-second raw gap on slot 1 contains the entire 21.840-second unconfirmed-release interval. This single anomaly decides the Go/No-Go result.

## Persistent Consumer gate

```text
required recovery for 6 cards/minute = 75.897s
confirmed runnable wake gap          = 73.576s
strict headroom                      = -2.321s
decision                             = NO-GO
```

A Persistent Consumer may still be useful, but the current sealed evidence does not prove it can independently cross the 6 cards/minute gate. The next engineering evidence must persist lease acquire/release transitions and retry `not_before` transitions. Do not pay for another GPT run solely to recover missing scheduler telemetry.

## SEM stage-loss diagnostic

The same 20 terminal outputs were replayed through `scripts/analyze-sem-stage-loss.mjs` with no Provider call.

| Metric | Result |
| --- | ---: |
| Confirmed writer-title-derived SEM fields | 122 |
| Preserved in final title | 79 |
| Missing from final title | 43 |
| Diagnostic preservation rate | 64.7541% |

| Loss class | Fields |
| --- | ---: |
| `EVIDENCE_OR_RETRIEVAL_MISSING` | 23 |
| `CANDIDATE_NOT_SELECTED` | 9 |
| `RENDERER_DROPPED` | 8 |
| `RESOLVER_DROPPED` | 3 |

This is diagnostic proxy evidence, not tuning truth. Raw Provider observation is absent from the sealed report, so the largest 23-field bucket cannot be split into `PROVIDER_NOT_OBSERVED`, `NORMALIZATION_DROPPED`, and `CATALOG_NOT_RETRIEVED`. The correct next accuracy change is Trace completeness, not a Prompt, OCR, Retrieval, or Renderer patch selected by guesswork.

## Exact Anchor opportunity boundary

- `no_lookup_anchor`: 20/20
- Card-code OCR jobs scheduled: 19
- At decision time: 12 queued, 7 running, 0 terminal in the report snapshot
- Retrieval anchor patches: 0
- Final resolved card/checklist/collector number present: 5

Therefore `no_lookup_anchor` does not prove that exact codes were invisible. It proves that the pre-L2 decision did not receive a completed lookup anchor. A visual opportunity claim requires terminal card-code crop evidence or direct image review; it must not be inferred from this report.

## Release alignment

PR #90 was merged into `main` as `4f428b2e`. Production was rebuilt from that exact `main` tree and deployed as `dpl_7BYT4jedoDgYTzgaxQcT8H7TrVNL`. Runtime health is ready; `launch_ready` remains false until a real Writer Journey is run.
