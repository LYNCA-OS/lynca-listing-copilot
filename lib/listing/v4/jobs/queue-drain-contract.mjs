// Frozen chain-only profile for production queue draining.
//
// Two short worker batches are the smallest useful redundancy: the first batch
// does the work, while the second closes the provider-release handoff gap
// without raising provider concurrency. Each job has its own 100 second cap and
// the pump remains below Vercel's 300 second function limit.
const durableQueueDrainContract = Object.freeze({
  cycles: 2,
  max_runtime_ms: 240_000,
  lease_seconds: 120,
  idle_delay_ms: 0,
  idle_cycles_before_stop: 1,
  background_idle_cycles: 1,
  continuation_cycles: 2,
  max_continuation_depth: 100
});

const eventRefillContract = Object.freeze({
  cycles: 1,
  max_runtime_ms: 120_000,
  lease_seconds: 120,
  idle_delay_ms: 0,
  idle_cycles_before_stop: 1,
  background_idle_cycles: 1,
  continuation_cycles: 1,
  max_continuation_depth: 100
});

export function v4DurableQueueDrainContract() {
  return { ...durableQueueDrainContract };
}

export function v4DurableQueueDrainContractSnapshot() {
  return durableQueueDrainContract;
}

export function v4EventRefillContract() {
  return { ...eventRefillContract };
}

export function v4EventRefillContractSnapshot() {
  return eventRefillContract;
}
