import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildRecognitionWorkflowEvent,
  summarizeWorkflowTriggers,
  workflowSidecarStatuses
} from "../../lib/data-loop/workflow-events.mjs";
import {
  buildWorkflowActionPlan,
  sidecarActionSummary
} from "../../lib/data-loop/workflow-action-plan.mjs";
import {
  attachWorkflowSidecarsToListingResult,
  dispatchWorkflowSidecars
} from "../../lib/data-loop/workflow-sidecar-dispatcher.mjs";

function jsonResponse(status, body = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

const payload = {
  analysis_run_id: "analysis-sidecar-test",
  candidate_id: "card-sidecar-test",
  images: [{
    image_id: "front",
    role: "front_original",
    bucket: "listing-card-images",
    object_path: "front.jpg",
    signed_url: "https://example.supabase.co/signed-url?token=secret",
    content_sha256: "ABC"
  }]
};

const result = {
  title: "2025 Topps Chrome Test Player Gold /50",
  confidence: "MEDIUM",
  provider: "openai_legacy",
  fields: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Test Player"],
    serial_number: "12/50"
  },
  unresolved: ["serial_number"],
  field_task_orchestration: {
    tasks: [{
      task_id: "ocr_serial_verifier",
      status: "REVIEW_REQUIRED",
      fields: ["serial_number"]
    }]
  },
  catalog_candidate_packet: {
    vector_retrieval: {
      candidates: [{
        candidate_identity_id: "catalog-1",
        rank: 1,
        title: "2025 Topps Chrome Test Player Gold /50",
        source_trust: "APPROVED_REFERENCE",
        supporting_fields: ["year", "product", "players"],
        conflicting_fields: ["serial_number"]
      }]
    }
  },
  vector_candidate_packet: {
    vector_retrieval: {
      candidates: [{
        candidate_identity_id: "vector-1",
        rank: 1,
        title: "2024 Topps Chrome Other Player Gold /50",
        source_trust: "CANDIDATE",
        normalized_score: 0.91,
        direct_evidence_conflicts: ["year", "players"]
      }]
    }
  },
  timing: {
    total_ms: 1000
  }
};

const event = buildRecognitionWorkflowEvent({ result, payload });
assert.equal(event.analysis_run_id, "analysis-sidecar-test");
assert.equal(event.images[0].object_path, "front.jpg");
assert.equal(event.images[0].signed_url, undefined);
assert.equal(event.images[0].content_sha256, "abc");
assert.equal(event.catalog_candidates.length, 1);
assert.equal(event.vector_candidates.length, 1);
assert.deepEqual(event.vector_candidates[0].conflicting_fields, ["year", "players"]);

const triggers = summarizeWorkflowTriggers(event);
assert.equal(triggers.splink, true);
assert.equal(triggers.cleanlab, true);
assert.equal(triggers.label_studio, true);
assert.equal(triggers.cvat, true);
assert.equal(triggers.fiftyone, true);

const actionPlan = buildWorkflowActionPlan(event);
assert.equal(actionPlan.by_tool.paddle_ocr.length, 1);
assert.equal(actionPlan.by_tool.splink.length, 1);
assert.equal(actionPlan.by_tool.cleanlab.length, 1);
assert.equal(actionPlan.by_tool.label_studio.length, 1);
assert.equal(actionPlan.by_tool.cvat.length, 1);
assert.equal(actionPlan.by_tool.fiftyone.length, 1);
assert.equal(actionPlan.by_tool.paddle_ocr[0].blocking, false);
assert.ok(actionPlan.by_tool.paddle_ocr[0].output_contract.forbidden_outputs.includes("resolved_field_override"));
assert.ok(actionPlan.by_tool.splink[0].idempotency_key.startsWith("splink:catalog_entity_cluster_lookup:"));
assert.deepEqual(sidecarActionSummary(actionPlan, "label_studio").trigger_reasons, [
  "field_level_writer_review_required"
]);

const attachedWithoutConfig = await attachWorkflowSidecarsToListingResult({
  result,
  payload,
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true"
  },
  fetchImpl: async () => {
    throw new Error("should_not_fetch_when_event_log_disabled");
  }
});

assert.equal(attachedWithoutConfig.title, result.title);
assert.equal(attachedWithoutConfig.workflow_sidecars.paddle_ocr.status, workflowSidecarStatuses.QUEUED);
assert.equal(attachedWithoutConfig.workflow_sidecars.paddle_ocr.task_count, 1);
assert.ok(attachedWithoutConfig.workflow_sidecars.paddle_ocr.workflow_action_ids[0].startsWith("wf_"));
assert.equal(attachedWithoutConfig.workflow_sidecars.splink.status, workflowSidecarStatuses.QUEUED);
assert.ok(attachedWithoutConfig.workflow_sidecars.splink.output_contract.forbidden_outputs.includes("final_truth"));
assert.equal(attachedWithoutConfig.workflow_sidecars.cleanlab.status, workflowSidecarStatuses.QUEUED);
assert.equal(attachedWithoutConfig.workflow_sidecars.label_studio.status, workflowSidecarStatuses.NOT_CONFIGURED);
assert.equal(attachedWithoutConfig.workflow_sidecars.cvat.status, workflowSidecarStatuses.NOT_CONFIGURED);
assert.equal(attachedWithoutConfig.workflow_sidecars.fiftyone.status, workflowSidecarStatuses.QUEUED);

const writes = [];
const fetchImpl = async (url, init = {}) => {
  const pathname = new URL(url).pathname;
  writes.push({
    pathname,
    method: init.method,
    body: init.body ? JSON.parse(init.body) : null
  });
  return jsonResponse(201, [{ ok: true }]);
};

const sidecarsWithEventLog = await dispatchWorkflowSidecars({
  event,
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true",
    DATA_LOOP_WORKFLOW_EVENT_LOG_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl
});

assert.equal(sidecarsWithEventLog.cleanlab.status, workflowSidecarStatuses.CREATED);
assert.equal(sidecarsWithEventLog.paddle_ocr.status, workflowSidecarStatuses.QUEUED);
assert.equal(sidecarsWithEventLog.label_studio.status, workflowSidecarStatuses.NOT_CONFIGURED);
assert.equal(sidecarsWithEventLog.cvat.status, workflowSidecarStatuses.NOT_CONFIGURED);
assert.ok(writes.some((write) => write.pathname.endsWith("/recognition_workflow_events")));
assert.ok(writes.some((write) => write.pathname.endsWith("/data_quality_findings")));
assert.ok(writes.some((write) => write.pathname.endsWith("/annotation_tasks")));
assert.ok(writes.some((write) => write.pathname.endsWith("/hard_negative_examples")));
const eventWrite = writes.find((write) => write.pathname.endsWith("/recognition_workflow_events"));
assert.equal(eventWrite.body[0].workflow_action_plan.plan_version, "workflow-sidecar-action-plan-v1");
assert.equal(JSON.stringify(eventWrite.body).includes("signed-url"), false);
assert.equal(JSON.stringify(eventWrite.body).includes("secret"), false);
const findingWrite = writes.find((write) => write.pathname.endsWith("/data_quality_findings"));
assert.ok(findingWrite.body[0].idempotency_key.startsWith("cleanlab:data_quality_finding:"));
assert.equal(findingWrite.body[0].workflow_payload.tool, "cleanlab");
const taskWrite = writes.find((write) => write.pathname.endsWith("/annotation_tasks"));
assert.ok(taskWrite.body[0].idempotency_key.includes(":"));
assert.equal(taskWrite.body[0].task_payload.workflow_action.blocking, false);

const tmp = await mkdtemp(join(tmpdir(), "lynca-fiftyone-sidecar-"));
try {
  const exported = await dispatchWorkflowSidecars({
    event,
    env: {
      DATA_LOOP_SIDECARS_ENABLED: "true",
      DATA_LOOP_FIFTYONE_EXPORT_ENABLED: "true",
      DATA_LOOP_FIFTYONE_EXPORT_DIR: tmp
    },
    fetchImpl: async () => {
      throw new Error("no_supabase_writes_expected");
    }
  });
  assert.equal(exported.fiftyone.status, workflowSidecarStatuses.COMPLETED);
  assert.equal(exported.fiftyone.sample_exported, true);
  const manifest = await readFile(join(tmp, `${exported.fiftyone.sample_id}.json`), "utf8");
  assert.match(manifest, /lynca_listing_workflow_sidecar/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const failureSafe = await attachWorkflowSidecarsToListingResult({
  result,
  payload,
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true",
    DATA_LOOP_WORKFLOW_EVENT_LOG_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async () => {
    throw new Error("network_down");
  }
});
assert.equal(failureSafe.title, result.title);
assert.ok(Object.values(failureSafe.workflow_sidecars).every((sidecar) => sidecar.status));

console.log("workflow-sidecar-dispatcher tests passed");
