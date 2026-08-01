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
assert.equal(report.checks.length, 5);
assert.ok(report.checks.every((item) => item.status === "passed"));

assert.equal(cloudModelCapacityReady({
  active_path: "CSM_THIN_DIRECT",
  model: "gpt-5.6-luna",
  reasoning_effort: "none",
  capacity: { scheduler_attempt_slots: 120, baseline_working_attempts: 43, effective_reserved_attempt_ceiling: 83 }
}), true);
assert.equal(cloudModelCapacityReady({
  active_path: "CSM_THIN_DIRECT",
  model: "gpt-5.6-luna",
  reasoning_effort: "none",
  capacity: { scheduler_attempt_slots: 120, baseline_working_attempts: 43, effective_reserved_attempt_ceiling: 0 }
}), false);
assert.equal(cloudModelCapacityReady({
  active_path: "CSM_THIN_DIRECT",
  model: "gpt-5.6-luna",
  reasoning_effort: "none",
  capacity: { scheduler_attempt_slots: 120, baseline_working_attempts: 43, effective_reserved_attempt_ceiling: 84 }
}), false, "production readiness must reject a circuit-breaker reduction below the frozen optimum");
assert.equal(cloudModelCapacityReady({
  active_path: "CSM_THIN_DIRECT",
  model: "gpt-5.6-luna",
  reasoning_effort: "high",
  capacity: { scheduler_attempt_slots: 120, baseline_working_attempts: 43, effective_reserved_attempt_ceiling: 83 }
}), false);

console.log("writer assisted production readiness tests passed");
