import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCardImagesWithRecognitionWorker } from "../lib/listing/recognition/recognition-client.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";

const defaultDatasetPath = "data/recognition/manifests/supabase-feedback-candidates.json";
const defaultOutPath = "data/eval/provider-regression-30/visual-vector-index-latest.json";
const defaultEnvFilePath = ".env.local";
const defaultModelId = "google/siglip2-base-patch16-384";
const defaultModelRevision = "main";
const defaultPreprocessingVersion = "card-rectification-v1";
const defaultDimensions = 768;

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
  const envFilePath = argValue(argv, "--env-file", env.VISUAL_VECTOR_INDEX_ENV_FILE || defaultEnvFilePath);
  const fileEnv = await readEnvFile(envFilePath);
  return { ...fileEnv, ...env };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function stableHash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function candidateId(item = {}) {
  return item.source_feedback_id || item.physical_card_id || item.asset_id || item.id || item.candidate_id || "";
}

function identityKeyForItem(item = {}) {
  const id = candidateId(item);
  if (!id) throw new Error("Dataset item is missing a stable id.");
  return item.identity_key || `supabase_feedback:${id}`;
}

function canonicalTitleForItem(item = {}) {
  return normalizeText(
    item.canonical_title
      || item.source_titles?.corrected_title
      || item.source_titles?.generated_title
      || item.corrected_title
      || item.title
  );
}

function fieldsForItem(item = {}) {
  const canonicalTitle = canonicalTitleForItem(item);
  const titleDerivedFields = parseReviewedTitleFields(canonicalTitle);
  return {
    ...titleDerivedFields,
    ...(item.ground_truth && typeof item.ground_truth === "object" ? item.ground_truth : {}),
    annotation_hint: {
      corrected_title: item.source_titles?.corrected_title || item.corrected_title || "",
      generated_title: item.source_titles?.generated_title || "",
      corrected_title_is_ground_truth: false,
      title_derived_fields_are_ground_truth: false,
      title_derived_field_names: Object.keys(titleDerivedFields).filter((fieldName) => {
        const value = titleDerivedFields[fieldName];
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === "boolean") return value === true;
        return value !== null && value !== undefined && String(value).trim() !== "" && value !== "UNKNOWN";
      })
    }
  };
}

function normalizeImageRole(role = "", index = 0) {
  const text = String(role || "").toLowerCase();
  if (text.includes("back")) return "back_original";
  if (text.includes("front")) return "front_original";
  if (text.includes("surface")) return "surface_view";
  return index === 0 ? "front_original" : "additional";
}

function imageInputs(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => image?.bucket && image?.object_path)
    .map((image, index) => ({
      image_id: image.image_id || `${candidateId(item)}_${index + 1}`,
      bucket: image.bucket,
      object_path: image.object_path,
      role: normalizeImageRole(image.role, index),
      capture_angle: image.capture_angle || "",
      has_glare: Boolean(image.has_glare),
      source_url: image.source_url || ""
    }));
}

function referenceKeyForImage(image = {}) {
  return stableHash(`${image.bucket || ""}:${image.object_path || ""}:${image.role || ""}`);
}

function supabaseConfig(env = {}) {
  const url = normalizeText(env.SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = normalizeText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  return {
    url,
    serviceRoleKey,
    modelId: normalizeText(env.VISUAL_VECTOR_MODEL_ID || env.VISUAL_EMBEDDING_MODEL_ID) || defaultModelId,
    modelRevision: normalizeText(env.VISUAL_VECTOR_MODEL_REVISION || env.VISUAL_EMBEDDING_MODEL_REVISION) || defaultModelRevision,
    preprocessingVersion: normalizeText(env.VISUAL_VECTOR_PREPROCESSING_VERSION || env.VISUAL_EMBEDDING_PREPROCESSING_VERSION) || defaultPreprocessingVersion,
    dimensions: Number(env.VISUAL_VECTOR_DIMENSIONS || env.VISUAL_EMBEDDING_DIMENSIONS) || defaultDimensions
  };
}

function assertSupabaseConfig(config = {}) {
  if (!config.url) throw new Error("SUPABASE_URL is required for visual vector indexing.");
  if (!config.serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required for visual vector indexing.");
}

function supabaseHeaders(config = {}, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function readResponseJson(response) {
  const text = await readResponseText(response);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function supabaseFetchJson({
  config,
  path,
  method = "GET",
  body,
  prefer = "",
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is required for Supabase visual vector indexing.");
  const response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
    method,
    headers: supabaseHeaders(config, prefer ? { prefer } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await readResponseJson(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || JSON.stringify(payload || {}).slice(0, 240);
    throw new Error(`Supabase REST ${method} ${path} failed: HTTP ${response.status} ${message}`);
  }
  return payload;
}

async function upsertRows({
  config,
  table,
  rows,
  onConflict,
  fetchImpl
}) {
  if (!rows.length) return [];
  const query = onConflict ? `${table}?on_conflict=${encodeURIComponent(onConflict)}` : table;
  return await supabaseFetchJson({
    config,
    path: query,
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation",
    fetchImpl
  });
}

export async function assertVisualVectorSchema({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = supabaseConfig(env);
  assertSupabaseConfig(config);
  const checks = [
    ["card_identities", "identity_id"],
    ["card_reference_images", "reference_image_id"],
    ["card_image_embeddings", "embedding_id"]
  ];

  for (const [table, select] of checks) {
    await supabaseFetchJson({
      config,
      path: `${table}?select=${select}&limit=1`,
      fetchImpl
    });
  }

  const probeEmbedding = Array.from({ length: config.dimensions }, (_, index) => (index === 0 ? 1 : 0));
  await supabaseFetchJson({
    config,
    path: "rpc/match_card_image_embeddings",
    method: "POST",
    body: {
      query_embedding: probeEmbedding,
      match_model_id: config.modelId,
      match_model_revision: config.modelRevision,
      match_embedding_role: null,
      match_category: null,
      match_count: 1,
      match_threshold: 2,
      include_candidate_identities: false
    },
    fetchImpl
  });
  return { ok: true };
}

function validFeature(feature = {}, expectedDimensions = defaultDimensions) {
  return (
    feature
    && feature.status === "OK"
    && Array.isArray(feature.embedding)
    && feature.embedding.length === expectedDimensions
    && feature.embedding.every((value) => Number.isFinite(Number(value)))
  );
}

async function signedImagesForItem({
  item,
  env,
  createSignedReadUrlImpl,
  fetchImpl
}) {
  const images = imageInputs(item);
  const signed = [];
  for (const image of images) {
    const signedUrl = await createSignedReadUrlImpl({
      objectPath: image.object_path,
      bucket: image.bucket,
      env,
      fetchImpl
    });
    signed.push({
      ...image,
      signedUrl,
      signed_url: signedUrl
    });
  }
  return signed;
}

async function analyzeEmbeddingsForItem({
  item,
  env,
  createSignedReadUrlImpl,
  analyzeImpl,
  fetchImpl
}) {
  const signedImages = await signedImagesForItem({
    item,
    env,
    createSignedReadUrlImpl,
    fetchImpl
  });
  const response = await analyzeImpl({
    assetId: item.asset_id || candidateId(item),
    captureProfileId: "visual_vector_index",
    images: signedImages,
    requestedFields: [],
    options: {
      run_ocr: false,
      run_visual_embeddings: true,
      run_candidate_verification: false
    },
    env,
    fetchImpl
  });
  return { signedImages, response };
}

async function indexItem({
  item,
  env,
  config,
  retrievalStatus,
  retrievalEnabled,
  dryRun,
  createSignedReadUrlImpl,
  analyzeImpl,
  fetchImpl
}) {
  const identityKey = identityKeyForItem(item);
  const { signedImages, response } = await analyzeEmbeddingsForItem({
    item,
    env,
    createSignedReadUrlImpl,
    analyzeImpl,
    fetchImpl
  });
  const visualFeatures = response.visual_features || {};
  const features = Array.isArray(visualFeatures.features) ? visualFeatures.features : [];
  const usableFeatures = features.filter((feature) => validFeature(feature, config.dimensions));

  if (visualFeatures.status !== "OK" || usableFeatures.length === 0) {
    throw new Error(`visual_embedding_unavailable:${visualFeatures.reason || visualFeatures.status || "unknown"}`);
  }

  if (dryRun) {
    return {
      identity_key: identityKey,
      signed_image_count: signedImages.length,
      embedding_count: usableFeatures.length,
      dry_run: true
    };
  }

  const [identity] = await upsertRows({
    config,
    table: "card_identities",
    onConflict: "identity_key",
    rows: [{
      identity_key: identityKey,
      category: item.category || "",
      retrieval_status: retrievalStatus,
      retrieval_enabled: retrievalEnabled,
      canonical_title: canonicalTitleForItem(item),
      fields: fieldsForItem(item),
      source_record: {
        source_feedback_id: item.source_feedback_id || "",
        asset_id: item.asset_id || "",
        physical_card_id: item.physical_card_id || "",
        source_manifest: item.source_manifest || "",
        corrected_title_is_ground_truth: false
      }
    }],
    fetchImpl
  });
  if (!identity?.identity_id) throw new Error("Supabase card_identities upsert did not return identity_id.");

  let embeddingCount = 0;
  for (const image of signedImages) {
    const imageFeature = usableFeatures.find((feature) => feature.image_id === image.image_id);
    if (!imageFeature) continue;
    const [reference] = await upsertRows({
      config,
      table: "card_reference_images",
      onConflict: "identity_id,image_role,reference_key",
      rows: [{
        identity_id: identity.identity_id,
        reference_key: referenceKeyForImage(image),
        image_role: normalizeImageRole(image.role),
        object_path: image.object_path,
        image_url: null,
        content_sha256: image.content_sha256 || null,
        capture_source: "supabase_feedback_candidate",
        approved_for_retrieval: retrievalEnabled,
        metadata: {
          bucket: image.bucket,
          image_id: image.image_id,
          capture_angle: image.capture_angle || "",
          has_glare: Boolean(image.has_glare),
          source_url_present: Boolean(image.source_url),
          signed_url_persisted: false
        }
      }],
      fetchImpl
    });
    if (!reference?.reference_image_id) throw new Error("Supabase card_reference_images upsert did not return reference_image_id.");

    await upsertRows({
      config,
      table: "card_image_embeddings",
      onConflict: "reference_image_id,embedding_role,model_id,model_revision,preprocessing_version",
      rows: [{
        reference_image_id: reference.reference_image_id,
        identity_id: identity.identity_id,
        embedding_role: imageFeature.embedding_role,
        model_id: imageFeature.model_id || config.modelId,
        model_revision: imageFeature.model_revision || config.modelRevision,
        preprocessing_version: imageFeature.preprocessing_version || config.preprocessingVersion,
        dimensions: imageFeature.dimensions || config.dimensions,
        embedding: imageFeature.embedding.map(Number),
        metadata: {
          image_id: imageFeature.image_id || image.image_id,
          source: "recognition_worker_visual_embedding",
          recognition_asset_id: response.asset_id || ""
        }
      }],
      fetchImpl
    });
    embeddingCount += 1;
  }

  return {
    identity_key: identityKey,
    signed_image_count: signedImages.length,
    embedding_count: embeddingCount,
    visual_status: visualFeatures.status
  };
}

async function runPool(items, worker, concurrency = 2) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function indexVisualVectorDataset({
  datasetPath = defaultDatasetPath,
  outPath = defaultOutPath,
  limit = 0,
  concurrency = 2,
  env = process.env,
  dryRun = false,
  schemaCheckOnly = false,
  retrievalStatus = "candidate",
  retrievalEnabled = false,
  createSignedReadUrlImpl = createListingImageSignedReadUrl,
  analyzeImpl = analyzeCardImagesWithRecognitionWorker,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const config = supabaseConfig(env);
  assertSupabaseConfig(config);
  await assertVisualVectorSchema({ env, fetchImpl });

  if (schemaCheckOnly) {
    return {
      ok: true,
      schema_check_only: true,
      generated_at: now.toISOString(),
      model_id: config.modelId,
      dimensions: config.dimensions
    };
  }

  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const sourceItems = Array.isArray(dataset.items) ? dataset.items : [];
  const items = sourceItems
    .filter((item) => imageInputs(item).length > 0)
    .slice(0, limit > 0 ? limit : sourceItems.length);

  if (!items.length) throw new Error("No image-backed items found for visual vector indexing.");

  const itemResults = await runPool(items, async (item, index) => {
    try {
      const result = await indexItem({
        item,
        env,
        config,
        retrievalStatus,
        retrievalEnabled,
        dryRun,
        createSignedReadUrlImpl,
        analyzeImpl,
        fetchImpl
      });
      return { index, ok: true, ...result };
    } catch (error) {
      return {
        index,
        ok: false,
        identity_key: (() => {
          try {
            return identityKeyForItem(item);
          } catch {
            return "";
          }
        })(),
        error: error?.message || String(error)
      };
    }
  }, concurrency);

  const report = {
    ok: itemResults.every((result) => result.ok),
    generated_at: now.toISOString(),
    dataset_path: datasetPath,
    dry_run: dryRun,
    retrieval_status: retrievalStatus,
    retrieval_enabled: retrievalEnabled,
    model_id: config.modelId,
    model_revision: config.modelRevision,
    preprocessing_version: config.preprocessingVersion,
    dimensions: config.dimensions,
    summary: {
      requested_items: items.length,
      indexed_items: itemResults.filter((result) => result.ok).length,
      failed_items: itemResults.filter((result) => !result.ok).length,
      embeddings_written: itemResults.reduce((sum, result) => sum + (Number(result.embedding_count) || 0), 0)
    },
    items: itemResults
  };

  if (outPath) {
    const resolvedOut = resolve(outPath);
    if (!existsSync(dirname(resolvedOut))) await mkdir(dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (!report.ok) {
    const error = new Error(`Visual vector indexing completed with ${report.summary.failed_items} failed item(s).`);
    error.report = report;
    throw error;
  }

  return report;
}

async function main() {
  const argv = process.argv;
  const env = await runtimeEnvFromFiles(argv);
  const retrievalStatus = normalizeText(argValue(argv, "--retrieval-status", "candidate")) || "candidate";
  if (!["approved", "reviewed", "registry", "candidate", "disabled"].includes(retrievalStatus)) {
    throw new Error("--retrieval-status must be approved, reviewed, registry, candidate, or disabled.");
  }
  const report = await indexVisualVectorDataset({
    datasetPath: argValue(argv, "--dataset", env.VISUAL_VECTOR_INDEX_DATASET || defaultDatasetPath),
    outPath: argValue(argv, "--out", env.VISUAL_VECTOR_INDEX_OUT || defaultOutPath),
    limit: numberArg(argv, "--limit", Number(env.VISUAL_VECTOR_INDEX_LIMIT || 0)),
    concurrency: Math.max(1, numberArg(argv, "--concurrency", Number(env.VISUAL_VECTOR_INDEX_CONCURRENCY || 2))),
    env,
    dryRun: hasFlag(argv, "--dry-run"),
    schemaCheckOnly: hasFlag(argv, "--schema-check-only"),
    retrievalStatus,
    retrievalEnabled: hasFlag(argv, "--enable-candidate-retrieval") || truthy(env.VISUAL_VECTOR_INDEX_RETRIEVAL_ENABLED, false),
    fetchImpl: globalThis.fetch
  });

  console.log(JSON.stringify({
    ok: report.ok,
    schema_check_only: Boolean(report.schema_check_only),
    summary: report.summary || null,
    model_id: report.model_id,
    dimensions: report.dimensions,
    dry_run: Boolean(report.dry_run)
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
