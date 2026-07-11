# Production Node Observability v1

## Purpose

Recognition quality cannot be inferred from a final title alone. Every request
must expose enough safe telemetry to answer four questions:

1. Which nodes were expected to run?
2. Which nodes actually ran, failed, were skipped, or remained incomplete?
3. How many inputs entered and outputs left each node?
4. Where did evidence, candidates, fields, or persistence records disappear?

This is an audit contract, not a second decision engine. It must not change the
provider prompt, resolver, renderer, gate, or writer-visible title.

## Ledger Layers

### Pipeline ledger

Schema: `pipeline-node-ledger-v1`

The listing pipeline records bounded spans and then materializes declared
nodes for client preparation, storage access, pre-ingestion, catalog/vector
retrieval, provider inference, OCR, evidence refresh, resolution, rendering,
cache writes, and learning sidecars.

Every node reports:

- `status`: `COMPLETED`, `PARTIAL`, `FAILED`, `RUNNING`, `NOT_RUN`, or `SKIPPED`
- `expected`
- `duration_ms`
- `attempts`
- `input_count` and `output_count`
- safe `error_code` or `skip_reason`
- node-specific count metrics

### End-to-end ledger

Schema: `pipeline-end-to-end-node-ledger-v1`

The V4 job-status API wraps the pipeline ledger with enqueue, scheduler queue,
worker execution, writer readiness, and non-critical persistence. The real
lifecycle is:

```text
created -> worker started -> session L2 ready -> queue completion acknowledged
```

L1 remains internal and is not a writer-visible intermediate title.

## Reconciliation Rules

The ledger detects silent loss rather than merely collecting timings:

- OCR job count must equal the sum of job statuses.
- Current-version plus historical OCR patches must equal raw patch count.
- Prompt candidates cannot exceed approved candidates; approved candidates
  cannot exceed raw candidates.
- Provider input plus output tokens must equal total tokens when all three are
  reported.
- A successful result must have a writer title; a provider failure must not.
- Provider-observed critical fields may disappear only when explicitly routed
  to review/conflict/abstain.
- Writer-ready state, job timestamps, and persistence terminal state must be
  internally consistent.

Smoke reports aggregate node p50/p95 latency, status distributions, missing
required nodes, reconciliation failures, and per-card anomaly examples.

## Persistence Contract

Production stores the sanitized ledger in
`v4_production_quality_ledger.pipeline_node_ledger`; provider runtime metadata
is stored separately in `provider_diagnostics`.

The persistence row is a strict allow-list matching the database schema.
Prompts, raw responses, image payloads, signed URLs, credentials, seller
titles, corrected titles, and answer keys are removed before storage.

Writer readiness is not blocked by these writes. Background persistence must
write a terminal `COMPLETED`, `PARTIAL`, or `FAILED` summary back to the
recognition session, so an asynchronous failure cannot remain invisible.

## Failure Found During Implementation

Before this contract, production contained 854 V4 recognition sessions but
only 20 quality-ledger rows. The old writer passed the complete provider result
to PostgREST; fields absent from the table schema caused the write to fail, and
the non-blocking path did not publish that terminal failure.

The fix is structural:

1. normalize every quality row through a database-column allow-list;
2. persist the node ledger in explicit JSONB columns;
3. probe those columns in V4 health checks;
4. write background persistence status back to the session;
5. verify fresh cloud smokes have one quality-ledger row per recognition
   session.

## Readiness Semantics

`/api/v4/health` now separates facts that were previously conflated:

- actual default model and provider configuration;
- vector index readiness;
- vector default-request enablement and mode;
- queue configuration and worker-secret readiness;
- observability schema versions.

An index can be ready while vector retrieval is intentionally request-opt-in.
Health text must never describe this state as either "index unavailable" or
"vector enabled by default".

## Rollout Gate

Before expanding a paid smoke:

1. all offline checks pass;
2. production health is ready and reports the deployed model correctly;
3. a fresh three-card blind smoke has a ledger for every card;
4. no required node is missing without an explicit reason;
5. every recognition session has a quality-ledger row;
6. only then expand to ten fresh cards.
