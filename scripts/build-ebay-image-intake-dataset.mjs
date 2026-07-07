import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blindEvalRunPaths,
  defaultBlindEvalDir,
  envValue,
  loginToCloud,
  normalizeBaseUrl,
  readJsonl,
  uploadLocalImageToCloud
} from "../lib/listing/evaluation/blind-eval.mjs";

const defaultOutPath = "data/eval/ebay-reference/ebay-image-intake-dataset.json";
const defaultSealedLabelsOutPath = "data/eval/ebay-reference/ebay-image-intake-sealed-labels.jsonl";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function listArg(value = "") {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeId(value = "") {
  return normalizeText(value)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function stableHash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function fileSha256(path) {
  const bytes = await readFile(resolve(path));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function relativePortablePath(path = "") {
  return path.replaceAll("\\", "/");
}

function sealedLabelKey(answer = {}) {
  return `sealed_${stableHash(`${answer.item_id || ""}:${answer.case_id || ""}`).slice(0, 24)}`;
}

function itemSourceFeedbackId(answer = {}) {
  return `ebay:image_only:${safeId(answer.case_id || answer.item_id)}`;
}

function itemIdentityKey(answer = {}) {
  return `image_only_gap:${safeId(answer.case_id || answer.item_id)}`;
}

function sourceListingKeyHash(answer = {}) {
  return stableHash(`${answer.item_id || ""}:${answer.item_web_url || ""}`).slice(0, 32);
}

async function imageRecord({
  blindImagePath,
  caseId,
  imageIndex,
  uploadImages,
  uploadContext
}) {
  const localPath = resolve(blindImagePath);
  if (!existsSync(localPath)) throw new Error(`Missing blind image: ${blindImagePath}`);
  const contentSha256 = await fileSha256(localPath);
  const role = imageIndex <= 1 ? `image_${imageIndex + 1}_original` : `detail_${imageIndex}`;
  const base = {
    image_id: `${caseId}_img_${imageIndex}`,
    role,
    capture_angle: imageIndex <= 1 ? `image_${imageIndex + 1}` : "detail",
    local_path: relativePortablePath(localPath),
    content_sha256: contentSha256
  };
  if (!uploadImages) return base;
  const uploaded = await uploadLocalImageToCloud({
    baseUrl: uploadContext.baseUrl,
    cookie: uploadContext.cookie,
    caseId,
    imagePath: localPath,
    imageIndex,
    env: uploadContext.env,
    fetchImpl: uploadContext.fetchImpl,
    requestTimeoutMs: uploadContext.requestTimeoutMs
  });
  return {
    ...base,
    bucket: uploaded.bucket,
    object_path: uploaded.object_path,
    width: uploaded.width,
    height: uploaded.height,
    size: uploaded.size,
    content_type: uploaded.content_type,
    storage_verified: true,
    storage_verification_token_present: Boolean(uploaded.storage_verification_token)
  };
}

async function readRunRows({ outDir, runId }) {
  const paths = blindEvalRunPaths({ outDir, runId });
  const blindRows = await readJsonl(paths.blind_inputs_path);
  const answerRows = await readJsonl(paths.answer_key_path);
  const answerByCaseId = new Map(answerRows.map((answer) => [normalizeText(answer.case_id), answer]));
  return { blindRows, answerRows, answerByCaseId };
}

async function writeText(path, text) {
  if (!path) return;
  const resolvedOut = resolve(path);
  if (!existsSync(dirname(resolvedOut))) await mkdir(dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, text);
}

export async function buildEbayImageIntakeDataset({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const outDir = argValue(argv, "--blind-dir", env.BLIND_EVAL_DIR || defaultBlindEvalDir);
  const runIds = listArg(argValue(argv, "--run-ids", env.EBAY_IMAGE_INTAKE_RUN_IDS || ""));
  if (!runIds.length) throw new Error("--run-ids is required.");
  const outPath = argValue(argv, "--out", env.EBAY_IMAGE_INTAKE_DATASET_OUT || defaultOutPath);
  const sealedLabelsOutPath = argValue(argv, "--sealed-labels-out", env.EBAY_IMAGE_INTAKE_SEALED_LABELS_OUT || defaultSealedLabelsOutPath);
  const limit = numberArg(argv, "--limit", Number(env.EBAY_IMAGE_INTAKE_LIMIT || 0));
  const uploadImages = hasFlag(argv, "--upload-images");
  const progress = hasFlag(argv, "--progress") || /^(?:1|true|yes)$/i.test(String(env.EBAY_IMAGE_INTAKE_PROGRESS || ""));
  const baseUrl = uploadImages
    ? normalizeBaseUrl(argValue(argv, "--base-url", env.API_BASE_URL || ""))
    : "";
  const username = argValue(argv, "--username", envValue(env, "API_USERNAME", "METAVERSE_USERNAME"));
  const password = argValue(argv, "--password", envValue(env, "API_PASSWORD", "METAVERSE_PASSWORD"));
  const requestTimeoutMs = numberArg(argv, "--request-timeout-ms", Number(env.EBAY_IMAGE_INTAKE_UPLOAD_TIMEOUT_MS || 240000));
  const uploadContext = uploadImages
    ? {
      baseUrl,
      cookie: await loginToCloud({ baseUrl, username, password, env, requestTimeoutMs, fetchImpl }),
      env,
      fetchImpl,
      requestTimeoutMs
    }
    : null;
  if (progress) {
    process.stderr.write(`[image-intake] upload_images=${uploadImages} run_ids=${runIds.join(",")} limit=${limit || "all"}\n`);
  }

  const items = [];
  const sealedLabels = [];
  const seenItemIds = new Set();
  const sourceRuns = [];
  for (const runId of runIds) {
    const { blindRows, answerRows, answerByCaseId } = await readRunRows({ outDir, runId });
    sourceRuns.push({ run_id: runId, blind_rows: blindRows.length, sealed_answer_rows: answerRows.length });
    for (const blindRow of blindRows) {
      if (limit > 0 && items.length >= limit) break;
      const answer = answerByCaseId.get(normalizeText(blindRow.case_id));
      if (!answer) throw new Error(`Missing sealed answer row for case_id=${blindRow.case_id} in run ${runId}.`);
      const itemId = normalizeText(answer.item_id || answer.case_id);
      if (!itemId || seenItemIds.has(itemId)) continue;
      seenItemIds.add(itemId);

      const labelKey = sealedLabelKey(answer);
      const images = [];
      for (const [imageIndex, blindImagePath] of (blindRow.image_paths || []).entries()) {
        if (progress) {
          process.stderr.write(`[image-intake] item ${items.length + 1}${limit ? `/${limit}` : ""} ${blindRow.case_id} image ${imageIndex + 1}/${blindRow.image_paths.length}\n`);
        }
        images.push(await imageRecord({
          blindImagePath,
          caseId: blindRow.case_id,
          imageIndex,
          uploadImages,
          uploadContext
        }));
      }

      items.push({
        asset_id: `ebay_image_only_${safeId(blindRow.case_id)}`,
        source_feedback_id: itemSourceFeedbackId(answer),
        physical_card_id: `ebay_image_only_${safeId(blindRow.case_id)}`,
        identity_key: itemIdentityKey(answer),
        category: "collectible_card",
        category_source: "image_only_default",
        reference_capture_source: "ebay_blind_image_only",
        source_provider: "ebay_browse",
        source_manifest: `blind_eval/${runId}`,
        review_status: "NEEDS_WRITER_REVIEW",
        canonical_title: "",
        source_titles: {},
        sealed_eval_label_ref: {
          path: relativePortablePath(sealedLabelsOutPath),
          key: labelKey
        },
        source_record: {
          source_type: "IMAGE_ONLY_MARKETPLACE_CAPTURE",
          source_provider: "ebay_browse",
          sealed_eval_label_key: labelKey,
          source_listing_key_hash: sourceListingKeyHash(answer),
          ebay_answer_key_is_reviewed_ground_truth: false,
          seller_title_visible_to_model: false,
          title_derived_fields_are_ground_truth: false
        },
        images
      });

      sealedLabels.push({
        key: labelKey,
        case_id: answer.case_id,
        seller: answer.seller || "",
        item_id: answer.item_id || "",
        item_web_url: answer.item_web_url || "",
        title: answer.title || "",
        raw_listing_metadata: answer.raw_listing_metadata || {},
        policy: {
          seller_title_is_ground_truth: false,
          model_prompt_visible: false,
          catalog_import_allowed: false,
          use_after_prediction_for_eval_only: true
        }
      });
    }
  }

  const dataset = {
    schema_version: "ebay-image-intake-dataset-v1",
    generated_at: now.toISOString(),
    source_runs: sourceRuns,
    item_count: items.length,
    image_count: items.reduce((sum, item) => sum + item.images.length, 0),
    unique_item_count: seenItemIds.size,
    upload_images: uploadImages,
    sealed_labels_path: relativePortablePath(sealedLabelsOutPath),
    intake_policy: {
      image_only: true,
      seller_titles_in_dataset: false,
      seller_titles_are_ground_truth: false,
      ebay_answer_key_is_reviewed_ground_truth: false,
      title_derived_catalog_import_allowed: false,
      default_retrieval_status: "candidate",
      default_prompt_trust: "NONE",
      requires_writer_review_before_approved_reference: true
    },
    items
  };

  await writeText(outPath, `${JSON.stringify(dataset, null, 2)}\n`);
  await writeText(sealedLabelsOutPath, `${sealedLabels.map((row) => JSON.stringify(row)).join("\n")}\n`);

  return { dataset, sealedLabels };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildEbayImageIntakeDataset().then(({ dataset, sealedLabels }) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      schema_version: dataset.schema_version,
      item_count: dataset.item_count,
      image_count: dataset.image_count,
      sealed_label_count: sealedLabels.length,
      seller_titles_in_dataset: dataset.intake_policy.seller_titles_in_dataset,
      upload_images: dataset.upload_images,
      source_runs: dataset.source_runs
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
