import crypto from "node:crypto";

export const workflowActionTools = Object.freeze([
  "paddle_ocr",
  "splink",
  "cleanlab",
  "label_studio",
  "cvat",
  "fiftyone",
  "lightgbm",
  "phoenix"
]);

const defaultOutputContracts = Object.freeze({
  paddle_ocr: {
    allowed_outputs: ["EvidencePatch", "field_candidate", "field_conflict"],
    forbidden_outputs: ["final_title", "resolved_field_override", "catalog_identity", "parallel_inference"]
  },
  splink: {
    allowed_outputs: ["candidate_identity_cluster", "duplicate_warning", "merge_suggestion", "reranker_feature"],
    forbidden_outputs: ["final_truth", "reviewed_internal_promotion", "title_rendering"]
  },
  cleanlab: {
    allowed_outputs: ["quality_finding", "review_priority", "active_learning_hint", "hard_negative_priority"],
    forbidden_outputs: ["field_overwrite", "final_title", "production_block_without_flag"]
  },
  label_studio: {
    allowed_outputs: ["field_review_task", "reviewed_field_annotation", "field_level_ground_truth_after_completion"],
    forbidden_outputs: ["parser_auto_promotion", "unreviewed_catalog_truth"]
  },
  cvat: {
    allowed_outputs: ["crop_annotation_task", "ocr_region_ground_truth", "crop_training_example"],
    forbidden_outputs: ["identity_truth", "catalog_identity_promotion", "title_rendering"]
  },
  fiftyone: {
    allowed_outputs: ["failure_gallery_sample", "hard_negative_review_item", "visual_error_cluster"],
    forbidden_outputs: ["production_decision", "field_overwrite", "final_truth"]
  },
  lightgbm: {
    allowed_outputs: ["shadow_candidate_score", "shadow_selected_candidate_id", "shadow_reranker_feature_importance"],
    forbidden_outputs: ["production_decision", "field_overwrite", "final_title", "reviewed_internal_promotion"]
  },
  phoenix: {
    allowed_outputs: ["workflow_trace", "latency_span", "tool_observability_event"],
    forbidden_outputs: ["field_overwrite", "final_title", "catalog_truth", "raw_credential"]
  }
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && item !== "") : [];
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function candidateIds(candidates = []) {
  return compactArray(candidates)
    .map((candidate) => cleanText(candidate.candidate_id || candidate.id))
    .filter(Boolean)
    .slice(0, 20);
}

function conflictingCandidates(event = {}) {
  return [
    ...(event.catalog_candidates || []),
    ...(event.vector_candidates || [])
  ].filter((candidate) => compactArray(candidate.conflicting_fields).length > 0);
}

function fieldTasks(event = {}) {
  const tasks = event.field_task_orchestration?.tasks;
  return Array.isArray(tasks) ? tasks : [];
}

function ocrTasks(event = {}) {
  return fieldTasks(event).filter((task) => /^ocr_/i.test(cleanText(task.task_id || task.id)));
}

function cropLabelsForFields(fields = []) {
  const labels = new Set();
  for (const field of fields.map(cleanText)) {
    if (/serial/i.test(field)) labels.add("SERIAL_REGION");
    if (/collector|card_number|checklist|tcg/i.test(field)) labels.add("CARD_NUMBER_REGION");
    if (/grade|cert|slab/i.test(field)) labels.add("SLAB_LABEL_REGION");
    if (/product|year|set/i.test(field)) labels.add("PRODUCT_TEXT_REGION");
    if (/player|subject|character/i.test(field)) labels.add("PLAYER_NAME_REGION");
    if (/surface|parallel|color/i.test(field)) labels.add("SURFACE_REGION");
  }
  return [...labels];
}

function priorityForFields(fields = [], riskFlags = []) {
  const text = `${fields.join(" ")} ${riskFlags.join(" ")}`;
  if (/PROVIDER_FAILURE|OCR_FIELD_CONFLICT|FIELD_CONFLICT|serial|grade|year|subject|player|collector|checklist/i.test(text)) return "HIGH";
  if (fields.length || riskFlags.length) return "MEDIUM";
  return "LOW";
}

function action({
  event,
  tool,
  actionType,
  priority = "MEDIUM",
  triggerReasons = [],
  payload = {}
}) {
  const idempotencySource = {
    tool,
    actionType,
    analysis_run_id: event.analysis_run_id || null,
    source_record_id: event.source_record_id || null,
    asset_id: event.asset_id || null,
    triggerReasons,
    payload
  };
  const idempotencyKey = `${tool}:${actionType}:${stableDigest(idempotencySource)}`;
  return {
    workflow_action_id: `wf_${stableDigest({ idempotencyKey })}`,
    idempotency_key: idempotencyKey,
    tool,
    action_type: actionType,
    priority,
    trigger_reasons: triggerReasons,
    blocking: false,
    output_contract: defaultOutputContracts[tool],
    payload
  };
}

export function buildWorkflowActionPlan(event = {}) {
  const actions = [];
  const riskFlags = event.risk_flags || [];
  const reviewFields = event.review_required_fields || [];
  const catalogIds = candidateIds(event.catalog_candidates);
  const vectorIds = candidateIds(event.vector_candidates);
  const conflicted = conflictingCandidates(event);
  const ocr = ocrTasks(event);

  if (ocr.length) {
    actions.push(action({
      event,
      tool: "paddle_ocr",
      actionType: "field_ocr_verification",
      priority: priorityForFields(reviewFields, riskFlags),
      triggerReasons: ["field_task_orchestrator_requested_ocr_verifier"],
      payload: {
        task_ids: ocr.map((task) => cleanText(task.task_id || task.id)).filter(Boolean),
        affected_fields: [...new Set(ocr.flatMap((task) => compactArray(task.affected_fields || task.fields)))],
        input_roles: [...new Set(ocr.flatMap((task) => compactArray(task.input_roles)))],
        evidence_only: true
      }
    }));
  }

  const splinkReasons = [];
  if ((event.catalog_candidates || []).length > 1) splinkReasons.push("multiple_catalog_candidates");
  if (conflicted.length) splinkReasons.push("candidate_direct_conflict");
  if (riskFlags.some((flag) => /CATALOG_GAP|CANDIDATE|DUPLICATE|CONFLICT/i.test(flag))) splinkReasons.push("catalog_or_duplicate_risk");
  if (splinkReasons.length) {
    actions.push(action({
      event,
      tool: "splink",
      actionType: "catalog_entity_cluster_lookup",
      priority: "HIGH",
      triggerReasons: splinkReasons,
      payload: {
        catalog_candidate_ids: catalogIds,
        vector_candidate_ids: vectorIds,
        conflicted_candidate_ids: candidateIds(conflicted),
        lookup_mode: "precomputed_cluster_only"
      }
    }));
  }

  const cleanlabReasons = [];
  if (reviewFields.length) cleanlabReasons.push("review_required_fields_present");
  if (riskFlags.some((flag) => /LOW|REVIEW|ABSTAIN|AMBIG|GAP|FAIL|CONFLICT/i.test(flag))) cleanlabReasons.push("risk_or_low_confidence_signal");
  if (conflicted.length) cleanlabReasons.push("hard_negative_or_conflict_candidate");
  if (cleanlabReasons.length) {
    actions.push(action({
      event,
      tool: "cleanlab",
      actionType: "data_quality_finding",
      priority: priorityForFields(reviewFields, riskFlags),
      triggerReasons: cleanlabReasons,
      payload: {
        affected_fields: reviewFields,
        risk_flags: riskFlags,
        conflict_count: conflicted.length,
        model_output_is_label_candidate_only: true
      }
    }));
  }

  const labelStudioReasons = [];
  if (reviewFields.length) labelStudioReasons.push("field_level_writer_review_required");
  if (riskFlags.some((flag) => /CATALOG_GAP|NO_EXACT|NONE_OF_THE_ABOVE|CONFLICT/i.test(flag))) labelStudioReasons.push("catalog_gap_or_open_set_review");
  if (labelStudioReasons.length) {
    actions.push(action({
      event,
      tool: "label_studio",
      actionType: "field_review_task",
      priority: priorityForFields(reviewFields, riskFlags),
      triggerReasons: labelStudioReasons,
      payload: {
        template: "lynca_card_field_review_v1",
        review_required_fields: reviewFields,
        prelabel_fields: event.resolved_fields || {},
        candidate_count: catalogIds.length + vectorIds.length
      }
    }));
  }

  const cropLabels = cropLabelsForFields(reviewFields);
  const cvatReasons = [];
  if (ocr.length) cvatReasons.push("ocr_verifier_needed_region_ground_truth");
  if (cropLabels.length) cvatReasons.push("crop_region_review_required");
  if (riskFlags.some((flag) => /IMAGE|CROP|MULTI|OCR/i.test(flag))) cvatReasons.push("image_or_ocr_risk_signal");
  if (cvatReasons.length) {
    actions.push(action({
      event,
      tool: "cvat",
      actionType: "crop_region_annotation_task",
      priority: priorityForFields(reviewFields, riskFlags),
      triggerReasons: cvatReasons,
      payload: {
        labels: cropLabels.length ? cropLabels : ["SERIAL_REGION", "CARD_NUMBER_REGION", "SLAB_LABEL_REGION"],
        image_ids: (event.images || []).map((image) => image.image_id).filter(Boolean),
        region_truth_only: true
      }
    }));
  }

  const fiftyOneReasons = [];
  if (conflicted.length) fiftyOneReasons.push("candidate_conflict_hard_negative");
  if (riskFlags.some((flag) => /FAIL|REGRESSION|CONFLICT|GAP|SAFE_ASSIST|VECTOR|CRITICAL/i.test(flag))) fiftyOneReasons.push("failure_or_regression_gallery_candidate");
  if (fiftyOneReasons.length) {
    actions.push(action({
      event,
      tool: "fiftyone",
      actionType: "failure_gallery_sample_export",
      priority: priorityForFields(reviewFields, riskFlags),
      triggerReasons: fiftyOneReasons,
      payload: {
        catalog_candidate_ids: catalogIds,
        vector_candidate_ids: vectorIds,
        hard_negative_candidate_ids: candidateIds(conflicted),
        include_images: true
      }
    }));
  }

  if (catalogIds.length || vectorIds.length || conflicted.length) {
    actions.push(action({
      event,
      tool: "lightgbm",
      actionType: "shadow_candidate_rerank",
      priority: conflicted.length ? "HIGH" : "MEDIUM",
      triggerReasons: [
        catalogIds.length ? "catalog_candidates_available" : "",
        vectorIds.length ? "vector_candidates_available" : "",
        conflicted.length ? "hard_negative_or_conflict_candidate" : ""
      ].filter(Boolean),
      payload: {
        catalog_candidate_ids: catalogIds,
        vector_candidate_ids: vectorIds,
        conflicted_candidate_ids: candidateIds(conflicted),
        shadow_only: true,
        production_decision_locked: true
      }
    }));
  }

  actions.push(action({
    event,
    tool: "phoenix",
    actionType: "workflow_trace_export",
    priority: "LOW",
    triggerReasons: ["recognition_workflow_observability"],
    payload: {
      provider_mode: event.provider_mode || null,
      risk_flags: riskFlags,
      review_required_fields: reviewFields,
      timing: event.timing || {},
      trace_only: true
    }
  }));

  const byTool = Object.fromEntries(workflowActionTools.map((tool) => [
    tool,
    actions.filter((item) => item.tool === tool)
  ]));

  return {
    plan_version: "workflow-sidecar-action-plan-v1",
    event_id: event.event_id || null,
    analysis_run_id: event.analysis_run_id || null,
    actions,
    by_tool: byTool,
    summary: Object.fromEntries(workflowActionTools.map((tool) => [
      tool,
      {
        action_count: byTool[tool].length,
        action_ids: byTool[tool].map((item) => item.workflow_action_id),
        trigger_reasons: [...new Set(byTool[tool].flatMap((item) => item.trigger_reasons))],
        max_priority: byTool[tool].some((item) => item.priority === "HIGH")
          ? "HIGH"
          : byTool[tool].some((item) => item.priority === "MEDIUM")
            ? "MEDIUM"
            : byTool[tool].length
              ? "LOW"
              : "NONE",
        blocking: false
      }
    ]))
  };
}

export function actionsForTool(actionPlan = {}, tool = "") {
  return actionPlan.by_tool?.[tool] || [];
}

export function sidecarActionSummary(actionPlan = {}, tool = "") {
  const actions = actionsForTool(actionPlan, tool);
  const summary = actionPlan.summary?.[tool] || {
    action_count: 0,
    action_ids: [],
    trigger_reasons: [],
    max_priority: "NONE",
    blocking: false
  };
  return {
    workflow_action_count: summary.action_count,
    workflow_action_ids: summary.action_ids,
    trigger_reasons: summary.trigger_reasons,
    max_priority: summary.max_priority,
    workflow_blocking: false,
    output_contract: actions[0]?.output_contract || defaultOutputContracts[tool] || null
  };
}
