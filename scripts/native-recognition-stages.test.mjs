import assert from "node:assert/strict";
import {
  applyKnowledgeAndResolve,
  commitWriterReadyResult,
  nativeRecognitionStageIds,
  prepareEvidenceSnapshot,
  runFullProviderObservation,
  tryExactIdentityFastFinal
} from "../lib/listing/v4/pipeline/native-recognition-stages.mjs";

const image = {
  storageRole: "front_original",
  contentSha256: "a".repeat(64),
  storageVerified: true
};
const payload = {
  tenant_id: "tenant-stage",
  images: [image]
};

const cacheHit = await tryExactIdentityFastFinal({
  payload,
  lookupApprovedMemory: async () => null,
  lookupIdentityCache: async () => ({
    result: { final_title: "Cached L2", identity_cache: { cache_hit: true } },
    telemetry: { cache_hit: true, provider_call_skipped: true }
  })
});
assert.equal(cacheHit.trace.stage_id, nativeRecognitionStageIds.TRY_EXACT_IDENTITY_FAST_FINAL);
assert.equal(cacheHit.trace.status, "COMPLETED");
assert.deepEqual(cacheHit.trace.reason_codes, ["IDENTITY_RESULT_CACHE"]);
assert.equal(cacheHit.output.result.final_title, "Cached L2");
assert.equal(cacheHit.output.provider_call_skipped, true);
assert.equal(Object.isFrozen(cacheHit.output), true);
assert.equal(Object.isFrozen(cacheHit.output.result), true);

const original = { nested: { value: 1 } };
const prepared = await prepareEvidenceSnapshot({
  input: original,
  inputVersion: "input-v1",
  outputVersion: "evidence-v1",
  execute: async (input) => {
    assert.equal(Object.isFrozen(input), true);
    assert.equal(Object.isFrozen(input.nested), true);
    return { snapshot: { value: input.nested.value }, reason_codes: ["SNAPSHOT_READY"] };
  }
});
assert.equal(prepared.trace.status, "COMPLETED");
assert.equal(original.nested.value, 1);

for (const [runner, stageId] of [
  [runFullProviderObservation, nativeRecognitionStageIds.RUN_FULL_PROVIDER_OBSERVATION],
  [applyKnowledgeAndResolve, nativeRecognitionStageIds.APPLY_KNOWLEDGE_AND_RESOLVE],
  [commitWriterReadyResult, nativeRecognitionStageIds.COMMIT_WRITER_READY_RESULT]
]) {
  const replay = await runner({
    input: { value: 1 },
    inputVersion: "v1",
    outputVersion: "v1",
    execute: async ({ value }) => ({ value: value + 1, reason_codes: ["REPLAYED"] })
  });
  assert.equal(replay.trace.stage_id, stageId);
  assert.equal(replay.output.value, 2);
}

console.log("native recognition stage contract tests passed");
