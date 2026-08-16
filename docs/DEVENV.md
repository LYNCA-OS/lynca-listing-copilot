# Development environment — the traps that cost hours

Written 2026-08-16 after a debugging day where every item below bit at least
once. Read before running anything locally against production data.

## Network

- Direct connections to Vercel and OpenAI are blocked locally; the proxy is
  `http://127.0.0.1:7897`. Supabase REST is directly reachable.
- Node's global `fetch` ignores `HTTPS_PROXY` by default. Node >= 24 honors it
  with `NODE_USE_ENV_PROXY=1`. Without it a dev server calling OpenAI fails
  with a network error that the dispatcher then wraps as
  `LUNA_DIRECT_IDEMPOTENCY_LOOKUP_UNAVAILABLE` — which looks like a missing
  RPC and sends you digging in the wrong place.

## Dev server

```sh
set -a && source ~/.config/lynca-listing-copilot/runtime.env && set +a
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 \
PORT=3999 CSM_PERSISTENCE_ENABLED=true \
METAVERSE_AUTH_SECRET=… METAVERSE_USERNAME=metaverse METAVERSE_PASSWORD=… \
node scripts/dev-server.mjs
```

- The dev server runs **production Supabase** (the runtime.env points at the
  live project). Everything you ingest lands in `tenant_legacy`. Use
  perturbed copies of test images when you need a fresh original set.
- The Luna idempotency RPCs exist in that database, so ingest works from dev
  **only with the proxy set** (see above).
- The dev server loads code at boot: after editing `api/` or `app/`, restart
  it. Requests served by a stale process produce confidently wrong evidence.

## Replay harness (authenticated ingest without a browser)

`POST /api/listing-image-upload-url` request notes, learned the hard way:

- `signatureHex` is the **raw hex of the first 32 bytes** of the file — not a
  hash. Sending a SHA-256 digest gets
  `storage_signing_failed: "Image file signature does not match MIME type."`.
- The ingest route is `/api/csm-listing-title-ingest`: header
  `x-lynca-ingest-metadata` = base64url(JSON), body = the raw image bytes
  concatenated. The direct route (`/api/csm-listing-title`) expects a prior
  upload/verify flow.
- A byte appended after the JPEG EOI yields a new content hash (fresh
  original set) with identical pixels — the cheapest way to re-recognize the
  same card.

## Reading model behaviour from the database

- `csm_thin_provider_operations.terminal_result.fields` holds the model's raw
  output even when the route later 409s (review-required outcomes persist
  first).
- `csm_thin_provider_attempts` proves whether the provider actually ran:
  compare `started_at` vs `settled_at`. On v72-era wraps a post-provider
  checkpoint failure reported `provider_ms: null` and looked pre-provider;
  from v82 the error carries the timing (see
  `scripts/csm-checkpoint-provider-observability.test.mjs`).

## Release pins

From v82, pins are rows in `PRODUCTION_RELEASE_PIN_TABLE`
(`scripts/compatibility-bridge-release.mjs`). Add a table entry — not another
function family. `changed_paths` must exactly equal the release diff and must
always include both selector files. The runtime contract sha is computed over
the proof body without the sha itself.
