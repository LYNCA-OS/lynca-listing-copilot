import { completionResolutionStates } from "./completion-state.mjs";

export const convergenceLoopName = "detect_conflict_retrieve_reevaluate_converge";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function stateSummary(state = {}) {
  return {
    resolution_state: state.resolution_state || null,
    missing_fields: state.missing_fields || [],
    weak_fields: state.weak_fields || [],
    conflicting_fields: state.conflicting_fields || [],
    next_best_action: state.next_best_action || null
  };
}

function openFields(state = {}) {
  return unique([
    ...(state.missing_fields || []),
    ...(state.weak_fields || []),
    ...(state.conflicting_fields || [])
  ]);
}

function fieldsResolved(before = {}, after = {}, key) {
  const beforeFields = new Set(before?.[key] || []);
  const afterFields = new Set(after?.[key] || []);
  return [...beforeFields].filter((field) => !afterFields.has(field));
}

function fieldsCreated(before = {}, after = {}, key) {
  const beforeFields = new Set(before?.[key] || []);
  const afterFields = new Set(after?.[key] || []);
  return [...afterFields].filter((field) => !beforeFields.has(field));
}

function evidenceActionKind(action) {
  const value = String(action || "");
  if (value.startsWith("SEARCH_") || value === "VERIFY_CANDIDATE") return "retrieve";
  if (value.includes("READ") || value.includes("CROP") || value.includes("AGNES")) return "reread";
  if (value.includes("RESCAN")) return "rescan";
  if (value.includes("MANUAL")) return "manual";
  return action ? "other" : "none";
}

export function createConvergenceEvent({
  action = null,
  before = {},
  after = {},
  status = null,
  informationGain = 0,
  retrievalCandidateCount = 0,
  focusedFields = []
} = {}) {
  const resolvedConflicts = fieldsResolved(before, after, "conflicting_fields");
  const newConflicts = fieldsCreated(before, after, "conflicting_fields");
  const resolvedMissingFields = fieldsResolved(before, after, "missing_fields");
  const resolvedWeakFields = fieldsResolved(before, after, "weak_fields");
  const afterOpenFields = openFields(after);
  const actionKind = evidenceActionKind(action);
  const converged = after?.resolution_state === completionResolutionStates.EVIDENCE_CLOSED;

  return {
    loop: convergenceLoopName,
    action,
    action_kind: actionKind,
    before: stateSummary(before),
    after: stateSummary(after),
    resolved_conflicts: resolvedConflicts,
    new_conflicts: newConflicts,
    resolved_missing_fields: resolvedMissingFields,
    resolved_weak_fields: resolvedWeakFields,
    still_open_fields: afterOpenFields,
    converged,
    phases: [
      {
        phase: "detect_conflict",
        conflict_fields: before?.conflicting_fields || [],
        missing_fields: before?.missing_fields || [],
        weak_fields: before?.weak_fields || []
      },
      {
        phase: "retrieve_or_reread",
        action,
        action_kind: actionKind,
        status,
        focused_fields: focusedFields,
        retrieval_candidate_count: retrievalCandidateCount,
        information_gain: Number(informationGain || 0)
      },
      {
        phase: "re_evaluate",
        resolved_conflicts: resolvedConflicts,
        new_conflicts: newConflicts,
        resolved_missing_fields: resolvedMissingFields,
        resolved_weak_fields: resolvedWeakFields,
        still_open_fields: afterOpenFields
      },
      {
        phase: "converge",
        converged,
        terminal_state: after?.resolution_state || null,
        route_to_human: [
          completionResolutionStates.TARGETED_RESCAN_REQUIRED,
          completionResolutionStates.MANUAL_REQUIRED,
          completionResolutionStates.BUDGET_EXHAUSTED
        ].includes(after?.resolution_state)
      }
    ]
  };
}

export function appendConvergenceToTrace(traceEntry, {
  before,
  after,
  focusedFields = []
} = {}) {
  if (!traceEntry) return traceEntry;
  const output = traceEntry.output || {};
  const convergence = createConvergenceEvent({
    action: traceEntry.action,
    status: traceEntry.status,
    before,
    after,
    informationGain: output.information_gain,
    retrievalCandidateCount: output.candidate_count,
    focusedFields
  });

  return {
    ...traceEntry,
    output: {
      ...output,
      convergence
    }
  };
}

export function buildConvergenceReport(trace = [], finalState = {}) {
  const events = (trace || [])
    .map((entry) => entry?.output?.convergence)
    .filter(Boolean);
  const finalOpenFields = openFields(finalState);

  return {
    loop: convergenceLoopName,
    iterations: events.length,
    converged: finalState?.resolution_state === completionResolutionStates.EVIDENCE_CLOSED,
    terminal_state: finalState?.resolution_state || null,
    final_open_fields: finalOpenFields,
    conflict_path: events.map((event) => ({
      action: event.action,
      before_conflicts: event.before?.conflicting_fields || [],
      after_conflicts: event.after?.conflicting_fields || [],
      resolved_conflicts: event.resolved_conflicts || [],
      new_conflicts: event.new_conflicts || []
    })),
    phase_sequence: events.length
      ? ["detect_conflict", "retrieve_or_reread", "re_evaluate", "converge"]
      : []
  };
}
