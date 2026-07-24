#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildProviderCapacityTimeline,
  lateProviderLeaseBindingDesign
} from "../lib/listing/v4/jobs/provider-capacity-timeline.mjs";

const timeline = buildProviderCapacityTimeline({
  job: {
    started_at: "2026-07-24T00:00:01.000Z",
    queue_tags: { provider_capacity_leased_at: "2026-07-24T00:00:00.000Z" }
  },
  providerSlotTiming: {
    queued_at: "2026-07-24T00:00:04.000Z",
    started_at: "2026-07-24T00:00:06.000Z",
    completed_at: "2026-07-24T00:00:16.000Z"
  },
  providerCapacityReleasedAt: "2026-07-24T00:00:16.250Z"
});

assert.equal(timeline.provider_slot_held_before_provider_ms, 6000);
assert.equal(timeline.prepared_waiting_for_provider_ms, 2000);
assert.equal(timeline.provider_execution_ms, 10000);
assert.equal(timeline.provider_slot_release_ms, 250);
assert.equal(timeline.preparation_completed_at, timeline.waiting_provider_at);
assert.equal(timeline.late_binding_design_enabled, false);
assert.equal(lateProviderLeaseBindingDesign.enabled, false);
assert.equal(lateProviderLeaseBindingDesign.capacity_acquisition_transition, "WAITING_PROVIDER->PROVIDER_RUNNING");

const incomplete = buildProviderCapacityTimeline({ job: {} });
assert.equal(incomplete.provider_slot_held_before_provider_ms, null);
assert.equal(incomplete.provider_execution_ms, null);

const workerSource = fs.readFileSync(new URL("../api/v4/listing-job-worker.js", import.meta.url), "utf8");
const timelineSource = fs.readFileSync(new URL("../lib/listing/v4/jobs/provider-capacity-timeline.mjs", import.meta.url), "utf8");
assert.match(workerSource, /provider_capacity_timeline:\s*buildProviderCapacityTimeline/);
assert.match(timelineSource, /provider_capacity_leased_at/);
assert.doesNotMatch(workerSource, /lateProviderLeaseBindingDesign/);

console.log("provider capacity timeline tests passed");
