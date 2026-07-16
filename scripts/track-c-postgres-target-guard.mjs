const destructiveConfirmationEnv = "TRACK_C_CONFIRM_DESTRUCTIVE_DB_TEST";
const destructiveConfirmationValue = "ALLOW_TRACK_C_DESTRUCTIVE_TEST_DATABASE";
const productionRuntimeKeys = [
  "NODE_ENV",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "DEPLOYMENT_ENV",
  "CI_ENVIRONMENT_NAME",
  "APP_ENV"
];
const productionRuntimeValues = new Set(["prod", "production", "live"]);
const productionDatabaseTokens = new Set(["prod", "production", "live", "main"]);
const testDatabaseTokens = new Set(["test", "tests", "testing", "ci", "e2e", "integration", "sandbox", "ephemeral"]);

export {
  destructiveConfirmationEnv,
  destructiveConfirmationValue
};

function reject(code) {
  throw Object.assign(new Error(code), { code });
}

function normalizedHostname(hostname = "") {
  const value = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  return value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
}

function isLoopbackHostname(hostname = "") {
  const value = normalizedHostname(hostname);
  if (value === "localhost" || value === "::1") return true;
  const octets = value.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function databaseNameTokens(databaseName = "") {
  return String(databaseName || "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isProductionDatabaseName(databaseName = "") {
  const normalized = String(databaseName || "").trim().toLowerCase();
  const compactProductionName = /^(?:prod|production|live|main)(?:db|database|\d+)?$/.test(normalized);
  const labeledProductionName = /(?:^|[_-])(?:prod|production|live|main)(?:\d+)?(?:[_-]|$)/.test(normalized);
  return compactProductionName || labeledProductionName || databaseNameTokens(normalized).some((token) => productionDatabaseTokens.has(token));
}

function isExplicitTestDatabaseName(databaseName = "") {
  const normalized = String(databaseName || "").trim().toLowerCase();
  const compactTestName = /^(?:test|tests|testing|ci|e2e|integration|sandbox|ephemeral)(?:db|database)?$/.test(normalized);
  return compactTestName || databaseNameTokens(normalized).some((token) => testDatabaseTokens.has(token));
}

function productionRuntimeKey(env = {}) {
  return productionRuntimeKeys.find((key) => productionRuntimeValues.has(String(env[key] || "").trim().toLowerCase())) || "";
}

function databaseNameFromUrl(parsed) {
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(String(parsed.pathname || "").replace(/^\//, ""));
  } catch {
    reject("track_c_test_database_name_invalid");
  }
  if (!databaseName || databaseName.includes("/") || databaseName.includes("\\") || databaseName.includes("\0")) {
    reject("track_c_test_database_name_invalid");
  }
  return databaseName;
}

export function assertTrackCTestDatabaseTarget(connectionString, env = process.env) {
  let parsed;
  try {
    parsed = new URL(String(connectionString || "").trim());
  } catch {
    reject("track_c_test_database_url_invalid");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    reject("track_c_test_database_protocol_invalid");
  }
  if (parsed.hash) reject("track_c_test_database_url_ambiguous");
  const targetOverride = [...parsed.searchParams.keys()]
    .some((key) => ["host", "hostaddr", "service"].includes(String(key).trim().toLowerCase()));
  if (targetOverride) reject("track_c_test_database_target_override_forbidden");

  const hostname = normalizedHostname(parsed.hostname);
  if (!hostname) reject("track_c_test_database_host_missing");
  const databaseName = databaseNameFromUrl(parsed);
  if (isProductionDatabaseName(databaseName)) {
    reject("track_c_test_database_production_name_forbidden");
  }
  if (!isExplicitTestDatabaseName(databaseName)) {
    reject("track_c_test_database_name_must_be_test_only");
  }
  const runtimeKey = productionRuntimeKey(env);
  if (runtimeKey) reject("track_c_test_database_production_runtime_forbidden");
  if (String(env[destructiveConfirmationEnv] || "").trim() !== destructiveConfirmationValue) {
    reject("track_c_test_database_confirmation_required");
  }

  const loopback = isLoopbackHostname(hostname);

  return Object.freeze({
    hostname,
    databaseName,
    loopback,
    mode: loopback ? "loopback" : "confirmed_non_loopback_test"
  });
}

export function assertTrackCTestConnectedDatabase(target = {}, connectedDatabaseName = "") {
  const actual = String(connectedDatabaseName || "").trim();
  if (!actual || actual !== target.databaseName) {
    reject("track_c_test_database_identity_mismatch");
  }
  if (isProductionDatabaseName(actual)) {
    reject("track_c_test_database_production_name_forbidden");
  }
  if (!isExplicitTestDatabaseName(actual)) {
    reject("track_c_test_database_connected_name_must_be_test_only");
  }
  return true;
}
