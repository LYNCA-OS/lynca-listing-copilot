import { gradeAtomicCompleteness } from "../grade/grade-value.mjs";

export function gradeOcrRescueDecision({
  currentFields = {},
  latestOcrState = null,
  slabLikely = false
} = {}) {
  const patchFields = {};
  for (const patch of Array.isArray(latestOcrState?.evidence_patches) ? latestOcrState.evidence_patches : []) {
    const field = String(patch?.field || "").trim().toLowerCase();
    if (!["grade_company", "card_grade", "grade", "auto_grade", "grade_type"].includes(field)) continue;
    const value = patch?.value ?? patch?.normalized_value;
    if (value === null || value === undefined || String(value).trim() === "") continue;
    if (!Object.hasOwn(patchFields, field)) patchFields[field] = value;
  }
  const atomic = gradeAtomicCompleteness({ ...patchFields, ...currentFields });
  const gradeJobsActive = Number(latestOcrState?.grade_label_active_count || 0) > 0;
  const incompleteGrade = atomic.incomplete_score_without_company
    || atomic.incomplete_company_without_score;
  const gradeCompletelyMissing = atomic.has_any_grade_value !== true;
  return {
    needed: gradeJobsActive && (incompleteGrade || (slabLikely === true && gradeCompletelyMissing)),
    incomplete_grade: incompleteGrade,
    grade_completely_missing: gradeCompletelyMissing,
    slab_likely: slabLikely === true,
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
