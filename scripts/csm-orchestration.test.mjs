#!/usr/bin/env node

import assert from "node:assert/strict";

import { runPersistedCanonicalListingPath } from "../lib/listing/thin/csm-orchestration.mjs";
import { writeCsmStageRows } from "../lib/listing/thin/csm-supabase-writer.mjs";
import { patchV4Row } from "../lib/listing/v4/session/supabase-rest.mjs";

const enabledEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  CSM_SHADOW_PERSISTENCE_ENABLED: "1"
};

function providerFor(fields) {
  return async (request) => {
    assert.equal(request.model, "gpt-5.6-luna");
    assert.equal(request.reasoning.effort, "none");
    return new Response(JSON.stringify({
      output_text: JSON.stringify(fields),
      reasoning: { effort: "none" },
      usage: { input_tokens: 100, output_tokens: 30 }
    }), { status: 200, headers: { "content-type": "application/json" } });
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
  const patched = await patchV4Row({
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
    callProvider: providerFor(common), env: enabledEnv, fetchImpl: writes.fetchImpl,
    createdAt: "2026-08-01T00:00:00Z",
    writeRows: writeCsmStageRows,
    writerOptions: unclaimedWriterOptions,
    patchSession: async ({ id, match, patch }) => {
      assert.equal(id, "session-tcg");
      assert.equal(match.tenant_id, "tenant-1");
      assert.equal(patch.csm_grammar, "TCG");
      assert.equal(patch.csm_recognition_stage_status, "COMPLETE");
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

await assert.rejects(
  () => runPersistedCanonicalListingPath({ tenantId: "", recognitionSessionId: "session" }),
  /missing_tenant_id/
);

process.stdout.write("csm orchestration: ok\n");
