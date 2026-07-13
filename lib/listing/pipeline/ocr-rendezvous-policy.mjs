import { gradeAtomicCompleteness } from "../grade/grade-value.mjs";

const serialFieldNames = new Set([
  "print_run_number",
  "print_run_numerator",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "serial_denominator",
  "numerical_rarity"
]);

const gradeFieldNames = new Set([
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveDuration(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function unresolvedFieldNames(values = []) {
  return new Set((Array.isArray(values) ? values : [])
    .flatMap((value) => cleanText(value).toLowerCase().split(/[^a-z0-9_]+/))
    .filter(Boolean));
}

function unresolvedIncludesAny(unresolved, fieldNames) {
  return [...fieldNames].some((field) => unresolved.has(field));
}

function currentPrintRunValue(fields = {}) {
  return cleanText(
    fields.print_run_number
    || fields.numerical_rarity
    || fields.serial_number
  );
}

function printRunMentioned(fields = {}, unresolved = new Set()) {
  return Boolean(currentPrintRunValue(fields)) || unresolvedIncludesAny(unresolved, serialFieldNames);
}

function gradeMentioned(fields = {}, unresolved = new Set()) {
  const atomic = gradeAtomicCompleteness(fields);
  return atomic.has_company || atomic.has_score || unresolvedIncludesAny(unresolved, gradeFieldNames);
}

function patchValue(patch = {}) {
  return cleanText(
    patch.value
    ?? patch.normalized_value
    ?? patch.normalizedValue
  );
}

export function criticalOcrSignalFields(latestOcrState = null) {
  const patches = Array.isArray(latestOcrState?.evidence_patches)
    ? latestOcrState.evidence_patches
    : [];
  const aliases = new Map([
    ["grade", "card_grade"],
    ["grade_label", "card_grade"],
    ["print_run_numerator", "print_run_number"],
    ["print_run_denominator", "print_run_number"],
    ["serial_denominator", "serial_number"],
    ["numerical_rarity", "print_run_number"]
  ]);
  const acceptedFields = new Set([
    "print_run_number",
    "serial_number",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type"
  ]);
  const fields = {};
  const observedValues = new Map();

  for (const patch of patches) {
    const rawField = cleanText(patch?.field || patch?.evidence_field).toLowerCase();
    const field = aliases.get(rawField) || rawField;
    const value = patchValue(patch);
    if (!acceptedFields.has(field) || !value) continue;
    const comparable = value.toUpperCase();
    const seen = observedValues.get(field) || new Set();
    seen.add(comparable);
    observedValues.set(field, seen);
    if (!fields[field]) fields[field] = value;
  }

  const conflictingFields = [...observedValues.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([field]) => field);
  return {
    fields,
    patch_fields: Object.keys(fields),
    conflicting_fields: conflictingFields
  };
}

export function criticalOcrRendezvousDecision({
  currentFields = {},
  unresolved = [],
  latestOcrState = null,
  slabLikely = false,
  configuredWaitMs = 0,
  criticalWaitMs = 2_500
} = {}) {
  const unresolvedSet = unresolvedFieldNames(unresolved);
  const ocrSignals = criticalOcrSignalFields(latestOcrState);
  const decisionFields = {
    ...ocrSignals.fields,
    ...currentFields
  };
  const stateKnown = Boolean(latestOcrState && typeof latestOcrState === "object");
  const stateConfigured = latestOcrState?.configured !== false;
  const serialActiveCount = Number(latestOcrState?.serial_active_count || 0);
  const gradeActiveCount = Number(latestOcrState?.grade_label_active_count || 0);
  const serialWorkPending = stateConfigured && (!stateKnown || serialActiveCount > 0);
  const gradeWorkPending = stateConfigured && (!stateKnown || gradeActiveCount > 0);
  const atomicGrade = gradeAtomicCompleteness(decisionFields);
  const gradeIncomplete = atomicGrade.incomplete_score_without_company
    || atomicGrade.incomplete_company_without_score;
  const gradeCompletelyMissing = !atomicGrade.has_company && !atomicGrade.has_score;
  const gradeUnresolved = unresolvedIncludesAny(unresolvedSet, gradeFieldNames);
  const gradeSignalConflict = ocrSignals.conflicting_fields.some((field) => gradeFieldNames.has(field));
  const serialSignalConflict = ocrSignals.conflicting_fields.some((field) => serialFieldNames.has(field));

  const targetFields = [];
  const reasons = [];

  if (serialWorkPending && (printRunMentioned(decisionFields, unresolvedSet) || serialSignalConflict)) {
    targetFields.push("serial_number");
    reasons.push(serialSignalConflict
      ? "ocr_print_run_candidates_conflict"
      : currentPrintRunValue(decisionFields)
      ? "current_print_run_requires_hard_text_verification"
      : "provider_left_print_run_unresolved");
  }

  if (gradeWorkPending
    && (gradeMentioned(decisionFields, unresolvedSet) || (slabLikely && gradeCompletelyMissing))
    && (gradeIncomplete || gradeUnresolved || gradeSignalConflict || (slabLikely && gradeCompletelyMissing))) {
    targetFields.push("grade");
    reasons.push(
      gradeSignalConflict
        ? "ocr_grade_candidates_conflict"
        : atomicGrade.incomplete_score_without_company
        ? "grade_score_missing_company"
        : atomicGrade.incomplete_company_without_score
          ? "grade_company_missing_score"
          : slabLikely && gradeCompletelyMissing
            ? "slab_capture_grade_completely_missing"
          : "provider_left_grade_unresolved"
    );
  }

  const baseBudget = positiveDuration(configuredWaitMs, 0);
  const targetedBudget = targetFields.length ? positiveDuration(criticalWaitMs, 2_500) : 0;
  const waitBudgetMs = Math.max(baseBudget, targetedBudget);

  return {
    should_wait: waitBudgetMs > 0,
    wait_budget_ms: waitBudgetMs,
    target_fields: targetFields,
    reasons,
    state_known: stateKnown,
    state_configured: stateConfigured,
    serial_active_count: serialActiveCount,
    grade_label_active_count: gradeActiveCount,
    grade_incomplete: gradeIncomplete,
    grade_completely_missing: gradeCompletelyMissing,
    grade_unresolved: gradeUnresolved,
    slab_likely: slabLikely === true,
    ocr_signal_fields: ocrSignals.patch_fields,
    ocr_signal_conflicting_fields: ocrSignals.conflicting_fields,
    base_wait_budget_ms: baseBudget,
    targeted_wait_budget_ms: targetedBudget
  };
}
