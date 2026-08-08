#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  ACCURACY_LOSS_LEDGER_SUPPORTED_VERSIONS,
  ACCURACY_LOSS_LEDGER_V1,
  ACCURACY_LOSS_LEDGER_VERSION,
  ACCURACY_LOSS_LEDGER_MAX_BYTES,
  ACCURACY_LOSS_SOURCE_MAP_VERSION,
  accuracyLedgerSha256,
  accuracySemValueSha256,
  buildAccuracyLossLedger,
  validateAccuracyLossLedger
} from "../lib/listing/thin/accuracy-loss-ledger.mjs";
import {
  persistPreparedCanonicalListingPath,
  prepareCanonicalListingPath
} from "../lib/listing/thin/csm-orchestration.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import { buildCsmStageRows } from "../lib/listing/thin/csm-persistence.mjs";
import { semCanonicalEditableFields } from "../lib/listing/csm/sem-definition.mjs";
import { resolvedFieldsToSemSuggestion } from "../lib/listing/csm/title-derived-sem.mjs";
import { toResolvedFields } from "../lib/listing/thin/csm-emit.mjs";
import {
  buildCsmPersistenceCheckpoint,
  publicPersistedResult,
  validateCsmPersistenceCheckpoint
} from "../api/csm-listing-title.js";

const raw = `  ${JSON.stringify({
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "Cosmic",
  subjects: ["Victor Wembanyama"], team: "Spurs", card_name: "中文",
  release_variant: "", surface_color: "Rainbow", parallel_family: "Foil",
  parallel_exact: "", descriptive_rarity: "", card_number: "221",
  serial: "17/50", attributes: ["RC", "Auto", "Patch"], grade: "PSA 10",
  grammar: "standard", lot_count: "", language: "", unreadable: [],
  low_confidence: [], description: "   ",
  provider_internal_note: "DO_NOT_PERSIST_RAW_PROVIDER_CONTENT"
})}\n`;
const baseline = finishCanonicalTitle(raw);
let calls = 0;
const prepared = await prepareCanonicalListingPath({
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  imageUrls: ["https://example.test/card.jpg"],
  providerClientRequestId: "client-ledger-1",
  callProvider: async () => {
    calls += 1;
    return new Response(JSON.stringify({
      id: "resp_ledger_1",
      output_text: raw,
      reasoning: { effort: "low" },
      usage: { input_tokens: 77, output_tokens: 23 }
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_ledger_1" }
    });
  }
});

assert.equal(calls, 1, "the ledger must not add a provider call");
assert.deepEqual(prepared.fields, baseline.fields, "canonical fields must remain byte-for-byte neutral");
assert.equal(prepared.title, baseline.title, "the final title bytes must remain unchanged");
assert.equal(prepared.provider_response_id, "resp_ledger_1");
assert.equal(prepared.provider_request_id, "req_ledger_1");
assert.equal(prepared.provider_client_request_id, "client-ledger-1");
const baselineRows = buildCsmStageRows({
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  fields: baseline.fields,
  composed: {
    grammar: baseline.grammar,
    brackets: baseline.brackets,
    dropped: baseline.dropped_brackets,
    suppressed: baseline.suppressed_brackets,
    restored: baseline.restored_brackets,
    truncated: baseline.truncated,
    input_empty_fields: baseline.input_empty_fields,
    normalization_reasons: baseline.normalization_reasons,
    character_budget: baseline.character_budget,
    length: baseline.length
  },
  title: baseline.title
});
assert.deepEqual(prepared.csm_rows, baselineRows,
  "observability must not perturb any persisted CSM row or packet hash");

const ledger = prepared.accuracy_loss_ledger;
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
assert.equal(ledger.version, ACCURACY_LOSS_LEDGER_VERSION);
assert.equal(ACCURACY_LOSS_LEDGER_VERSION, ACCURACY_LOSS_LEDGER_V1);
assert.deepEqual(ACCURACY_LOSS_LEDGER_SUPPORTED_VERSIONS, [ACCURACY_LOSS_LEDGER_V1],
  "published ledger validators stay registered for durable checkpoint recovery");
assert.equal(ledger.stages.raw_provider_output.sha256, sha256(raw));
assert.equal(ledger.stages.raw_provider_output.byte_length, Buffer.byteLength(raw, "utf8"));
assert.equal(ledger.stages.parsed_fields.source_sha256, ledger.stages.raw_provider_output.sha256);
assert.equal(ledger.stages.parsed_fields.sha256, accuracyLedgerSha256(JSON.parse(raw)));
assert.equal(ledger.stages.admitted_canonical_fields.source_sha256, ledger.stages.parsed_fields.sha256);
assert.equal(ledger.stages.admitted_canonical_fields.sha256, accuracySemValueSha256(
  resolvedFieldsToSemSuggestion(toResolvedFields(baseline.fields))
));
assert.equal(ledger.stages.admitted_canonical_fields.source_map_version,
  ACCURACY_LOSS_SOURCE_MAP_VERSION);
assert.ok(ledger.stages.admitted_canonical_fields.reason_codes.includes("BASE_APPEARANCE_NOT_PARALLEL"));
const fieldLedger = ledger.stages.admitted_canonical_fields.fields;
assert.equal(fieldLedger.length, semCanonicalEditableFields.length, "the ledger has a fixed field bound");
assert.deepEqual(fieldLedger.map(({ field }) => field), semCanonicalEditableFields,
  "field order is the frozen CSM allowlist, never provider key order");
assert.ok(fieldLedger.every(({ status }) => (
  ["unchanged", "normalized", "derived", "dropped", "empty"].includes(status)
)));
assert.ok(Buffer.byteLength(JSON.stringify(ledger), "utf8") < ACCURACY_LOSS_LEDGER_MAX_BYTES,
  "hash-only fixed-field ledger must stay bounded below 16 KiB");
assert.ok(fieldLedger.every((entry) => Object.keys(entry).sort().join(",")
  === "admitted_present,admitted_value_sha256,field,input_present,input_value_sha256,reason_codes,status"));
assert.equal(fieldLedger.find(({ field }) => field === "year").status, "unchanged");
assert.equal(fieldLedger.find(({ field }) => field === "search_optimization").status, "normalized");
assert.equal(fieldLedger.find(({ field }) => field === "release_variant").status, "empty");
assert.deepEqual(fieldLedger.find(({ field }) => field === "card_name").reason_codes,
  ["SANITIZED_TO_EMPTY"]);
assert.deepEqual(fieldLedger.find(({ field }) => field === "description").reason_codes,
  ["NORMALIZED_TO_EMPTY"]);
assert.deepEqual(fieldLedger.find(({ field }) => field === "print_finish").reason_codes,
  ["BASE_APPEARANCE_NOT_PARALLEL", "CSM_ADMISSION_REJECTED", "DESCRIBES_SURFACE_NOT_PARALLEL"]);
assert.equal(ledger.stages.composed_bracket_ledger.source_sha256,
  ledger.stages.admitted_canonical_fields.sha256);
assert.ok(ledger.stages.composed_bracket_ledger.reason_codes.includes("MARKETPLACE_PROFILE_SUPPRESSED"));
assert.deepEqual(ledger.stages.composed_bracket_ledger.suppressed_by_profile,
  ["card_number", "search_optimization"],
  "only populated values actually removed by the profile count as suppression");
assert.equal(ledger.stages.final_title.source_sha256, ledger.stages.composed_bracket_ledger.sha256);
assert.equal(ledger.stages.final_title.sha256, sha256(baseline.title));
assert.equal(ledger.ledger_sha256, accuracyLedgerSha256({
  version: ledger.version,
  stages: ledger.stages
}));
assert.equal(validateAccuracyLossLedger(ledger), ledger);
assert.equal(prepared.csm_rows.output.structured_output.accuracy_loss_ledger, undefined,
  "the marketplace projection must not become an upstream evidence side channel");
assert.doesNotMatch(JSON.stringify(prepared.csm_rows), /DO_NOT_PERSIST_RAW_PROVIDER_CONTENT/,
  "raw provider content must be represented by its hash, never copied into persistence");

const checkpoint = buildCsmPersistenceCheckpoint({
  prepared,
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  operationKey: "csm-ledger-operation-1",
  payloadHash: "a".repeat(64)
});
assert.deepEqual(checkpoint.accuracy_loss_ledger, ledger,
  "the provider authority checkpoint must retain the prepared ledger");
assert.equal(checkpoint.csm_persistence_checkpoint.accuracy_loss_ledger_sha256,
  ledger.ledger_sha256, "the checkpoint identity must bind the ledger hash");
assert.equal(checkpoint.csm_persistence_checkpoint.accuracy_loss_ledger_version,
  ACCURACY_LOSS_LEDGER_V1, "the checkpoint must freeze the validator version");
assert.doesNotMatch(JSON.stringify(checkpoint), /DO_NOT_PERSIST_RAW_PROVIDER_CONTENT/);
assert.equal(validateCsmPersistenceCheckpoint(checkpoint, {
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  operationKey: "csm-ledger-operation-1",
  payloadHash: "a".repeat(64)
}), checkpoint);
const corruptedCheckpoint = structuredClone(checkpoint);
corruptedCheckpoint.accuracy_loss_ledger.stages.raw_provider_output.byte_length = 999_999;
assert.throws(() => validateCsmPersistenceCheckpoint(corruptedCheckpoint, {
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  operationKey: "csm-ledger-operation-1",
  payloadHash: "a".repeat(64)
}), (error) => error.code === "csm_persistence_checkpoint_invalid"
  && error.detail === "accuracy_loss_ledger_invalid");
const mismatchedCheckpoint = structuredClone(checkpoint);
mismatchedCheckpoint.csm_persistence_checkpoint.accuracy_loss_ledger_sha256 = "b".repeat(64);
assert.throws(() => validateCsmPersistenceCheckpoint(mismatchedCheckpoint, {
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  operationKey: "csm-ledger-operation-1",
  payloadHash: "a".repeat(64)
}), (error) => error.code === "csm_persistence_checkpoint_invalid"
  && error.detail === "accuracy_loss_ledger_mismatch");
const legacyCheckpoint = structuredClone(checkpoint);
delete legacyCheckpoint.accuracy_loss_ledger;
legacyCheckpoint.csm_persistence_checkpoint.schema_version = "csm-persistence-checkpoint-v1";
delete legacyCheckpoint.csm_persistence_checkpoint.accuracy_loss_ledger_version;
delete legacyCheckpoint.csm_persistence_checkpoint.accuracy_loss_ledger_sha256;
assert.equal(validateCsmPersistenceCheckpoint(legacyCheckpoint, {
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  operationKey: "csm-ledger-operation-1",
  payloadHash: "a".repeat(64)
}), legacyCheckpoint, "pre-ledger durable checkpoints must remain resumable");

const fieldMismatch = structuredClone(checkpoint);
const yearEntry = fieldMismatch.accuracy_loss_ledger.stages.admitted_canonical_fields.fields
  .find(({ field }) => field === "year");
yearEntry.admitted_value_sha256 = "f".repeat(64);
yearEntry.status = "normalized";
yearEntry.reason_codes = ["CSM_SEM_NORMALIZED"];
fieldMismatch.accuracy_loss_ledger.ledger_sha256 = accuracyLedgerSha256({
  version: fieldMismatch.accuracy_loss_ledger.version,
  stages: fieldMismatch.accuracy_loss_ledger.stages
});
fieldMismatch.csm_persistence_checkpoint.accuracy_loss_ledger_sha256 =
  fieldMismatch.accuracy_loss_ledger.ledger_sha256;
assert.throws(() => validateCsmPersistenceCheckpoint(fieldMismatch, {
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  operationKey: "csm-ledger-operation-1",
  payloadHash: "a".repeat(64)
}), (error) => error.code === "csm_persistence_checkpoint_invalid"
  && error.detail === "accuracy_loss_ledger_invalid",
"field-level admitted hashes must remain bound to the actual SEM projection");
const publicResult = publicPersistedResult(checkpoint);
assert.equal(publicResult.accuracy_loss_ledger, undefined,
  "the browser response must not carry the authority-only ledger");
assert.equal(publicResult.csm_persistence_checkpoint, undefined);
assert.equal(publicResult.title, prepared.title);

assert.notEqual(
  accuracySemValueSha256(["First Subject", "Second Subject"]),
  accuracySemValueSha256(["Second Subject", "First Subject"]),
  "SEM hashes must preserve title-affecting array order"
);

const unsupportedRaw = JSON.stringify({ subjects: { name: "Not an allowed source shape" } });
const unsupportedResult = finishCanonicalTitle(unsupportedRaw);
const unsupportedLedger = buildAccuracyLossLedger({ rawProviderOutput: unsupportedRaw, result: unsupportedResult });
assert.deepEqual(unsupportedLedger.stages.admitted_canonical_fields.fields
  .find(({ field }) => field === "subject").reason_codes, ["UNSUPPORTED_SOURCE_SHAPE"]);

const rejectedRaw = JSON.stringify({ attributes: ["Not a canonical attribute"] });
const rejectedResult = finishCanonicalTitle(rejectedRaw);
const rejectedLedger = buildAccuracyLossLedger({ rawProviderOutput: rejectedRaw, result: rejectedResult });
assert.deepEqual(rejectedLedger.stages.admitted_canonical_fields.fields
  .find(({ field }) => field === "search_optimization").reason_codes, ["PARSER_REJECTED"]);

const derivedRaw = JSON.stringify({ manufacturer: "Pokemon", product: "Mega Brave" });
const derivedResult = finishCanonicalTitle(derivedRaw);
const derivedLedger = buildAccuracyLossLedger({ rawProviderOutput: derivedRaw, result: derivedResult });
const derivedIp = derivedLedger.stages.admitted_canonical_fields.fields
  .find(({ field }) => field === "ip_sport");
assert.equal(derivedIp.status, "derived");
assert.deepEqual(derivedIp.reason_codes, ["CSM_SEM_DERIVED"]);

const droppedRaw = JSON.stringify({ description: "Visible Kings Signatures phrase" });
const droppedResult = finishCanonicalTitle(droppedRaw);
const droppedLedger = buildAccuracyLossLedger({ rawProviderOutput: droppedRaw, result: droppedResult });
assert.equal(droppedLedger.stages.admitted_canonical_fields.fields
  .find(({ field }) => field === "description").status, "dropped");
assert.ok(droppedLedger.stages.admitted_canonical_fields.reason_codes.includes("CANONICAL_FIELD_DROPPED"));
assert.ok(!droppedLedger.stages.admitted_canonical_fields.reason_codes
  .includes("NO_CANONICAL_LOSS_RECORDED"));

const emptySuppressionRaw = JSON.stringify({ year: "2024", subjects: ["A"], grammar: "standard" });
const emptySuppressionResult = finishCanonicalTitle(emptySuppressionRaw);
const emptySuppressionLedger = buildAccuracyLossLedger({
  rawProviderOutput: emptySuppressionRaw,
  result: emptySuppressionResult
});
assert.deepEqual(emptySuppressionLedger.stages.composed_bracket_ledger.profile_suppression_policy,
  ["card_number", "search_optimization"]);
assert.deepEqual(emptySuppressionLedger.stages.composed_bracket_ledger.suppressed_by_profile, []);
assert.ok(!emptySuppressionLedger.stages.composed_bracket_ledger.reason_codes
  .includes("MARKETPLACE_PROFILE_SUPPRESSED"));
assert.deepEqual(emptySuppressionLedger.stages.composed_bracket_ledger.reason_codes,
  ["NO_COMPOSER_LOSS_RECORDED"]);

let sessionPatch = null;
const persisted = await persistPreparedCanonicalListingPath({
  tenantId: "tenant-ledger",
  recognitionSessionId: "session-ledger",
  prepared,
  writeRows: async (_rows, options) => {
    sessionPatch = options.sessionPatch;
    return { ok: true, atomic: true, session: { saved: true }, written: {} };
  }
});
assert.equal(calls, 1, "persistence resume must remain outside the paid boundary");
assert.equal(persisted.title, baseline.title);
assert.deepEqual(persisted.fields, baseline.fields);
assert.equal(sessionPatch.csm_owner_versions.accuracy_loss_ledger_version,
  ACCURACY_LOSS_LEDGER_VERSION);
assert.equal(sessionPatch.csm_owner_versions.accuracy_loss_ledger_sha256, ledger.ledger_sha256);
assert.equal(sessionPatch.csm_owner_versions.provider_response_id, "resp_ledger_1");
assert.equal(sessionPatch.csm_owner_versions.provider_request_id, "req_ledger_1");
assert.equal(sessionPatch.csm_owner_versions.provider_client_request_id, "client-ledger-1");
assert.equal(Number.isFinite(sessionPatch.csm_owner_versions.latency_ms), true);
assert.doesNotMatch(JSON.stringify(sessionPatch), /DO_NOT_PERSIST_RAW_PROVIDER_CONTENT/);

process.stdout.write("accuracy loss ledger: ok\n");
