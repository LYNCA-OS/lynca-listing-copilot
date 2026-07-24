import { buildIdentityResultCacheKey } from "../../cache/identity-result-cache.mjs";

export const nativeRecognitionStageContractVersion = "native-recognition-stages-v1";

export const nativeRecognitionStageIds = Object.freeze({
  PREPARE_EVIDENCE_SNAPSHOT: "prepare_evidence_snapshot",
  TRY_EXACT_IDENTITY_FAST_FINAL: "try_exact_identity_fast_final",
  RUN_FULL_PROVIDER_OBSERVATION: "run_full_provider_observation",
  APPLY_KNOWLEDGE_AND_RESOLVE: "apply_knowledge_and_resolve",
  COMMIT_WRITER_READY_RESULT: "commit_writer_ready_result"
});

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function stageTrace({ stageId, inputVersion, outputVersion, status, reasonCodes = [] } = {}) {
  return Object.freeze({
    schema_version: nativeRecognitionStageContractVersion,
    stage_id: stageId,
    input_version: clean(inputVersion) || "unversioned-input",
    output_version: clean(outputVersion) || "unversioned-output",
    status,
    reason_codes: Object.freeze([...new Set(reasonCodes.map(clean).filter(Boolean))])
  });
}

async function runImmutableStage({
  stageId,
  input = {},
  inputVersion,
  outputVersion,
  execute
} = {}) {
  if (typeof execute !== "function") throw new Error(`${stageId} requires an execute function.`);
  const immutableInput = deepFreeze(clone(input));
  try {
    const output = deepFreeze(clone(await execute(immutableInput)));
    return Object.freeze({
      output,
      trace: stageTrace({
        stageId,
        inputVersion,
        outputVersion,
        status: "COMPLETED",
        reasonCodes: output?.reason_codes || []
      })
    });
  } catch (error) {
    return Object.freeze({
      output: null,
      error,
      trace: stageTrace({
        stageId,
        inputVersion,
        outputVersion,
        status: "FAILED",
        reasonCodes: [error?.code || `${stageId}_failed`]
      })
    });
  }
}

export function prepareEvidenceSnapshot(options = {}) {
  return runImmutableStage({ ...options, stageId: nativeRecognitionStageIds.PREPARE_EVIDENCE_SNAPSHOT });
}

export async function tryExactIdentityFastFinal({
  payload = {},
  preProviderRescanResult = null,
  lookupWriterFinalReplay,
  lookupApprovedMemory,
  lookupIdentityCache
} = {}) {
  const key = buildIdentityResultCacheKey(payload);
  return runImmutableStage({
    stageId: nativeRecognitionStageIds.TRY_EXACT_IDENTITY_FAST_FINAL,
    input: { payload, preProviderRescanResult },
    inputVersion: key.version_fingerprint || nativeRecognitionStageContractVersion,
    outputVersion: key.version_fingerprint || nativeRecognitionStageContractVersion,
    execute: async ({ payload: immutablePayload, preProviderRescanResult: rescan }) => {
      const [writerFinalResult, approvedMemoryResult, identityCacheLookup] = await Promise.all([
        typeof lookupWriterFinalReplay === "function" ? lookupWriterFinalReplay(immutablePayload) : null,
        typeof lookupApprovedMemory === "function" ? lookupApprovedMemory(immutablePayload) : null,
        typeof lookupIdentityCache === "function" ? lookupIdentityCache(immutablePayload) : null
      ]);
      const identityCacheResult = identityCacheLookup?.result || null;
      const result = writerFinalResult || approvedMemoryResult || identityCacheResult || rescan || null;
      const route = writerFinalResult
        ? "WRITER_FINAL_REPLAY"
        : approvedMemoryResult
          ? "APPROVED_IDENTITY_MEMORY"
          : identityCacheResult
            ? "AI_TERMINAL_L2_REPLAY"
            : rescan
              ? "PRE_PROVIDER_RESCAN"
              : "FULL_RECOGNITION";
      return {
        result,
        identity_cache_lookup: identityCacheLookup || { result: null, telemetry: {} },
        provider_call_skipped: Boolean(result),
        reason_codes: [route]
      };
    }
  });
}

export function runFullProviderObservation(options = {}) {
  return runImmutableStage({ ...options, stageId: nativeRecognitionStageIds.RUN_FULL_PROVIDER_OBSERVATION });
}

export function applyKnowledgeAndResolve(options = {}) {
  return runImmutableStage({ ...options, stageId: nativeRecognitionStageIds.APPLY_KNOWLEDGE_AND_RESOLVE });
}

export function commitWriterReadyResult(options = {}) {
  return runImmutableStage({ ...options, stageId: nativeRecognitionStageIds.COMMIT_WRITER_READY_RESULT });
}

export const __nativeRecognitionStagesTestHooks = Object.freeze({ clone, deepFreeze, runImmutableStage });
