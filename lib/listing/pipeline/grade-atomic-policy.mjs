import { gradeAtomicCompleteness } from "../grade/grade-value.mjs";

export function gradeOcrRescueDecision({
  currentFields = {},
  latestOcrState = null
} = {}) {
  const atomic = gradeAtomicCompleteness(currentFields);
  const gradeJobsActive = Number(latestOcrState?.grade_label_active_count || 0) > 0;
  return {
    needed: atomic.incomplete_score_without_company && gradeJobsActive,
    incomplete_grade: atomic.incomplete_score_without_company,
    grade_jobs_active: gradeJobsActive,
    card_grade: atomic.card_grade,
    auto_grade: atomic.auto_grade
  };
}

export function guardGradeFieldStates(fieldStates = [], guardApplied = false) {
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
        atomic_grade_guard: "score_without_company"
      }
    };
  });
}
