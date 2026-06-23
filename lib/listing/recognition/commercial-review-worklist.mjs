export const commercialReviewWorklistSchemaVersion = "commercial-review-worklist-v1";

const optionalReviewTargetFields = Object.freeze([
  "serial_number",
  "collector_number",
  "checklist_code",
  "parallel",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function reviewTargetValuePresent(field, value) {
  if (field === "grade_type") return valuePresent(value) && value !== "UNKNOWN";
  return valuePresent(value);
}

function round6(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function hasImageRole(task, pattern) {
  return (Array.isArray(task.images) ? task.images : []).some((image) => pattern.test(normalizeText(image.role)));
}

function compactImages(images = []) {
  return (Array.isArray(images) ? images : []).map((image) => ({
    image_id: image.image_id || null,
    role: image.role || null,
    bucket: image.bucket || null,
    object_path: image.object_path || null,
    capture_angle: image.capture_angle || null,
    has_glare: image.has_glare === true
  }));
}

function suggestedFieldEntries(fields = {}) {
  return Object.entries(fields).filter(([field, value]) => {
    if (field === "attributes") return Array.isArray(value) && value.length > 0;
    if (field === "grade_type") return value && value !== "UNKNOWN";
    return valuePresent(value);
  });
}

function suggestedFlags(fields = {}) {
  return [
    fields.rc ? "RC" : null,
    fields.first_bowman ? "1st Bowman" : null,
    fields.auto ? "Auto" : null,
    fields.patch ? "Patch" : null,
    fields.relic ? "Relic" : null,
    fields.ssp ? "SSP" : null,
    fields.case_hit ? "Case Hit" : null,
    fields.one_of_one ? "1/1" : null
  ].filter(Boolean);
}

function suggestedGrade(fields = {}) {
  const company = normalizeText(fields.grade_company).toUpperCase();
  if (!company) return null;
  if (fields.grade_type === "CARD_AND_AUTO" && fields.card_grade && fields.auto_grade) {
    return `${company} ${fields.card_grade}/${fields.auto_grade}`;
  }
  if (fields.grade_type === "AUTO_ONLY" && fields.auto_grade) {
    return `${company} AUTO ${fields.auto_grade}`;
  }
  if (fields.card_grade) return `${company} ${fields.card_grade}`;
  return company;
}

function titleChanged(task = {}) {
  const sourceTitles = task.source_titles && typeof task.source_titles === "object" ? task.source_titles : {};
  return normalizeComparable(sourceTitles.generated_title || task.generated_title_hint)
    !== normalizeComparable(sourceTitles.corrected_title || task.corrected_title_hint);
}

function prioritySignals(task = {}) {
  const suggested = task.suggested_fields || {};
  const hasFront = hasImageRole(task, /front/i);
  const hasBack = hasImageRole(task, /back/i);
  const signals = [];

  if (suggested.one_of_one || suggested.serial_number === "1/1") signals.push("one_of_one");
  if (suggested.serial_number) signals.push("serial");
  if (suggested.grade_company || suggested.card_grade || suggested.auto_grade) signals.push("grade");
  if (suggested.auto) signals.push("auto");
  if (suggested.parallel) signals.push("parallel");
  if (suggested.rc || suggested.first_bowman) signals.push("rookie_or_prospect");
  if (suggested.patch || suggested.relic) signals.push("patch_or_relic");
  if (suggested.ssp || suggested.case_hit) signals.push("scarce_insert");
  if (!suggested.product) signals.push("missing_product_hint");
  if (!hasBack) signals.push("front_only");
  if (!hasFront) signals.push("missing_front");
  if (titleChanged(task)) signals.push("title_delta");

  return signals;
}

function priorityScore(task = {}) {
  const signals = new Set(prioritySignals(task));
  let score = 0.1;
  if (signals.has("one_of_one")) score += 0.25;
  if (signals.has("serial")) score += 0.18;
  if (signals.has("grade")) score += 0.12;
  if (signals.has("auto")) score += 0.08;
  if (signals.has("parallel")) score += 0.08;
  if (signals.has("rookie_or_prospect")) score += 0.04;
  if (signals.has("patch_or_relic")) score += 0.08;
  if (signals.has("scarce_insert")) score += 0.16;
  if (signals.has("missing_product_hint")) score += 0.1;
  if (signals.has("front_only") || signals.has("missing_front")) score += 0.1;
  if (signals.has("title_delta")) score += 0.07;
  if (task.suggested_fields?.year && task.suggested_fields?.product) score += 0.03;
  return round6(Math.min(1, score));
}

function priorityBand(score) {
  if (score >= 0.65) return "P0";
  if (score >= 0.45) return "P1";
  if (score >= 0.25) return "P2";
  return "P3";
}

function reviewEffort(task = {}) {
  const signals = new Set(prioritySignals(task));
  if (signals.has("missing_product_hint") || signals.has("front_only") || signals.has("missing_front")) return "HIGH";
  if (signals.has("serial") || signals.has("grade") || signals.has("auto") || signals.has("parallel") || signals.has("patch_or_relic") || signals.has("scarce_insert")) return "MEDIUM";
  return "LOW";
}

function missingRequiredFields(task = {}) {
  const required = normalizeArray(task.required_critical_fields || task.critical_fields);
  const groundTruth = task.reviewed_ground_truth || {};
  return required.filter((field) => !valuePresent(groundTruth[field]));
}

function reviewTargets(task = {}) {
  const required = normalizeArray(task.required_critical_fields || task.critical_fields);
  const suggested = task.suggested_fields || {};
  return [...new Set([
    ...required,
    ...optionalReviewTargetFields.filter((field) => reviewTargetValuePresent(field, suggested[field])),
    suggested.rc ? "rc" : null,
    suggested.first_bowman ? "first_bowman" : null,
    suggested.auto ? "auto" : null,
    suggested.patch ? "patch" : null,
    suggested.relic ? "relic" : null,
    suggested.ssp ? "ssp" : null,
    suggested.case_hit ? "case_hit" : null,
    suggested.one_of_one ? "one_of_one" : null
  ].filter(Boolean))];
}

function nextActions(task = {}) {
  const missing = new Set(missingRequiredFields(task));
  const targets = new Set(reviewTargets(task));
  const actions = [];

  if (missing.has("players")) actions.push("verify subject/player names from card front, slab label, registry, or official checklist");
  if (missing.has("year") || missing.has("product")) actions.push("verify year and product from card back, slab label, registry, or official checklist");
  if (targets.has("serial_number")) actions.push("verify stamped serial number from card image");
  if (targets.has("parallel")) actions.push("verify color/parallel from image and checklist taxonomy");
  if (targets.has("grade_company") || targets.has("card_grade") || targets.has("auto_grade")) actions.push("verify grading details from slab label only");
  if (!actions.length) actions.push("fill reviewed_ground_truth with field-level sources");
  return actions;
}

function countBy(items = [], field) {
  return items.reduce((counts, item) => {
    const value = item[field] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function suggestedFieldCounts(items = []) {
  return items.reduce((counts, item) => {
    suggestedFieldEntries(item.suggested_fields || {}).forEach(([field]) => {
      counts[field] = (counts[field] || 0) + 1;
    });
    return counts;
  }, {});
}

function worklistItem(task = {}, index = 0) {
  const suggested = task.suggested_fields || {};
  const score = priorityScore(task);
  const flags = suggestedFlags(suggested);
  return {
    row_number: index + 1,
    source_task_index: index,
    asset_id: task.asset_id || null,
    source_feedback_id: task.source_feedback_id || null,
    physical_card_id: task.physical_card_id || null,
    capture_session_id: task.capture_session_id || null,
    category: task.category || "sports_card",
    priority_score: score,
    priority_band: priorityBand(score),
    review_effort: reviewEffort(task),
    priority_signals: prioritySignals(task),
    review_status: task.review_status || "NEEDS_REVIEW",
    required_critical_fields: normalizeArray(task.required_critical_fields || task.critical_fields),
    missing_required_fields: missingRequiredFields(task),
    review_targets: reviewTargets(task),
    operator_next_actions: nextActions(task),
    corrected_title_hint: task.corrected_title_hint || task.source_titles?.corrected_title || null,
    generated_title_hint: task.generated_title_hint || task.source_titles?.generated_title || null,
    corrected_title_used_as_ground_truth: task.corrected_title_used_as_ground_truth === true,
    suggested_fields: suggested,
    suggested_flags: flags,
    suggested_grade: suggestedGrade(suggested),
    suggestion_source_type: task.suggestion_policy?.source_type || "CORRECTED_TITLE_PARSE_HINT",
    suggestions_are_ground_truth: task.suggestion_policy?.can_be_used_as_ground_truth === true,
    suggestion_requires_operator_evidence: task.suggestion_policy?.requires_operator_evidence !== false,
    image_count: Array.isArray(task.images) ? task.images.length : 0,
    has_front_image: hasImageRole(task, /front/i),
    has_back_image: hasImageRole(task, /back/i),
    images: compactImages(task.images),
    review_notes: normalizeText(task.review_notes) || null
  };
}

export function createCommercialReviewWorklist(reviewPacket = {}, {
  now = () => new Date(),
  limit = 0
} = {}) {
  const sourceTasks = Array.isArray(reviewPacket.tasks) ? reviewPacket.tasks : [];
  const allItems = sourceTasks
    .map((task, index) => worklistItem(task, index))
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return String(a.asset_id || "").localeCompare(String(b.asset_id || ""));
    })
    .map((item, index) => ({
      ...item,
      row_number: index + 1
    }));
  const items = limit > 0 ? allItems.slice(0, limit) : allItems;
  const badPolicyCount = allItems.filter((item) => item.corrected_title_used_as_ground_truth || item.suggestions_are_ground_truth).length;

  return {
    schema_version: commercialReviewWorklistSchemaVersion,
    generated_at: now().toISOString(),
    source: {
      provider: "commercial_review_packet",
      packet_schema_version: reviewPacket.schema_version || null,
      packet_generated_at: reviewPacket.generated_at || null,
      packet_task_count: sourceTasks.length
    },
    summary: {
      task_count: items.length,
      source_task_count: sourceTasks.length,
      limit_applied: limit > 0 ? limit : null,
      priority_band_counts: countBy(items, "priority_band"),
      review_effort_counts: countBy(items, "review_effort"),
      suggested_field_counts: suggestedFieldCounts(items),
      corrected_title_used_as_ground_truth_count: items.filter((item) => item.corrected_title_used_as_ground_truth).length,
      suggestions_are_ground_truth_count: items.filter((item) => item.suggestions_are_ground_truth).length,
      bad_policy_task_count: badPolicyCount,
      required_critical_fields: reviewPacket.summary?.required_critical_fields || [],
      worklist_uses_ground_truth: false
    },
    items
  };
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join("; ") : normalizeText(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function commercialReviewWorklistToCsv(worklist = {}) {
  const columns = [
    ["row_number", (item) => item.row_number],
    ["priority_band", (item) => item.priority_band],
    ["priority_score", (item) => item.priority_score],
    ["review_effort", (item) => item.review_effort],
    ["asset_id", (item) => item.asset_id],
    ["source_feedback_id", (item) => item.source_feedback_id],
    ["capture_session_id", (item) => item.capture_session_id],
    ["has_front_image", (item) => item.has_front_image],
    ["has_back_image", (item) => item.has_back_image],
    ["corrected_title_hint", (item) => item.corrected_title_hint],
    ["suggested_year", (item) => item.suggested_fields?.year],
    ["suggested_manufacturer", (item) => item.suggested_fields?.manufacturer],
    ["suggested_product", (item) => item.suggested_fields?.product],
    ["suggested_serial_number", (item) => item.suggested_fields?.serial_number],
    ["suggested_parallel", (item) => item.suggested_fields?.parallel],
    ["suggested_grade", (item) => item.suggested_grade],
    ["suggested_flags", (item) => item.suggested_flags],
    ["missing_required_fields", (item) => item.missing_required_fields],
    ["review_targets", (item) => item.review_targets],
    ["operator_next_actions", (item) => item.operator_next_actions]
  ];
  const rows = [
    columns.map(([name]) => csvValue(name)).join(","),
    ...(Array.isArray(worklist.items) ? worklist.items : []).map((item) => {
      return columns.map(([, read]) => csvValue(read(item))).join(",");
    })
  ];
  return `${rows.join("\n")}\n`;
}
