#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

export const writerIntakeSnapshotTransaction = "begin isolation level repeatable read read only";

const MIGRATION_URL = new URL("../supabase/migrations/20260730065921_v4_writer_intake_ledger_v1.sql", import.meta.url);
const PRIVILEGES = Object.freeze(["select", "insert", "update", "delete", "truncate", "references", "trigger", "maintain"]);
const INVARIANTS = Object.freeze([
  "finalized_assets_missing_clock",
  "truth_boundary_violations",
  "duplicate_queue_job_bindings",
  "duplicate_session_bindings",
  "canonical_asset_reference_violations",
  "canonical_queue_reference_violations",
  "canonical_session_reference_violations",
  "pointer_clock_violations",
  "recent_commit_budget_violations"
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function bool(value) {
  return value === true || value === "true";
}

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function key(table, name) {
  return `${table}.${name}`;
}

function collapseWhitespace(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

function wrapsEntireExpression(value) {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
    if (depth < 0) return false;
  }
  return depth === 0 && !quoted;
}

export function normalizeSqlExpression(value) {
  let normalized = collapseWhitespace(value);
  while (wrapsEntireExpression(normalized)) normalized = collapseWhitespace(normalized.slice(1, -1));
  return normalized;
}

function normalizeDefinition(value) {
  return collapseWhitespace(value);
}

function normalizeFunctionSource(value) {
  return cleanText(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalFunctionSource(functionName) {
  const migration = fs.readFileSync(MIGRATION_URL, "utf8");
  const lower = migration.toLowerCase();
  const marker = `create or replace function public.${functionName.toLowerCase()}(`;
  const declaration = lower.indexOf(marker);
  if (declaration < 0) throw new Error(`canonical function missing from migration: ${functionName}`);
  const bodyMarker = "\nas $$\n";
  const bodyMarkerIndex = lower.indexOf(bodyMarker, declaration);
  if (bodyMarkerIndex < 0) throw new Error(`canonical function body missing from migration: ${functionName}`);
  const bodyStart = bodyMarkerIndex + bodyMarker.length;
  const bodyEnd = migration.indexOf("\n$$;", bodyStart);
  if (bodyEnd < 0) throw new Error(`canonical function terminator missing from migration: ${functionName}`);
  return normalizeFunctionSource(migration.slice(bodyStart, bodyEnd));
}

function functionContract({ name, signature, returnType, securityDefiner, serviceRoleExecute, sourceSha256, owner = "postgres", requiredFragments = [], orderedFragments = [] }) {
  const source = canonicalFunctionSource(name);
  return Object.freeze({
    name,
    signature,
    return_type: returnType,
    language: "plpgsql",
    owner,
    security_definer: securityDefiner,
    service_role_execute: serviceRoleExecute,
    canonical_source: source,
    source_sha256: sourceSha256,
    required_fragments: Object.freeze(requiredFragments),
    ordered_fragments: Object.freeze(orderedFragments)
  });
}

const OPERATOR_POLICY_EXPRESSION = "private.is_tenant_member(tenant_id) AND private.current_user_matches_operator(operator_id)";

export const writerIntakeProductionSchemaContract = Object.freeze({
  version: "writer-intake-production-schema-v2",
  tables: Object.freeze(["v4_writer_intake_batches", "v4_writer_intake_items"]),
  columns: Object.freeze([
    Object.freeze({ table: "listing_assets", column: "image_set_finalized_at", type: "timestamp with time zone", nullable: true }),
    Object.freeze({ table: "v4_writer_intake_batches", column: "idempotency_key_sha256", type: "text", nullable: false }),
    Object.freeze({ table: "v4_writer_intake_batches", column: "expected_item_count", type: "integer", nullable: false }),
    Object.freeze({ table: "v4_writer_intake_batches", column: "committed_at", type: "timestamp with time zone", nullable: false }),
    Object.freeze({ table: "v4_writer_intake_items", column: "client_item_ref_sha256", type: "text", nullable: false }),
    Object.freeze({ table: "v4_writer_intake_items", column: "item_position", type: "integer", nullable: false }),
    Object.freeze({ table: "v4_writer_intake_items", column: "asset_id", type: "text", nullable: true }),
    Object.freeze({ table: "v4_writer_intake_items", column: "queue_job_id", type: "text", nullable: true }),
    Object.freeze({ table: "v4_writer_intake_items", column: "recognition_session_id", type: "text", nullable: true }),
    Object.freeze({ table: "v4_writer_intake_items", column: "pending_queue_job_id", type: "text", nullable: true }),
    Object.freeze({ table: "v4_writer_intake_items", column: "pending_predecessor_queue_job_id", type: "text", nullable: true }),
    Object.freeze({ table: "v4_writer_intake_items", column: "training_eligible", type: "boolean", nullable: false }),
    Object.freeze({ table: "v4_writer_intake_items", column: "catalog_promotion_eligible", type: "boolean", nullable: false }),
    Object.freeze({ table: "v4_writer_intake_items", column: "identity_truth", type: "boolean", nullable: false })
  ]),
  functions: Object.freeze([
    functionContract({
      name: "commit_v4_writer_intake_batch",
      signature: "commit_v4_writer_intake_batch(text,text,text,text,integer)",
      returnType: "jsonb",
      securityDefiner: true,
      serviceRoleExecute: true,
      sourceSha256: "ec36adc3d11e9a0e956dcade6abad27cabf755b8b5ad6e4fd29d5958e80885f8",
      requiredFragments: [
        "pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(",
        "pg_catalog.clock_timestamp() - interval '60 seconds'",
        "recent_batch_count >= 12",
        "recent_item_count + p_expected_item_count > 2000",
        "writer_intake_commit_rate_limited",
        "pg_catalog.generate_series(1, p_expected_item_count)",
        "writer_intake_item_set_conflict"
      ],
      orderedFragments: [
        "and batches.idempotency_key_sha256 = p_idempotency_key_sha256",
        "if committed.id is null then",
        "into recent_batch_count, recent_item_count",
        "insert into public.v4_writer_intake_batches",
        "insert into public.v4_writer_intake_items"
      ]
    }),
    functionContract({
      name: "abandon_v4_writer_intake_batch",
      signature: "abandon_v4_writer_intake_batch(text,text,text)",
      returnType: "jsonb",
      securityDefiner: true,
      serviceRoleExecute: true,
      sourceSha256: "1e20c1ebc27300cc1066eaab753fb85021a12793ae8e6c0f095c8b13824146fb",
      requiredFragments: [
        "for update",
        "items.queue_job_id is null",
        "items.recognition_session_id is null",
        "items.status in ('DECLARED', 'ASSET_ADMITTED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL')",
        "last_error_code = 'OPERATOR_ABANDONED_INPUT'"
      ]
    }),
    functionContract({
      name: "stamp_listing_asset_image_set_finalized_at",
      signature: "stamp_listing_asset_image_set_finalized_at()",
      returnType: "trigger",
      securityDefiner: false,
      serviceRoleExecute: false,
      sourceSha256: "0eb30302145c032786e8567e477396a81db918e724e0b7bf378030dd956dbc1c",
      requiredFragments: [
        "if tg_op = 'INSERT' then",
        "old.image_set_state is distinct from 'FINALIZED'",
        "new.image_set_finalized_at := pg_catalog.clock_timestamp()",
        "listing_asset_finalized_clock_immutable"
      ]
    })
  ]),
  policies: Object.freeze([
    Object.freeze({ table: "v4_writer_intake_batches", policy: "v4_writer_intake_batches_operator_select", command: "SELECT", permissive: "PERMISSIVE", roles: Object.freeze(["authenticated"]), using_expression: OPERATOR_POLICY_EXPRESSION, with_check_expression: "" }),
    Object.freeze({ table: "v4_writer_intake_items", policy: "v4_writer_intake_items_operator_select", command: "SELECT", permissive: "PERMISSIVE", roles: Object.freeze(["authenticated"]), using_expression: OPERATOR_POLICY_EXPRESSION, with_check_expression: "" })
  ]),
  indexes: Object.freeze([
    Object.freeze({ table: "v4_writer_intake_batches", index: "v4_writer_intake_batches_operator_recent_idx", unique: false, partial: false, method: "btree", definition: "CREATE INDEX v4_writer_intake_batches_operator_recent_idx ON public.v4_writer_intake_batches USING btree (tenant_id, operator_id, updated_at DESC)" }),
    Object.freeze({ table: "v4_writer_intake_batches", index: "v4_writer_intake_batches_commit_rate_idx", unique: false, partial: false, method: "btree", definition: "CREATE INDEX v4_writer_intake_batches_commit_rate_idx ON public.v4_writer_intake_batches USING btree (tenant_id, operator_id, committed_at DESC)" }),
    Object.freeze({ table: "v4_writer_intake_items", index: "v4_writer_intake_items_batch_position_idx", unique: false, partial: false, method: "btree", definition: "CREATE INDEX v4_writer_intake_items_batch_position_idx ON public.v4_writer_intake_items USING btree (tenant_id, batch_id, item_position)" }),
    Object.freeze({ table: "v4_writer_intake_items", index: "v4_writer_intake_items_queue_job_uidx", unique: true, partial: true, method: "btree", definition: "CREATE UNIQUE INDEX v4_writer_intake_items_queue_job_uidx ON public.v4_writer_intake_items USING btree (tenant_id, queue_job_id) WHERE (queue_job_id IS NOT NULL)" }),
    Object.freeze({ table: "v4_writer_intake_items", index: "v4_writer_intake_items_pending_queue_job_uidx", unique: true, partial: true, method: "btree", definition: "CREATE UNIQUE INDEX v4_writer_intake_items_pending_queue_job_uidx ON public.v4_writer_intake_items USING btree (tenant_id, pending_queue_job_id) WHERE (pending_queue_job_id IS NOT NULL)" }),
    Object.freeze({ table: "v4_writer_intake_items", index: "v4_writer_intake_items_session_uidx", unique: true, partial: true, method: "btree", definition: "CREATE UNIQUE INDEX v4_writer_intake_items_session_uidx ON public.v4_writer_intake_items USING btree (tenant_id, recognition_session_id) WHERE (recognition_session_id IS NOT NULL)" }),
    Object.freeze({ table: "v4_recognition_jobs", index: "v4_recognition_jobs_writer_intake_batch_idx", unique: false, partial: true, method: "btree", definition: "CREATE INDEX v4_recognition_jobs_writer_intake_batch_idx ON public.v4_recognition_jobs USING btree (tenant_id, operator_id, ((queue_tags ->> 'writer_intake_batch_id'::text)), created_at) WHERE ((job_type = 'FINAL_ASSISTED_TITLE'::text) AND (queue_tags ? 'writer_intake_batch_id'::text))" })
  ]),
  constraints: Object.freeze([
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_pkey", type: "p", definition: "PRIMARY KEY (id)" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_id_check", type: "c", definition: "CHECK (id ~ '^intake_[0-9a-f]{32}$'::text)" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_idempotency_check", type: "c", definition: "CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'::text)" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_expected_count_check", type: "c", definition: "CHECK (expected_item_count >= 1 AND expected_item_count <= 1000)" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_status_check", type: "c", definition: "CHECK (status = ANY (ARRAY['COMMITTED'::text, 'INTAKE_CLOSED'::text, 'CANCELLED'::text]))" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_closed_state_check", type: "c", definition: "CHECK (status = 'COMMITTED'::text AND intake_closed_at IS NULL OR (status = ANY (ARRAY['INTAKE_CLOSED'::text, 'CANCELLED'::text])) AND intake_closed_at IS NOT NULL)" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_membership_fkey", type: "f", definition: "FOREIGN KEY (tenant_id, operator_id) REFERENCES tenant_members(tenant_id, user_id) ON DELETE RESTRICT" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_idempotency_key", type: "u", definition: "UNIQUE (tenant_id, operator_id, idempotency_key_sha256)" }),
    Object.freeze({ table: "v4_writer_intake_batches", constraint: "v4_writer_intake_batches_tenant_identity_key", type: "u", definition: "UNIQUE (tenant_id, id, operator_id)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_pkey", type: "p", definition: "PRIMARY KEY (id)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_id_check", type: "c", definition: "CHECK (id ~ '^intake_item_[0-9a-f]{32}$'::text)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_ref_check", type: "c", definition: "CHECK (client_item_ref_sha256 ~ '^[0-9a-f]{64}$'::text)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_position_check", type: "c", definition: "CHECK (item_position >= 1 AND item_position <= 1000)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_status_check", type: "c", definition: "CHECK (status = ANY (ARRAY['DECLARED'::text, 'ASSET_ADMITTED'::text, 'QUEUE_ADMITTED'::text, 'WRITER_TITLE_READY'::text, 'WRITER_COMPLETED'::text, 'FAILED_RETRYABLE'::text, 'FAILED_TERMINAL'::text, 'CANCELLED'::text]))" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_durability_status_check", type: "c", definition: "CHECK (durability_status = ANY (ARRAY['PENDING'::text, 'DURABLE'::text, 'FAILED_RETRYABLE'::text, 'FAILED_TERMINAL'::text]))" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_truth_boundary_check", type: "c", definition: "CHECK (NOT training_eligible AND NOT catalog_promotion_eligible AND NOT identity_truth)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_asset_state_check", type: "c", definition: "CHECK (asset_id IS NULL AND asset_admitted_at IS NULL OR asset_id IS NOT NULL AND asset_admitted_at IS NOT NULL)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_queue_state_check", type: "c", definition: "CHECK (queue_job_id IS NULL AND queue_admitted_at IS NULL OR queue_job_id IS NOT NULL AND queue_admitted_at IS NOT NULL AND asset_id IS NOT NULL)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_pending_queue_id_check", type: "c", definition: "CHECK (pending_queue_job_id IS NULL OR pending_queue_job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'::text)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_pending_predecessor_id_check", type: "c", definition: "CHECK (pending_predecessor_queue_job_id IS NULL OR pending_predecessor_queue_job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'::text)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_writer_clock_check", type: "c", definition: "CHECK ((writer_completed_at IS NULL OR writer_ready_at IS NOT NULL) AND (asset_durable_at IS NULL OR durability_status = 'DURABLE'::text))" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_lifecycle_state_check", type: "c", definition: "CHECK (status = 'DECLARED'::text AND asset_id IS NULL AND queue_job_id IS NULL OR status = 'ASSET_ADMITTED'::text AND asset_id IS NOT NULL AND queue_job_id IS NULL OR status = 'QUEUE_ADMITTED'::text AND queue_job_id IS NOT NULL OR status = 'WRITER_TITLE_READY'::text AND queue_job_id IS NOT NULL AND writer_ready_at IS NOT NULL OR status = 'WRITER_COMPLETED'::text AND queue_job_id IS NOT NULL AND writer_ready_at IS NOT NULL AND writer_completed_at IS NOT NULL OR (status = ANY (ARRAY['FAILED_RETRYABLE'::text, 'FAILED_TERMINAL'::text, 'CANCELLED'::text])))" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_batch_fkey", type: "f", definition: "FOREIGN KEY (tenant_id, batch_id, operator_id) REFERENCES v4_writer_intake_batches(tenant_id, id, operator_id) ON DELETE RESTRICT" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_identity_key", type: "u", definition: "UNIQUE (tenant_id, batch_id, client_item_ref_sha256)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_position_key", type: "u", definition: "UNIQUE (tenant_id, batch_id, item_position)" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_asset_fkey", type: "f", definition: "FOREIGN KEY (tenant_id, asset_id) REFERENCES listing_assets(tenant_id, id) ON DELETE RESTRICT" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_queue_job_fkey", type: "f", definition: "FOREIGN KEY (tenant_id, queue_job_id) REFERENCES v4_recognition_jobs(tenant_id, id) ON DELETE RESTRICT" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_pending_predecessor_fkey", type: "f", definition: "FOREIGN KEY (tenant_id, pending_predecessor_queue_job_id) REFERENCES v4_recognition_jobs(tenant_id, id) ON DELETE RESTRICT" }),
    Object.freeze({ table: "v4_writer_intake_items", constraint: "v4_writer_intake_items_session_fkey", type: "f", definition: "FOREIGN KEY (tenant_id, recognition_session_id) REFERENCES v4_recognition_sessions(tenant_id, id) ON DELETE RESTRICT" })
  ]),
  trigger: Object.freeze({
    table: "listing_assets",
    name: "zz_listing_assets_image_set_finalized_clock",
    function_signature: "stamp_listing_asset_image_set_finalized_at()",
    type_mask: 23,
    enabled_state: "O",
    definition: "CREATE TRIGGER zz_listing_assets_image_set_finalized_clock BEFORE INSERT OR UPDATE ON listing_assets FOR EACH ROW EXECUTE FUNCTION stamp_listing_asset_image_set_finalized_at()"
  }),
  table_acl: Object.freeze({
    anon: Object.freeze([]),
    authenticated: Object.freeze(["select"]),
    service_role: Object.freeze(["select", "insert", "update"])
  }),
  invariants: INVARIANTS
});

function functionStructureOk(expected, source) {
  const normalized = normalizeFunctionSource(source);
  if (!expected.required_fragments.every((fragment) => normalized.includes(fragment))) return false;
  let cursor = -1;
  for (const fragment of expected.ordered_fragments) {
    const next = normalized.indexOf(fragment, cursor + 1);
    if (next < 0) return false;
    cursor = next;
  }
  return true;
}

function normalizedTriggerDefinition(value) {
  return normalizeDefinition(value)
    .replace(/ ON public\./, " ON ")
    .replace(/FUNCTION public\./, "FUNCTION ");
}

function exactRoleList(value) {
  return Array.isArray(value) ? [...value].map(cleanText).sort() : [];
}

export function evaluateWriterIntakeProductionSchemaSnapshot(snapshot = {}) {
  const contract = writerIntakeProductionSchemaContract;
  const checks = [];
  const tableMap = new Map((snapshot.tables || []).map((row) => [row.table_name, row]));
  for (const table of contract.tables) {
    const row = tableMap.get(table);
    checks.push({ id: `table:${table}`, ok: Boolean(row && bool(row.rls_enabled)), requirement: "table_exists_with_rls_enabled", actual: row || null });
  }

  const columnMap = new Map((snapshot.columns || []).map((row) => [key(row.table_name, row.column_name), row]));
  for (const expected of contract.columns) {
    const row = columnMap.get(key(expected.table, expected.column));
    checks.push({
      id: `column:${key(expected.table, expected.column)}`,
      ok: Boolean(row && row.data_type === expected.type && bool(row.is_nullable) === expected.nullable),
      requirement: "exact_column_type_and_nullability",
      actual: row || null
    });
  }

  const functionMap = new Map((snapshot.functions || []).map((row) => [row.signature, row]));
  for (const expected of contract.functions) {
    const row = functionMap.get(expected.signature);
    const sourceSummary = row ? {
      signature: row.signature,
      language_name: row.language_name,
      return_type: row.return_type,
      owner_name: row.owner_name,
      owner_trusted: bool(row.owner_trusted),
      security_definer: bool(row.security_definer),
      search_path_empty: bool(row.search_path_empty),
      public_execute: bool(row.public_execute),
      public_execute_grant: bool(row.public_execute_grant),
      anon_execute: bool(row.anon_execute),
      anon_execute_grant: bool(row.anon_execute_grant),
      authenticated_execute: bool(row.authenticated_execute),
      authenticated_execute_grant: bool(row.authenticated_execute_grant),
      service_role_execute: bool(row.service_role_execute),
      service_role_execute_grant: bool(row.service_role_execute_grant),
      source_sha256: sha256(normalizeFunctionSource(row.source)),
      structure_ok: functionStructureOk(expected, row.source)
    } : null;
    checks.push({
      id: `function:${expected.signature}`,
      ok: Boolean(
        row
        && row.language_name === expected.language
        && row.return_type === expected.return_type
        && row.owner_name === expected.owner
        && bool(row.security_definer) === expected.security_definer
        && bool(row.search_path_empty)
        && bool(row.owner_trusted)
        && !bool(row.public_execute)
        && !bool(row.public_execute_grant)
        && !bool(row.anon_execute)
        && !bool(row.anon_execute_grant)
        && !bool(row.authenticated_execute)
        && !bool(row.authenticated_execute_grant)
        && bool(row.service_role_execute) === expected.service_role_execute
        && !bool(row.service_role_execute_grant)
      ),
      requirement: "trusted_owner_language_return_security_and_exact_execute_acl",
      actual: sourceSummary
    });
    checks.push({
      id: `function-body:${expected.signature}`,
      ok: Boolean(
        row
        && sha256(normalizeFunctionSource(row.source)) === expected.source_sha256
        && functionStructureOk(expected, row.source)
      ),
      requirement: "canonical_migration_source_hash_and_critical_structure",
      actual: sourceSummary ? { source_sha256: sourceSummary.source_sha256, structure_ok: sourceSummary.structure_ok } : null
    });
  }

  const actualPolicies = (snapshot.policies || []).filter((row) => contract.tables.includes(row.table_name));
  const expectedPolicyKeys = contract.policies.map((row) => key(row.table, row.policy)).sort();
  const actualPolicyKeys = actualPolicies.map((row) => key(row.table_name, row.policy_name)).sort();
  checks.push({
    id: "policy-set:writer-intake",
    ok: JSON.stringify(actualPolicyKeys) === JSON.stringify(expectedPolicyKeys),
    requirement: "no_missing_or_additional_writer_intake_policy",
    actual: actualPolicyKeys
  });
  const policyMap = new Map(actualPolicies.map((row) => [key(row.table_name, row.policy_name), row]));
  for (const expected of contract.policies) {
    const row = policyMap.get(key(expected.table, expected.policy));
    checks.push({
      id: `policy:${key(expected.table, expected.policy)}`,
      ok: Boolean(
        row
        && row.command === expected.command
        && row.permissive === expected.permissive
        && JSON.stringify(exactRoleList(row.roles)) === JSON.stringify([...expected.roles].sort())
        && normalizeSqlExpression(row.using_expression) === normalizeSqlExpression(expected.using_expression)
        && normalizeSqlExpression(row.with_check_expression) === normalizeSqlExpression(expected.with_check_expression)
      ),
      requirement: "sole_operator_scoped_authenticated_permissive_select",
      actual: row || null
    });
  }

  const indexMap = new Map((snapshot.indexes || []).map((row) => [key(row.table_name, row.index_name), row]));
  for (const expected of contract.indexes) {
    const row = indexMap.get(key(expected.table, expected.index));
    checks.push({
      id: `index:${key(expected.table, expected.index)}`,
      ok: Boolean(
        row
        && bool(row.is_unique) === expected.unique
        && bool(row.is_partial) === expected.partial
        && row.method_name === expected.method
        && bool(row.is_valid)
        && bool(row.is_ready)
        && normalizeDefinition(row.definition) === normalizeDefinition(expected.definition)
      ),
      requirement: "exact_valid_ready_index_definition",
      actual: row || null
    });
  }

  const constraintMap = new Map((snapshot.constraints || []).map((row) => [key(row.table_name, row.constraint_name), row]));
  for (const expected of contract.constraints) {
    const row = constraintMap.get(key(expected.table, expected.constraint));
    checks.push({
      id: `constraint:${key(expected.table, expected.constraint)}`,
      ok: Boolean(
        row
        && row.constraint_type === expected.type
        && bool(row.validated)
        && normalizeDefinition(row.definition) === normalizeDefinition(expected.definition)
      ),
      requirement: "exact_validated_constraint_definition",
      actual: row || null
    });
  }

  const trigger = snapshot.trigger || null;
  checks.push({
    id: `trigger:${contract.trigger.table}.${contract.trigger.name}`,
    ok: Boolean(
      trigger
      && trigger.table_name === contract.trigger.table
      && trigger.trigger_name === contract.trigger.name
      && trigger.function_signature === contract.trigger.function_signature
      && integer(trigger.type_mask) === contract.trigger.type_mask
      && trigger.enabled_state === contract.trigger.enabled_state
      && normalizedTriggerDefinition(trigger.definition) === normalizedTriggerDefinition(contract.trigger.definition)
    ),
    requirement: "exact_before_insert_or_update_row_transition_clock_trigger",
    actual: trigger
  });

  const aclMap = new Map((snapshot.acls || []).map((row) => [row.table_name, row]));
  for (const table of contract.tables) {
    const row = aclMap.get(table);
    const exactAcl = row && Object.entries(contract.table_acl).every(([role, allowed]) => (
      PRIVILEGES.every((privilege) => (
        bool(row[`${role}_${privilege}`]) === allowed.includes(privilege)
        && !bool(row[`${role}_${privilege}_grant`])
      ))
    ));
    checks.push({
      id: `acl:${table}`,
      ok: Boolean(exactAcl),
      requirement: "exact_effective_table_acl_including_ddl_adjacent_privileges",
      actual: row || null
    });
  }

  const invariants = snapshot.invariants || {};
  for (const name of contract.invariants) {
    checks.push({ id: `invariant:${name}`, ok: integer(invariants[name]) === 0, requirement: "zero", actual: integer(invariants[name]) });
  }

  const failures = checks.filter((check) => !check.ok);
  return {
    schema_version: contract.version,
    ready: failures.length === 0,
    check_count: checks.length,
    failure_count: failures.length,
    checks,
    failure_ids: failures.map((check) => check.id)
  };
}

export async function collectWriterIntakeProductionSchemaSnapshot(client) {
  const contract = writerIntakeProductionSchemaContract;
  const tables = await client.query(`
    select relation.relname as table_name, relation.relrowsecurity as rls_enabled
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any($1::text[])
      and relation.relkind in ('r', 'p')
    order by relation.relname
  `, [contract.tables]);
  const columns = await client.query(`
    select table_name, column_name, data_type, (is_nullable = 'YES') as is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (
        select value ->> 'table', value ->> 'column'
        from pg_catalog.jsonb_array_elements($1::jsonb) value
      )
    order by table_name, ordinal_position
  `, [JSON.stringify(contract.columns)]);
  const functions = await client.query(`
    select
      expected.signature,
      function_row.prosecdef as security_definer,
      coalesce('search_path=""' = any(function_row.proconfig), false) as search_path_empty,
      language_row.lanname as language_name,
      pg_catalog.pg_get_function_result(function_row.oid) as return_type,
      function_row.prosrc as source,
      owner_role.rolname as owner_name,
      coalesce(
        owner_role.rolname not in ('public', 'anon', 'authenticated', 'authenticator', 'service_role')
        and (owner_role.rolsuper or owner_role.rolbypassrls),
        false
      ) as owner_trusted,
      pg_catalog.has_function_privilege('public', function_row.oid, 'EXECUTE') as public_execute,
      pg_catalog.has_function_privilege('public', function_row.oid, 'EXECUTE WITH GRANT OPTION') as public_execute_grant,
      pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE') as anon_execute,
      pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE WITH GRANT OPTION') as anon_execute_grant,
      pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE') as authenticated_execute,
      pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE WITH GRANT OPTION') as authenticated_execute_grant,
      pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE') as service_role_execute,
      pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE WITH GRANT OPTION') as service_role_execute_grant
    from unnest($1::text[]) expected(signature)
    left join pg_catalog.pg_proc function_row
      on function_row.oid = pg_catalog.to_regprocedure('public.' || expected.signature)
    left join pg_catalog.pg_language language_row on language_row.oid = function_row.prolang
    left join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
    order by expected.signature
  `, [contract.functions.map((item) => item.signature)]);
  const policies = await client.query(`
    select
      policy.tablename as table_name,
      policy.policyname as policy_name,
      policy.cmd as command,
      policy.permissive,
      policy.roles::text[] as roles,
      policy.qual as using_expression,
      policy.with_check as with_check_expression
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = any($1::text[])
    order by policy.tablename, policy.policyname
  `, [contract.tables]);
  const indexes = await client.query(`
    select
      table_row.relname as table_name,
      index_row.relname as index_name,
      index_meta.indisunique as is_unique,
      (index_meta.indpred is not null) as is_partial,
      index_method.amname as method_name,
      index_meta.indisvalid as is_valid,
      index_meta.indisready as is_ready,
      pg_catalog.pg_get_indexdef(index_row.oid) as definition
    from pg_catalog.pg_index index_meta
    join pg_catalog.pg_class index_row on index_row.oid = index_meta.indexrelid
    join pg_catalog.pg_class table_row on table_row.oid = index_meta.indrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = table_row.relnamespace
    join pg_catalog.pg_am index_method on index_method.oid = index_row.relam
    where namespace.nspname = 'public'
      and index_row.relname = any($1::text[])
    order by table_row.relname, index_row.relname
  `, [contract.indexes.map((item) => item.index)]);
  const constraints = await client.query(`
    select
      table_row.relname as table_name,
      constraint_row.conname as constraint_name,
      constraint_row.contype::text as constraint_type,
      constraint_row.convalidated as validated,
      pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as definition
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = table_row.relnamespace
    where namespace.nspname = 'public'
      and constraint_row.conname = any($1::text[])
    order by table_row.relname, constraint_row.conname
  `, [contract.constraints.map((item) => item.constraint)]);
  const trigger = await client.query(`
    select
      table_row.relname as table_name,
      trigger_row.tgname as trigger_name,
      function_row.proname || '(' || pg_catalog.oidvectortypes(function_row.proargtypes) || ')' as function_signature,
      trigger_row.tgtype::integer as type_mask,
      trigger_row.tgenabled::text as enabled_state,
      pg_catalog.pg_get_triggerdef(trigger_row.oid, true) as definition
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class table_row on table_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = table_row.relnamespace
    join pg_catalog.pg_proc function_row on function_row.oid = trigger_row.tgfoid
    where namespace.nspname = 'public'
      and table_row.relname = $1
      and trigger_row.tgname = $2
      and not trigger_row.tgisinternal
  `, [contract.trigger.table, contract.trigger.name]);
  const privilegeColumns = PRIVILEGES.flatMap((privilege) => ["anon", "authenticated", "service_role"].flatMap((role) => [
    `pg_catalog.has_table_privilege('${role}', pg_catalog.format('public.%I', expected.table_name), '${privilege.toUpperCase()}') as ${role}_${privilege}`,
    `pg_catalog.has_table_privilege('${role}', pg_catalog.format('public.%I', expected.table_name), '${privilege.toUpperCase()} WITH GRANT OPTION') as ${role}_${privilege}_grant`
  ])).join(",\n      ");
  const acls = await client.query(`
    select
      expected.table_name,
      ${privilegeColumns}
    from unnest($1::text[]) expected(table_name)
    order by expected.table_name
  `, [contract.tables]);
  const invariants = await client.query(`
    select
      (select count(*)::integer
       from public.listing_assets assets
       where assets.image_set_state = 'FINALIZED' and assets.image_set_finalized_at is null) as finalized_assets_missing_clock,
      (select count(*)::integer
       from public.v4_writer_intake_items items
       where items.training_eligible or items.catalog_promotion_eligible or items.identity_truth) as truth_boundary_violations,
      (select count(*)::integer
       from (select tenant_id, queue_job_id from public.v4_writer_intake_items where queue_job_id is not null group by tenant_id, queue_job_id having count(*) > 1) duplicates) as duplicate_queue_job_bindings,
      (select count(*)::integer
       from (select tenant_id, recognition_session_id from public.v4_writer_intake_items where recognition_session_id is not null group by tenant_id, recognition_session_id having count(*) > 1) duplicates) as duplicate_session_bindings,
      (select count(*)::integer
       from public.v4_writer_intake_items items
       left join public.listing_assets assets
         on assets.tenant_id = items.tenant_id and assets.id = items.asset_id
       where items.asset_id is not null
         and (assets.id is null or assets.image_set_state is distinct from 'FINALIZED' or assets.image_set_finalized_at is null)) as canonical_asset_reference_violations,
      (select count(*)::integer
       from public.v4_writer_intake_items items
       left join public.v4_writer_intake_batches batches
         on batches.tenant_id = items.tenant_id and batches.id = items.batch_id and batches.operator_id = items.operator_id
       left join public.v4_recognition_jobs jobs
         on jobs.tenant_id = items.tenant_id and jobs.id = items.queue_job_id
       where items.queue_job_id is not null
         and (
           batches.id is null or jobs.id is null
           or jobs.operator_id is distinct from items.operator_id
           or jobs.asset_id is distinct from items.asset_id
           or jobs.recognition_session_id is null
           or items.recognition_session_id is null
           or jobs.recognition_session_id is distinct from items.recognition_session_id
           or jobs.job_type is distinct from 'FINAL_ASSISTED_TITLE'
           or jobs.queue_tags ->> 'writer_intake_batch_id' is distinct from items.batch_id
           or jobs.queue_tags ->> 'writer_intake_item_id' is distinct from items.id
           or jobs.created_at < batches.committed_at
           or items.queue_admitted_at is distinct from jobs.created_at
         )) as canonical_queue_reference_violations,
      (select count(*)::integer
       from public.v4_writer_intake_items items
       left join public.v4_recognition_sessions sessions
         on sessions.tenant_id = items.tenant_id and sessions.id = items.recognition_session_id
       where items.recognition_session_id is not null
         and (
           sessions.id is null
           or sessions.operator_id is distinct from items.operator_id
           or sessions.asset_id is distinct from items.asset_id
         )) as canonical_session_reference_violations,
      (select count(*)::integer
       from public.v4_writer_intake_items items
       where (items.asset_id is null) is distinct from (items.asset_admitted_at is null)
          or (items.queue_job_id is null) is distinct from (items.queue_admitted_at is null)
          or (items.queue_job_id is not null and items.asset_id is null)
          or (items.writer_completed_at is not null and items.writer_ready_at is null)
          or (items.asset_durable_at is not null and items.durability_status is distinct from 'DURABLE')) as pointer_clock_violations,
      (select count(*)::integer
       from (
         select batches.tenant_id, batches.operator_id
         from public.v4_writer_intake_batches batches
         where batches.committed_at >= pg_catalog.clock_timestamp() - interval '60 seconds'
         group by batches.tenant_id, batches.operator_id
         having count(*) > 12 or sum(batches.expected_item_count) > 2000
       ) over_budget) as recent_commit_budget_violations
  `);
  return {
    tables: tables.rows,
    columns: columns.rows,
    functions: functions.rows,
    policies: policies.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    trigger: trigger.rows[0] || null,
    acls: acls.rows,
    invariants: invariants.rows[0] || {}
  };
}

function argumentValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function safeError(error) {
  return {
    error_type: cleanText(error?.code || error?.name || "WRITER_INTAKE_SCHEMA_ERROR").slice(0, 120),
    error_message: cleanText(error?.message || error || "writer_intake_schema_error").replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-db-url]").slice(0, 500)
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const connectionString = cleanText(env.POSTGRES_URL_NON_POOLING);
  const outputPath = argumentValue(argv, "--out");
  if (!connectionString) throw new Error("POSTGRES_URL_NON_POOLING is required for the writer-intake production schema gate");
  const client = new Client({ connectionString, application_name: "writer-intake-production-schema-gate", statement_timeout: 30_000 });
  let report;
  try {
    await client.connect();
    await client.query(writerIntakeSnapshotTransaction);
    const snapshot = await collectWriterIntakeProductionSchemaSnapshot(client);
    report = { ...evaluateWriterIntakeProductionSchemaSnapshot(snapshot), generated_at: new Date().toISOString(), source: "postgres_repeatable_read_only" };
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    report = {
      schema_version: writerIntakeProductionSchemaContract.version,
      ready: false,
      generated_at: new Date().toISOString(),
      source: "postgres_repeatable_read_only",
      ...safeError(error)
    };
  } finally {
    await client.end().catch(() => {});
  }
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, text, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(text);
  return report.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${safeError(error).error_message}\n`);
    process.exitCode = 2;
  });
}
