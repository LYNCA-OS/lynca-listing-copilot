#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  cloudModelCapacityReady,
  runWriterAssistedProductionReadiness
} from "./writer-assisted-production-readiness.mjs";

const report = await runWriterAssistedProductionReadiness({ argv: [], env: {} });
assert.equal(report.scope, "writer_assisted_production");
assert.equal(report.ready, true);
assert.equal(report.blocked_count, 0);
assert.equal(report.autonomous_accuracy_claim_ready, false);
assert.ok(report.checks.length >= 7);
assert.ok(report.checks.every((item) => item.status === "passed"));

assert.equal(cloudModelCapacityReady({
  default_model: "gpt-5-mini",
  openai_pool: { key_pool_size: 1, per_key_stable_concurrency: 2, global_concurrency: 2 },
  production_queue: { worker_claim_limit: 2 }
}), true);
assert.equal(cloudModelCapacityReady({
  default_model: "gpt-5-mini",
  openai_pool: { key_pool_size: 1, per_key_stable_concurrency: 2, global_concurrency: 2 },
  production_queue: { worker_claim_limit: 3 }
}), false);
assert.equal(cloudModelCapacityReady({
  default_model: "gpt-5-mini",
  openai_pool: { key_pool_size: 1, per_key_stable_concurrency: 2, global_concurrency: 2 },
  production_queue: { worker_claim_limit: 1 }
}), false, "production readiness must reject a circuit-breaker reduction below the frozen optimum");
assert.equal(cloudModelCapacityReady({
  default_model: "gpt-4.1-mini-2025-04-14",
  openai_pool: { key_pool_size: 2, per_key_stable_concurrency: 2, global_concurrency: 2 },
  production_queue: { worker_claim_limit: 2 }
}), false);

console.log("writer assisted production readiness tests passed");
