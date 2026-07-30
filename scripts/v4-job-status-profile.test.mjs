import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  operationalSessionStatus,
  v4WriterStatusJobSelect,
  v4WriterStatusNeedsFullSession,
  v4WriterStatusNeedsSessionProbe,
  v4WriterStatusSessionHeadSelect
} from "../api/v4/listing-job-status.js";
import { operationalSessionStatus as operationalSingleSessionStatus } from "../api/v4/listing-session-status.js";
import {
  shouldPersistV4ObservingTransition
} from "../api/v4/listing-copilot-title.js";

const jobStatusSource = readFileSync(new URL("../api/v4/listing-job-status.js", import.meta.url), "utf8");
assert.match(jobStatusSource, /error_code:\s*"V4_JOB_STATUS_NOT_FOUND"/, "missing job rows should expose a stable session-recovery code");
assert.match(jobStatusSource, /retryable:\s*true[\s\S]*error_code:\s*"V4_JOB_STATUS_NOT_FOUND"/, "missing job rows should allow bounded client recovery instead of stranding the title");

const jobColumns = new Set(v4WriterStatusJobSelect.split(","));
assert.equal(jobColumns.has("payload"), false, "writer status polling must never reload image/request payloads");
assert.equal(jobColumns.has("id"), true);
assert.equal(jobColumns.has("status"), true);
assert.equal(jobColumns.has("not_before"), true, "retry polling must expose the next eligible execution time");
assert.equal(jobColumns.has("queue_tags"), true, "writer timers still need provider-capacity lease timestamps");

const headColumns = new Set(v4WriterStatusSessionHeadSelect.split(","));
for (const heavyColumn of [
  "provider_result_summary",
  "candidate_control_plane_trace",
  "resolved_fields",
  "field_states"
]) {
  assert.equal(headColumns.has(heavyColumn), false, `active status heads must exclude ${heavyColumn}`);
}
assert.equal(headColumns.has("l2_status"), true);
assert.equal(headColumns.has("failure_reason"), true);

assert.equal(v4WriterStatusNeedsSessionProbe({ status: "QUEUED" }), false);
assert.equal(v4WriterStatusNeedsSessionProbe({ status: "RETRYING" }), false);
assert.equal(v4WriterStatusNeedsSessionProbe({ status: "L1_READY" }), false);
assert.equal(v4WriterStatusNeedsSessionProbe({ status: "RUNNING" }), true);
assert.equal(v4WriterStatusNeedsSessionProbe({ status: "L2_READY" }), true);
assert.equal(v4WriterStatusNeedsSessionProbe({ status: "FAILED" }), true);

assert.equal(v4WriterStatusNeedsFullSession(
  { status: "RUNNING" },
  { status: "RUNNING", l2_status: "PENDING" }
), false, "active jobs should remain on the lightweight session head");
assert.equal(v4WriterStatusNeedsFullSession(
  { status: "L1_READY" },
  { status: "L1_READY", l2_status: "PENDING" }
), false, "hidden L1 completion must not force a full session reload");
assert.equal(v4WriterStatusNeedsFullSession(
  { status: "L2_READY" },
  { status: "L2_READY", l2_status: "READY" }
), true, "writer-ready jobs need one full terminal snapshot");
assert.equal(v4WriterStatusNeedsFullSession(
  { status: "FAILED" },
  { status: "FAILED", l2_status: "PENDING", failure_reason: "provider_timeout" }
), true, "failed jobs need terminal error details");

const defaultOperationalStatus = operationalSessionStatus({
  id: "session-default-shape",
  status: "DRAFT_READY",
  final_title: "2024 Panini Test Player",
  l2_status: "READY",
  provider_result_summary: { provider_call_ledger: [] }
});
assert.equal(Object.hasOwn(defaultOperationalStatus.provider_result_summary, "targeted_assist_execution"), false);
assert.equal(Object.hasOwn(defaultOperationalStatus.provider_result_summary, "provider_call_ledger"), false);

const targetedOperationalStatus = operationalSessionStatus({
  id: "session-targeted-shape",
  status: "DRAFT_READY",
  final_title: "2024 Panini Test Player",
  l2_status: "READY",
  provider_result_summary: {
    provider_transient_retry_attempted: true,
    provider_transient_retry_attempts: 1,
    provider_output_cap_downgrade_attempted: true,
    provider_output_cap_downgrade_attempts: 1,
    targeted_assist_execution: {
      enabled: true,
      final_observation_owner: "TARGETED_VISUAL_OBSERVATION"
    },
    recognition_critical_path: {
      schema_version: "recognition-critical-path-v1",
      status: "COMPLETE",
      total_wall_ms: 1234,
      boundaries: { core_started: { offset_ms: 0 } },
      provider_attempts: [{ attempt: 1 }]
    },
    provider_call_ledger: [{ logical_stage: "TARGETED_VISUAL_OBSERVATION", provider_calls: 1 }]
  }
});
assert.equal(targetedOperationalStatus.provider_result_summary.targeted_assist_execution.enabled, true);
assert.equal(targetedOperationalStatus.provider_result_summary.provider_call_ledger.length, 1);
assert.equal(targetedOperationalStatus.provider_result_summary.provider_transient_retry_attempted, true);
assert.equal(targetedOperationalStatus.provider_result_summary.provider_transient_retry_attempts, 1);
assert.equal(targetedOperationalStatus.provider_result_summary.provider_output_cap_downgrade_attempted, true);
assert.equal(targetedOperationalStatus.provider_result_summary.provider_output_cap_downgrade_attempts, 1);
assert.equal(targetedOperationalStatus.provider_result_summary.recognition_critical_path.total_wall_ms, 1234);
assert.equal(targetedOperationalStatus.provider_result_summary.recognition_critical_path.provider_attempt_count, 1);
assert.equal(
  Object.hasOwn(targetedOperationalStatus.provider_result_summary.recognition_critical_path, "boundaries"),
  false
);

const secondLookOperationalStatus = operationalSessionStatus({
  id: "session-second-look-shape",
  status: "DRAFT_READY",
  final_title: "Baseline Title",
  l2_status: "READY",
  provider_result_summary: {
    provider_calls: 1,
    baseline_provider_calls: 1,
    shadow_provider_calls: 1,
    total_provider_calls: 2,
    provider_accounting_complete: true,
    second_look_shadow_usage: { provider_calls: 1, input_tokens: 30 },
    second_look_shadow: {
      baseline_title: "Baseline Title",
      natural_language_model_response_persisted: false,
      provider_call_ledger: [{ provider_calls: 1 }]
    }
  }
});
assert.equal(secondLookOperationalStatus.provider_result_summary.provider_calls, 1);
assert.equal(secondLookOperationalStatus.provider_result_summary.total_provider_calls, 2);
assert.equal(secondLookOperationalStatus.provider_result_summary.second_look_shadow.provider_call_ledger[0].provider_calls, 1);
const singleSessionOperationalStatus = operationalSingleSessionStatus({
  id: "session_evaluation",
  provider_result_summary: {
    recognition_critical_path: {
      schema_version: "recognition-critical-path-v1",
      status: "COMPLETE",
      total_wall_ms: 1234,
      boundaries: { core_started: { offset_ms: 0 } },
      provider_attempts: [{ attempt: 1 }]
    }
  }
});
assert.equal(singleSessionOperationalStatus.provider_result_summary.recognition_critical_path.provider_attempt_count, 1);
assert.equal(
  Object.hasOwn(singleSessionOperationalStatus.provider_result_summary.recognition_critical_path, "boundaries"),
  false
);

assert.equal(
  shouldPersistV4ObservingTransition({ workerAuthorized: true }),
  false,
  "a queue worker must reuse its atomic claim/fence instead of adding a pre-provider session PATCH"
);
assert.equal(
  shouldPersistV4ObservingTransition({ workerAuthorized: false }),
  true,
  "a direct request must still prove mutable session persistence before paid execution"
);

console.log("V4 job status profile tests passed.");
