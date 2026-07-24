#!/usr/bin/env node

import assert from "node:assert/strict";
import { runV4ControlPlaneSoakJob } from "../api/v4/listing-job-worker.js";
import { normalizeV4JobInput, v4JobTypes } from "../lib/listing/v4/jobs/production-job-queue.mjs";

const publicAttempt = normalizeV4JobInput({
  batchId: "batch-public-attempt",
  operatorId: "operator-public-attempt",
  job: {
    asset_id: "asset-public-attempt",
    job_type: "CONTROL_PLANE_SOAK",
    payload: { job_type: "CONTROL_PLANE_SOAK" }
  }
});
assert.equal(
  publicAttempt.job_type,
  v4JobTypes.FINAL_ASSISTED_TITLE,
  "the public queue normalizer must not expose the internal soak job type"
);

await assert.rejects(
  runV4ControlPlaneSoakJob({ attempt_count: 1 }),
  (error) => error.code === "CONTROL_PLANE_SOAK_DISABLED" && error.retryable === false
);

const enabledEnv = {
  VERCEL_ENV: "preview",
  V4_CONTROL_PLANE_SOAK_ENABLED: "true"
};
await assert.rejects(
  runV4ControlPlaneSoakJob({
    attempt_count: 1,
    payload: { soak_failures_before_success: 1 }
  }, { env: enabledEnv }),
  (error) => error.code === "PROVIDER_TIMEOUT" && error.retryable === true
);

const completed = await runV4ControlPlaneSoakJob({
  attempt_count: 2,
  recognition_session_id: "v4sess_control_plane_soak",
  payload: { soak_failures_before_success: 1, soak_delay_ms: 5 }
}, {
  env: enabledEnv,
  sleep: async () => undefined
});
assert.equal(completed.response.ok, true);
assert.equal(completed.response.provider_result.provider_calls, 0);
assert.equal(completed.response.provider_result.provider_call_skipped, true);
assert.equal(completed.response.route, "CONTROL_PLANE_SOAK");

console.log("Track C control-plane soak job tests passed");
