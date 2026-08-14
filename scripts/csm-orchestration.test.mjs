#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  persistPreparedCanonicalListingPath,
  prepareCanonicalListingPath,
  resolveCanonicalObservation,
  runPersistedCanonicalListingPath
} from "../lib/listing/thin/csm-orchestration.mjs";
import {
  buildCsmModelExecutionContract,
  compileCsmModelExecution,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_LUNA_MODEL_PROFILE,
  CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
  sha256ExecutionContractValue
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import {
  computeCsmOwnerExecutionReceiptSha256,
  CSM_OWNER_EXECUTION_RECEIPT_VERSION,
  projectCsmOwnerExecutionReceipt
} from "../lib/listing/thin/csm-owner-execution-receipt.mjs";
import { writeCsmStageRows } from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  buildCsmStageRows,
  CSM_STAGE_LEGACY_CONTRACT_VERSION,
  computeCsmPacketHashes,
  THIN_COMPOSER_VERSION_V1
} from "../lib/listing/thin/csm-persistence.mjs";
import { replayFromRows } from "../lib/listing/thin/csm-replay.mjs";
import { runCanonicalListingPath } from "../lib/listing/thin/thin-listing-path.mjs";
import { patchSupabaseRow } from "../lib/supabase-rest.mjs";
import {
  composeLyncaStandardNameForProfile,
  LYNCA_STANDARD_PROFILE_VERSION_V1
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import { buildAccuracyLossLedger } from
  "../lib/listing/thin/accuracy-loss-ledger.mjs";
import {
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_VERSION as CANONICAL_FIELDS_PROMPT_VERSION
} from
  "../lib/listing/thin/canonical-fields.mjs";
import { buildCsmPersistenceCheckpoint } from "../api/csm-listing-title.js";
import {
  CSM_PROJECTION_ACTIVATION,
  CSM_WRITER_PROJECTION_CONTRACTS
} from "../lib/listing/thin/csm-projection-activation.mjs";

const enabledEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  CSM_PERSISTENCE_ENABLED: "1"
};

function auditedProviderFields(fields, imageCount = 1) {
  const sourceFields = [
    "year", "language", "manufacturer", "product", "set", "subjects", "team",
    "card_name", "release_variant", "surface_color", "parallel_family",
    "parallel_exact", "descriptive_rarity", "card_number", "serial", "attributes",
    "grading_info", "grammar", "lot_count", "special_stamp", "description"
  ];
  const hasValue = (value) => Array.isArray(value) ? value.length > 0
    : value && typeof value === "object" ? Object.values(value).some(Boolean)
      : Boolean(String(value ?? "").trim());
  return {
    ...fields,
    field_sources: sourceFields.filter((field) => hasValue(fields[field])).map((field) => ({
      field, source_ids: ["original_image_1"]
    })),
    set_card_name_relations: {
      set: fields.set ? "CURRENT_CARD_MEMBER_OF_SET" : "",
      card_name: fields.card_name ? "CURRENT_CARD_NAMED_BY_DESIGN" : ""
    }
  };
}

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
      model: "gpt-5.6-luna",
      status: "completed",
      output_text: JSON.stringify(auditedProviderFields(fields)),
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
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    promptVersion: CANONICAL_FIELDS_PROMPT_VERSION,
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
      assert.equal(patch.csm_owner_versions.prompt_version, CANONICAL_FIELDS_PROMPT_VERSION);
      assert.equal(patch.csm_owner_versions.provider_response_id, "resp_csm_trace");
      assert.equal(patch.csm_owner_versions.provider_request_id, "req_csm_trace");
      assert.equal(patch.csm_owner_versions.provider_client_request_id, "lynca-client-trace");
      assert.equal(patch.csm_owner_versions.provider_attempt_number, null);
      assert.equal(patch.csm_owner_versions.provider_retry_count, null);
      assert.equal(patch.csm_owner_versions.provider, "openai");
      assert.equal(patch.csm_owner_versions.model, "gpt-5.6-luna");
      assert.equal(patch.csm_owner_versions.requested_model, "gpt-5.6-luna");
      assert.equal(patch.csm_owner_versions.served_model, "gpt-5.6-luna");
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
      assert.equal(patch.csm_owner_versions.request_builder_version,
        "canonical-fields-request-v1");
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
  assert.equal(
    result.csm_owner_versions.owner_execution_receipt_version,
    CSM_OWNER_EXECUTION_RECEIPT_VERSION
  );
  assert.match(result.csm_owner_versions.owner_execution_receipt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    computeCsmOwnerExecutionReceiptSha256(result.csm_owner_versions),
    result.csm_owner_versions.owner_execution_receipt_sha256,
    "the public expected hash must cover the exact owner receipt atomically saved in the session patch"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(
    result.csm_owner_versions, "latency_stages_ms"
  ), true, "optional receipt fields stay explicit so the v1 digest has one complete shape");
  const reorderedOwnerReceipt = Object.fromEntries(
    Object.entries(result.csm_owner_versions).reverse()
  );
  assert.equal(
    computeCsmOwnerExecutionReceiptSha256(reorderedOwnerReceipt),
    result.csm_owner_versions.owner_execution_receipt_sha256,
    "the owner digest is canonical rather than JavaScript insertion-order dependent"
  );
  assert.throws(
    () => projectCsmOwnerExecutionReceipt({
      ...structuredClone(result.csm_owner_versions),
      output_tokens: result.csm_owner_versions.output_tokens + 1
    }),
    /csm_owner_execution_receipt_invalid/,
    "a hash-shaped stored value cannot conceal drift in the durable full receipt"
  );
  assert.throws(
    () => computeCsmOwnerExecutionReceiptSha256({
      ...result.csm_owner_versions,
      unreviewed_extension: "must-not-enter-the-digest"
    }),
    /csm_owner_execution_receipt_invalid/,
    "future fields require an explicit allow-list review and receipt version bump"
  );
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

// The captured e1ae writer did not persist a Web receipt. Missing response
// effort attestation remains explicit in the owner trace without inventing a
// durable Web contract that this writer never emitted.
{
  const unattested = await prepareCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-unattested-effort",
    imageUrls: ["https://example.test/front.jpg"],
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    callProvider: async () => new Response(JSON.stringify({
      id: "resp_without_effort_echo",
      model: "gpt-5.6-luna",
      output_text: JSON.stringify(auditedProviderFields(common)),
      usage: { input_tokens: 100, output_tokens: 30 }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(unattested.served_effort_attested, false);
  assert.equal(Object.hasOwn(
    unattested.csm_rows.output.structured_output,
    "founder_beta_web_receipt"
  ), false);
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
      transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
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
      transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
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
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
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
  assert.equal(Object.hasOwn(
    replay.csm_owner_versions, "owner_execution_receipt_sha256"
  ), false, "a no-write replay must not manufacture a read-after-write receipt");
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
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
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

// Recovery is not allowed to persist a self-consistent v3 checkpoint that the
// Canonical Naming layer marked unpublishable. Re-sealing the hashes and trace
// must not turn an over-budget required token into an eligible durable write.
{
  const prepared = await prepareCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-v3-overbudget-resume",
    imageUrls: ["https://example.test/front.jpg"],
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    callProvider: providerFor({
      ...common, grammar: "standard", language: "", manufacturer: "Topps",
      product: "Chrome", set: "", subjects: ["Victor Wembanyama"],
      descriptive_rarity: "SSP", card_number: "221"
    })
  });
  const historicalV3 = composeLyncaStandardNameForProfile(prepared.fields, {
    marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V1,
    publicationCoverage: false
  });
  Object.assign(prepared, {
    title: historicalV3.title,
    grammar: historicalV3.grammar,
    brackets: historicalV3.brackets,
    dropped_brackets: historicalV3.dropped,
    suppressed_brackets: historicalV3.suppressed,
    restored_brackets: historicalV3.restored,
    truncated: historicalV3.truncated,
    input_empty_fields: historicalV3.input_empty_fields,
    normalization_reasons: historicalV3.normalization_reasons,
    character_budget: historicalV3.character_budget,
    length: historicalV3.length,
    canonical_naming_trace: historicalV3.canonical_naming_trace,
    canonical_naming_publishable: historicalV3.canonical_naming_publishable,
    composer_version: historicalV3.composer_version,
    marketplace_profile_version: historicalV3.marketplace_profile_version
  });
  prepared.csm_rows = buildCsmStageRows({
    tenantId: "tenant-1",
    recognitionSessionId: "session-v3-overbudget-resume",
    fields: prepared.fields,
    observedFields: prepared.observed_fields || prepared.fields,
    externalIdentitySupport: prepared.external_identity_support,
    composed: historicalV3,
    title: historicalV3.title,
    founderBetaWebReceipt: null,
    setCardNameRelationReceipt: null,
    contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION
  });
  prepared.accuracy_loss_ledger = buildAccuracyLossLedger({
    rawProviderOutput: JSON.stringify(prepared.observed_fields || prepared.fields),
    result: prepared
  });
  const invalid = structuredClone(prepared);
  invalid.csm_rows.resolved.find((row) => row.bracket === "card_number").canonical_value =
    "X".repeat(80);
  const invalidComposition = replayFromRows(invalid.csm_rows, {
    allowUnsealedMutation: true
  }).composed;
  assert.equal(invalidComposition.canonical_naming_publishable, false);
  invalid.title = "";
  invalid.csm_rows.output.title = "";
  invalid.csm_rows.output.included_brackets = invalidComposition.brackets;
  invalid.csm_rows.output.dropped_trace = {
    dropped_for_budget: invalidComposition.dropped,
    suppressed_by_profile: invalidComposition.suppressed,
    restored: invalidComposition.restored,
    truncated: invalidComposition.truncated,
    empty_at_input: invalidComposition.input_empty_fields,
    normalization_reason_codes: invalidComposition.normalization_reasons,
    character_budget: invalidComposition.character_budget,
    rendered_length: invalidComposition.length,
    canonical_naming: invalidComposition.canonical_naming_trace
  };
  invalid.csm_rows.resolution.recognition_packet_sha256 =
    computeCsmPacketHashes(invalid.csm_rows).csm_recognition_packet_sha256;
  invalid.csm_rows.output.resolution_packet_sha256 =
    computeCsmPacketHashes(invalid.csm_rows).csm_resolution_packet_sha256;
  invalid.csm_rows.session_hashes = computeCsmPacketHashes(invalid.csm_rows);

  let writerCalls = 0;
  await assert.rejects(
    persistPreparedCanonicalListingPath({
      tenantId: "tenant-1",
      recognitionSessionId: "session-v3-overbudget-resume",
      prepared: invalid,
      writeRows: async () => {
        writerCalls += 1;
        return { ok: true, atomic: true, session: { saved: true }, written: {} };
      }
    }),
    (error) => error.code === "csm_prepared_result_invalid" && error.statusCode === 409
  );
  assert.equal(writerCalls, 0, "unpublishable v3 recovery must fail before storage");
}

// A settled checkpoint owns its historical profile and adapter identity. A
// later deployment may choose another active profile, but recovery validates
// the checkpoint's exact shape and self-hash instead of rebuilding it with the
// current defaults.
{
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
  assert.throws(() => buildCsmModelExecutionContract({
    profile: historicalProfile,
    providerAdapterVersion: historicalAdapterContract.id,
    responseParserVersion: historicalAdapterContract.response_parser_version,
    providerAdapterContract: historicalAdapterContract,
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    imageUrls: ["https://execution-contract.invalid/image-1"]
  }), /provider_adapter_contract_mismatch/,
  "an unregistered historical adapter cannot bypass the closed writer tuple");
}

// Mutating a current prepared result into an invented Composer/prompt tuple is
// not a historical checkpoint. Persistence must reject it before storage;
// genuine published v1 checkpoints are covered by the finite replay matrix.
{
  const prepared = await prepareCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-v1-resume",
    imageUrls: ["https://example.test/front.jpg"],
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    callProvider: providerFor(common)
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

  let writeCalls = 0;
  await assert.rejects(() => persistPreparedCanonicalListingPath({
    tenantId: "tenant-1", recognitionSessionId: "session-v1-resume", prepared,
    writeRows: async () => {
      writeCalls += 1;
      return { ok: true, atomic: true, replayed: false, session: { saved: true }, written: {} };
    }
  }), (error) => error?.code === "csm_prepared_result_invalid"
    && error?.detail === "writer_contract_binding_invalid");
  assert.equal(writeCalls, 0);
}

// A paid future checkpoint is a reader/recovery input, not a request to run
// today's active writer again. Persisting it must preserve the exact stored
// writer's provenance formula and owner receipt shape for every future grammar
// family, including the verified-original overlay.
{
  const writer = CSM_WRITER_PROJECTION_CONTRACTS.future_v3;
  const futureProjection = {
    ...structuredClone(CSM_PROJECTION_ACTIVATION),
    active_writer: structuredClone(writer)
  };
  const futureBase = {
    year: "2023", manufacturer: "Topps", product: "Chrome", set: "",
    subjects: ["Shohei Ohtani"], team: "Dodgers", card_name: "",
    release_variant: "", surface_color: "", parallel_family: "", parallel_exact: "",
    descriptive_rarity: "", card_number: "1", serial: "", attributes: [],
    grading_info: { company: "", card_grade: "", auto_grade: "", grade_type: "" },
    grammar: "standard", lot_count: "", language: "", unreadable: [],
    low_confidence: [], special_stamp: "", description: ""
  };
  const overlayImages = [
    "161f0d97df619f8d34b2453551567a0473d3e477c3e0ec9295029fbce8c59e44",
    "cef46b5d761d2d20f5cd21d611cab8d8037721bcdb4ae8c1a0d4441439a6fdc3"
  ];
  const cases = [
    {
      id: "standard", fields: futureBase,
      pipeline: "e62b6fb9f00770bb9ecdfcd6c69b24dc661999f39bad43141007d3183be1ed1c"
    },
    {
      id: "tcg",
      fields: {
        ...futureBase, manufacturer: "Pokemon", product: "Pokemon",
        set: "Scarlet & Violet", subjects: ["Pikachu"], team: "",
        grammar: "tcg", language: "EN", card_number: "025/165"
      },
      pipeline: "d35b5a2b66deba5ea4073344e2f0d4561692a17fc1a76111c952db5cc2ed438e"
    },
    {
      id: "lot",
      fields: {
        ...futureBase, subjects: ["Shohei Ohtani", "Mike Trout"], team: "",
        card_number: "", grammar: "lot", lot_count: "2", attributes: ["RC"]
      },
      pipeline: "d35b5a2b66deba5ea4073344e2f0d4561692a17fc1a76111c952db5cc2ed438e"
    },
    {
      id: "overlay-v2",
      fields: {
        ...futureBase, year: "2025", subjects: ["Cooper Flagg"], team: "Mavericks",
        surface_color: "Gold", parallel_family: "Refractor",
        parallel_exact: "Gold Refractor", card_number: "251", serial: "30/50",
        attributes: ["RC"]
      },
      originalImageSha256: overlayImages,
      pipeline: "8885f2cdac0e63bb61856d1e8a0647d48cadc3b7f02cefa406fe872203baa37d"
    }
  ];

  async function futureCheckpoint(fixture) {
    const recognitionSessionId = `session-future-resume-${fixture.id}`;
    const imageUrls = fixture.originalImageSha256
      ? ["https://example.test/front.jpg", "https://example.test/back.jpg"]
      : ["https://example.test/front.jpg"];
    const compiled = compileCsmModelExecution({
      imageUrls,
      transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
      writerContract: writer
    });
    const execution = compiled.execution_contract;
    const result = await runCanonicalListingPath({
      compiledRequest: compiled.provider_request,
      provider: execution.provider,
      model: execution.model,
      effort: execution.requested_effort,
      imageDetail: execution.image_detail,
      maxOutputTokens: execution.max_output_tokens,
      providerClientRequestId: `client-future-${fixture.id}`,
      writerContract: writer,
      resolveObservation: (observation) => resolveCanonicalObservation(observation, {
        writerContract: writer,
        externalIdentityContext: fixture.originalImageSha256
          ? { originalImageSha256: fixture.originalImageSha256 } : null
      }),
      callProvider: providerFor(fixture.fields)
    });
    const rows = buildCsmStageRows({
      tenantId: "tenant-1",
      recognitionSessionId,
      fields: result.fields,
      observedFields: result.observed_fields || result.fields,
      externalIdentitySupport: result.external_identity_support,
      verifiedOriginalObservationSupport: result.verified_original_observation_support,
      composed: {
        grammar: result.grammar,
        brackets: result.brackets,
        bracket_text: result.bracket_text,
        dropped: result.dropped_brackets,
        suppressed: result.suppressed_brackets,
        restored: result.restored_brackets,
        truncated: result.truncated,
        input_empty_fields: result.input_empty_fields,
        normalization_reasons: result.normalization_reasons,
        character_budget: result.character_budget,
        length: result.length,
        composer_version: result.composer_version,
        marketplace_profile_version: result.marketplace_profile_version,
        canonical_naming_trace: result.canonical_naming_trace,
        canonical_naming_publishable: result.canonical_naming_publishable,
        publication_coverage: result.publication_coverage,
        lot_quantity_unresolved: result.lot_quantity_unresolved,
        lot_single_card: result.lot_single_card,
        lot_unshared_attributes: result.lot_unshared_attributes,
        lot_publishable: result.lot_publishable,
        lot_publication_failure_code: result.lot_publication_failure_code
      },
      founderBetaWebReceipt: result.founder_beta_web_receipt,
      setCardNameRelationReceipt: result.set_card_name_relation_receipt,
      title: result.title,
      registryReleaseId: "registry_thin_sem_v25",
      createdAt: "2026-08-14T00:00:00.000Z",
      contractVersion: writer.durable_projection_contract_version
    });
    const prepared = {
      ...result,
      latency_ms: 7,
      provider_attempt_number: 1,
      provider_retry_count: 0,
      prompt_version: execution.semantic_prompt_version,
      max_output_tokens: execution.max_output_tokens,
      model_profile_id: execution.model_profile_id,
      provider_adapter_version: execution.provider_adapter_version,
      request_builder_version: execution.request_builder_version,
      response_parser_version: execution.response_parser_version,
      optimization_pack_id: execution.optimization_pack_id,
      optimization_pack_sha256: execution.optimization_pack_sha256,
      execution_contract_sha256: compiled.execution_contract_sha256,
      execution_contract: execution,
      csm_rows: rows
    };
    const payloadHash = createHash("sha256").update(fixture.id).digest("hex");
    return buildCsmPersistenceCheckpoint({
      prepared,
      tenantId: "tenant-1",
      operationKey: `operation-future-${fixture.id}`,
      payloadHash,
      recognitionSessionId,
      executionContractSha256: prepared.execution_contract_sha256,
      resolutionContractSha256: prepared.resolution_contract_sha256,
      originalSetSha256:
        prepared.verified_original_observation_support?.original_set_sha256 || null,
      projectionActivation: futureProjection
    });
  }

  for (const fixture of cases) {
    const prepared = await futureCheckpoint(fixture);
    let patch = null;
    const persisted = await persistPreparedCanonicalListingPath({
      tenantId: "tenant-1",
      recognitionSessionId: `session-future-resume-${fixture.id}`,
      prepared,
      writeRows: async (_rows, options) => {
        patch = options.sessionPatch;
        return { ok: true, atomic: true, replayed: false, session: { saved: true }, written: {} };
      }
    });
    const owner = patch.csm_owner_versions;
    const expectedPipeline = createHash("sha256").update(JSON.stringify({
      contract: prepared.csm_rows.output.contract_version,
      model: prepared.requested_model,
      effort: prepared.requested_effort,
      imageDetail: prepared.image_detail,
      resolver: prepared.csm_rows.resolution.resolver_version,
      composer: prepared.csm_rows.output.composer_version,
      marketplaceProfile: prepared.csm_rows.output.marketplace_profile_version,
      requestBuilder: prepared.request_builder_version,
      responseParser: prepared.response_parser_version
    })).digest("hex");
    assert.equal(patch.recognition_pipeline_fingerprint, expectedPipeline);
    assert.equal(patch.recognition_pipeline_fingerprint, fixture.pipeline);
    assert.equal(owner.composer, prepared.csm_rows.output.composer_version);
    assert.equal(owner.marketplace_profile,
      prepared.csm_rows.output.marketplace_profile_version);
    assert.equal(owner.resolver, prepared.csm_rows.resolution.resolver_version);
    assert.equal(owner.accuracy_loss_ledger_version,
      prepared.accuracy_loss_ledger.version);
    assert.equal(owner.accuracy_loss_ledger_sha256,
      prepared.accuracy_loss_ledger.ledger_sha256);
    assert.equal(Object.hasOwn(owner, "provider_transport_retry_receipt"), true);
    assert.equal(owner.provider_transport_retry_receipt, null);
    assert.equal(computeCsmOwnerExecutionReceiptSha256(owner),
      owner.owner_execution_receipt_sha256);
    assert.deepEqual(projectCsmOwnerExecutionReceipt(owner), {
      version: CSM_OWNER_EXECUTION_RECEIPT_VERSION,
      sha256: owner.owner_execution_receipt_sha256
    });
    assert.deepEqual(persisted.csm_owner_versions, owner);
  }
}

await assert.rejects(
  () => runPersistedCanonicalListingPath({ tenantId: "", recognitionSessionId: "session" }),
  /missing_tenant_id/
);

process.stdout.write("csm orchestration: ok\n");
