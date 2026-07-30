# Writer intake finalized-clock source audit

Date: 2026-07-30
Scope: production, read-only
Purpose: prove that the writer-intake durability clock can be backfilled from
existing canonical evidence instead of inventing a migration-time timestamp.

## Result

- `listing_assets` rows in `FINALIZED`: **2,684**
- all canonical original verification rows inspected: **5,530**
- finalized assets with one expected original: **21**
- finalized assets with two expected originals: **2,663**
- finalized assets without a source-complete active generation: **0**
- finalized assets whose canonical-original count or role count disagreed with
  `expected_original_count`: **0**
- finalized assets with an invalid image-set hash or generation identity: **0**
- source completion clocks earlier than `listing_assets.created_at`: **0**

The safe historical clock is therefore the maximum `verified_at` among the
active generation's canonical original slots. It is a durable database fact:
the image set could not have been complete before its last required original
was verified.

## Release rule

Migration `20260730065921_v4_writer_intake_ledger_v1.sql` may backfill only when
all of these agree:

1. tenant and asset identity;
2. `image_generation_id = asset_id`;
3. a valid 64-character image-set hash;
4. canonical-eligible original roles only;
5. both row count and distinct original-role count equal
   `expected_original_count`.

The migration fails closed if any historical `FINALIZED` asset remains without
a source clock. New assets receive the clock only at the server-owned transition
to `FINALIZED`, and the clock is immutable afterwards.

## Verification class

This audit proves historical source coverage and migration addressability. It
does not prove that the migration is deployed, that PostgREST has reloaded the
schema, or that the production writer journey passes. Those remain separate
release gates.
