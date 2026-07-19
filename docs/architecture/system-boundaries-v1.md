# Listing Copilot system boundaries v1

## Decision

Listing Copilot evolves through stable contracts, not shared implementation
objects. The dependency direction is:

```text
Presentation -> Client SDK -> Application contracts -> Domain ports
                                             |
                                             v
                                      Infrastructure adapters
```

Algorithms, persistence rows, provider options, queue stages, and storage paths
are implementation details. They must not become browser-owned truth.

## First production slice

### Recognition request

The browser submits a product intent:

```json
{
  "recognition_contract_version": "recognition-request-v1",
  "recognition_profile": "writer-assisted-v1",
  "asset_id": "asset_..."
}
```

The browser does not choose providers, models, retrieval switches, prompt paths,
or L1/L2 queue stages. `recognition-profile-adapter.mjs` resolves the public
profile to the current internal execution plan on the server.

Legacy internal evaluation requests without a profile remain temporarily
compatible. This is a migration window, not the long-term public contract.

### Writer response

Every job status includes `writer_view_model` with a versioned product shape:

```json
{
  "schema_version": "writer-job-view-v1",
  "status": "FINAL_READY",
  "title": { "value": "...", "editable": true },
  "actions": ["ACCEPT", "EDIT", "REJECT"],
  "warnings": []
}
```

Operational users may additionally receive queue and provider diagnostics.
Writer presentation code must consume the view model first and use the legacy
shape only as a rollout fallback.

### Browser dependency boundary

`app/listing-copilot.js` imports domain capabilities only through
`lib/listing/client/listing-copilot-sdk.mjs`. The facade is an anti-corruption
layer while media preparation, polling, and presentation modules continue to
evolve internally.

## Protected algorithm zone

This slice does not change recognition routing, prompts, OCR, retrieval,
candidate selection, evidence resolution, title rendering, scoring, or model
configuration. The adapter reproduces the previous browser defaults so the
runtime behavior remains stable while ownership moves server-side.

## Next boundaries

1. Move session polling to the same Writer View Model contract.
2. Separate execution records from durable knowledge projections.
3. Put the recognition monolith behind a small `RecognitionEngine` port.
4. Replace legacy internal request overrides with authenticated evaluation
   profiles, then reject algorithm controls at the public enqueue boundary.
5. Keep queue, storage, auth, and monitoring generic through task and asset
   references rather than card-specific payload fields.
