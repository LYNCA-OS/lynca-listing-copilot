import assert from "node:assert/strict";
import { readV4Rows } from "../lib/listing/v4/session/supabase-rest.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  V4_SUPABASE_READ_ATTEMPTS: "2"
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

let retryCalls = 0;
const recovered = await readV4Rows({
  table: "v4_recognition_jobs",
  env,
  fetchImpl: async () => {
    retryCalls += 1;
    return retryCalls === 1
      ? response(503, { message: "transient" })
      : response(200, [{ id: "job-1" }]);
  }
});
assert.equal(recovered.ok, true);
assert.equal(retryCalls, 2, "read-only PostgREST failures should receive one bounded retry");
assert.equal(recovered.rows[0].id, "job-1");

let badRequestCalls = 0;
const rejected = await readV4Rows({
  table: "v4_recognition_jobs",
  env,
  fetchImpl: async () => {
    badRequestCalls += 1;
    return response(400, { message: "bad query" });
  }
});
assert.equal(rejected.ok, false);
assert.equal(badRequestCalls, 1, "non-retryable query errors must fail immediately");

console.log("V4 Supabase read retry tests passed.");
