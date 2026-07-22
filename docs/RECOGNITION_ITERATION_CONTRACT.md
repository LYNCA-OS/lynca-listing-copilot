# Recognition Iteration Contract

Frozen evaluation contract: `listing-evaluation-gate-v4-2026-07-19`.
It may change only after an explicit user decision and a version bump. Reports,
tests, and release decisions must not reinterpret it locally.

This is the single iteration loop for Listing Copilot recognition changes. It
does not replace the full commercial launch benchmark in
`LAUNCH_ENGINEERING_LOOP.md`.

## Fixed boundaries

- Strategy and execution-chain changes are separate experiments. A strategy
  patch must not alter queue, worker, authentication, deployment, or sampling
  behavior. A chain patch must not change title policy or SEM scoring.
- The execution contract is owned by `run-launch-gate-eval.mjs`: `gpt-5-mini`,
  high image detail, compact L2, provider concurrency 2, preparation
  concurrency 3, submission concurrency 2, identity result cache disabled,
  and no ultra-fast L2 override.
- Output titles are capped at 80 characters by the production renderer.
- Historical champions are immutable data in
  `historical-recognition-champion-contract.mjs`. Dynamic historical scans are
  proxy-leader audits and cannot overwrite that contract.
- Admin test acceptance never writes the edited title into the GT library.

## Fast feedback loop

1. Run offline unit and replay checks against the changed ownership layer.
2. While the 10-card gate is failing, replay that same set before sampling new
   cards. Once it passes, ordinary strategy changes continue forward and do
   not return to 10; only a major strategy or chain change restarts the canary.
3. The 10-card gate passes only when token recall is at least 0.85, every
   card's SEM projection is at least 0.5, all 10 complete, and the cold-chain
   writer-perceived rate is at least 6 cards per minute. SEM is the
   catastrophic-card guard, while title/token accuracy remains the
   external-data diagnostic.
4. Only after the 10-card gate passes, run `reviewed-50`: 50 internal reviewed
   GT cards. All 50 must complete, average policy-fair token recall must be at
   least 0.87, the minimum per-card SEM score must remain at least 0.5, and the
   writer-perceived rate must be at least 6 cards per minute.
5. Only after `reviewed-50` passes every gate, run a separate `ebay-50` random
   cold-start cohort. It must complete 50/50 at a writer-perceived rate of at
   least 6 cards per minute. Seller-title agreement is reported only as an
   external-distribution diagnostic and has no formal accuracy authority.
6. Only after both preceding cohorts pass their applicable gates, run
   `mixed-100`: 50 internal reviewed GT cards plus 50 eBay cards. The internal
   cohort alone owns formal accuracy with the same token-recall and SEM floors;
   the eBay half checks technical and distribution stability. All 100 cards
   must complete at at least 6 cards per minute.
7. The former per-card SEM acceptance rate at 0.87 is retained only as a
   diagnostic. It has no release or strategy decision authority. Token recall
   is the primary gate; SEM only rejects a catastrophic card below 0.5.
8. Random sampling may select cards seen in an earlier run; historical exposure
   is not an exclusion rule.
   Official and writer-reviewed catalog retrieval may therefore reuse a prior
   reviewed identity. Visual-vector retrieval still excludes the current source
   image to prevent image self-match leakage.
9. Commit and push only after the applicable gate passes. A failed gate remains
   local and starts another offline/replay iteration.

## Verified asset reuse

- A writer upload creates and verifies the canonical asset generation once.
  Ordinary strategy replay uses `--strategy-replay` and a private, gitignored
  `.local/launch-gate/verified-assets-v1.json` mapping from source fingerprint
  to that verified generation.
- The fingerprint is owned by the stable source record plus immutable image
  locators/content. Random-manifest asset IDs and local materialization paths
  are deliberately excluded, so drawing the same card again does not upload it
  again.
- A cache hit skips source materialization, asset creation, signed upload URL,
  image PUT, and upload verification. Pre-ingest and enqueue still reconstruct
  canonical image references server-side. Identity result cache remains
  disabled, so the provider performs new recognition and current-source vector
  self-exclusion remains active.
- A stale cached asset is invalidated and the report identifies that card for
  one bounded cold rebuild; it is never silently treated as a cache hit. The
  cache never stores a password, signed URL, session cookie, or verification
  token.
- Strategy replay is an accuracy/diagnostic lane, not writer-speed evidence.
  A formal cold-chain run uses cache mode `refresh`; only that run may satisfy
  the writer-perceived throughput gate.

## Minimum necessary rerun

- Renderer, SEM projection, scoring, and deterministic post-provider decision
  changes use recorded-result offline replay. They make no signing, upload,
  pre-ingest, enqueue, or provider request.
- Prompt, image-observation, model, or provider-response parsing changes use
  `--strategy-replay`. The verified asset generation is reused, so signing,
  PUT, and upload verification are skipped; provider recognition intentionally
  runs again because its output is the variable under test.
- Storage, upload, pre-ingest, queue, worker, concurrency, timeout, retry, or
  writer-speed changes use `formal-cold-chain`. This is the only lane that
  repeats the complete writer-visible path and the only lane eligible to prove
  six cards per minute.
- Use the cheapest lane that includes the changed owner. A broader run cannot
  replace a missing targeted replay, and a cached run cannot prove cold-chain
  speed.

## Candidate and credential isolation

- Paid replay targets one immutable `*.vercel.app` URL and one pinned `dpl_*`
  deployment ID. It never targets the production alias.
- Use `npm run launch:protected-candidate`. The wrapper obtains a temporary
  deployment-protection bypass, deletes its temporary trace, and host-scopes the
  bypass header to the candidate deployment.
- Inject `METAVERSE_USERNAME` and `METAVERSE_PASSWORD` through the process
  environment. Credential command-line arguments are rejected and project or
  production environment variables are not mutated for a replay.

## Writer-perceived speed clock

- Start when the first writer upload enters the product upload/recognition
  path; stop when every card in the measured cohort has a complete L2 result.
- Count upload, verification, queue wait, provider work, evidence join, and
  writer-ready persistence. These are all visible to the writer.
- Exclude candidate protection, test-dataset download/materialization, and
  prewarm. Provider latency or theoretical capacity cannot substitute for the
  end-to-end rate.
- Provider concurrency remains fixed at 2. Non-provider work must overlap
  outside the scarce provider critical section rather than increasing GPT
  concurrency to conceal queue coupling.

## Evidence required before moving forward

- exact deployment ID and candidate URL;
- fixed sample fingerprint and provenance mode;
- observed model, prompt mode, image detail, and all concurrency checks;
- token recall, minimum SEM score, per-card failures, and writer-perceived
  throughput;
- explicit `PASS` or `FAIL`, followed by either the 100-card gate or another
  local iteration.
