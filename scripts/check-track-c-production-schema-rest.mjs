#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  TRACK_C_REST_SCHEMA_CONTRACT,
  evaluateTrackCProductionSchemaSnapshot
} from "./check-track-c-production-schema.mjs";

const OPENAPI_ACCEPT = "application/openapi+json";
const JSON_ACCEPT = "application/json";
const MAX_OPENAPI_BYTES = 10 * 1024 * 1024;

function cleanText(value) {
  return String(value || "").trim();
}

function sortedStrings(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean)
    .sort();
}

function sameStrings(actual, expected) {
  const left = sortedStrings(actual);
  const right = sortedStrings(expected);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : "";
}

function normalizeSupabaseOrigin(value) {
  const raw = cleanText(value).replace(/\/+$/, "");
  if (!raw) return "";
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("SUPABASE_URL must use https");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("SUPABASE_URL must be an origin without credentials, query, or fragment");
  }
  return url.origin;
}

function safeError(error, redactions = []) {
  let message = cleanText(error?.message || error || "rest_schema_preflight_failed");
  for (const value of redactions.map(cleanText).filter(Boolean)) {
    message = message.split(value).join("[redacted]");
  }
  return {
    error_type: cleanText(error?.code || error?.name || "REST_SCHEMA_PREFLIGHT_ERROR").slice(0, 120),
    error_message: message.slice(0, 500)
  };
}

function writeReport(report, outputPath = "") {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, text, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(text);
}

function authHeaders(serviceRoleKey, accept = JSON_ACCEPT) {
  return {
    accept,
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenApi({ fetchImpl, origin, serviceRoleKey, timeoutMs }) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${origin}/rest/v1/`,
    {
      method: "GET",
      headers: authHeaders(serviceRoleKey, OPENAPI_ACCEPT),
      redirect: "error"
    },
    timeoutMs
  );
  if (!response?.ok) {
    throw Object.assign(new Error(`Supabase OpenAPI request failed with HTTP ${response?.status || 0}`), {
      code: "OPENAPI_HTTP_ERROR"
    });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_OPENAPI_BYTES) {
    throw Object.assign(new Error("Supabase OpenAPI response exceeded the size limit"), {
      code: "OPENAPI_RESPONSE_TOO_LARGE"
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Supabase OpenAPI response was not valid JSON"), {
      code: "OPENAPI_INVALID_JSON"
    });
  }
}

async function fetchCatalogAttestation({ fetchImpl, origin, serviceRoleKey, timeoutMs }) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${origin}/rest/v1/rpc/track_c_production_schema_catalog_snapshot`,
    {
      method: "POST",
      headers: {
        ...authHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: "{}",
      redirect: "error"
    },
    timeoutMs
  );
  if (!response?.ok) {
    throw Object.assign(new Error(`Supabase catalog attestation failed with HTTP ${response?.status || 0}`), {
      code: "CATALOG_ATTESTATION_HTTP_ERROR"
    });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_OPENAPI_BYTES) {
    throw Object.assign(new Error("Supabase catalog attestation exceeded the size limit"), {
      code: "CATALOG_ATTESTATION_TOO_LARGE"
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Supabase catalog attestation was not valid JSON"), {
      code: "CATALOG_ATTESTATION_INVALID_JSON"
    });
  }
}

function parseSignature(signature) {
  const match = cleanText(signature).match(/^([^()]+)\((.*)\)$/);
  if (!match) return { name: "", formats: [] };
  return {
    name: match[1],
    formats: match[2] ? match[2].split(",").map(cleanText) : []
  };
}

function rpcBodySchema(openApi, name) {
  const parameters = openApi?.paths?.[`/rpc/${name}`]?.post?.parameters;
  if (!Array.isArray(parameters)) return null;
  return parameters.find((parameter) => parameter?.in === "body" && parameter?.name === "args")?.schema || null;
}

function propertyFormat(property) {
  return cleanText(property?.format || property?.type);
}

function evaluateOpenApi(openApi, origin) {
  const definitions = openApi?.definitions || openApi?.components?.schemas || {};
  const expectedHost = new URL(origin).hostname;
  const documentedHost = cleanText(openApi?.host).replace(/:\d+$/, "");
  const source = {
    requirement: "https_openapi_v2_for_configured_supabase_host",
    ok: Boolean(
      openApi?.swagger === "2.0"
      && Array.isArray(openApi?.schemes)
      && openApi.schemes.includes("https")
      && documentedHost === expectedHost
      && openApi?.info?.title === "standard public schema"
    ),
    actual: {
      swagger: cleanText(openApi?.swagger) || null,
      https: Array.isArray(openApi?.schemes) && openApi.schemes.includes("https"),
      host_matches: documentedHost === expectedHost,
      public_schema: openApi?.info?.title === "standard public schema"
    }
  };

  const tables = TRACK_C_REST_SCHEMA_CONTRACT.requiredTables.map((table) => {
    const definition = definitions?.[table];
    return {
      table,
      requirement: "public_table_object_schema",
      ok: Boolean(definition && definition.type === "object" && definition.properties),
      property_count: definition?.properties ? Object.keys(definition.properties).length : 0
    };
  });

  const columns = TRACK_C_REST_SCHEMA_CONTRACT.criticalColumns.map((expected) => {
    const definition = definitions?.[expected.table];
    const property = definition?.properties?.[expected.column];
    const required = Array.isArray(definition?.required)
      && definition.required.includes(expected.column);
    const defaultMatches = expected.default === undefined
      || (expected.default === null
        ? !Object.hasOwn(property || {}, "default")
        : property?.default === expected.default);
    return {
      table: expected.table,
      column: expected.column,
      requirement: "exact_postgrest_column_contract",
      ok: Boolean(
        property
        && propertyFormat(property) === expected.format
        && (expected.required === undefined || required === expected.required)
        && defaultMatches
      ),
      actual: property
        ? {
            format: propertyFormat(property),
            required,
            default: Object.hasOwn(property, "default") ? property.default : null
          }
        : null
    };
  });

  const functions = TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions.map((signature) => {
    const expected = parseSignature(signature);
    const rpcPost = openApi?.paths?.[`/rpc/${expected.name}`]?.post;
    const schema = rpcBodySchema(openApi, expected.name);
    const actualFormats = Object.values(schema?.properties || {}).map(propertyFormat);
    return {
      signature,
      requirement: "rpc_present_with_exact_argument_type_multiset",
      ok: Boolean(
        rpcPost
        && (
          expected.formats.length === 0
            ? (!schema || Object.keys(schema.properties || {}).length === 0)
            : (schema?.type === "object" && sameStrings(actualFormats, expected.formats))
        )
      ),
      argument_count: actualFormats.length
    };
  });

  const atomicExpected = TRACK_C_REST_SCHEMA_CONTRACT.atomicEnqueueRpc;
  const atomicSchema = rpcBodySchema(openApi, atomicExpected.name);
  const atomicProperties = Object.fromEntries(
    Object.entries(atomicSchema?.properties || {}).map(([name, property]) => (
      [name, propertyFormat(property)]
    ))
  );
  const atomicEnqueueRpc = {
    rpc: atomicExpected.name,
    requirement: "single_canonical_named_argument_contract_without_overload_shape",
    ok: Boolean(
      atomicSchema
      && atomicSchema.type === "object"
      && !atomicSchema.oneOf
      && !atomicSchema.anyOf
      && sameStrings(Object.keys(atomicProperties), Object.keys(atomicExpected.properties))
      && Object.entries(atomicExpected.properties).every(([name, format]) => (
        atomicProperties[name] === format
      ))
      && sameStrings(atomicSchema.required, atomicExpected.required)
    ),
    actual: {
      properties: atomicProperties,
      required: sortedStrings(atomicSchema?.required),
      overloaded_shape: Boolean(atomicSchema?.oneOf || atomicSchema?.anyOf)
    }
  };

  return { source, tables, columns, functions, atomic_enqueue_rpc: atomicEnqueueRpc };
}

function normalizeProcedureSignature(value) {
  return cleanText(value).replace(/^public\./, "").replace(/^"public"\./, "");
}

function normalizeCatalogSnapshot(raw = {}) {
  const requiredTables = new Set(TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredTables);
  const tableMap = new Map((Array.isArray(raw.tables) ? raw.tables : [])
    .map((row) => [row.table_name, row]));
  const aclMap = new Map((Array.isArray(raw.table_acls) ? raw.table_acls : [])
    .map((row) => [row.table_name, row]));
  const procedureMap = new Map((Array.isArray(raw.procedures) ? raw.procedures : [])
    .map((row) => [normalizeProcedureSignature(row.signature), row]));
  const resolvedFunctions = (signatures) => signatures.map((signature) => ({
    signature,
    resolved_signature: procedureMap.has(signature) ? signature : null
  }));

  return {
    tables: TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredTables.map((table) => (
      tableMap.get(table) || { table_name: table, present: false }
    )),
    columns: (Array.isArray(raw.columns) ? raw.columns : [])
      .filter((row) => requiredTables.has(row.table_name)),
    functions: resolvedFunctions(TRACK_C_REST_SCHEMA_CONTRACT.requiredFunctions),
    forbiddenFunctions: resolvedFunctions(TRACK_C_REST_SCHEMA_CONTRACT.forbiddenFunctions),
    policies: Array.isArray(raw.policies) ? raw.policies : [],
    triggers: Array.isArray(raw.triggers) ? raw.triggers : [],
    constraints: (Array.isArray(raw.constraints) ? raw.constraints : [])
      .filter((row) => requiredTables.has(row.table_name)),
    indexes: Array.isArray(raw.indexes) ? raw.indexes : [],
    browserAcls: TRACK_C_REST_SCHEMA_CONTRACT.catalogRequiredTables.map((table) => (
      aclMap.get(table) || { table_name: table }
    )),
    factAcls: TRACK_C_REST_SCHEMA_CONTRACT.serviceOnlyFactTables.map((table) => (
      aclMap.get(table) || { table_name: table }
    )),
    functionAcls: TRACK_C_REST_SCHEMA_CONTRACT.serviceOnlyFunctions.map((signature) => {
      const row = procedureMap.get(signature);
      return {
        signature,
        resolved_signature: row ? signature : null,
        anon_execute: row?.anon_execute === true,
        authenticated_execute: row?.authenticated_execute === true,
        service_execute: row?.service_execute === true
      };
    }),
    dataInvariants: raw.data_invariants || {},
    server: raw.server || {},
    executionBoundary: raw.execution_boundary || {}
  };
}

function evaluateCatalogAttestation(raw = {}) {
  const meta = raw?.meta || {};
  const safeSearchPath = Array.isArray(meta.search_path)
    && meta.search_path.some((setting) => /^search_path=(?:""|)$/.test(cleanText(setting)));
  const metaCheck = {
    requirement: "service_role_stable_security_definer_with_empty_search_path",
    ok: Boolean(
      meta.contract_version === "track_c_catalog_snapshot_v1"
      && meta.function_volatility === "s"
      && meta.security_definer === true
      && meta.request_role === "service_role"
      && safeSearchPath
    ),
    actual: {
      contract_version: cleanText(meta.contract_version) || null,
      stable: meta.function_volatility === "s",
      security_definer: meta.security_definer === true,
      service_role: meta.request_role === "service_role",
      empty_search_path: safeSearchPath
    }
  };
  const evaluation = evaluateTrackCProductionSchemaSnapshot(normalizeCatalogSnapshot(raw));
  return {
    requirement: "same_strong_catalog_contract_as_direct_postgres_preflight",
    ok: metaCheck.ok && evaluation.failedChecks === 0,
    failed_check_count: evaluation.failedChecks + (metaCheck.ok ? 0 : 1),
    meta: metaCheck,
    checks: evaluation.sections
  };
}

function criticalColumnsByTable() {
  const map = new Map();
  for (const { table, column } of TRACK_C_REST_SCHEMA_CONTRACT.criticalColumns) {
    const columns = map.get(table) || [];
    columns.push(column);
    map.set(table, columns);
  }
  return map;
}

async function runReadOnlyProbes({ fetchImpl, origin, serviceRoleKey, timeoutMs, openApi }) {
  const definitions = openApi?.definitions || openApi?.components?.schemas || {};
  const criticalByTable = criticalColumnsByTable();
  const probes = [];

  for (const table of TRACK_C_REST_SCHEMA_CONTRACT.requiredTables) {
    const fallbackColumn = Object.keys(definitions?.[table]?.properties || {})[0];
    const columns = [...new Set(criticalByTable.get(table) || [fallbackColumn])].filter(Boolean);
    const query = new URLSearchParams({ select: columns.join(","), limit: "0" });
    const response = await fetchWithTimeout(
      fetchImpl,
      `${origin}/rest/v1/${encodeURIComponent(table)}?${query}`,
      {
        method: "HEAD",
        headers: authHeaders(serviceRoleKey),
        redirect: "error"
      },
      timeoutMs
    );
    probes.push({
      table,
      requirement: "service_role_read_only_schema_probe",
      ok: Boolean(response?.ok),
      status: Number(response?.status || 0)
    });
  }

  const opsResponse = await fetchWithTimeout(
    fetchImpl,
    `${origin}/rest/v1/rpc/track_c_ops_snapshot`,
    {
      method: "POST",
      headers: {
        ...authHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: "{}",
      redirect: "error"
    },
    timeoutMs
  );
  const opsSnapshot = {
    rpc: "track_c_ops_snapshot",
    requirement: "service_role_read_only_runtime_probe",
    ok: Boolean(opsResponse?.ok),
    status: Number(opsResponse?.status || 0)
  };

  return { table_probes: probes, ops_snapshot: opsSnapshot };
}

function flattenChecks(sections) {
  return Object.values(sections).flatMap((section) => (
    Array.isArray(section) ? section : [section]
  ));
}

export async function checkTrackCProductionSchemaRest({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  checkedAt = new Date(),
  timeoutMs = 15_000,
  activeProbes = true
} = {}) {
  const rawUrl = cleanText(supabaseUrl);
  const key = cleanText(serviceRoleKey);
  const baseReport = {
    contract: "track_c_d_production_schema_rest_preflight_v1",
    checked_at: checkedAt.toISOString(),
    configured: Boolean(rawUrl && key),
    transport: "supabase_data_api_openapi",
    read_only_requested: true,
    read_only: true
  };

  if (!rawUrl || !key) {
    return {
      ...baseReport,
      ok: false,
      error_type: "SUPABASE_REST_NOT_CONFIGURED",
      error_message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the REST schema preflight."
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ...baseReport,
      ok: false,
      error_type: "FETCH_NOT_AVAILABLE",
      error_message: "A fetch implementation is required for the REST schema preflight."
    };
  }

  let origin = "";
  try {
    origin = normalizeSupabaseOrigin(rawUrl);
    const openApi = await fetchOpenApi({ fetchImpl, origin, serviceRoleKey: key, timeoutMs });
    const catalogSnapshot = await fetchCatalogAttestation({
      fetchImpl,
      origin,
      serviceRoleKey: key,
      timeoutMs
    });
    const openApiChecks = evaluateOpenApi(openApi, origin);
    const catalogAttestation = evaluateCatalogAttestation(catalogSnapshot);
    const probes = activeProbes
      ? await runReadOnlyProbes({ fetchImpl, origin, serviceRoleKey: key, timeoutMs, openApi })
      : { table_probes: [], ops_snapshot: { requirement: "disabled", ok: true, status: 0 } };
    const surfaceChecks = { ...openApiChecks, ...probes };
    const failedCheckCount = flattenChecks(surfaceChecks).filter((check) => check.ok !== true).length
      + catalogAttestation.failed_check_count;
    const checks = { ...openApiChecks, catalog_attestation: catalogAttestation, ...probes };
    return {
      ...baseReport,
      ok: failedCheckCount === 0,
      endpoint_host: new URL(origin).hostname,
      failed_check_count: failedCheckCount,
      checks
    };
  } catch (error) {
    return {
      ...baseReport,
      ok: false,
      endpoint_host: origin ? new URL(origin).hostname : null,
      ...safeError(error, [key, rawUrl, origin])
    };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const outputPath = argumentValue(argv, "--out");
  const report = await checkTrackCProductionSchemaRest({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  writeReport(report, outputPath);
  process.exitCode = report.ok ? 0 : 1;
}

const isEntrypoint = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  await main();
}
