#!/usr/bin/env node
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import { fetchWithBoundedRetry } from "../lib/listing/client/bounded-fetch.mjs";
import { imageDimensions } from "./materialize-launch-gate-images.mjs";

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}

function extension(contentType = "") {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[contentType] || ".img";
}

function contentType(bytes, header = "") {
  const declared = clean(header).split(";")[0].toLowerCase();
  if (declared.startsWith("image/")) return declared;
  if (bytes.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new Error("identity_image_content_type_unknown");
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

async function withRetry(worker, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await worker();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(2_000, attempt * 400)));
    }
  }
  throw lastError;
}

export async function materializeIndependentIdentityImages({
  dataset,
  outputDirectory,
  env = process.env,
  fetchImpl = globalThis.fetch,
  signImpl = createListingImageSignedReadUrl,
  concurrency = 8
} = {}) {
  const items = dataset.items || [];
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const jobs = items.flatMap((item, itemIndex) => (item.images || []).map((image, imageIndex) => ({ item, itemIndex, image, imageIndex })));
  const materialized = await mapConcurrent(jobs, Math.max(1, Math.min(12, concurrency)), (job) => withRetry(async () => {
    const bucket = clean(job.image.bucket);
    const objectPath = clean(job.image.object_path);
    if (!bucket || !objectPath) throw new Error("identity_image_storage_reference_missing");
    const cacheKey = crypto.createHash("sha256").update(`${bucket}/${objectPath}`).digest("hex");
    const existing = [".jpg", ".png", ".webp", ".img"].map((suffix) => resolve(directory, `${cacheKey}${suffix}`))
      .find((path) => existsSync(path));
    if (existing) {
      const bytes = await readFile(existing);
      const type = contentType(bytes, job.image.content_type);
      const dimensions = imageDimensions(bytes, type);
      return { ...job, downloaded: false, local_path: existing, content_type: type, dimensions, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    }
    const signedUrl = await signImpl({ objectPath, bucket, env, fetchImpl });
    const download = await fetchWithBoundedRetry(signedUrl, { method: "GET" }, {
      fetchImpl,
      timeoutMs: 45_000,
      maxAttempts: 3,
      retryNetworkErrors: true,
      retryStatuses: [408, 425, 429, 500, 502, 503, 504],
      maxDelayMs: 2_000
    });
    const response = download.response;
    if (!response.ok) throw new Error(`identity_image_download_failed:${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = contentType(bytes, response.headers.get("content-type") || "");
    const dimensions = imageDimensions(bytes, type);
    const localPath = resolve(directory, `${cacheKey}${extension(type)}`);
    await writeFile(localPath, bytes, { mode: 0o600 });
    return { ...job, downloaded: true, local_path: localPath, content_type: type, dimensions, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }));
  const byPosition = new Map(materialized.map((row) => [`${row.itemIndex}:${row.imageIndex}`, row]));
  return {
    ...dataset,
    schema_version: "independent-identity-materialized-images-v1",
    materialization_summary: {
      item_count: items.length,
      image_count: jobs.length,
      downloaded_count: materialized.filter((row) => row.downloaded).length,
      reused_count: materialized.filter((row) => !row.downloaded).length
    },
    items: items.map((item, itemIndex) => ({
      ...item,
      images: (item.images || []).map((image, imageIndex) => {
        const row = byPosition.get(`${itemIndex}:${imageIndex}`);
        return {
          ...image,
          local_path: row.local_path,
          content_type: row.content_type,
          width: row.dimensions.width,
          height: row.dimensions.height,
          content_sha256: row.sha256
        };
      })
    }))
  };
}

export async function main(argv = process.argv.slice(2)) {
  const inputPath = resolve(arg(argv, "--input"));
  const outputPath = resolve(arg(argv, "--out"));
  const outputDirectory = resolve(arg(argv, "--local-dir"));
  if (!inputPath || !outputPath || !outputDirectory) throw new Error("--input, --out, and --local-dir are required");
  const dataset = JSON.parse(await readFile(inputPath, "utf8"));
  const output = await materializeIndependentIdentityImages({
    dataset,
    outputDirectory,
    concurrency: Number(arg(argv, "--concurrency", "4")) || 4
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output: outputPath, ...output.materialization_summary }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
