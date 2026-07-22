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
  cycles: 30,
  max_runtime_ms: 240_000,
  lease_seconds: 120,
  idle_delay_ms: 250,
  idle_cycles_before_stop: 2,
  background_idle_cycles: 2,
  continuation_cycles: 0,
  max_continuation_depth: 0
});
assert.notEqual(first, second, "callers must receive an isolated payload object");
assert.equal(Object.isFrozen(v4DurableQueueDrainContractSnapshot()), true);

assert.deepEqual(v4EventRefillContract(), {
  cycles: 30,
  max_runtime_ms: 240_000,
  lease_seconds: 120,
  idle_delay_ms: 250,
  idle_cycles_before_stop: 2,
  background_idle_cycles: 2,
  continuation_cycles: 0,
  max_continuation_depth: 0
});
assert.equal(Object.isFrozen(v4EventRefillContractSnapshot()), true);

console.log("v4 queue drain contract tests passed");
