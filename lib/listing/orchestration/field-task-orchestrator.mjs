import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { ocrFieldTaskIds } from "../ocr/ocr-contract.mjs";

export const fieldTaskStatuses = Object.freeze([
  "LOADING",
  "OBSERVED",
  "PROVISIONAL",
  "SUPPORTED",
  "CONFLICT",
  "REVIEW_REQUIRED",
  "CONFIRMED",
  "NOT_APPLICABLE"
]);

const authoritativeSourceTypes = new Set([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "INTERNAL_APPROVED_HISTORY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_REGISTRY",
  "STRUCTURED_DATABASE",
  "VECTOR_APPROVED_REFERENCE"
]);

const catalogTaskIds = new Set([
  "catalog_exact_code_lookup",
  "catalog_year_product_subject_lookup",
  "catalog_product_serial_denominator_lookup"
]);

const ocrTaskIds = new Set(ocrFieldTaskIds);

const taskDefinitions = Object.freeze([
  {
    task_id: "year_product_observation",
    priority: "high",
    affected_fields: ["year", "manufacturer", "brand", "product", "set"],
    dependency_mode: "independent",
    input_roles: ["front", "back", "slab_label"]
  },
  {
    task_id: "subject_team_observation",
    priority: "high",
    affected_fields: ["players", "character", "team"],
    dependency_mode: "independent",
    input_roles: ["front", "back", "slab_label"]
  },
  {
    task_id: "collector_number_observation",
    priority: "high",
    affected_fields: ["collector_number", "checklist_code"],
    dependency_mode: "independent",
    input_roles: ["back", "slab_label", "card_code_crop"]
  },
  {
    task_id: "ocr_collector_number_verifier",
    priority: "high",
    affected_fields: ["collector_number", "checklist_code"],
    dependency_mode: "condition",
    condition: "collector_or_checklist_missing_low_confidence_or_cold_start_anchor_needed",
    input_roles: ["card_code_crop", "back"]
  },
  {
    task_id: "serial_observation",
    priority: "high",
    affected_fields: ["serial_number", "one_of_one"],
    dependency_mode: "independent",
    input_roles: ["serial_crop", "front", "back"]
  },
  {
    task_id: "ocr_serial_verifier",
    priority: "high",
    affected_fields: ["serial_number"],
    dependency_mode: "condition",
    condition: "serial_missing_low_confidence_or_conflicting",
    input_roles: ["serial_crop"]
  },
  {
    task_id: "grade_label_observation",
    priority: "high",
    affected_fields: ["grade_company", "card_grade", "auto_grade", "grade_type"],
    dependency_mode: "independent",
    input_roles: ["slab_label_crop"]
  },
  {
    task_id: "ocr_slab_label_verifier",
    priority: "high",
    affected_fields: ["grade_company", "card_grade", "auto_grade", "grade_type"],
    dependency_mode: "condition",
    condition: "slab_detected_or_grade_missing_low_confidence",
    input_roles: ["grade_label_crop", "slab_label_crop"]
  },
  {
    task_id: "ocr_tcg_code_verifier",
    priority: "high",
    affected_fields: ["collector_number", "checklist_code"],
    dependency_mode: "condition",
    condition: "tcg_segment_needs_set_code_card_number_or_rarity",
    input_roles: ["card_code_crop", "back"]
  },
  {
    task_id: "observable_card_type_observation",
    priority: "high",
    affected_fields: ["observable_components", "official_card_type", "card_type", "auto", "patch", "relic", "jersey", "rc", "sketch", "redemption"],
    dependency_mode: "independent",
    input_roles: ["front", "back"]
  },
  {
    task_id: "surface_color_observation",
    priority: "medium",
    affected_fields: ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"],
    dependency_mode: "independent",
    input_roles: ["front", "surface_crop"]
  },
  {
    task_id: "catalog_exact_code_lookup",
    priority: "high",
    affected_fields: ["collector_number", "checklist_code"],
    dependency_mode: "depends_on_any",
    depends_on_any: ["collector_number", "checklist_code"]
  },
  {
    task_id: "catalog_year_product_subject_lookup",
    priority: "high",
    affected_fields: ["year", "product", "players", "character"],
    dependency_mode: "depends_on_any",
    depends_on_any: ["year", "product", "players", "character"]
  },
  {
    task_id: "catalog_product_serial_denominator_lookup",
    priority: "medium",
    affected_fields: ["product", "serial_number", "surface_color"],
    dependency_mode: "depends_on_any",
    depends_on_any: ["product", "serial_number"]
  },
  {
    task_id: "vector_retrieval_lazy",
    priority: "medium",
    affected_fields: ["candidate_identity"],
    dependency_mode: "condition",
    condition: "no_strong_catalog_anchor"
  }
]);

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function confidenceOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.max(0, Math.min(1, number)) : null;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && normalizeText(value) !== "" && value !== "UNKNOWN";
}

function fieldValue(resolved = {}, fieldName = "") {
  if (fieldName === "players") return resolved.players;
  if (fieldName === "candidate_identity") return null;
  return resolved[fieldName];
}

function anyFieldPresent(resolved = {}, fields = []) {
  return fields.some((field) => hasValue(fieldValue(resolved, field)));
}

function evidenceField(result = {}, fieldName = "") {
  const sources = [
    result.evidence,
    result.normalized_evidence,
    result.evidence_fields
  ];
  for (const source of sources) {
    const field = source?.[fieldName];
    if (field && typeof field === "object" && !Array.isArray(field)) return field;
  }
  return null;
}

function fieldState(result = {}, fieldName = "") {
  const states = Array.isArray(result.field_states)
    ? result.field_states
    : Array.isArray(result.identity_resolution?.field_states)
      ? result.identity_resolution.field_states
      : [];
  return states.find((state) => state?.field === fieldName) || null;
}

function conflictFields(result = {}) {
  const conflicts = [
    ...(Array.isArray(result.conflict_map) ? result.conflict_map : []),
    ...(Array.isArray(result.identity_resolution?.conflict_map) ? result.identity_resolution.conflict_map : [])
  ];
  return new Set(conflicts
    .filter((conflict) => conflict?.resolved !== true)
    .map((conflict) => normalizeText(conflict.field || conflict.field_name))
    .filter(Boolean));
}

function fieldHasConflict(result = {}, fieldName = "") {
  const conflicts = conflictFields(result);
  if (conflicts.has(fieldName)) return true;
  const evidence = evidenceField(result, fieldName);
  if (evidence?.status === "CONFLICT") return true;
  const state = fieldState(result, fieldName);
  return state?.conflicts === true || (Array.isArray(state?.conflict_items) && state.conflict_items.length > 0);
}

function fieldConfidence(result = {}, fieldName = "") {
  const evidence = evidenceField(result, fieldName);
  const state = fieldState(result, fieldName);
  return confidenceOrNull(evidence?.confidence ?? state?.resolution_confidence);
}

function fieldSourceSummary(result = {}, fieldName = "") {
  const evidence = evidenceField(result, fieldName);
  const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
  return sources.slice(0, 3).map((source) => ({
    source_type: source.source_type || source.source || null,
    region: source.region || null,
    side: source.side || source.capture_role || null,
    observed_text: source.observed_text || source.raw_text || null
  }));
}

function hasAuthoritativeSource(result = {}, fields = []) {
  return fields.some((fieldName) => {
    const evidence = evidenceField(result, fieldName);
    const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
    return sources.some((source) => authoritativeSourceTypes.has(String(source.source_type || source.source || "").toUpperCase()));
  });
}

function confirmedByEvidence(result = {}, fields = []) {
  return fields.some((fieldName) => {
    const evidence = evidenceField(result, fieldName);
    const state = fieldState(result, fieldName);
    return ["CONFIRMED", "MANUAL_CONFIRMED"].includes(String(evidence?.status || "").toUpperCase())
      || Number(state?.resolution_confidence || 0) >= 0.86;
  });
}

function catalogEligibility(result = {}) {
  return result.catalog_assist_eligibility
    || result.catalog_assist_packet?.vector_retrieval?.assist_filter
    || result.catalog_candidate_packet?.vector_retrieval?.assist_filter
    || {};
}

function vectorEligibility(result = {}) {
  return result.vector_assist_eligibility
    || result.vector_assist_packet?.vector_retrieval?.assist_filter
    || result.vector_candidate_packet?.vector_retrieval?.assist_filter
    || {};
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function catalogStatusForTask(result = {}, task = {}) {
  const eligibility = catalogEligibility(result);
  const promptCount = count(eligibility.prompt_candidate_count);
  const conflictCount = count(eligibility.conflict_blocked_count);
  const approvedCount = count(eligibility.approved_candidate_count);
  const rawCount = count(eligibility.raw_candidate_count);
  if (!promptCount && !approvedCount && !rawCount && !conflictCount && !result.catalog_candidate_packet && !result.catalog_retrieval) {
    return dependencySatisfied(result, task) ? "PROVISIONAL" : "LOADING";
  }
  if (conflictCount > 0) return "CONFLICT";
  if (promptCount > 0) return "SUPPORTED";
  if (approvedCount > 0 || rawCount > 0) return "REVIEW_REQUIRED";
  return "PROVISIONAL";
}

function vectorStatusForTask(result = {}) {
  if (result.vector_lazy_skip?.skipped === true || result.vector_lazy_skip === true) return "SUPPORTED";
  const eligibility = vectorEligibility(result);
  const conflictCount = count(eligibility.conflict_blocked_count);
  const promptCount = count(eligibility.prompt_candidate_count);
  const approvedCount = count(eligibility.approved_candidate_count);
  const rawCount = count(eligibility.raw_candidate_count);
  if (!promptCount && !approvedCount && !rawCount && !conflictCount && !result.vector_candidate_packet && !result.vector_retrieval) return "LOADING";
  if (conflictCount > 0) return "CONFLICT";
  if (promptCount > 0) return "SUPPORTED";
  if (approvedCount > 0 || rawCount > 0) return "REVIEW_REQUIRED";
  return "PROVISIONAL";
}

function ocrTaskEntries(result = {}) {
  const tasks = result.ocr_verification?.tasks;
  if (Array.isArray(tasks)) return tasks;
  if (tasks && typeof tasks === "object") {
    return Object.entries(tasks).map(([task_id, value]) => ({
      task_id,
      ...(value && typeof value === "object" ? value : { status: value })
    }));
  }
  return [];
}

function ocrTaskEntry(result = {}, taskId = "") {
  return ocrTaskEntries(result).find((entry) => entry.task_id === taskId) || null;
}

function normalizedStatus(value = "") {
  const status = String(value || "").toUpperCase();
  if (fieldTaskStatuses.includes(status)) return status;
  if (["OK", "DONE", "PASSED", "SUPPORTED"].includes(status)) return "SUPPORTED";
  if (["CONFIRMED"].includes(status)) return "CONFIRMED";
  if (["CONFLICT", "FAILED_CONFLICT"].includes(status)) return "CONFLICT";
  if (["ERROR", "FAILED", "TIMEOUT", "UNAVAILABLE", "SKIPPED", "BLOCKED"].includes(status)) return "REVIEW_REQUIRED";
  return "";
}

function fieldHasOcrSource(result = {}, fieldName = "") {
  const evidence = evidenceField(result, fieldName);
  const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
  if (sources.some((source) => ["OCR", "OCR_ONLY"].includes(String(source.source_type || source.source || "").toUpperCase()))) return true;
  const state = fieldState(result, fieldName);
  const summaries = Array.isArray(state?.source_summary) ? state.source_summary : [];
  return summaries.some((summary) => ["OCR", "OCR_ONLY"].includes(String(summary.source || summary.source_type || "").toUpperCase()));
}

function fieldMissingOrLowConfidence(result = {}, fieldName = "", minConfidence = 0.74) {
  const resolved = normalizeResolvedFields(result.resolved || result.resolved_fields || result.fields || {});
  return !hasValue(fieldValue(resolved, fieldName)) || Number(fieldConfidence(result, fieldName) || 0) < minConfidence || fieldHasConflict(result, fieldName);
}

function resultLooksTcg(result = {}) {
  const resolved = normalizeResolvedFields(result.resolved || result.resolved_fields || result.fields || {});
  const text = [
    resolved.category,
    resolved.standardness,
    resolved.product,
    resolved.set,
    resolved.language,
    ...(Array.isArray(resolved.attributes) ? resolved.attributes : []),
    result.route,
    result.provider_mode
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(?:tcg|pokemon|pokémon|one piece|yugioh|yu-gi-oh|dragon ball|digimon|lorcana|magic|mtg|weiss|vanguard|union arena)\b/.test(text);
}

function resultHasSlabSignal(result = {}) {
  const resolved = normalizeResolvedFields(result.resolved || result.resolved_fields || result.fields || {});
  if (hasValue(resolved.grade_company) || hasValue(resolved.card_grade) || hasValue(resolved.auto_grade)) return true;
  if (["grade_company", "card_grade", "auto_grade", "grade_type"].some((field) => evidenceField(result, field))) return true;
  const images = Array.isArray(result.images) ? result.images : [];
  return images.some((image) => {
    const text = [
      image.role,
      image.storageRole,
      image.storage_role,
      image.sourceRegion,
      image.source_region,
      image.cropMetadata?.crop_role,
      image.crop_metadata?.crop_role
    ].filter(Boolean).join(" ").toLowerCase();
    return /(?:slab|grade_label|graded|psa|bgs|sgc|cgc)/.test(text);
  });
}

function coldStartNeedsTextAnchor(result = {}) {
  const status = String(result.cold_start_status || result.open_world_identity?.catalog_match_status || result.identity_resolution?.open_world_identity?.catalog_match_status || "").toUpperCase();
  return /COLD|CATALOG_GAP|NO_EXACT|NONE_OF_THE_ABOVE|NEEDS_REVIEW|MARKETPLACE_HINTS_ONLY/.test(status);
}

function ocrTriggerReason(result = {}, task = {}) {
  if (task.task_id === "ocr_serial_verifier") {
    if (fieldMissingOrLowConfidence(result, "serial_number", 0.82)) return "serial_missing_low_confidence_or_conflicting";
    if (coldStartNeedsTextAnchor(result)) return "cold_start_blind_needs_serial_anchor";
    return "";
  }
  if (task.task_id === "ocr_collector_number_verifier") {
    if (fieldMissingOrLowConfidence(result, "collector_number", 0.78) && fieldMissingOrLowConfidence(result, "checklist_code", 0.78)) {
      return "collector_or_checklist_missing_low_confidence_or_conflicting";
    }
    if (coldStartNeedsTextAnchor(result)) return "cold_start_blind_needs_code_anchor";
    return "";
  }
  if (task.task_id === "ocr_slab_label_verifier") {
    if (resultHasSlabSignal(result) && ["grade_company", "card_grade"].some((field) => fieldMissingOrLowConfidence(result, field, 0.86))) {
      return "slab_detected_grade_missing_or_low_confidence";
    }
    return "";
  }
  if (task.task_id === "ocr_tcg_code_verifier") {
    if (resultLooksTcg(result) && ["collector_number", "checklist_code"].some((field) => fieldMissingOrLowConfidence(result, field, 0.78))) {
      return "tcg_segment_needs_set_code_card_number_or_rarity";
    }
    return "";
  }
  return "";
}

function ocrStatusForTask(result = {}, task = {}) {
  const explicit = ocrTaskEntry(result, task.task_id);
  const explicitStatus = normalizedStatus(explicit?.status);
  if (explicitStatus) return explicitStatus;

  if ((task.affected_fields || []).some((field) => fieldHasConflict(result, field))) return "CONFLICT";
  if ((task.affected_fields || []).some((field) => fieldHasOcrSource(result, field))) {
    return (task.affected_fields || []).some((field) => fieldConfidence(result, field) >= 0.86)
      ? "CONFIRMED"
      : "SUPPORTED";
  }

  return ocrTriggerReason(result, task) ? "REVIEW_REQUIRED" : "NOT_APPLICABLE";
}

function dependencySatisfied(result = {}, task = {}) {
  const resolved = normalizeResolvedFields(result.resolved || result.resolved_fields || result.fields || {});
  const dependencies = Array.isArray(task.depends_on_any) ? task.depends_on_any : [];
  if (!dependencies.length) return true;
  return dependencies.some((field) => hasValue(fieldValue(resolved, field)));
}

function observationStatusForTask(result = {}, task = {}) {
  const resolved = normalizeResolvedFields(result.resolved || result.resolved_fields || result.fields || {});
  const fields = task.affected_fields || [];
  if (fields.some((field) => fieldHasConflict(result, field))) return "CONFLICT";
  if (!anyFieldPresent(resolved, fields)) return task.priority === "high" ? "REVIEW_REQUIRED" : "PROVISIONAL";
  if (confirmedByEvidence(result, fields)) return "CONFIRMED";
  if (hasAuthoritativeSource(result, fields)) return "SUPPORTED";
  if (["serial_observation", "grade_label_observation", "surface_color_observation"].includes(task.task_id)) {
    return "REVIEW_REQUIRED";
  }
  return "OBSERVED";
}

function taskStatus(result = {}, task = {}) {
  if (catalogTaskIds.has(task.task_id)) return catalogStatusForTask(result, task);
  if (task.task_id === "vector_retrieval_lazy") return vectorStatusForTask(result);
  if (ocrTaskIds.has(task.task_id)) return ocrStatusForTask(result, task);
  return observationStatusForTask(result, task);
}

function patchForTask(result = {}, task = {}) {
  const resolved = normalizeResolvedFields(result.resolved || result.resolved_fields || result.fields || {});
  const patch = {};
  for (const fieldName of task.affected_fields || []) {
    if (fieldName === "candidate_identity") continue;
    const value = fieldValue(resolved, fieldName);
    const evidence = evidenceField(result, fieldName);
    const state = fieldState(result, fieldName);
    if (!hasValue(value) && !evidence && !state) continue;
    patch[fieldName] = {
      value: hasValue(value) ? value : evidence?.value ?? state?.resolved_value ?? null,
      status: evidence?.status || state?.resolution_status || null,
      confidence: fieldConfidence(result, fieldName),
      source_summary: fieldSourceSummary(result, fieldName)
    };
  }
  return patch;
}

function taskLatency(task = {}, timing = {}) {
  if (ocrTaskIds.has(task.task_id)) {
    return Math.max(0, count(timing.paddle_ocr_ms) || count(timing.ocr_verification_ms) || count(timing.ocr_worker_ms));
  }
  if (task.task_id === "catalog_exact_code_lookup"
    || task.task_id === "catalog_year_product_subject_lookup"
    || task.task_id === "catalog_product_serial_denominator_lookup") {
    return Math.max(0, count(timing.catalog_cache_ms) + count(timing.catalog_retrieval_ms));
  }
  if (task.task_id === "vector_retrieval_lazy") {
    if (count(timing.vector_embedding_ms) === 0 && count(timing.vector_retrieval_ms) === 0) return 0;
    return Math.max(0, count(timing.vector_embedding_ms) + count(timing.vector_retrieval_ms));
  }
  if (task.task_id === "serial_observation" || task.task_id === "grade_label_observation") {
    return Math.max(0, count(timing.focused_reread_ms) || count(timing.provider_total_ms));
  }
  return Math.max(0, count(timing.provider_total_ms) || count(timing.recognition_preflight_ms) || count(timing.memory_lookup_ms));
}

function completedAt(task = {}, timing = {}) {
  const providerAt = count(timing.provider_total_ms) || count(timing.recognition_preflight_ms) || count(timing.memory_lookup_ms);
  if (catalogTaskIds.has(task.task_id)) return providerAt + taskLatency(task, timing);
  if (task.task_id === "vector_retrieval_lazy") return providerAt + count(timing.catalog_retrieval_ms) + count(timing.catalog_cache_ms) + taskLatency(task, timing);
  if (ocrTaskIds.has(task.task_id)) return providerAt + taskLatency(task, timing);
  return taskLatency(task, timing);
}

function sourceSummaryForTask(result = {}, task = {}) {
  const fields = task.affected_fields || [];
  const summaries = fields.flatMap((field) => fieldSourceSummary(result, field));
  if (ocrTaskIds.has(task.task_id)) {
    const explicit = ocrTaskEntry(result, task.task_id);
    return [{
      source_type: "OCR",
      provider: explicit?.provider || result.ocr_verification?.provider || "paddle_ocr",
      trigger_reason: explicit?.trigger_reason || ocrTriggerReason(result, task) || null,
      model_id: explicit?.model_id || result.ocr_verification?.model_id || null,
      model_revision: explicit?.model_revision || result.ocr_verification?.model_revision || null,
      latency_ms: explicit?.latency_ms ?? result.ocr_verification?.latency_ms ?? null,
      policy: "evidence_patch_only_resolver_gate_decides",
      observed_field_sources: summaries
    }];
  }
  if (summaries.length) return summaries;
  if (catalogTaskIds.has(task.task_id)) {
    const eligibility = catalogEligibility(result);
    return [{
      source_type: "CATALOG",
      raw_candidate_count: count(eligibility.raw_candidate_count),
      approved_candidate_count: count(eligibility.approved_candidate_count),
      prompt_candidate_count: count(eligibility.prompt_candidate_count)
    }];
  }
  if (task.task_id === "vector_retrieval_lazy") {
    const eligibility = vectorEligibility(result);
    return [{
      source_type: "VISUAL_VECTOR",
      raw_candidate_count: count(eligibility.raw_candidate_count),
      approved_candidate_count: count(eligibility.approved_candidate_count),
      prompt_candidate_count: count(eligibility.prompt_candidate_count),
      lazy_skip: result.vector_lazy_skip?.skipped === true || result.vector_lazy_skip === true
    }];
  }
  return [];
}

function taskFromDefinition(result = {}, timing = {}, task = {}) {
  const status = taskStatus(result, task);
  const latencyMs = taskLatency(task, timing);
  return {
    task_id: task.task_id,
    status,
    priority: task.priority,
    dependency_mode: task.dependency_mode,
    depends_on_any: task.depends_on_any || [],
    condition: task.condition || null,
    latency_ms: latencyMs,
    completed_at_ms: numberOrNull(completedAt(task, timing)),
    affected_fields: task.affected_fields || [],
    evidence_patch: patchForTask(result, task),
    source_summary: sourceSummaryForTask(result, task)
  };
}

function minCompletedAt(tasks = []) {
  const values = tasks
    .map((task) => numberOrNull(task.completed_at_ms))
    .filter((value, index) => {
      const task = tasks[index];
      return value !== null
        && !["LOADING", "NOT_APPLICABLE"].includes(taskStatusFromTask(task))
        && Object.keys(task.evidence_patch || {}).length > 0;
    });
  return values.length ? Math.min(...values) : null;
}

function taskStatusFromTask(task = {}) {
  return String(task.status || "");
}

function taskCompletedAtById(tasks = [], id = "") {
  const task = tasks.find((entry) => entry.task_id === id);
  if (!task || ["LOADING", "NOT_APPLICABLE"].includes(task.status)) return null;
  return numberOrNull(task.completed_at_ms);
}

function maxOfPresent(values = []) {
  const present = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return present.length === values.length ? Math.max(...present.map(Number)) : null;
}

function buildTaskTiming(tasks = [], timing = {}) {
  const firstField = minCompletedAt(tasks.filter((task) => !catalogTaskIds.has(task.task_id) && task.task_id !== "vector_retrieval_lazy"));
  const coreIdentity = maxOfPresent([
    taskCompletedAtById(tasks, "year_product_observation"),
    taskCompletedAtById(tasks, "subject_team_observation")
  ]);
  const rendererAt = count(timing.total_ms) > 0
    ? count(timing.total_ms)
    : Math.max(
      count(timing.provider_total_ms),
      count(timing.evidence_completion_ms),
      count(timing.resolver_ms),
      count(timing.renderer_ms)
    );
  const writerDraft = coreIdentity !== null
    ? Math.max(coreIdentity, count(timing.renderer_ms) || 0)
    : rendererAt || null;
  return {
    timing_estimation: "stage_timing_estimate_until_partial_streaming_is_enabled",
    time_to_first_field_ms: firstField,
    time_to_core_identity_ms: coreIdentity,
    time_to_writer_draft_ms: writerDraft,
    time_to_final_assisted_title_ms: count(timing.total_ms) || rendererAt || null,
    per_task_latency_ms: Object.fromEntries(tasks.map((task) => [task.task_id, task.latency_ms]))
  };
}

export function buildFieldTaskOrchestration(result = {}, {
  timing = result.timing || {}
} = {}) {
  const tasks = taskDefinitions.map((definition) => taskFromDefinition(result, timing, definition));
  const moduleTaskStatus = Object.fromEntries(tasks.map((task) => [task.task_id, task.status]));
  return {
    schema_version: "field-task-orchestrator-v1",
    mode: "internal_parallel_observability",
    resolver_authority: "Resolver/Gate remains the single source of truth; first completed field is provisional evidence only.",
    tasks,
    module_task_status: moduleTaskStatus,
    evidence_patches: tasks.map((task) => ({
      task_id: task.task_id,
      status: task.status,
      latency_ms: task.latency_ms,
      evidence_patch: task.evidence_patch,
      affected_fields: task.affected_fields,
      source_summary: task.source_summary
    })),
    timing: buildTaskTiming(tasks, timing)
  };
}

export function attachFieldTaskOrchestration(result = {}, {
  timing = result.timing || {}
} = {}) {
  const orchestration = buildFieldTaskOrchestration(result, { timing });
  const taskTiming = orchestration.timing || {};
  return {
    ...result,
    field_task_orchestration: orchestration,
    field_task_status: orchestration.tasks,
    module_task_status: orchestration.module_task_status,
    evidence_patches: orchestration.evidence_patches,
    time_to_first_field_ms: taskTiming.time_to_first_field_ms,
    time_to_core_identity_ms: taskTiming.time_to_core_identity_ms,
    time_to_writer_draft_ms: taskTiming.time_to_writer_draft_ms,
    time_to_final_assisted_title_ms: taskTiming.time_to_final_assisted_title_ms,
    timing: {
      ...(result.timing || timing || {}),
      time_to_first_field_ms: taskTiming.time_to_first_field_ms,
      time_to_core_identity_ms: taskTiming.time_to_core_identity_ms,
      time_to_writer_draft_ms: taskTiming.time_to_writer_draft_ms,
      time_to_final_assisted_title_ms: taskTiming.time_to_final_assisted_title_ms,
      per_task_latency_ms: taskTiming.per_task_latency_ms,
      field_task_timing_estimation: taskTiming.timing_estimation
    }
  };
}
