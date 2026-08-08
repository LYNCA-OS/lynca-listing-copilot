// The complete thin CSM application boundary for one already-persisted asset.
//
// Asset upload/session creation stay application-owned. From that durable
// session onward this function has one straight path:
//
//   Luna observation -> canonical fields -> deterministic Composer
//     -> replayable CSM rows -> optional shadow persistence
//
// Keeping this composition here prevents the application from reimplementing
// CSM field mapping or persistence ordering. Provider and storage failures are
// distinguishable, but neither returns a usable production result: a title
// without its immutable CSM lineage is a failed attempt.

import { createHash } from "node:crypto";

import { validateAccuracyLossLedger } from "./accuracy-loss-ledger.mjs";
import { runCanonicalListingPath } from "./thin-listing-path.mjs";
import {
  buildCsmStageRows, CSM_STAGE_CONTRACT_VERSION, EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION, THIN_RESOLVER_VERSION
} from "./csm-persistence.mjs";
import { verifyReplay } from "./csm-replay.mjs";
import { writeCsmStagePacketAtomically } from "./csm-supabase-writer.mjs";
import { patchSupabaseRow } from "../../supabase-rest.mjs";

function requiredIdentity(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`missing_${name}`);
  return text;
}

function failClosedPersistence(persistence, rows, fallbackCode) {
  const code = String(persistence?.code || fallbackCode || "csm_persistence_failed");
  return Object.assign(new Error(code), {
    code,
    statusCode: Number(persistence?.statusCode || 503),
    csm_persistence: persistence,
    csm_rows: rows
  });
}

function invalidPreparedResult(detail) {
  return Object.assign(new Error("csm_prepared_result_invalid"), {
    code: "csm_prepared_result_invalid",
    statusCode: 409,
    detail: String(detail || "invalid")
  });
}

function preparedRows(prepared, tenant, session) {
  const rows = prepared?.csm_rows;
  if (!rows || typeof rows !== "object") throw invalidPreparedResult("rows_missing");
  if (rows?.resolution?.tenant_id !== tenant
      || rows?.resolution?.recognition_session_id !== session) {
    throw invalidPreparedResult("row_identity_mismatch");
  }
  const replay = verifyReplay(rows, prepared?.title);
  if (replay.ok !== true) {
    throw invalidPreparedResult(replay.problems?.[0]?.kind || "replay_failed");
  }
  return rows;
}

function latencyStageReceipt(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stages = Object.fromEntries(Object.entries(value).flatMap(([name, raw]) => {
    const duration = Number(raw);
    return /^[a-z][a-z0-9_]{1,48}$/.test(name)
      && Number.isFinite(duration) && duration >= 0
      ? [[name, Math.round(duration)]]
      : [];
  }));
  return Object.keys(stages).length ? stages : null;
}

function csmSessionPatch({ rows, result, model, effort, imageDetail, promptVersion }) {
  const accuracyLossLedger = result.accuracy_loss_ledger
    ? validateAccuracyLossLedger(result.accuracy_loss_ledger, { result })
    : null;
  const pipelineFingerprint = createHash("sha256").update(JSON.stringify({
    contract: CSM_STAGE_CONTRACT_VERSION, model, effort, imageDetail,
    resolver: THIN_RESOLVER_VERSION, composer: THIN_COMPOSER_VERSION
  })).digest("hex");
  const latencyStages = latencyStageReceipt(result.latency_stages_ms);
  return {
    csm_contract_version: CSM_STAGE_CONTRACT_VERSION,
    csm_registry_release_id: rows.resolution.registry_release_id,
    csm_grammar: rows.resolution.grammar,
    csm_grammar_confidence: (result.fields.low_confidence || []).includes("grammar") ? 0.5 : 0.8,
    recognition_pipeline_fingerprint: pipelineFingerprint,
    csm_owner_versions: {
      provider: "openai",
      model,
      effort,
      reasoning_effort: result.served_effort || effort,
      image_detail: imageDetail,
      prompt_version: promptVersion || result.prompt_version || null,
      provider_response_id: result.provider_response_id || null,
      provider_request_id: result.provider_request_id || null,
      provider_client_request_id: result.provider_client_request_id || null,
      provider_attempt_number: Number.isInteger(Number(result.provider_attempt_number))
        ? Number(result.provider_attempt_number)
        : null,
      provider_retry_count: Number.isInteger(Number(result.provider_retry_count))
        ? Number(result.provider_retry_count)
        : null,
      latency_ms: result.latency_ms ?? null,
      ...(latencyStages ? { latency_stages_ms: latencyStages } : {}),
      input_tokens: result.input_tokens ?? null,
      output_tokens: result.output_tokens ?? null,
      total_tokens: result.input_tokens !== null && result.input_tokens !== undefined
        && result.output_tokens !== null && result.output_tokens !== undefined
        && Number.isFinite(Number(result.input_tokens))
        && Number.isFinite(Number(result.output_tokens))
        ? Number(result.input_tokens) + Number(result.output_tokens)
        : null,
      resolver: THIN_RESOLVER_VERSION,
      composer: THIN_COMPOSER_VERSION,
      marketplace_profile: EBAY_PROFILE_VERSION,
      accuracy_loss_ledger_version: accuracyLossLedger?.version || null,
      accuracy_loss_ledger_sha256: accuracyLossLedger?.ledger_sha256 || null
    },
    csm_recognition_stage_status: "COMPLETE",
    csm_resolution_stage_status: "COMPLETE",
    csm_composition_stage_status: "COMPLETE",
    ...rows.session_hashes
  };
}

// Paid boundary only: produce the deterministic result and its complete CSM
// packet, but do not write it.  The provider authority can durably settle this
// value before the fallible persistence call starts.
export async function prepareCanonicalListingPath({
  tenantId,
  recognitionSessionId,
  imageUrls,
  imageDetail = "high",
  model = "gpt-5.6-luna",
  effort = "low",
  registryReleaseId,
  callProvider,
  promptVersion = null,
  providerClientRequestId = null,
  createdAt = null
} = {}) {
  const tenant = requiredIdentity(tenantId, "tenant_id");
  const session = requiredIdentity(recognitionSessionId, "recognition_session_id");
  if (typeof callProvider !== "function") throw new Error("missing_call_provider");

  const result = await runCanonicalListingPath({
    imageUrls, model, effort, imageDetail, providerClientRequestId, callProvider
  });
  const rows = buildCsmStageRows({
    tenantId: tenant,
    recognitionSessionId: session,
    fields: result.fields,
    // `finishCanonicalTitle` exposes public `*_brackets` names while the CSM
    // row builder consumes the Composer's compact internal names. Map the
    // projection ledger explicitly: JSON silently drops undefined values, so
    // passing the public result through used to persist only `truncated`.
    composed: {
      grammar: result.grammar,
      brackets: result.brackets,
      dropped: result.dropped_brackets,
      suppressed: result.suppressed_brackets,
      restored: result.restored_brackets,
      truncated: result.truncated,
      // The composition receipt COS-42's inspector reads. Same trap as the
      // names above: these arrive under public names and JSON drops what is
      // undefined, so a missing entry here is invisible until an operator opens
      // a card and finds the trace empty.
      input_empty_fields: result.input_empty_fields,
      normalization_reasons: result.normalization_reasons,
      character_budget: result.character_budget,
      length: result.length
    },
    title: result.title,
    registryReleaseId,
    createdAt
  });
  return { ...result, prompt_version: promptVersion, csm_rows: rows };
}

// Storage boundary only: validate that the durable provider checkpoint still
// replays exactly, then write the already-built rows.  There is deliberately no
// callProvider/image URL parameter here, so a persistence resume cannot cross
// the paid boundary by construction.
export async function persistPreparedCanonicalListingPath({
  tenantId,
  recognitionSessionId,
  prepared,
  imageDetail = "high",
  model = "gpt-5.6-luna",
  effort = "low",
  promptVersion = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  patchSession = patchSupabaseRow,
  writeRows = writeCsmStagePacketAtomically,
  writerOptions = {}
} = {}) {
  const tenant = requiredIdentity(tenantId, "tenant_id");
  const session = requiredIdentity(recognitionSessionId, "recognition_session_id");
  const rows = preparedRows(prepared, tenant, session);
  const sessionPatch = csmSessionPatch({
    rows, result: prepared, model, effort, imageDetail,
    promptVersion: promptVersion || prepared.prompt_version
  });
  const persistence = await writeRows(rows, {
    env, fetchImpl, sessionPatch, ...writerOptions
  });

  if (!persistence.ok) {
    // In particular, an immutable-session conflict must never reach the
    // COMPLETE patch below. Returning the deterministic title here would give
    // the API usable-200 semantics for an unpersisted result.
    throw failClosedPersistence(persistence, rows, "csm_stage_write_failed");
  }

  if (!persistence.skipped && !persistence.replayed && persistence.session?.saved !== true) {
    // Compatibility seam for offline/non-atomic transports. Production uses
    // the additive RPC above, which commits rows and this marker together.
    const sessionWrite = await patchSession({
      table: "v4_recognition_sessions",
      id: session,
      // Preserve the attempt fence across the child-write -> COMPLETE gap.
      // If anything changed a reserved hash, this conditional patch matches
      // zero rows and the application stays failed closed.
      match: { tenant_id: tenant, ...rows.session_hashes },
      requireMatch: true,
      patch: sessionPatch,
      env,
      fetchImpl
    });
    if (!sessionWrite.saved) {
      throw failClosedPersistence({
        ...persistence,
        ok: false,
        code: "csm_session_stage_patch_failed",
        statusCode: 503,
        failedTable: "v4_recognition_sessions",
        error: sessionWrite.error || "csm_session_stage_patch_failed"
      }, rows, "csm_session_stage_patch_failed");
    }
    persistence.session = { saved: true };
  }

  return { ...prepared, csm_rows: rows, csm_persistence: persistence };
}

export async function runPersistedCanonicalListingPath(options = {}) {
  const prepared = await prepareCanonicalListingPath(options);
  return persistPreparedCanonicalListingPath({
    ...options,
    prepared
  });
}
