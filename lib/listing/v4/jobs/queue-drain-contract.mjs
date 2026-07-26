// Frozen chain-only profile for production queue draining.
//
// One bounded in-process drain is the durable unit of work. Provider leases
// preserve the frozen concurrency while the cycle/runtime bounds keep the pump
// below Vercel's function limit. Independent cron invocations provide recovery;
// the drain never recursively calls its own HTTP endpoint.
const durableQueueDrainContract = Object.freeze({
  cycles: 30,
  max_runtime_ms: 240_000,
  lease_seconds: 120,
  idle_delay_ms: 250,
  idle_cycles_before_stop: 2,
  background_idle_cycles: 2,
  continuation_cycles: 0,
  max_continuation_depth: 0
});

const eventRefillContract = Object.freeze({
  cycles: 30,
  max_runtime_ms: 240_000,
  lease_seconds: 120,
  idle_delay_ms: 250,
  idle_cycles_before_stop: 2,
  background_idle_cycles: 2,
  continuation_cycles: 0,
  max_continuation_depth: 0
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
