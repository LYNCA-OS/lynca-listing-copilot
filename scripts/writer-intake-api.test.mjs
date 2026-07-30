import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWriterIntakeHandler } from "../api/v4/listing-intake.js";
import { WriterIntakeStoreError } from "../lib/listing/intake/writer-intake-store.mjs";
import {
  authorizeWriterIntakeQueueReferences,
  indexWriterIntakeReferences,
  listingInternalQueueRequestAuthorized,
  reconcileWriterIntakeAdmissions,
  scheduleWriterIntakeAdmissions,
  writerIntakeQueueBatchToken,
  writerIntakeReference
} from "../api/v4/listing-job-enqueue.js";
import { callJsonHandler } from "../lib/listing/v4/session/http-handler-utils.mjs";

const calls = [];
const context = {
  requestId: "request_001",
  tenantId: "tenant_server_owned",
  userId: "user_server_owned",
  role: "MANAGER"
};
const result = {
  contract_version: "v4-writer-intake-ledger-v1",
  batch_id: "intake_0123456789abcdef0123456789abcdef",
  items: []
};
const handler = createWriterIntakeHandler({
  instrument: () => {},
  bindContext: () => {},
  rateLimit: (_req, _res, options) => {
    calls.push({ type: "rate", options });
    return true;
  },
  requireAccess: async () => context,
  requirePermission: (_actualContext, permission) => calls.push({ type: "permission", permission }),
  commitBatch: async (input) => {
    calls.push({ type: "commit", input });
    return result;
  },
  appendItem: async (input) => {
    calls.push({ type: "append", input });
    return result;
  },
  admitItem: async (input) => {
    calls.push({ type: "admit", input });
    return result;
  },
  abandonBatch: async (input) => {
    calls.push({ type: "abandon", input });
    return result;
  },
  settleItem: async (input) => {
    calls.push({ type: "settle", input });
    return result;
  },
  getStatus: async (input) => {
    calls.push({ type: "status", input });
    return result;
  }
});

let response = await callJsonHandler(handler, {
  method: "POST",
  headers: { "x-idempotency-key": "header-key" },
  payload: {
    action: "COMMIT_BATCH",
    tenant_id: "tenant_attacker",
    operator_id: "user_attacker",
    expected_item_count: 100
  }
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.ok, true);
const commit = calls.find((call) => call.type === "commit");
assert.equal(commit.input.tenantId, context.tenantId, "tenant identity must come from the verified session");
assert.equal(commit.input.operatorId, context.userId, "operator identity must come from the verified session");
assert.equal(commit.input.idempotencyKey, "header-key");
assert.equal(commit.input.expectedItemCount, 100);
assert.deepEqual(
  calls.filter((call) => call.type === "rate").slice(0, 2).map((call) => [call.options.scope, call.options.cost || 1]),
  [["writer_intake_commit_batch", 1], ["writer_intake_commit_batch_rows", 100]],
  "batch commits need both a low-frequency request gate and a weighted row-amplification budget"
);

const databaseLimitedHandler = createWriterIntakeHandler({
  instrument: () => {},
  bindContext: () => {},
  rateLimit: () => true,
  requireAccess: async () => context,
  requirePermission: () => {},
  commitBatch: async () => {
    throw new WriterIntakeStoreError("writer_intake_commit_rate_limited", {
      statusCode: 429,
      retryable: true
    });
  }
});
const databaseLimitedResponse = await callJsonHandler(databaseLimitedHandler, {
  method: "POST",
  payload: {
    action: "COMMIT_BATCH",
    idempotency_key: "database-rate-limited",
    expected_item_count: 100
  }
});
assert.equal(databaseLimitedResponse.statusCode, 429);
assert.equal(databaseLimitedResponse.body.code, "writer_intake_commit_rate_limited");
assert.equal(databaseLimitedResponse.body.retryable, true);

response = await callJsonHandler(handler, {
  method: "POST",
  payload: {
    action: "ADMIT_ITEM",
    batch_id: result.batch_id,
    item_id: "intake_item_0123456789abcdef0123456789abcdef",
    asset_id: "asset_12345678-1234-4123-8123-123456789abc",
    queue_job_id: "job_001",
    previous_queue_job_id: "job_prior",
    recognition_session_id: "session_attacker",
    status: "WRITER_COMPLETED",
    writer_ready_at: "2000-01-01T00:00:00.000Z",
    asset_durable_at: "2000-01-01T00:00:00.000Z",
    writer_completed_at: "2000-01-01T00:00:00.000Z"
  }
});
assert.equal(response.statusCode, 200);
const admit = calls.find((call) => call.type === "admit");
assert.equal("recognitionSessionId" in admit.input, false, "session linkage must come from the persisted queue row");
assert.equal(admit.input.previousQueueJobId, "job_prior");
for (const field of ["status", "writerReadyAt", "assetDurableAt", "writerCompletedAt"]) {
  assert.equal(field in admit.input, false, `${field} must remain server-owned`);
}
assert.ok(calls.some((call) => call.type === "rate" && call.options.scope === "writer_intake_admit_item"));

response = await callJsonHandler(handler, {
  method: "POST",
  payload: {
    action: "ABANDON_BATCH",
    batch_id: result.batch_id,
    tenant_id: "tenant_attacker",
    operator_id: "user_attacker",
    status: "CANCELLED",
    last_error_code: "ATTACKER_CONTROLLED",
    updated_at: "2000-01-01T00:00:00.000Z"
  }
});
assert.equal(response.statusCode, 200);
const abandon = calls.find((call) => call.type === "abandon");
assert.deepEqual(abandon.input, {
  tenantId: context.tenantId,
  operatorId: context.userId,
  batchId: result.batch_id
}, "batch abandonment accepts identity intent only; ownership and lifecycle fields stay server-owned");
assert.ok(calls.some((call) => call.type === "rate" && call.options.scope === "writer_intake_abandon_batch"));

response = await callJsonHandler(handler, {
  method: "POST",
  payload: {
    action: "FAIL_ITEM",
    batch_id: result.batch_id,
    item_id: "intake_item_0123456789abcdef0123456789abcdef",
    status: "WRITER_COMPLETED",
    failure_code: "ATTACKER_CONTROLLED",
    failed_at: "2000-01-01T00:00:00.000Z"
  }
});
assert.equal(response.statusCode, 200);
const settle = calls.find((call) => call.type === "settle");
assert.deepEqual(settle.input, {
  tenantId: context.tenantId,
  operatorId: context.userId,
  batchId: result.batch_id,
  itemId: "intake_item_0123456789abcdef0123456789abcdef",
  disposition: "FAILED"
}, "the browser may report workflow disposition but never status, clocks, or error truth");
assert.ok(calls.some((call) => call.type === "rate" && call.options.scope === "writer_intake_settle_item"));

response = await callJsonHandler(handler, {
  method: "POST",
  payload: { action: "WRITE_TITLE", title: "must not enter intake ledger" }
});
assert.equal(response.statusCode, 400);
assert.equal(response.body.code, "invalid_writer_intake_action");

const getResponse = {
  statusCode: 0,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  end(value = "") { this.body = String(value); }
};
await handler({
  method: "GET",
  url: "/api/v4/listing-intake?idempotency_key=lost-response-key",
  headers: {}
}, getResponse);
response = { statusCode: getResponse.statusCode, body: JSON.parse(getResponse.body || "{}") };
assert.equal(response.statusCode, 200);
const status = calls.find((call) => call.type === "status");
assert.equal(status.input.tenantId, context.tenantId);
assert.equal(status.input.operatorId, context.userId);
assert.equal(status.input.idempotencyKey, "lost-response-key");
assert.ok(calls.some((call) => call.type === "rate" && call.options.scope === "writer_intake_get"));

const intakeReference = writerIntakeReference({
  asset_id: "asset_12345678-1234-4123-8123-123456789abc",
  writer_intake_batch_id: result.batch_id,
  writer_intake_item_id: "intake_item_0123456789abcdef0123456789abcdef",
  writer_intake_previous_queue_job_id: "job_prior"
});
assert.equal(listingInternalQueueRequestAuthorized({
  headers: { "x-lynca-worker-secret": "dedicated-secret" }
}, { V4_JOB_WORKER_SECRET: "dedicated-secret" }), true);
assert.equal(listingInternalQueueRequestAuthorized({
  headers: { "x-lynca-worker-secret": "automation-secret" }
}, { VERCEL_AUTOMATION_BYPASS_SECRET: "automation-secret" }), false, "automation credentials cannot bypass writer intake");
assert.equal(intakeReference.batch_id, result.batch_id);
assert.equal(intakeReference.previous_queue_job_id, "job_prior");
assert.equal(
  writerIntakeQueueBatchToken([intakeReference]),
  writerIntakeQueueBatchToken([intakeReference]),
  "public writer queue identity must be deterministic across an HTTP response-loss replay"
);
assert.notEqual(
  writerIntakeQueueBatchToken([{ ...intakeReference, previous_queue_job_id: null }]),
  writerIntakeQueueBatchToken([intakeReference]),
  "an explicitly authorized terminal successor must receive a new deterministic queue identity"
);
assert.throws(() => writerIntakeReference({ writer_intake_batch_id: result.batch_id }), /writer_intake_reference_incomplete/);
assert.throws(
  () => indexWriterIntakeReferences([intakeReference, { ...intakeReference, item_id: "intake_item_11111111111111111111111111111111" }]),
  /writer_intake_reference_ambiguous/,
  "one canonical asset cannot bind two writer positions in a single queue mutation"
);
assert.throws(
  () => indexWriterIntakeReferences([intakeReference, { ...intakeReference, asset_id: "asset_22345678-1234-4123-8123-123456789abc" }]),
  /writer_intake_reference_ambiguous/,
  "one writer position cannot bind two canonical assets in a single queue mutation"
);

const queueAuthorizationCalls = [];
await assert.rejects(
  authorizeWriterIntakeQueueReferences({
    rawJobCount: 2,
    references: [
      intakeReference,
      {
        ...intakeReference,
        asset_id: "asset_22345678-1234-4123-8123-123456789abc",
        item_id: "intake_item_11111111111111111111111111111111"
      }
    ],
    jobs: [
      { asset_id: intakeReference.asset_id },
      { asset_id: "asset_22345678-1234-4123-8123-123456789abc" }
    ],
    tenantId: context.tenantId,
    operatorId: context.userId,
    admitItem: async (input) => queueAuthorizationCalls.push(input)
  }),
  /writer_intake_single_job_request_required/,
  "public intake streams exactly one immutable position per request so a partial response-loss replay cannot fork jobs"
);
assert.equal(queueAuthorizationCalls.length, 0);
await assert.rejects(
  authorizeWriterIntakeQueueReferences({
    rawJobCount: 1,
    references: [],
    jobs: [{ asset_id: intakeReference.asset_id }],
    tenantId: context.tenantId,
    operatorId: context.userId,
    admitItem: async (input) => queueAuthorizationCalls.push(input)
  }),
  /writer_intake_reference_required/,
  "a public writer-assisted job without a complete intake reference must fail before queue persistence"
);
assert.equal(queueAuthorizationCalls.length, 0);
await assert.rejects(
  authorizeWriterIntakeQueueReferences({
    rawJobCount: 1,
    references: [intakeReference],
    jobs: [{ asset_id: "asset_22345678-1234-4123-8123-123456789abc" }],
    tenantId: context.tenantId,
    operatorId: context.userId,
    admitItem: async (input) => queueAuthorizationCalls.push(input)
  }),
  /writer_intake_reference_asset_mismatch/,
  "a valid-looking reference for another asset must never reach the canonical queue"
);
await assert.rejects(
  authorizeWriterIntakeQueueReferences({
    rawJobCount: 1,
    references: [intakeReference],
    jobs: [{ asset_id: intakeReference.asset_id }],
    reservedJobs: [],
    tenantId: context.tenantId,
    operatorId: context.userId,
    admitItem: async (input) => queueAuthorizationCalls.push(input)
  }),
  /writer_intake_queue_reservation_required/,
  "public admission must bind one deterministic final job before queue persistence"
);
await authorizeWriterIntakeQueueReferences({
  rawJobCount: 1,
  references: [intakeReference],
  jobs: [{ asset_id: intakeReference.asset_id }],
  reservedJobs: [{
    id: "job_reserved_final",
    asset_id: intakeReference.asset_id,
    job_type: "FINAL_ASSISTED_TITLE"
  }],
  tenantId: context.tenantId,
  operatorId: context.userId,
  admitItem: async (input) => queueAuthorizationCalls.push(input)
});
assert.deepEqual(queueAuthorizationCalls.at(-1), {
  tenantId: context.tenantId,
  operatorId: context.userId,
  batchId: intakeReference.batch_id,
  itemId: intakeReference.item_id,
  assetId: intakeReference.asset_id,
  previousQueueJobId: intakeReference.previous_queue_job_id,
  reservedQueueJobId: "job_reserved_final"
});
const authorizedCallCount = queueAuthorizationCalls.length;
const explicitBypass = await authorizeWriterIntakeQueueReferences({
  rawJobCount: 1,
  references: [],
  jobs: [{ asset_id: intakeReference.asset_id }],
  explicitBypass: true,
  admitItem: async (input) => queueAuthorizationCalls.push(input)
});
assert.equal(explicitBypass.bypassed, true);
assert.equal(queueAuthorizationCalls.length, authorizedCallCount, "the bypass must be explicit, not inferred from absent tags");

const serverAdmissions = [];
const admissions = await reconcileWriterIntakeAdmissions({
  references: [intakeReference],
  result: {
    jobs: [{
      saved: true,
      row: {
        id: "job_final",
        asset_id: intakeReference.asset_id,
        job_type: "FINAL_ASSISTED_TITLE"
      }
    }]
  },
  tenantId: context.tenantId,
  operatorId: context.userId,
  admitItem: async (input) => serverAdmissions.push(input)
});
assert.equal(admissions[0].ok, true);
assert.equal(serverAdmissions[0].queueJobId, "job_final");
assert.equal(serverAdmissions[0].tenantId, context.tenantId);
assert.equal(serverAdmissions[0].operatorId, context.userId);
assert.equal(serverAdmissions[0].previousQueueJobId, "job_prior");

let deferredProjection = null;
let scheduledReconciliations = 0;
const plannedAdmissions = scheduleWriterIntakeAdmissions({
  references: [intakeReference],
  result: {
    batchId: "batch_queue_truth",
    jobs: [{
      saved: true,
      row: {
        id: "job_final",
        asset_id: intakeReference.asset_id,
        job_type: "FINAL_ASSISTED_TITLE"
      }
    }]
  },
  tenantId: context.tenantId,
  operatorId: context.userId,
  defer: (completion) => { deferredProjection = completion; },
  reconcileAdmissions: async () => {
    scheduledReconciliations += 1;
    return [{ ok: true }];
  }
});
assert.equal(plannedAdmissions[0].code, "writer_intake_projection_scheduled");
assert.equal(plannedAdmissions[0].ok, null, "the queue response must not pretend an asynchronous projection already committed");
assert.equal(scheduledReconciliations, 0, "projection must leave the synchronous enqueue stack");
await deferredProjection;
assert.equal(scheduledReconciliations, 1);

const enqueueSource = await readFile(new URL("../api/v4/listing-job-enqueue.js", import.meta.url), "utf8");
const postCommitSource = enqueueSource.slice(
  enqueueSource.indexOf("const result = await enqueueV4RecognitionJobs({"),
  enqueueSource.indexOf("const failedEntries = result.jobs.filter")
);
assert.ok(
  enqueueSource.indexOf("await authorizeWriterIntakeQueueReferences({")
    < enqueueSource.indexOf("const result = await enqueueV4RecognitionJobs({"),
  "server-owned intake admission must complete before the canonical queue or paid pump can start"
);
assert.match(
  enqueueSource,
  /queueBatchToken = evaluationAuthorization\.authorized \|\| internalQueueAuthorization[\s\S]*writerIntakeQueueBatchToken\(writerIntakeReferences\)/,
  "public callers cannot fork one intake item into multiple paid jobs by changing a browser batch token"
);
assert.ok(
  enqueueSource.indexOf("stageJobs = expandV4RecognitionStageJobs({")
    < enqueueSource.indexOf("await authorizeWriterIntakeQueueReferences({"),
  "the server must reserve the deterministic final job identity before intake admission"
);
assert.match(
  enqueueSource,
  /reservedJobs: stageJobs/,
  "pre-enqueue intake admission must bind the exact deterministic job it authorizes"
);
assert.ok(
  postCommitSource.indexOf("triggerV4QueuePumpAfterEnqueue(req")
    < postCommitSource.indexOf("scheduleWriterIntakeAdmissions({"),
  "the canonical queue pump must start before the reconstructible intake projection is scheduled"
);
assert.doesNotMatch(postCommitSource, /await\s+reconcileWriterIntakeAdmissions/, "enqueue response latency must not depend on ledger projection");
assert.match(
  enqueueSource,
  /queue_tags:\s*\{[\s\S]*writer_intake_batch_id:\s*reference\.batch_id[\s\S]*writer_intake_item_id:\s*reference\.item_id/,
  "canonical queue metadata must retain enough server-validated identity to rebuild a transiently missed projection"
);

console.log("writer intake API tests passed");
