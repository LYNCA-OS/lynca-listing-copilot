#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  persistPreparedCanonicalListingPath,
  prepareCanonicalListingPath,
  runPersistedCanonicalListingPath
} from "../lib/listing/thin/csm-orchestration.mjs";
import { writeCsmStageRows } from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  computeCsmPacketHashes,
  THIN_COMPOSER_VERSION_V1
} from "../lib/listing/thin/csm-persistence.mjs";
import { patchSupabaseRow } from "../lib/supabase-rest.mjs";

const enabledEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  CSM_PERSISTENCE_ENABLED: "1"
};

function providerFor(fields) {
  return async (request) => {
    assert.equal(request.model, "gpt-5.6-luna");
    // `low` since 2026-08-03 (founder). The tier is the shipped one, so the
    // expectation moves rather than the behaviour: this assertion was written
    // against the superseded default.
    assert.equal(request.reasoning.effort, "low");
    return new Response(JSON.stringify({
      id: "resp_csm_trace",
      output_text: JSON.stringify(fields),
      reasoning: { effort: "low" },
      usage: { input_tokens: 100, output_tokens: 30 }
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_csm_trace" }
    });
  };
}

function recorder({ failTable = "" } = {}) {
  const tables = [];
  const fetchImpl = async (url, init = {}) => {
    const table = new URL(url).pathname.split("/").pop();
    tables.push(table);
    return failTable === table
      ? new Response("forced failure", { status: 503 })
      : new Response(init.body || "[]", {
        status: 201, headers: { "content-type": "application/json" }
      });
  };
  return { tables, fetchImpl };
}

const unclaimedWriterOptions = {
  readSessionState: async ({ tenantId, recognitionSessionId }) => ({
    id: recognitionSessionId,
    tenant_id: tenantId,
    csm_recognition_packet_sha256: null,
    csm_resolution_packet_sha256: null,
    csm_marketplace_packet_sha256: null,
    csm_recognition_stage_status: "NOT_STARTED",
    csm_resolution_stage_status: "NOT_STARTED",
    csm_composition_stage_status: "NOT_STARTED"
  }),
  claimSession: async () => ({ claimed: true }),
  readExistingRows: async () => []
};

const common = {
  year: "2025", manufacturer: "", product: "Pokemon", set: "Mega Brave",
  subjects: ["Mega Absol Ex"], team: "", card_name: "", release_variant: "",
  surface_color: "", parallel_family: "", parallel_exact: "",
  descriptive_rarity: "Special Art Rare", card_number: "089/063", serial: "",
  attributes: [], grade: "CGC 10", grammar: "tcg", lot_count: "",
  language: "JP", unreadable: [], low_confidence: []
};

// PostgREST match filters are operators, not raw values. This reproduces the
// production failure that previously emitted `tenant_id=tenant-legacy`.
{
  let requestedUrl = "";
  const patched = await patchSupabaseRow({
    table: "v4_recognition_sessions", id: "session-1",
    match: { tenant_id: "tenant-legacy" }, patch: { csm_grammar: "TCG" },
    requireMatch: true, env: enabledEnv,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response('[{"id":"session-1"}]', {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(new URL(requestedUrl).searchParams.get("id"), "eq.session-1");
  assert.equal(new URL(requestedUrl).searchParams.get("tenant_id"), "eq.tenant-legacy");
  assert.equal(patched.saved, true);
}

// COS-9 and COS-25 together: Language survives the real parser, title
// projection, canonical rows and transport, in FK order.
{
  const writes = recorder();
  let patchedHashes = null;
  const result = await runPersistedCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-tcg",
    imageUrls: ["https://example.test/front.jpg"],
    promptVersion: "csm-canonical-fields-v1",
    providerClientRequestId: "lynca-client-trace",
    callProvider: providerFor(common), env: enabledEnv, fetchImpl: writes.fetchImpl,
    createdAt: "2026-08-01T00:00:00Z",
    writeRows: writeCsmStageRows,
    writerOptions: unclaimedWriterOptions,
    patchSession: async ({ id, match, patch }) => {
      assert.equal(id, "session-tcg");
      assert.equal(match.tenant_id, "tenant-1");
      assert.equal(patch.csm_grammar, "TCG");
      assert.equal(patch.csm_recognition_stage_status, "COMPLETE");
      assert.equal(patch.csm_owner_versions.prompt_version, "csm-canonical-fields-v1");
      assert.equal(patch.csm_owner_versions.provider_response_id, "resp_csm_trace");
      assert.equal(patch.csm_owner_versions.provider_request_id, "req_csm_trace");
      assert.equal(patch.csm_owner_versions.provider_client_request_id, "lynca-client-trace");
      assert.equal(patch.csm_owner_versions.provider_attempt_number, null);
      assert.equal(patch.csm_owner_versions.provider_retry_count, null);
      assert.equal(patch.csm_owner_versions.provider, "openai");
      assert.equal(patch.csm_owner_versions.reasoning_effort, "low");
      assert.equal(patch.csm_owner_versions.latency_ms >= 0, true);
      assert.equal(patch.csm_owner_versions.input_tokens, 100);
      assert.equal(patch.csm_owner_versions.output_tokens, 30);
      assert.equal(patch.csm_owner_versions.total_tokens, 130);
      assert.match(patch.csm_recognition_packet_sha256, /^[0-9a-f]{64}$/);
      assert.match(patch.csm_resolution_packet_sha256, /^[0-9a-f]{64}$/);
      assert.match(patch.csm_marketplace_packet_sha256, /^[0-9a-f]{64}$/);
      assert.equal(match.csm_recognition_packet_sha256, patch.csm_recognition_packet_sha256);
      assert.equal(match.csm_resolution_packet_sha256, patch.csm_resolution_packet_sha256);
      assert.equal(match.csm_marketplace_packet_sha256, patch.csm_marketplace_packet_sha256);
      patchedHashes = {
        csm_recognition_packet_sha256: patch.csm_recognition_packet_sha256,
        csm_resolution_packet_sha256: patch.csm_resolution_packet_sha256,
        csm_marketplace_packet_sha256: patch.csm_marketplace_packet_sha256
      };
      return { saved: true };
    }
  });
  assert.match(result.title, /^2025 Pokemon JP /);
  assert.ok(result.title.length <= 80);
  assert.equal(result.csm_persistence.ok, true);
  assert.deepEqual(patchedHashes, result.csm_rows.session_hashes,
    "the session must persist the exact three hashes verified by replay");
  assert.deepEqual(result.csm_rows.output.dropped_trace, {
    dropped_for_budget: result.dropped_brackets,
    suppressed_by_profile: result.suppressed_brackets,
    restored: result.restored_brackets,
    truncated: result.truncated,
    empty_at_input: result.input_empty_fields,
    normalization_reason_codes: result.normalization_reasons,
    character_budget: result.character_budget,
    rendered_length: result.length
  }, "the public Composer result must survive the orchestration-to-CSM mapping losslessly");
// Each of these must be a real value, not `undefined` matching `undefined`:
// deepEqual is satisfied by two missing keys, which is exactly how the four
// composition-receipt fields stayed unpersisted while this assertion passed.
for (const key of ["empty_at_input", "normalization_reason_codes", "character_budget", "rendered_length"]) {
  assert.notEqual(result.csm_rows.output.dropped_trace[key], undefined,
    `dropped_trace.${key} must carry a value, not survive as undefined`);
}
  assert.ok(result.csm_rows.output.dropped_trace.suppressed_by_profile.includes("search_optimization"));
  assert.deepEqual(writes.tables, [
    "csm_evidence_observations", "csm_bracket_candidates", "csm_candidate_evidence_links",
    "csm_identity_resolutions", "csm_resolved_brackets", "csm_marketplace_outputs"
  ]);
  assert.equal(
    result.csm_rows.resolved.find((row) => row.bracket === "language").canonical_value,
    "JP"
  );
}

// Persistence failure is isolated to this attempt, but the production
// boundary fails closed: the deterministic title must not become a usable 200.
{
  const writes = recorder({ failTable: "csm_identity_resolutions" });
  let patchCalls = 0;
  await assert.rejects(
    runPersistedCanonicalListingPath({
      tenantId: "tenant-1", recognitionSessionId: "session-failure",
      imageUrls: ["https://example.test/front.jpg"],
      callProvider: providerFor({
        ...common, grammar: "standard", language: "", manufacturer: "Topps",
        product: "Chrome", set: "", subjects: ["Victor Wembanyama"],
        descriptive_rarity: "", card_number: "221"
      }),
      env: enabledEnv, fetchImpl: writes.fetchImpl,
      writeRows: writeCsmStageRows,
      writerOptions: unclaimedWriterOptions,
      patchSession: async () => { patchCalls += 1; return { saved: true }; }
    }),
    (error) => {
      assert.equal(error.code, "csm_stage_write_failed");
      assert.equal(error.statusCode, 503);
      assert.equal(error.csm_persistence.failedTable, "csm_identity_resolutions");
      return true;
    }
  );
  assert.equal(patchCalls, 0, "a failed child write must never patch COMPLETE");
}

// The immutable-session conflict is an HTTP 409-shaped failure and must never
// execute the COMPLETE patch.
{
  let patchCalls = 0;
  await assert.rejects(
    runPersistedCanonicalListingPath({
      tenantId: "tenant-1", recognitionSessionId: "session-conflict",
      imageUrls: ["https://example.test/front.jpg"],
      callProvider: providerFor(common),
      writeRows: async () => ({
        ok: false, code: "immutable_session_conflict", statusCode: 409,
        written: {}, failedTable: "v4_recognition_sessions"
      }),
      patchSession: async () => { patchCalls += 1; return { saved: true }; }
    }),
    (error) => error.code === "immutable_session_conflict" && error.statusCode === 409
  );
  assert.equal(patchCalls, 0);
}

// A completed exact replay is a true no-op, including the session patch.
{
  let patchCalls = 0;
  const replay = await runPersistedCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-replay",
    imageUrls: ["https://example.test/front.jpg"],
    callProvider: providerFor(common),
    writeRows: async () => ({
      ok: true, replayed: true, skipped: null, written: {
        csm_evidence_observations: 0,
        csm_bracket_candidates: 0,
        csm_candidate_evidence_links: 0,
        csm_identity_resolutions: 0,
        csm_resolved_brackets: 0,
        csm_marketplace_outputs: 0
      }
    }),
    patchSession: async () => { patchCalls += 1; return { saved: true }; }
  });
  assert.equal(replay.csm_persistence.replayed, true);
  assert.equal(patchCalls, 0);
}

// The prepare packet is a complete resume unit: after one paid observation, a
// transient write failure can replay the exact packet without image/provider
// inputs. Tampering is rejected before the writer is entered.
{
  let providerCalls = 0;
  const baseProvider = providerFor(common);
  const prepared = await prepareCanonicalListingPath({
    tenantId: "tenant-1",
    recognitionSessionId: "session-resume",
    imageUrls: ["https://example.test/front.jpg"],
    callProvider: async (request) => {
      providerCalls += 1;
      return baseProvider(request);
    }
  });
  let writeCalls = 0;
  const persist = (writeRows) => persistPreparedCanonicalListingPath({
    tenantId: "tenant-1",
    recognitionSessionId: "session-resume",
    prepared,
    writeRows,
    patchSession: async () => ({ saved: true })
  });
  await assert.rejects(
    persist(async () => {
      writeCalls += 1;
      return { ok: false, code: "csm_atomic_rpc_failed", statusCode: 503 };
    }),
    (error) => error.code === "csm_atomic_rpc_failed" && error.statusCode === 503
  );
  const resumed = await persist(async () => {
    writeCalls += 1;
    return {
      ok: true, atomic: true, replayed: false,
      session: { saved: true }, written: {}
    };
  });
  assert.equal(resumed.title, prepared.title);
  assert.equal(providerCalls, 1);
  assert.equal(writeCalls, 2);

  const tampered = structuredClone(prepared);
  tampered.csm_rows.output.title += " tampered";
  await assert.rejects(
    persistPreparedCanonicalListingPath({
      tenantId: "tenant-1",
      recognitionSessionId: "session-resume",
      prepared: tampered,
      writeRows: async () => { writeCalls += 1; return { ok: true }; }
    }),
    (error) => error.code === "csm_prepared_result_invalid"
  );
  assert.equal(writeCalls, 2, "invalid replay must fail before storage");
}

// A checkpoint produced under Composer v1 may be persisted after v2 deploys,
// but its owner receipt must remain v1. Recovery is provider-incapable and
// must never relabel historical executable behavior as the current version.
{
  const prepared = await prepareCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-v1-resume",
    imageUrls: ["https://example.test/front.jpg"], callProvider: providerFor(common)
  });
  prepared.csm_rows.output.composer_version = THIN_COMPOSER_VERSION_V1;
  prepared.model = "gpt-5.6-luna-legacy";
  prepared.requested_effort = "none";
  prepared.served_effort = "none";
  prepared.image_detail = "original";
  prepared.prompt_version = "legacy-prompt-v1";
  prepared.csm_rows.resolution.recognition_packet_sha256 =
    computeCsmPacketHashes(prepared.csm_rows).csm_recognition_packet_sha256;
  prepared.csm_rows.output.resolution_packet_sha256 =
    computeCsmPacketHashes(prepared.csm_rows).csm_resolution_packet_sha256;
  prepared.csm_rows.session_hashes = computeCsmPacketHashes(prepared.csm_rows);

  let sessionPatch = null;
  await persistPreparedCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-v1-resume", prepared,
    writeRows: async (_rows, options) => {
      sessionPatch = options.sessionPatch;
      return { ok: true, atomic: true, replayed: false, session: { saved: true }, written: {} };
    }
  });
  assert.equal(sessionPatch.csm_owner_versions.composer, THIN_COMPOSER_VERSION_V1);
  assert.equal(sessionPatch.csm_contract_version, prepared.csm_rows.output.contract_version);
  assert.equal(sessionPatch.csm_owner_versions.model, "gpt-5.6-luna-legacy");
  assert.equal(sessionPatch.csm_owner_versions.effort, "none");
  assert.equal(sessionPatch.csm_owner_versions.reasoning_effort, "none");
  assert.equal(sessionPatch.csm_owner_versions.image_detail, "original");
  assert.equal(sessionPatch.csm_owner_versions.prompt_version, "legacy-prompt-v1");
}

await assert.rejects(
  () => runPersistedCanonicalListingPath({ tenantId: "", recognitionSessionId: "session" }),
  /missing_tenant_id/
);

process.stdout.write("csm orchestration: ok\n");
