# Workflow Readiness Audit

This audit is the low-cost preflight gate for Listing Copilot workflow operations.

It answers one practical question before paid recognition, cloud smoke, catalog import, or batch writer work:

```text
Which connected subsystem is actually ready, fail-closed, disabled, or blocking?
```

The audit does not call paid vision providers. It reads local/server env, performs only read-only Supabase REST schema checks when credentials are available, and never prints secrets.

## Command

Use JSON for CI or deployment logs:

```bash
npm run readiness:workflow -- --json
```

Use text for a quick local diagnosis:

```bash
npm run readiness:workflow -- --allow-not-ready
```

`--allow-not-ready` is for diagnostics only. It prevents local machines without production credentials from failing the command, but it does not mean the cloud path is ready.

## Cloud Status Integration

The same audit is also exposed through the authenticated provider status endpoint:

```text
GET /api/listing-provider-status
```

The response includes `workflow_readiness`. The browser uses `workflow_readiness.can_run_cloud_recognition` to decide whether the Generate button should be enabled. This prevents an operator from starting a paid or cloud-only recognition path when provider or storage prerequisites are missing.

The API response is sanitized and cached briefly server-side. It must not expose API keys, service-role keys, worker tokens, or full private endpoints.

## Components

The audit currently checks:

- `vision_provider`: GPT-4.1 mini production provider configuration.
- `image_storage`: Supabase Storage signed upload and signed URL flow.
- `feedback_workflow_schema`: Supabase REST visibility for workflow context columns.
- `catalog_store`: catalog staging, gap queue, and approved-reference store readiness.
- `vector_retrieval`: vector worker, model revision, retrieval mode, and assist/shadow state.
- `paddle_ocr`: field-level OCR worker configuration.
- `data_loop_sidecars`: PaddleOCR dispatch, Splink, cleanlab, Label Studio, CVAT, FiftyOne, LightGBM, Phoenix wiring.
- `marketplace_reference`: eBay Browse reference collection credentials and boundary.

## Status Meaning

`READY` means the component has enough configuration to participate in the intended path.

`BLOCKED` means a required component prevents cloud recognition or durable workflow persistence.

`FAIL_CLOSED` means the component is safe because it will not influence model output, but the system will lose that capability until it is configured.

`DISABLED` means the feature is intentionally off.

`DEGRADED` means a shell of the feature is enabled, but no real downstream tool is active.

`NOT_CONFIGURED` means required environment variables are missing.

## Operating Rule

Before paid cloud recognition or a large eBay/Supabase batch:

1. Run `npm run readiness:workflow -- --json`.
2. Do not start a paid run if `can_run_cloud_recognition=false`.
3. Do not claim vector/catalog/OCR contribution when that component is `FAIL_CLOSED`, `DISABLED`, or `DEGRADED`.
4. Treat marketplace data as reference-only even when eBay is `READY`.
5. If feedback retention is enabled, `feedback_workflow_schema` must be `READY`.

This keeps the system tight: expensive tests only run when the required path is configured, and optional subsystems cannot silently pretend to be helping.
