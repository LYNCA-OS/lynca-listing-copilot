#!/usr/bin/env node

import assert from "node:assert/strict";
import { checkTrackCProductionSchema } from "./check-track-c-production-schema.mjs";

const connectionString = String(
  process.env.TRACK_C_SCHEMA_TEST_DATABASE_URL
  || ""
).trim();

if (!connectionString) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "TRACK_C_SCHEMA_TEST_DATABASE_URL is not configured",
    scope: "postgres_schema_catalog_semantics"
  }, null, 2));
  process.exit(0);
}

const report = await checkTrackCProductionSchema({ connectionString });
assert.equal(report.configured, true, "the integration preflight must use the supplied database");
assert.equal(report.read_only, true, "the integration preflight transaction must remain read-only");
assert.ok(
  Number(report.server_version_num) >= 170000,
  `the catalog integration fixture must be PostgreSQL 17+, received ${report.server_version_num}`
);
assert.equal(
  report.ok,
  true,
  `the restored production-compatible schema must satisfy the strong catalog contract: ${JSON.stringify({
    error_type: report.error_type,
    error_message: report.error_message,
    failed_check_count: report.failed_check_count,
    checks: report.checks
  })}`
);

console.log(JSON.stringify({
  ok: true,
  skipped: false,
  server_version_num: report.server_version_num,
  failed_check_count: report.failed_check_count,
  scope: "postgres_schema_catalog_semantics"
}, null, 2));
