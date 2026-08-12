// GET  /api/csm-resolution-view?asset_id=...  -> CsmResolutionView
// POST /api/csm-resolution-view                -> CsmResolutionReview
//
// COS-42 stage 1 and 2. The application asks this endpoint for one composed
// read model and posts one structured review to it; it never joins the CSM
// persistence graph itself, and nothing here changes the generated title or
// the production execution chain.
//
// The GET is a pure read over stored facts. It re-runs no provider call, so an
// operator inspecting a card cannot accidentally spend money or see an
// explanation of a title that was never produced.

import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { instrumentProductionRequest, bindProductionRequestContext } from "../lib/observability/production-events.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeActiveCanonicalFields } from "../lib/listing/thin/thin-listing-path.mjs";
import {
  composeCanonicalFieldsForStoredOutput,
  replayFromRows,
  validateCanonicalNamingReplayTrace,
  validateVerifiedOriginalObservationReplayPacket
} from "../lib/listing/thin/csm-replay.mjs";
import { buildCsmResolutionView, CSM_RESOLUTION_VIEW_VERSION } from "../lib/listing/csm/resolution-view.mjs";
import {
  buildCsmResolutionReview, buildReviewMeasurementSnapshot,
  CSM_RESOLUTION_REVIEW_VERSION
} from "../lib/listing/csm/resolution-review.mjs";
import { readCsmResolutionRecord, appendCsmResolutionReview } from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V1,
  THIN_COMPOSER_VERSION_V2,
  THIN_RESOLVER_VERSION
} from "../lib/listing/thin/csm-persistence.mjs";
import { publicCsmOwnerExecutionReceipt } from "../lib/listing/thin/csm-owner-execution-receipt.mjs";
import {
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  validateExternalIdentityPublicReceipt
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  validateVerifiedOriginalObservationPublicReceipt
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import { publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { readJsonPayload, sendJson } from "../lib/listing/v4/session/http-handler-utils.mjs";

const EXTERNAL_IDENTITY_FIELDS = Object.freeze([
  "year", "manufacturer", "product", "set", "subjects", "team", "card_number"
]);
const EXTERNAL_IDENTITY_ACTIONS = new Set([
  "FILL", "CORROBORATE", "NORMALIZE_ALIAS", "CORRECT_CONFLICT"
]);
const EXTERNAL_IDENTITY_MATCH_BASES = new Set(["EXACT_FOUR_ANCHOR", "VERIFIED_ORIGINAL_SET"]);
const EXTERNAL_IDENTITY_SOURCES = Object.freeze({
  TCDB: Object.freeze({ prefix: "tcdb.", hostname: "www.tcdb.com" }),
  PSA: Object.freeze({ prefix: "psa.", hostname: "www.psacard.com" }),
  Beckett: Object.freeze({ prefix: "beckett.", hostname: "www.beckett.com" })
});

const plainRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const publicText = (value, maximum = 200) => {
  const text = String(value || "").trim();
  return text && text.length <= maximum && /^[A-Za-z0-9._:/-]+$/.test(text) ? text : "";
};
const publicSha256 = (value) => {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : "";
};

function publicExternalSource(source) {
  const rule = EXTERNAL_IDENTITY_SOURCES[source?.provider];
  const sourceId = publicText(source?.source_id);
  if (!rule || !sourceId.startsWith(rule.prefix)) return null;
  let url;
  try { url = new URL(String(source?.url || "")); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== rule.hostname
      || url.username || url.password || url.port) return null;
  const factSha256 = publicSha256(source.fact_sha256);
  const retrievedAt = String(source.retrieved_at || "").trim();
  const fields = [...new Set((Array.isArray(source.fields) ? source.fields : [])
    .map((field) => publicText(field))
    .filter((field) => EXTERNAL_IDENTITY_FIELDS.includes(field)))].sort();
  if (!factSha256 || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt) || !fields.length) return null;
  return {
    provider: source.provider,
    source_id: sourceId,
    url: `${url.origin}${url.pathname}`,
    retrieved_at: retrievedAt,
    fact_sha256: factSha256,
    fields
  };
}

/** Defense-in-depth public projection for dependency-injected and DB records. */
export function publicExternalIdentitySupport(value) {
  if (!plainRecord(value)
      || value.schema_version !== "csm-external-identity-public-receipt.v1"
      || value.status !== "APPLIED"
      || !validateExternalIdentityPublicReceipt(value)) return null;
  const sources = (Array.isArray(value.sources) ? value.sources : [])
    .map(publicExternalSource).filter(Boolean);
  if (!sources.length) return null;
  const sourceIds = new Set(sources.map((source) => source.source_id));
  const fieldDecisions = {};
  for (const field of EXTERNAL_IDENTITY_FIELDS) {
    const decision = value.field_decisions?.[field];
    if (!plainRecord(decision) || !EXTERNAL_IDENTITY_ACTIONS.has(decision.action)) continue;
    const safeSourceIds = [...new Set((Array.isArray(decision.source_ids) ? decision.source_ids : [])
      .map((sourceId) => publicText(sourceId))
      .filter((sourceId) => sourceIds.has(sourceId)))].sort();
    if (safeSourceIds.length) fieldDecisions[field] = {
      action: decision.action,
      source_ids: safeSourceIds
    };
  }
  if (!Object.keys(fieldDecisions).length) return null;

  const registryRelease = value.registry_release;
  const pack = value.pack;
  const index = value.index;
  const matchBasis = publicText(value.match_basis);
  if (!plainRecord(registryRelease) || !plainRecord(pack) || !plainRecord(index)
      || !EXTERNAL_IDENTITY_MATCH_BASES.has(matchBasis)) return null;
  const projected = {
    schema_version: "csm-external-identity-public-receipt.v1",
    status: "APPLIED",
    registry_release: {
      id: publicText(registryRelease.id),
      registry_version: publicText(registryRelease.registry_version),
      content_sha256: publicSha256(registryRelease.content_sha256),
      sem_standard_version: publicText(registryRelease.sem_standard_version)
    },
    match_basis: matchBasis,
    resolver_version: publicText(value.resolver_version),
    conflict_policy_version: publicText(value.conflict_policy_version),
    composer_version: publicText(value.composer_version),
    marketplace_profile_version: publicText(value.marketplace_profile_version),
    resolution_contract_sha256: publicSha256(value.resolution_contract_sha256),
    pack: {
      id: publicText(pack.id), version: publicText(pack.version), sha256: publicSha256(pack.sha256)
    },
    index: {
      id: publicText(index.id), version: publicText(index.version), sha256: publicSha256(index.sha256)
    },
    record_id: publicText(value.record_id),
    supported_fields: Object.keys(fieldDecisions),
    field_decisions: fieldDecisions,
    sources
  };
  const required = [
    projected.registry_release.id,
    projected.registry_release.registry_version,
    projected.registry_release.content_sha256,
    projected.registry_release.sem_standard_version,
    projected.match_basis,
    projected.resolver_version,
    projected.conflict_policy_version,
    projected.composer_version,
    projected.marketplace_profile_version,
    projected.resolution_contract_sha256,
    projected.pack.id, projected.pack.version, projected.pack.sha256,
    projected.index.id, projected.index.version, projected.index.sha256,
    projected.record_id
  ];
  return required.every(Boolean)
    && projected.registry_release.content_sha256 === projected.pack.sha256
    ? projected
    : null;
}

export function publicVerifiedOriginalObservationSupport(value) {
  return validateVerifiedOriginalObservationPublicReceipt(value)
    ? structuredClone(value)
    : null;
}

function attachExternalIdentitySupport(view, support) {
  if (!support) return view;
  const brackets = view.brackets.map((bracket) => {
    const supportedField = [
      bracket.canonical_field,
      ...(Array.isArray(bracket.canonical_fields) ? bracket.canonical_fields : [])
    ].find((field) => support.field_decisions[field]);
    const decision = support.field_decisions[supportedField];
    if (!decision) return bracket;
    const registryRationale = "EXACT_EXTERNAL_IDENTITY_SUPPORT";
    const rationaleCodes = decision.action === "FILL"
      ? [registryRationale]
      : [...new Set([...bracket.rationale_codes, registryRationale])];
    return {
      ...bracket,
      rationale_codes: rationaleCodes,
      semantic_confidence: "VERIFIED_EXTERNAL",
      evidence: {
        ...bracket.evidence,
        modality: decision.action === "FILL"
          ? "REVIEWED_REGISTRY_EXACT"
          : "WHOLE_CARD_VISUAL+REVIEWED_REGISTRY_EXACT",
        external_identity: { action: decision.action, source_ids: decision.source_ids }
      },
      alternates_unavailable_reason: "EXACT_EXTERNAL_IDENTITY_RESOLUTION"
    };
  });
  return {
    ...view,
    brackets,
    external_identity_support: support,
    summary: {
      ...view.summary,
      external_supported_fields: Object.keys(support.field_decisions).length
    }
  };
}

function externalIdentityReleaseForOutput(output) {
  return Object.values(EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases)
    .find((release) => (
      output?.composer_version === release.output.composer_version
        && output?.marketplace_profile_version === release.output.marketplace_profile_version
    )) || null;
}

/**
 * Compose the read model for one stored run.
 *
 * The stored canonical payload is re-parsed and re-composed rather than read
 * from a rendered string, so every bracket's disposition comes from the same
 * deterministic path the run used. Recomposing with a DIFFERENT composer
 * version would explain a title the operator never saw, so the version travels
 * with the response and the caller can detect the mismatch.
 */
export function composeResolutionView(record) {
  // Replay from the stored ROWS, not from `structured_output` directly.
  //
  // `structured_output` is the CSM emit shape -- `sem`, `print_finish_layers`,
  // `composition_grammar` -- and `parseCanonicalFields` expects the flat
  // canonical object. Handing one to the other returned a near-empty result, so
  // an operator opening a card that resolved perfectly well saw a blank trace.
  // `replayFromRows` is the reverse mapping the replay verifier already uses;
  // reimplementing it here would be a second copy free to drift from the one
  // that guards persistence.
  let fields;
  let composed;
  let composerVersion;
  let marketplaceProfileVersion;
  let legacyPublicProjection = false;
  let composeCorrectedTitle;
  if (record.replay_rows) {
    const storedOutput = record.replay_rows.output;
    const replayed = replayFromRows(record.replay_rows);
    fields = replayed.fields;
    composed = replayed.composed;
    const externalRelease = externalIdentityReleaseForOutput(storedOutput);
    legacyPublicProjection = externalRelease != null;
    if (externalRelease) {
      const support = publicExternalIdentitySupport(record.external_identity_support);
      if (!support
          || support.registry_release.id !== externalRelease.receipt.registry_release_id
          || support.composer_version !== storedOutput.composer_version
          || support.marketplace_profile_version !== storedOutput.marketplace_profile_version) {
        throw Object.assign(
          new Error("csm_resolution_external_identity_receipt_invalid"),
          { statusCode: 409 }
        );
      }
    }
    if (storedOutput?.structured_output?.verified_original_observation_support != null) {
      const support = publicVerifiedOriginalObservationSupport(
        record.verified_original_observation_support
      );
      if (!support || !validateVerifiedOriginalObservationReplayPacket(record.replay_rows)) {
        throw Object.assign(
          new Error("csm_resolution_verified_original_observation_receipt_invalid"),
          { statusCode: 409 }
        );
      }
    }
    if (!validateCanonicalNamingReplayTrace(storedOutput, composed)) {
      throw Object.assign(
        new Error("csm_resolution_canonical_naming_trace_invalid"),
        { statusCode: 409 }
      );
    }
    composerVersion = storedOutput?.composer_version;
    marketplaceProfileVersion = storedOutput?.marketplace_profile_version;
    legacyPublicProjection = legacyPublicProjection || ([
      THIN_COMPOSER_VERSION_V1,
      THIN_COMPOSER_VERSION_V2
    ].includes(composerVersion) && marketplaceProfileVersion === EBAY_PROFILE_VERSION);
    composeCorrectedTitle = (correctedFields) => {
      const corrected = { ...correctedFields };
      // print_finish is the correction authority. Persisted layers explain the
      // original value, but must not override an explicit semantic review.
      if (corrected.print_finish !== fields.print_finish) {
        corrected.parallel_exact = corrected.print_finish || "";
        corrected.surface_color = "";
        corrected.parallel_family = "";
      }
      return composeCanonicalFieldsForStoredOutput(
        corrected, record.replay_rows.output
      ).title;
    };
  } else {
    // Compatibility for injected/legacy flat records that predate the stored
    // replay bundle. They can only be interpreted as the current contract;
    // claiming an older version without its executable row identity would be
    // an unauditable guess.
    fields = parseCanonicalFields(record.canonical_payload).fields;
    composed = composeActiveCanonicalFields(fields);
    if ((record.composer_version && record.composer_version !== composed.composer_version)
        || (record.marketplace_profile_version
          && record.marketplace_profile_version !== composed.marketplace_profile_version)) {
      throw Object.assign(new Error("csm_resolution_replay_rows_required"), { statusCode: 409 });
    }
    composerVersion = composed.composer_version;
    marketplaceProfileVersion = composed.marketplace_profile_version;
    legacyPublicProjection = [
      THIN_COMPOSER_VERSION_V1,
      THIN_COMPOSER_VERSION_V2
    ].includes(composerVersion) && marketplaceProfileVersion === EBAY_PROFILE_VERSION;
    composeCorrectedTitle = (correctedFields) => composeActiveCanonicalFields(correctedFields).title;
  }
  return {
    view: buildCsmResolutionView({
      fields,
      composed,
      assetId: record.asset_id,
      recognitionSessionId: record.recognition_session_id,
      resolverVersion: record.resolver_version || THIN_RESOLVER_VERSION,
      legacyPublicProjection
    }),
    fields,
    composed,
    composer_version: composerVersion,
    marketplace_profile_version: marketplaceProfileVersion,
    legacy_public_projection: legacyPublicProjection,
    compose_corrected_title: composeCorrectedTitle
  };
}

export async function handleResolutionViewRequest({
  tenantId, assetId, dependencies = {}, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const readRecord = dependencies.readRecord || readCsmResolutionRecord;
  const record = await readRecord({ tenantId, assetId, env, fetchImpl });
  if (!record) {
    throw Object.assign(new Error("csm_resolution_not_found"), { statusCode: 404 });
  }
  const {
    view,
    composed,
    composer_version: composerVersion,
    marketplace_profile_version: marketplaceProfileVersion,
    legacy_public_projection: legacyPublicProjection
  } = composeResolutionView(record);
  const externalIdentitySupport = publicExternalIdentitySupport(record.external_identity_support);
  const verifiedOriginalObservationSupport = publicVerifiedOriginalObservationSupport(
    record.verified_original_observation_support
  );
  const publicView = attachExternalIdentitySupport(view, externalIdentitySupport);
  // If the stored title and the recomposed one disagree, the explanation does
  // not describe what shipped. Say so rather than presenting it as the trace.
  const storedTitle = String(record.output_title || "").trim();
  const drift = storedTitle && storedTitle !== composed.title;
  const ownerExecutionReceipt = publicCsmOwnerExecutionReceipt(record.owner_execution_receipt);
  return {
    ...publicView,
    // This is the only owner-execution projection exposed by the read route.
    // Raw provider/request ids and the full stored execution contract remain
    // server-side; the hash is independently recomputed from the DB value.
    owner_execution_receipt: ownerExecutionReceipt,
    ...(verifiedOriginalObservationSupport ? {
      verified_original_observation_support: verifiedOriginalObservationSupport
    } : {}),
    composer: {
      ...publicView.composer,
      composer_version: composerVersion,
      ...(legacyPublicProjection ? {} : {
        marketplace_profile_version: marketplaceProfileVersion
      }),
      stored_title: storedTitle || null,
      recomposed_matches_stored: !drift,
      // An operator must not be told a bracket was dropped for budget when the
      // shipped title was produced by different code.
      trace_reliable: !drift
    }
  };
}

export async function handleResolutionReviewRequest({
  tenantId, reviewerId, payload = {}, dependencies = {}, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const readRecord = dependencies.readRecord || readCsmResolutionRecord;
  const appendReview = dependencies.appendReview || appendCsmResolutionReview;
  const assetId = String(payload.asset_id || "").trim();
  if (!assetId) throw Object.assign(new Error("asset_id_required"), { statusCode: 400 });

  const record = await readRecord({ tenantId, assetId, env, fetchImpl });
  if (!record) throw Object.assign(new Error("csm_resolution_not_found"), { statusCode: 404 });
  const {
    view,
    fields,
    composed,
    composer_version: composerVersion,
    marketplace_profile_version: marketplaceProfileVersion,
    compose_corrected_title: composeCorrectedTitle
  } = composeResolutionView(record);
  const originalTitle = String(record.output_title || composed.title).trim();
  if (originalTitle !== composed.title) {
    throw Object.assign(new Error("csm_review_composer_replay_mismatch"), { statusCode: 409 });
  }
  const measurementSnapshot = buildReviewMeasurementSnapshot({
    view,
    composerVersion,
    marketplaceProfileVersion
  });

  const review = buildCsmResolutionReview({
    provenance: {
      asset_id: assetId,
      recognition_session_id: record.recognition_session_id,
      resolution_id: record.resolution_id,
      output_id: record.output_id,
      resolver_version: record.resolver_version || THIN_RESOLVER_VERSION,
      composer_version: composerVersion,
      view_version: CSM_RESOLUTION_VIEW_VERSION,
      reviewer_id: reviewerId,
      tenant_id: tenantId
    },
    verdict: payload.verdict,
    corrections: Array.isArray(payload.corrections) ? payload.corrections : [],
    originalFields: fields,
    originalTitle,
    // The ONLY way a corrected title comes into existence. A title in the
    // payload is ignored: parsing a reviewer's string back into fields is the
    // one thing this contract exists to prevent.
    recomposeTitle: composeCorrectedTitle,
    // Built from the server-replayed view. Any similarly named client payload
    // field is ignored and therefore cannot choose its own denominator.
    measurementSnapshot,
    reviewedAt: new Date().toISOString(),
    note: String(payload.note || "")
  });

  await appendReview({ tenantId, review, env, fetchImpl });
  return review;
}

export default async function handler(request, response) {
  instrumentProductionRequest(request, response, { api: "/api/csm-resolution-view" });
  bindProductionRequestContext(response, { route: "csm-resolution-view" });
    if (!["GET", "POST"].includes(request.method)) {
      return sendJson(response, 405, { error: "method_not_allowed" });
    }
    if (!enforceApiRateLimit(request, response, {
      scope: "csm_resolution_view",
      limit: 60,
      windowMs: 60_000,
      message: "Too many resolution view requests. Please try again shortly."
    })) return;

    let access;
    try {
      access = await requireTenantAccess(request, {
        // COS-42: reviewing canonical fields is a trusted reviewer/admin act,
        // not the writer workflow. WRITE_LISTING and READ_LISTING were not even
        // real constants -- they read as undefined, so the check asked for a
        // permission nobody has or everybody has depending on how the tenant
        // layer treats undefined. Named permissions now, and the write side is
        // one writers do not hold.
        permission: request.method === "POST"
          ? TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS
          : TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK
      });
      bindProductionRequestContext(response, access);
    } catch (error) {
      return sendJson(response, error?.statusCode || 503, publicTenantAuthError(error));
    }

    try {
      if (request.method === "GET") {
        const url = new URL(request.url, "http://localhost");
        const assetId = String(url.searchParams.get("asset_id") || "").trim();
        if (!assetId) return sendJson(response, 400, { error: "asset_id_required" });
        const view = await handleResolutionViewRequest({ tenantId: access.tenantId, assetId });
        return sendJson(response, 200, view);
      }
      const payload = await readJsonPayload(request);
      const review = await handleResolutionReviewRequest({
        tenantId: access.tenantId,
        reviewerId: access.userId,
        payload
      });
      return sendJson(response, 201, {
        schema_version: CSM_RESOLUTION_REVIEW_VERSION,
        revision_sha256: review.revision_sha256,
        corrected_title: review.corrected_title,
        verdict: review.verdict
      });
    } catch (error) {
      const status = error?.statusCode || 500;
      return sendJson(response, status, { error: String(error?.message || "internal_error") });
    }
}
