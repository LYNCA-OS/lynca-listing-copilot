import assert from "node:assert/strict";
import {
  assertTrackCTestConnectedDatabase,
  assertTrackCTestDatabaseTarget,
  destructiveConfirmationEnv,
  destructiveConfirmationValue
} from "./track-c-postgres-target-guard.mjs";

function assertRejected(connectionString, env, expectedCode) {
  assert.throws(
    () => assertTrackCTestDatabaseTarget(connectionString, env),
    (error) => {
      assert.equal(error?.code, expectedCode);
      assert.doesNotMatch(String(error?.message || ""), /secret-password|db\.example|127\.0\.0\.1/);
      return true;
    }
  );
}

const local = assertTrackCTestDatabaseTarget(
  "postgresql://track_c:secret-password@127.0.0.1:5432/lynca_integration_test",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue }
);
assert.deepEqual(local, {
  hostname: "127.0.0.1",
  databaseName: "lynca_integration_test",
  loopback: true,
  mode: "loopback"
});
assert.equal(assertTrackCTestConnectedDatabase(local, "lynca_integration_test"), true);

for (const hostname of ["localhost", "localhost.", "127.9.8.7", "[::1]"]) {
  assert.equal(
    assertTrackCTestDatabaseTarget(`postgresql://${hostname}:5432/lynca_integration_test`, {
      NODE_ENV: "test",
      [destructiveConfirmationEnv]: destructiveConfirmationValue
    }).loopback,
    true
  );
}

assertRejected(
  "postgresql://track_c:secret-password@127.0.0.1:5432/postgres",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_name_must_be_test_only"
);
assertRejected(
  "postgresql://track_c:secret-password@127.0.0.1:5432/lynca_local",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_name_must_be_test_only"
);
assertRejected(
  "postgresql://track_c:secret-password@127.0.0.1:5432/lynca_integration_test",
  { NODE_ENV: "test" },
  "track_c_test_database_confirmation_required"
);

assertRejected(
  "postgresql://track_c:secret-password@127.0.0.1:1/production",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_production_name_forbidden"
);
assertRejected(
  "postgresql://track_c:secret-password@127.0.0.1:5432/lynca_integration_test",
  { NODE_ENV: "production", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_production_runtime_forbidden"
);
assertRejected(
  "postgresql://track_c:secret-password@db.example:5432/lynca_test",
  { NODE_ENV: "test" },
  "track_c_test_database_confirmation_required"
);
assertRejected(
  "postgresql://track_c:secret-password@db.example:5432/lynca_test",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: "true" },
  "track_c_test_database_confirmation_required"
);
assertRejected(
  "postgresql://track_c:secret-password@db.example:5432/postgres",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_name_must_be_test_only"
);
assertRejected(
  "postgresql://track_c:secret-password@db.example:5432/production_test",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_production_name_forbidden"
);
assertRejected(
  "postgresql://track_c:secret-password@db.example:5432/lynca_test_prod2",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_production_name_forbidden"
);
assertRejected(
  "postgresql://track_c:secret-password@127.0.0.1:5432/prod%75ction",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_production_name_forbidden"
);
assertRejected(
  "postgresql://track_c:secret-password@127.0.0.1:5432/lynca_integration_test?host=db.example",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_target_override_forbidden"
);
assertRejected(
  "https://db.example/lynca_test",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue },
  "track_c_test_database_protocol_invalid"
);

const remoteTest = assertTrackCTestDatabaseTarget(
  "postgresql://track_c:secret-password@db.example:5432/lynca_integration",
  { NODE_ENV: "test", [destructiveConfirmationEnv]: destructiveConfirmationValue }
);
assert.deepEqual(remoteTest, {
  hostname: "db.example",
  databaseName: "lynca_integration",
  loopback: false,
  mode: "confirmed_non_loopback_test"
});
assert.equal(assertTrackCTestConnectedDatabase(remoteTest, "lynca_integration"), true);
assert.throws(
  () => assertTrackCTestConnectedDatabase({ databaseName: "postgres", loopback: true }, "postgres"),
  (error) => error?.code === "track_c_test_database_connected_name_must_be_test_only"
);
assert.throws(
  () => assertTrackCTestConnectedDatabase(remoteTest, "postgres"),
  (error) => error?.code === "track_c_test_database_identity_mismatch"
);

console.log("Track C PostgreSQL target guard tests passed");
