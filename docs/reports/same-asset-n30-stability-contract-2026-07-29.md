# Same-asset N=30 stability contract

Date: 2026-07-29

Status: **OFFLINE CONTRACT READY; NOT DEPLOYED; NOT EXECUTED**

This change deliberately made zero remote Provider calls. Unit tests use injected in-memory responses only.

## Contrary conclusion first

Thirty identical final titles would not prove a stable recognition chain, and thirty different titles would not by itself prove model nondeterminism. The experiment must freeze the actual Provider input and locate the first divergent stage.

The old evidence was insufficient:

- `prompt_version` is a label, not the bytes sent to OpenAI.
- `provider_prompt_chars` permits different prompts with the same length.
- the cache image hash sorts primary images and excludes the actual ordered crop subset.
- logical `provider_calls=1` did not directly prove one HTTP request.

## New measurement boundary

At the final OpenAI request assembly boundary, the runtime now computes but does not persist any prompt or signed URL:

- exact UTF-8 prompt byte length and SHA-256;
- ordered Provider image-content manifest SHA-256;
- request-controls SHA-256, including JSON schema, response profile, reasoning controls, verbosity, image detail and output cap;
- requested and returned model IDs;
- actual HTTP request count;
- first HTTP request start and last HTTP request completion timestamps;
- one composite request fingerprint.

If a data URL is the actual selected transport, the hash is computed from its decoded bytes. A conflicting declared content hash makes the request identity incomplete instead of silently fingerprinting the wrong image.

The packet is exposed only through the existing cold/evaluation decision trace. Production title behavior, Prompt text, Queue, concurrency, Resolver and Renderer are unchanged.

## Frozen execution protocol

The runner defaults to dry-run and refuses execution unless all of the following are true:

1. one item is explicitly selected from one of the two hash-frozen paired Development cohorts (`FAMILIAR` or `UNSEEN`); a CLI cohort label is not accepted as proof;
2. the run count is exactly 30;
3. the matching durable asset cache entry already contains an authoritative canonical image-set SHA, all primary content SHAs and `canonical_verified_at`; the experiment never bootstraps these values from its first paid run;
4. execution is sequential single-flight with one authenticated session;
5. `--execute --confirm-planned-runs 30` is explicit.

The authorized execution plan is a required analysis input. Every result is bound to the plan SHA, execution ID, frozen dataset and labels hashes, selected Development item, and canonical asset proof. The runner also copies the exact dataset and verified-asset-cache bytes used at execution into the immutable evidence directory. Reports without this binding are invalid and cannot be presented as the predeclared N=30 experiment.

The confirmation authorizes 30 planned jobs, not a 30-request hard cost cap. The current server may perform an internal retry before the client can stop it. Such a run is invalid and stops the remaining schedule immediately, but the exact paid HTTP upper bound is not enforced in advance. The contract therefore does not call `30` a Provider-call budget.

Every run must satisfy:

- `cold_algorithm_benchmark`;
- cache read bypassed, no cache hit, no Provider skip;
- one job attempt and one Provider HTTP request;
- no whole-job, transient, truncation, key-rotation, output-cap or empty-response retry;
- Trace v10 and Replay v4 are complete;
- unique job and recognition-session IDs;
- one deployment SHA, pipeline fingerprint, catalog snapshot, prompt SHA, controls SHA, ordered-image SHA, request fingerprint, requested model and returned model across all 30 runs;
- total experiment window at most one hour, measured from the earliest job creation through the final Provider HTTP completion;
- exactly 30 report files with one result each, ordered `runner_attempt=1..30`;
- non-overlapping Provider HTTP intervals, proving sequential single-flight at the actual scarce call boundary.

A missing run is `PARTIAL`. An extra run, input drift, retry, duplicate identity or incomplete trace is `INVALID`. Each execution receives a UUID evidence directory; before every call the runner creates an exclusive intent file, and result/analysis files are also exclusive. A failed or interrupted attempt cannot be silently replaced. The first hard-invalid run stops all remaining calls.

Cold evaluation attaches the active catalog revision independently of identity-cache enablement. Cache reads and writes remain disabled, while Replay can still prove which catalog snapshot was active.

## Causal decomposition

For each intermediate stage the analyzer reports `bounded_exact` and order-insensitive semantic fingerprints over the persisted evaluation Trace projection:

1. Provider observation;
2. normalization;
3. retrieval / selection / application;
4. Resolver;
5. Renderer input;
6. Renderer output;
7. final title.

`bounded_exact` is deliberately not called exact stage state: Trace projections use bounded persisted representations and do not prove equality of full in-memory objects. The final title string remains exact. Provider prompt bytes, ordered selected image content, request controls and composite final-request identity also remain exact SHA-256 measurements at the final Provider request boundary.

It reports modal share, all 435 pairwise comparisons, deterministic bootstrap intervals, and Wilson intervals only for the 15 predeclared non-overlapping pairs. The 435 dependent pairs are never presented as 435 independent samples.

Conditional drift answers questions such as “did normalization diverge when Provider evidence was semantically identical?” The first divergent boundary is counted for every run pair.

## Claim boundary

- Provider-observation divergence is labeled `PROVIDER_OR_TRANSPORT_DRIFT`, not `MODEL_NONDETERMINISM`.
- One asset cannot prove accuracy, population stability or a global cache policy.
- A stable model alias cannot reveal an unannounced hosted-model revision.
- If the first boundary is repaired, the next population-oriented design should be `15 assets × 2 runs`, not another single-card loop.

## Commands

Dry-run plan only:

```bash
node scripts/run-same-asset-stability.mjs \
  --dataset <frozen-familiar-or-unseen-development-10.json> \
  --sealed-labels <matching-frozen-labels.jsonl> \
  --frozen-cohort <FAMILIAR-or-UNSEEN> \
  --item-id <predeclared-member-id> \
  --verified-asset-cache <verified-assets.json> \
  --out-dir <output-directory>
```

Offline analysis after an authorized run:

```bash
node scripts/analyze-same-asset-stability.mjs \
  --plan <evidence-directory>/same-asset-stability-plan.json \
  --input <run-01.json> --input <run-02.json> \
  --expected-runs 30 \
  --out <analysis.json>
```

Execution is intentionally omitted: these trace additions are not deployed, no Provider call was authorized, and the server does not yet enforce a pre-call no-retry HTTP budget.
