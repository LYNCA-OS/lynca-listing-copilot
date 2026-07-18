import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const workflowContextMigrationFile = "supabase/migrations/20260703112438_feedback_workflow_context_v0.sql";

export const requiredWorkflowContextColumns = Object.freeze([
  Object.freeze({ table: "listing_analysis_runs", column: "open_set_readiness" }),
  Object.freeze({ table: "listing_analysis_runs", column: "workflow_summary" }),
  Object.freeze({ table: "listing_analysis_runs", column: "workflow_sidecars" }),
  Object.freeze({ table: "listing_analysis_runs", column: "workflow_action_plan" }),
  Object.freeze({ table: "listing_reviews", column: "workflow_summary" })
]);

export const requiredWorkflowContextIndexes = Object.freeze([
  Object.freeze({ table: "listing_analysis_runs", index: "listing_analysis_runs_open_set_status_idx" }),
  Object.freeze({ table: "listing_analysis_runs", index: "listing_analysis_runs_workflow_status_idx" }),
  Object.freeze({ table: "listing_reviews", index: "listing_reviews_workflow_status_idx" })
]);

const defaultEnvFiles = Object.freeze([
  ".env.vercel.production.local",
  ".vercel/.env.production.local",
  ".env.cloud-eval.local",
  ".env.local",
  ".env"
]);

function cleanText(value) {
  return String(value || "").trim();
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function argValues(argv, name) {
  const values = [];
  argv.forEach((item, index) => {
    if (item === name && argv[index + 1]) values.push(argv[index + 1]);
    if (item.startsWith(`${name}=`)) values.push(item.slice(name.length + 1));
  });
  return values;
}

function redact(value, secrets = []) {
  let output = String(value || "");
  secrets.filter(Boolean).forEach((secret) => {
    output = output.split(secret).join("[redacted]");
  });
  return output;
}

export function parseEnvFileContent(content = "") {
  const parsed = {};
  String(content || "").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;

    let value = match[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  });
  return parsed;
}

export function loadEnvFiles({ cwd = process.cwd(), envFiles = defaultEnvFiles } = {}) {
  const loaded = [];
  const values = {};

  envFiles.forEach((envFile) => {
    const filePath = path.isAbsolute(envFile) ? envFile : path.join(cwd, envFile);
    if (!fs.existsSync(filePath)) return;

    const parsed = parseEnvFileContent(fs.readFileSync(filePath, "utf8"));
    loaded.push(path.relative(cwd, filePath) || filePath);
    Object.entries(parsed).forEach(([key, value]) => {
      if (cleanText(value) && !cleanText(values[key])) values[key] = value;
    });
  });

  return { values, loaded };
}

function mergeRuntimeEnv(fileEnv = {}, runtimeEnv = {}) {
  const merged = { ...fileEnv };
  Object.entries(runtimeEnv).forEach(([key, value]) => {
    if (cleanText(value)) merged[key] = value;
  });
  return merged;
}

export function resolveSchemaCheckConfig({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const noEnvFile = hasFlag(argv, "--no-env-file");
  const explicitEnvFiles = argValues(argv, "--env-file");
  const envFileList = noEnvFile
    ? []
    : (explicitEnvFiles.length ? explicitEnvFiles : defaultEnvFiles);
  const { values: fileEnv, loaded } = loadEnvFiles({ cwd, envFiles: envFileList });
  const merged = mergeRuntimeEnv(fileEnv, env);
  const supabaseUrl = cleanText(merged.SUPABASE_URL || merged.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = cleanText(merged.SUPABASE_SERVICE_ROLE_KEY || merged.SUPABASE_SECRET_KEY);

  return {
    mode: supabaseUrl && serviceRoleKey ? "supabase_rest" : "not_configured",
    supabaseUrl,
    serviceRoleKey,
    loaded_env_files: loaded,
    timeoutMs: Number(cleanText(merged.SUPABASE_SCHEMA_CHECK_TIMEOUT_MS)) || 12000
  };
}

function classifyRestFailure({ status, text }) {
  if (status === 401) return "AUTH_401";
  if (status === 403) return "AUTH_403";
  if (status === 404) return "TABLE_NOT_EXPOSED_OR_MISSING";
  if (status === 429) return "RATE_LIMITED";
  if (/Could not find the '[a-z0-9_]+' column/i.test(text) || /schema cache/i.test(text)) return "COLUMN_MISSING_OR_SCHEMA_CACHE_STALE";
  return "REST_SCHEMA_CHECK_FAILED";
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch (error) {
    return String(error?.message || error || "");
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  if (!timeoutMs || typeof AbortController === "undefined") {
    return fetchImpl(url, options);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkColumnViaRest({ table, column, config, fetchImpl }) {
  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  endpoint.searchParams.set("select", column);
  endpoint.searchParams.set("limit", "0");

  try {
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "GET",
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`
      }
    }, config.timeoutMs);
    const text = await readResponseText(response);
    if (response.ok) {
      return { table, column, ok: true, status: response.status, error_type: null, error_message: null };
    }

    const safeText = redact(text, [config.serviceRoleKey, config.supabaseUrl]);
    return {
      table,
      column,
      ok: false,
      status: response.status,
      error_type: classifyRestFailure({ status: response.status, text: safeText }),
      error_message: safeText.slice(0, 500)
    };
  } catch (error) {
    const message = redact(error?.message || error || "", [config.serviceRoleKey, config.supabaseUrl]);
    return {
      table,
      column,
      ok: false,
      status: 0,
      error_type: /aborted/i.test(message) ? "TIMEOUT" : "NETWORK_ERROR",
      error_message: message.slice(0, 500)
    };
  }
}

export async function checkWorkflowContextSchema({
  argv = [],
  env = process.env,
  cwd = process.cwd(),
  fetchImpl = globalThis.fetch
} = {}) {
  const config = resolveSchemaCheckConfig({ argv, env, cwd });
  const checkedAt = new Date().toISOString();

  if (config.mode === "not_configured") {
    return {
      ok: false,
      configured: false,
      mode: "not_configured",
      checked_at: checkedAt,
      loaded_env_files: config.loaded_env_files,
      migration_file: workflowContextMigrationFile,
      required_columns: requiredWorkflowContextColumns.map((item) => ({ ...item, ok: null })),
      required_indexes: requiredWorkflowContextIndexes.map((item) => ({
        ...item,
        ok: null,
        check_mode: "requires_sql_or_migration_history"
      })),
      summary: {
        column_ok_count: 0,
        column_required_count: requiredWorkflowContextColumns.length,
        index_ok_count: null,
        index_required_count: requiredWorkflowContextIndexes.length
      },
      next_action: "Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or apply the migration from a linked Supabase environment."
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      configured: true,
      mode: "supabase_rest",
      checked_at: checkedAt,
      loaded_env_files: config.loaded_env_files,
      migration_file: workflowContextMigrationFile,
      required_columns: requiredWorkflowContextColumns.map((item) => ({
        ...item,
        ok: false,
        status: 0,
        error_type: "FETCH_UNAVAILABLE",
        error_message: "global fetch is unavailable"
      })),
      required_indexes: requiredWorkflowContextIndexes.map((item) => ({
        ...item,
        ok: null,
        check_mode: "requires_sql_or_migration_history"
      })),
      summary: {
        column_ok_count: 0,
        column_required_count: requiredWorkflowContextColumns.length,
        index_ok_count: null,
        index_required_count: requiredWorkflowContextIndexes.length
      },
      next_action: "Run with Node.js 18+ or provide a fetch implementation."
    };
  }

  const requiredColumns = await Promise.all(
    requiredWorkflowContextColumns.map((item) => checkColumnViaRest({
      ...item,
      config,
      fetchImpl
    }))
  );
  const columnOkCount = requiredColumns.filter((item) => item.ok).length;
  const ok = columnOkCount === requiredWorkflowContextColumns.length;

  return {
    ok,
    configured: true,
    mode: "supabase_rest",
    checked_at: checkedAt,
    loaded_env_files: config.loaded_env_files,
    migration_file: workflowContextMigrationFile,
    required_columns: requiredColumns,
    required_indexes: requiredWorkflowContextIndexes.map((item) => ({
      ...item,
      ok: null,
      check_mode: "unverified_by_rest",
      note: "REST confirms write-path column visibility; index verification requires SQL or migration history."
    })),
    summary: {
      column_ok_count: columnOkCount,
      column_required_count: requiredWorkflowContextColumns.length,
      index_ok_count: null,
      index_required_count: requiredWorkflowContextIndexes.length
    },
    next_action: ok
      ? "Workflow context columns are visible to Supabase REST writes."
      : `Apply ${workflowContextMigrationFile} and refresh PostgREST schema cache if needed.`
  };
}

function formatTextReport(result) {
  const lines = [
    `feedback_workflow_context_schema: ${result.ok ? "OK" : "NOT_READY"}`,
    `mode: ${result.mode}`,
    `migration_file: ${result.migration_file}`,
    `columns: ${result.summary.column_ok_count}/${result.summary.column_required_count}`,
    `indexes: ${result.summary.index_ok_count === null ? "unverified_by_rest" : `${result.summary.index_ok_count}/${result.summary.index_required_count}`}`,
    "required_columns:"
  ];

  result.required_columns.forEach((item) => {
    const state = item.ok === null ? "UNVERIFIED" : (item.ok ? "OK" : "MISSING");
    lines.push(`  - ${item.table}.${item.column}: ${state}${item.error_type ? ` (${item.error_type})` : ""}`);
  });
  lines.push(`next_action: ${result.next_action}`);
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2), {
  env = process.env,
  cwd = process.cwd(),
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  const result = await checkWorkflowContextSchema({ argv, env, cwd, fetchImpl });
  const json = hasFlag(argv, "--json");
  const allowMissingConfig = hasFlag(argv, "--allow-missing-config");
  const output = json ? `${JSON.stringify(result, null, 2)}\n` : `${formatTextReport(result)}\n`;
  stdout.write(output);

  if (!result.ok && !(allowMissingConfig && result.mode === "not_configured")) {
    stderr.write("Feedback workflow context schema is not ready.\n");
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
