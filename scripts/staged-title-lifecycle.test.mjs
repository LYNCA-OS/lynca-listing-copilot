import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ORIGINAL_DURABILITY_STATUS,
  TITLE_FINALIZATION_STATUS,
  TITLE_TRACE_STATUS,
  existingTitleInteractionLocked,
  shouldWarnBeforeUnload,
  stagedWorkPending,
  titleActionPolicy,
  titleLifecyclePolicy
} from "../app/staged-title-lifecycle.mjs";

const staged = titleLifecyclePolicy({ traceStatus: TITLE_TRACE_STATUS.CHECKPOINTED });
assert.deepEqual(staged, {
  hasDurableTitle: true,
  editable: true,
  copyable: true,
  decisionReady: false,
  staged: true
});

assert.deepEqual(
  titleActionPolicy({ action: "copy", traceStatus: TITLE_TRACE_STATUS.CHECKPOINTED }),
  { enabled: true, joinFinalization: false },
  "copy must not wait for exact-original finalization"
);
for (const action of ["ACCEPT", "REJECT", "EXPORT"]) {
  assert.deepEqual(
    titleActionPolicy({ action, traceStatus: TITLE_TRACE_STATUS.CHECKPOINTED }),
    { enabled: true, joinFinalization: true },
    `${action} must join the same finalization promise instead of requiring a second click`
  );
}

const persisted = titleLifecyclePolicy({ traceStatus: TITLE_TRACE_STATUS.PERSISTED });
assert.equal(persisted.decisionReady, true);
for (const action of ["ACCEPT", "REJECT", "EXPORT"]) {
  assert.deepEqual(
    titleActionPolicy({ action, traceStatus: TITLE_TRACE_STATUS.PERSISTED }),
    { enabled: true, joinFinalization: false }
  );
}

assert.equal(existingTitleInteractionLocked({
  traceStatus: TITLE_TRACE_STATUS.CHECKPOINTED,
  intakePreparing: true,
  processingNewAssets: true
}), false, "preparing appended files must not lock an existing title");
assert.equal(existingTitleInteractionLocked({
  traceStatus: TITLE_TRACE_STATUS.CHECKPOINTED,
  destructiveMutation: true
}), true);

for (const originalDurabilityStatus of [
  ORIGINAL_DURABILITY_STATUS.PENDING,
  ORIGINAL_DURABILITY_STATUS.UPLOADING
]) {
  assert.equal(shouldWarnBeforeUnload({
    traceStatus: TITLE_TRACE_STATUS.CHECKPOINTED,
    originalDurabilityStatus,
    finalizationStatus: TITLE_FINALIZATION_STATUS.IDLE
  }), true);
}
for (const finalizationStatus of [
  TITLE_FINALIZATION_STATUS.PENDING,
  TITLE_FINALIZATION_STATUS.FINALIZING
]) {
  assert.equal(stagedWorkPending({
    traceStatus: TITLE_TRACE_STATUS.CHECKPOINTED,
    originalDurabilityStatus: ORIGINAL_DURABILITY_STATUS.VERIFIED,
    finalizationStatus
  }), true);
}
assert.equal(shouldWarnBeforeUnload({
  traceStatus: TITLE_TRACE_STATUS.PERSISTED,
  originalDurabilityStatus: ORIGINAL_DURABILITY_STATUS.UPLOADING,
  finalizationStatus: TITLE_FINALIZATION_STATUS.FINALIZING
}), true, "in-flight work must never be hidden by an inconsistent trace status");
assert.equal(shouldWarnBeforeUnload({
  traceStatus: TITLE_TRACE_STATUS.PERSISTED,
  originalDurabilityStatus: ORIGINAL_DURABILITY_STATUS.VERIFIED,
  finalizationStatus: TITLE_FINALIZATION_STATUS.PERSISTED
}), false);

assert.deepEqual(titleActionPolicy({ action: "DELETE", traceStatus: "CHECKPOINTED" }), {
  enabled: false,
  joinFinalization: false
});
for (const traceStatus of ["", "FAILED"]) {
  for (const action of ["ACCEPT", "REJECT", "EXPORT"]) {
    assert.deepEqual(titleActionPolicy({ action, traceStatus }), {
      enabled: false,
      joinFinalization: false
    }, "a failed/non-staged card must remain on manual recovery, not checkpoint finalize");
  }
}

const clientSource = await readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
const exportReadinessSource = clientSource.slice(
  clientSource.indexOf("function completedExportRowsReady"),
  clientSource.indexOf("function setExportWorkbookStatus")
);
assert.match(
  exportReadinessSource,
  /result\.csm_trace_status !== TITLE_TRACE_STATUS\.CHECKPOINTED/,
  "a staged title must not advertise workbook export as ready before exact originals finalize"
);
assert.match(
  exportReadinessSource,
  /asset\.titleFinalizationStatus !== TITLE_FINALIZATION_STATUS\.FAILED/,
  "a failed finalization must keep workbook export visibly unavailable"
);

console.log("staged title lifecycle tests passed");
