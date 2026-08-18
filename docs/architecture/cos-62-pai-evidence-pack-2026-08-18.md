# COS-62 PAI evidence pack — 2026-08-18

Paste target: [COS-62](https://linear.app/lynca/issue/COS-62/decision-proposal-select-the-surviving-listing-application-after).
Related: [COS-59](https://linear.app/lynca/issue/COS-59/pai-reconcile-listing-copilot-with-the-frontier-model-csm-operating).
Engineering PR: [lynca-listing-copilot#312](https://github.com/LYNCA-OS/lynca-listing-copilot/pull/312).

This is a **PAI recommendation pack**, not a Founder decision. It does **not** close COS-62. It does **not** select a surviving repository. It does **not** authorize deletion, Production cutover, schema migration, traffic promotion, or a second Production execution chain.

Authorization used: Fei on COS-62 (2026-08-17) — pause non-essential Listing Copilot recognition expansion; independent Runtime shadow with Production authority unchanged; evaluate the eight axes separately and do not collapse them into one F1. Green CI is not product quality.

## 1. Current source of truth (fetched 2026-08-18)

| Repository | What was fetched | Exact SHA | Commit |
| --- | --- | --- | --- |
| `LYNCA-OS/lynca-listing-copilot` `origin/main` | Git `origin/main` in this checkout | `2fe6c2db6f4570ec4db552bf23d8a88544cd12de` | `fix(gate): amend the latency contract to the founder ruling, and calibrate it (#311)` |
| `LYNCA-OS/lynca-runtime` `origin/main` | GitHub API commit lookup (this workspace token cannot clone that private repo) | `8a75ff73aef9953e143a851d97977b33b35631bf` | `Accept Listing Copilot terminal architecture (#4)` |

Listing Copilot Production source of truth remains **that exact `origin/main` commit** plus `.github/workflows/deploy-production.yml`. This algorithm branch and PR #312 are not Production.

Runtime SHA `8a75ff73…` is the pin recorded by `lib/listing/evaluation/independent-runtime-shadow.mjs` as `LYNCA_RUNTIME_PINNED_SHA`. The shadow adapter does not float on `main`.

CSM pin is **blocked**. [lynca-csm#3](https://github.com/LYNCA-OS/lynca-csm/pull/3) is still draft at `d35eefd7e5b10fd292134c52767ef5e47d0c2587` (other author). This pack does not invent a local CSM copy as proof. Dual-consumer semantic proof is not valid until both consumers pin the same CSM package after that PR lands.

## 2. Capability comparison (from code, not slogans)

Filled from Listing Copilot `origin/main` @ `2fe6c2db…` plus files read at Runtime `8a75ff73…` (`README.md`, `architecture.md`, `runtime.md`, `package.json`, `bin/lynca.mjs`, `orchestrator/index.mjs`, `api/identify.mjs`, `vercel.json`, `vnext/README.md`, `decisions/ADR-0004-listing-copilot-as-runtime-terminal.md`).

| Dimension | Listing Copilot (`origin/main`) | Runtime (`origin/main` @ `8a75ff73`) |
| --- | --- | --- |
| Product workflow | Live ingest + direct routes (`api/csm-listing-title-ingest.js`, `api/csm-listing-title.js`), Writer Terminal, batch, save/feedback endpoints, export, manual recovery. Adding images is the production intent. | Local `lynca identify <front> <back>` and `lynca run <case>`; Vercel `api/identify.mjs` for a front/back JSON body. No Writer Journey, batch workbench, or production feedback loop comparable to Listing Copilot. ADR-0004 places a future Listing terminal under `applications/listing-copilot` with **production adoption pending**. |
| Model capability | Production thin path: OpenAI `gpt-5.6-luna` via `lib/listing/thin/luna-direct-dispatcher.mjs` and `csm-provider-adapter.mjs`, structured canonical-fields schema, image signed-URL transport. Catalog/vector/Paddle OCR admission is fenced off the production import graph. | Classic orchestrator: intake classifier → frontier recognition worker → Evidence Graph → runtime/projection, with optional model-selected web retrieval recorded on the recognition result. vNext identify is a two-stage live adapter (controlled web retrieval, then structured Asset State) and is closer to versioned `lynca-csm` contracts; it requires `LYNCA_CSM_ROOT`. Transcription/serial gates are evaluation-only and default off. |
| CSM relationship | Application-local `CSM_THIN_RUNTIME_CONTRACT` in `lib/listing/thin/csm-runtime-contract.mjs` is **not** standalone Runtime. Live vocabulary still treats Set / Search Optimization as canonical (superseded by CSM v3 15-field; not “fixed” here). Composer lives in `composeActiveCanonicalFields` / `finishCanonicalTitle`. | Classic orchestrator still serializes the older field list including `set` and `search_optimization` in `formatIdentification`. vNext README states it consumes versioned contracts from independent `lynca-csm` and does not recreate collectible semantics locally. Neither consumer is pinned to the same published CSM package today. |
| Data | Durable multi-tenant Supabase: listing assets, analysis runs, reviews, CSM stage packets, migrations under `supabase/migrations` and `infrastructure/supabase-production`. Provenance and replay exist on the production path. | Local run artifacts (`evidence-graph.json`, `canonical-asset.json`, `projection.json`, `run-manifest.json`). Ground truth is stored separately and loaded only after recognition/runtime/projection complete. No durable multi-tenant production schema comparable to Listing Copilot. |
| Security | Session middleware, tenant boundaries, storage signed URLs, production auth entry tests. | `api/identify.mjs` requires an idempotency key and bounds upload bytes. No Listing Copilot-grade auth/tenant isolation was present in the files read. ADR-0004 lists authentication and tenant isolation as activation-gate work, not current Production. |
| Reliability | Provider retry/admission, staged ingest resume, manual recovery records, asset single-flight, queue flags retired on the thin path. | Orchestrator fail-closed holds (`CLASSIFICATION_UNRESOLVED`, `ROUTING_HELD`). Provider exactly-once is explicitly not claimed (ADR-0004). No production recovery chain matching Listing Copilot. |
| Evaluation | Golden eval, commercial held-out glue, writer-title latency gate, fabrication/unbacked-token gates, gamma-53 luna-parity (see §false comparison). | Local gamma cases, vNext verify/compose, serial calibration scripts. Goldens sealed until execution completes is a Runtime README rule as well. |
| Release | Protected `.github/workflows/deploy-production.yml`: dispatch only from current `main`, exact SHA match to `origin/main`, rollback receipts. Offline CI in `.github/workflows/ci.yml`. | `vercel.json` for `api/identify.mjs` (300s, 2GB). `verify:deployment` script exists. This is not Listing Copilot’s protected exact-main Production deploy. |
| Maintenance | Large production surface; recognition/Composer duplicated against Runtime; agent-readable but expensive to change. | Smaller reference implementation plus vNext replacement path. ADR-0004 forbids `runtime/` from importing application session/auth/UI. Two identify stacks (classic orchestrator vs vNext) already coexist inside Runtime. |
| Migration | Production SoT is already here. Absorbing Runtime methods without a second chain is the low-cutover-risk option. | Absorbing Listing Copilot production capabilities is the high-migration-cost option Fei currently prefers as a possible long-term app — **not decided**. |

## 3. Missing-capability map

### Listing Copilot is missing (relative to Runtime `8a75ff73`)

- An executable import/package boundary onto independent `lynca-runtime` (no npm dependency today).
- Runtime Evidence Graph → Canonical Asset Graph → Projection as the production understanding arm.
- vNext’s versioned `lynca-csm` compose path (blocked on lynca-csm#3 anyway).
- Model-selected governed web retrieval on the production thin path (catalog/vector remain fenced).
- ADR-0004 Listing Terminal Service (sessions/turns/card jobs as Runtime-owned events). That architecture is accepted in Runtime and **not adopted in Production**.

### Runtime is missing (relative to Listing Copilot Production)

- Protected exact-`origin/main` deploy, rollback receipts, and Production write authority.
- Auth, tenant isolation, and Supabase durability used by writers.
- Ingest + direct Writer Journey, batch, feedback retention (still default-off), export, manual recovery.
- Lot / TCG / Non-TCG production terminals already running in Listing Copilot.
- The operational completeness Fei listed as Option B’s verification burden.

### Both are missing

- A pinned exact CSM candidate shared by both consumers (blocked on lynca-csm#3).
- A true dual-implementation scored comparison on the frozen 53-case cohort with independent arms (this PR lands the harness and empty score slots only).
- Founder blind preference data for COS-62 selection.

## 4. Duplicate-responsibility map

These Listing Copilot components currently duplicate Runtime concerns instead of consuming them:

| Concern | Listing Copilot (production) | Runtime (`8a75ff73`) |
| --- | --- | --- |
| Provider invocation | `lib/listing/thin/luna-direct-dispatcher.mjs`, `csm-provider-adapter.mjs` | `recognition/worker/frontier-worker.mjs`, vNext live identify, `api/identify.mjs` → `orchestrateRun` |
| Prompts | `lib/listing/thin/captured-production-e1ae-assets.mjs`, prompt assets | `recognition/prompts/**` (included in Vercel `identify` bundle) |
| Schemas | Captured E1AE `canonical_card_fields` schema; application-local CSM contract | `contracts/**`, `csm/versions/**`, vNext CSM package consumption |
| Recognition | `runCanonicalListingPath` / `runDirectCsmAsset` on ingest+direct | `bin/lynca.mjs identify` → `orchestrateRun`; `vnext/bin/lynca-vnext.mjs identify` |
| Persistence checkpoint | Supabase CSM stage packets, listing assets/runs | Local artifact directory; no writer-durable checkpoint |
| Projection | `csm-projection-activation.mjs`, `finishCanonicalTitle` | `projection/` + orchestrator projection artifact |
| Composer | `composeActiveCanonicalFields` in `thin-listing-path.mjs` | Classic eBay listing projection; vNext `compose` via CSM profile |
| Recovery | `api/listing-manual-recovery.js`, staged ingest resume | Fail-closed hold in the run manifest; not a writer recovery product |

The gamma-53 arm named `runtime_active_high_low` is **not** Runtime. `experiments/luna-parity/luna-parity-core.mjs` imports `lib/listing/thin/thin-listing-path.mjs`, `csm-provider-adapter.mjs`, `csm-model-execution-contract.mjs`, `captured-production-e1ae-assets.mjs`, and `csm-projection-activation.mjs`. Numbers under `experiments/luna-parity/shadow-53-gamma/scored/` compare two Listing Copilot-internal arms. They are not `lynca-runtime/main` vs `lynca-listing-copilot/main` and must not be pasted into COS-62 scores.

## 5. PAI recommendation (not a Founder decision)

**Recommended executable convergence boundary while COS-62 stays open:** keep Listing Copilot as the Production operational shell (auth, tenant, Supabase, Writer Journey, protected exact-main deploy), and make recognition/understanding consume a **versioned Runtime package or API** at a pinned SHA — the same independent process this PR can spawn, default-off, fail-closed.

That is Option A at the execution-chain boundary (Listing consumes Runtime), which is also what Runtime ADR-0004 already wrote: Listing Copilot should consume, not redefine, Runtime. Option B (Runtime absorbs Listing Copilot production capabilities) remains a live COS-62 option and matches Fei’s stated long-term preference. It is **not** selected here because:

- Runtime `8a75ff73` does not yet have auth/tenant/Supabase/Writer Journey/protected deploy.
- Moving Production write authority would be a new deploy chain, which Fei’s 2026-08-17 note forbids during shadow comparison.
- There are still no independent-arm scores on the frozen 53-case cohort.

Do not claim a surviving repo. Do not close COS-62.

## 6. Migration sequence and rollback (preserve current Production)

1. **Now (this PR, not a deploy):** fail-closed independent Runtime shadow + true dual-consumer harness + this pack. Shadow default off. Production APIs do not import the adapter.
2. **Do not merge or rewrite lynca-csm#3.** When that draft lands, pin the exact CSM candidate in both consumers. Do not invent a local CSM copy as pin proof.
3. **Shadow conformance:** Listing Copilot already is one consumer. Runtime shadow (pinned SHA, same approved front/back hashes) is the second. Arms must not read each other. Golden labels stay sealed until execution completes.
4. **Frozen 53-case live comparison** only when: Runtime checkout at `8a75ff73…` (or a later Founder-pinned SHA), approved image bytes, explicit non-CI provider allowance, cost bound, and stop condition. Report Fei’s eight axes separately. Do not collapse to F1.
5. **Founder + PAI review** of this pack plus live scores. Record the surviving implementation in the COS-62 description only after that review.
6. **If Option A proceeds:** publish a versioned Runtime package/API; Listing Copilot production path swaps the understanding arm behind the existing ingest/direct receipts; Writer Journey and deploy workflow stay.
7. **If Option B proceeds:** migrate auth/tenant/Supabase/Writer Journey/protected deploy into Runtime with contract tests; Production cutover still uses Listing Copilot’s current exact-main workflow until an explicit later decision replaces it. That replacement is out of scope for this pack.

**Rollback while shadow exists:** leave `LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED` unset/false (the default). Shadow receipts never write writer-visible title or persistence. Production remains `origin/main` @ `2fe6c2db…` until a later exact-main deploy that is not this PR. Do not deploy this branch.

## 7. Proposed gate for final selection (no invented calendar date)

Final COS-62 selection may proceed only when **all** of the following are true:

1. No unsupported/fabricated claims on either arm (absolute; not traded against drop order).
2. Both consumers pin the same CSM package after lynca-csm#3 lands.
3. The comparison harness rejects any arm whose import graph is Listing Copilot `lib/listing/thin/*` posing as Runtime.
4. The frozen 53-case cohort has been executed with independent implementations; goldens opened only after execution completes.
5. The eight Fei axes are reported separately, including Founder blind preference and production-infra preservation/migration cost.
6. Rollback of the understanding-arm swap is proven without a second Production chain.
7. Fei and PAI record the surviving implementation in the COS-62 description.

A calendar date would be invented. The gate is the date.

## 8. Explicit non-authorization

This pack and PR #312 do **not** authorize:

- repository deletion or archival
- Production cutover or traffic promotion
- schema migration
- enabling `LISTING_FEEDBACK_RETENTION_ENABLED` or `LISTING_APPROVED_MEMORY_ENABLED`
- merging this PR or deploying it
- merging or rewriting lynca-csm#3
- selecting the surviving Listing Application as decided

Approved state remains **coexistence without destructive convergence**, with Listing Copilot `origin/main` as the only Production source of truth.

## 9. What this PR actually landed (engineering)

- Fail-closed independent Runtime shadow in `lib/listing/evaluation/independent-runtime-shadow.mjs`. Default off. Forbidden in `NODE_ENV`/`VERCEL_ENV` production. Fail-closed if checkout/SHA/CLI is absent, if the checkout is this Listing Copilot repo, if it lives under `/tmp`, or if stdout is empty. CI cannot enable unpaid provider calls. Production handlers do not import it.
- Dual-consumer harness in `lib/listing/evaluation/dual-consumer-comparison.mjs` using the frozen 53-case cohort metadata. Goldens stay sealed. Score slots are empty. `runtime_active_high_low` is rejected as a Runtime arm.
- Offline tests in `test:production`. No deploy workflow edits.

Live cohort execution was not run: image paths in `experiments/luna-parity/shadow-53-gamma/input/dataset.json` point at `/private/tmp/csmdata-over80-20260815/assets/...` (absent here), Runtime could not be cloned with this workspace token, and CI must not fire unpaid provider calls.
