import assert from "node:assert/strict";
import {
  groupClientResultsByJobId,
  isClientPollTerminalStatus,
  observeClientJobPoll,
  queuedStatusPollDelay
} from "../lib/listing/v4/jobs/client-poll-policy.mjs";

const queued = observeClientJobPoll({
  status: "QUEUED",
  elapsedMs: 300_000
});
assert.equal(queued.phase, "QUEUE_WAIT");
assert.equal(queued.delayed, true);
assert.equal(queued.warning_code, "QUEUE_WAIT_LONG");
assert.equal(queued.should_continue_polling, true);
assert.equal(queued.should_mark_failed, false);

const retrying = observeClientJobPoll({
  status: "RETRYING",
  elapsedMs: 180_000
});
assert.equal(retrying.phase, "QUEUE_WAIT");
assert.equal(retrying.should_continue_polling, true);
assert.equal(retrying.should_mark_failed, false);

const running = observeClientJobPoll({
  status: "RUNNING",
  elapsedMs: 300_000
});
assert.equal(running.phase, "ACTIVE_EXECUTION");
assert.equal(running.delayed, true);
assert.equal(running.warning_code, "ACTIVE_EXECUTION_LONG");
assert.equal(running.should_continue_polling, true);
assert.equal(running.should_mark_failed, false);

const fresh = observeClientJobPoll({
  status: "RUNNING",
  elapsedMs: 15_000
});
assert.equal(fresh.delayed, false);
assert.equal(fresh.warning_code, null);

const ready = observeClientJobPoll({
  status: "L2_READY",
  elapsedMs: 300_000
});
assert.equal(ready.terminal, true);
assert.equal(ready.should_continue_polling, false);
assert.equal(ready.should_mark_failed, false);

assert.equal(isClientPollTerminalStatus("FAILED"), true);
assert.equal(isClientPollTerminalStatus("CANCELLED"), true);
assert.equal(isClientPollTerminalStatus("QUEUED"), false);

const firstResult = { index: 1, v4_job_id: "shared-job" };
const secondResult = { index: 2, v4_job_id: "shared-job" };
const grouped = groupClientResultsByJobId([
  firstResult,
  secondResult,
  { index: 3, v4_job_id: "other-job" },
  { index: 4 }
]);
assert.deepEqual(grouped.get("shared-job"), [firstResult, secondResult]);
assert.equal(grouped.get("other-job")?.length, 1);
assert.equal(grouped.size, 2);

assert.equal(queuedStatusPollDelay(5_000, 10), 800, "small fresh batches should remain responsive");
assert.equal(queuedStatusPollDelay(5_000, 101), 1200, "medium batches should reduce read pressure");
assert.equal(queuedStatusPollDelay(5_000, 301), 2000, "large batches should poll less aggressively");
assert.equal(queuedStatusPollDelay(5_000, 1001), 3000, "soak-size batches should protect database capacity");
assert.equal(queuedStatusPollDelay(120_000, 10), 1800, "long-running small batches should back off");

console.log("V4 client poll policy tests passed.");
