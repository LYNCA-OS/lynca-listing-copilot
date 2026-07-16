#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TRACK_C_SCHEMA_SECURITY_CONTRACT,
  evaluateTrackCSecurityCatalog
} from "./check-track-c-production-schema.mjs";

const browserRoles = ["anon", "authenticated"];
const preflightSource = fs.readFileSync(
  new URL("./check-track-c-production-schema.mjs", import.meta.url),
  "utf8"
);

// node-postgres does not decode PostgreSQL name[] values by default. Keep every
// catalog-name array on the built-in text[] parser path, including PG17.
assert.match(preflightSource, /roles::text\[\]\s+as roles/);
assert.equal(
  [...preflightSource.matchAll(/array_agg\(attribute\.attname::text/g)].length,
  4,
  "all trigger/constraint catalog name arrays must be projected as text[]"
);
assert.equal(
  [...preflightSource.matchAll(/array\[\]::text\[\]\) as (?:update|constrained|referenced|delete_set)_columns/g)].length,
  4,
  "all empty catalog name arrays must retain the text[] OID"
);

function validSecuritySnapshot() {
  return {
    policies: TRACK_C_SCHEMA_SECURITY_CONTRACT.policies.map((policy) => ({
      tablename: policy.table,
      policyname: policy.policy,
      permissive: policy.permissive,
      roles: [...policy.roles],
      cmd: policy.command,
      qual: policy.usingExpression,
      with_check: policy.withCheckExpression
    })),
    browserAcls: TRACK_C_SCHEMA_SECURITY_CONTRACT.browserDeniedTables.map((table) => ({
      table_name: table,
      ...Object.fromEntries(browserRoles.flatMap((role) => (
        TRACK_C_SCHEMA_SECURITY_CONTRACT.browserTablePrivileges.map((privilege) => [
          `${role}_${privilege}`,
          false
        ])
      )))
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
    }))
  };
}

function failedChecks(snapshot) {
  return Object.entries(evaluateTrackCSecurityCatalog(snapshot)).flatMap(([section, checks]) => (
    Array.isArray(checks)
      ? checks.filter((check) => check.ok !== true).map((check) => ({ section, check }))
      : (checks.ok === true ? [] : [{ section, check: checks }])
  ));
}

function assertMutationFails(label, mutate, expectedSection) {
  const snapshot = structuredClone(validSecuritySnapshot());
  mutate(snapshot);
  const failures = failedChecks(snapshot);
  assert.ok(
    failures.some(({ section }) => section === expectedSection),
    `${label} must fail ${expectedSection}; failures=${JSON.stringify(failures)}`
  );
}

assert.deepEqual(failedChecks(validSecuritySnapshot()), [], "the exact catalog contract must pass");

assertMutationFails("browser SELECT grant", (snapshot) => {
  snapshot.browserAcls[0].authenticated_select = true;
}, "browser_denied_table_acls");

assertMutationFails("wrong policy command", (snapshot) => {
  snapshot.policies[0].cmd = "ALL";
}, "policies");
assertMutationFails("wrong policy role", (snapshot) => {
  snapshot.policies[0].roles = ["public"];
}, "policies");
assertMutationFails("wrong policy USING expression", (snapshot) => {
  snapshot.policies[0].qual = "true";
}, "policies");
assertMutationFails("wrong policy WITH CHECK expression", (snapshot) => {
  const policy = snapshot.policies.find((row) => row.cmd === "UPDATE");
  policy.with_check = "true";
}, "policies");
assertMutationFails("policy on service-only fact table", (snapshot) => {
  snapshot.policies.push({
    tablename: "v4_learning_events",
    policyname: "accidental_browser_read",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    cmd: "SELECT",
    qual: "true",
    with_check: null
  });
}, "service_only_fact_policies");

assertMutationFails("wrong trigger function", (snapshot) => {
  snapshot.triggers[0].function_signature = "public.noop()";
}, "required_triggers");
assertMutationFails("wrong trigger timing", (snapshot) => {
  snapshot.triggers[0].timing = "AFTER";
}, "required_triggers");
assertMutationFails("wrong trigger events", (snapshot) => {
  snapshot.triggers[0].events = ["INSERT"];
}, "required_triggers");
assertMutationFails("disabled trigger", (snapshot) => {
  snapshot.triggers[0].tgenabled = "D";
}, "required_triggers");
assertMutationFails("wrong trigger update columns", (snapshot) => {
  snapshot.triggers[0].update_columns = [];
}, "required_triggers");

assertMutationFails("wrong CHECK type", (snapshot) => {
  snapshot.constraints[0].contype = "u";
}, "expected_constraints");
assertMutationFails("wrong CHECK columns", (snapshot) => {
  snapshot.constraints[0].constrained_columns = ["status"];
}, "expected_constraints");
assertMutationFails("wrong CHECK expression", (snapshot) => {
  snapshot.constraints[0].check_expression = "true";
}, "expected_constraints");
assertMutationFails("unvalidated required constraint", (snapshot) => {
  snapshot.constraints[0].convalidated = false;
}, "expected_constraints");

const foreignKeyIndex = TRACK_C_SCHEMA_SECURITY_CONTRACT.constraints.findIndex((row) => (
  row.type === "f"
));
assert.ok(foreignKeyIndex >= 0, "fixture must include a foreign key");
assertMutationFails("wrong FK columns", (snapshot) => {
  snapshot.constraints[foreignKeyIndex].constrained_columns = ["id"];
}, "expected_constraints");
assertMutationFails("wrong FK target", (snapshot) => {
  snapshot.constraints[foreignKeyIndex].referenced_table = "public.users";
}, "expected_constraints");
assertMutationFails("wrong FK target columns", (snapshot) => {
  snapshot.constraints[foreignKeyIndex].referenced_columns = ["tenant_id"];
}, "expected_constraints");
assertMutationFails("wrong FK delete action", (snapshot) => {
  snapshot.constraints[foreignKeyIndex].confdeltype = "c";
}, "expected_constraints");

const partialSetNullIndex = TRACK_C_SCHEMA_SECURITY_CONTRACT.constraints.findIndex((row) => (
  row.deleteSetColumns?.length > 0
));
assert.ok(partialSetNullIndex >= 0, "fixture must include a partial SET NULL foreign key");
assertMutationFails("wrong partial SET NULL columns", (snapshot) => {
  snapshot.constraints[partialSetNullIndex].delete_set_columns = ["tenant_id"];
}, "expected_constraints");

const notValidIndex = TRACK_C_SCHEMA_SECURITY_CONTRACT.constraints.findIndex((row) => (
  row.validated === false
));
assert.ok(notValidIndex >= 0, "fixture must include an intentional NOT VALID constraint");
assertMutationFails("unexpected validation of compatibility constraint", (snapshot) => {
  snapshot.constraints[notValidIndex].convalidated = true;
}, "intentional_not_valid_constraints");

console.log("track-c production schema semantic contract tests passed");
