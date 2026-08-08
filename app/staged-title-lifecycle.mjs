export const TITLE_TRACE_STATUS = Object.freeze({
  CHECKPOINTED: "CHECKPOINTED",
  PERSISTED: "PERSISTED"
});

export const ORIGINAL_DURABILITY_STATUS = Object.freeze({
  PENDING: "PENDING",
  UPLOADING: "UPLOADING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED"
});

export const TITLE_FINALIZATION_STATUS = Object.freeze({
  IDLE: "IDLE",
  PENDING: "PENDING",
  FINALIZING: "FINALIZING",
  PERSISTED: "PERSISTED",
  FAILED: "FAILED"
});

const TITLE_ACTIONS = new Set(["EDIT", "COPY", "ACCEPT", "REJECT", "EXPORT"]);
const DECISION_ACTIONS = new Set(["ACCEPT", "REJECT", "EXPORT"]);
const ORIGINAL_IN_FLIGHT = new Set([
  ORIGINAL_DURABILITY_STATUS.PENDING,
  ORIGINAL_DURABILITY_STATUS.UPLOADING
]);
const FINALIZATION_IN_FLIGHT = new Set([
  TITLE_FINALIZATION_STATUS.PENDING,
  TITLE_FINALIZATION_STATUS.FINALIZING
]);

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

export function titleLifecyclePolicy({ traceStatus } = {}) {
  const trace = upper(traceStatus);
  const hasDurableTitle = trace === TITLE_TRACE_STATUS.CHECKPOINTED
    || trace === TITLE_TRACE_STATUS.PERSISTED;
  const decisionReady = trace === TITLE_TRACE_STATUS.PERSISTED;

  return Object.freeze({
    hasDurableTitle,
    editable: hasDurableTitle,
    copyable: hasDurableTitle,
    decisionReady,
    staged: trace === TITLE_TRACE_STATUS.CHECKPOINTED
  });
}

export function titleActionPolicy({ action, traceStatus } = {}) {
  const normalizedAction = upper(action);
  if (!TITLE_ACTIONS.has(normalizedAction)) {
    return Object.freeze({ enabled: false, joinFinalization: false });
  }

  const lifecycle = titleLifecyclePolicy({ traceStatus });
  const decisionAction = DECISION_ACTIONS.has(normalizedAction);
  return Object.freeze({
    enabled: lifecycle.hasDurableTitle,
    joinFinalization: lifecycle.hasDurableTitle && decisionAction && !lifecycle.decisionReady
  });
}

export function existingTitleInteractionLocked({
  traceStatus,
  destructiveMutation = false
} = {}) {
  const lifecycle = titleLifecyclePolicy({ traceStatus });
  return !lifecycle.hasDurableTitle || Boolean(destructiveMutation);
}

export function stagedWorkPending({
  originalDurabilityStatus,
  finalizationStatus
} = {}) {
  return ORIGINAL_IN_FLIGHT.has(upper(originalDurabilityStatus))
    || FINALIZATION_IN_FLIGHT.has(upper(finalizationStatus));
}

export function shouldWarnBeforeUnload(lifecycle = {}) {
  return stagedWorkPending(lifecycle);
}
