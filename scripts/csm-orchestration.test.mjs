#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  persistPreparedCanonicalListingPath,
  prepareCanonicalListingPath,
  runPersistedCanonicalListingPath
} from "../lib/listing/thin/csm-orchestration.mjs";
import {
  buildCsmModelExecutionContract,
  CSM_LUNA_MODEL_PROFILE,
  CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
  sha256ExecutionContractValue
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
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
    assert.equal(request.max_output_tokens, 8192);
    return new Response(JSON.stringify({
      id: "resp_csm_trace",
      model: "gpt-5.6-luna-2026-08-01",
      status: "completed",
      output_text: JSON.stringify(fields),
      reasoning: { effort: "low" },
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens: 30,
        output_tokens_details: { reasoning_tokens: 12 },
        total_tokens: 999
      }
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
      assert.equal(patch.csm_owner_versions.model, "gpt-5.6-luna");
      assert.equal(patch.csm_owner_versions.requested_model, "gpt-5.6-luna");
      assert.equal(patch.csm_owner_versions.served_model, "gpt-5.6-luna-2026-08-01");
      assert.equal(patch.csm_owner_versions.served_model_attested, true);
      assert.equal(patch.csm_owner_versions.reasoning_effort, "low");
      assert.equal(patch.csm_owner_versions.reasoning_effort_attested, true);
      assert.equal(patch.csm_owner_versions.provider_response_status, "completed");
      assert.equal(patch.csm_owner_versions.provider_response_status_attested, true);
      assert.equal(patch.csm_owner_versions.provider_response_incomplete, false);
      assert.equal(patch.csm_owner_versions.served_effort_conflict, false);
      assert.equal(patch.csm_owner_versions.provider_http_status, 200);
      assert.equal(patch.csm_owner_versions.model_profile_id, "openai-gpt-5.6-luna-csm-v1");
      assert.equal(
        patch.csm_owner_versions.optimization_pack_id,
        CSM_LUNA_MODEL_PROFILE.optimization_pack_id
      );
      assert.equal(
        patch.csm_owner_versions.optimization_pack_sha256,
        CSM_LUNA_MODEL_PROFILE.optimization_pack_sha256
      );
      assert.equal(patch.csm_owner_versions.account_scope, "lynca-primary");
      assert.equal(patch.csm_owner_versions.provider_adapter_version, "openai-responses-v1");
      assert.equal(patch.csm_owner_versions.request_builder_version, "canonical-fields-request-v1");
      assert.equal(
        patch.csm_owner_versions.response_parser_version,
        "canonical-output-v2-strict-observed-or-null"
      );
      assert.match(patch.csm_owner_versions.execution_contract_sha256, /^[0-9a-f]{64}$/);
      assert.equal(
        patch.csm_owner_versions.execution_contract.model_profile_id,
        patch.csm_owner_versions.model_profile_id
      );
      assert.equal(patch.csm_owner_versions.max_output_tokens, 8192);
      assert.equal(patch.csm_owner_versions.latency_ms >= 0, true);
      assert.equal(patch.csm_owner_versions.input_tokens, 100);
      assert.equal(patch.csm_owner_versions.cached_input_tokens, 40);
      assert.equal(patch.csm_owner_versions.output_tokens, 30);
      assert.equal(patch.csm_owner_versions.reasoning_tokens, 12);
      assert.equal(patch.csm_owner_versions.total_tokens, 999);
      assert.equal(patch.csm_owner_versions.total_tokens_source, "provider");
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
  assert.equal(result.csm_owner_versions.provider_adapter_version, "openai-responses-v1",
    "the public result must expose the exact owner receipt written with the CSM packet");
  assert.deepEqual(result.csm_owner_versions.execution_contract, result.execution_contract,
    "the durable owner must retain the complete historical execution identity");
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

// A syntactically valid provider response may omit the reasoning echo. The
// title still persists, but neither the API result nor the stored owner receipt
// may convert requested `low` into observed `low`.
{
  const prepared = await prepareCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-unattested-effort",
    imageUrls: ["https://example.test/front.jpg"],
    callProvider: async () => new Response(JSON.stringify({
      id: "resp_without_effort_echo",
      output_text: JSON.stringify(common),
      usage: { input_tokens: 100, output_tokens: 30 }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(prepared.requested_effort, "low");
  assert.equal(prepared.prompt_version, prepared.execution_contract.semantic_prompt_version,
    "default prepare must persist the semantic prompt actually hashed by its contract");
  assert.equal(prepared.served_effort, null);
  assert.equal(prepared.served_effort_attested, false);
  let sessionPatch = null;
  const persisted = await persistPreparedCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-unattested-effort", prepared,
    writeRows: async (_rows, options) => {
      sessionPatch = options.sessionPatch;
      return { ok: true, atomic: true, replayed: false, session: { saved: true }, written: {} };
    }
  });
  assert.equal(persisted.title, prepared.title);
  assert.equal(sessionPatch.csm_owner_versions.effort, "low");
  assert.equal(sessionPatch.csm_owner_versions.reasoning_effort, null);
  assert.equal(sessionPatch.csm_owner_versions.reasoning_effort_attested, false);
  assert.equal(sessionPatch.csm_owner_versions.served_model, null);
  assert.equal(sessionPatch.csm_owner_versions.served_model_attested, false);
  assert.equal(sessionPatch.csm_owner_versions.provider_response_status, null);
  assert.equal(sessionPatch.csm_owner_versions.provider_response_status_attested, false);
  assert.equal(sessionPatch.csm_owner_versions.total_tokens, 130);
  assert.equal(sessionPatch.csm_owner_versions.total_tokens_source, "input_plus_output");
  assert.equal(sessionPatch.csm_owner_versions.prompt_version, prepared.prompt_version);
  assert.match(sessionPatch.csm_owner_versions.execution_contract_sha256, /^[0-9a-f]{64}$/);
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
  assert.deepEqual(resumed.execution_contract, prepared.execution_contract);
  assert.equal(
    resumed.execution_contract_sha256,
    sha256ExecutionContractValue(prepared.execution_contract)
  );
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

  for (const [name, mutate] of [
    ["failed status", (value) => {
      value.provider_response_status = "failed";
      value.provider_response_status_attested = true;
    }],
    ["incomplete receipt", (value) => { value.provider_response_incomplete = true; }],
    ["non-string served model", (value) => {
      value.served_model = 123;
      value.served_model_attested = true;
    }],
    ["malformed status", (value) => {
      value.provider_response_status = 200;
      value.provider_response_status_attested = true;
    }],
    ["non-string provider", (value) => { value.provider = 7; }],
    ["non-string requested model", (value) => { value.requested_model = 123; }],
    ["non-string model alias", (value) => { value.model = 123; }],
    ["non-string requested effort", (value) => { value.requested_effort = {}; }],
    ["non-string image detail", (value) => { value.image_detail = 1; }],
    ["non-string prompt version", (value) => { value.prompt_version = false; }],
    ["non-integer max output", (value) => { value.max_output_tokens = "8192"; }],
    ["execution contract extra field", (value) => {
      value.execution_contract.unowned_extension = true;
      value.execution_contract_sha256 = sha256ExecutionContractValue(value.execution_contract);
    }],
    ["execution contract missing account scope", (value) => {
      delete value.execution_contract.account_scope;
      value.execution_contract_sha256 = sha256ExecutionContractValue(value.execution_contract);
    }],
    ["execution fingerprint drift", (value) => {
      value.execution_contract_sha256 = "0".repeat(64);
    }]
  ]) {
    const invalidReceipt = structuredClone(prepared);
    mutate(invalidReceipt);
    let invalidWriterCalls = 0;
    await assert.rejects(
      persistPreparedCanonicalListingPath({
        tenantId: "tenant-1",
        recognitionSessionId: "session-resume",
        prepared: invalidReceipt,
        writeRows: async () => {
          invalidWriterCalls += 1;
          return { ok: true, atomic: true, session: { saved: true } };
        }
      }),
      (error) => error.code === "csm_prepared_result_invalid",
      `${name} must fail before durable COMPLETE persistence`
    );
    assert.equal(invalidWriterCalls, 0, `${name} must not enter the writer`);
  }

  const rawReceipt = structuredClone(prepared);
  rawReceipt.provider = " OPENAI ";
  rawReceipt.model = ` ${prepared.model} `;
  rawReceipt.requested_model = ` ${prepared.requested_model} `;
  rawReceipt.requested_effort = " LOW ";
  rawReceipt.image_detail = " HIGH ";
  rawReceipt.prompt_version = ` ${prepared.prompt_version} `;
  rawReceipt.served_model = ` ${prepared.served_model} `;
  rawReceipt.served_effort = " LOW ";
  rawReceipt.provider_response_status = " COMPLETED ";
  let normalizedPatch = null;
  await persistPreparedCanonicalListingPath({
    tenantId: "tenant-1",
    recognitionSessionId: "session-resume",
    prepared: rawReceipt,
    writeRows: async (_rows, options) => {
      normalizedPatch = options.sessionPatch;
      return { ok: true, atomic: true, session: { saved: true }, written: {} };
    }
  });
  assert.equal(normalizedPatch.csm_owner_versions.provider, "openai");
  assert.equal(normalizedPatch.csm_owner_versions.model, prepared.requested_model);
  assert.equal(normalizedPatch.csm_owner_versions.effort, "low");
  assert.equal(normalizedPatch.csm_owner_versions.image_detail, "high");
  assert.equal(normalizedPatch.csm_owner_versions.prompt_version, prepared.prompt_version);
  assert.equal(normalizedPatch.csm_owner_versions.served_model, prepared.served_model);
  assert.equal(normalizedPatch.csm_owner_versions.reasoning_effort, "low");
  assert.equal(normalizedPatch.csm_owner_versions.provider_response_status, "completed");
}

// A settled checkpoint owns its historical profile and adapter identity. A
// later deployment may choose another active profile, but recovery validates
// the checkpoint's exact shape and self-hash instead of rebuilding it with the
// current defaults.
{
  const prepared = await prepareCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-historical-profile",
    imageUrls: ["https://example.test/front.jpg"], callProvider: providerFor(common)
  });
  const historicalProfile = {
    ...CSM_LUNA_MODEL_PROFILE,
    id: "openai-gpt-5.6-luna-csm-historical-v0",
    account_scope: "lynca-archive"
  };
  const historicalAdapterContract = {
    ...CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
    id: "openai-responses-historical-v0",
    response_parser_version: "canonical-output-historical-v0"
  };
  const historicalContract = buildCsmModelExecutionContract({
    profile: historicalProfile,
    providerAdapterVersion: historicalAdapterContract.id,
    responseParserVersion: historicalAdapterContract.response_parser_version,
    providerAdapterContract: historicalAdapterContract
  });
  const historicalPrepared = structuredClone(prepared);
  historicalPrepared.model_profile_id = historicalContract.model_profile_id;
  historicalPrepared.provider_adapter_version = historicalContract.provider_adapter_version;
  historicalPrepared.response_parser_version = historicalContract.response_parser_version;
  historicalPrepared.execution_contract = historicalContract;
  historicalPrepared.execution_contract_sha256 = sha256ExecutionContractValue(historicalContract);

  let owner = null;
  await persistPreparedCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-historical-profile",
    prepared: historicalPrepared,
    writeRows: async (_rows, options) => {
      owner = options.sessionPatch.csm_owner_versions;
      return { ok: true, atomic: true, session: { saved: true }, written: {} };
    }
  });
  assert.equal(owner.model_profile_id, historicalProfile.id);
  assert.equal(owner.account_scope, historicalProfile.account_scope);
  assert.equal(owner.provider_adapter_version, historicalAdapterContract.id);
  assert.equal(owner.response_parser_version, historicalAdapterContract.response_parser_version);
  assert.equal(owner.execution_contract_sha256, historicalPrepared.execution_contract_sha256);
  assert.deepEqual(owner.execution_contract, historicalContract);
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
  delete prepared.requested_model;
  delete prepared.served_model;
  delete prepared.served_model_attested;
  delete prepared.provider_response_status;
  delete prepared.provider_response_status_attested;
  delete prepared.provider_response_incomplete;
  // Some legacy JSON snapshots materialized absent receipt columns as null.
  // This is still “no receipt”, not a partial current receipt.
  for (const key of [
    "model_profile_id", "optimization_pack_id", "optimization_pack_sha256",
    "provider_adapter_version", "request_builder_version", "response_parser_version",
    "execution_contract_sha256", "execution_contract"
  ]) prepared[key] = null;
  delete prepared.max_output_tokens;
  prepared.requested_effort = "none";
  prepared.served_effort = "none";
  delete prepared.served_effort_attested;
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
  assert.equal(sessionPatch.csm_owner_versions.reasoning_effort, null,
    "legacy checkpoints without an explicit attestation bit must be downgraded");
  assert.equal(sessionPatch.csm_owner_versions.reasoning_effort_attested, false);
  assert.equal(sessionPatch.csm_owner_versions.image_detail, "original");
  assert.equal(sessionPatch.csm_owner_versions.prompt_version, "legacy-prompt-v1");
  assert.equal(sessionPatch.csm_owner_versions.execution_contract, null);
  assert.equal(sessionPatch.csm_owner_versions.account_scope, null);
}

await assert.rejects(
  () => runPersistedCanonicalListingPath({ tenantId: "", recognitionSessionId: "session" }),
  /missing_tenant_id/
);

process.stdout.write("csm orchestration: ok\n");
