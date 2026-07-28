# Structural debt repair: owner boundaries and proof status

Date: 2026-07-28
Scope: stacked implementation over the offline structural audit; no production deployment.

## Outcome

The repair keeps accuracy strategy and runtime transport separate. It repairs
lossy adapters, request ownership, cache truthfulness, OCR revision identity,
durable enqueue boundaries, and evaluation telemetry without enabling the
exact-anchor Provider bypass or feeding Product Schema output into production
decisions.

| Boundary | Repair | Runtime authority after repair | Proof required before release |
| --- | --- | --- | --- |
| Serial tri-state | Preserve `true / false / unknown` across result and candidate adapters | existing SEM/Resolver owner | fixtures for all three states |
| Catalog subject alias | Bridge `subjects -> players` before existing permission checks | Candidate Application, then Resolver | no overwrite of canonical current-image subject |
| Product Schema | Versioned adapter and offline evaluator; production Native Core imports it zero times | offline audit only | 185/185 source rows validate |
| Pre-L2 anchor | Bounded, versioned route/input trace; shadow result only | no production field or Provider-skip authority | nonzero direct lookup, independent identity precision, Resolver/Renderer parity |
| Browser request | Client sends business intent and telemetry only | server profile owns provider/model/cache/evidence/queue behavior | forbidden-control and payload-size tests |
| Preingestion | Server binds fields and worker/provider options | server preingestion profile | public worker access denied; body bounded |
| OCR identity | Job key includes immutable Cloud Run worker revision; old evidence remains audit-only | only the current revision may enter live evidence | current key retained; stale or missing revision rejected |
| OCR release | Cloud Run traffic moves to latest, then `/readyz` must report that exact immutable revision before Vercel may bind it | deployment script, not application fallback | traffic and ready-revision source contract |
| Identity cache | Active Catalog, OCR/Recognition worker, and actual dated Provider request model fail closed | writer final > approved memory > AI terminal replay | paired cold/replay proof with state fidelity |
| Cache preflight | OCR runtime observations are trace data, not pipeline-version inputs; pre/post bundle keys stay identical | deployment configuration and code-owner versions only | bundle attachment does not change key; configured revision changes do |
| Pipeline fingerprint | Owner versions plus generated decision-source manifest | cache contract only | generated manifest `--check` in CI |
| Evaluation packet | Compare expected semantic values, never fabricated ranks, and preserve authoritative reasons | evaluation only | missing stages are explicit `UNKNOWN` or `TRACE_MISSING` |
| Server capture quality | Dimensions and aspect remain tri-state metadata; without a visual analyzer, glare is `UNKNOWN` | visual evidence owner remains unchanged | missing dimensions never become degraded; metadata never claims `GLARE_CLEAR` |
| UI start boundary | Upload/preingest may happen before click; paid recognition may not | durable click-committed batch intent | source contract and writer-flow tests |
| Queue workflow identity | Server-canonical generation, image hash, decision fingerprint, and authorized retry lineage; browser nonce excluded; operator retained for ownership | writer-owned batch/session/job | same-writer refresh is one workflow; different writers keep isolated Accept/Edit state |
| Post-click OCR intent | Atomic recognition enqueue writes a durable outbox row; strict generation match and leased reconciliation materialize OCR jobs | database outbox, not Vercel `waitUntil` | lost wake, bundle-not-ready, 503, and lease-expiry recovery tests; migration before code |
| OCR terminal recovery | Ordinary duplicate never revives terminal OCR; one server-authorized retry lineage may reset only `FAILED/CANCELLED` jobs and never an active lease | service-role database RPC | ordinary repeat, once-only lineage, same-lineage exhaustion, and active-lease tests |

## Explicit non-changes

- Exact-anchor finalization remains Shadow and cannot skip Provider.
- Product Schema remains offline-only and cannot affect a title.
- Provider concurrency remains `2`.
- Queue claim and lease semantics are not relaxed.
- Cross-writer Queue rows are not merged. Verified-content cache replay remains
  the independent cross-writer Provider-deduplication layer.
- Renderer remains the sole owner of the final 80-character title.
- No Catalog candidate may copy serial numerator, grade, certificate,
  condition, or current-card defects.

## Deliberately isolated accuracy debt: B5 `cert_number`

The audit's B5 remains open. The general `normalizeFields()` contract does not
project Provider certificate numbers. That function also normalizes Catalog
candidate data, so adding `cert_number` there would make a current-entity field
available to the wrong source class and would silently change accuracy
strategy.

This structural repair therefore does not claim B5 is fixed. B5 requires a
separate source-aware Accuracy PR with all of these boundaries:

- input may come only from current-image Provider or slab evidence;
- Catalog and candidate rows cannot supply a certificate number;
- the field still passes the existing Resolver safety owner;
- no accepted value becomes identity truth or GT through this change;
- the evaluation must report source, normalization decision, and drop reason.

Leaving B5 isolated is intentional separation, not an accidental omission.

## Release evidence classes

Source and contract tests are only one evidence class. They do not imply that
a database migration was applied, a Preview behaved like production, a shadow
route changed real output, or a real writer completed the UI Journey.

| Evidence class | Status of this repair | What is not proven |
| --- | --- | --- |
| Source and local contract tests | implementation-level evidence only | hosted database, deployment, and real user path |
| Queue uniqueness/outbox migration | migration file and local behavior may be tested | not applied or verified on any hosted environment by this repair |
| Preview deployment | not performed | auth, upload, Queue, Worker, and L2 on Preview |
| Production deployment | not performed | production configuration, health, traffic, and rollback |
| Production Writer Journey | not performed | real cookie, real upload, enqueue, Worker, L2, Accept/Edit, and persistence |
| Exact-anchor route | Shadow only | no production Provider skip and no production latency claim |
| Product Schema | offline only | no production candidate, Resolver, or title effect |

The Queue uniqueness/outbox migration must be applied and verified before its
matching API code can be released. Tests that exercise it in an ephemeral
Postgres instance are not evidence of a hosted migration.

Dependency remediation is a separate security release track. This structural
repair must not hide a failing dependency audit or fold a lockfile migration
into unrelated architecture changes.

The route-specific latency budgets and their mathematical bounds are defined
in [`v4-latency-path-budget-2026-07-28.md`](./v4-latency-path-budget-2026-07-28.md).
