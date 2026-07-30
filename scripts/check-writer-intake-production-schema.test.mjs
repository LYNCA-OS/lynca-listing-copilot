import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  evaluateWriterIntakeProductionSchemaSnapshot,
  normalizeSqlExpression,
  writerIntakeSnapshotTransaction,
  writerIntakeProductionSchemaContract as contract
} from "./check-writer-intake-production-schema.mjs";

const startedAt = performance.now();
const privileges = ["select", "insert", "update", "delete", "truncate", "references", "trigger", "maintain"];

function aclRow(table_name) {
  const row = { table_name };
  for (const [role, allowed] of Object.entries(contract.table_acl)) {
    for (const privilege of privileges) {
      row[`${role}_${privilege}`] = allowed.includes(privilege);
      row[`${role}_${privilege}_grant`] = false;
    }
  }
  return row;
}

function passingSnapshot() {
  return {
    tables: contract.tables.map((table_name) => ({ table_name, rls_enabled: true })),
    columns: contract.columns.map((column) => ({
      table_name: column.table,
      column_name: column.column,
      data_type: column.type,
      is_nullable: column.nullable
    })),
    functions: contract.functions.map((expected) => ({
      signature: expected.signature,
      language_name: expected.language,
      return_type: expected.return_type,
      source: expected.canonical_source,
      owner_name: "postgres",
      owner_trusted: true,
      search_path_empty: true,
      security_definer: expected.security_definer,
      public_execute: false,
      public_execute_grant: false,
      anon_execute: false,
      anon_execute_grant: false,
      authenticated_execute: false,
      authenticated_execute_grant: false,
      service_role_execute: expected.service_role_execute,
      service_role_execute_grant: false
    })),
    policies: contract.policies.map((policy) => ({
      table_name: policy.table,
      policy_name: policy.policy,
      command: policy.command,
      permissive: policy.permissive,
      roles: [...policy.roles],
      using_expression: `((${policy.using_expression}))`,
      with_check_expression: null
    })),
    indexes: contract.indexes.map((index) => ({
      table_name: index.table,
      index_name: index.index,
      is_unique: index.unique,
      is_partial: index.partial,
      method_name: index.method,
      is_valid: true,
      is_ready: true,
      definition: index.definition
    })),
    constraints: contract.constraints.map((constraint) => ({
      table_name: constraint.table,
      constraint_name: constraint.constraint,
      constraint_type: constraint.type,
      validated: true,
      definition: constraint.definition
    })),
    trigger: {
      table_name: contract.trigger.table,
      trigger_name: contract.trigger.name,
      function_signature: contract.trigger.function_signature,
      type_mask: contract.trigger.type_mask,
      enabled_state: contract.trigger.enabled_state,
      definition: contract.trigger.definition.replace(" ON listing_assets", " ON public.listing_assets").replace("FUNCTION stamp_", "FUNCTION public.stamp_")
    },
    acls: contract.tables.map(aclRow),
    invariants: Object.fromEntries(contract.invariants.map((name) => [name, 0]))
  };
}

function failureIds(snapshot) {
  return evaluateWriterIntakeProductionSchemaSnapshot(snapshot).failure_ids;
}

assert.equal(
  normalizeSqlExpression(" (((private.is_tenant_member(tenant_id) AND private.current_user_matches_operator(operator_id)))) "),
  "private.is_tenant_member(tenant_id) AND private.current_user_matches_operator(operator_id)"
);
assert.equal(writerIntakeSnapshotTransaction, "begin isolation level repeatable read read only");

const snapshot = passingSnapshot();
const passing = evaluateWriterIntakeProductionSchemaSnapshot(snapshot);
assert.equal(passing.ready, true, JSON.stringify(passing.failure_ids));
assert.equal(passing.failure_count, 0);

const missingTable = structuredClone(snapshot);
missingTable.tables.pop();
assert.ok(failureIds(missingTable).includes(`table:${contract.tables.at(-1)}`));

const extraPolicy = structuredClone(snapshot);
extraPolicy.policies.push({
  table_name: contract.tables[0],
  policy_name: "unexpected_write_policy",
  command: "ALL",
  permissive: "PERMISSIVE",
  roles: ["authenticated"],
  using_expression: "true",
  with_check_expression: "true"
});
assert.ok(failureIds(extraPolicy).includes("policy-set:writer-intake"), "additional policy must fail closed");

const wrongPolicyMode = structuredClone(snapshot);
wrongPolicyMode.policies[0].permissive = "RESTRICTIVE";
assert.ok(failureIds(wrongPolicyMode).includes(`policy:${contract.policies[0].table}.${contract.policies[0].policy}`));

const tamperedFunction = structuredClone(snapshot);
tamperedFunction.functions[0].source += "\n-- behavior-changing deployment drift";
assert.ok(failureIds(tamperedFunction).includes(`function-body:${contract.functions[0].signature}`));

const unsafeFunctionOwner = structuredClone(snapshot);
unsafeFunctionOwner.functions[0].owner_trusted = false;
assert.ok(failureIds(unsafeFunctionOwner).includes(`function:${contract.functions[0].signature}`));

const wrongFunctionLanguage = structuredClone(snapshot);
wrongFunctionLanguage.functions[0].language_name = "sql";
assert.ok(failureIds(wrongFunctionLanguage).includes(`function:${contract.functions[0].signature}`));

const wrongFunctionReturn = structuredClone(snapshot);
wrongFunctionReturn.functions[1].return_type = "text";
assert.ok(failureIds(wrongFunctionReturn).includes(`function:${contract.functions[1].signature}`));

const missingRateIndex = structuredClone(snapshot);
missingRateIndex.indexes = missingRateIndex.indexes.filter((row) => row.index_name !== "v4_writer_intake_batches_commit_rate_idx");
assert.ok(failureIds(missingRateIndex).includes("index:v4_writer_intake_batches.v4_writer_intake_batches_commit_rate_idx"));

const wrongQueueIndex = structuredClone(snapshot);
const queueIndex = wrongQueueIndex.indexes.find((row) => row.index_name === "v4_writer_intake_items_queue_job_uidx");
queueIndex.definition = "CREATE UNIQUE INDEX v4_writer_intake_items_queue_job_uidx ON public.v4_writer_intake_items USING btree (tenant_id, id) WHERE (id IS NOT NULL)";
assert.ok(failureIds(wrongQueueIndex).includes("index:v4_writer_intake_items.v4_writer_intake_items_queue_job_uidx"));

const inertTruthConstraint = structuredClone(snapshot);
const truthConstraint = inertTruthConstraint.constraints.find((row) => row.constraint_name === "v4_writer_intake_items_truth_boundary_check");
truthConstraint.definition = "CHECK (true)";
assert.ok(failureIds(inertTruthConstraint).includes("constraint:v4_writer_intake_items.v4_writer_intake_items_truth_boundary_check"));

const wrongTrigger = structuredClone(snapshot);
wrongTrigger.trigger.type_mask = 9;
wrongTrigger.trigger.definition = "CREATE TRIGGER zz_listing_assets_image_set_finalized_clock AFTER DELETE ON listing_assets FOR EACH ROW EXECUTE FUNCTION stamp_listing_asset_image_set_finalized_at()";
assert.ok(failureIds(wrongTrigger).includes("trigger:listing_assets.zz_listing_assets_image_set_finalized_clock"));

const openMutation = structuredClone(snapshot);
openMutation.acls[0].authenticated_update = true;
assert.ok(failureIds(openMutation).includes(`acl:${contract.tables[0]}`), "authenticated mutation must fail closed");

const hiddenDdlPrivilege = structuredClone(snapshot);
hiddenDdlPrivilege.acls[0].authenticated_truncate = true;
assert.ok(failureIds(hiddenDdlPrivilege).includes(`acl:${contract.tables[0]}`), "TRUNCATE must be part of the ACL contract");

const delegatedPrivilege = structuredClone(snapshot);
delegatedPrivilege.acls[0].authenticated_select_grant = true;
assert.ok(failureIds(delegatedPrivilege).includes(`acl:${contract.tables[0]}`), "grant options must fail closed");

for (const invariant of contract.invariants) {
  const violation = structuredClone(snapshot);
  violation.invariants[invariant] = 1;
  assert.ok(failureIds(violation).includes(`invariant:${invariant}`), `${invariant} must fail closed`);
}

const [ciWorkflow, packageJson] = await Promise.all([
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);
assert.match(
  ciWorkflow,
  /image:\s*postgres:17@sha256:[0-9a-f]{64}/,
  "the required CI job must use an immutable PostgreSQL 17 image"
);
assert.match(
  ciWorkflow,
  /WRITER_INTAKE_PG17_TEST_URL:\s*postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/postgres/,
  "the generic offline suite must exercise the real PostgreSQL 17 integration against its ephemeral service"
);
assert.match(
  packageJson,
  /"test:writer-intake-ledger:postgres17":\s*"REQUIRE_POSTGRES17=1 node scripts\/check-writer-intake-production-schema\.pg17\.test\.mjs"/,
  "the explicit local integration command must fail instead of silently skipping PostgreSQL 17"
);

console.log(`writer intake production schema contract tests passed in ${Math.round(performance.now() - startedAt)}ms`);
