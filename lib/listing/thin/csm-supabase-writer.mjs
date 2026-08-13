// Write the CSM stage rows to Supabase.
//
// `csm-persistence.mjs` builds the rows; this is the transport and nothing
// else. Keeping them apart is the point: the row shapes are covered by a
// contract test that reads the migration file, and that test must not need a
// database. What is left here is small enough to read in one sitting --
// ordering, idempotency, and failure containment.
//
// This closes the last code-shaped gap in COS-25's chain:
//
//   upload -> stored asset -> evidence/candidates
//     -> identity resolution -> canonical object
//     -> marketplace composition -> eBay output
//
// with `upload -> stored asset` still owned by the application layer.
//
// Three properties the issue asks for by name:
//
//   * idempotency -- the immutable recognition session reserves the three
//     canonical packet hashes before any child row is written. A completed
//     exact replay is a no-op; a changed packet is rejected before writes.
//
//   * traceability -- rows go in FK order, so a reader never sees a resolved
//     bracket whose candidate is missing.
//
//   * failure preservation -- the six PostgREST writes are deliberately not
//     described as a transaction. A failed write reports the partial counts;
//     only the exact reserved packet may resume it. The application boundary
//     fails closed until that retry finishes.

import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";
import {
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  computeCsmPacketHashes,
  THIN_REGISTRY_RELEASE_ID,
  THIN_RESOLVER_VERSION
} from "./csm-persistence.mjs";
import { projectCsmOwnerExecutionReceipt } from "./csm-owner-execution-receipt.mjs";
import {
  replayFromRows,
  validateExternalIdentityReplayPacket,
  validateVerifiedOriginalObservationReplayPacket,
  verifyReplay
} from "./csm-replay.mjs";
import {
  computeVerifiedOriginalSetSha256,
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK,
  externalIdentityReplayReleaseForReceipt,
  externalIdentitySourceSnapshot,
  validateExternalIdentityEvidenceSourceRef,
  validateExternalIdentityFieldDecisions
} from "../knowledge/csm-external-identity-support.mjs";
import {
  publicVerifiedOriginalObservationReceipt,
  verifiedOriginalObservationReplayProjection
} from "./verified-original-observation-support.mjs";
import {
  validateCsmResolutionReviewIntegrity
} from "../../../csm/contracts/resolution-review.mjs";

// FK order, not schema order. csm_candidate_evidence_links references both a
// candidate and an evidence row, and csm_resolved_brackets references both a
// resolution and a candidate, so those two go after their parents. Getting
// this wrong surfaces as a foreign-key violation on the FIRST card, which is
// the good failure mode -- but only because the order is explicit here rather
// than being whatever Object.keys returned.
const WRITE_PLAN = Object.freeze([
  { key: "evidence", table: "csm_evidence_observations", conflict: "id" },
  { key: "candidates", table: "csm_bracket_candidates", conflict: "id" },
  { key: "links", table: "csm_candidate_evidence_links", conflict: "candidate_id,evidence_observation_id,relationship" },
  { key: "resolution", table: "csm_identity_resolutions", conflict: "id" },
  { key: "resolved", table: "csm_resolved_brackets", conflict: "resolution_id,bracket" },
  { key: "output", table: "csm_marketplace_outputs", conflict: "id" }
]);

const SESSION_HASH_KEYS = Object.freeze([
  "csm_recognition_packet_sha256",
  "csm_resolution_packet_sha256",
  "csm_marketplace_packet_sha256"
]);

const SESSION_STATUS_KEYS = Object.freeze([
  "csm_recognition_stage_status",
  "csm_resolution_stage_status",
  "csm_composition_stage_status"
]);

export const CSM_ATOMIC_PERSISTENCE_RPC = "persist_csm_stage_packet_v1";
export const CSM_PRODUCT_PROJECTION_READINESS_RPC = "check_csm_session_product_projection_v1";
export const CSM_RESOLUTION_REVIEW_MEASUREMENT_COLUMNS = Object.freeze([
  "measurement_basis", "measurement_snapshot", "measurement_snapshot_sha256"
]);
export const CSM_PRODUCT_PROJECTION_VERSION = "csm-session-product-projection-v1";
export const CSM_SUPABASE_REQUEST_TIMEOUT_MS = 5_000;
export const CSM_SUPABASE_READINESS_BUDGET_MS = 8_000;
export const CSM_SUPABASE_ATOMIC_BUDGET_MS = 12_000;
export const THIN_REGISTRY_RELEASE_CONTRACT = Object.freeze({
  id: THIN_REGISTRY_RELEASE_ID,
  registry_version: "thin-path-registry-release-v1",
  content_sha256: "ac36d845fe8ca6ad21b017560736864f077fc67a1a864ad9947ac25b8432a6c7",
  sem_standard_version: "linear-cos-10-23-v25"
});
export const THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT = Object.freeze({
  id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  registry_version: "thin-path-external-identity-high-risers-v2",
  content_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256,
  sem_standard_version: "linear-cos-10-23-v25"
});
export const THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT = Object.freeze({
  mode: "post_observation_exact_external_identity",
  external_catalog: true,
  pack_id: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_id,
  pack_version: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_version,
  index_id: EXTERNAL_IDENTITY_SUPPORT_PACK.index_id,
  pack_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256,
  index_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.index_sha256,
  resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
  provider_calls_added: 0
});

const emptyWrittenCounts = () => Object.fromEntries(WRITE_PLAN.map(({ table }) => [table, 0]));

function safeText(value) {
  return String(value || "").trim();
}

const EXTERNAL_IDENTITY_PUBLIC_FIELDS = Object.freeze([
  "year", "manufacturer", "product", "set", "subjects", "team", "card_number"
]);
const EXTERNAL_IDENTITY_PUBLIC_ACTIONS = new Set([
  "FILL", "CORROBORATE", "NORMALIZE_ALIAS", "CORRECT_CONFLICT"
]);
const EXTERNAL_IDENTITY_REGISTRY_VERSIONS = Object.freeze({
  registry_thin_external_identity_high_risers_v1:
    "thin-path-external-identity-high-risers-v1",
  registry_thin_external_identity_high_risers_v2:
    "thin-path-external-identity-high-risers-v2"
});
const EXTERNAL_IDENTITY_PUBLIC_SOURCES = Object.freeze([
  Object.freeze({ sourcePrefix: "tcdb.", hostname: "www.tcdb.com", provider: "TCDB" }),
  Object.freeze({ sourcePrefix: "psa.", hostname: "www.psacard.com", provider: "PSA" }),
  Object.freeze({ sourcePrefix: "beckett.", hostname: "www.beckett.com", provider: "Beckett" })
]);

function plainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactRecordContract(value, contract) {
  if (!plainRecord(value)) return false;
  const names = Object.keys(contract);
  return Object.keys(value).length === names.length
    && names.every((name) => Object.hasOwn(value, name) && value[name] === contract[name]);
}

function externalIdentityReplayDescriptor(stored) {
  if (!plainRecord(stored)) return null;
  const descriptor = externalIdentityReplayReleaseForReceipt(stored);
  if (!plainRecord(descriptor) || !plainRecord(descriptor.receipt)) return null;
  return Object.entries(descriptor.receipt).every(([name, value]) => stored[name] === value)
    ? descriptor
    : null;
}

function externalIdentityRegistryContract(descriptor) {
  const receipt = descriptor?.receipt;
  const registryVersion = EXTERNAL_IDENTITY_REGISTRY_VERSIONS[receipt?.registry_release_id];
  if (!plainRecord(receipt) || !registryVersion) return null;
  return {
    id: receipt.registry_release_id,
    registry_version: registryVersion,
    content_sha256: receipt.pack_sha256,
    sem_standard_version: "linear-cos-10-23-v25",
    registry_payload: {
      mode: "post_observation_exact_external_identity",
      external_catalog: true,
      pack_id: receipt.pack_id,
      pack_version: receipt.pack_version,
      index_id: receipt.index_id,
      pack_sha256: receipt.pack_sha256,
      index_sha256: receipt.index_sha256,
      resolution_contract_sha256: receipt.resolution_contract_sha256,
      provider_calls_added: 0
    }
  };
}

function exactExternalIdentityRegistryRow(value, contract) {
  if (!plainRecord(value) || !plainRecord(contract)
      || !plainRecord(value.registry_payload) || !plainRecord(contract.registry_payload)) return false;
  const { registry_payload: actualPayload, ...actualRelease } = value;
  const { registry_payload: expectedPayload, ...expectedRelease } = contract;
  return exactRecordContract(actualRelease, expectedRelease)
    && exactRecordContract(actualPayload, expectedPayload);
}

function safeVersionText(value, maximum = 200) {
  const text = safeText(value);
  return text && text.length <= maximum && /^[A-Za-z0-9._:/-]+$/.test(text) ? text : "";
}

function safeSha256(value) {
  const text = safeText(value).toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : "";
}

function publicExternalIdentitySource(source, field, receipt) {
  if (!plainRecord(source) || !EXTERNAL_IDENTITY_PUBLIC_FIELDS.includes(field)) return null;
  const sourceId = safeVersionText(source.source_id);
  const rule = EXTERNAL_IDENTITY_PUBLIC_SOURCES.find(({ sourcePrefix }) => sourceId.startsWith(sourcePrefix));
  const snapshot = externalIdentitySourceSnapshot(receipt, sourceId);
  if (!rule || !snapshot
      || source.source_id !== sourceId
      || source.url !== snapshot.url
      || source.retrieved_at !== snapshot.retrieved_at
      || source.fact_sha256 !== snapshot.fact_sha256) return null;
  let parsed;
  try { parsed = new URL(snapshot.url); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== rule.hostname
      || parsed.username || parsed.password || parsed.port) return null;
  const factSha256 = safeSha256(snapshot.fact_sha256);
  const retrievedAt = snapshot.retrieved_at;
  if (!factSha256 || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt)) return null;
  return {
    provider: rule.provider,
    source_id: sourceId,
    // Query strings and fragments are not part of any allow-listed source in
    // this pack. Dropping them prevents a future stored tracking parameter (or
    // accidental secret) from becoming browser-visible provenance.
    url: `${parsed.origin}${parsed.pathname}`,
    retrieved_at: retrievedAt,
    fact_sha256: factSha256,
    fields: [field]
  };
}

/**
 * Public, source-versioned projection of an APPLIED Registry receipt.
 *
 * Evidence rows may carry canonical/observed values and future Registry
 * metadata. None of that crosses this boundary. The inspector receives only
 * the exact field action, version hashes and three explicitly allow-listed
 * HTTPS sources.
 */
function projectExternalIdentityReadback({
  output, resolution, registryRelease, evidenceRows, resolvedRows
}) {
  // `limit=100` is a hard safety bound, not pagination. Reaching it means the
  // durable packet may have been truncated, so provenance cannot be proven.
  if (!Array.isArray(evidenceRows) || evidenceRows.length >= 100
      || !validateExternalIdentityReplayPacket({
    output,
    resolution,
    evidence: evidenceRows,
    resolved: resolvedRows
  })) return null;

  const stored = output?.structured_output?.external_identity_support;
  const descriptor = externalIdentityReplayDescriptor(stored);
  const registryContract = externalIdentityRegistryContract(descriptor);
  if (!descriptor || !registryContract
      || !Object.entries(descriptor.resolution)
        .every(([name, value]) => resolution?.[name] === value)
      || !Object.entries(descriptor.output)
        .every(([name, value]) => output?.[name] === value)
      || !exactExternalIdentityRegistryRow(registryRelease, registryContract)
      || !validateExternalIdentityFieldDecisions(stored)) return null;

  const receipt = descriptor.receipt;
  const packSha256 = safeSha256(receipt.pack_sha256);
  const indexSha256 = safeSha256(receipt.index_sha256);
  const resolutionContractSha256 = safeSha256(receipt.resolution_contract_sha256);
  const recordId = safeVersionText(stored.record_id);
  const indexVersion = safeVersionText(receipt.index_version);
  const matchBasis = safeVersionText(stored.match_mode);
  const originalSetSha256 = stored.original_set_sha256 == null
    ? ""
    : safeSha256(stored.original_set_sha256);
  if (!packSha256 || !indexSha256 || !resolutionContractSha256
      || !recordId || !indexVersion
      || !descriptor.match_modes.includes(matchBasis)
      || (matchBasis === "VERIFIED_ORIGINAL_SET" && !originalSetSha256)
      || (matchBasis === "EXACT_FOUR_ANCHOR" && originalSetSha256)) return null;

  const sourceMap = new Map();
  const evidenceFields = new Map();
  for (const row of Array.isArray(evidenceRows) ? evidenceRows : []) {
    const sourceRef = row?.source_ref;
    const field = safeVersionText(sourceRef?.field);
    if (!EXTERNAL_IDENTITY_PUBLIC_FIELDS.includes(field)
        || evidenceFields.has(field)
        || !validateExternalIdentityEvidenceSourceRef(stored, sourceRef)) continue;
    evidenceFields.set(field, sourceRef);
    for (const source of Array.isArray(sourceRef.sources) ? sourceRef.sources : []) {
      const projected = publicExternalIdentitySource(source, field, receipt);
      if (!projected) return null;
      const key = `${projected.source_id}\u0000${projected.fact_sha256}\u0000${projected.url}`;
      const previous = sourceMap.get(key);
      if (previous) previous.fields = [...new Set([...previous.fields, field])].sort();
      else sourceMap.set(key, projected);
    }
  }
  if (evidenceFields.size !== Object.keys(stored.field_decisions).length
      || Object.keys(stored.field_decisions).some((field) => !evidenceFields.has(field))) return null;
  const sources = [...sourceMap.values()].sort((left, right) => (
    left.provider.localeCompare(right.provider) || left.source_id.localeCompare(right.source_id)
  ));
  if (!sources.length) return null;

  const sourceIdsByField = new Map(EXTERNAL_IDENTITY_PUBLIC_FIELDS.map((field) => [field, new Set()]));
  for (const source of sources) {
    for (const field of source.fields) sourceIdsByField.get(field)?.add(source.source_id);
  }
  const fieldDecisions = {};
  for (const field of EXTERNAL_IDENTITY_PUBLIC_FIELDS) {
    const decision = stored.field_decisions?.[field];
    if (!plainRecord(decision) || !EXTERNAL_IDENTITY_PUBLIC_ACTIONS.has(decision.action)) continue;
    const sourceIds = [...new Set((Array.isArray(decision.source_ids) ? decision.source_ids : [])
      .map((sourceId) => safeVersionText(sourceId))
      .filter((sourceId) => sourceIdsByField.get(field)?.has(sourceId)))].sort();
    if (sourceIds.length) fieldDecisions[field] = { action: decision.action, source_ids: sourceIds };
  }
  if (Object.keys(fieldDecisions).length !== Object.keys(stored.field_decisions).length) return null;

  return {
    schema_version: "csm-external-identity-public-receipt.v1",
    status: "APPLIED",
    registry_release: {
      id: resolution.registry_release_id,
      registry_version: safeVersionText(registryRelease.registry_version),
      content_sha256: safeSha256(registryRelease.content_sha256),
      sem_standard_version: safeVersionText(registryRelease.sem_standard_version)
    },
    // This proves which durable exact-match mechanism produced the receipt,
    // without exposing either component image hash or their set digest.
    match_basis: matchBasis,
    resolver_version: safeVersionText(resolution.resolver_version),
    conflict_policy_version: safeVersionText(resolution.conflict_policy_version),
    composer_version: safeVersionText(output.composer_version),
    marketplace_profile_version: safeVersionText(output.marketplace_profile_version),
    resolution_contract_sha256: resolutionContractSha256,
    pack: {
      id: safeVersionText(receipt.pack_id),
      version: safeVersionText(receipt.pack_version),
      sha256: packSha256
    },
    index: {
      id: safeVersionText(receipt.index_id),
      version: indexVersion,
      sha256: indexSha256
    },
    record_id: recordId,
    supported_fields: Object.keys(fieldDecisions),
    field_decisions: fieldDecisions,
    sources
  };
}

/**
 * Validate and redact one historical verified-original closed projection.
 *
 * The private receipt is insufficient on its own: the durable recognition
 * session must still point at the same two original bytes. This prevents a
 * fully re-sealed packet from being transplanted onto another asset.
 */
export function projectVerifiedOriginalObservationReadback({ session, rows } = {}) {
  const stored = rows?.output?.structured_output?.verified_original_observation_support;
  if (!plainRecord(stored)) return null;
  const snapshot = session?.identity_snapshot;
  const references = Array.isArray(snapshot?.image_references)
    ? snapshot.image_references.filter((reference) => reference?.derived !== true)
    : [];
  if (snapshot?.expected_original_count !== 2 || references.length !== 2) return null;
  const roles = references.map((reference) => safeText(reference?.image_role));
  const hashes = references.map((reference) => safeSha256(reference?.content_sha256));
  if (new Set(roles).size !== 2
      || !roles.includes("front_original") || !roles.includes("back_original")
      || hashes.some((hash) => !hash) || new Set(hashes).size !== 2) return null;
  let originalSetSha256;
  try { originalSetSha256 = computeVerifiedOriginalSetSha256(hashes); }
  catch { return null; }
  if (originalSetSha256 !== stored.original_set_sha256
      || !validateVerifiedOriginalObservationReplayPacket(rows)
      || !verifyReplay(rows, rows.output?.title).ok) return null;
  let replayed;
  try { replayed = replayFromRows(rows); }
  catch { return null; }
  return publicVerifiedOriginalObservationReceipt(stored, {
    observedFields: stored.observed_fields,
    resolvedProjection: verifiedOriginalObservationReplayProjection(replayed.fields)
  });
}

function positiveTimeout(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function requestTimedOut(error) {
  return [error, error?.cause].some((candidate) => (
    candidate?.name === "TimeoutError"
    || candidate?.name === "AbortError"
    || candidate?.code === "ABORT_ERR"
  ));
}

function boundedRequestSignal({ deadlineMs, requestTimeoutMs, now }) {
  const remainingMs = Math.floor(deadlineMs - now());
  if (remainingMs < 1) {
    throw Object.assign(new Error("csm_supabase_budget_exhausted"), {
      name: "TimeoutError"
    });
  }
  return AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, remainingMs)));
}

function stageRowsIdentity(rows) {
  const tenantId = safeText(rows?.resolution?.tenant_id);
  const recognitionSessionId = safeText(rows?.resolution?.recognition_session_id);
  if (!tenantId || !recognitionSessionId) throw new Error("missing_csm_stage_row_identity");
  for (const step of WRITE_PLAN) {
    const values = Array.isArray(rows?.[step.key]) ? rows[step.key] : rows?.[step.key] ? [rows[step.key]] : [];
    for (const row of values) {
      if (safeText(row?.tenant_id) !== tenantId || safeText(row?.recognition_session_id) !== recognitionSessionId) {
        throw new Error("mixed_csm_stage_row_identity");
      }
    }
  }
  return { tenantId, recognitionSessionId };
}

function stagePacketHashes(rows) {
  const supplied = rows?.session_hashes || {};
  const computed = computeCsmPacketHashes(rows);
  if (!SESSION_HASH_KEYS.every((key) => (
    /^[0-9a-f]{64}$/.test(safeText(supplied[key]))
    && safeText(supplied[key]) === computed[key]
  ))) {
    throw new Error("invalid_csm_packet_hashes");
  }
  if (safeText(rows?.resolution?.recognition_packet_sha256)
      !== computed.csm_recognition_packet_sha256
      || safeText(rows?.output?.resolution_packet_sha256)
      !== computed.csm_resolution_packet_sha256) {
    throw new Error("csm_packet_lineage_hash_mismatch");
  }
  return computed;
}

async function responseRows(response, context) {
  const text = await response.text();
  if (!text) throw new Error(`${context}:representation_missing`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${context}:representation_invalid`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${context}:representation_not_array`);
  return parsed;
}

export function isCsmPersistenceConfigured(env = process.env) {
  return Boolean(String(env.SUPABASE_URL || "").trim()
    && String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim());
}

const csmServiceKey = (env) => String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();

/** Active CSM persistence is OFF unless explicitly enabled. */
export function csmPersistenceEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.CSM_PERSISTENCE_ENABLED || "").trim().toLowerCase()
  );
}

/** Cost guard: verify the migration and Registry seed before paying the model. */
export async function checkCsmPersistenceReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = CSM_SUPABASE_REQUEST_TIMEOUT_MS,
  maximumDurationMs = CSM_SUPABASE_READINESS_BUDGET_MS,
  now = Date.now,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
} = {}) {
  if (!csmPersistenceEnabled(env)) return { ready: false, reason: "disabled" };
  if (!isCsmPersistenceConfigured(env)) return { ready: false, reason: "unconfigured" };
  if (typeof fetchImpl !== "function") return { ready: false, reason: "missing_fetch" };
  if (typeof now !== "function") return { ready: false, reason: "invalid_now" };
  const perRequestTimeoutMs = positiveTimeout(requestTimeoutMs, CSM_SUPABASE_REQUEST_TIMEOUT_MS, 60_000);
  const totalBudgetMs = positiveTimeout(maximumDurationMs, CSM_SUPABASE_READINESS_BUDGET_MS, 60_000);
  const deadlineMs = now() + totalBudgetMs;
  const endpoint = new URL(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/csm_registry_releases`);
  endpoint.searchParams.set("select", "id,registry_version,content_sha256,sem_standard_version,registry_payload");
  endpoint.searchParams.set("id", `in.(${THIN_REGISTRY_RELEASE_ID},${EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID})`);
  endpoint.searchParams.set("limit", "2");
  let lastReason = "schema_probe_failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let phase = "registry_probe";
    try {
      const response = await fetchImpl(endpoint.toString(), {
        headers: supabaseServiceHeaders(csmServiceKey(env)),
        redirect: "error",
        signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
      });
      if (!response.ok) {
        lastReason = `schema_probe_${response.status}`;
        if (response.status < 500 || attempt === 2) return { ready: false, reason: lastReason };
      } else {
        const rows = await response.json();
        const releases = new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.id, row]));
        const release = releases.get(THIN_REGISTRY_RELEASE_ID) || null;
        const externalRelease = releases.get(EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID) || null;
        if (!release || !externalRelease) return { ready: false, reason: "registry_release_missing" };
        if (!Object.entries(THIN_REGISTRY_RELEASE_CONTRACT)
          .every(([name, value]) => release[name] === value)
          || release.registry_payload?.mode !== "local_sem_and_composer_only"
          || release.registry_payload?.external_catalog !== false
          || !Object.entries(THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT)
            .every(([name, value]) => externalRelease[name] === value)
          || !exactRecordContract(
            externalRelease.registry_payload,
            THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT
          )) {
          return { ready: false, reason: "registry_release_contract_mismatch" };
        }
        // A harmless invalid-input call proves PostgREST can see the additive
        // atomic RPC before a paid provider request. It returns before locking
        // or writing any session.
        // Both probes are invalid-input/read-only checks and do not depend on
        // one another. Run them concurrently after the Registry contract is
        // verified; the outer retry loop still retries the whole receipt if
        // either transport boundary is transient or times out.
        const probeRpc = async (probePhase, url, init, expected) => {
          let response;
          try {
            response = await fetchImpl(url, init);
          } catch (error) {
            error.csmReadinessPhase = probePhase;
            throw error;
          }
          if (!response.ok) return { ok: false, reason: `${probePhase}_${response.status}` };
          let result = null;
          try {
            result = await response.json();
          } catch (error) {
            if (requestTimedOut(error)) {
              error.csmReadinessPhase = probePhase;
              throw error;
            }
          }
          return expected(result)
            ? { ok: true, result }
            : { ok: false, reason: `${probePhase}_contract_mismatch` };
        };
        const reviewMeasurementEndpoint = new URL(
          `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/csm_resolution_reviews`
        );
        reviewMeasurementEndpoint.searchParams.set(
          "select", CSM_RESOLUTION_REVIEW_MEASUREMENT_COLUMNS.join(",")
        );
        reviewMeasurementEndpoint.searchParams.set("limit", "0");
        const [atomicProbe, projectionProbe, reviewMeasurementProbe] = await Promise.all([
          probeRpc(
            "atomic_rpc_probe",
            `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${CSM_ATOMIC_PERSISTENCE_RPC}`,
            {
              method: "POST",
              headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
              redirect: "error",
              body: JSON.stringify({
                p_tenant_id: "",
                p_recognition_session_id: "",
                p_packet: {},
                p_session_patch: {}
              }),
              signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
            },
            (result) => result?.code === "missing_csm_stage_row_identity"
          ),
          probeRpc(
            "product_projection_probe",
            `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`,
            {
              method: "POST",
              headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
              redirect: "error",
              body: "{}",
              signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
            },
            (result) => result?.ok === true
              && result?.code === "csm_product_projection_ready"
              && result?.version === CSM_PRODUCT_PROJECTION_VERSION
          ),
          probeRpc(
            "review_measurement_schema_probe",
            reviewMeasurementEndpoint.toString(),
            {
              headers: supabaseServiceHeaders(csmServiceKey(env)),
              redirect: "error",
              signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
            },
            (result) => Array.isArray(result)
          )
        ]);
        if (!atomicProbe.ok) return { ready: false, reason: atomicProbe.reason };
        if (!projectionProbe.ok) return { ready: false, reason: projectionProbe.reason };
        return reviewMeasurementProbe.ok
          ? { ready: true, reason: null }
          : { ready: false, reason: reviewMeasurementProbe.reason };
      }
    } catch (error) {
      phase = error?.csmReadinessPhase || phase;
      lastReason = requestTimedOut(error)
        ? `${phase}_timeout`
        : `${phase}_failed:${String(error?.message || error).slice(0, 120)}`;
      if (attempt === 2) return { ready: false, reason: lastReason };
    }
    const remainingMs = Math.max(0, deadlineMs - now());
    if (remainingMs < 1) return { ready: false, reason: lastReason };
    await sleep(Math.min(120, remainingMs));
  }
  return { ready: false, reason: lastReason };
}

/** Read the immutable attempt marker owned by v4_recognition_sessions. */
export async function readCsmSessionPacketState({
  tenantId, recognitionSessionId, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const endpoint = new URL(`${url}/rest/v1/v4_recognition_sessions`);
  endpoint.searchParams.set("select", ["id", "tenant_id", ...SESSION_HASH_KEYS, ...SESSION_STATUS_KEYS].join(","));
  endpoint.searchParams.set("id", `eq.${recognitionSessionId}`);
  endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  endpoint.searchParams.set("limit", "1");
  const response = await fetchImpl(endpoint.toString(), {
    headers: supabaseServiceHeaders(csmServiceKey(env)),
    redirect: "error"
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_session_preflight:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_session_preflight");
  return rows[0] || null;
}

/**
 * Reserve one packet on a session with a compare-and-set PATCH.
 *
 * This is not the six-table transaction. It is the immutable attempt fence:
 * only one set of packet hashes can cross the child-write boundary.
 */
export async function claimCsmSessionPacket({
  tenantId, recognitionSessionId, hashes, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const endpoint = new URL(`${url}/rest/v1/v4_recognition_sessions`);
  endpoint.searchParams.set("id", `eq.${recognitionSessionId}`);
  endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  for (const key of SESSION_HASH_KEYS) endpoint.searchParams.set(key, "is.null");
  const response = await fetchImpl(endpoint.toString(), {
    method: "PATCH",
    headers: supabaseServiceHeaders(csmServiceKey(env), {
      "content-type": "application/json",
      prefer: "return=representation"
    }),
    redirect: "error",
    body: JSON.stringify(hashes)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_session_claim:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_session_claim");
  return { claimed: rows.length === 1, session: rows[0] || null };
}

/** Detect legacy/partial child facts that have no packet reservation. */
export async function readExistingCsmStageRows({
  tenantId, recognitionSessionId, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const checks = await Promise.all(WRITE_PLAN.map(async ({ table, conflict }) => {
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    endpoint.searchParams.set("select", conflict.split(",")[0]);
    endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    endpoint.searchParams.set("recognition_session_id", `eq.${recognitionSessionId}`);
    endpoint.searchParams.set("limit", "1");
    const response = await fetchImpl(endpoint.toString(), {
      headers: supabaseServiceHeaders(csmServiceKey(env)),
      redirect: "error"
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${table}_preflight:${response.status} ${detail.slice(0, 180)}`);
    }
    const rows = await responseRows(response, `${table}_preflight`);
    return { table, present: rows.length > 0 };
  }));
  return checks;
}

function classifySessionPacket(session, hashes) {
  if (!session) return { state: "missing" };
  const stored = SESSION_HASH_KEYS.map((key) => safeText(session[key]));
  const present = stored.filter(Boolean).length;
  if (present === 0) return { state: "unclaimed" };
  if (present !== SESSION_HASH_KEYS.length) return { state: "invalid_partial_hashes" };
  const exact = SESSION_HASH_KEYS.every((key) => safeText(session[key]) === hashes[key]);
  if (!exact) return { state: "conflict" };
  const complete = SESSION_STATUS_KEYS.every((key) => safeText(session[key]).toUpperCase() === "COMPLETE");
  return { state: complete ? "exact_complete" : "exact_incomplete" };
}

function writerFailure(code, {
  statusCode = 503, written = emptyWrittenCounts(), failedTable = null, error = code
} = {}) {
  return {
    ok: false,
    code,
    statusCode,
    skipped: null,
    replayed: false,
    atomic: false,
    written,
    failedTable,
    error
  };
}

/**
 * Production transport: one Postgres transaction for rows + COMPLETE marker.
 * The additive migration owns locking, immutable retry classification and
 * actual insert counts. Absence or an invalid response fails closed.
 */
export async function writeCsmStagePacketAtomically(rows, {
  sessionPatch,
  env = process.env,
  fetchImpl = globalThis.fetch,
  maximumAttempts = 5,
  retryDelayMs = 100,
  requestTimeoutMs = CSM_SUPABASE_REQUEST_TIMEOUT_MS,
  maximumDurationMs = CSM_SUPABASE_ATOMIC_BUDGET_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now = Date.now
} = {}) {
  if (!csmPersistenceEnabled(env)) {
    return { ok: true, skipped: "disabled", written: {}, atomic: false };
  }
  if (!isCsmPersistenceConfigured(env)) {
    return { ok: true, skipped: "unconfigured", written: {}, atomic: false };
  }

  let identity;
  let hashes;
  try {
    identity = stageRowsIdentity(rows);
    hashes = stagePacketHashes(rows);
  } catch (error) {
    return writerFailure(String(error?.message || "invalid_csm_stage_rows"), {
      statusCode: 400,
      error: String(error?.message || error)
    });
  }
  if (!sessionPatch || SESSION_HASH_KEYS.some((key) => safeText(sessionPatch[key]) !== hashes[key])) {
    return writerFailure("invalid_csm_session_patch", { statusCode: 400 });
  }

  const endpoint = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${CSM_ATOMIC_PERSISTENCE_RPC}`;
  const attempts = Math.max(1, Math.min(5, Number(maximumAttempts) || 5));
  const perRequestTimeoutMs = positiveTimeout(requestTimeoutMs, CSM_SUPABASE_REQUEST_TIMEOUT_MS, 60_000);
  const totalBudgetMs = positiveTimeout(maximumDurationMs, CSM_SUPABASE_ATOMIC_BUDGET_MS, 60_000);
  if (typeof fetchImpl !== "function" || typeof now !== "function") {
    return writerFailure("csm_atomic_rpc_invalid_transport", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  const deadlineMs = now() + totalBudgetMs;
  const request = {
    method: "POST",
    headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
    redirect: "error",
    body: JSON.stringify({
      p_tenant_id: identity.tenantId,
      p_recognition_session_id: identity.recognitionSessionId,
      p_packet: rows,
      p_session_patch: sessionPatch
    })
  };
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    let raw = "";
    try {
      response = await fetchImpl(endpoint, {
        ...request,
        signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
      });
      raw = await response.text();
    } catch (error) {
      const timedOut = requestTimedOut(error);
      if (attempt < attempts && deadlineMs - now() > 0) {
        await sleep(Math.min(
          retryDelayMs * (2 ** (attempt - 1)),
          Math.max(0, deadlineMs - now())
        ));
        continue;
      }
      return writerFailure(timedOut ? "csm_atomic_rpc_timeout" : "csm_atomic_rpc_failed", {
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC,
        error: String(error?.message || error)
      });
    }
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await sleep(Math.min(
          retryDelayMs * (2 ** (attempt - 1)),
          Math.max(0, deadlineMs - now())
        ));
        continue;
      }
      return writerFailure("csm_atomic_rpc_failed", {
        statusCode: Number(response.status || 503),
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC,
        error: `${response.status} ${raw.slice(0, 240)}`
      });
    }
    try {
      const parsed = JSON.parse(raw);
      result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
    } catch {
      return writerFailure("csm_atomic_rpc_invalid_response", {
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC
      });
    }
    if (result?.ok !== true
        && [429, 500, 502, 503, 504].includes(Number(result?.status_code))
        && attempt < attempts) {
      await sleep(Math.min(
        retryDelayMs * (2 ** (attempt - 1)),
        Math.max(0, deadlineMs - now())
      ));
      continue;
    }
    break;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return writerFailure("csm_atomic_rpc_invalid_response", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  if (result.ok !== true) {
    return writerFailure(safeText(result.code) || "csm_atomic_rpc_rejected", {
      statusCode: Number(result.status_code || 503),
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  const written = emptyWrittenCounts();
  for (const { table } of WRITE_PLAN) {
    const count = Number(result.written?.[table]);
    if (!Number.isSafeInteger(count) || count < 0) {
      return writerFailure("csm_atomic_rpc_invalid_counts", {
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC
      });
    }
    written[table] = count;
  }
  if (result.atomic !== true || (result.replayed !== true && result.session_saved !== true)) {
    return writerFailure("csm_atomic_rpc_incomplete_commit", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  return {
    ok: true,
    code: safeText(result.code) || (result.replayed ? "exact_replay" : "inserted"),
    statusCode: 200,
    skipped: null,
    replayed: result.replayed === true,
    resumed: false,
    atomic: true,
    written,
    session: { saved: true }
  };
}

async function upsert({ url, key, table, conflict, rows, fetchImpl }) {
  const payload = Array.isArray(rows) ? rows : [rows];
  if (!payload.length) return { table, written: 0 };

  const endpoint = new URL(`${url}/rest/v1/${table}`);
  endpoint.searchParams.set("on_conflict", conflict);

  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: supabaseServiceHeaders(key, {
      "content-type": "application/json",
      // Append-only facts may be replayed after a partial failure, but replay
      // must not become an UPDATE that the immutability trigger rejects.
      // Counting the payload would turn ignored duplicates into fictitious
      // inserts. PostgREST's representation is the insert receipt: an exact
      // retry returns [], a first insert returns the inserted rows.
      prefer: "resolution=ignore-duplicates,return=representation"
    }),
    redirect: "error",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // The table name is in the error because "insert failed" is not
    // actionable; "csm_resolved_brackets failed with a FK violation" is.
    throw Object.assign(new Error(`${table}: ${response.status} ${detail.slice(0, 300)}`), {
      table, status: response.status
    });
  }
  const inserted = await responseRows(response, `${table}_insert`);
  if (inserted.length > payload.length) throw new Error(`${table}:insert_count_exceeds_payload`);
  return { table, written: inserted.length };
}

/**
 * Persist one card's rows.
 *
 * @param rows as produced by `buildCsmStageRows`
 * @returns { ok, skipped, written, failedTable, error } -- never throws
 */
export async function writeCsmStageRows(rows, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  readSessionState = readCsmSessionPacketState,
  claimSession = claimCsmSessionPacket,
  readExistingRows = readExistingCsmStageRows
} = {}) {
  if (!csmPersistenceEnabled(env)) {
    return { ok: true, skipped: "disabled", written: {} };
  }
  if (!isCsmPersistenceConfigured(env)) {
    // Not an error. An unconfigured environment is the normal case for local
    // evaluation runs, and failing them over shadow persistence would make the
    // measurement path depend on a database it does not use.
    return { ok: true, skipped: "unconfigured", written: {} };
  }

  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = csmServiceKey(env);
  const written = emptyWrittenCounts();
  let identity;
  let hashes;
  try {
    identity = stageRowsIdentity(rows);
    hashes = stagePacketHashes(rows);
  } catch (error) {
    return writerFailure(String(error?.message || "invalid_csm_stage_rows"), {
      statusCode: 400,
      written,
      error: String(error?.message || error)
    });
  }

  let session;
  try {
    session = await readSessionState({ ...identity, hashes, env, fetchImpl });
  } catch (error) {
    return writerFailure("csm_session_preflight_failed", {
      written,
      failedTable: "v4_recognition_sessions",
      error: String(error?.message || error)
    });
  }

  let relation = classifySessionPacket(session, hashes);
  if (relation.state === "missing") {
    return writerFailure("csm_session_not_found", {
      statusCode: 409, written, failedTable: "v4_recognition_sessions"
    });
  }
  if (relation.state === "invalid_partial_hashes") {
    return writerFailure("csm_session_hash_state_incomplete", {
      statusCode: 409, written, failedTable: "v4_recognition_sessions"
    });
  }
  if (relation.state === "conflict") {
    return writerFailure("immutable_session_conflict", {
      statusCode: 409, written, failedTable: "v4_recognition_sessions"
    });
  }
  if (relation.state === "exact_complete") {
    return {
      ok: true,
      code: "exact_replay",
      statusCode: 200,
      skipped: null,
      replayed: true,
      resumed: false,
      atomic: false,
      written
    };
  }

  if (relation.state === "unclaimed") {
    let existing;
    try {
      existing = await readExistingRows({ ...identity, hashes, env, fetchImpl });
    } catch (error) {
      return writerFailure("csm_child_preflight_failed", {
        written, error: String(error?.message || error)
      });
    }
    if ((existing || []).some((entry) => entry?.present)) {
      // Rows without an attempt marker may have been produced by the unsafe
      // transport. We cannot prove which packet they belong to, so adopting
      // them would be the same silent corruption this fence is meant to stop.
      return writerFailure("csm_unclaimed_partial_state", {
        statusCode: 409, written
      });
    }

    let claimed;
    try {
      claimed = await claimSession({ ...identity, hashes, env, fetchImpl });
    } catch (error) {
      return writerFailure("csm_session_claim_failed", {
        written,
        failedTable: "v4_recognition_sessions",
        error: String(error?.message || error)
      });
    }
    if (!claimed?.claimed) {
      // Another request won the compare-and-set. Re-read its packet before a
      // single child write: same packet may safely resume, different packet
      // is the immutable-session conflict.
      try {
        session = await readSessionState({ ...identity, hashes, env, fetchImpl });
      } catch (error) {
        return writerFailure("csm_session_claim_reread_failed", {
          written,
          failedTable: "v4_recognition_sessions",
          error: String(error?.message || error)
        });
      }
      relation = classifySessionPacket(session, hashes);
      if (relation.state === "exact_complete") {
        return {
          ok: true, code: "exact_replay", statusCode: 200, skipped: null,
          replayed: true, resumed: false, atomic: false, written
        };
      }
      if (relation.state !== "exact_incomplete") {
        return writerFailure(
          relation.state === "conflict" ? "immutable_session_conflict" : "csm_session_claim_lost",
          { statusCode: 409, written, failedTable: "v4_recognition_sessions" }
        );
      }
    }
  }

  for (const step of WRITE_PLAN) {
    const value = rows[step.key];
    if (!value) continue;
    try {
      const result = await upsert({ url, key, table: step.table, conflict: step.conflict, rows: value, fetchImpl });
      written[step.table] = result.written;
    } catch (error) {
      // Stop at the first failure rather than pressing on: every later table
      // references this one, so continuing would produce a cascade of FK
      // violations that buries the actual cause. What is already written stays
      // -- the ids are deterministic, so a retry completes the chain rather
      // than duplicating it.
      return {
        ...writerFailure("csm_stage_write_failed", {
          written, failedTable: step.table, error: error.message
        }),
        resumed: relation.state === "exact_incomplete"
      };
    }
  }

  return {
    ok: true,
    code: relation.state === "exact_incomplete" ? "exact_resume" : "inserted",
    statusCode: 200,
    skipped: null,
    replayed: false,
    resumed: relation.state === "exact_incomplete",
    atomic: false,
    written
  };
}

/**
 * Read one run's stored resolution for the inspector. COS-42.
 *
 * A pure read over facts the run already committed: no provider call, no
 * recomposition here, no write. An operator opening a card must not be able to
 * spend money or mutate a record by looking at it.
 *
 * The canonical payload comes from `csm_marketplace_outputs`, which is the row
 * that actually shipped, joined to its resolution and session so the review
 * written later can name the exact facts it reviewed.
 */
export async function readCsmResolutionRecord({
  tenantId, assetId, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const headers = supabaseServiceHeaders(csmServiceKey(env));
  const readRows = async (endpoint, context) => {
    const response = await fetchImpl(endpoint.toString(), { headers, redirect: "error" });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${context}:${response.status} ${detail.slice(0, 180)}`);
    }
    return responseRows(response, context);
  };

  // Two hops, because the CSM stage tables are keyed on the recognition
  // session and carry no `asset_id` at all. The first version of this queried
  // `csm_marketplace_outputs` by `asset_id` and selected `canonical_payload`,
  // `identity_resolution_id` and `resolver_version` -- four names that do not
  // exist on that table, so the Glass Box read answered 400 for every card.
  // The unit tests stubbed this function, so nothing caught it until the
  // columns were compared against the live schema.
  //
  //   v4_recognition_sessions   asset_id -> session id
  //   csm_marketplace_outputs   session  -> structured_output, resolution_id
  //   csm_identity_resolutions  resolution -> resolver_version
  const sessionEndpoint = new URL(`${url}/rest/v1/v4_recognition_sessions`);
  sessionEndpoint.searchParams.set("select", [
    "id", "asset_id", "created_at", "csm_owner_versions", "identity_snapshot",
    "csm_recognition_packet_sha256", "csm_resolution_packet_sha256",
    "csm_marketplace_packet_sha256"
  ].join(","));
  sessionEndpoint.searchParams.set("asset_id", `eq.${assetId}`);
  sessionEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  sessionEndpoint.searchParams.set("order", "created_at.desc");
  sessionEndpoint.searchParams.set("limit", "1");
  const session = (await readRows(sessionEndpoint, "csm_resolution_session_read"))[0];
  if (!session?.id) return null;

  const outputEndpoint = new URL(`${url}/rest/v1/csm_marketplace_outputs`);
  outputEndpoint.searchParams.set("select", [
    "id", "tenant_id", "recognition_session_id", "resolution_id",
    "structured_output", "dropped_trace", "title", "composer_version", "created_at",
    // `replayFromRows` dispatches the composer on all three of these and
    // refuses to guess. Omitting them threw `unsupported_replay_version` for
    // every card -- a correct refusal to replay a run whose composer identity
    // is unknown, but the identity is right there in the row.
    "marketplace", "marketplace_profile_version", "contract_version",
    "included_brackets", "resolution_packet_sha256"
  ].join(","));
  outputEndpoint.searchParams.set("recognition_session_id", `eq.${session.id}`);
  outputEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  outputEndpoint.searchParams.set("order", "created_at.desc");
  outputEndpoint.searchParams.set("limit", "1");
  const row = (await readRows(outputEndpoint, "csm_resolution_read"))[0];
  if (!row) return null;

  // `resolver_version` lives on the resolution, not the output. Missing it is
  // not fatal -- the view stamps a fallback -- so one failed hop must not deny
  // the operator the trace.
  // `grammar` as well as `resolver_version`: the replay cross-checks the
  // stored composition grammar against the identity's own, and refuses rather
  // than guess when they disagree. Without the row it saw `undefined/standard`
  // and refused every card.
  let resolution = null;
  if (row.resolution_id) {
    const resolutionEndpoint = new URL(`${url}/rest/v1/csm_identity_resolutions`);
    resolutionEndpoint.searchParams.set("select", [
      "id", "resolver_version", "conflict_policy_version", "grammar",
      "registry_release_id", "contract_version", "revision",
      "tenant_id", "recognition_session_id", "recognition_packet_sha256",
      "resolution_status"
    ].join(","));
    resolutionEndpoint.searchParams.set("id", `eq.${row.resolution_id}`);
    resolutionEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    resolutionEndpoint.searchParams.set("limit", "1");
    try {
      resolution = (await readRows(resolutionEndpoint, "csm_resolution_version_read"))[0] || null;
    } catch { resolution = null; }
  }
  const resolverVersion = resolution?.resolver_version || "";

  // The resolved brackets, because `structured_output` is the CSM EMIT shape
  // (`sem`, `print_finish_layers`, `composition_grammar`) and not the flat
  // canonical fields object. Feeding it to `parseCanonicalFields` returns a
  // near-empty result -- the Glass Box would show an operator a blank trace for
  // a card that resolved perfectly well. `replayFromRows` is the reverse
  // mapping that already exists, and it needs both halves.
  const bracketEndpoint = new URL(`${url}/rest/v1/csm_resolved_brackets`);
  bracketEndpoint.searchParams.set("select", [
    "bracket", "selected_kind", "canonical_value", "empty_reason",
    "selected_candidate_id", "alternate_candidate_ids", "rationale_codes",
    "semantic_confidence", "tenant_id", "recognition_session_id", "resolution_id"
  ].join(","));
  bracketEndpoint.searchParams.set("resolution_id", `eq.${row.resolution_id}`);
  bracketEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  let resolved = [];
  try {
    resolved = await readRows(bracketEndpoint, "csm_resolved_brackets_read");
  } catch { resolved = []; }

  // Historical baseline rows stop here. Durable v3 rows read their private
  // relation observations; APPLIED external identity uses the same bounded
  // evidence set to reconstruct source provenance. The Registry evidence
  // table remains the URL authority; the output summary carries no sources.
  let externalIdentitySupport = null;
  const storedExternal = row.structured_output?.external_identity_support;
  const replayDescriptor = externalIdentityReplayDescriptor(storedExternal);
  const externalReplaySelected = Boolean(replayDescriptor
    && resolution?.registry_release_id === replayDescriptor.resolution.registry_release_id);
  const verifiedOriginalStored = plainRecord(
    row.structured_output?.verified_original_observation_support
  );
  const durableRelationStored = row.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION
    && plainRecord(row.structured_output?.set_card_name_relation_receipt);
  let relationEvidenceRows = null;
  if ((durableRelationStored && !verifiedOriginalStored) || externalReplaySelected) {
    const evidenceEndpoint = new URL(`${url}/rest/v1/csm_evidence_observations`);
    // The private replay bundle needs the exact visual Set/Card Name rows for
    // every v3 output. External resolution additionally reconstructs its full
    // source receipt from Registry rows. Read the same bounded evidence set
    // once and never project it directly into the public response.
    evidenceEndpoint.searchParams.set(
      "select", [
        "bracket", "raw_value", "normalized_value", "modality", "source_ref",
        "observation_confidence", "normalization_version", "normalization_outcome",
        "normalization_reason_code"
      ].join(",")
    );
    evidenceEndpoint.searchParams.set("recognition_session_id", `eq.${session.id}`);
    evidenceEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    evidenceEndpoint.searchParams.set("limit", "100");
    try {
      relationEvidenceRows = await readRows(
        evidenceEndpoint, "csm_set_card_name_relation_evidence_read"
      );
      if (relationEvidenceRows.length >= 100) {
        throw new Error("csm_set_card_name_relation_evidence_readback_truncated");
      }
    } catch {
      relationEvidenceRows = null;
    }
    if (durableRelationStored && !relationEvidenceRows) {
      throw new Error("csm_set_card_name_relation_evidence_readback_invalid");
    }
  }
  if (externalReplaySelected && relationEvidenceRows) {
    const registryEndpoint = new URL(`${url}/rest/v1/csm_registry_releases`);
    registryEndpoint.searchParams.set(
      "select", "id,registry_version,content_sha256,sem_standard_version,registry_payload"
    );
    registryEndpoint.searchParams.set("id", `eq.${resolution.registry_release_id}`);
    registryEndpoint.searchParams.set("limit", "1");

    try {
      const registryRows = await readRows(
        registryEndpoint, "csm_external_identity_registry_read"
      );
      externalIdentitySupport = projectExternalIdentityReadback({
        output: row,
        resolution,
        registryRelease: registryRows[0] || null,
        evidenceRows: relationEvidenceRows,
        resolvedRows: resolved
      });
    } catch {
      // The inspector remains available for the stored baseline trace, but it
      // must not reconstruct or guess provenance when either durable read is
      // unavailable.
      externalIdentitySupport = null;
    }
    if (durableRelationStored && !externalIdentitySupport) {
      throw new Error("csm_external_identity_relation_readback_invalid");
    }
  }

  let verifiedOriginalObservationSupport = null;
  let replayRows = {
    output: row,
    resolved,
    resolution,
    ...(relationEvidenceRows ? { evidence: relationEvidenceRows } : {})
  };
  if (verifiedOriginalStored) {
    const evidenceEndpoint = new URL(`${url}/rest/v1/csm_evidence_observations`);
    evidenceEndpoint.searchParams.set("select", [
      "id", "tenant_id", "recognition_session_id", "contract_version", "bracket",
      "raw_value", "normalized_value", "modality", "source_ref",
      "observation_confidence", "normalization_version", "normalization_outcome",
      "normalization_reason_code"
    ].join(","));
    evidenceEndpoint.searchParams.set("recognition_session_id", `eq.${session.id}`);
    evidenceEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    evidenceEndpoint.searchParams.set("limit", "100");

    const candidateEndpoint = new URL(`${url}/rest/v1/csm_bracket_candidates`);
    candidateEndpoint.searchParams.set("select", [
      "id", "tenant_id", "recognition_session_id", "contract_version", "bracket",
      "value_kind", "canonical_value", "empty_reason", "source_trust",
      "candidate_confidence", "candidate_rank"
    ].join(","));
    candidateEndpoint.searchParams.set("recognition_session_id", `eq.${session.id}`);
    candidateEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    candidateEndpoint.searchParams.set("limit", "100");

    const linkEndpoint = new URL(`${url}/rest/v1/csm_candidate_evidence_links`);
    linkEndpoint.searchParams.set("select", [
      "tenant_id", "recognition_session_id", "candidate_id",
      "evidence_observation_id", "relationship"
    ].join(","));
    linkEndpoint.searchParams.set("recognition_session_id", `eq.${session.id}`);
    linkEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    linkEndpoint.searchParams.set("limit", "100");

    const [evidence, candidates, links] = await Promise.all([
      readRows(evidenceEndpoint, "csm_verified_original_evidence_read"),
      readRows(candidateEndpoint, "csm_verified_original_candidates_read"),
      readRows(linkEndpoint, "csm_verified_original_links_read")
    ]);
    if ([evidence, candidates, links].some((rows) => rows.length >= 100)) {
      throw new Error("csm_verified_original_observation_readback_truncated");
    }
    replayRows = {
      output: row,
      resolution,
      resolved,
      evidence,
      candidates,
      links,
      session_hashes: {
        csm_recognition_packet_sha256: session.csm_recognition_packet_sha256,
        csm_resolution_packet_sha256: session.csm_resolution_packet_sha256,
        csm_marketplace_packet_sha256: session.csm_marketplace_packet_sha256
      }
    };
    verifiedOriginalObservationSupport = projectVerifiedOriginalObservationReadback({
      session,
      rows: replayRows
    });
    if (!verifiedOriginalObservationSupport) {
      throw new Error("csm_verified_original_observation_readback_invalid");
    }
  }

  return {
    asset_id: session.asset_id,
    recognition_session_id: row.recognition_session_id,
    resolution_id: row.resolution_id,
    output_id: row.id,
    canonical_payload: row.structured_output,
    output_title: row.title,
    resolver_version: resolverVersion || THIN_RESOLVER_VERSION,
    registry_release_id: resolution?.registry_release_id || null,
    conflict_policy_version: resolution?.conflict_policy_version || null,
    // Composer identity is durable execution provenance. Never relabel a
    // malformed or historical output as whatever happens to be current.
    composer_version: row.composer_version || null,
    marketplace_profile_version: row.marketplace_profile_version || null,
    owner_execution_receipt: projectCsmOwnerExecutionReceipt(session.csm_owner_versions),
    ...(externalIdentitySupport ? { external_identity_support: externalIdentitySupport } : {}),
    ...(verifiedOriginalObservationSupport ? {
      verified_original_observation_support: verifiedOriginalObservationSupport
    } : {}),
    // The bundle `replayFromRows` consumes, in its own shape.
    replay_rows: replayRows
  };
}

/**
 * Append one review. Never an update.
 *
 * A correction that overwrote the resolution it corrects would destroy the only
 * record of what the model actually did, and every accuracy number derived
 * afterwards would be measuring a human-edited past. The insert therefore has
 * no conflict target: a repeated revision is a new row, and
 * `revision_sha256` is what lets a reader tell a replay from a fresh decision.
 */
export async function appendCsmResolutionReview({
  tenantId, review, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  // Recheck immediately before the storage boundary. The API builds this
  // snapshot server-side, but dependency injection or later refactors must not
  // be able to alter its denominator or revision after construction. Validate
  // the FINAL wire object: validating first and then overwriting tenant_id
  // would persist bytes the revision hash never bound.
  const body = { ...review, tenant_id: String(tenantId || "").trim() };
  validateCsmResolutionReviewIntegrity(body);
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const endpoint = new URL(`${url}/rest/v1/csm_resolution_reviews`);
  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      ...supabaseServiceHeaders(csmServiceKey(env)),
      "content-type": "application/json",
      prefer: "return=representation"
    },
    redirect: "error",
    body: JSON.stringify([body])
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_review_append:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_review_append");
  return rows[0] || null;
}
