export function buildIdentityState({
  identity = {},
  fieldStates = [],
  conflictGraph = { nodes: [], edges: [] },
  resolutionTrace = [],
  catalogCardIdentity = {},
  physicalAssetIdentity = {},
  openWorldIdentity = {},
  abstainReasonCodes = [],
  status = "ABSTAIN"
} = {}) {
  const fieldStateMap = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState]));
  const fieldCandidates = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState.candidates || []]));
  const fieldConflicts = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState.conflict_items || []]));
  const fieldUncertainty = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState.field_uncertainty || {}]));

  return {
    state_version: "identity-state-v1",
    fields: identity,
    catalog_card_identity: catalogCardIdentity,
    physical_asset_identity: physicalAssetIdentity,
    open_world_identity: openWorldIdentity,
    field_states: fieldStateMap,
    field_candidates: fieldCandidates,
    field_conflicts: fieldConflicts,
    field_uncertainty: fieldUncertainty,
    conflict_graph: conflictGraph,
    uncertainty_map: fieldUncertainty,
    abstain_reason_codes: abstainReasonCodes,
    resolution_trace: resolutionTrace,
    status
  };
}
