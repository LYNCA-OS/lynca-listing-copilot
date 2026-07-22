#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  v4DurableQueueDrainContract,
  v4DurableQueueDrainContractSnapshot,
  v4EventRefillContract,
  v4EventRefillContractSnapshot
} from "../lib/listing/v4/jobs/queue-drain-contract.mjs";

const first = v4DurableQueueDrainContract();
const second = v4DurableQueueDrainContract();

assert.deepEqual(first, {
  cycles: 2,
  max_runtime_ms: 240_000,
  lease_seconds: 120,
  idle_delay_ms: 0,
  idle_cycles_before_stop: 1,
  background_idle_cycles: 1,
  continuation_cycles: 2,
  max_continuation_depth: 100
});
assert.notEqual(first, second, "callers must receive an isolated payload object");
assert.equal(Object.isFrozen(v4DurableQueueDrainContractSnapshot()), true);

assert.deepEqual(v4EventRefillContract(), {
  cycles: 1,
  max_runtime_ms: 120_000,
  lease_seconds: 120,
  idle_delay_ms: 0,
  idle_cycles_before_stop: 1,
  background_idle_cycles: 1,
  continuation_cycles: 1,
  max_continuation_depth: 100
});
assert.equal(Object.isFrozen(v4EventRefillContractSnapshot()), true);

console.log("v4 queue drain contract tests passed");
