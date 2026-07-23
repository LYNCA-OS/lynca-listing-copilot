import assert from "node:assert/strict";
import { runNpmAuditGate } from "./npm-audit-gate.mjs";

const clean = await runNpmAuditGate({
  runAudit: async () => ({
    code: 0,
    stdout: JSON.stringify({ metadata: { vulnerabilities: { moderate: 0, high: 0, critical: 0 } } }),
    stderr: ""
  })
});
assert.equal(clean.ok, true);
assert.equal(clean.degraded, false);

await assert.rejects(() => runNpmAuditGate({
  runAudit: async () => ({
    code: 1,
    stdout: JSON.stringify({ metadata: { vulnerabilities: { moderate: 2, high: 1, critical: 0 } } }),
    stderr: ""
  })
}), (error) => error.code === "NPM_AUDIT_VULNERABILITIES");

let transportAttempts = 0;
const degraded = await runNpmAuditGate({
  attempts: 3,
  runAudit: async () => {
    transportAttempts += 1;
    return { code: 1, stdout: JSON.stringify({ error: "Service Unavailable" }), stderr: "audit endpoint returned an error" };
  },
  sleep: async () => {}
});
assert.equal(transportAttempts, 3);
assert.equal(degraded.ok, true);
assert.equal(degraded.degraded, true);
assert.equal(degraded.reason, "npm_audit_transport_unavailable");

await assert.rejects(() => runNpmAuditGate({
  runAudit: async () => ({ code: 1, stdout: "", stderr: "package tree is corrupt" })
}), (error) => error.code === "NPM_AUDIT_UNCLASSIFIED_FAILURE");

console.log("npm-audit-gate.test.mjs OK");
