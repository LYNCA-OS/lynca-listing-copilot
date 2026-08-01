# Production front-end verification — 2026-08-02

## Live checks

- URL: `https://listing.lyncafei.team`
- HTTP response: `200`
- Redirect: `/login?next=%2F` (expected for an unauthenticated browser)
- Rendered body: non-empty login page with the LYNCA Listing Copilot entry flow
- Browser console errors: `0`
- Framework error overlay: not present
- Visible controls: theme control and login; no visible legacy start-recognition control

The authenticated workbench could not be exercised without a real writer
account. No credentials were guessed or submitted, and no production data was
written. The production checkout was also inspected for the post-login upload
contract: the file input is `multiple`, the `start-recognition` button is
hidden/disabled, and the upload handler automatically starts recognition and
appends later files to the same lifecycle.

This proves the public entry page and the deployed UI contract, not a full
authenticated upload-to-title transaction. That final check remains a gated
manual/e2e step requiring an authorized writer session.

## Vercel request-log corroboration

The production log window also contains a completed authenticated workbench
sequence on `main`: `/app` 200, `/api/session` 200, `/api/listing-asset-create`
201, `/api/listing-image-upload-url` 200, `/api/listing-image-verify-upload`
200, `/api/csm-listing-title` 200, and `/api/v4/listing-feedback` 200. The
retired `/api/v4/listing-job-enqueue` returned 410, so this sequence did not
fall back to the old recognition chain. This is server-side corroboration of a
real prior writer session, not a substitute for a fresh authorized browser
run.

## Production timing and persistence evidence

Read-only Supabase inspection of the same production project (2026-08-02)
found 7 `CSM_THIN_DIRECT` sessions in the active log window. Six reached all
three CSM stages (`COMPLETE`) and each has exactly one
`csm_marketplace_outputs` row. One session remained `CREATED` after the
request failed before a paid result was durably settled; it has no marketplace
row, as required by the fail-closed contract.

The 22 `/api/csm-listing-title` request-log rows break down as 9 successful,
8 client/input `400`, 4 historical `503`, and 1 current `503`. For the 9
successful rows, total request duration is 3,621–5,240 ms (p50 3,749 ms,
p90 5,106 ms, p95 5,240 ms). The persisted provider summaries show Luna
latency of 3,105–4,815 ms; therefore the normal tail is dominated by the
single model request, not retired sidecars or deterministic CSM/SEM
composition.

The one current 503 took 5,257 ms and was recorded as
`ambiguous_result_lookup_unavailable`: the provider boundary became
ambiguous and the durable idempotency lookup could not be read. This is a
reliability/observability item for the cloud stage; it must not be “fixed” by
blind retries that could duplicate a paid request.
