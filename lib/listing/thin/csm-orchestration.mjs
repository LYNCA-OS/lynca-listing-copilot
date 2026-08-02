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

import { runCanonicalListingPath } from "./thin-listing-path.mjs";
import {
  buildCsmStageRows, CSM_STAGE_CONTRACT_VERSION, EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION, THIN_RESOLVER_VERSION
} from "./csm-persistence.mjs";
import { writeCsmStagePacketAtomically } from "./csm-supabase-writer.mjs";
import { patchV4Row } from "../v4/session/supabase-rest.mjs";

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

export async function runPersistedCanonicalListingPath({
  tenantId,
  recognitionSessionId,
  imageUrls,
  imageDetail = "high",
  model = "gpt-5.6-luna",
  effort = "none",
  registryReleaseId,
  callProvider,
  env = process.env,
  fetchImpl = globalThis.fetch,
  patchSession = patchV4Row,
  writeRows = writeCsmStagePacketAtomically,
  writerOptions = {},
  createdAt = null
} = {}) {
  const tenant = requiredIdentity(tenantId, "tenant_id");
  const session = requiredIdentity(recognitionSessionId, "recognition_session_id");
  if (typeof callProvider !== "function") throw new Error("missing_call_provider");

  const result = await runCanonicalListingPath({ imageUrls, model, effort, imageDetail, callProvider });
  const rows = buildCsmStageRows({
    tenantId: tenant,
    recognitionSessionId: session,
    fields: result.fields,
    composed: result,
    title: result.title,
    registryReleaseId,
    createdAt
  });
  const pipelineFingerprint = createHash("sha256").update(JSON.stringify({
    contract: CSM_STAGE_CONTRACT_VERSION, model, effort, imageDetail,
    resolver: THIN_RESOLVER_VERSION, composer: THIN_COMPOSER_VERSION
  })).digest("hex");
  const sessionPatch = {
    csm_contract_version: CSM_STAGE_CONTRACT_VERSION,
    csm_registry_release_id: rows.resolution.registry_release_id,
    csm_grammar: rows.resolution.grammar,
    csm_grammar_confidence: (result.fields.low_confidence || []).includes("grammar") ? 0.5 : 0.8,
    recognition_pipeline_fingerprint: pipelineFingerprint,
    csm_owner_versions: {
      model, effort, image_detail: imageDetail,
      resolver: THIN_RESOLVER_VERSION,
      composer: THIN_COMPOSER_VERSION,
      marketplace_profile: EBAY_PROFILE_VERSION
    },
    csm_recognition_stage_status: "COMPLETE",
    csm_resolution_stage_status: "COMPLETE",
    csm_composition_stage_status: "COMPLETE",
    ...rows.session_hashes
  };
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

  return { ...result, csm_rows: rows, csm_persistence: persistence };
}
