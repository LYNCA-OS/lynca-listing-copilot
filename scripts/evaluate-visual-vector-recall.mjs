import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultVisualEmbeddingModelId,
  defaultVisualEmbeddingModelRevision
} from "../lib/listing/retrieval/vector-model-defaults.mjs";

const defaultIndexReportPath = "data/eval/provider-regression-30/visual-vector-index-local-10-rerun.json";
const defaultOutPath = "data/eval/provider-regression-30/visual-vector-recall-latest.json";
const defaultEnvFilePath = ".env.local";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function unquoteEnvValue(value = "") {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  return trimmed;
}

async function readEnvFile(path = "") {
  const resolved = resolve(path || "");
  if (!path || !existsSync(resolved)) return {};
  const text = await readFile(resolved, "utf8");
  const parsed = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    parsed[key] = unquoteEnvValue(trimmed.slice(separator + 1));
  });
  return parsed;
}

async function runtimeEnvFromFiles(argv = process.argv, env = process.env) {
  if (hasFlag(argv, "--no-env-file")) return { ...env };
  const envFilePath = argValue(argv, "--env-file", env.VISUAL_VECTOR_RECALL_ENV_FILE || defaultEnvFilePath);
  const fileEnv = await readEnvFile(envFilePath);
  return { ...fileEnv, ...env };
}

function cleanText(value) {
  return String(value || "").trim();
}

function supabaseConfig(env = {}) {
  const url = cleanText(env.SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  return {
    url,
    serviceRoleKey,
    modelId: cleanText(env.VISUAL_VECTOR_MODEL_ID || env.VISUAL_EMBEDDING_MODEL_ID) || defaultVisualEmbeddingModelId,
    modelRevision: cleanText(env.VISUAL_VECTOR_MODEL_REVISION || env.VISUAL_EMBEDDING_MODEL_REVISION) || defaultVisualEmbeddingModelRevision
  };
}

function assertConfig(config = {}) {
  if (!config.url) throw new Error("SUPABASE_URL is required.");
  if (!config.serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required.");
}

function headers(config = {}) {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json"
  };
}

async function fetchJson({ config, path, method = "GET", body, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
    method,
    headers: headers(config),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload?.message || payload?.error || JSON.stringify(payload || {});
    throw new Error(`Supabase REST ${method} ${path} failed: HTTP ${response.status} ${String(message).slice(0, 240)}`);
  }
  return payload;
}

function identityKeysFromIndexReport(report = {}) {
  return (Array.isArray(report.items) ? report.items : [])
    .filter((item) => item.ok && item.identity_key)
    .map((item) => item.identity_key);
}

function parseEmbedding(value) {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("[") && text.endsWith("]")) return JSON.parse(text).map(Number);
    return text.split(",").map((part) => Number(part.trim())).filter((number) => Number.isFinite(number));
  }
  return [];
}

function inList(values = []) {
  return `in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(",")})`;
}

async function readIdentities(config, identityKeys, fetchImpl) {
  if (!identityKeys.length) return [];
  const rows = await fetchJson({
    config,
    path: `card_identities?select=identity_id,identity_key,canonical_title,retrieval_status,retrieval_enabled&identity_key=${encodeURIComponent(inList(identityKeys))}`,
    fetchImpl
  });
  return Array.isArray(rows) ? rows : [];
}

async function readEmbeddings(config, identityIds, fetchImpl) {
  if (!identityIds.length) return [];
  const rows = await fetchJson({
    config,
    path: `card_image_embeddings?select=embedding_id,identity_id,reference_image_id,embedding_role,model_id,model_revision,preprocessing_version,embedding&identity_id=${encodeURIComponent(inList(identityIds))}&order=created_at.asc`,
    fetchImpl
  });
  return Array.isArray(rows) ? rows : [];
}

async function matchEmbedding(config, embeddingRow, {
  matchCount = 5,
  threshold = 0,
  includeCandidates = true,
  fetchImpl
} = {}) {
  const embedding = parseEmbedding(embeddingRow.embedding);
  if (embedding.length !== 768) {
    throw new Error(`Embedding ${embeddingRow.embedding_id} has ${embedding.length} dimensions.`);
  }
  const rows = await fetchJson({
    config,
    path: "rpc/match_card_image_embeddings",
    method: "POST",
    body: {
      query_embedding: embedding,
      match_model_id: embeddingRow.model_id || config.modelId,
      match_model_revision: embeddingRow.model_revision || config.modelRevision,
      match_embedding_role: embeddingRow.embedding_role || null,
      match_category: null,
      match_count: matchCount,
      match_threshold: threshold,
      include_candidate_identities: includeCandidates
    },
    fetchImpl
  });
  return Array.isArray(rows) ? rows : [];
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(6)) : null;
}

export async function evaluateVisualVectorRecall({
  indexReportPath = defaultIndexReportPath,
  outPath = defaultOutPath,
  limit = 0,
  matchCount = 5,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const config = supabaseConfig(env);
  assertConfig(config);
  const indexReport = JSON.parse(await readFile(resolve(indexReportPath), "utf8"));
  const identityKeys = identityKeysFromIndexReport(indexReport);
  const identities = await readIdentities(config, identityKeys, fetchImpl);
  const identityIdToKey = new Map(identities.map((row) => [row.identity_id, row.identity_key]));
  const embeddings = (await readEmbeddings(config, identities.map((row) => row.identity_id), fetchImpl))
    .filter((row) => row.model_id === config.modelId && row.model_revision === config.modelRevision)
    .slice(0, limit > 0 ? limit : undefined);

  const items = [];
  for (const embedding of embeddings) {
    const matches = await matchEmbedding(config, embedding, { matchCount, fetchImpl });
    const top = matches[0] || null;
    const firstNonSelf = matches.find((row) => row.embedding_id !== embedding.embedding_id) || null;
    items.push({
      embedding_id: embedding.embedding_id,
      identity_id: embedding.identity_id,
      identity_key: identityIdToKey.get(embedding.identity_id) || "",
      embedding_role: embedding.embedding_role,
      top1_identity_id: top?.identity_id || null,
      top1_identity_key: top ? identityIdToKey.get(top.identity_id) || top.identity_key || "" : "",
      top1_embedding_id: top?.embedding_id || null,
      top1_similarity: top?.similarity ?? null,
      self_top1: Boolean(top && top.identity_id === embedding.identity_id),
      first_non_self_identity_id: firstNonSelf?.identity_id || null,
      first_non_self_identity_key: firstNonSelf ? identityIdToKey.get(firstNonSelf.identity_id) || firstNonSelf.identity_key || "" : "",
      first_non_self_similarity: firstNonSelf?.similarity ?? null,
      margin_to_first_non_self: top && firstNonSelf
        ? Number((Number(top.similarity) - Number(firstNonSelf.similarity)).toFixed(6))
        : null,
      match_count: matches.length
    });
  }

  const selfTop1Count = items.filter((item) => item.self_top1).length;
  const report = {
    schema_version: "visual-vector-recall-eval-v1",
    generated_at: now.toISOString(),
    source_index_report: indexReportPath,
    model_id: config.modelId,
    model_revision: config.modelRevision,
    scope: {
      metric_type: "vector_infrastructure_self_recall",
      candidate_pool_ground_truth: false,
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_used_as_ground_truth: false,
      paid_provider_calls: false
    },
    summary: {
      identities: identities.length,
      embeddings_evaluated: items.length,
      self_top1_count: selfTop1Count,
      self_top1_rate: rate(selfTop1Count, items.length),
      average_top1_similarity: rate(items.reduce((sum, item) => sum + Number(item.top1_similarity || 0), 0), items.length),
      average_margin_to_first_non_self: rate(
        items.reduce((sum, item) => sum + Number(item.margin_to_first_non_self || 0), 0),
        items.filter((item) => item.margin_to_first_non_self !== null).length
      )
    },
    items
  };

  if (outPath) {
    const resolvedOut = resolve(outPath);
    if (!existsSync(dirname(resolvedOut))) await mkdir(dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

async function main() {
  const env = await runtimeEnvFromFiles(process.argv);
  const report = await evaluateVisualVectorRecall({
    indexReportPath: argValue(process.argv, "--index-report", env.VISUAL_VECTOR_RECALL_INDEX_REPORT || defaultIndexReportPath),
    outPath: argValue(process.argv, "--out", env.VISUAL_VECTOR_RECALL_OUT || defaultOutPath),
    limit: numberArg(process.argv, "--limit", Number(env.VISUAL_VECTOR_RECALL_LIMIT || 0)),
    matchCount: Math.max(1, numberArg(process.argv, "--match-count", Number(env.VISUAL_VECTOR_RECALL_MATCH_COUNT || 5))),
    env,
    fetchImpl: globalThis.fetch
  });
  console.log(JSON.stringify(report.summary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
