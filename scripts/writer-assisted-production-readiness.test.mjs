#!/usr/bin/env node

import assert from "node:assert/strict";
import { runWriterAssistedProductionReadiness } from "./writer-assisted-production-readiness.mjs";

const report = await runWriterAssistedProductionReadiness({ argv: [], env: {} });
assert.equal(report.scope, "writer_assisted_production");
assert.equal(report.ready, true);
assert.equal(report.blocked_count, 0);
assert.equal(report.autonomous_accuracy_claim_ready, false);
assert.ok(report.checks.length >= 7);
assert.ok(report.checks.every((item) => item.status === "passed"));

console.log("writer assisted production readiness tests passed");
