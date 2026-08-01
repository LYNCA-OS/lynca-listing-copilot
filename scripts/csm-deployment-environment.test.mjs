#!/usr/bin/env node

import assert from "node:assert/strict";

import { checkCsmDeploymentEnvironment } from "./check-csm-deployment-environment.mjs";

const READY = {
  VERCEL_ENV: "production",
  CSM_PERSISTENCE_ENABLED: "true",
  OPENAI_API_KEY: "test-only",
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_SECRET_KEY: "test-only",
  V4_QUEUE_PUMP_DISABLED: "true",
  ENABLE_RECOGNITION_WORKER: "false",
  ENABLE_PADDLE_OCR_FIELD_VERIFIER: "false",
  ENABLE_VECTOR_RETRIEVAL: "false",
  ENABLE_VISUAL_VECTOR_RETRIEVAL: "false",
  ENABLE_QUERY_VISUAL_VECTOR_PREFLIGHT: "false",
  ENABLE_STORED_VISUAL_FEATURE_LOOKUP: "false",
  DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED: "false",
  DATA_LOOP_SIDECARS_ENABLED: "false"
};

assert.deepEqual(checkCsmDeploymentEnvironment(READY), {
  ok: true,
  skipped: false,
  target: "production"
});
assert.equal(checkCsmDeploymentEnvironment({}).skipped, true);
assert.throws(
  () => checkCsmDeploymentEnvironment({ ...READY, CSM_PERSISTENCE_ENABLED: "" }),
  (error) => error.failures.includes("CSM_PERSISTENCE_ENABLED_must_be_true")
);
assert.throws(
  () => checkCsmDeploymentEnvironment({ ...READY, ENABLE_RECOGNITION_WORKER: "true" }),
  (error) => error.failures.includes("ENABLE_RECOGNITION_WORKER_must_not_be_true")
);
assert.throws(
  () => checkCsmDeploymentEnvironment({ ...READY, V4_QUEUE_PUMP_DISABLED: "false" }),
  (error) => error.failures.includes("V4_QUEUE_PUMP_DISABLED_must_be_true")
);

console.log("CSM deployment environment tests passed");
