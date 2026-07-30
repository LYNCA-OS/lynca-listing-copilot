#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
export const ADMIN_TEST_REPLAY_MIGRATION_VERSION = "20260730120000";
export const ADMIN_TEST_REPLAY_MIGRATION_FILE =
  "20260730120000_admin_test_writer_final_replay_isolation_v1.sql";
export const ADMIN_TEST_REPLAY_MIGRATION_SHA256 =
  "ff0a401eedb97f6ecbd1a9df21aa4ced66921920b7222c68f2dd5544f8d6934f";

const migrationPath = new URL(`../supabase/migrations/${ADMIN_TEST_REPLAY_MIGRATION_FILE}`, import.meta.url);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizedSql(value) {
  return cleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function sortedStrings(values) {
  return (Array.isArray(values) ? values : []).map(cleanText).filter(Boolean).sort();
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? cleanText(argv[index + 1]) : "";
}

function safeError(error, connectionString = "") {
  return cleanText(error?.message || error || "unknown_error")
    .split(connectionString).join("[REDACTED_DATABASE_URL]")
    .slice(0, 1000);
}

function localMigrationSha256() {
  return crypto.createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex");
}

function functionContract(row, { proof = false } = {}) {
  const definition = normalizedSql(row?.definition);
  const searchPathEmpty = Array.isArray(row?.config)
    && row.config.some((setting) => /^search_path=(?:""|)$/.test(cleanText(setting)));
  const common = Boolean(
    row?.resolved_signature
    && row.owner_name === "postgres"
    && searchPathEmpty
    && row.anon_execute === false
    && row.authenticated_execute === false
    && row.service_execute === true
  );
  if (proof) {
    return {
      ok: common
        && row.return_type === "jsonb"
        && row.volatility === "s"
        && row.security_definer === true
        && definition.includes("feedback.writer_feedback ->> 'dataset_disposition'")
        && definition.includes("learning.feedback_training_event ->> 'dataset_disposition'")
        && definition.includes("active_admin_replay_for_image_count = 0")
        && /and coalesce\(\(?generation_hash ~ '\^\[0-9a-f\]\{64\}\$'(?:::text)?\)?, false\)/.test(definition)
        && definition.includes("'image_generation_hash_verified'")
        && definition.includes("'writer_final_replay_excluded'")
        && !definition.includes("writer_final_title', session.writer_final_title"),
      searchPathEmpty,
      definition
    };
  }

  const sourceLookupAt = definition.indexOf("from public.v4_writer_feedback_events feedback");
  const failClosedAt = definition.indexOf("feedback_dataset_disposition is distinct from 'observe_only'");
  const returnAfterFailClosedAt = definition.indexOf("return new;", failClosedAt);
  const replayInsertAt = definition.indexOf("insert into public.listing_writer_final_replay");
  return {
    ok: common
      && row.return_type === "trigger"
      && row.security_definer === false
      && sourceLookupAt >= 0
      && definition.includes("feedback.id = new.writer_feedback_event_id")
      && definition.includes("feedback.tenant_id = new.tenant_id")
      && definition.includes("feedback.recognition_session_id = new.id")
      && failClosedAt > sourceLookupAt
      && returnAfterFailClosedAt > failClosedAt
      && replayInsertAt > returnAfterFailClosedAt
      && !definition.includes("feedback_dataset_disposition = 'admin_test_only' then"),
    searchPathEmpty,
    sourceLookupAt,
    failClosedAt,
    returnAfterFailClosedAt,
    replayInsertAt,
    definition
  };
}

export async function collectAdminTestReplayProductionSchemaSnapshot(client) {
  const functions = await client.query(String.raw`
    with required(signature) as (
      values
        ('public.sync_writer_final_replay_from_session()'::text),
        ('public.verify_v4_admin_test_feedback_isolation(text,text,text)'::text)
    )
    select
      required.signature,
      function_row.oid::pg_catalog.regprocedure::text as resolved_signature,
      owner_role.rolname as owner_name,
      pg_catalog.format_type(function_row.prorettype, null) as return_type,
      function_row.provolatile as volatility,
      function_row.prosecdef as security_definer,
      function_row.proconfig as config,
      case when function_row.oid is null then null
        else pg_catalog.pg_get_functiondef(function_row.oid)
      end as definition,
      case when function_row.oid is null then false
        else pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
      end as anon_execute,
      case when function_row.oid is null then false
        else pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      end as authenticated_execute,
      case when function_row.oid is null then false
        else pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE')
      end as service_execute
    from required
    left join pg_catalog.pg_proc function_row
      on function_row.oid = pg_catalog.to_regprocedure(required.signature)
    left join pg_catalog.pg_roles owner_role
      on owner_role.oid = function_row.proowner
    order by required.signature
  `);

  const trigger = await client.query(String.raw`
    select
      relation.relname as table_name,
      trigger_row.tgname as trigger_name,
      pg_catalog.format(
        '%I.%I(%s)',
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      ) as function_signature,
      case
        when (trigger_row.tgtype & 2) <> 0 then 'BEFORE'
        when (trigger_row.tgtype & 64) <> 0 then 'INSTEAD OF'
        else 'AFTER'
      end as timing,
      pg_catalog.array_remove(array[
        case when (trigger_row.tgtype & 4) <> 0 then 'INSERT' end,
        case when (trigger_row.tgtype & 8) <> 0 then 'DELETE' end,
        case when (trigger_row.tgtype & 16) <> 0 then 'UPDATE' end,
        case when (trigger_row.tgtype & 32) <> 0 then 'TRUNCATE' end
      ], null)::text[] as events,
      coalesce((
        select pg_catalog.array_agg(attribute.attname::text order by trigger_column.ordinality)
        from pg_catalog.unnest(trigger_row.tgattr::smallint[])
          with ordinality as trigger_column(attribute_number, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = trigger_row.tgrelid
         and attribute.attnum = trigger_column.attribute_number
      ), array[]::text[]) as update_columns,
      (trigger_row.tgtype & 1) <> 0 as row_level,
      trigger_row.tgenabled as enabled_state,
      pg_catalog.pg_get_triggerdef(trigger_row.oid, true) as definition
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc function_row on function_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = 'v4_recognition_sessions'
      and trigger_row.tgname = 'sync_writer_final_replay_from_session'
      and not trigger_row.tgisinternal
  `);

  const index = await client.query(String.raw`
    select
      relation.relname as table_name,
      index_relation.relname as index_name,
      access_method.amname as access_method,
      index_row.indisunique as unique_index,
      index_row.indisvalid,
      index_row.indisready,
      coalesce((
        select pg_catalog.array_agg(
          pg_catalog.pg_get_indexdef(index_row.indexrelid, key_column.ordinality::integer, true)
          order by key_column.ordinality
        )
        from pg_catalog.generate_series(1, index_row.indnkeyatts) key_column(ordinality)
      ), array[]::text[]) as key_columns,
      pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid, true) as predicate,
      pg_catalog.pg_get_indexdef(index_row.indexrelid) as definition
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
    join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_am access_method on access_method.oid = index_relation.relam
    where namespace.nspname = 'public'
      and relation.relname = 'listing_writer_final_replay'
      and index_relation.relname = 'listing_writer_final_replay_source_feedback_idx'
  `);

  const invariants = await client.query(String.raw`
    select count(*)::bigint as active_admin_test_writer_final_replays
    from public.listing_writer_final_replay replay
    join public.v4_writer_feedback_events feedback
      on feedback.id = replay.source_feedback_event_id
     and feedback.tenant_id = replay.tenant_id
    where replay.replay_status = 'active'
      and pg_catalog.upper(coalesce(
            nullif(pg_catalog.btrim(feedback.writer_feedback ->> 'dataset_disposition'), ''),
            ''
          )) = 'ADMIN_TEST_ONLY'
  `);

  const migrationCatalog = await client.query(
    "select pg_catalog.to_regclass('supabase_migrations.schema_migrations')::text as relation"
  );
  let migrationHistory = { present: false, occurrence_count: 0, name: null };
  if (migrationCatalog.rows[0]?.relation) {
    const history = await client.query(String.raw`
      select count(*)::integer as occurrence_count,
             min(name)::text as name
      from supabase_migrations.schema_migrations
      where version = $1
    `, [ADMIN_TEST_REPLAY_MIGRATION_VERSION]);
    migrationHistory = {
      present: Number(history.rows[0]?.occurrence_count) === 1,
      occurrence_count: Number(history.rows[0]?.occurrence_count || 0),
      name: history.rows[0]?.name || null
    };
  }

  const server = await client.query(String.raw`
    select current_setting('transaction_read_only') as transaction_read_only,
           current_setting('server_version_num') as server_version_num
  `);

  return {
    functions: functions.rows,
    trigger: trigger.rows[0] || null,
    index: index.rows[0] || null,
    invariants: invariants.rows[0] || {},
    migrationHistory,
    server: server.rows[0] || {}
  };
}

export function evaluateAdminTestReplayProductionSchemaSnapshot(snapshot = {}) {
  const functionRows = new Map(
    (Array.isArray(snapshot.functions) ? snapshot.functions : []).map((row) => [row.signature, row])
  );
  const proofRow = functionRows.get("public.verify_v4_admin_test_feedback_isolation(text,text,text)");
  const syncRow = functionRows.get("public.sync_writer_final_replay_from_session()");
  const proof = functionContract(proofRow, { proof: true });
  const sync = functionContract(syncRow);
  const trigger = snapshot.trigger || {};
  const triggerDefinition = normalizedSql(trigger.definition);
  const triggerOk = Boolean(
    trigger.table_name === "v4_recognition_sessions"
    && trigger.trigger_name === "sync_writer_final_replay_from_session"
    && trigger.function_signature === "public.sync_writer_final_replay_from_session()"
    && trigger.timing === "AFTER"
    && JSON.stringify(sortedStrings(trigger.events)) === JSON.stringify(["UPDATE"])
    && JSON.stringify(sortedStrings(trigger.update_columns))
      === JSON.stringify(["status", "writer_feedback_event_id", "writer_final_title"])
    && trigger.row_level === true
    && trigger.enabled_state === "O"
    && /new\.status = any \(array\['accepted'::text, 'edited'::text\]\)/.test(triggerDefinition)
  );
  const index = snapshot.index || {};
  const indexOk = Boolean(
    index.table_name === "listing_writer_final_replay"
    && index.index_name === "listing_writer_final_replay_source_feedback_idx"
    && index.access_method === "btree"
    && index.unique_index === false
    && index.indisvalid === true
    && index.indisready === true
    && JSON.stringify(index.key_columns) === JSON.stringify(["tenant_id", "source_feedback_event_id"])
    && /^\(?source_feedback_event_id is not null\)?$/.test(normalizedSql(index.predicate))
  );
  const localSha = localMigrationSha256();
  const checks = [
    {
      id: "migration_checksum",
      ok: /^[a-f0-9]{64}$/.test(ADMIN_TEST_REPLAY_MIGRATION_SHA256)
        && localSha === ADMIN_TEST_REPLAY_MIGRATION_SHA256,
      expected: ADMIN_TEST_REPLAY_MIGRATION_SHA256,
      actual: localSha
    },
    {
      id: "migration_history",
      ok: snapshot.migrationHistory?.present === true
        && snapshot.migrationHistory?.occurrence_count === 1
        && snapshot.migrationHistory?.name === "admin_test_writer_final_replay_isolation_v1",
      actual: snapshot.migrationHistory || null
    },
    {
      id: "proof_rpc_contract",
      ok: proof.ok,
      actual: proofRow ? {
        resolved_signature: proofRow.resolved_signature,
        owner_name: proofRow.owner_name,
        return_type: proofRow.return_type,
        volatility: proofRow.volatility,
        security_definer: proofRow.security_definer,
        config: proofRow.config,
        anon_execute: proofRow.anon_execute,
        authenticated_execute: proofRow.authenticated_execute,
        service_execute: proofRow.service_execute
      } : null
    },
    {
      id: "replay_trigger_function_fail_closed",
      ok: sync.ok,
      actual: syncRow ? {
        resolved_signature: syncRow.resolved_signature,
        owner_name: syncRow.owner_name,
        return_type: syncRow.return_type,
        security_definer: syncRow.security_definer,
        config: syncRow.config,
        anon_execute: syncRow.anon_execute,
        authenticated_execute: syncRow.authenticated_execute,
        service_execute: syncRow.service_execute,
        source_lookup_before_guard: sync.sourceLookupAt >= 0 && sync.failClosedAt > sync.sourceLookupAt,
        guard_returns_before_insert: sync.returnAfterFailClosedAt > sync.failClosedAt
          && sync.replayInsertAt > sync.returnAfterFailClosedAt
      } : null
    },
    {
      id: "replay_trigger_binding",
      ok: triggerOk,
      actual: trigger || null
    },
    {
      id: "remediation_index_contract",
      ok: indexOk,
      actual: index || null
    },
    {
      id: "zero_active_admin_test_replays",
      ok: Number(snapshot.invariants?.active_admin_test_writer_final_replays) === 0,
      actual: Number(snapshot.invariants?.active_admin_test_writer_final_replays || 0)
    },
    {
      id: "read_only_snapshot",
      ok: snapshot.server?.transaction_read_only === "on",
      actual: snapshot.server || null
    }
  ];
  return {
    contract_version: "admin-test-writer-final-replay-production-schema-v1",
    migration: {
      version: ADMIN_TEST_REPLAY_MIGRATION_VERSION,
      file: ADMIN_TEST_REPLAY_MIGRATION_FILE,
      sha256: ADMIN_TEST_REPLAY_MIGRATION_SHA256
    },
    checks,
    failed_check_count: checks.filter(({ ok }) => ok !== true).length,
    ok: checks.every(({ ok }) => ok === true)
  };
}

export async function checkAdminTestReplayProductionSchema({
  connectionString,
  checkedAt = new Date()
} = {}) {
  const databaseUrl = cleanText(connectionString);
  if (!databaseUrl) {
    return {
      contract_version: "admin-test-writer-final-replay-production-schema-v1",
      checked_at: checkedAt.toISOString(),
      read_only: true,
      ok: false,
      failed_check_count: 1,
      error: "POSTGRES_URL_NON_POOLING is required"
    };
  }
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "admin-test-replay-production-schema-preflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000
  });
  try {
    await client.connect();
    await client.query("begin isolation level repeatable read read only");
    const snapshot = await collectAdminTestReplayProductionSchemaSnapshot(client);
    await client.query("rollback");
    return {
      ...evaluateAdminTestReplayProductionSchemaSnapshot(snapshot),
      checked_at: checkedAt.toISOString(),
      read_only: true,
      source: "postgres_repeatable_read_only"
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return {
      contract_version: "admin-test-writer-final-replay-production-schema-v1",
      checked_at: checkedAt.toISOString(),
      read_only: true,
      ok: false,
      failed_check_count: 1,
      error: safeError(error, databaseUrl)
    };
  } finally {
    await client.end().catch(() => {});
  }
}

function writeReport(report, outputPath = "") {
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, payload, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(payload);
}

async function main() {
  const report = await checkAdminTestReplayProductionSchema({
    connectionString: process.env.POSTGRES_URL_NON_POOLING,
    checkedAt: new Date()
  });
  writeReport(report, argumentValue(process.argv.slice(2), "--out"));
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
