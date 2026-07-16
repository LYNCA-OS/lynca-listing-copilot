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
  tenant_id: "tenant_sidecar_test",
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
assert.equal(event.tenant_id, "tenant_sidecar_test");
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
assert.equal(triggers.lightgbm, true);
assert.equal(triggers.phoenix, true);

const actionPlan = buildWorkflowActionPlan(event);
assert.equal(actionPlan.by_tool.paddle_ocr.length, 1);
assert.equal(actionPlan.by_tool.splink.length, 1);
assert.equal(actionPlan.by_tool.cleanlab.length, 1);
assert.equal(actionPlan.by_tool.label_studio.length, 1);
assert.equal(actionPlan.by_tool.cvat.length, 1);
assert.equal(actionPlan.by_tool.fiftyone.length, 1);
assert.equal(actionPlan.by_tool.lightgbm.length, 1);
assert.equal(actionPlan.by_tool.phoenix.length, 1);
assert.equal(actionPlan.by_tool.paddle_ocr[0].blocking, false);
assert.ok(actionPlan.by_tool.paddle_ocr[0].output_contract.forbidden_outputs.includes("resolved_field_override"));
assert.ok(actionPlan.by_tool.splink[0].idempotency_key.startsWith("splink:catalog_entity_cluster_lookup:"));
assert.ok(actionPlan.by_tool.lightgbm[0].output_contract.forbidden_outputs.includes("production_decision"));
assert.ok(actionPlan.by_tool.phoenix[0].output_contract.forbidden_outputs.includes("raw_credential"));
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
assert.equal(attachedWithoutConfig.workflow_sidecars.lightgbm.status, workflowSidecarStatuses.QUEUED);
assert.equal(attachedWithoutConfig.workflow_sidecars.phoenix.status, workflowSidecarStatuses.NOT_CONFIGURED);
assert.equal(attachedWithoutConfig.workflow_summary.schema_version, "listing-workflow-summary-v1");
assert.equal(attachedWithoutConfig.workflow_summary.status, "FIELD_REVIEW");
assert.equal(attachedWithoutConfig.workflow_summary.ready_to_edit, true);
assert.equal(attachedWithoutConfig.workflow_summary.capability_summary.catalog.state, "FAIL_CLOSED");
assert.equal(attachedWithoutConfig.workflow_summary.capability_summary.vector.state, "FAIL_CLOSED");
assert.equal(attachedWithoutConfig.workflow_summary.capability_summary.ocr.state, "QUEUED");
assert.equal(attachedWithoutConfig.workflow_summary.capability_summary.data_loop.active_tools.includes("paddle_ocr"), true);
assert.ok(attachedWithoutConfig.workflow_summary.operator_next_actions.length >= 3);
assert.ok(attachedWithoutConfig.workflow_summary.operator_next_actions.some((action) => /黄色模块/.test(action.text)));
assert.ok(attachedWithoutConfig.workflow_summary.operator_next_actions.some((action) => /Serial、Grade、Cert/.test(action.text)));
assert.ok(attachedWithoutConfig.workflow_summary.operator_next_actions.some((action) => /不会把测试数据直接写入训练库/.test(action.text)));
assert.equal(attachedWithoutConfig.workflow_summary.ui.hide_raw_candidate_details, true);

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
assert.equal(sidecarsWithEventLog.lightgbm.status, workflowSidecarStatuses.QUEUED);
assert.equal(sidecarsWithEventLog.phoenix.status, workflowSidecarStatuses.NOT_CONFIGURED);
assert.ok(writes.some((write) => write.pathname.endsWith("/recognition_workflow_events")));
assert.ok(writes.some((write) => write.pathname.endsWith("/data_quality_findings")));
assert.ok(writes.some((write) => write.pathname.endsWith("/annotation_tasks")));
assert.ok(writes.some((write) => write.pathname.endsWith("/hard_negative_examples")));
const eventWrite = writes.find((write) => write.pathname.endsWith("/recognition_workflow_events"));
assert.equal(eventWrite.body[0].tenant_id, "tenant_sidecar_test");
assert.equal(eventWrite.body[0].workflow_action_plan.plan_version, "workflow-sidecar-action-plan-v1");
assert.equal(JSON.stringify(eventWrite.body).includes("signed-url"), false);
assert.equal(JSON.stringify(eventWrite.body).includes("secret"), false);
const findingWrite = writes.find((write) => write.pathname.endsWith("/data_quality_findings"));
assert.equal(findingWrite.body[0].tenant_id, "tenant_sidecar_test");
assert.ok(findingWrite.body[0].idempotency_key.startsWith("cleanlab:data_quality_finding:"));
assert.equal(findingWrite.body[0].workflow_payload.tool, "cleanlab");
const taskWrite = writes.find((write) => write.pathname.endsWith("/annotation_tasks"));
assert.equal(taskWrite.body[0].tenant_id, "tenant_sidecar_test");
assert.ok(taskWrite.body[0].idempotency_key.includes(":"));
assert.equal(taskWrite.body[0].task_payload.workflow_action.blocking, false);

const internalQueueWrites = [];
const internalQueueSidecars = await dispatchWorkflowSidecars({
  event,
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true",
    DATA_LOOP_WORKFLOW_EVENT_LOG_ENABLED: "true",
    DATA_LOOP_INTERNAL_ANNOTATION_QUEUE_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, init = {}) => {
    internalQueueWrites.push({
      pathname: new URL(url).pathname,
      body: init.body ? JSON.parse(init.body) : null
    });
    return jsonResponse(201, [{ ok: true }]);
  }
});
assert.equal(internalQueueSidecars.label_studio.status, workflowSidecarStatuses.CREATED);
assert.equal(internalQueueSidecars.label_studio.task_created, true);
assert.equal(internalQueueSidecars.label_studio.reason, "label_studio_internal_queue_created");
assert.equal(internalQueueSidecars.cvat.status, workflowSidecarStatuses.CREATED);
assert.equal(internalQueueSidecars.cvat.task_created, true);
assert.equal(internalQueueSidecars.cvat.reason, "cvat_internal_queue_created");
assert.ok(internalQueueWrites.some((write) => write.pathname.endsWith("/annotation_tasks") && write.body[0].status === "QUEUED"));

const nestedGapWrites = [];
const nestedGapResult = {
  ...result,
  asset_id: payload.candidate_id,
  title: "2024 Panini Donruss Test Gap Draft",
  provider: "openai_legacy",
  raw_provider_fields: {
    year: "2024",
    manufacturer: "Panini",
    product: "Donruss",
    players: ["Test Player"],
    card_name: "Net Marvels",
    card_number: "NM-TP",
    surface_color: "Gold",
    serial_number: "2/10",
    grade_company: "PSA",
    card_grade: "10",
    rc: true,
    auto: true
  },
  resolved_fields: {
    year: "2024",
    manufacturer: "Panini",
    players: ["Test Player"],
    rc: true
  },
  open_set_readiness: {
    catalog_gap_queue_candidate: true,
    status: "EVIDENCE_BACKED_NO_CATALOG",
    prompt_safe_candidate_count: 0,
    raw_candidate_count: 5,
    approved_candidate_count: 4,
    conflict_blocked_count: 4
  },
  c_group_diagnostics: {
    catalog_candidate_debug: [{
      candidate_id: "catalog-blocked-1",
      candidate_identity_id: "identity-blocked-1",
      reference_title: "2024 Panini Donruss Similar Player",
      source_trust: "APPROVED_REFERENCE",
      prompt_blocked: true,
      conflicting_fields: ["product"],
      anchor_agreement: {
        agreed: ["year", "subjects"],
        contradicted: ["product_hierarchy"],
        prompt_hard_filter_pass: false
      }
    }]
  }
};
const nestedGapSidecars = await dispatchWorkflowSidecars({
  event: buildRecognitionWorkflowEvent({ result: nestedGapResult, payload }),
  result: nestedGapResult,
  payload,
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/catalog_gap_queue") && init.method === "GET") return jsonResponse(200, []);
    if (pathname.endsWith("/catalog_gap_queue") && init.method === "POST") {
      nestedGapWrites.push(JSON.parse(init.body));
      return jsonResponse(201, [{ gap_id: "gap-nested" }]);
    }
    return jsonResponse(201, [{ ok: true }]);
  }
});
assert.equal(nestedGapSidecars.catalog_gap_queue.status, workflowSidecarStatuses.DISPATCHED);
assert.equal(nestedGapSidecars.catalog_gap_queue.gap_id, "gap-nested");
assert.equal(nestedGapWrites[0][0].asset_id, payload.candidate_id);
assert.equal(nestedGapWrites[0][0].tenant_id, "tenant_sidecar_test");
assert.equal(nestedGapWrites[0][0].gap_reason, "EVIDENCE_BACKED_NO_CATALOG");
assert.equal(nestedGapWrites[0][0].internal_candidates[0].candidate_identity_id, "identity-blocked-1");
assert.deepEqual(nestedGapWrites[0][0].metadata.catalog_gap_eligibility.conflict_blocked_count, 4);
assert.equal(nestedGapWrites[0][0].proposed_identity_fields.card_name, "Net Marvels");
assert.equal(nestedGapWrites[0][0].proposed_identity_fields.card_number, "NM-TP");
assert.equal(nestedGapWrites[0][0].proposed_identity_fields.surface_color, "Gold");
assert.equal(nestedGapWrites[0][0].proposed_identity_fields.auto, true);
assert.equal(nestedGapWrites[0][0].proposed_instance_fields.serial_number, "2/10");
assert.equal(nestedGapWrites[0][0].proposed_instance_fields.grade_company, "PSA");
assert.equal(nestedGapWrites[0][0].observed_fields.current_image_instance.card_grade, "10");

const eligibilityOnlyGapWrites = [];
const eligibilityOnlyResult = {
  ...result,
  asset_id: payload.candidate_id,
  open_set_readiness: undefined,
  c_group_diagnostics: {
    catalog_assist_eligibility: {
      raw_candidate_count: 5,
      approved_candidate_count: 5,
      conflict_blocked_count: 5,
      prompt_candidate_count: 0,
      reason: "approved_identity_candidate_direct_conflict"
    },
    catalog_candidate_debug: [{
      candidate_id: "catalog-blocked-2",
      candidate_identity_id: "identity-blocked-2",
      reference_title: "2024 Panini Prizm Similar Player",
      source_trust: "APPROVED_REFERENCE",
      prompt_blocked: true,
      conflicting_fields: ["collector_number"],
      anchor_agreement: {
        agreed: ["year", "manufacturer"],
        contradicted: ["collector_number"],
        prompt_hard_filter_pass: false
      }
    }]
  }
};
const eligibilityOnlyGapSidecars = await dispatchWorkflowSidecars({
  event: buildRecognitionWorkflowEvent({ result: eligibilityOnlyResult, payload }),
  result: eligibilityOnlyResult,
  payload,
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/catalog_gap_queue") && init.method === "GET") return jsonResponse(200, []);
    if (pathname.endsWith("/catalog_gap_queue") && init.method === "POST") {
      eligibilityOnlyGapWrites.push(JSON.parse(init.body));
      return jsonResponse(201, [{ gap_id: "gap-eligibility" }]);
    }
    return jsonResponse(201, [{ ok: true }]);
  }
});
assert.equal(eligibilityOnlyGapSidecars.catalog_gap_queue.status, workflowSidecarStatuses.DISPATCHED);
assert.equal(eligibilityOnlyGapSidecars.catalog_gap_queue.gap_id, "gap-eligibility");
assert.equal(eligibilityOnlyGapWrites[0][0].gap_reason, "approved_identity_candidate_direct_conflict");
assert.equal(eligibilityOnlyGapWrites[0][0].internal_candidates[0].candidate_identity_id, "identity-blocked-2");

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

const externalCalls = [];
const externalFetch = async (url, init = {}) => {
  const parsed = new URL(url);
  externalCalls.push({
    host: parsed.host,
    pathname: parsed.pathname,
    method: init.method,
    body: init.body ? JSON.parse(init.body) : null,
    authorization: init.headers?.authorization || null
  });
  if (parsed.host === "ocr.internal") {
    return jsonResponse(200, {
      raw_text: "12/50",
      confidence: 0.93,
      normalized_fields: { serial_number: "12/50", serial_denominator: "50" },
      model_id: "paddleocr",
      model_revision: "ppocr-v5"
    });
  }
  if (parsed.host === "splink.internal") return jsonResponse(200, { cluster_id: "cluster-1", match_probability: 0.88 });
  if (parsed.host === "cleanlab.internal") return jsonResponse(200, { label_quality_score: 0.42, reason: "conflict candidate" });
  if (parsed.host === "label.internal") return jsonResponse(201, { task_count: 1 });
  if (parsed.host === "cvat.internal") return jsonResponse(201, { id: 77, url: "https://cvat.internal/tasks/77" });
  if (parsed.host === "fiftyone.internal") return jsonResponse(200, { synced: true });
  if (parsed.host === "lightgbm.internal") return jsonResponse(200, { selected_candidate_id: "catalog-1", score: 0.81 });
  if (parsed.host === "phoenix.internal") return jsonResponse(200, { accepted: true });
  return jsonResponse(404, { error: "unexpected endpoint" });
};

const externallyDispatched = await dispatchWorkflowSidecars({
  event,
  payload: {
    ...payload,
    images: [{
      ...payload.images[0],
      signed_url: "https://signed.example/front.jpg?token=runtime-only"
    }]
  },
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true",
    DATA_LOOP_SIDECAR_ALLOWED_ORIGINS: [
      "https://splink.internal",
      "https://cleanlab.internal",
      "https://label.internal",
      "https://cvat.internal",
      "https://fiftyone.internal",
      "https://lightgbm.internal",
      "https://phoenix.internal"
    ].join(","),
    DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED: "true",
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
    PADDLE_OCR_WORKER_URL: "https://ocr.internal",
    PADDLE_OCR_WORKER_TOKEN: "ocr-token",
    DATA_LOOP_SPLINK_BATCH_ENABLED: "true",
    DATA_LOOP_SPLINK_BATCH_URL: "https://splink.internal/batch",
    DATA_LOOP_SPLINK_BATCH_TOKEN: "splink-token",
    DATA_LOOP_CLEANLAB_SCORE_URL: "https://cleanlab.internal/score",
    DATA_LOOP_CLEANLAB_SCORE_TOKEN: "cleanlab-token",
    DATA_LOOP_EXTERNAL_TASK_CREATION_ENABLED: "true",
    LABEL_STUDIO_URL: "https://label.internal",
    LABEL_STUDIO_TOKEN: "label-token",
    LABEL_STUDIO_PROJECT_ID: "123",
    CVAT_URL: "https://cvat.internal",
    CVAT_TOKEN: "cvat-token",
    CVAT_PROJECT_ID: "456",
    DATA_LOOP_FIFTYONE_SYNC_URL: "https://fiftyone.internal/sync",
    DATA_LOOP_FIFTYONE_SYNC_TOKEN: "fiftyone-token",
    DATA_LOOP_LIGHTGBM_RERANKER_URL: "https://lightgbm.internal/score",
    DATA_LOOP_LIGHTGBM_RERANKER_TOKEN: "lightgbm-token",
    PHOENIX_COLLECTOR_ENDPOINT: "https://phoenix.internal/v1/traces",
    PHOENIX_API_KEY: "phoenix-token"
  },
  fetchImpl: externalFetch
});

assert.equal(externallyDispatched.paddle_ocr.status, workflowSidecarStatuses.COMPLETED);
assert.equal(externallyDispatched.splink.status, workflowSidecarStatuses.COMPLETED);
assert.equal(externallyDispatched.cleanlab.label_quality_score, 0.42);
assert.equal(externallyDispatched.label_studio.status, workflowSidecarStatuses.CREATED);
assert.equal(externallyDispatched.cvat.task_id, 77);
assert.equal(externallyDispatched.fiftyone.reason, "fiftyone_cloud_gallery_synced");
assert.equal(externallyDispatched.lightgbm.selected_candidate_id, "catalog-1");
assert.equal(externallyDispatched.phoenix.trace_exported, true);
assert.ok(externalCalls.some((call) => call.host === "ocr.internal" && call.body.image_url.includes("runtime-only")));
assert.ok(externalCalls.some((call) => call.host === "label.internal" && call.pathname === "/api/projects/123/import"));
assert.ok(externalCalls.some((call) => call.host === "cvat.internal" && call.pathname === "/api/tasks"));
assert.ok(externalCalls.some((call) => call.host === "phoenix.internal" && call.body.spans?.[0]?.attributes?.workflow_action_count >= 1));

const hostileSidecarCalls = [];
await dispatchWorkflowSidecars({
  event,
  env: {
    DATA_LOOP_SIDECARS_ENABLED: "true",
    DATA_LOOP_CLEANLAB_SCORE_URL: "https://attacker.example/collect",
    DATA_LOOP_INTERNAL_SIDECAR_TOKEN: "global-internal-secret",
    VERCEL_AUTOMATION_BYPASS_SECRET: "global-vercel-secret"
  },
  fetchImpl: async (url, init = {}) => {
    hostileSidecarCalls.push({ url: String(url), authorization: init.headers?.authorization || "" });
    return jsonResponse(200, { ok: true });
  }
});
assert.deepEqual(hostileSidecarCalls, [], "an unallowlisted sidecar origin must receive neither a request nor a global secret");

for (const redirectStatus of [307, 308]) {
  const initialUrl = "https://redirector.internal/v1/traces";
  const redirectLocation = "http://127.0.0.1:54321/private-sidecar-target";
  const redirectCalls = [];
  const redirectBlocked = await dispatchWorkflowSidecars({
    event,
    env: {
      DATA_LOOP_SIDECARS_ENABLED: "true",
      DATA_LOOP_SIDECAR_ALLOWED_ORIGINS: "https://redirector.internal",
      PHOENIX_COLLECTOR_ENDPOINT: initialUrl
    },
    fetchImpl: async function simulatedRedirectFetch(url, init = {}) {
      const requestUrl = String(url);
      redirectCalls.push({ url: requestUrl, redirect: init.redirect || "follow" });
      if (requestUrl === initialUrl) {
        if (init.redirect !== "manual") {
          return simulatedRedirectFetch(redirectLocation, init);
        }
        return {
          ...jsonResponse(redirectStatus, {}),
          headers: new Headers({ location: redirectLocation })
        };
      }
      return jsonResponse(200, { reached_private_target: true });
    }
  });

  assert.equal(redirectBlocked.phoenix.status, workflowSidecarStatuses.FAILED);
  assert.equal(redirectBlocked.phoenix.reason, `HTTP ${redirectStatus} redirect_not_allowed`);
  assert.deepEqual(redirectCalls, [{ url: initialUrl, redirect: "manual" }], `${redirectStatus} redirects must not reach Location`);
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
assert.equal(failureSafe.workflow_summary.schema_version, "listing-workflow-summary-v1");
assert.equal(failureSafe.workflow_summary.status, "FIELD_REVIEW");
assert.equal(failureSafe.workflow_summary.capability_summary.data_loop.active_tools.length > 0, true);
assert.ok(failureSafe.workflow_summary.operator_next_actions.length > 0);

console.log("workflow-sidecar-dispatcher tests passed");
