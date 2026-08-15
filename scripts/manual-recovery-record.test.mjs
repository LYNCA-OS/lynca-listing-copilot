import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildManualRecoveryRecord,
  manualRecoveryRecordMatches,
  manualRecoveryDelivers,
  MANUAL_RECOVERY_SCHEMA_VERSION,
  MANUAL_RECOVERY_SOURCES
} from "../lib/listing/recovery/manual-recovery-record.mjs";
import {
  authorizeManualRecoveryAssetAccess,
  handleManualRecoveryRequest,
  MANUAL_RECOVERY_TABLE,
  publicManualRecoveryError
} from "../api/listing-manual-recovery.js";
import { TENANT_ROLES } from "../lib/tenant/index.mjs";

const base = {
  submissionId: "00000000-0000-4000-8000-000000000051",
  tenantId: "tenant_a",
  assetId: "asset_durable_1",
  operatorId: "user_writer_1",
  manualTitle: "2024 Topps Chrome Shohei Ohtani Refractor"
};

const writerAccess = {
  tenantId: base.tenantId,
  userId: base.operatorId,
  role: TENANT_ROLES.WRITER
};
assert.equal((await authorizeManualRecoveryAssetAccess({
  access: writerAccess,
  payload: { asset_id: base.assetId, assigned_user_id: "attacker-controlled" },
  dependencies: {
    readAsset: async () => ({ row: { owner_user_id: base.operatorId } })
  }
})).row.owner_user_id, base.operatorId, "a Writer must pass when the durable asset names that Writer");
await assert.rejects(
  authorizeManualRecoveryAssetAccess({
    access: writerAccess,
    payload: { asset_id: base.assetId, assigned_user_id: base.operatorId },
    dependencies: {
      readAsset: async () => ({ row: { owner_user_id: "user_writer_2" } })
    }
  }),
  (error) => error.code === "ACCESS_DENIED",
  "request payload cannot self-assign a Writer to another user's asset"
);
await assert.rejects(
  authorizeManualRecoveryAssetAccess({
    access: writerAccess,
    payload: { asset_id: base.assetId },
    dependencies: { readAsset: async () => ({ row: { owner_user_id: null } }) }
  }),
  (error) => error.code === "ACCESS_DENIED",
  "an unresolved legacy owner must fail closed for assigned-scope Writers"
);
const managerAccess = { ...writerAccess, role: TENANT_ROLES.MANAGER };
assert.ok(await authorizeManualRecoveryAssetAccess({
  access: managerAccess,
  payload: { asset_id: base.assetId },
  dependencies: { readAsset: async () => ({ row: { owner_user_id: base.operatorId } }) }
}), "a Manager may recover an asset that Manager owns");
await assert.rejects(
  authorizeManualRecoveryAssetAccess({
    access: managerAccess,
    payload: { asset_id: base.assetId },
    dependencies: { readAsset: async () => ({ row: { owner_user_id: "user_writer_2" } }) }
  }),
  (error) => error.code === "ACCESS_DENIED",
  "Manager visibility must not become tenant-wide feedback authority"
);
assert.ok(await authorizeManualRecoveryAssetAccess({
  access: { ...writerAccess, role: TENANT_ROLES.OWNER },
  payload: { asset_id: base.assetId },
  dependencies: { readAsset: async () => ({ row: { owner_user_id: null } }) }
}), "tenant Owners retain explicit tenant scope for unresolved legacy assets");

{
  const internal = Object.assign(new Error("listing_asset_read_failed:postgres password=secret"), { statusCode: 503 });
  const publicError = publicManualRecoveryError(internal);
  assert.equal(publicError.status, 503);
  assert.equal(publicError.body.code, "manual_recovery_temporarily_unavailable");
  assert.doesNotMatch(JSON.stringify(publicError), /postgres|password|secret/,
    "public errors must never echo Supabase/PostgREST details");
  assert.equal(publicManualRecoveryError(Object.assign(
    new Error("manual_recovery_submission_conflict"), { statusCode: 409, retryable: false }
  )).body.retryable, false);
  assert.deepEqual(publicManualRecoveryError(new TypeError("invalid_durable_listing_asset_id")), {
    status: 400,
    body: {
      ok: false,
      code: "manual_recovery_request_invalid",
      message: "Invalid manual recovery request.",
      retryable: false
    }
  });
}

assert.throws(
  () => buildManualRecoveryRecord({ ...base, submissionId: "not-a-uuid" }),
  /invalid_manual_recovery_submission_id/
);
await assert.rejects(
  handleManualRecoveryRequest({
    tenantId: base.tenantId,
    operatorId: base.operatorId,
    payload: {
      manual_recovery_submission_id: base.submissionId,
      asset_id: base.assetId,
      manual_title: base.manualTitle
    }
  }),
  (error) => error.message === "manual_recovery_client_occurred_at_required" && error.statusCode === 400,
  "the server must not regenerate the action timestamp on a replay"
);

// The whole point of the issue: a card with NO recognition session can still
// persist the operator's work.
{
  const record = buildManualRecoveryRecord({ ...base, failureCode: "STORAGE_OBJECT_ALREADY_EXISTS" });
  assert.equal(record.schema_version, MANUAL_RECOVERY_SCHEMA_VERSION);
  assert.equal(record.id, base.submissionId);
  assert.equal(record.source, MANUAL_RECOVERY_SOURCES.SAVED);
  assert.equal(record.manual_title, base.manualTitle);
  assert.equal(record.failure_code, "STORAGE_OBJECT_ALREADY_EXISTS");
  assert.ok(!("recognition_session_id" in record), "the record must not carry a session field at all");
}

// A record that could be mistaken for reviewed truth is worse than no record.
// These are set by the builder, never by the caller, and the migration repeats
// them as check constraints.
{
  const record = buildManualRecoveryRecord({ ...base, training_eligible: true, semantic_truth: true });
  assert.equal(record.training_eligible, false, "manual-after-failure never trains");
  assert.equal(record.semantic_truth, false, "manual-after-failure is not semantic truth");
  assert.equal(record.canonical_fields_approved, false, "no canonical field is approved by this path");
}

// Refuse a session rather than ignore it. Accepting one would make this a
// second, weaker door into the ledger the AI feedback path guards.
assert.throws(
  () => buildManualRecoveryRecord({ ...base, recognitionSessionId: "csmsess_abc" }),
  /manual_recovery_rejects_recognition_session/,
  "a submission with a session belongs to the AI feedback path"
);

// Identity is mandatory: a record nobody can trace to a card and an operator is
// not an audit trail.
for (const [field, patch] of [
  ["tenant", { tenantId: "" }],
  ["asset", { assetId: "  " }],
  ["operator", { operatorId: "" }]
]) {
  assert.throws(() => buildManualRecoveryRecord({ ...base, ...patch }), /required/, `${field} must be required`);
}

// A save needs a title; a rejection must not carry one, or the row later reads
// as an accepted title with a rejection flag.
assert.throws(() => buildManualRecoveryRecord({ ...base, manualTitle: "   " }), /manual_title_required/);
{
  const rejected = buildManualRecoveryRecord({
    ...base,
    source: MANUAL_RECOVERY_SOURCES.REJECTED,
    manualTitle: "should not be stored"
  });
  assert.equal(rejected.manual_title, "", "a rejection stores no title");
  assert.equal(manualRecoveryDelivers(rejected), false);
  assert.equal(manualRecoveryDelivers(buildManualRecoveryRecord(base)), true);
}

assert.throws(() => buildManualRecoveryRecord({ ...base, source: "TOTALLY_MADE_UP" }), /invalid_manual_recovery_source/);

// The endpoint must verify the asset belongs to the tenant before writing.
// Without it the endpoint manufactures an audit trail for a card that may not
// exist, on a caller-supplied string.
{
  const calls = [];
  const result = await handleManualRecoveryRequest({
    tenantId: "tenant_a",
    operatorId: "user_writer_1",
    payload: {
      manual_recovery_submission_id: base.submissionId,
      client_occurred_at: "2026-08-08T10:00:00.000Z",
      asset_id: "asset_durable_1",
      manual_title: "A title"
    },
    dependencies: {
      assertAsset: async (args) => { calls.push(["assertAsset", args]); return { ok: true }; },
      insertRow: async (args) => { calls.push(["insertRow", args]); return { saved: true, row: args.row }; }
    }
  });
  assert.deepEqual(calls.map(([name]) => name), ["assertAsset", "insertRow"],
    "tenant ownership must be proven BEFORE the row is written");
  assert.equal(calls[0][1].requireDurable, true, "a non-durable asset cannot anchor a recovery record");
  assert.equal(calls[1][1].table, MANUAL_RECOVERY_TABLE);
  assert.equal(calls[1][1].upsert, false,
    "the append-only table uses rules that forbid ON CONFLICT; duplicate PKs are read back instead");
  assert.equal(result.record.tenant_id, "tenant_a");
}

// A lost response after commit returns no insert representation on retry. The
// exact tenant/operator/id row is replayed only when its immutable payload is
// identical; no second row is created.
{
  const recordedAt = "2026-08-08T10:00:00.000Z";
  const expected = buildManualRecoveryRecord({ ...base, recordedAt });
  const calls = [];
  const result = await handleManualRecoveryRequest({
    tenantId: base.tenantId,
    operatorId: base.operatorId,
    payload: {
      manual_recovery_submission_id: base.submissionId,
      client_occurred_at: recordedAt,
      asset_id: base.assetId,
      manual_title: base.manualTitle
    },
    dependencies: {
      assertAsset: async () => ({ ok: true }),
      insertRow: async () => ({ saved: true, row: null, rows: [] }),
      readRows: async (args) => { calls.push(args); return { ok: true, rows: [expected] }; }
    }
  });
  assert.equal(result.replayed, true);
  assert.equal(manualRecoveryRecordMatches(result.record, expected), true);
  assert.equal(manualRecoveryRecordMatches(
    { ...expected, recorded_at: "2026-08-08 10:00:00+00" },
    expected
  ), true, "PostgREST timestamp formatting must not manufacture a payload conflict");
  assert.equal(calls[0].search.id, `eq.${base.submissionId}`);
  assert.equal(calls[0].search.tenant_id, `eq.${base.tenantId}`);
  assert.equal(calls[0].search.operator_id, `eq.${base.operatorId}`);
}

// Reusing one submission UUID for different semantics is not a retry. The
// existing append-only row wins and the conflicting request fails closed.
await assert.rejects(
  handleManualRecoveryRequest({
    tenantId: base.tenantId,
    operatorId: base.operatorId,
    payload: {
      manual_recovery_submission_id: base.submissionId,
      client_occurred_at: "2026-08-08T10:00:00.000Z",
      asset_id: base.assetId,
      manual_title: "Conflicting title"
    },
    dependencies: {
      assertAsset: async () => ({ ok: true }),
      insertRow: async () => ({ saved: true, row: null, rows: [] }),
      readRows: async () => ({
        ok: true,
        rows: [buildManualRecoveryRecord({
          ...base,
          recordedAt: "2026-08-08T10:00:00.000Z"
        })]
      })
    }
  }),
  (error) => error.message === "manual_recovery_submission_conflict"
    && error.statusCode === 409
    && error.retryable === false
);

// A failed write must NOT be acknowledged. The writer queue advances on this
// answer, so a false success costs the operator the card and the title.
await assert.rejects(
  handleManualRecoveryRequest({
    tenantId: "tenant_a",
    operatorId: "user_writer_1",
    payload: {
      manual_recovery_submission_id: base.submissionId,
      client_occurred_at: "2026-08-08T10:00:00.000Z",
      asset_id: "asset_durable_1",
      manual_title: "A title"
    },
    dependencies: {
      assertAsset: async () => ({ ok: true }),
      insertRow: async () => ({ saved: false, error: "supabase_unavailable" }),
      readRows: async () => ({ ok: false, rows: [], error: "supabase_unavailable" })
    }
  }),
  /manual_recovery_not_persisted/,
  "an unwritten record must never be reported as saved"
);

// The migration must enforce the same properties the builder does, so a direct
// writer cannot bypass them.
const migration = await readFile(
  "infrastructure/supabase-production/supabase/migrations/20260805080709_listing_manual_recovery_records_v1.sql",
  "utf8"
);
assert.match(migration, /training_eligible = false/, "never-training must be a constraint, not a default");
assert.match(migration, /semantic_truth = false and canonical_fields_approved = false/);
assert.match(migration, /on update to public\.listing_manual_recovery_records do instead nothing/);
assert.match(migration, /on delete to public\.listing_manual_recovery_records do instead nothing/);
assert.match(migration, /id uuid primary key/, "the existing UUID primary key is the idempotency constraint");
// Check the COLUMNS, not the prose: the header comment explains why there is no
// session here, so matching the raw file finds the explanation and fails a
// correct migration.
const migrationDdl = migration.replace(/^\s*--.*$/gm, "");
assert.doesNotMatch(migrationDdl, /recognition_session_id/,
  "the table must not have a session column to fill in");

// The product must route the sessionless case here instead of dead-ending, and
// the writer controls must stop requiring a session.
const js = await readFile("app/listing-copilot.js", "utf8");
assert.match(js, /saveManualRecoveryForResult/, "the sessionless path must reach the manual recovery ledger");
assert.doesNotMatch(js, /识别会话尚未持久化，无法保存审核记录/, "the dead-end message must be gone");
assert.match(js, /const saveDisabled = !canPersistDecision/,
  "Save must depend on being able to persist a decision, not on an AI session");
assert.match(js, /REJECTED_AFTER_RECOGNITION_FAILURE/, "reject-after-failure must use the same durable contract");
const manualRecoveryUi = js.slice(
  js.indexOf("async function saveManualRecoveryForResult"),
  js.indexOf("async function saveFeedbackForResult")
);
assert.match(manualRecoveryUi, /result\.feedbackStatus = rejected \? "skipped" : "saved";\s*result\.persistenceStatus = "persisted";/,
  "manual recovery must distinguish a saved title from a persisted rejection");
assert.doesNotMatch(manualRecoveryUi, /result\.persistenceStatus = "saved";/,
  "manual recovery must not invent a persistence state the writer queue cannot recognize");
assert.match(manualRecoveryUi, /manual_recovery_submission_id: result\.pendingManualRecoverySubmissionId/,
  "transport retries must reuse one stable manual-recovery UUID");
assert.match(manualRecoveryUi, /client_occurred_at: result\.pendingManualRecoveryOccurredAt/,
  "the replay payload must retain the first action timestamp");

// AI feedback must still refuse a sessionless AI review.
const feedbackApi = await readFile("api/v4/listing-feedback.js", "utf8");
assert.match(feedbackApi, /recognition_session_id is required/,
  "the AI feedback endpoint must keep rejecting sessionless submissions");

process.stdout.write("manual recovery record: ok\n");
