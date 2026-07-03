import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkWorkflowContextSchema,
  main,
  parseEnvFileContent,
  requiredWorkflowContextColumns,
  resolveSchemaCheckConfig
} from "./check-feedback-workflow-context-schema.mjs";

function makeResponse({ ok = true, status = 200, body = "[]" } = {}) {
  return {
    ok,
    status,
    text: async () => body
  };
}

const parsedEnv = parseEnvFileContent(`
# comment
SUPABASE_URL="https://supabase.test/"
SUPABASE_SERVICE_ROLE_KEY='test-local-key'
EMPTY_VALUE=
export SUPABASE_SCHEMA_CHECK_TIMEOUT_MS=99
`);
assert.equal(parsedEnv.SUPABASE_URL, "https://supabase.test/");
assert.equal(parsedEnv.SUPABASE_SERVICE_ROLE_KEY, "test-local-key");
assert.equal(parsedEnv.SUPABASE_SCHEMA_CHECK_TIMEOUT_MS, "99");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lynca-schema-check-"));
fs.writeFileSync(path.join(tempDir, ".env.local"), "SUPABASE_URL=https://file.supabase.test\nSUPABASE_SERVICE_ROLE_KEY=file-secret\n");
const fileConfig = resolveSchemaCheckConfig({
  cwd: tempDir,
  argv: ["--env-file", ".env.local"],
  env: {}
});
assert.equal(fileConfig.mode, "supabase_rest");
assert.equal(fileConfig.supabaseUrl, "https://file.supabase.test");
assert.deepEqual(fileConfig.loaded_env_files, [".env.local"]);

const missingConfig = await checkWorkflowContextSchema({
  argv: ["--no-env-file"],
  env: {},
  cwd: tempDir,
  fetchImpl: async () => {
    throw new Error("fetch should not run without config");
  }
});
assert.equal(missingConfig.ok, false);
assert.equal(missingConfig.mode, "not_configured");
assert.equal(missingConfig.required_columns.length, requiredWorkflowContextColumns.length);
assert.equal(missingConfig.required_columns[0].ok, null);

const okRequests = [];
const okResult = await checkWorkflowContextSchema({
  argv: ["--no-env-file"],
  env: {
    SUPABASE_URL: "https://supabase.test/",
    SUPABASE_SERVICE_ROLE_KEY: "test-local-key"
  },
  cwd: tempDir,
  fetchImpl: async (url, options = {}) => {
    okRequests.push({
      url: String(url),
      authorization: options.headers?.authorization
    });
    return makeResponse();
  }
});
assert.equal(okResult.ok, true);
assert.equal(okResult.summary.column_ok_count, requiredWorkflowContextColumns.length);
assert.equal(okRequests.length, requiredWorkflowContextColumns.length);
assert.ok(okRequests.every((request) => request.url.startsWith("https://supabase.test/rest/v1/")));
assert.doesNotMatch(JSON.stringify(okResult), /test-local-key|supabase\.test/);

const missingColumnResult = await checkWorkflowContextSchema({
  argv: ["--no-env-file"],
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-local-key"
  },
  cwd: tempDir,
  fetchImpl: async (url) => {
    const endpoint = new URL(String(url));
    if (endpoint.pathname.endsWith("/listing_reviews")) {
      return makeResponse({
        ok: false,
        status: 400,
        body: "Could not find the 'workflow_summary' column of 'listing_reviews' in the schema cache"
      });
    }
    return makeResponse();
  }
});
assert.equal(missingColumnResult.ok, false);
const missingReviewColumn = missingColumnResult.required_columns.find((item) => item.table === "listing_reviews");
assert.equal(missingReviewColumn.ok, false);
assert.equal(missingReviewColumn.error_type, "COLUMN_MISSING_OR_SCHEMA_CACHE_STALE");
assert.doesNotMatch(JSON.stringify(missingColumnResult), /test-local-key|supabase\.test/);

const networkResult = await checkWorkflowContextSchema({
  argv: ["--no-env-file"],
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-local-key"
  },
  cwd: tempDir,
  fetchImpl: async () => {
    throw new Error("network down with test-local-key");
  }
});
assert.equal(networkResult.ok, false);
assert.equal(networkResult.required_columns[0].error_type, "NETWORK_ERROR");
assert.doesNotMatch(JSON.stringify(networkResult), /test-local-key/);

let stdout = "";
let stderr = "";
const missingConfigExitCode = await main(["--no-env-file", "--allow-missing-config", "--json"], {
  env: {},
  cwd: tempDir,
  fetchImpl: async () => makeResponse(),
  stdout: { write: (value) => { stdout += value; } },
  stderr: { write: (value) => { stderr += value; } }
});
assert.equal(missingConfigExitCode, 0);
assert.match(stdout, /"mode": "not_configured"/);
assert.equal(stderr, "");

stdout = "";
stderr = "";
const missingColumnExitCode = await main(["--no-env-file"], {
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-local-key"
  },
  cwd: tempDir,
  fetchImpl: async () => makeResponse({ ok: false, status: 401, body: "bad key test-local-key" }),
  stdout: { write: (value) => { stdout += value; } },
  stderr: { write: (value) => { stderr += value; } }
});
assert.equal(missingColumnExitCode, 1);
assert.match(stdout, /AUTH_401/);
assert.match(stderr, /not ready/i);
assert.doesNotMatch(stdout + stderr, /test-local-key/);

console.log("check-feedback-workflow-context-schema tests passed");
