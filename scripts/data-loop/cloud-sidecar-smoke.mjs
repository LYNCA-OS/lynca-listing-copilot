import { readFile } from "node:fs/promises";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function normalizeBaseUrl(value) {
  return cleanText(value).replace(/\/+$/, "");
}

async function loadEnvFile(path = "") {
  if (!path) return {};
  const env = {};
  const text = await readFile(path, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    env[key.trim()] = value;
  }
  return env;
}

function responseHeaders(headers = {}) {
  if (!headers) return {};
  if (typeof headers.get === "function") {
    return {
      cookie: headers.get("set-cookie") || headers.get("cookie") || ""
    };
  }
  return headers;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function login({ baseUrl, username, password, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) {
    const payload = await readJsonResponse(response);
    throw new Error(`cloud login failed: HTTP ${response.status} ${JSON.stringify(payload || {}).slice(0, 160)}`);
  }
  const headers = responseHeaders(response.headers);
  const cookie = cleanText(headers.cookie);
  if (!cookie) throw new Error("cloud login succeeded but no session cookie was returned");
  return cookie.split(";")[0];
}

function itemPayload(item = {}, index = 0) {
  return {
    candidate_id: item.candidate_id || item.id || `sidecar-smoke-${index + 1}`,
    source_feedback_id: item.source_feedback_id || item.source_record_id || null,
    category: item.category || "sports_card",
    images: item.images || [],
    provider: item.provider || "openai_legacy",
    provider_options: {
      ...(item.provider_options || {}),
      enable_evidence_completion: true,
      enable_catalog_assist: true,
      enable_vector_retrieval: true,
      vector_retrieval_mode: "assist"
    }
  };
}

async function loadItems(path, limit = 5) {
  const data = JSON.parse(await readFile(path, "utf8"));
  const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : [];
  return items.slice(0, Math.max(1, Number(limit) || 3));
}

async function supabaseRows({ env, table, fetchImpl = globalThis.fetch }) {
  const url = normalizeBaseUrl(env.SUPABASE_URL);
  const key = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  if (!url || !key) return { ok: false, reason: "supabase_not_configured", rows: [] };
  const response = await fetchImpl(`${url}/rest/v1/${table}?select=*&order=created_at.desc&limit=5`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`
    }
  });
  const payload = await readJsonResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    rows: Array.isArray(payload) ? payload : [],
    error: response.ok ? null : payload
  };
}

export async function runCloudSidecarSmoke({
  baseUrl,
  username,
  password,
  inputPath,
  limit = 3,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl) throw new Error("LISTING_API_BASE_URL or --base-url is required");
  if (!username || !password) throw new Error("METAVERSE_USERNAME and METAVERSE_PASSWORD are required");
  if (!inputPath) throw new Error("--input path is required");
  const items = await loadItems(inputPath, limit);
  if (!items.length) throw new Error("input dataset has no items");
  const cookie = await login({ baseUrl, username, password, fetchImpl });
  const responses = [];
  for (const [index, item] of items.entries()) {
    const response = await fetchImpl(`${baseUrl}/api/listing-copilot-title`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify(itemPayload(item, index))
    });
    const payload = await readJsonResponse(response);
    responses.push({
      candidate_id: item.candidate_id || item.id || `sidecar-smoke-${index + 1}`,
      status: response.status,
      ok: response.ok,
      title_available: Boolean(payload?.title || payload?.final_title),
      workflow_sidecars: payload?.workflow_sidecars || null,
      error: response.ok ? null : payload
    });
  }

  const tableChecks = {};
  for (const table of [
    "recognition_workflow_events",
    "annotation_tasks",
    "data_quality_findings",
    "hard_negative_examples"
  ]) {
    tableChecks[table] = await supabaseRows({ env, table, fetchImpl });
  }

  return {
    base_url: baseUrl,
    item_count: items.length,
    all_main_api_ok: responses.every((item) => item.ok && item.workflow_sidecars),
    responses,
    table_checks: tableChecks
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const envFile = cleanText(argValue(argv, "--env-file", process.env.CLOUD_SIDECAR_SMOKE_ENV_FILE || ".env.local"));
  const fileEnv = await loadEnvFile(envFile);
  const env = { ...fileEnv, ...process.env };
  const baseUrl = normalizeBaseUrl(argValue(argv, "--base-url", env.LISTING_API_BASE_URL || env.API_BASE_URL));
  const username = cleanText(argValue(argv, "--username", env.METAVERSE_USERNAME));
  const password = cleanText(argValue(argv, "--password", env.METAVERSE_PASSWORD));
  const inputPath = cleanText(argValue(argv, "--input", env.CLOUD_SIDECAR_SMOKE_INPUT));
  const limit = Number(argValue(argv, "--limit", env.CLOUD_SIDECAR_SMOKE_LIMIT || "3"));
  if (hasFlag(argv, "--dry-run")) {
    console.log(JSON.stringify({
      env_file_loaded: Boolean(Object.keys(fileEnv).length),
      base_url_configured: Boolean(baseUrl),
      username_configured: Boolean(username),
      password_configured: Boolean(password),
      input_configured: Boolean(inputPath),
      supabase_configured: Boolean(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)),
      would_run_limit: limit
    }, null, 2));
  } else {
    runCloudSidecarSmoke({ baseUrl, username, password, inputPath, limit, env })
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        if (!report.all_main_api_ok) process.exitCode = 1;
      })
      .catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
      });
  }
}
