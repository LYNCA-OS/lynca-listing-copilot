#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { supabaseServiceHeaders } from "../lib/supabase-service-headers.mjs";
import { buildCanonicalFieldsRequest } from "../lib/listing/thin/canonical-fields.mjs";

export const DEFAULT_ASSETS_PATH = "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json";
export const DEFAULT_LIMIT = 100;
export const DEFAULT_CONCURRENCY = 100;
export const VISION_URL_MAX_BATCH_SIZE = 500;
export const DEFAULT_SIGNING_CONCURRENCY = 6;
export const DEFAULT_MODEL = "gpt-5.6-luna";
export const DEFAULT_EFFORT = "none";
export const DEFAULT_MODE = "vision_url";
export const HOSTED_VISION_PROBE_MODES = Object.freeze(["vision_url", "vision_canonical"]);

const SIGNED_URL_TTL_SECONDS = 3600;
const SIGNING_TIMEOUT_MS = 15_000;
const originalRolePattern = /(?:^|_)original$/i;

function boundedInteger(value, fallback, { name, max = 100 } = {}) {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name}_must_be_an_integer_between_1_and_${max}`);
  }
  return parsed;
}

function storageConfig(env) {
  const secretKey = String(env?.SUPABASE_SECRET_KEY || "").trim();
  if (!secretKey) throw new Error("supabase_secret_key_required");

  let url;
  try {
    url = new URL(String(env?.SUPABASE_URL || "").trim());
  } catch {
    throw new Error("supabase_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("supabase_url_must_be_https");
  }
  return { baseUrl: url.origin, secretKey };
}

function encodeStoragePath(value, label) {
  const parts = String(value || "").trim().split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label}_invalid`);
  }
  return parts.map(encodeURIComponent).join("/");
}

function selectedAssets(rows, limit) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("assets_required");
  return rows.slice(0, limit).map((asset, assetIndex) => {
    const assetId = String(asset?.asset_id || "").trim();
    if (!assetId) throw new Error(`asset_${assetIndex + 1}_id_required`);

    const originals = (Array.isArray(asset?.images) ? asset.images : [])
      .filter((image) => originalRolePattern.test(String(image?.role || "")))
      .slice(0, 2)
      .map((image, imageIndex) => {
        const bucket = String(image?.bucket || "").trim();
        const objectPath = String(image?.object_path || image?.objectPath || "").trim();
        if (!bucket || !objectPath) {
          throw new Error(`asset_${assetIndex + 1}_image_${imageIndex + 1}_storage_reference_required`);
        }
        return { bucket, objectPath };
      });
    if (!originals.length) throw new Error(`asset_${assetIndex + 1}_original_image_required`);
    return { assetId, originals };
  });
}

async function readAssets(assetsPath) {
  const text = await readFile(assetsPath, "utf8");
  if (assetsPath.endsWith(".jsonl")) {
    return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed?.assets || parsed?.items;
}

async function mapConcurrentFailClosed(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  let failure = null;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        failure ||= error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  return results;
}

function normalizeSignedUrl(value, baseUrl) {
  const signedPath = String(value || "").trim();
  if (!signedPath) throw new Error("signing_response_url_required");

  let signedUrl;
  try {
    signedUrl = signedPath.startsWith("http")
      ? new URL(signedPath)
      : new URL(`${baseUrl}/storage/v1/${signedPath.replace(/^\/+/, "")}`);
  } catch {
    throw new Error("signing_response_url_invalid");
  }
  if (signedUrl.protocol !== "https:"
    || signedUrl.origin !== new URL(baseUrl).origin
    || !signedUrl.pathname.startsWith("/storage/v1/object/sign/")) {
    throw new Error("signing_response_url_invalid");
  }
  return signedUrl.href;
}

async function signImage({ image, baseUrl, secretKey, fetchImpl }) {
  const bucket = encodeStoragePath(image.bucket, "storage_bucket");
  const objectPath = encodeStoragePath(image.objectPath, "storage_object_path");
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`, {
      method: "POST",
      headers: supabaseServiceHeaders(secretKey, { "content-type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
      signal: AbortSignal.timeout(SIGNING_TIMEOUT_MS)
    });
  } catch {
    throw new Error("supabase_signing_request_failed");
  }
  if (!response?.ok) throw new Error("supabase_signing_request_failed");

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("supabase_signing_response_invalid");
  }
  return normalizeSignedUrl(payload?.signedURL || payload?.signedUrl || payload?.signedUrlPath, baseUrl);
}

async function writePrivateJson(outPath, payload) {
  if (!outPath) throw new Error("out_path_required");
  const tempPath = join(dirname(outPath), `.${basename(outPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(tempPath, outPath);
    await chmod(outPath, 0o600);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function prepareHostedVisionProbePayload({
  assetsPath = DEFAULT_ASSETS_PATH,
  outPath,
  limit = DEFAULT_LIMIT,
  concurrency = DEFAULT_CONCURRENCY,
  signingConcurrency = DEFAULT_SIGNING_CONCURRENCY,
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  mode = DEFAULT_MODE,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const effectiveLimit = boundedInteger(limit, DEFAULT_LIMIT, { name: "limit", max: VISION_URL_MAX_BATCH_SIZE });
  const effectiveConcurrency = boundedInteger(concurrency, DEFAULT_CONCURRENCY, {
    name: "concurrency",
    max: VISION_URL_MAX_BATCH_SIZE
  });
  const effectiveSigningConcurrency = boundedInteger(signingConcurrency, DEFAULT_SIGNING_CONCURRENCY, {
    name: "signing_concurrency",
    max: 100
  });
  if (typeof fetchImpl !== "function") throw new Error("fetch_required");
  if (!String(model || "").trim()) throw new Error("model_required");
  if (!String(effort || "").trim()) throw new Error("effort_required");
  const effectiveMode = String(mode || "").trim();
  if (!HOSTED_VISION_PROBE_MODES.includes(effectiveMode)) throw new Error("mode_invalid");
  if (effectiveMode === "vision_canonical"
    && (String(model).trim() !== DEFAULT_MODEL || String(effort).trim() !== DEFAULT_EFFORT)) {
    throw new Error("canonical_mode_requires_luna_none");
  }

  const { baseUrl, secretKey } = storageConfig(env);
  const assets = selectedAssets(await readAssets(assetsPath), effectiveLimit);
  const jobs = assets.flatMap((asset, assetIndex) => asset.originals.map((image, imageIndex) => ({
    assetIndex,
    imageIndex,
    image
  })));
  const signedUrls = await mapConcurrentFailClosed(jobs, effectiveSigningConcurrency, ({ image }) => (
    signImage({ image, baseUrl, secretKey, fetchImpl })
  ));

  const payload = {
    mode: effectiveMode,
    concurrency: effectiveConcurrency,
    model: String(model).trim(),
    effort: String(effort).trim(),
    image_detail: "high",
    assets: assets.map((asset, assetIndex) => ({
      asset_id: asset.assetId,
      image_urls: jobs
        .map((job, jobIndex) => ({ job, url: signedUrls[jobIndex] }))
        .filter(({ job }) => job.assetIndex === assetIndex)
        .sort((left, right) => left.job.imageIndex - right.job.imageIndex)
        .map(({ url }) => url)
    }))
  };
  if (effectiveMode === "vision_canonical") {
    payload.request_template = buildCanonicalFieldsRequest({
      imageUrls: [],
      model: DEFAULT_MODEL,
      effort: DEFAULT_EFFORT,
      imageDetail: "high"
    });
  }
  await writePrivateJson(outPath, payload);
  return {
    ok: true,
    mode: effectiveMode,
    concurrency: effectiveConcurrency,
    asset_count: payload.assets.length,
    image_count: jobs.length
  };
}

function parseOptions(argv) {
  const allowed = new Set([
    "--assets", "--out", "--limit", "--concurrency", "--signing-concurrency", "--model", "--effort", "--mode"
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(option)) throw new Error("unsupported_option");
    if (value === undefined || value.startsWith("--")) throw new Error("option_value_required");
    if (Object.hasOwn(values, option)) throw new Error("duplicate_option");
    values[option] = value;
  }
  return values;
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  { fetchImpl = globalThis.fetch, stdout = process.stdout } = {}
) {
  const options = parseOptions(argv);
  const summary = await prepareHostedVisionProbePayload({
    assetsPath: options["--assets"] || DEFAULT_ASSETS_PATH,
    outPath: options["--out"],
    limit: options["--limit"] || DEFAULT_LIMIT,
    concurrency: options["--concurrency"] || DEFAULT_CONCURRENCY,
    signingConcurrency: options["--signing-concurrency"] || DEFAULT_SIGNING_CONCURRENCY,
    model: options["--model"] || DEFAULT_MODEL,
    effort: options["--effort"] || DEFAULT_EFFORT,
    mode: options["--mode"] || DEFAULT_MODE,
    env,
    fetchImpl
  });
  stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || "payload_preparation_failed").slice(0, 160)}\n`);
    process.exitCode = 1;
  });
}
