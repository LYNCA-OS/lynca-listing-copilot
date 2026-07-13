import { gradeAtomicCompleteness } from "../grade/grade-value.mjs";

export function gradeOcrRescueDecision({
  currentFields = {},
  latestOcrState = null
} = {}) {
  const atomic = gradeAtomicCompleteness(currentFields);
  const gradeJobsActive = Number(latestOcrState?.grade_label_active_count || 0) > 0;
  const incompleteGrade = atomic.incomplete_score_without_company
    || atomic.incomplete_company_without_score;
  return {
    needed: incompleteGrade && gradeJobsActive,
    incomplete_grade: incompleteGrade,
    incomplete_score_without_company: atomic.incomplete_score_without_company,
    incomplete_company_without_score: atomic.incomplete_company_without_score,
    grade_jobs_active: gradeJobsActive,
    grade_company: atomic.grade_company,
    card_grade: atomic.card_grade,
    auto_grade: atomic.auto_grade
  };
}

export function guardGradeFieldStates(fieldStates = [], guardApplied = false, guardReason = "score_without_company") {
  if (!guardApplied || !Array.isArray(fieldStates)) return fieldStates;
  return fieldStates.map((state) => {
    if (String(state?.field_name || state?.field || "").toLowerCase() !== "grade") return state;
    return {
      ...state,
      field_value: null,
      resolved_value: null,
      display_status: "REVIEW",
      confidence: Math.min(Number(state.confidence || 0), 0.49),
      provenance: {
        ...(state.provenance || {}),
        atomic_grade_guard: guardReason
      }
    };
  });
}
