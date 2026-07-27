import assert from "node:assert/strict";
import fs from "node:fs";

import {
  v4LateProviderLeaseBindingClaimTenantId,
  v4LateProviderLeaseBindingEnabled,
  waitForV4LateProviderCapacity
} from "../lib/listing/v4/jobs/late-provider-capacity.mjs";

const canaryEnv = {
  V4_LATE_PROVIDER_LEASE_BINDING: "true",
  V4_LATE_PROVIDER_LEASE_BINDING_TENANT_IDS: "tenant_canary,tenant_other",
  VERCEL_ENV: "preview"
};
assert.equal(v4LateProviderLeaseBindingEnabled({ tenantId: "tenant_canary", env: canaryEnv }), true);
assert.equal(v4LateProviderLeaseBindingClaimTenantId({ env: canaryEnv }), null);
assert.equal(v4LateProviderLeaseBindingClaimTenantId({
  env: { ...canaryEnv, V4_LATE_PROVIDER_LEASE_BINDING_TENANT_IDS: "tenant_canary" }
}), "tenant_canary");
assert.equal(v4LateProviderLeaseBindingClaimTenantId({
  tenantId: "tenant_canary",
  env: canaryEnv
}), "tenant_canary");
assert.equal(v4LateProviderLeaseBindingClaimTenantId({
  tenantId: "tenant_unknown",
  env: canaryEnv
}), null);
assert.equal(v4LateProviderLeaseBindingEnabled({ tenantId: "tenant_unknown", env: canaryEnv }), false);
assert.equal(v4LateProviderLeaseBindingEnabled({
  tenantId: "tenant_canary",
  env: { ...canaryEnv, VERCEL_ENV: "production" }
}), false);
assert.equal(v4LateProviderLeaseBindingEnabled({
  tenantId: "tenant_canary",
  env: { ...canaryEnv, VERCEL_ENV: "production", V4_LATE_PROVIDER_LEASE_BINDING_PRODUCTION_ACK: "true" }
}), true);

const migration = fs.readFileSync(new URL(
  "../supabase/migrations/20260727093000_v4_late_provider_capacity_canary.sql",
  import.meta.url
), "utf8");
assert.match(migration, /jobs\.status = 'RUNNING'/);
assert.match(migration, /jobs\.lease_owner = worker_name/);
assert.match(migration, /jobs\.lease_expires_at > pg_catalog\.clock_timestamp\(\)/);
assert.match(migration, /for update skip locked/);
assert.match(migration, /'provider_capacity_assignment', 'late_provider_lease_v1'/);
assert.match(migration, /revoke all on function public\.acquire_v4_provider_capacity_for_job[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.acquire_v4_provider_capacity_for_job[\s\S]*to service_role/);
assert.doesNotMatch(migration, /create or replace function public\.claim_v4_recognition_jobs/);

const recognitionCore = fs.readFileSync(new URL(
  "../lib/listing/v4/pipeline/native-recognition-core.mjs",
  import.meta.url
), "utf8");
const promptPreparedAt = recognitionCore.indexOf("const prompt = await buildInitialProviderPrompt");
const capacityAcquiredAt = recognitionCore.indexOf("providerCapacityLateBinding = await waitForV4LateProviderCapacity");
const providerCalledAt = recognitionCore.indexOf("const providerResult = await runTimedProviderCall", capacityAcquiredAt);
assert.ok(promptPreparedAt > 0);
assert.ok(capacityAcquiredAt > promptPreparedAt);
assert.ok(providerCalledAt > capacityAcquiredAt);
assert.equal(
  recognitionCore.indexOf("providerCapacityLateBinding = await waitForV4LateProviderCapacity", capacityAcquiredAt + 1),
  -1
);

let attempts = 0;
const acquired = await waitForV4LateProviderCapacity({
  jobId: "job-1",
  workerId: "worker-1",
  timeoutMs: 1_000,
  pollMs: 25,
  acquire: async () => {
    attempts += 1;
    return attempts < 3
      ? { acquired: false, reason: "provider_capacity_unavailable" }
      : {
        acquired: true,
        reason: "acquired",
        provider_capacity_slot: 2,
        provider_key_slot: 1,
        acquired_at: "2026-07-27T00:00:00.000Z"
      };
  }
});
assert.equal(acquired.attempts, 3);
assert.equal(acquired.provider_capacity_slot, 2);
assert.equal(acquired.binding_mode, "late_provider_lease_v1");

await assert.rejects(() => waitForV4LateProviderCapacity({
  jobId: "job-2",
  workerId: "worker-2",
  timeoutMs: 100,
  acquire: async () => ({ acquired: false, reason: "job_lease_not_live" })
}), (error) => error.code === "V4_PROVIDER_CAPACITY_ACQUIRE_FAILED" && error.retryable === true);

console.log("late provider capacity tests passed");
