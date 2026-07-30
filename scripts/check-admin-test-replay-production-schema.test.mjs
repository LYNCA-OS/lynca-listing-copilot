#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  ADMIN_TEST_REPLAY_MIGRATION_FILE,
  ADMIN_TEST_REPLAY_MIGRATION_SHA256,
  ADMIN_TEST_REPLAY_MIGRATION_VERSION,
  evaluateAdminTestReplayProductionSchemaSnapshot
} from "./check-admin-test-replay-production-schema.mjs";

const migrationUrl = new URL(
  `../supabase/migrations/${ADMIN_TEST_REPLAY_MIGRATION_FILE}`,
  import.meta.url
);
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const ciWorkflow = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const deployWorkflow = fs.readFileSync(
  new URL("../.github/workflows/deploy-production.yml", import.meta.url),
  "utf8"
);
const operationsRunbook = fs.readFileSync(
  new URL("../docs/runbooks/track-c-production-operations.md", import.meta.url),
  "utf8"
);

function validSnapshot() {
  return {
    functions: [
      {
        signature: "public.sync_writer_final_replay_from_session()",
        resolved_signature: "sync_writer_final_replay_from_session()",
        owner_name: "postgres",
        return_type: "trigger",
        volatility: "v",
        security_definer: false,
        config: ["search_path=\"\""],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
        definition: `
          create function public.sync_writer_final_replay_from_session()
          returns trigger language plpgsql security invoker set search_path = '' as $$
          begin
            select upper(feedback.writer_feedback ->> 'dataset_disposition')
            into feedback_dataset_disposition
            from public.v4_writer_feedback_events feedback
            where feedback.id = new.writer_feedback_event_id
              and feedback.tenant_id = new.tenant_id
              and feedback.recognition_session_id = new.id;
            if feedback_dataset_disposition is distinct from 'OBSERVE_ONLY' then
              return new;
            end if;
            insert into public.listing_writer_final_replay(tenant_id) values (new.tenant_id);
            return new;
          end $$;
        `
      },
      {
        signature: "public.verify_v4_admin_test_feedback_isolation(text,text,text)",
        resolved_signature: "verify_v4_admin_test_feedback_isolation(text,text,text)",
        owner_name: "postgres",
        return_type: "jsonb",
        volatility: "s",
        security_definer: true,
        config: ["search_path=\"\""],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
        definition: `
          create function public.verify_v4_admin_test_feedback_isolation(text,text,text)
          returns jsonb stable security definer set search_path = '' as $$
          begin
            perform feedback.writer_feedback ->> 'dataset_disposition';
            perform learning.feedback_training_event ->> 'dataset_disposition';
            verified := active_admin_replay_for_image_count = 0
              and coalesce((generation_hash ~ '^[0-9a-f]{64}$'::text), false);
            return jsonb_build_object(
              'image_generation_hash_verified', generation_hash ~ '^[0-9a-f]{64}$',
              'writer_final_replay_excluded', verified
            );
          end $$ language plpgsql;
        `
      }
    ],
    trigger: {
      table_name: "v4_recognition_sessions",
      trigger_name: "sync_writer_final_replay_from_session",
      function_signature: "public.sync_writer_final_replay_from_session()",
      timing: "AFTER",
      events: ["UPDATE"],
      update_columns: ["status", "writer_final_title", "writer_feedback_event_id"],
      row_level: true,
      enabled_state: "O",
      definition: `
        CREATE TRIGGER sync_writer_final_replay_from_session
        AFTER UPDATE OF status, writer_final_title, writer_feedback_event_id
        ON public.v4_recognition_sessions FOR EACH ROW
        WHEN (new.status = ANY (ARRAY['ACCEPTED'::text, 'EDITED'::text]))
        EXECUTE FUNCTION public.sync_writer_final_replay_from_session()
      `
    },
    index: {
      table_name: "listing_writer_final_replay",
      index_name: "listing_writer_final_replay_source_feedback_idx",
      access_method: "btree",
      unique_index: false,
      indisvalid: true,
      indisready: true,
      key_columns: ["tenant_id", "source_feedback_event_id"],
      predicate: "(source_feedback_event_id IS NOT NULL)"
    },
    invariants: { active_admin_test_writer_final_replays: "0" },
    migrationHistory: {
      present: true,
      occurrence_count: 1,
      name: "admin_test_writer_final_replay_isolation_v1"
    },
    server: { transaction_read_only: "on", server_version_num: "170010" }
  };
}

function failedCheck(report, id) {
  return report.checks.find((check) => check.id === id)?.ok === false;
}

const actualMigrationSha = crypto
  .createHash("sha256")
  .update(fs.readFileSync(migrationUrl))
  .digest("hex");
assert.equal(actualMigrationSha, ADMIN_TEST_REPLAY_MIGRATION_SHA256);
assert.equal(ADMIN_TEST_REPLAY_MIGRATION_VERSION, "20260730120000");
assert.ok(
  BigInt(ADMIN_TEST_REPLAY_MIGRATION_VERSION) > 20260730065921n,
  "admin replay isolation must follow Writer Intake v1"
);
assert.match(packageJson.scripts["check:admin-test-replay-production-schema"], /check-admin-test-replay-production-schema/);
assert.match(packageJson.scripts["test:admin-test-replay-production-schema"], /check-admin-test-replay-production-schema\.test/);
assert.match(ciWorkflow, /\*\.pg17\.test\.mjs\) continue/);
assert.match(ciWorkflow, /REQUIRE_POSTGRES17:\s*"1"/);
assert.match(ciWorkflow, /node scripts\/admin-test-writer-final-replay\.pg17\.test\.mjs/);
assert.match(ciWorkflow, /node scripts\/check-writer-intake-production-schema\.pg17\.test\.mjs/);
assert.equal(
  [...deployWorkflow.matchAll(/node scripts\/check-admin-test-replay-production-schema\.mjs/g)].length,
  2,
  "production deploy must attest the exact schema before and after deployment"
);
assert.match(deployWorkflow, /admin-test-replay-production-schema-preflight\.json/);
assert.match(deployWorkflow, /admin-test-replay-production-schema-postdeploy\.json/);
assert.match(operationsRunbook, new RegExp(ADMIN_TEST_REPLAY_MIGRATION_SHA256));
assert.match(operationsRunbook, /pending set must\s+be exactly `\{20260730120000\}`/);
assert.match(operationsRunbook, /after Writer Intake migration `20260730065921` is present exactly once/);

const baseline = evaluateAdminTestReplayProductionSchemaSnapshot(validSnapshot());
assert.equal(baseline.ok, true, JSON.stringify(baseline.checks));

const wrongProofOwner = validSnapshot();
wrongProofOwner.functions[1].owner_name = "authenticated";
assert.equal(
  failedCheck(evaluateAdminTestReplayProductionSchemaSnapshot(wrongProofOwner), "proof_rpc_contract"),
  true
);

const guardAfterInsert = validSnapshot();
guardAfterInsert.functions[0].definition = guardAfterInsert.functions[0].definition.replace(
  "insert into public.listing_writer_final_replay(tenant_id) values (new.tenant_id);",
  "insert into public.listing_writer_final_replay(tenant_id) values (new.tenant_id);\n"
    + "if feedback_dataset_disposition is distinct from 'OBSERVE_ONLY' then return new; end if;"
);
guardAfterInsert.functions[0].definition = guardAfterInsert.functions[0].definition.replace(
  "if feedback_dataset_disposition is distinct from 'OBSERVE_ONLY' then\n              return new;\n            end if;",
  "null;"
);
assert.equal(
  failedCheck(
    evaluateAdminTestReplayProductionSchemaSnapshot(guardAfterInsert),
    "replay_trigger_function_fail_closed"
  ),
  true
);

const wrongTriggerColumns = validSnapshot();
wrongTriggerColumns.trigger.update_columns = ["status", "writer_final_title"];
assert.equal(
  failedCheck(evaluateAdminTestReplayProductionSchemaSnapshot(wrongTriggerColumns), "replay_trigger_binding"),
  true
);

const broadIndex = validSnapshot();
broadIndex.index.predicate = null;
assert.equal(
  failedCheck(evaluateAdminTestReplayProductionSchemaSnapshot(broadIndex), "remediation_index_contract"),
  true
);

const poisonedReplay = validSnapshot();
poisonedReplay.invariants.active_admin_test_writer_final_replays = "1";
assert.equal(
  failedCheck(
    evaluateAdminTestReplayProductionSchemaSnapshot(poisonedReplay),
    "zero_active_admin_test_replays"
  ),
  true
);

const missingHistory = validSnapshot();
missingHistory.migrationHistory = { present: false, occurrence_count: 0, name: null };
assert.equal(
  failedCheck(evaluateAdminTestReplayProductionSchemaSnapshot(missingHistory), "migration_history"),
  true
);

const writableSnapshot = validSnapshot();
writableSnapshot.server.transaction_read_only = "off";
assert.equal(
  failedCheck(evaluateAdminTestReplayProductionSchemaSnapshot(writableSnapshot), "read_only_snapshot"),
  true
);

console.log(JSON.stringify({
  ok: true,
  contract: "admin-test-writer-final-replay-production-schema-v1",
  checksum: ADMIN_TEST_REPLAY_MIGRATION_SHA256,
  tamper_cases: 7
}, null, 2));
