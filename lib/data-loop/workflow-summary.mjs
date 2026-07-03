import { workflowActionTools } from "./workflow-action-plan.mjs";
import { workflowSidecarStatuses } from "./workflow-events.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && item !== "") : [];
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function actionCount(actionPlan = {}) {
  return Array.isArray(actionPlan.actions) ? actionPlan.actions.length : 0;
}

function sidecarStatus(sidecars = {}, key = "") {
  return cleanText(sidecars[key]?.status || workflowSidecarStatuses.NOT_TRIGGERED).toUpperCase();
}

function sidecarActive(sidecars = {}, key = "") {
  return ![
    workflowSidecarStatuses.NOT_TRIGGERED,
    workflowSidecarStatuses.NOT_CONFIGURED
  ].includes(sidecarStatus(sidecars, key));
}

function sidecarFinished(sidecars = {}, key = "") {
  return [
    workflowSidecarStatuses.COMPLETED,
    workflowSidecarStatuses.CREATED,
    workflowSidecarStatuses.QUEUED
  ].includes(sidecarStatus(sidecars, key));
}

function fieldLabels(fields = []) {
  const labels = {
    year: "Year",
    manufacturer: "Manufacturer",
    brand: "Brand",
    product: "Product",
    set: "Set",
    players: "Subject",
    character: "Subject",
    card_name: "Card Name",
    official_card_type: "Card Type",
    insert: "Card Name",
    variation: "Variant",
    surface_color: "Color",
    parallel_exact: "Exact Parallel",
    serial_number: "Serial",
    numerical_rarity: "Numerical Rarity",
    collector_number: "Card Number",
    checklist_code: "Checklist Code",
    grade_company: "Grade",
    card_grade: "Grade",
    auto_grade: "Auto Grade",
    rc: "RC",
    auto: "Auto",
    patch: "Patch"
  };
  return unique(fields).map((field) => labels[field] || field);
}

function writerRequiredFields(result = {}, event = {}) {
  return unique([
    ...(event.review_required_fields || []),
    ...(result.publication_gate?.writer_required_fields || []),
    ...(result.unresolved || []),
    ...(result.unresolved_fields || [])
  ]);
}

function moduleReviewFields(result = {}) {
  const modules = result.modules || {};
  return unique(Object.values(modules).flatMap((module) => {
    if (!module || module.requires_review !== true) return [];
    return [
      ...(module.fields || []),
      ...(module.tokens || []).flatMap((token) => token.fields || [])
    ];
  }));
}

function eligibilityCounts(eligibility = {}) {
  return {
    raw_candidate_count: numberValue(eligibility.raw_candidate_count),
    approved_candidate_count: numberValue(eligibility.approved_candidate_count),
    prompt_candidate_count: numberValue(eligibility.prompt_candidate_count),
    field_support_count: numberValue(eligibility.field_support_count),
    conflict_blocked_count: numberValue(eligibility.conflict_blocked_count || eligibility.blocked_candidate_count),
    prompt_candidate_ids: compactArray(eligibility.prompt_candidate_ids).map(cleanText).filter(Boolean)
  };
}

function openSetCatalogCounts(result = {}) {
  const openSet = result.open_set_readiness || {};
  const eligibility = openSet.catalog?.eligibility || result.catalog_assist_eligibility || {};
  const counts = eligibilityCounts(eligibility);
  if (!counts.raw_candidate_count && openSet.raw_candidate_count) {
    counts.raw_candidate_count = numberValue(openSet.catalog?.eligibility?.raw_candidate_count);
  }
  return counts;
}

function openSetVectorCounts(result = {}) {
  const openSet = result.open_set_readiness || {};
  const eligibility = openSet.vector?.eligibility || result.vector_assist_eligibility || {};
  return eligibilityCounts(eligibility);
}

function capabilityState({
  enabled = true,
  promptCount = 0,
  fieldSupportCount = 0,
  rawCount = 0,
  conflictCount = 0,
  unavailable = false
} = {}) {
  if (!enabled) return "OFF";
  if (promptCount > 0) return "IDENTITY_ASSIST";
  if (fieldSupportCount > 0) return "FIELD_SUPPORT";
  if (conflictCount > 0) return "FAIL_CLOSED";
  if (rawCount > 0) return "SHADOW_ONLY";
  if (unavailable) return "UNAVAILABLE";
  return "NO_MATCH";
}

function capabilityWriterText(kind, state, counts = {}) {
  if (kind === "catalog") {
    if (state === "IDENTITY_ASSIST") return `目录候选已进入识别：${counts.prompt_candidate_count} 个`;
    if (state === "FIELD_SUPPORT") return `目录用于字段支持：${counts.field_support_count} 条`;
    if (state === "FAIL_CLOSED") return `目录候选有冲突，已挡住：${counts.conflict_blocked_count} 个`;
    if (state === "SHADOW_ONLY") return `目录只做后台参考：${counts.raw_candidate_count} 个`;
    if (state === "UNAVAILABLE") return "目录服务不可用，本卡仍可人工编辑";
    if (state === "OFF") return "目录未启用";
    return "目录未命中";
  }
  if (kind === "vector") {
    if (state === "IDENTITY_ASSIST") return `视觉相似参考已进入识别：${counts.prompt_candidate_count} 个`;
    if (state === "FIELD_SUPPORT") return `视觉相似参考只支持字段：${counts.field_support_count} 条`;
    if (state === "FAIL_CLOSED") return `视觉相似参考有冲突，已挡住：${counts.conflict_blocked_count} 个`;
    if (state === "SHADOW_ONLY") return `视觉相似参考只做后台参考：${counts.raw_candidate_count} 个`;
    if (state === "UNAVAILABLE") return "视觉相似检索不可用，本卡仍可人工编辑";
    if (state === "OFF") return "视觉相似检索未启用";
    return "视觉相似检索未命中";
  }
  return "";
}

function catalogCapability(result = {}, event = {}) {
  const openSet = result.open_set_readiness || {};
  const counts = openSetCatalogCounts(result);
  if (!counts.raw_candidate_count && Array.isArray(event.catalog_candidates)) {
    counts.raw_candidate_count = event.catalog_candidates.length;
  }
  if (!counts.conflict_blocked_count && Array.isArray(event.catalog_candidates)) {
    counts.conflict_blocked_count = event.catalog_candidates.filter((candidate) => compactArray(candidate.conflicting_fields).length > 0).length;
  }
  const state = capabilityState({
    enabled: openSet.assist_enabled !== false,
    promptCount: counts.prompt_candidate_count,
    fieldSupportCount: counts.field_support_count || numberValue(openSet.catalog_field_support_count),
    rawCount: counts.raw_candidate_count,
    conflictCount: counts.conflict_blocked_count,
    unavailable: /UNAVAILABLE|TIMEOUT|ERROR/i.test(`${openSet.catalog?.status || ""} ${openSet.catalog?.status_code || ""}`)
  });
  return {
    key: "catalog",
    label: "目录支持",
    state,
    writer_text: capabilityWriterText("catalog", state, counts),
    ...counts
  };
}

function vectorCapability(result = {}, event = {}) {
  const openSet = result.open_set_readiness || {};
  const counts = openSetVectorCounts(result);
  if (!counts.raw_candidate_count && Array.isArray(event.vector_candidates)) {
    counts.raw_candidate_count = event.vector_candidates.length;
  }
  if (!counts.conflict_blocked_count && Array.isArray(event.vector_candidates)) {
    counts.conflict_blocked_count = event.vector_candidates.filter((candidate) => compactArray(candidate.conflicting_fields).length > 0).length;
  }
  const state = capabilityState({
    enabled: openSet.assist_enabled !== false,
    promptCount: counts.prompt_candidate_count,
    fieldSupportCount: counts.field_support_count || numberValue(openSet.vector_field_support_count),
    rawCount: counts.raw_candidate_count,
    conflictCount: counts.conflict_blocked_count,
    unavailable: /UNAVAILABLE|TIMEOUT|ERROR/i.test(`${openSet.vector?.status || ""} ${openSet.vector?.status_code || ""}`)
  });
  return {
    key: "vector",
    label: "相似参考",
    state,
    writer_text: capabilityWriterText("vector", state, counts),
    ...counts
  };
}

function ocrCapability(sidecars = {}) {
  const ocr = sidecars.paddle_ocr || {};
  const status = sidecarStatus(sidecars, "paddle_ocr");
  let state = "NOT_USED";
  if (status === workflowSidecarStatuses.COMPLETED) state = numberValue(ocr.evidence_patch_count) > 0 ? "EVIDENCE_ATTACHED" : "COMPLETED_NO_PATCH";
  else if (status === workflowSidecarStatuses.QUEUED || status === workflowSidecarStatuses.CREATED) state = "QUEUED";
  else if (status === workflowSidecarStatuses.FAILED) state = "FAILED_NON_BLOCKING";
  else if (status === workflowSidecarStatuses.NOT_CONFIGURED && numberValue(ocr.task_count) > 0) state = "NOT_CONFIGURED";

  const writerText = {
    EVIDENCE_ATTACHED: `局部 OCR 已补证据：${numberValue(ocr.evidence_patch_count)} 条`,
    COMPLETED_NO_PATCH: "局部 OCR 已完成，但没有可用补充证据",
    QUEUED: `局部 OCR 已排队：${numberValue(ocr.task_count)} 个任务`,
    FAILED_NON_BLOCKING: "局部 OCR 失败，不阻塞标题编辑",
    NOT_CONFIGURED: "局部 OCR 需要的 worker 未配置",
    NOT_USED: "本卡未触发局部 OCR"
  }[state];

  return {
    key: "ocr",
    label: "局部 OCR",
    state,
    writer_text: writerText,
    status,
    task_count: numberValue(ocr.task_count),
    evidence_patch_count: numberValue(ocr.evidence_patch_count),
    crop_types: compactArray(ocr.crop_types).map(cleanText).filter(Boolean)
  };
}

function learningCapability(sidecars = {}, actionPlan = {}) {
  const statuses = Object.fromEntries(workflowActionTools.map((tool) => [tool, sidecarStatus(sidecars, tool)]));
  const activeTools = workflowActionTools.filter((tool) => sidecarActive(sidecars, tool));
  const createdTools = workflowActionTools.filter((tool) => sidecarFinished(sidecars, tool));
  let state = "TRACE_ONLY";
  if (createdTools.length) state = "QUEUED_OR_CREATED";
  if (createdTools.some((tool) => sidecarStatus(sidecars, tool) === workflowSidecarStatuses.COMPLETED)) state = "COMPLETED_OR_SYNCED";

  return {
    key: "data_loop",
    label: "反馈学习准备",
    state,
    writer_text: activeTools.length
      ? `后台已连接 ${activeTools.length} 个学习/复核通道`
      : "后台只记录安全追踪，不写入训练库",
    action_count: actionCount(actionPlan),
    active_tools: activeTools,
    statuses
  };
}

function workflowStatus({ failed, writerFields, reviewFields, gate = {} }) {
  if (failed) return "BLOCKED";
  if (gate.workflow_route === "LOW_TOUCH_REVIEW" || gate.model_quick_review_recommended === true || gate.writer_quick_approval_ready === true) {
    return "LOW_TOUCH_REVIEW";
  }
  if (writerFields.length || reviewFields.length) return "FIELD_REVIEW";
  return "READY_TO_EDIT";
}

function nextBestAction(status, fields = []) {
  if (status === "BLOCKED") return "RETRY_OR_MANUAL_EDIT";
  if (status === "LOW_TOUCH_REVIEW") return "WRITER_QUICK_CHECK";
  if (fields.length) return "CONFIRM_HIGHLIGHTED_MODULES";
  return "SAVE_REVIEW";
}

function writerActionText(status, fields = []) {
  if (status === "BLOCKED") return "识别失败：可以重试，也可以直接人工编辑空草稿。";
  if (status === "LOW_TOUCH_REVIEW") return "模型认为低风险：写手快速看一遍，同意后保存审核记录。";
  if (fields.length) return `请优先确认黄色模块：${fieldLabels(fields).slice(0, 6).join(", ")}。`;
  return "草稿已生成：检查标题顺序和模块后保存。";
}

export function buildWorkflowSummary({
  result = {},
  event = {},
  actionPlan = {},
  sidecars = {}
} = {}) {
  const failed = cleanText(result.confidence).toUpperCase() === "FAILED"
    || Boolean(result.provider_error_code || result.provider_error_type);
  const gate = result.publication_gate || {};
  const writerFields = writerRequiredFields(result, event);
  const reviewFields = unique([...writerFields, ...moduleReviewFields(result)]);
  const status = workflowStatus({ failed, writerFields, reviewFields, gate });
  const catalog = catalogCapability(result, event);
  const vector = vectorCapability(result, event);
  const ocr = ocrCapability(sidecars);
  const dataLoop = learningCapability(sidecars, actionPlan);
  const readyToEdit = !failed && Boolean(result.final_title || result.rendered_title || result.title || result.modules);

  return {
    schema_version: "listing-workflow-summary-v1",
    status,
    ready_to_edit: readyToEdit,
    blocking: status === "BLOCKED",
    writer_action: writerActionText(status, reviewFields),
    next_best_action: nextBestAction(status, reviewFields),
    writer_required_fields: writerFields,
    highlighted_fields: reviewFields,
    compact_steps: [
      {
        key: "vision",
        label: "图片识别",
        state: failed ? "FAILED" : "DONE",
        writer_text: failed ? "主识别失败" : "主识别已生成可编辑草稿"
      },
      catalog,
      vector,
      ocr,
      dataLoop
    ],
    capability_summary: {
      catalog,
      vector,
      ocr,
      data_loop: dataLoop
    },
    ui: {
      hide_raw_candidate_details: true,
      show_module_highlights: reviewFields.length > 0,
      show_catalog_gap_hint: result.open_set_readiness?.catalog_gap_queue_candidate === true
    }
  };
}
