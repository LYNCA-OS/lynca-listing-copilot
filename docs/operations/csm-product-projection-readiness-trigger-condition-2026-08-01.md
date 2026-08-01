# CSM product projection readiness trigger-condition verification — 2026-08-01

## Outcome

The product-projection readiness RPC now fails closed when the live trigger has
the expected name, table, event, update column, enabled state, and function but
its `WHEN` condition has been changed. No remote database, deployment, asset,
frontend, or feedback path was touched.

## Defect

`public.check_csm_session_product_projection_v1()` previously checked
`pg_trigger.tgenabled`, `tgfoid`, `tgtype`, and `tgattr`. A replacement trigger
using the same binding but `WHEN (false)` satisfied all of those checks, so the
probe could report ready while product projection was inert.

## Fix

The RPC now reads the live trigger through
`pg_catalog.pg_get_triggerdef(trigger_row.oid, true)`, extracts and whitespace-
normalizes the `WHEN` expression, and compares it with the exact contract:

```sql
new.schema_version = 'csm-recognition-session-v1'::text
AND new.csm_composition_stage_status = 'COMPLETE'::text
```

PostgreSQL 17.10 was used to verify the deparser choice. Calling
`pg_get_expr(tgqual, tgrelid, true)` on this trigger fails with
`expression contains variables of more than one relation`, because a trigger
condition uses PostgreSQL's OLD/NEW pseudo-relations. `pg_get_triggerdef` is the
trigger-aware catalog deparser and exposes the condition derived from `tgqual`
without that failure.

## Verification

The real PostgreSQL test performs this sequence:

1. apply the production ledger migrations to a temporary PostgreSQL 17 cluster;
2. verify the exact trigger reports ready;
3. disable and re-enable the trigger, proving the existing enabled-state guard;
4. replace only the trigger condition with `WHEN (false)` while preserving all
   previously checked properties;
5. verify readiness returns `csm_product_projection_not_ready`;
6. recreate the exact condition and verify readiness returns ready again;
7. continue the atomic projection, rollback, legacy-scope, and conflicting-
   backfill checks.

Commands:

```sh
node scripts/csm-product-projection-migration.test.mjs
node scripts/csm-product-projection-postgres.test.mjs
npm run check:csm-thin
npm run test:csm-thin
```

All four commands passed locally. The PostgreSQL behavior test ran on
PostgreSQL `17.10 (Homebrew)` and emitted:

```json
{"ok":true,"postgres":"17.10 (Homebrew)","backfilled_sessions":2,"atomic_projection":true,"live_readiness_probe":true,"trigger_condition_tamper_rejected":true,"legacy_scope_guard":true,"invalid_sem_rolled_back":true,"conflicting_backfill_rejected":true}
```

`trigger_condition_tamper_rejected` is emitted only after both the fail-closed
and exact-condition restoration assertions pass. The complete `test:csm-thin`
chain also passed through the projection tests and the migration-ledger test.
