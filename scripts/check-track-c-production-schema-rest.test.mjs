#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  TRACK_C_REST_SCHEMA_CONTRACT,
  TRACK_C_SCHEMA_SECURITY_CONTRACT
} from "./check-track-c-production-schema.mjs";
import { checkTrackCProductionSchemaRest } from "./check-track-c-production-schema-rest.mjs";

const serviceRoleKey = "sb_secret_test_track_c_rest_preflight";
const supabaseUrl = "https://supabase.test";

function parseSignature(signature) {
  const match = signature.match(/^([^()]+)\((.*)\)$/);
  return {
    name: match[1],
    formats: match[2] ? match[2].split(",") : []
  };
}

function openApiProperty(format) {
  if (format === "jsonb") return { format };
  return {
    format,
    type: ["integer", "boolean"].includes(format) ? format : "string"
  };
}

function validOpenApi() {
  const definitions = Object.fromEntries(
    TRACK_C_REST_SCHEMA_CONTRACT.requiredTables.map((table) => [
      table,
      {
        type: "object",
        properties: { id: { format: "text", type: "string" } },
        required: ["id"]
      }
    ])
  );

  for (const expected of TRACK_C_REST_SCHEMA_CONTRACT.criticalColumns) {
    const definition = definitions[expected.table];
    definition.properties[expected.column] = openApiProperty(expected.format);
    if (expected.default !== undefined && expected.default !== null) {
      definition.properties[expected.column].default = expected.default;
    }
    definition.required = definition.required.filter((column) => column !== expected.column);
    if (expected.required === true) definition.required.push(expected.column);
  }

  for (const constraint of TRACK_C_SCHEMA_SECURITY_CONTRACT.constraints.filter(({ type }) => type === "f")) {
    constraint.columns.forEach((column, index) => {
      const targetTable = constraint.referencedTable.replace(/^public\./, "");
      const targetColumn = constraint.referencedColumns[index];
      const property = definitions[constraint.table].properties[column]
        || (definitions[constraint.table].properties[column] = openApiProperty("text"));
      property.description = `${property.description || ""}<fk table='${targetTable}' column='${targetColumn}'/>`;
    });
  }

  const paths = {};
  for (const signature of TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions) {
    const { name, formats } = parseSignature(signature);
    paths[`/rpc/${name}`] = {
      post: {
        parameters: [{
          in: "body",
          name: "args",
          required: true,
          schema: {
            type: "object",
            properties: Object.fromEntries(formats.map((format, index) => [
              `p_${index}`,
              openApiProperty(format)
            ]))
          }
        }]
      }
    };
  }

  const atomic = TRACK_C_REST_SCHEMA_CONTRACT.atomicEnqueueRpc;
  paths[`/rpc/${atomic.name}`].post.parameters[0].schema = {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(atomic.properties).map(([name, format]) => [name, openApiProperty(format)])
    ),
    required: [...atomic.required]
  };

  return {
    swagger: "2.0",
    host: "supabase.test:443",
    schemes: ["https"],
    info: { title: "standard public schema", version: "test" },
    definitions,
    paths
  };
}

function validCatalogSnapshot() {
  const generatedColumns = new Set([
    "canonical_state",
    "retry_count",
    "last_error",
    "error_type",
    "next_retry_at"
  ]);
  const columns = TRACK_C_REST_SCHEMA_CONTRACT.criticalColumns.map((expected) => ({
    table_name: expected.table,
    column_name: expected.column,
    data_type: expected.format,
    is_nullable: expected.required === true ? "NO" : "YES",
    column_default: expected.table === "tenants" && expected.column === "settings"
      ? "'{}'::jsonb"
      : (expected.default ?? null),
    is_generated: generatedColumns.has(expected.column) ? "ALWAYS" : "NEVER",
    generation_expression: generatedColumns.has(expected.column) ? "payload -> 'retry'" : null
  }));
  const serviceFunctions = new Set(TRACK_C_REST_SCHEMA_CONTRACT.serviceOnlyFunctions);
  const procedures = TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredFunctions.map((signature) => ({
    signature,
    anon_execute: false,
    authenticated_execute: false,
    service_execute: serviceFunctions.has(signature)
  }));
  const tableAcls = TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredTables.map((table) => ({
    table_name: table,
    anon_select: false,
    anon_insert: false,
    anon_update: false,
    anon_delete: false,
    anon_truncate: false,
    anon_references: false,
    anon_trigger: false,
    authenticated_select: false,
    authenticated_insert: false,
    authenticated_update: false,
    authenticated_delete: false,
    authenticated_truncate: false,
    authenticated_references: false,
    authenticated_trigger: false,
    service_select: true,
    service_insert: true,
    service_update: !TRACK_C_REST_SCHEMA_CONTRACT.serviceOnlyFactTables.includes(table)
      || TRACK_C_REST_SCHEMA_CONTRACT.serviceUpdatableFactTables.includes(table),
    service_delete: !TRACK_C_REST_SCHEMA_CONTRACT.serviceOnlyFactTables.includes(table)
      || TRACK_C_REST_SCHEMA_CONTRACT.serviceDeletableFactTables.includes(table)
  }));
  return {
    meta: {
      contract_version: "track_c_catalog_snapshot_v1",
      function_volatility: "s",
      security_definer: true,
      search_path: ['search_path=""'],
      request_role: "service_role"
    },
    tables: TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredTables.map((table_name) => ({
      table_name,
      present: true,
      relation_kind: "r",
      row_level_security: true
    })),
    columns,
    procedures,
    policies: TRACK_C_SCHEMA_SECURITY_CONTRACT.policies.map((policy) => ({
      tablename: policy.table,
      policyname: policy.policy,
      permissive: policy.permissive,
      roles: [...policy.roles],
      cmd: policy.command,
      qual: policy.usingExpression,
      with_check: policy.withCheckExpression
    })),
    triggers: TRACK_C_SCHEMA_SECURITY_CONTRACT.triggers.map((trigger) => ({
      table_name: trigger.table,
      trigger_name: trigger.trigger,
      function_signature: trigger.functionSignature,
      timing: trigger.timing,
      events: [...trigger.events],
      update_columns: [...trigger.updateColumns],
      row_level: trigger.rowLevel,
      tgenabled: trigger.enabledState,
      when_expression: trigger.whenExpression,
      trigger_definition: "catalog_fixture"
    })),
    constraints: TRACK_C_SCHEMA_SECURITY_CONTRACT.constraints.map((constraint) => ({
      table_name: constraint.table,
      constraint_name: constraint.constraint,
      contype: constraint.type,
      convalidated: constraint.validated,
      constrained_columns: [...constraint.columns],
      check_expression: constraint.expression || null,
      referenced_table: constraint.referencedTable || null,
      referenced_columns: [...(constraint.referencedColumns || [])],
      confupdtype: constraint.updateAction || " ",
      confdeltype: constraint.deleteAction || " ",
      confmatchtype: constraint.matchType || " ",
      condeferrable: constraint.deferrable || false,
      condeferred: constraint.initiallyDeferred || false,
      delete_set_columns: [...(constraint.deleteSetColumns || [])],
      constraint_definition: "catalog_fixture"
    })),
    indexes: TRACK_C_REST_SCHEMA_CONTRACT.requiredIndexes.map(([table_name, index_name]) => ({
      table_name,
      index_name,
      indisvalid: true,
      indisready: true
    })),
    table_acls: tableAcls,
    data_invariants: {
      duplicate_learning_feedback_links: 0,
      sem_validation_missing_provenance: 0,
      validated_sem_without_supported_evidence: 0
    },
    server: { transaction_read_only: "off", server_version_num: "170000" },
    execution_boundary: {
      storage_objects: "storage.objects",
      authenticated_storage_usage: true,
      authenticated_storage_select: true,
      authenticated_storage_insert: true,
      authenticated_storage_update: true,
      authenticated_storage_delete: true,
      service_storage_select: true,
      authenticated_heartbeat_execute: false,
      service_heartbeat_execute: true,
      heartbeat_definition: "jobs.status = 'RUNNING' and jobs.lease_owner = p_worker_id and jobs.lease_expires_at is not null and jobs.lease_expires_at > heartbeat_at",
      execution_fence_definition: "jobs.status = 'RUNNING' and jobs.lease_owner = p_worker_id and jobs.lease_expires_at > pg_catalog.clock_timestamp() and 'tenant_id', fenced_job.tenant_id and 'recognition_session_id', fenced_job.recognition_session_id and 'asset_id', fenced_job.asset_id"
    }
  };
}

function validStorageBoundarySnapshot() {
  return {
    meta: {
      contract_version: "track_c_storage_boundary_snapshot_v1",
      function_volatility: "s",
      security_definer: true,
      search_path: ['search_path=""'],
      request_role: "service_role"
    },
    storage_objects: "storage.objects",
    storage_row_level_security: true,
    storage_policies: TRACK_C_SCHEMA_SECURITY_CONTRACT.storagePolicies.map((policy) => ({
      policyname: policy.policy,
      roles: [...policy.roles],
      cmd: policy.command,
      qual: policy.usingExpression,
      with_check: policy.withCheckExpression
    }))
  };
}

function response(body, { status = 200, contentType = "application/json" } = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType }
  });
}

function mockFetchFor(
  openApi,
  requests = [],
  catalogSnapshot = validCatalogSnapshot(),
  storageBoundary = validStorageBoundarySnapshot()
) {
  return async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/rest/v1/")) {
      return response(openApi, { contentType: "application/openapi+json" });
    }
    if (String(url).endsWith("/rest/v1/rpc/track_c_production_schema_catalog_snapshot")) {
      return response(catalogSnapshot);
    }
    if (String(url).endsWith("/rest/v1/rpc/track_c_storage_boundary_snapshot")) {
      return response(storageBoundary);
    }
    if (String(url).endsWith("/rest/v1/rpc/track_c_ops_snapshot")) {
      return response({ generated_at: "2026-07-17T00:00:00.000Z" });
    }
    if (init.method === "HEAD" && String(url).includes("/rest/v1/")) {
      return new Response(null, { status: 204 });
    }
    return response({ error: "unexpected request" }, { status: 500 });
  };
}

assert.ok(
  TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions.includes(
    "enqueue_v4_recognition_batch_atomic(jsonb,jsonb,text,jsonb,text)"
  ),
  "the catalog and REST contracts must use the canonical atomic enqueue signature"
);
assert.ok(
  !TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions.includes(
    "enqueue_v4_recognition_batch_atomic(text,text,jsonb,jsonb,jsonb)"
  ),
  "the obsolete atomic enqueue signature must not remain required"
);
assert.ok(
  TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions.includes(
    "track_c_storage_boundary_snapshot()"
  ),
  "the Storage RLS boundary helper must be a required RPC"
);
assert.ok(
  TRACK_C_REST_SCHEMA_CONTRACT.serviceOnlyFunctions.includes(
    "track_c_storage_boundary_snapshot()"
  ),
  "the Storage RLS boundary helper must remain service-role-only"
);
assert.ok(
  !TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions.includes(
    "bump_active_catalog_snapshot_revision()"
  ),
  "trigger-returning catalog revision function must not be required as a PostgREST RPC"
);
assert.ok(
  !TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions.includes(
    "sync_writer_final_replay_from_session()"
  ),
  "trigger-returning writer replay function must not be required as a PostgREST RPC"
);
assert.ok(
  TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredFunctions.includes(
    "bump_active_catalog_snapshot_revision()"
  ) && TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredFunctions.includes(
    "sync_writer_final_replay_from_session()"
  ),
  "both trigger functions must remain required in the direct PostgreSQL catalog contract"
);

const requests = [];
const passingReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(validOpenApi(), requests),
  checkedAt: new Date("2026-07-17T00:00:00.000Z")
});
assert.equal(passingReport.ok, true, JSON.stringify(passingReport));
assert.equal(passingReport.failed_check_count, 0);
assert.equal(passingReport.read_only, true);
assert.ok(requests.some(({ init }) => init.method === "HEAD"));
assert.ok(requests.some(({ url, init }) => (
  url.endsWith("/rpc/track_c_ops_snapshot") && init.method === "POST" && init.body === "{}"
)));
assert.ok(requests.some(({ url, init }) => (
  url.endsWith("/rpc/track_c_storage_boundary_snapshot")
  && init.method === "POST"
  && init.body === "{}"
)));
for (const { init } of requests) {
  assert.equal(init.headers.apikey, serviceRoleKey);
  assert.equal(init.headers.authorization, `Bearer ${serviceRoleKey}`);
}
assert.ok(!JSON.stringify(passingReport).includes(serviceRoleKey), "reports must never contain the service key");

const missingTable = validOpenApi();
delete missingTable.definitions.listing_assets;
const missingTableReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(missingTable),
  activeProbes: false
});
assert.equal(missingTableReport.ok, false);
assert.ok(missingTableReport.checks.tables.some(({ table, ok }) => table === "listing_assets" && !ok));

const wrongAtomicContract = validOpenApi();
const atomicSchema = wrongAtomicContract.paths["/rpc/enqueue_v4_recognition_batch_atomic"]
  .post.parameters[0].schema;
delete atomicSchema.properties.p_sessions;
const wrongAtomicReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(wrongAtomicContract),
  activeProbes: false
});
assert.equal(wrongAtomicReport.ok, false);
assert.equal(wrongAtomicReport.checks.atomic_enqueue_rpc.ok, false);

const wrongColumn = validOpenApi();
wrongColumn.definitions.v4_recognition_jobs.properties.max_attempts.default = 5;
const wrongColumnReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(wrongColumn),
  activeProbes: false
});
assert.equal(wrongColumnReport.ok, false);
assert.ok(wrongColumnReport.checks.columns.some(({ table, column, ok }) => (
  table === "v4_recognition_jobs" && column === "max_attempts" && !ok
)));

const missingCompositeFkCatalog = validCatalogSnapshot();
missingCompositeFkCatalog.constraints = missingCompositeFkCatalog.constraints.filter(({ constraint_name }) => (
  constraint_name !== "track_c_v4_recognition_sessions_tenant_preingestion_bundle_id_f"
));
const missingCompositeFkReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(validOpenApi(), [], missingCompositeFkCatalog),
  activeProbes: false
});
assert.equal(missingCompositeFkReport.ok, false);
assert.ok(missingCompositeFkReport.checks.catalog_attestation.failed_check_count > 0);

const unexpectedWhenCatalog = validCatalogSnapshot();
unexpectedWhenCatalog.triggers[0].when_expression = "present";
const unexpectedWhenReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(validOpenApi(), [], unexpectedWhenCatalog),
  activeProbes: false
});
assert.equal(unexpectedWhenReport.ok, false);
assert.ok(unexpectedWhenReport.checks.catalog_attestation.failed_check_count > 0);

const learningWithoutUpdateCatalog = validCatalogSnapshot();
learningWithoutUpdateCatalog.table_acls.find(({ table_name }) => (
  table_name === "v4_learning_events"
)).service_update = false;
const learningWithoutUpdateReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(validOpenApi(), [], learningWithoutUpdateCatalog),
  activeProbes: false
});
assert.equal(learningWithoutUpdateReport.ok, false);
assert.ok(learningWithoutUpdateReport.checks.catalog_attestation.checks.service_only_fact_acls
  .some(({ table, ok }) => table === "v4_learning_events" && !ok));

const learningWithDeleteCatalog = validCatalogSnapshot();
learningWithDeleteCatalog.table_acls.find(({ table_name }) => (
  table_name === "v4_learning_events"
)).service_delete = true;
const learningWithDeleteReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(validOpenApi(), [], learningWithDeleteCatalog),
  activeProbes: false
});
assert.equal(learningWithDeleteReport.ok, false);
assert.ok(learningWithDeleteReport.checks.catalog_attestation.checks.service_only_fact_acls
  .some(({ table, ok }) => table === "v4_learning_events" && !ok));

const storageWithoutRls = validStorageBoundarySnapshot();
storageWithoutRls.storage_row_level_security = false;
const storageWithoutRlsReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(validOpenApi(), [], validCatalogSnapshot(), storageWithoutRls),
  activeProbes: false
});
assert.equal(storageWithoutRlsReport.ok, false);
assert.ok(storageWithoutRlsReport.checks.catalog_attestation.checks.execution_boundaries
  .some(({ boundary, ok }) => boundary === "browser_storage_rls" && !ok));

const storageWithBrowserPolicy = validStorageBoundarySnapshot();
storageWithBrowserPolicy.storage_policies.push({
  policyname: "accidental_authenticated_storage_read",
  roles: ["authenticated"],
  cmd: "SELECT",
  qual: "true",
  with_check: null
});
const storageWithBrowserPolicyReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(validOpenApi(), [], validCatalogSnapshot(), storageWithBrowserPolicy),
  activeProbes: false
});
assert.equal(storageWithBrowserPolicyReport.ok, false);
assert.ok(storageWithBrowserPolicyReport.checks.catalog_attestation.checks.execution_boundaries
  .some(({ boundary, ok }) => boundary === "browser_storage_rls" && !ok));

const storageWithWrongServicePolicy = validStorageBoundarySnapshot();
storageWithWrongServicePolicy.storage_policies.find(({ policyname }) => (
  policyname === "listing_card_images_service_role_insert"
)).with_check = "true";
const storageWithWrongServicePolicyReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: mockFetchFor(
    validOpenApi(),
    [],
    validCatalogSnapshot(),
    storageWithWrongServicePolicy
  ),
  activeProbes: false
});
assert.equal(storageWithWrongServicePolicyReport.ok, false);
assert.ok(storageWithWrongServicePolicyReport.checks.catalog_attestation.checks.execution_boundaries
  .some(({ boundary, ok }) => boundary === "browser_storage_rls" && !ok));

const failedHttpReport = await checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl: async () => response({ secret_echo: serviceRoleKey }, { status: 503 })
});
assert.equal(failedHttpReport.ok, false);
assert.equal(failedHttpReport.error_type, "OPENAPI_HTTP_ERROR");
assert.ok(!JSON.stringify(failedHttpReport).includes(serviceRoleKey));

const missingConfigReport = await checkTrackCProductionSchemaRest({});
assert.equal(missingConfigReport.ok, false);
assert.equal(missingConfigReport.error_type, "SUPABASE_REST_NOT_CONFIGURED");

console.log("track-c REST production schema preflight tests passed");
