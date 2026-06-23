export function buildIdentityState({
  identity = {},
  fieldStates = [],
  conflictGraph = { nodes: [], edges: [] },
  resolutionTrace = [],
  status = "ABSTAIN"
} = {}) {
  const fieldStateMap = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState]));
  const fieldCandidates = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState.candidates || []]));
  const fieldConflicts = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState.conflict_items || []]));
  const fieldUncertainty = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState.field_uncertainty || {}]));

  return {
    state_version: "identity-state-v1",
    fields: identity,
    field_states: fieldStateMap,
    field_candidates: fieldCandidates,
    field_conflicts: fieldConflicts,
    field_uncertainty: fieldUncertainty,
    conflict_graph: conflictGraph,
    uncertainty_map: fieldUncertainty,
    resolution_trace: resolutionTrace,
    status
  };
}
