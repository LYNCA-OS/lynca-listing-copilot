import assert from "node:assert/strict";
import {
  authorizePaidPreingestion,
  isDedicatedPaidPreingestionWorkerRequest,
  paidPreingestionRequested
} from "../api/listing-preingest.js";

const context = {
  tenantId: "tenant_server_truth",
  userId: "writer_server_truth"
};
const calls = [];
const dependencies = {
  requirePermissionImpl: (actualContext, permission) => {
    calls.push({ type: "permission", actualContext, permission });
  },
  admitItem: async (input) => {
    calls.push({ type: "admit", input });
    return { item: { status: "ASSET_ADMITTED" } };
  }
};

assert.equal(paidPreingestionRequested({ enqueue_workers: false, enqueue_ocr: true }), false);
assert.equal(paidPreingestionRequested({ enqueue_workers: true, enqueue_ocr: false }), true);
assert.equal(paidPreingestionRequested({}), false, "an old browser request must never default into paid work");
assert.equal(paidPreingestionRequested({}, { trustedInternal: true }), true, "only an internal signed caller retains the legacy default");
assert.equal(isDedicatedPaidPreingestionWorkerRequest({
  headers: { "x-lynca-worker-secret": "automation-secret" }
}, {
  VERCEL_AUTOMATION_BYPASS_SECRET: "automation-secret"
}), false, "automation bypass credentials must never authorize paid OCR work");
assert.equal(isDedicatedPaidPreingestionWorkerRequest({
  headers: { "x-lynca-worker-secret": "legacy-secret" }
}, {
  LYNCA_WORKER_SECRET: "legacy-secret"
}), false, "legacy shared worker credentials must never authorize paid OCR work");
assert.equal(isDedicatedPaidPreingestionWorkerRequest({
  headers: { "x-lynca-worker-secret": "dedicated-secret" }
}, {
  V4_JOB_WORKER_SECRET: "dedicated-secret",
  VERCEL_AUTOMATION_BYPASS_SECRET: "automation-secret"
}), true, "only the dedicated V4 worker credential may authorize paid OCR work");

let authorization = await authorizePaidPreingestion({
  context,
  req: {},
  payload: {
    enqueue_workers: false,
    asset_id: "asset_12345678-1234-4123-8123-123456789abc"
  }
}, { ...dependencies, isInternalRequest: () => false });
assert.equal(authorization.authorized, false);
assert.equal(calls.length, 0, "pre-click bundle compilation must not need or counterfeit paid authorization");

authorization = await authorizePaidPreingestion({
  context,
  req: {},
  payload: {
    enqueue_workers: true,
    writer_intake_batch_id: "intake_0123456789abcdef0123456789abcdef",
    writer_intake_item_id: "intake_item_0123456789abcdef0123456789abcdef",
    writer_intake_previous_queue_job_id: "job_prior",
    asset_id: "asset_12345678-1234-4123-8123-123456789abc",
    tenant_id: "tenant_attacker",
    operator_id: "writer_attacker"
  }
}, { ...dependencies, isInternalRequest: () => false });
assert.equal(authorization.authorized, true);
const admission = calls.find((entry) => entry.type === "admit").input;
assert.equal(admission.tenantId, context.tenantId);
assert.equal(admission.operatorId, context.userId);
assert.equal(admission.batchId, "intake_0123456789abcdef0123456789abcdef");
assert.equal(admission.itemId, "intake_item_0123456789abcdef0123456789abcdef");
assert.equal(admission.previousQueueJobId, "job_prior");

const internalCallsBefore = calls.length;
authorization = await authorizePaidPreingestion({
  context,
  req: {},
  payload: {},
  assetId: "asset_12345678-1234-4123-8123-123456789abc"
}, { ...dependencies, isInternalRequest: () => true });
assert.equal(authorization.authorized, true);
assert.equal(authorization.reason, "internal_signed_request");
assert.equal(calls.length, internalCallsBefore, "internal authorization must not counterfeit a writer ledger mutation");

console.log("writer intake paid-sensor authorization tests passed");
