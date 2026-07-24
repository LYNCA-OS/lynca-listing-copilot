export const providerCapacityTimelineSchemaVersion = "provider-capacity-timeline-v1";

export const lateProviderLeaseBindingDesign = Object.freeze({
  enabled: false,
  decision: "DEFERRED_NOT_PROVEN",
  states: Object.freeze([
    "QUEUED",
    "PREPARING",
    "WAITING_PROVIDER",
    "PROVIDER_RUNNING",
    "L2_READY"
  ]),
  capacity_acquisition_transition: "WAITING_PROVIDER->PROVIDER_RUNNING"
});

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function elapsed(start, end) {
  const startMs = timestamp(start);
  const endMs = timestamp(end);
  return startMs === null || endMs === null ? null : Math.max(0, endMs - startMs);
}

export function buildProviderCapacityTimeline({
  job = {},
  preparationStartedAt = null,
  providerSlotTiming = null,
  providerCapacityReleasedAt = null
} = {}) {
  const slot = providerSlotTiming && typeof providerSlotTiming === "object"
    ? providerSlotTiming
    : {};
  const preparationStarted = iso(preparationStartedAt || job.started_at);
  const waitingProvider = iso(slot.queued_at);
  const providerStarted = iso(slot.started_at);
  const providerCompleted = iso(slot.completed_at);
  const capacityAcquired = iso(job.queue_tags?.provider_capacity_leased_at);
  const capacityReleased = iso(providerCapacityReleasedAt);
  return Object.freeze({
    schema_version: providerCapacityTimelineSchemaVersion,
    late_binding_design_enabled: false,
    preparation_started_at: preparationStarted,
    preparation_completed_at: waitingProvider,
    waiting_provider_at: waitingProvider,
    provider_capacity_acquired_at: capacityAcquired,
    provider_started_at: providerStarted,
    provider_completed_at: providerCompleted,
    provider_capacity_released_at: capacityReleased,
    provider_slot_held_before_provider_ms: elapsed(capacityAcquired, providerStarted),
    prepared_waiting_for_provider_ms: elapsed(waitingProvider, providerStarted),
    provider_execution_ms: elapsed(providerStarted, providerCompleted),
    provider_slot_release_ms: elapsed(providerCompleted, capacityReleased)
  });
}

