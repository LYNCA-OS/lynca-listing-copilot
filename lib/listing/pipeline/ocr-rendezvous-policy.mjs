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

export function criticalOcrRendezvousDecision({
  currentFields = {},
  unresolved = [],
  latestOcrState = null,
  configuredWaitMs = 0,
  criticalWaitMs = 2_500
} = {}) {
  const unresolvedSet = unresolvedFieldNames(unresolved);
  const stateKnown = Boolean(latestOcrState && typeof latestOcrState === "object");
  const stateConfigured = latestOcrState?.configured !== false;
  const serialActiveCount = Number(latestOcrState?.serial_active_count || 0);
  const gradeActiveCount = Number(latestOcrState?.grade_label_active_count || 0);
  const serialWorkPending = stateConfigured && (!stateKnown || serialActiveCount > 0);
  const gradeWorkPending = stateConfigured && (!stateKnown || gradeActiveCount > 0);
  const atomicGrade = gradeAtomicCompleteness(currentFields);
  const gradeIncomplete = atomicGrade.incomplete_score_without_company
    || atomicGrade.incomplete_company_without_score;
  const gradeUnresolved = unresolvedIncludesAny(unresolvedSet, gradeFieldNames);

  const targetFields = [];
  const reasons = [];

  if (serialWorkPending && printRunMentioned(currentFields, unresolvedSet)) {
    targetFields.push("serial_number");
    reasons.push(currentPrintRunValue(currentFields)
      ? "current_print_run_requires_hard_text_verification"
      : "provider_left_print_run_unresolved");
  }

  if (gradeWorkPending && gradeMentioned(currentFields, unresolvedSet) && (gradeIncomplete || gradeUnresolved)) {
    targetFields.push("grade");
    reasons.push(
      atomicGrade.incomplete_score_without_company
        ? "grade_score_missing_company"
        : atomicGrade.incomplete_company_without_score
          ? "grade_company_missing_score"
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
    grade_unresolved: gradeUnresolved,
    base_wait_budget_ms: baseBudget,
    targeted_wait_budget_ms: targetedBudget
  };
}
