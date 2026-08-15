#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CSM_STAGE_LEGACY_CONTRACT_VERSION,
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  buildCsmStageRows, computeCsmPacketHashes
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  writeCsmStageRows, csmPersistenceEnabled, isCsmPersistenceConfigured,
  appendCsmResolutionReview,
  checkCsmPersistenceReadiness, readCsmResolutionRecord,
  writeCsmStagePacketAtomically,
  CSM_PRODUCT_PROJECTION_READINESS_RPC, CSM_PRODUCT_PROJECTION_VERSION,
  CSM_SUPABASE_REQUEST_TIMEOUT_MS,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
  THIN_REGISTRY_PAYLOAD_CONTRACT,
  THIN_REGISTRY_RELEASE_CONTRACT,
  THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT,
  THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  CSM_OWNER_EXECUTION_RECEIPT_KEYS,
  sealCsmOwnerExecutionReceipt
} from "../lib/listing/thin/csm-owner-execution-receipt.mjs";
import {
  FUTURE_CANONICAL_REQUEST_BUILDER_VERSION,
  FUTURE_CANONICAL_RESPONSE_PARSER_VERSION,
  TCG_GRAMMAR_CONTEXT_CANONICAL_REQUEST_BUILDER_VERSION,
  TCG_GRAMMAR_CONTEXT_CANONICAL_RESPONSE_PARSER_VERSION
} from "../lib/listing/thin/csm-provider-adapter.mjs";
import {
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  buildTcgFieldSourceAuthorityReceipt,
  buildTcgGrammarContextClaimReceipt
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";
import {
  buildCapturedE1aeResolutionReview,
  buildCsmResolutionReview,
  buildReviewMeasurementSnapshot,
  REVIEW_VERDICT
} from "../csm/contracts/resolution-review.mjs";
import { buildCsmResolutionView } from "../csm/contracts/resolution-view.mjs";

const FIELDS = {
  grammar: "standard", year: "2023", manufacturer: "Panini", product: "Prizm",
  subjects: ["Victor Wembanyama"], card_number: "136", serial: "25/49",
  surface_color: "Gold", parallel_family: "Prizm", parallel_exact: "",
  grade: "PSA 10", components: ["RC"], attributes: ["RC"], team: "Spurs",
  unreadable: [], low_confidence: [], lot_count: "", ip: "", language: ""
};

const composeActive = (fields) => composeFromCanonicalFields(fields, { features: {
  durable_lot_terminal_shared_only: true,
  publication_coverage: true
} });
const composed = composeActive(FIELDS);
const rows = buildCsmStageRows({
  tenantId: "tenant-1", recognitionSessionId: "session-1",
  fields: FIELDS, composed, title: composed.title, createdAt: "2026-08-01T00:00:00Z"
});
const legacyComposed = composeFromCanonicalFields(FIELDS);
const legacyRows = buildCsmStageRows({
  tenantId: "tenant-1", recognitionSessionId: "session-legacy",
  fields: FIELDS, composed: legacyComposed, title: legacyComposed.title,
  contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION,
  createdAt: "2026-08-01T00:00:00Z"
});

const TCG_WEB_RECEIPT = {
  schema_version: "founder-beta-web-receipt-v1",
  provider_request_count: 1,
  isolated_model_call_count: 0,
  provider_model: "gpt-5.6-luna",
  reasoning_effort: "low",
  web_search_used: false,
  web_search_call_count: 0,
  queries: [],
  urls: [],
  field_evidence: [],
  semantic_state_sha256: "d".repeat(64)
};
const TCG_OBSERVED_FIELDS = {
  ...FIELDS,
  grammar: "standard",
  year: "",
  manufacturer: "",
  product: "",
  set: "Trainer Gallery",
  subjects: ["Eternatus"],
  card_number: "TG22/TG30",
  serial: "",
  surface_color: "",
  parallel_family: "",
  components: [],
  attributes: [],
  team: "",
  grade: ""
};
const TCG_RESOLVED_FIELDS = { ...TCG_OBSERVED_FIELDS, grammar: "tcg" };
const tcgComposed = composeActive(TCG_RESOLVED_FIELDS);
const tcgFieldSources = [
  { field: "set", source_ids: ["original_image_1"] },
  { field: "card_number", source_ids: ["original_image_1"] }
];
const tcgSourceExecution = {
  operationPayloadSha256: "e".repeat(64),
  originalImageFingerprints: [`sha256:${"1".repeat(64)}`],
  recognitionImageFingerprints: [`sha256:${"1".repeat(64)}`],
  providerClientRequestId: "writer-tcg-client-request",
  providerResponseId: "writer-tcg-provider-response",
  tenantId: "tenant-1",
  recognitionSessionId: "session-1"
};
const tcgFieldSourceReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: tcgFieldSources,
  fields: TCG_OBSERVED_FIELDS,
  originalImageCount: 1,
  semanticStateSha256: TCG_WEB_RECEIPT.semantic_state_sha256,
  founderBetaWebReceipt: TCG_WEB_RECEIPT,
  sourceExecution: tcgSourceExecution
});
const tcgGrammarContextClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: TCG_OBSERVED_FIELDS,
  fieldSourceAuthorityReceipt: tcgFieldSourceReceipt
});
const tcgRows = buildCsmStageRows({
  tenantId: "tenant-1",
  recognitionSessionId: "session-1",
  fields: TCG_RESOLVED_FIELDS,
  observedFields: TCG_OBSERVED_FIELDS,
  composed: tcgComposed,
  title: tcgComposed.title,
  founderBetaWebReceipt: TCG_WEB_RECEIPT,
  setCardNameRelationReceipt: {
    schema_version: "set-card-name-relations-v1",
    set: {
      predicate: "CURRENT_CARD_MEMBER_OF_SET",
      value: "Trainer Gallery"
    },
    card_name: null
  },
  tcgFieldSourceAuthorityReceipt: tcgFieldSourceReceipt,
  tcgGrammarContextClaimReceipt,
  registryReleaseId: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
  contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  createdAt: "2026-08-15T00:00:00.000Z"
});
const rawTcgSourceExecution = {
  ...tcgSourceExecution,
  recognitionSessionId: "session-raw-tcg"
};
const rawTcgFieldSourceReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: tcgFieldSources,
  fields: TCG_RESOLVED_FIELDS,
  originalImageCount: 1,
  semanticStateSha256: TCG_WEB_RECEIPT.semantic_state_sha256,
  founderBetaWebReceipt: TCG_WEB_RECEIPT,
  sourceExecution: rawTcgSourceExecution
});
const rawTcgClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: TCG_RESOLVED_FIELDS,
  fieldSourceAuthorityReceipt: rawTcgFieldSourceReceipt
});
const rawTcgRows = buildCsmStageRows({
  tenantId: "tenant-1",
  recognitionSessionId: "session-raw-tcg",
  fields: TCG_RESOLVED_FIELDS,
  observedFields: TCG_RESOLVED_FIELDS,
  composed: tcgComposed,
  title: tcgComposed.title,
  founderBetaWebReceipt: TCG_WEB_RECEIPT,
  setCardNameRelationReceipt: {
    schema_version: "set-card-name-relations-v1",
    set: {
      predicate: "CURRENT_CARD_MEMBER_OF_SET",
      value: "Trainer Gallery"
    },
    card_name: null
  },
  tcgFieldSourceAuthorityReceipt: rawTcgFieldSourceReceipt,
  tcgGrammarContextClaimReceipt: rawTcgClaimReceipt,
  contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  createdAt: "2026-08-15T00:00:00.000Z"
});

function sessionPatchFor(stageRows) {
  return {
    csm_contract_version: stageRows.resolution.contract_version,
    csm_registry_release_id: stageRows.resolution.registry_release_id,
    csm_grammar: stageRows.resolution.grammar,
    csm_grammar_confidence: 0.8,
    recognition_pipeline_fingerprint: "a".repeat(64),
    csm_owner_versions: { model: "gpt-5.6-luna" },
    csm_recognition_stage_status: "COMPLETE",
    csm_resolution_stage_status: "COMPLETE",
    csm_composition_stage_status: "COMPLETE",
    ...stageRows.session_hashes
  };
}

function sessionPatchForV4(stageRows) {
  const sourceReceipt = stageRows.output.structured_output
    .tcg_field_source_authority_receipt;
  const owner = Object.fromEntries(
    CSM_OWNER_EXECUTION_RECEIPT_KEYS.map((key) => [key, null])
  );
  Object.assign(owner, {
    request_builder_version:
      TCG_GRAMMAR_CONTEXT_CANONICAL_REQUEST_BUILDER_VERSION,
    response_parser_version:
      TCG_GRAMMAR_CONTEXT_CANONICAL_RESPONSE_PARSER_VERSION,
    provider_client_request_id: tcgSourceExecution.providerClientRequestId,
    provider_response_id: tcgSourceExecution.providerResponseId,
    operation_payload_sha256: sourceReceipt.operation_payload_sha256,
    resolver: stageRows.resolution.resolver_version,
    composer: stageRows.output.composer_version,
    marketplace_profile: stageRows.output.marketplace_profile_version
  });
  return {
    ...sessionPatchFor(stageRows),
    recognition_pipeline_fingerprint: "b".repeat(64),
    csm_owner_versions: sealCsmOwnerExecutionReceipt(owner)
  };
}

function sessionPatchForV3Owner(stageRows) {
  const owner = Object.fromEntries(
    CSM_OWNER_EXECUTION_RECEIPT_KEYS.map((key) => [key, null])
  );
  Object.assign(owner, {
    request_builder_version: FUTURE_CANONICAL_REQUEST_BUILDER_VERSION,
    response_parser_version: FUTURE_CANONICAL_RESPONSE_PARSER_VERSION,
    resolver: stageRows.resolution.resolver_version,
    composer: stageRows.output.composer_version,
    marketplace_profile: stageRows.output.marketplace_profile_version
  });
  return {
    ...sessionPatchFor(stageRows),
    csm_owner_versions: sealCsmOwnerExecutionReceipt(owner)
  };
}

const ENV = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
  CSM_PERSISTENCE_ENABLED: "1"
};
const REGISTRY_RELEASE = {
  ...THIN_REGISTRY_RELEASE_CONTRACT,
  registry_payload: THIN_REGISTRY_PAYLOAD_CONTRACT
};
const EXTERNAL_REGISTRY_RELEASE = {
  ...THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
  registry_payload: THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT
};
const EXTERNAL_FORWARD_REGISTRY_RELEASE = {
  ...THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
  registry_payload: THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT
};
const TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ROW = {
  ...THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT,
  registry_payload: THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT
};
const REGISTRY_RELEASES = [
  REGISTRY_RELEASE, EXTERNAL_REGISTRY_RELEASE, EXTERNAL_FORWARD_REGISTRY_RELEASE,
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ROW
];
const PRODUCT_PROJECTION_READY = {
  ok: true,
  code: "csm_product_projection_ready",
  version: CSM_PRODUCT_PROJECTION_VERSION
};

// The structured-review transport repeats both hashes immediately before
// PostgREST. A mutated denominator or revision cannot cross the write boundary.
{
  const provenance = {
    asset_id: "review-asset", recognition_session_id: "review-session",
    resolution_id: "review-resolution", output_id: "review-output",
    resolver_version: "resolver-v1", composer_version: "composer-v1",
    view_version: "view-v1", reviewer_id: "owner-1", tenant_id: "tenant-1"
  };
  const measurementSnapshot = buildReviewMeasurementSnapshot({
    composerVersion: provenance.composer_version,
    view: {
      ...buildCsmResolutionView({
        fields: FIELDS,
        composed,
        assetId: provenance.asset_id,
        recognitionSessionId: provenance.recognition_session_id
      }),
      schema_version: provenance.view_version
    }
  });
  const review = buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.APPROVED,
    originalFields: { subjects: ["A"] }, originalTitle: "A",
    measurementSnapshot, reviewedAt: "2026-08-12T00:00:00.000Z"
  });
  let writes = 0;
  const fetchImpl = async (_url, init) => {
    writes += 1;
    assert.equal(JSON.parse(init.body)[0].measurement_snapshot_sha256,
      review.measurement_snapshot_sha256);
    return jsonResponse([review], 201);
  };
  await appendCsmResolutionReview({ tenantId: "tenant-1", review, env: ENV, fetchImpl });
  assert.equal(writes, 1);

  const tamperedSnapshot = structuredClone(review);
  tamperedSnapshot.measurement_snapshot.brackets[0].state = "ABSENT";
  await assert.rejects(
    appendCsmResolutionReview({ tenantId: "tenant-1", review: tamperedSnapshot, env: ENV, fetchImpl }),
    /integrity_snapshot_hash_mismatch/
  );
  const tamperedRevision = { ...review, note: "changed after review" };
  await assert.rejects(
    appendCsmResolutionReview({ tenantId: "tenant-1", review: tamperedRevision, env: ENV, fetchImpl }),
    /integrity_revision_hash_mismatch/
  );
  await assert.rejects(
    appendCsmResolutionReview({
      tenantId: "tenant-overwrite", review, env: ENV, fetchImpl
    }),
    /csm_review_tenant_mismatch/
  );
  const capturedReview = buildCapturedE1aeResolutionReview({
    provenance,
    verdict: REVIEW_VERDICT.APPROVED,
    originalFields: { subjects: ["A"] },
    originalTitle: "A",
    reviewedAt: "2026-08-12T00:00:00.000Z"
  });
  await assert.rejects(
    appendCsmResolutionReview({
      tenantId: "tenant-overwrite", review: capturedReview, env: ENV, fetchImpl
    }),
    /csm_review_tenant_mismatch/,
    "captured v1 revisions do not hash tenant, so the append seam must bind it"
  );
  assert.equal(writes, 1, "tampered reviews must fail before PostgREST");
}

const CSM_TABLES = [
  "csm_evidence_observations", "csm_bracket_candidates", "csm_candidate_evidence_links",
  "csm_identity_resolutions", "csm_resolved_brackets", "csm_marketplace_outputs"
];

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function atomicSuccessFor(stageRows) {
  return {
    ok: true,
    code: "inserted",
    status_code: 200,
    replayed: false,
    atomic: true,
    session_saved: true,
    written: {
      csm_evidence_observations: stageRows.evidence.length,
      csm_bracket_candidates: stageRows.candidates.length,
      csm_candidate_evidence_links: stageRows.links.length,
      csm_identity_resolutions: 1,
      csm_resolved_brackets: stageRows.resolved.length,
      csm_marketplace_outputs: 1
    }
  };
}

// Registry and post-registry probes share a bounded request contract. A body that
// never arrives is classified by phase instead of hanging before the paid
// provider boundary.
{
  let calls = 0;
  let clockMs = 0;
  const timedOut = await checkCsmPersistenceReadiness({
    env: ENV,
    requestTimeoutMs: 5,
    maximumDurationMs: 30,
    now: () => clockMs,
    sleep: async () => {},
    fetchImpl: async (url, init = {}) => {
      calls += 1;
      assert.ok(init.signal instanceof AbortSignal);
      if (String(url).includes("/csm_resolution_reviews?")) return jsonResponse([]);
      if (!String(url).includes("/rpc/")) return jsonResponse(REGISTRY_RELEASES);
      return {
        ok: true,
        status: 200,
        json: async () => {
          // Advance the injected monotonic clock and return the exact error
          // AbortSignal.timeout produces. No wall-clock timer participates in
          // this contract test, so a busy test runner cannot make it flaky.
          clockMs += 5;
          throw Object.assign(new Error("simulated_body_timeout"), { name: "TimeoutError" });
        }
      };
    }
  });
  assert.equal(timedOut.ready, false);
  assert.equal(timedOut.reason, "atomic_rpc_probe_timeout");
  assert.equal(calls, 8,
    "one bounded retry must repeat registry plus all concurrent post-registry probes");
  assert.equal(CSM_SUPABASE_REQUEST_TIMEOUT_MS, 5_000);
}

/** A small PostgREST-shaped store: enough to prove writes, retries and races. */
function fakeStore({ failOnceOn = "" } = {}) {
  const calls = [];
  const tables = Object.fromEntries(CSM_TABLES.map((table) => [table, new Map()]));
  const session = {
    id: "session-1",
    tenant_id: "tenant-1",
    csm_recognition_packet_sha256: null,
    csm_resolution_packet_sha256: null,
    csm_marketplace_packet_sha256: null,
    csm_recognition_stage_status: "NOT_STARTED",
    csm_resolution_stage_status: "NOT_STARTED",
    csm_composition_stage_status: "NOT_STARTED"
  };
  let failed = false;

  const fetchImpl = async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    const table = url.pathname.split("/").pop();
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ url: String(rawUrl), init, table, method });

    if (table === "v4_recognition_sessions") {
      if (method === "GET") return jsonResponse([session]);
      if (method === "PATCH") {
        const unclaimed = [
          "csm_recognition_packet_sha256",
          "csm_resolution_packet_sha256",
          "csm_marketplace_packet_sha256"
        ].every((key) => !session[key] && url.searchParams.get(key) === "is.null");
        if (!unclaimed) return jsonResponse([]);
        Object.assign(session, JSON.parse(init.body));
        return jsonResponse([session]);
      }
    }

    if (!tables[table]) return jsonResponse({ message: "unknown table" }, 404);
    if (method === "GET") {
      const found = [...tables[table].values()].filter((row) => (
        row.tenant_id === "tenant-1" && row.recognition_session_id === "session-1"
      ));
      return jsonResponse(found.slice(0, 1));
    }
    if (method === "POST") {
      if (failOnceOn === table && !failed) {
        failed = true;
        return new Response("forced failure", { status: 503 });
      }
      const payload = JSON.parse(init.body);
      const conflict = String(url.searchParams.get("on_conflict") || "id").split(",");
      const inserted = [];
      for (const row of payload) {
        const key = conflict.map((name) => JSON.stringify(row[name])).join("|");
        if (tables[table].has(key)) continue;
        tables[table].set(key, structuredClone(row));
        inserted.push(row);
      }
      return jsonResponse(inserted, 201);
    }
    return jsonResponse({ message: "unsupported method" }, 405);
  };

  return {
    calls,
    tables,
    session,
    fetchImpl,
    markComplete() {
      session.csm_recognition_stage_status = "COMPLETE";
      session.csm_resolution_stage_status = "COMPLETE";
      session.csm_composition_stage_status = "COMPLETE";
    },
    storedCount() {
      return Object.values(tables).reduce((sum, table) => sum + table.size, 0);
    }
  };
}

// Paid-call preflight: no model request should run before the migration and
// immutable Registry release are visible.
{
  const ready = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/csm_registry_releases")) {
        assert.equal(parsed.searchParams.get("id"), `in.(${[
          THIN_REGISTRY_RELEASE_CONTRACT.id,
          THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id,
          THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT.id,
          THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT.id
        ].join(",")})`);
        assert.equal(parsed.searchParams.get("limit"), "4");
      }
      if (String(url).includes("/csm_resolution_reviews?")) return jsonResponse([]);
      if (String(url).endsWith(`/rpc/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`)) {
        return jsonResponse(PRODUCT_PROJECTION_READY);
      }
      return String(url).includes("/rpc/")
        ? jsonResponse({ ok: false, code: "missing_csm_stage_row_identity", status_code: 400 })
        : jsonResponse(REGISTRY_RELEASES);
    }
  });
  assert.equal(ready.ready, true);
  const projectionMissing = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async (url) => {
      if (String(url).includes("/csm_resolution_reviews?")) return jsonResponse([]);
      return String(url).endsWith(`/rpc/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`)
        ? jsonResponse({ message: "function missing" }, 404)
        : String(url).includes("/rpc/")
          ? jsonResponse({ ok: false, code: "missing_csm_stage_row_identity", status_code: 400 })
          : jsonResponse(REGISTRY_RELEASES);
    }
  });
  assert.deepEqual(projectionMissing, {
    ready: false,
    reason: "product_projection_probe_404"
  });
  const missing = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async () => jsonResponse([])
  });
  assert.equal(missing.ready, false);
  assert.equal(missing.reason, "registry_release_missing");
  const forwardMissing = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async () => jsonResponse([
      REGISTRY_RELEASE, EXTERNAL_REGISTRY_RELEASE,
      TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ROW
    ])
  });
  assert.equal(forwardMissing.ready, false);
  assert.equal(forwardMissing.reason, "registry_release_missing",
    "readiness must require the additive v3 forward-reader Registry row");
  const tcgGrammarContextMissing = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async () => jsonResponse([
      REGISTRY_RELEASE, EXTERNAL_REGISTRY_RELEASE, EXTERNAL_FORWARD_REGISTRY_RELEASE
    ])
  });
  assert.equal(tcgGrammarContextMissing.ready, false);
  assert.equal(tcgGrammarContextMissing.reason, "registry_release_missing",
    "readiness must require the additive TCG Grammar context Registry row");
  const mismatched = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async () => jsonResponse([{
      ...REGISTRY_RELEASE, content_sha256: "0".repeat(64)
    }, EXTERNAL_REGISTRY_RELEASE, EXTERNAL_FORWARD_REGISTRY_RELEASE,
    TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ROW])
  });
  assert.equal(mismatched.ready, false);
  assert.equal(mismatched.reason, "registry_release_contract_mismatch");
  for (const registryPayload of [
    { ...THIN_REGISTRY_PAYLOAD_CONTRACT, external_catalog: true },
    { ...THIN_REGISTRY_PAYLOAD_CONTRACT, unexpected: true },
    { mode: THIN_REGISTRY_PAYLOAD_CONTRACT.mode }
  ]) {
    const payloadMismatch = await checkCsmPersistenceReadiness({
      env: ENV,
      fetchImpl: async () => jsonResponse([{
        ...REGISTRY_RELEASE,
        registry_payload: registryPayload
      }, EXTERNAL_REGISTRY_RELEASE, EXTERNAL_FORWARD_REGISTRY_RELEASE,
      TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ROW])
    });
    assert.equal(payloadMismatch.ready, false);
    assert.equal(payloadMismatch.reason, "registry_release_contract_mismatch");
  }
  const tcgPayloadMismatch = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async () => jsonResponse([
      REGISTRY_RELEASE, EXTERNAL_REGISTRY_RELEASE, EXTERNAL_FORWARD_REGISTRY_RELEASE,
      {
        ...TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ROW,
        registry_payload: {
          ...THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT,
          provider_calls_added: 1
        }
      }
    ])
  });
  assert.equal(tcgPayloadMismatch.ready, false);
  assert.equal(tcgPayloadMismatch.reason, "registry_release_contract_mismatch");
  let registryAttempts = 0;
  const recovered = await checkCsmPersistenceReadiness({
    env: ENV,
    fetchImpl: async (url) => {
      if (String(url).includes("/csm_resolution_reviews?")) return jsonResponse([]);
      if (String(url).includes("/rpc/")) {
        if (String(url).endsWith(`/rpc/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`)) {
          return jsonResponse(PRODUCT_PROJECTION_READY);
        }
        return jsonResponse({ ok: false, code: "missing_csm_stage_row_identity", status_code: 400 });
      }
      registryAttempts += 1;
      if (registryAttempts === 1) throw new Error("transient network failure");
      return jsonResponse(REGISTRY_RELEASES);
    }
  });
  assert.equal(recovered.ready, true);
  assert.equal(registryAttempts, 2);
}

// First attempt claims its packet before child writes, then follows FK order.
{
  const store = fakeStore();
  const result = await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(store.calls.every(({ init }) => init.redirect === "error"), true,
    "every CSM persistence request must reject redirects carrying the server-only apikey");
  assert.equal(result.atomic, false, "six REST writes must not masquerade as a transaction");
  const claimIndex = store.calls.findIndex((call) => call.table === "v4_recognition_sessions" && call.method === "PATCH");
  const childWrites = store.calls.filter((call) => CSM_TABLES.includes(call.table) && call.method === "POST");
  assert.ok(claimIndex >= 0);
  assert.ok(store.calls.indexOf(childWrites[0]) > claimIndex, "packet claim must precede the first child write");
  assert.deepEqual(childWrites.map((call) => call.table), CSM_TABLES);
  assert.ok(childWrites.findIndex((call) => call.table === "csm_candidate_evidence_links")
    > childWrites.findIndex((call) => call.table === "csm_evidence_observations"));
  assert.ok(childWrites.findIndex((call) => call.table === "csm_resolved_brackets")
    > childWrites.findIndex((call) => call.table === "csm_identity_resolutions"));
  assert.equal(Object.values(result.written).reduce((sum, count) => sum + count, 0), store.storedCount());
}

// Production transport is one RPC call. Its counts and immutable-retry result
// are accepted only from the transaction-backed response contract.
{
  let requestBody = null;
  const legacySessionPatch = sessionPatchFor(rows);
  const atomic = await writeCsmStagePacketAtomically(rows, {
    sessionPatch: legacySessionPatch,
    env: ENV,
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/rpc\/persist_csm_stage_packet_v1$/);
      requestBody = JSON.parse(init.body);
      return jsonResponse({
        ok: true,
        code: "inserted",
        status_code: 200,
        replayed: false,
        atomic: true,
        session_saved: true,
        written: {
          csm_evidence_observations: rows.evidence.length,
          csm_bracket_candidates: rows.candidates.length,
          csm_candidate_evidence_links: rows.links.length,
          csm_identity_resolutions: 1,
          csm_resolved_brackets: rows.resolved.length,
          csm_marketplace_outputs: 1
        }
      });
    }
  });
  assert.equal(atomic.ok, true);
  assert.equal(atomic.atomic, true);
  assert.equal(atomic.session.saved, true);
  assert.equal(atomic.written.csm_evidence_observations, rows.evidence.length);
  assert.equal(requestBody.p_tenant_id, "tenant-1");
  assert.equal(requestBody.p_recognition_session_id, "session-1");
  assert.deepEqual(requestBody.p_packet, rows,
    "v3 packet bytes must cross the Supabase transport unchanged");
  assert.deepEqual(requestBody.p_session_patch, legacySessionPatch,
    "v3 session patch bytes must cross the Supabase transport unchanged");

  let transientCalls = 0;
  const recovered = await writeCsmStagePacketAtomically(rows, {
    sessionPatch: sessionPatchFor(rows),
    env: ENV,
    sleep: async () => {},
    fetchImpl: async () => {
      transientCalls += 1;
      if (transientCalls === 1) return jsonResponse({ error: "temporary" }, 503);
      return jsonResponse({
        ok: true,
        code: "exact_replay",
        status_code: 200,
        replayed: true,
        atomic: true,
        session_saved: false,
        written: Object.fromEntries(CSM_TABLES.map((table) => [table, 0]))
      });
    }
  });
  assert.equal(transientCalls, 2);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.replayed, true,
    "a lost/failed atomic receipt must retry the same packet, never the model");

  const conflict = await writeCsmStagePacketAtomically(rows, {
    sessionPatch: sessionPatchFor(rows),
    env: ENV,
    fetchImpl: async () => jsonResponse({
      ok: false, code: "immutable_session_conflict", status_code: 409
    })
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "immutable_session_conflict");
  assert.equal(conflict.statusCode, 409);

  const invalidCounts = await writeCsmStagePacketAtomically(rows, {
    sessionPatch: sessionPatchFor(rows),
    env: ENV,
    fetchImpl: async () => jsonResponse({
      ok: true, code: "inserted", atomic: true, session_saved: true, written: {}
    })
  });
  assert.equal(invalidCounts.ok, false);
  assert.equal(invalidCounts.code, "csm_atomic_rpc_invalid_counts");
}

// Stage-v4 is a separate exact transport contract. Its private receipts stay
// in the packet, while the session/owner tuple must identify the same writer;
// a v3 patch cannot silently label a committed v4 packet.
{
  const validPatch = sessionPatchForV4(tcgRows);
  let calls = 0;
  const inserted = await writeCsmStagePacketAtomically(tcgRows, {
    sessionPatch: validPatch,
    env: ENV,
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.p_session_patch.csm_contract_version,
        CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION);
      assert.deepEqual(
        body.p_packet.output.structured_output.tcg_field_source_authority_receipt,
        tcgFieldSourceReceipt
      );
      assert.deepEqual(
        body.p_packet.output.structured_output.tcg_grammar_context_claim_receipt,
        tcgGrammarContextClaimReceipt
      );
      return jsonResponse(atomicSuccessFor(tcgRows));
    }
  });
  assert.equal(inserted.ok, true);
  assert.equal(calls, 1);

  assert.equal(rawTcgClaimReceipt.status, "NOT_REQUIRED");
  const notRequired = await writeCsmStagePacketAtomically(rawTcgRows, {
    sessionPatch: sessionPatchForV4(rawTcgRows),
    env: ENV,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.p_packet.output.structured_output
        .tcg_grammar_context_claim_receipt.status, "NOT_REQUIRED");
      return jsonResponse(atomicSuccessFor(rawTcgRows));
    }
  });
  assert.equal(notRequired.ok, true,
    "NOT_REQUIRED keeps the ordinary v4 resolution tuple executable");

  const downgradedPatch = {
    ...validPatch,
    csm_contract_version: "csm-stage-shadow-v3",
    csm_registry_release_id: THIN_REGISTRY_RELEASE_CONTRACT.id,
    csm_grammar: "NON_TCG"
  };
  const downgraded = await writeCsmStagePacketAtomically(tcgRows, {
    sessionPatch: downgradedPatch,
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(atomicSuccessFor(tcgRows));
    }
  });
  assert.equal(downgraded.ok, false);
  assert.equal(downgraded.code, "invalid_csm_session_patch");
  assert.equal(calls, 1, "a downgraded v4 patch must fail before the RPC");

  const {
    owner_execution_receipt_version: _ownerVersion,
    owner_execution_receipt_sha256: _ownerSha256,
    ...ownerPayload
  } = validPatch.csm_owner_versions;
  const staleOwnerPatch = {
    ...validPatch,
    csm_owner_versions: sealCsmOwnerExecutionReceipt({
      ...ownerPayload,
      response_parser_version: "canonical-output-v5-web-receipt-outcome"
    })
  };
  const staleOwner = await writeCsmStagePacketAtomically(tcgRows, {
    sessionPatch: staleOwnerPatch,
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(atomicSuccessFor(tcgRows));
    }
  });
  assert.equal(staleOwner.ok, false);
  assert.equal(staleOwner.code, "invalid_csm_session_patch");
  assert.equal(calls, 1, "a v3 parser owner receipt must not label v4 rows");

  const v5OwnerPatch = {
    ...validPatch,
    csm_owner_versions: sessionPatchForV3Owner(tcgRows).csm_owner_versions
  };
  const v5OwnerOnV4 = await writeCsmStagePacketAtomically(tcgRows, {
    sessionPatch: v5OwnerPatch,
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(atomicSuccessFor(tcgRows));
    }
  });
  assert.equal(v5OwnerOnV4.ok, false);
  assert.equal(v5OwnerOnV4.code, "invalid_csm_session_patch");
  assert.equal(calls, 1, "an exact v5/request-v2 owner cannot carry v4 authority");

  const v5OwnerOnLegacy = await writeCsmStagePacketAtomically(legacyRows, {
    sessionPatch: {
      ...sessionPatchFor(legacyRows),
      csm_owner_versions: sessionPatchForV3Owner(legacyRows).csm_owner_versions
    },
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(atomicSuccessFor(legacyRows));
    }
  });
  assert.equal(v5OwnerOnLegacy.ok, false);
  assert.equal(v5OwnerOnLegacy.code, "invalid_csm_session_patch");
  assert.equal(calls, 1, "a v5/request-v2 owner must remain exact stage-v3");

  const v6OwnerOnV3 = await writeCsmStagePacketAtomically(rows, {
    sessionPatch: {
      ...sessionPatchFor(rows),
      csm_owner_versions: validPatch.csm_owner_versions
    },
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(atomicSuccessFor(rows));
    }
  });
  assert.equal(v6OwnerOnV3.ok, false);
  assert.equal(v6OwnerOnV3.code, "invalid_csm_session_patch");
  assert.equal(calls, 1, "a v6/request-v3 owner must remain stage-v4");

  const receiptMissing = structuredClone(tcgRows);
  delete receiptMissing.output.structured_output.tcg_grammar_context_claim_receipt;
  const missing = await writeCsmStagePacketAtomically(receiptMissing, {
    sessionPatch: validPatch,
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(atomicSuccessFor(receiptMissing));
    }
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "tcg_grammar_context_claim_receipt_missing");
  assert.equal(calls, 1);

  const forgedV3 = structuredClone(rows);
  forgedV3.output.structured_output.tcg_field_source_authority_receipt =
    tcgFieldSourceReceipt;
  forgedV3.output.structured_output.tcg_grammar_context_claim_receipt =
    tcgGrammarContextClaimReceipt;
  const forged = await writeCsmStagePacketAtomically(forgedV3, {
    sessionPatch: sessionPatchFor(forgedV3),
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(atomicSuccessFor(forgedV3));
    }
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.code, "tcg_grammar_context_receipt_outside_contract");
  assert.equal(calls, 1);

  const nonAtomic = await writeCsmStageRows(tcgRows, {
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse([]);
    }
  });
  assert.equal(nonAtomic.ok, false);
  assert.equal(nonAtomic.code, "csm_v4_requires_atomic_session_patch");
  assert.equal(calls, 1, "v4 cannot enter the hash-only legacy transport");
}

// Durable readback must reconstruct the complete v4 packet before exposing a
// canonical payload. Session downgrade, owner downgrade, or a dropped receipt
// makes the read fail closed instead of returning a v3-looking trace.
{
  const stageRowsForExecution = (sourceExecution) => {
    const sourceReceipt = buildTcgFieldSourceAuthorityReceipt({
      fieldSources: tcgFieldSources,
      fields: TCG_OBSERVED_FIELDS,
      originalImageCount: 1,
      semanticStateSha256: TCG_WEB_RECEIPT.semantic_state_sha256,
      founderBetaWebReceipt: TCG_WEB_RECEIPT,
      sourceExecution
    });
    const claimReceipt = buildTcgGrammarContextClaimReceipt({
      fields: TCG_OBSERVED_FIELDS,
      fieldSourceAuthorityReceipt: sourceReceipt
    });
    return buildCsmStageRows({
      tenantId: "tenant-1",
      recognitionSessionId: "session-1",
      fields: TCG_RESOLVED_FIELDS,
      observedFields: TCG_OBSERVED_FIELDS,
      composed: tcgComposed,
      title: tcgComposed.title,
      founderBetaWebReceipt: TCG_WEB_RECEIPT,
      setCardNameRelationReceipt: {
        schema_version: "set-card-name-relations-v1",
        set: {
          predicate: "CURRENT_CARD_MEMBER_OF_SET",
          value: "Trainer Gallery"
        },
        card_name: null
      },
      tcgFieldSourceAuthorityReceipt: sourceReceipt,
      tcgGrammarContextClaimReceipt: claimReceipt,
      registryReleaseId: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
      contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
      createdAt: "2026-08-15T00:00:00.000Z"
    });
  };
  const donorResponseRows = stageRowsForExecution({
    ...tcgSourceExecution,
    providerResponseId: "writer-tcg-provider-response-donor"
  });
  const derivedRecognitionRows = stageRowsForExecution({
    ...tcgSourceExecution,
    recognitionImageFingerprints: [`sha256:${"3".repeat(64)}`]
  });
  const readV4 = async ({
    stageRows = tcgRows,
    sessionPatch = null,
    mutateSession = (value) => value,
    mutateOutput = (value) => value,
    mutateResolution = (value) => value
  } = {}) => {
    const patch = sessionPatch || sessionPatchForV4(stageRows);
    const session = mutateSession({
      id: stageRows.resolution.recognition_session_id,
      tenant_id: stageRows.resolution.tenant_id,
      asset_id: "asset-tcg-v4",
      created_at: "2026-08-15T00:00:00.000Z",
      identity_snapshot: {
        expected_original_count: 1,
        image_references: [{
          image_id: "original-1",
          image_role: "front_original",
          content_sha256: "1".repeat(64),
          derived: false
        }]
      },
      request_summary: {
        recognition_input: [{
          image_role: "front_original",
          read: "original"
        }]
      },
      ...patch
    });
    const output = mutateOutput(structuredClone(stageRows.output));
    const resolution = mutateResolution(structuredClone(stageRows.resolution));
    return readCsmResolutionRecord({
      tenantId: "tenant-1",
      assetId: "asset-tcg-v4",
      env: ENV,
      fetchImpl: async (rawUrl) => {
        const table = new URL(String(rawUrl)).pathname.split("/").pop();
        if (table === "v4_recognition_sessions") return jsonResponse([session]);
        if (table === "csm_marketplace_outputs") return jsonResponse([output]);
        if (table === "csm_identity_resolutions") {
          return jsonResponse([resolution]);
        }
        if (table === "csm_resolved_brackets") return jsonResponse(stageRows.resolved);
        if (table === "csm_evidence_observations") return jsonResponse(stageRows.evidence);
        if (table === "csm_bracket_candidates") return jsonResponse(stageRows.candidates);
        if (table === "csm_candidate_evidence_links") return jsonResponse(stageRows.links);
        return jsonResponse({ message: `unexpected ${table}` }, 404);
      }
    });
  };

  const record = await readV4();
  assert.deepEqual(
    record.canonical_payload.tcg_field_source_authority_receipt,
    tcgFieldSourceReceipt
  );
  assert.deepEqual(
    record.canonical_payload.tcg_grammar_context_claim_receipt,
    tcgGrammarContextClaimReceipt
  );
  assert.equal(record.replay_rows.output.contract_version,
    CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION);
  assert.equal(record.owner_execution_receipt.version,
    "csm-owner-execution-receipt-v1");
  assert.equal(record.tcg_grammar_context_source_execution_verified, true);

  const derivedRecord = await readV4({
    stageRows: derivedRecognitionRows,
    mutateSession: (value) => ({
      ...value,
      identity_snapshot: {
        expected_original_count: 1,
        image_references: [
          ...value.identity_snapshot.image_references,
          {
            image_id: "derived-1",
            image_role: "readability_derived",
            content_sha256: "3".repeat(64),
            derived: true,
            source_image_id: "original-1"
          }
        ]
      },
      request_summary: {
        recognition_input: [{
          image_role: "front_original",
          read: "readability_derived"
        }]
      }
    })
  });
  assert.equal(derivedRecord.tcg_grammar_context_source_execution_verified, true);

  await assert.rejects(
    readV4({ stageRows: donorResponseRows }),
    /csm_tcg_grammar_context_readback_invalid/,
    "same-value rows from another provider response cannot reuse this owner"
  );

  await assert.rejects(
    readV4({
      stageRows: legacyRows,
      sessionPatch: sessionPatchForV3Owner(legacyRows)
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );

  await assert.rejects(
    readV4({
      mutateSession: (value) => ({
        ...value,
        csm_contract_version: "csm-stage-shadow-v3"
      })
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
  await assert.rejects(
    readV4({
      mutateSession: (value) => ({
        ...value,
        identity_snapshot: {
          ...value.identity_snapshot,
          image_references: value.identity_snapshot.image_references.map(
            (reference) => ({ ...reference, content_sha256: "2".repeat(64) })
          )
        }
      })
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
  await assert.rejects(
    readV4({
      mutateSession: (value) => ({
        ...value,
        request_summary: {
          recognition_input: [{
            image_role: "front_original",
            read: "readability_derived"
          }]
        }
      })
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
  await assert.rejects(
    readV4({
      mutateSession: (value) => {
        const {
          owner_execution_receipt_version: _version,
          owner_execution_receipt_sha256: _sha256,
          ...payload
        } = value.csm_owner_versions;
        return {
          ...value,
          csm_owner_versions: sealCsmOwnerExecutionReceipt({
            ...payload,
            provider_response_id: "writer-tcg-provider-response-other"
          })
        };
      }
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
  for (const [label, ownerMutation] of [
    ["operation payload", { operation_payload_sha256: "f".repeat(64) }],
    ["provider client request", {
      provider_client_request_id: "writer-tcg-client-request-other"
    }]
  ]) {
    await assert.rejects(
      readV4({
        mutateSession: (value) => {
          const {
            owner_execution_receipt_version: _version,
            owner_execution_receipt_sha256: _sha256,
            ...payload
          } = value.csm_owner_versions;
          return {
            ...value,
            csm_owner_versions: sealCsmOwnerExecutionReceipt({
              ...payload,
              ...ownerMutation
            })
          };
        }
      }),
      /csm_tcg_grammar_context_readback_invalid/,
      `${label} must remain bound to the source authority receipt`
    );
  }
  await assert.rejects(
    readV4({
      mutateSession: (value) => ({ ...value, id: "session-cross-splice" })
    }),
    /csm_tcg_grammar_context_readback_invalid/,
    "a sealed authority bundle cannot move to another recognition session"
  );
  await assert.rejects(
    readV4({
      mutateSession: (value) => ({
        ...value,
        csm_contract_version: "csm-stage-shadow-v3"
      }),
      mutateOutput: (value) => ({
        ...value,
        contract_version: "csm-stage-shadow-v3"
      }),
      mutateResolution: (value) => ({
        ...value,
        contract_version: "csm-stage-shadow-v3"
      })
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
  await assert.rejects(
    readV4({
      mutateOutput: (value) => ({
        ...value,
        contract_version: "csm-stage-shadow-v3"
      })
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
  await assert.rejects(
    readV4({
      mutateSession: (value) => {
        const {
          owner_execution_receipt_version: _version,
          owner_execution_receipt_sha256: _sha256,
          ...payload
        } = value.csm_owner_versions;
        return {
          ...value,
          csm_owner_versions: sealCsmOwnerExecutionReceipt({
            ...payload,
            response_parser_version: "canonical-output-v5-web-receipt-outcome"
          })
        };
      }
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
  await assert.rejects(
    readV4({
      mutateOutput: (value) => {
        delete value.structured_output.tcg_grammar_context_claim_receipt;
        return value;
      }
    }),
    /csm_tcg_grammar_context_readback_invalid/
  );
}

// The paid result's atomic persistence receipt is bounded through response
// body consumption, retried with the same packet, and returns a distinct
// timeout code when the bounded attempts are exhausted.
{
  let calls = 0;
  let clockMs = 0;
  const timedOut = await writeCsmStagePacketAtomically(rows, {
    sessionPatch: sessionPatchFor(rows),
    env: ENV,
    maximumAttempts: 2,
    requestTimeoutMs: 5,
    maximumDurationMs: 30,
    now: () => clockMs,
    sleep: async () => {},
    fetchImpl: async (url, init = {}) => {
      calls += 1;
      assert.match(String(url), /\/rpc\/persist_csm_stage_packet_v1$/);
      assert.ok(init.signal instanceof AbortSignal);
      return {
        ok: true,
        status: 200,
        text: async () => {
          clockMs += 5;
          throw Object.assign(new Error("simulated_body_timeout"), { name: "TimeoutError" });
        }
      };
    }
  });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.code, "csm_atomic_rpc_timeout");
  assert.equal(timedOut.failedTable, "persist_csm_stage_packet_v1");
  assert.equal(calls, 2);
}

// Idempotency targets match the migration, and insert counts come from the
// returned representation rather than from payload length.
{
  const store = fakeStore();
  await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  const posts = store.calls.filter((call) => CSM_TABLES.includes(call.table) && call.method === "POST");
  for (const call of posts) {
    assert.match(call.init.headers.prefer, /ignore-duplicates/);
    assert.match(call.init.headers.prefer, /return=representation/);
    assert.ok(new URL(call.url).searchParams.get("on_conflict"));
  }
  const byTable = Object.fromEntries(posts.map((call) => [
    call.table, new URL(call.url).searchParams.get("on_conflict")
  ]));
  const sql = readFileSync(new URL(
    "../supabase/migrations/20260801094353_csm_atomic_stage_packet_v1.sql", import.meta.url
  ), "utf8");
  assert.match(sql, /insert into public\.csm_registry_releases[\s\S]*?'registry_thin_sem_v25'/,
    "the Registry seed must live in the new additive migration");
  const manifestBlock = sql.match(/select \* from \(values([\s\S]*?)\) as primary_keys/)?.[1] || "";
  const primaryKeys = Object.fromEntries([...manifestBlock.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)]
    .map((match) => [match[1], match[2]]));
  assert.equal(Object.keys(primaryKeys).length, CSM_TABLES.length,
    "the additive migration must assert every CSM table's real primary key");
  for (const [table, conflict] of Object.entries(byTable)) {
    assert.equal(conflict, primaryKeys[table]);
  }
}

// Exact completed retry: no child request, no fictitious inserts.
{
  const store = fakeStore();
  const first = await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(first.ok, true);
  store.markComplete();
  const beforeCalls = store.calls.length;
  const beforeRows = store.storedCount();
  const retry = await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(retry.ok, true);
  assert.equal(retry.replayed, true);
  assert.equal(retry.code, "exact_replay");
  assert.deepEqual(Object.values(retry.written), [0, 0, 0, 0, 0, 0]);
  assert.equal(store.storedCount(), beforeRows);
  assert.deepEqual(store.calls.slice(beforeCalls).map((call) => call.method), ["GET"]);
}

// P0 regression: Victor -> LeBron under the SAME session is a changed attempt,
// not a retry. It must conflict before a child write and preserve Victor rows.
{
  const store = fakeStore();
  await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  store.markComplete();
  const lebronFields = { ...FIELDS, subjects: ["LeBron James"], team: "Lakers" };
  const lebronComposed = composeActive(lebronFields);
  const lebronRows = buildCsmStageRows({
    tenantId: "tenant-1", recognitionSessionId: "session-1",
    fields: lebronFields, composed: lebronComposed, title: lebronComposed.title,
    createdAt: "2026-08-01T00:00:00Z"
  });
  assert.notEqual(
    rows.candidates.find((row) => row.bracket === "subject").id,
    lebronRows.candidates.find((row) => row.bracket === "subject").id,
    "content/version-derived ids should differ, though the session hash remains authoritative"
  );
  const beforeCalls = store.calls.length;
  const beforeRows = store.storedCount();
  const changed = await writeCsmStageRows(lebronRows, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(changed.ok, false);
  assert.equal(changed.code, "immutable_session_conflict");
  assert.equal(changed.statusCode, 409);
  assert.equal(store.storedCount(), beforeRows);
  assert.deepEqual(store.calls.slice(beforeCalls).map((call) => call.method), ["GET"]);
}

// A non-atomic partial failure is repairable only by the exact reserved
// packet. Ignored duplicates count as zero; missing downstream rows count as
// their actual inserts.
{
  const store = fakeStore({ failOnceOn: "csm_identity_resolutions" });
  const failed = await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(failed.ok, false);
  assert.equal(failed.failedTable, "csm_identity_resolutions");
  assert.ok(failed.written.csm_evidence_observations > 0);
  const resumed = await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.written.csm_evidence_observations, 0);
  assert.equal(resumed.written.csm_bracket_candidates, 0);
  assert.equal(resumed.written.csm_candidate_evidence_links, 0);
  assert.equal(resumed.written.csm_identity_resolutions, 1);
  assert.ok(resumed.written.csm_resolved_brackets > 0);
  assert.equal(resumed.written.csm_marketplace_outputs, 1);
}

// Legacy partial rows without a reserved packet are unknowable, so fail
// closed rather than adopting or mixing them.
{
  const store = fakeStore();
  store.tables.csm_bracket_candidates.set("legacy", {
    id: "legacy", tenant_id: "tenant-1", recognition_session_id: "session-1"
  });
  const result = await writeCsmStageRows(rows, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, "csm_unclaimed_partial_state");
  assert.equal(store.calls.some((call) => call.method === "PATCH"), false);
  assert.equal(store.calls.some((call) => call.method === "POST"), false);
}

// The writer recomputes hashes from the rows; a stale/tampered caller-supplied
// marker cannot make changed content look like an exact replay.
{
  const store = fakeStore();
  const tampered = structuredClone(rows);
  tampered.output.title = "Different title under stale hashes";
  const result = await writeCsmStageRows(tampered, { env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_csm_packet_hashes");
  assert.equal(result.statusCode, 400);
  assert.equal(store.calls.length, 0);

  const brokenLineage = structuredClone(rows);
  brokenLineage.resolution.recognition_packet_sha256 = "f".repeat(64);
  brokenLineage.session_hashes = computeCsmPacketHashes(brokenLineage);
  const lineageResult = await writeCsmStageRows(brokenLineage, {
    env: ENV, fetchImpl: store.fetchImpl
  });
  assert.equal(lineageResult.ok, false);
  assert.equal(lineageResult.code, "csm_packet_lineage_hash_mismatch");
  assert.equal(store.calls.length, 0);
}

// Off by default; local evaluation remains independent from Supabase.
{
  assert.equal(csmPersistenceEnabled({}), false);
  const store = fakeStore();
  const disabled = await writeCsmStageRows(rows, {
    env: { ...ENV, CSM_PERSISTENCE_ENABLED: "" }, fetchImpl: store.fetchImpl
  });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.skipped, "disabled");
  assert.equal(store.calls.length, 0);

  const unconfigured = await writeCsmStageRows(rows, {
    env: { CSM_PERSISTENCE_ENABLED: "1" }, fetchImpl: store.fetchImpl
  });
  assert.equal(unconfigured.ok, true);
  assert.equal(unconfigured.skipped, "unconfigured");
  assert.equal(store.calls.length, 0);
  assert.equal(isCsmPersistenceConfigured({}), false);
  assert.equal(isCsmPersistenceConfigured({
    SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x"
  }), true);
}

process.stdout.write("csm supabase writer: ok\n");
