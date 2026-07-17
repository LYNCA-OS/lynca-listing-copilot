#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fetchWithBoundedRetry } from "../lib/listing/client/bounded-fetch.mjs";

const defaultMaxImageBytes = 30 * 1024 * 1024;

function cleanText(value) {
  return String(value || "").trim();
}

function loadItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

function contentTypeForBytes(bytes, responseContentType = "") {
  const explicit = cleanText(responseContentType).split(";")[0].toLowerCase();
  if (explicit.startsWith("image/")) return explicit;
  if (bytes.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  throw new Error("launch_gate_image_content_type_unknown");
}

function extensionForContentType(contentType) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[contentType] || ".img";
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (frameMarkers.has(marker) && segmentLength >= 7) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunkType = bytes.subarray(12, 16).toString("ascii");
  if (chunkType === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (chunkType === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function imageDimensions(bytes, contentType = "") {
  const dimensions = contentType === "image/png"
    ? pngDimensions(bytes)
    : contentType === "image/jpeg"
      ? jpegDimensions(bytes)
      : contentType === "image/webp"
        ? webpDimensions(bytes)
        : pngDimensions(bytes) || jpegDimensions(bytes) || webpDimensions(bytes);
  if (!dimensions || !Number.isInteger(dimensions.width) || dimensions.width <= 0
    || !Number.isInteger(dimensions.height) || dimensions.height <= 0) {
    throw new Error(`launch_gate_image_dimensions_unknown:${contentType || "unknown"}`);
  }
  return dimensions;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

async function requestSignedSources({ baseUrl, cookie, sourceFeedbackIds, fetchImpl }) {
  const result = await fetchWithBoundedRetry(`${baseUrl}/api/v4/launch-gate-source-images`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, connection: "close" },
    body: JSON.stringify({ source_feedback_ids: sourceFeedbackIds })
  }, {
    fetchImpl,
    timeoutMs: 120_000,
    maxAttempts: 3,
    retryNetworkErrors: true,
    retryStatuses: [408, 425, 429, 500, 502, 503, 504],
    maxDelayMs: 2_000
  });
  const payload = await readJsonResponse(result.response);
  if (!result.response?.ok || payload.ok !== true) {
    throw new Error(`launch_gate_image_access_failed:${result.response?.status || 0}:${cleanText(payload.error)}`);
  }
  return payload;
}

async function downloadSignedImage({ image, signedImage, outputDirectory, maxImageBytes, fetchImpl, position }) {
  const localPath = cleanText(image.local_path || image.localPath);
  let invalidLocalReason = "";
  if (localPath && existsSync(localPath)) {
    try {
      const bytes = await readFile(localPath);
      if (!bytes.length || bytes.length > maxImageBytes) throw new Error(`launch_gate_image_size_invalid:${bytes.length}`);
      const contentType = contentTypeForBytes(bytes, cleanText(image.content_type || image.contentType));
      const dimensions = imageDimensions(bytes, contentType);
      const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const expectedSha256 = cleanText(image.content_sha256 || signedImage?.content_sha256).toLowerCase();
      if (expectedSha256 && expectedSha256 !== contentSha256) {
        throw new Error(`launch_gate_image_sha256_mismatch:${position}`);
      }
      return {
        downloaded: false,
        attempts: 0,
        invalid_local_redownloaded: false,
        image: {
          ...image,
          local_path: localPath,
          content_type: contentType,
          size: bytes.length,
          width: dimensions.width,
          height: dimensions.height,
          content_sha256: contentSha256
        }
      };
    } catch (error) {
      invalidLocalReason = cleanText(error?.message || error);
    }
  }
  if (!cleanText(signedImage?.signed_url)) throw new Error(`launch_gate_signed_image_missing:${position}`);
  const result = await fetchWithBoundedRetry(signedImage.signed_url, { method: "GET" }, {
    fetchImpl,
    timeoutMs: 45_000,
    maxAttempts: 3,
    retryNetworkErrors: true,
    retryStatuses: [408, 425, 429, 500, 502, 503, 504],
    maxDelayMs: 2_000
  });
  if (!result.response?.ok) {
    await result.response?.body?.cancel?.();
    throw new Error(`launch_gate_storage_download_failed:${result.response?.status || 0}:${position}`);
  }
  const declaredLength = Number(result.response.headers.get("content-length") || 0);
  if (declaredLength > maxImageBytes) {
    await result.response.body?.cancel?.();
    throw new Error(`launch_gate_image_too_large:${declaredLength}`);
  }
  const bytes = Buffer.from(await result.response.arrayBuffer());
  if (!bytes.length || bytes.length > maxImageBytes) throw new Error(`launch_gate_image_size_invalid:${bytes.length}`);
  const contentType = contentTypeForBytes(bytes, result.response.headers.get("content-type") || "");
  const dimensions = imageDimensions(bytes, contentType);
  const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const expectedSha256 = cleanText(image.content_sha256 || signedImage.content_sha256).toLowerCase();
  if (expectedSha256 && expectedSha256 !== contentSha256) throw new Error(`launch_gate_image_sha256_mismatch:${position}`);
  const fileName = `${position.replaceAll(":", "-")}-${contentSha256.slice(0, 16)}${extensionForContentType(contentType)}`;
  const outputPath = join(outputDirectory, fileName);
  await writeFile(outputPath, bytes, { mode: 0o600 });
  return {
    downloaded: true,
    attempts: result.attempts,
    invalid_local_redownloaded: Boolean(invalidLocalReason),
    invalid_local_reason: invalidLocalReason || undefined,
    image: {
      ...image,
      local_path: outputPath,
      content_type: contentType,
      size: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      content_sha256: contentSha256
    }
  };
}

export async function materializeLaunchGateImages({
  dataset,
  outputDirectory,
  baseUrl,
  cookie,
  concurrency = 8,
  maxImageBytes = defaultMaxImageBytes,
  fetchImpl = globalThis.fetch
} = {}) {
  const items = loadItems(dataset);
  if (!items.length) throw new Error("launch_gate_manifest_has_no_items");
  const sourceFeedbackIds = [...new Set(items.map((item) => cleanText(item.source_feedback_id)).filter(Boolean))];
  if (sourceFeedbackIds.length !== items.length) throw new Error("launch_gate_source_ids_missing_or_duplicate");
  const access = await requestSignedSources({ baseUrl, cookie, sourceFeedbackIds, fetchImpl });
  const sourceIndex = new Map((access.sources || []).map((source) => [cleanText(source.source_feedback_id), source]));
  if (sourceIndex.size !== sourceFeedbackIds.length) throw new Error("launch_gate_image_access_incomplete");
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const jobs = items.flatMap((item, itemIndex) => (item.images || []).map((image, imageIndex) => {
    const source = sourceIndex.get(cleanText(item.source_feedback_id));
    const signedImage = (source?.images || []).find((candidate) => (
      cleanText(candidate.object_path) === cleanText(image.object_path)
      && cleanText(candidate.bucket) === cleanText(image.bucket)
    ));
    return { itemIndex, imageIndex, image, signedImage };
  }));
  const downloaded = await mapWithConcurrency(jobs, Math.max(1, Math.min(12, Number(concurrency) || 8)), (job) => (
    downloadSignedImage({
      image: job.image,
      signedImage: job.signedImage,
      outputDirectory: directory,
      maxImageBytes,
      fetchImpl,
      position: `${job.itemIndex + 1}:${job.imageIndex + 1}`
    })
  ));
  const byPosition = new Map(downloaded.map((entry, index) => {
    const job = jobs[index];
    return [`${job.itemIndex}:${job.imageIndex}`, entry.image];
  }));
  const materializedItems = items.map((item, itemIndex) => ({
    ...item,
    images: (item.images || []).map((image, imageIndex) => byPosition.get(`${itemIndex}:${imageIndex}`) || image)
  }));
  return {
    dataset: Array.isArray(dataset) ? materializedItems : { ...dataset, items: materializedItems },
    summary: {
      mode: "allowlisted_signed_url_to_ephemeral_local",
      item_count: items.length,
      image_count: jobs.length,
      downloaded_count: downloaded.filter((entry) => entry.downloaded).length,
      reused_local_count: downloaded.filter((entry) => !entry.downloaded).length,
      invalid_local_redownload_count: downloaded.filter((entry) => entry.invalid_local_redownloaded).length,
      max_download_attempts: Math.max(...downloaded.map((entry) => Number(entry.attempts || 0)))
    }
  };
}
