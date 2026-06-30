import crypto from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseReviewedTitleFields } from "../memory/title-field-parser.mjs";
import {
  filterSportsCardListings,
  sportsCardFilterVersion
} from "../retrieval/sports-card-filter.mjs";
import { buildListingImageObjectPath } from "../storage/supabase-image-storage.mjs";

export const defaultBlindEvalDir = "artifacts/blind_eval";
export const blindEvalLayoutVersion = "strict_blind_eval_v2";

export const blindInputAllowedKeys = Object.freeze([
  "case_id",
  "image_paths"
]);

export const forbiddenBlindInputKeys = Object.freeze([
  "title",
  "seller_title",
  "item_id",
  "item_url",
  "item_web_url",
  "url",
  "seller",
  "price",
  "category",
  "query",
  "description",
  "raw",
  "metadata",
  "answer",
  "answer_key",
  "label",
  "ground_truth",
  "corrected_title",
  "listing"
]);

const weakLabelFields = Object.freeze([
  "player",
  "year",
  "brand",
  "set",
  "card_number",
  "parallel",
  "rookie",
  "autograph",
  "relic",
  "serial_number",
  "grade"
]);

const narrowDiagnosticFields = Object.freeze([
  "core_identity",
  "surface_color",
  "serial_denominator"
]);

const commonTitleTokens = new Set([
  "card",
  "cards",
  "rookie",
  "auto",
  "autograph",
  "signed",
  "refractor",
  "parallel",
  "prizm",
  "chrome",
  "panini",
  "topps",
  "psa",
  "bgs",
  "sgc",
  "cgc"
]);

export function blindEvalRunPaths({
  outDir = defaultBlindEvalDir,
  runId = ""
} = {}) {
  const runRoot = resolve(runId ? join(outDir, runId) : outDir);
  return {
    run_root: runRoot,
    inference_bundle_dir: join(runRoot, "inference_bundle"),
    images_dir: join(runRoot, "inference_bundle", "images"),
    blind_inputs_path: join(runRoot, "inference_bundle", "blind_inputs.jsonl"),
    sealed_answers_dir: join(runRoot, "sealed_answers"),
    answer_key_path: join(runRoot, "sealed_answers", "answer_key.jsonl"),
    predictions_dir: join(runRoot, "predictions"),
    predictions_path: join(runRoot, "predictions", "predictions.jsonl"),
    predictions_sha256_path: join(runRoot, "predictions", "predictions.sha256"),
    scoring_dir: join(runRoot, "scoring"),
    scored_results_path: join(runRoot, "scoring", "scored_results.jsonl"),
    summary_path: join(runRoot, "scoring", "summary.json"),
    manifest_path: join(runRoot, "blind_dataset_manifest.json")
  };
}

export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeBaseUrl(value) {
  const baseUrl = normalizeText(value).replace(/\/+$/, "");
  if (!baseUrl) throw new Error("API_BASE_URL is required.");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("API_BASE_URL must start with http:// or https://.");
  return baseUrl;
}

export function envValue(env = process.env, ...keys) {
  for (const key of keys) {
    const value = normalizeText(env[key]);
    if (value) return value;
  }
  return "";
}

export function argValue(argv = process.argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

export function hasFlag(argv = process.argv, name) {
  return argv.includes(name);
}

export function integerArg(argv = process.argv, name, fallback) {
  if (!argv.includes(name)) return fallback;
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeQueryList(value, fallback = "card") {
  const queries = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[|\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const unique = queries.filter((item, index, items) => items.indexOf(item) === index);
  return unique.length ? unique : [fallback];
}

function optionalProtectionHeaders(env = process.env) {
  const headers = {};
  const bypassSecret = envValue(env, "VERCEL_AUTOMATION_BYPASS_SECRET");
  if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;
  const apiToken = envValue(env, "API_TOKEN");
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  return headers;
}

function cookieHeaderFromResponse(response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return setCookies
    .map((cookie) => String(cookie || "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 240_000, label = "Cloud request") {
  const attempts = Math.max(1, Number(process.env.BLIND_EVAL_FETCH_ATTEMPTS || 3));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 240_000));
    try {
      return await fetchImpl(url, {
        ...init,
        signal: init.signal || controller.signal
      });
    } catch (error) {
      const retryable = error?.name === "AbortError"
        || /fetch failed|network|socket|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(error?.message || error?.code || ""));
      if (!retryable || attempt >= attempts) {
        const wrapped = new Error(error?.name === "AbortError"
          ? `${label} timed out after ${Math.max(1, Number(timeoutMs) || 240_000)}ms.`
          : `${label} failed: ${error.message || error}`);
        wrapped.cause = error;
        throw wrapped;
      }
      await delay(Math.min(8000, 1000 * (2 ** (attempt - 1))));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${label} failed without a response.`);
}

async function readJsonResponseBody(response, label) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned non-JSON response: HTTP ${response.status}`);
  }
}

async function parseJsonResponse(response, label) {
  const body = await readJsonResponseBody(response, label);
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} ${normalizeText(body?.message || body?.error || "").slice(0, 180)}`.trim());
  }
  return body;
}

export async function loginToCloud({
  baseUrl,
  username,
  password,
  env = process.env,
  requestTimeoutMs = 240_000,
  fetchImpl = globalThis.fetch
}) {
  if (!username || !password) {
    throw new Error("API_USERNAME/API_PASSWORD or METAVERSE_USERNAME/METAVERSE_PASSWORD are required.");
  }
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...optionalProtectionHeaders(env)
    },
    body: JSON.stringify({ username, password })
  }, requestTimeoutMs, "Cloud login");
  await parseJsonResponse(response, "Cloud login");
  const cookie = cookieHeaderFromResponse(response);
  if (!cookie) throw new Error("Cloud login succeeded but no session cookie was returned.");
  return cookie;
}

export function jsonlLine(value) {
  return JSON.stringify(value);
}

export async function readJsonl(path) {
  const text = await readFile(resolve(path), "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

async function pathExists(path) {
  try {
    await stat(resolve(path));
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(resolve(path))).isDirectory();
  } catch {
    return false;
  }
}

async function directoryContainsAnswerKey(dir, depth = 0) {
  const resolvedDir = resolve(dir);
  if (depth > 4) return false;
  let entries = [];
  try {
    entries = await readdir(resolvedDir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((entry) => entry.isFile() && /^answer_key\.jsonl$/i.test(entry.name))) return true;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await directoryContainsAnswerKey(join(resolvedDir, entry.name), depth + 1)) return true;
  }
  return false;
}

async function resolveRecognitionInputPath(inputPath) {
  const resolved = resolve(inputPath);
  if (await isDirectory(resolved)) {
    if (await directoryContainsAnswerKey(resolved)) {
      throw new Error("Recognition input directory contains answer_key.jsonl. Point recognition at inference_bundle only.");
    }
    const blindInputsPath = join(resolved, "blind_inputs.jsonl");
    if (!await pathExists(blindInputsPath)) {
      throw new Error("Recognition input directory must contain blind_inputs.jsonl.");
    }
    return blindInputsPath;
  }
  if (/answer|key|title/i.test(basename(resolved))) {
    throw new Error("Recognition input path looks like an answer key or title file.");
  }
  return resolved;
}

export async function itemIdsFromAnswerKey(path) {
  if (!normalizeText(path) || !await pathExists(path)) return [];
  return readJsonl(path).then((rows) => rows
    .map((row) => normalizeText(row.item_id))
    .filter(Boolean));
}

export async function itemIdsFromAnswerKeys(paths = []) {
  const ids = new Set();
  for (const path of paths.map(normalizeText).filter(Boolean)) {
    for (const itemId of await itemIdsFromAnswerKey(path)) ids.add(itemId);
  }
  return ids;
}

export async function writeJsonl(path, rows = []) {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${rows.map(jsonlLine).join("\n")}${rows.length ? "\n" : ""}`);
}

export async function writeJson(path, value) {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function toPortablePath(path) {
  return path.split(sep).join("/");
}

export function relativePortablePath(path, cwd = process.cwd()) {
  return toPortablePath(relative(cwd, resolve(path)));
}

function keyLooksForbidden(key = "") {
  const normalized = String(key || "").trim().toLowerCase();
  if (!normalized) return false;
  if (forbiddenBlindInputKeys.includes(normalized)) return true;
  return forbiddenBlindInputKeys.some((forbidden) => {
    if (["url", "raw", "label", "query"].includes(forbidden)) {
      return normalized === forbidden || normalized.endsWith(`_${forbidden}`);
    }
    return normalized.includes(forbidden);
  });
}

export function findForbiddenBlindInputKeys(value, path = []) {
  const hits = [];
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      hits.push(...findForbiddenBlindInputKeys(item, [...path, String(index)]));
    });
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (keyLooksForbidden(key)) hits.push(childPath.join("."));
    hits.push(...findForbiddenBlindInputKeys(child, childPath));
  }
  return hits;
}

export function assertBlindInputRow(row = {}, index = 0) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`Blind input row ${index + 1} must be an object.`);
  }
  const forbidden = findForbiddenBlindInputKeys(row);
  if (forbidden.length) {
    throw new Error(`Blind input row ${index + 1} contains forbidden answer-key keys: ${forbidden.join(", ")}`);
  }
  const keys = Object.keys(row);
  const extraKeys = keys.filter((key) => !blindInputAllowedKeys.includes(key));
  if (extraKeys.length) {
    throw new Error(`Blind input row ${index + 1} has non-blind keys: ${extraKeys.join(", ")}`);
  }
  if (!normalizeText(row.case_id)) throw new Error(`Blind input row ${index + 1} is missing case_id.`);
  if (!Array.isArray(row.image_paths) || row.image_paths.length === 0) {
    throw new Error(`Blind input row ${index + 1} must include image_paths.`);
  }
  row.image_paths.forEach((imagePath, imageIndex) => {
    if (!normalizeText(imagePath)) throw new Error(`Blind input row ${index + 1} image_paths[${imageIndex}] is empty.`);
    if (/^https?:\/\//i.test(normalizeText(imagePath))) {
      throw new Error(`Blind input row ${index + 1} image_paths[${imageIndex}] must be a local path, not a URL.`);
    }
  });
  return true;
}

export function assertBlindInputRows(rows = []) {
  rows.forEach((row, index) => assertBlindInputRow(row, index));
  return true;
}

function titleLeakTokens(title = "") {
  return normalizeText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !/^\d+$/.test(token) && !commonTitleTokens.has(token));
}

export function assertOpaqueImageFilename(imagePath = "", title = "") {
  const filename = basename(imagePath).toLowerCase();
  const leaked = titleLeakTokens(title).find((token) => filename.includes(token));
  if (leaked) throw new Error(`Blind image filename leaks title token "${leaked}": ${imagePath}`);
}

export function assertSellerListing(listing = {}, expectedSeller = "dcsports87") {
  const seller = normalizeText(listing.seller).toLowerCase();
  if (seller !== expectedSeller.toLowerCase()) {
    throw new Error(`Rejected non-${expectedSeller} listing: seller=${listing.seller || "(missing)"}`);
  }
  if (!normalizeText(listing.title)) throw new Error("Listing is missing title for sealed answer key.");
  if (!normalizeText(listing.item_id)) throw new Error("Listing is missing item_id for sealed answer key.");
  if (!normalizeText(listing.item_web_url)) throw new Error("Listing is missing item_web_url for sealed answer key.");
  if (!Array.isArray(listing.image_urls) || listing.image_urls.length === 0) {
    throw new Error(`Listing ${listing.item_id} has no images.`);
  }
}

async function responseBytes(response, label) {
  if (!response.ok) throw new Error(`${label} failed: HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error(`${label} returned an empty body.`);
  return bytes;
}

export function detectImageContentType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a") return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function parsePngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function parseJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    if (sofMarkers.has(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function parseWebpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunkType = bytes.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27)
    };
  }
  if (chunkType === "VP8 " && bytes.length >= 30 && bytes.toString("hex", 23, 26) === "9d012a") {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }
  if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  return null;
}

export function parseImageDimensions(bytes, contentType = "") {
  if (contentType === "image/jpeg") return parseJpegDimensions(bytes);
  if (contentType === "image/png") return parsePngDimensions(bytes);
  if (contentType === "image/webp") return parseWebpDimensions(bytes);
  return null;
}

export function imageDescriptorFromBytes(bytes) {
  const contentType = detectImageContentType(bytes);
  if (!contentType) throw new Error("Unsupported image type. Expected JPEG, PNG, or WebP.");
  const dimensions = parseImageDimensions(bytes, contentType);
  if (!dimensions?.width || !dimensions?.height) {
    throw new Error(`Unable to read ${contentType} image dimensions.`);
  }
  return {
    contentType,
    size: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
    signatureHex: bytes.subarray(0, 64).toString("hex"),
    contentSha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function ebayImageUrlCandidates(url = "") {
  const original = normalizeText(url);
  if (!/^https:\/\//i.test(original)) return [];
  const candidates = [original];
  for (const size of [1600, 1200, 960, 800, 500]) {
    const replacedPathSize = original.replace(/\/s-l\d+(?=\.)/i, `/s-l${size}`);
    if (replacedPathSize !== original) candidates.push(replacedPathSize);
    const replacedDollarSize = original.replace(/\$_\d+(?=\.)/i, `$_${size}`);
    if (replacedDollarSize !== original) candidates.push(replacedDollarSize);
  }
  return candidates.filter((candidate, index, urls) => urls.indexOf(candidate) === index);
}

async function downloadBestEbayImage({
  imageUrl,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 240_000,
  label = "eBay image download"
} = {}) {
  const candidates = ebayImageUrlCandidates(imageUrl);
  const failures = [];
  let best = null;
  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(fetchImpl, candidate, {}, requestTimeoutMs, label);
      const bytes = await responseBytes(response, label);
      const descriptor = imageDescriptorFromBytes(bytes);
      if (!best || (descriptor.width * descriptor.height) > (best.descriptor.width * best.descriptor.height)) {
        best = {
          url: candidate,
          bytes,
          descriptor
        };
      }
      if (descriptor.width >= 900 || descriptor.height >= 900) break;
    } catch (error) {
      failures.push({
        url: candidate,
        reason: error?.message || "download_failed"
      });
    }
  }
  if (!best) {
    const firstFailure = failures[0]?.reason || "all image variants failed";
    throw new Error(firstFailure);
  }
  return {
    ...best,
    attempted_urls: candidates.length,
    failed_urls: failures.length
  };
}

export async function prepareBlindDataset({
  baseUrl,
  username,
  password,
  outDir = defaultBlindEvalDir,
  runId = "",
  limit = 2,
  imageLimit = 2,
  excludeAnswerKeyPaths = [],
  excludedItemIds = [],
  expectedSeller = "dcsports87",
  query = "",
  sportsOnly = false,
  categoryIds = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 240_000
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 2));
  const safeImageLimit = Math.max(1, Math.min(6, Number(imageLimit) || 2));
  const paths = blindEvalRunPaths({ outDir, runId });
  const excluded = new Set([
    ...Array.from(await itemIdsFromAnswerKeys(excludeAnswerKeyPaths)),
    ...excludedItemIds.map(normalizeText).filter(Boolean)
  ]);
  const cookie = await loginToCloud({ baseUrl: normalizedBaseUrl, username, password, env, requestTimeoutMs, fetchImpl });
  const queryList = normalizeQueryList(query, "card");
  const fetchLimit = Math.min(50, Math.max(safeLimit, Math.min(50, safeLimit + excluded.size + (sportsOnly ? 40 : 20))));
  const maxListingPagesPerQuery = Math.max(1, Math.min(10, Number(env.BLIND_EVAL_LISTING_PAGES || 3) || 3));
  const candidateListings = [];
  const seenItemIds = new Set();
  const listingFetchOffsets = [];
  const listingFetches = [];
  let remoteSportsFilteredCount = 0;
  let listingsPayload = {};
  let sportsFilter = {
    listings: candidateListings,
    discarded: [],
    discarded_count: 0,
    discard_reasons: {},
    filter_version: sportsCardFilterVersion
  };
  let listings = candidateListings;
  let listingPageCount = 0;

  for (const activeQuery of queryList) {
    let listingOffset = 0;
    let pagesForQuery = 0;
    let moreResultsAvailable = true;
    while (listings.length < safeLimit && pagesForQuery < maxListingPagesPerQuery && moreResultsAvailable) {
      const listingSearchParams = new URLSearchParams({
        limit: String(fetchLimit),
        offset: String(listingOffset)
      });
      if (activeQuery) listingSearchParams.set("q", activeQuery);
      if (sportsOnly) listingSearchParams.set("sports_only", "1");
      if (categoryIds) listingSearchParams.set("category_ids", categoryIds);

      const listingsResponse = await fetchWithTimeout(fetchImpl, `${normalizedBaseUrl}/api/ebay-dcsports87-listings?${listingSearchParams}`, {
        headers: {
          cookie,
          ...optionalProtectionHeaders(env)
        }
      }, requestTimeoutMs, "dcsports87 listings");
      listingsPayload = await parseJsonResponse(listingsResponse, "dcsports87 listings");
      listingPageCount += 1;
      pagesForQuery += 1;
      listingFetchOffsets.push(listingOffset);
      listingFetches.push({
        query: activeQuery,
        offset: listingOffset,
        returned_count: Number(listingsPayload.returned_count || 0),
        sports_filtered_count: Number(listingsPayload.sports_filtered_count || 0)
      });
      remoteSportsFilteredCount += Number(listingsPayload.sports_filtered_count || 0);

      for (const listing of Array.isArray(listingsPayload.listings) ? listingsPayload.listings : []) {
        const itemId = normalizeText(listing.item_id);
        if (!itemId || excluded.has(itemId) || seenItemIds.has(itemId)) continue;
        seenItemIds.add(itemId);
        candidateListings.push(listing);
      }

      sportsFilter = sportsOnly
        ? filterSportsCardListings(candidateListings)
        : {
          listings: candidateListings,
          discarded: [],
          discarded_count: 0,
          discard_reasons: {},
          filter_version: sportsCardFilterVersion
        };
      listings = sportsFilter.listings;
      moreResultsAvailable = Boolean(listingsPayload.more_results_available);
      listingOffset += Math.max(1, Number(listingsPayload.provider_requested_limit || fetchLimit) || fetchLimit);
    }
    if (listings.length >= safeLimit) break;
  }

  if (!listings.length) throw new Error("dcsports87 listings endpoint returned zero listings.");
  if (listings.length < safeLimit) {
    throw new Error(`Only ${listings.length} listings remained after ${listingPageCount} eBay page(s), excluding prior answer keys and sports filter; need ${safeLimit}.`);
  }

  const imageDir = paths.images_dir;
  await mkdir(imageDir, { recursive: true });
  await mkdir(paths.sealed_answers_dir, { recursive: true });
  const blindRows = [];
  const answerRows = [];
  const skippedImageDownloads = [];
  const downloadedImageQuality = [];

  for (const listing of listings) {
    if (blindRows.length >= safeLimit) break;
    assertSellerListing(listing, expectedSeller);
    const caseId = crypto.randomUUID();
    const selectedUrls = listing.image_urls.slice(0, safeImageLimit);
    const imagePaths = [];
    try {
      for (const [imageIndex, imageUrl] of selectedUrls.entries()) {
        const download = await downloadBestEbayImage({
          imageUrl,
          fetchImpl,
          requestTimeoutMs,
          label: `eBay image download ${imageIndex + 1}`
        });
        const imagePath = join(imageDir, `${caseId}_img_${imageIndex}.jpg`);
        await writeFile(imagePath, download.bytes);
        assertOpaqueImageFilename(imagePath, listing.title);
        downloadedImageQuality.push({
          item_id: listing.item_id,
          image_index: imageIndex,
          width: download.descriptor.width,
          height: download.descriptor.height,
          size: download.descriptor.size,
          attempted_urls: download.attempted_urls,
          failed_urls: download.failed_urls,
          upgraded: download.url !== imageUrl
        });
        imagePaths.push(relativePortablePath(imagePath));
      }
    } catch (error) {
      skippedImageDownloads.push({
        item_id: listing.item_id,
        image_count: selectedUrls.length,
        reason: error?.message || "image_download_failed"
      });
      continue;
    }
    const blindRow = {
      case_id: caseId,
      image_paths: imagePaths
    };
    assertBlindInputRow(blindRow, blindRows.length);
    blindRows.push(blindRow);
    answerRows.push({
      case_id: caseId,
      seller: expectedSeller,
      item_id: listing.item_id,
      item_web_url: listing.item_web_url,
      title: listing.title,
      raw_listing_metadata: {
        marketplace_id: listing.marketplace_id || listingsPayload.marketplace_id || null,
        condition: listing.condition || null,
        price: listing.price || null,
        seller_verification: listing.seller_verification || null,
        image_count: listing.image_urls.length
      }
    });
  }

  if (blindRows.length < safeLimit) {
    throw new Error(`Only ${blindRows.length} listings produced downloadable blind inputs after skipping ${skippedImageDownloads.length} failed image listing(s); need ${safeLimit}.`);
  }

  const blindInputPath = paths.blind_inputs_path;
  const answerKeyPath = paths.answer_key_path;
  await writeJsonl(blindInputPath, blindRows);
  await writeJsonl(answerKeyPath, answerRows);
  const manifest = {
    ok: true,
    layout_version: blindEvalLayoutVersion,
    generated_at: new Date().toISOString(),
    run_id: runId || basename(paths.run_root),
    seller: expectedSeller,
    listing_count: blindRows.length,
    excluded_item_count: excluded.size,
    ebay_query: queryList[0] || listingsPayload.query || "card",
    ebay_queries: queryList,
    ebay_category_ids: categoryIds || listingsPayload.category_ids || "",
    sports_only: Boolean(sportsOnly),
    sports_filter_version: sportsCardFilterVersion,
    listing_fetch_limit: fetchLimit,
    listing_pages_per_query: maxListingPagesPerQuery,
    listing_page_count: listingPageCount,
    listing_fetch_offsets: listingFetchOffsets,
    listing_fetches: listingFetches,
    sports_filtered_count: remoteSportsFilteredCount + sportsFilter.discarded_count,
    local_sports_filtered_count: sportsFilter.discarded_count,
    blind_inputs_path: relativePortablePath(blindInputPath),
    answer_key_path: relativePortablePath(answerKeyPath),
    inference_bundle_dir: relativePortablePath(paths.inference_bundle_dir),
    sealed_answers_dir: relativePortablePath(paths.sealed_answers_dir),
    anti_leakage: {
      blind_input_allowed_keys: blindInputAllowedKeys,
      recognition_must_not_read_answer_key: true
    },
    image_download_skipped_count: skippedImageDownloads.length,
    image_download_skipped_samples: skippedImageDownloads.slice(0, 10),
    downloaded_image_quality_summary: {
      min_width: downloadedImageQuality.reduce((min, image) => Math.min(min, image.width), Infinity),
      min_height: downloadedImageQuality.reduce((min, image) => Math.min(min, image.height), Infinity),
      upgraded_count: downloadedImageQuality.filter((image) => image.upgraded).length,
      image_count: downloadedImageQuality.length
    },
    downloaded_image_quality_samples: downloadedImageQuality.slice(0, 20)
  };
  await writeJson(paths.manifest_path, manifest);
  return {
    ...manifest,
    blind_rows: blindRows,
    answer_rows: answerRows
  };
}

async function uploadLocalImageToCloud({
  baseUrl,
  cookie,
  caseId,
  imagePath,
  imageIndex,
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 240_000
}) {
  const resolvedPath = resolve(imagePath);
  const bytes = await readFile(resolvedPath);
  const descriptor = imageDescriptorFromBytes(bytes);
  const role = imageIndex === 0 ? "front_original" : imageIndex === 1 ? "back_original" : `detail_${imageIndex}`;
  const imageId = `${caseId}_img_${imageIndex}`;
  const expectedObjectPath = buildListingImageObjectPath({
    assetId: caseId,
    imageId,
    role,
    fileName: basename(imagePath),
    contentType: descriptor.contentType
  });
  const uploadResponse = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/listing-image-upload-url`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...optionalProtectionHeaders(env)
    },
    body: JSON.stringify({
      assetId: caseId,
      imageId,
      role,
      fileName: basename(imagePath),
      contentType: descriptor.contentType,
      size: descriptor.size,
      width: descriptor.width,
      height: descriptor.height,
      signatureHex: descriptor.signatureHex,
      contentSha256: descriptor.contentSha256
    })
  }, requestTimeoutMs, "Cloud image upload URL");
  const uploadPayload = await readJsonResponseBody(uploadResponse, "Cloud image upload URL");
  if (!uploadResponse.ok) {
    const message = normalizeText(uploadPayload?.message || uploadPayload?.error || "");
    if (/resource already exists/i.test(message)) {
      return verifyExistingLocalImageOnCloud({
        baseUrl,
        cookie,
        caseId,
        imageId,
        role,
        objectPath: expectedObjectPath,
        env,
        fetchImpl,
        requestTimeoutMs
      });
    }
    throw new Error(`Cloud image upload URL failed: HTTP ${uploadResponse.status} ${message.slice(0, 180)}`.trim());
  }
  const upload = uploadPayload.upload;
  if (!upload?.signed_upload_url || !upload.object_path) throw new Error("Cloud image upload URL response is missing upload fields.");

  const storageResponse = await fetchWithTimeout(fetchImpl, upload.signed_upload_url, {
    method: "PUT",
    headers: {
      "content-type": upload.content_type || descriptor.contentType
    },
    body: bytes
  }, requestTimeoutMs, "Cloud storage PUT");
  if (!storageResponse.ok) throw new Error(`Cloud storage PUT failed: HTTP ${storageResponse.status}`);

  const verifyResponse = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/listing-image-verify-upload`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...optionalProtectionHeaders(env)
    },
    body: JSON.stringify({
      assetId: caseId,
      imageId,
      role,
      objectPath: upload.object_path,
      contentType: upload.content_type || descriptor.contentType,
      size: descriptor.size,
      width: descriptor.width,
      height: descriptor.height,
      signatureHex: descriptor.signatureHex,
      contentSha256: descriptor.contentSha256
    })
  }, requestTimeoutMs, "Cloud image upload verification");
  const verifyPayload = await parseJsonResponse(verifyResponse, "Cloud image upload verification");
  const verification = verifyPayload.verification;
  if (!verification?.verification_token) throw new Error("Cloud image verification did not return a verification token.");
  return {
    id: imageId,
    image_id: imageId,
    name: `blind_image_${imageIndex}`,
    bucket: verification.bucket,
    objectPath: verification.object_path,
    object_path: verification.object_path,
    role,
    capture_angle: imageIndex === 0 ? "front" : imageIndex === 1 ? "back" : "detail",
    storageVerified: true,
    storage_verified: true,
    storageVerificationToken: verification.verification_token,
    storage_verification_token: verification.verification_token,
    contentType: verification.content_type || descriptor.contentType,
    content_type: verification.content_type || descriptor.contentType,
    originalType: verification.content_type || descriptor.contentType,
    original_type: verification.content_type || descriptor.contentType,
    size: verification.size || descriptor.size,
    originalSize: verification.size || descriptor.size,
    original_size: verification.size || descriptor.size,
    width: verification.width || descriptor.width,
    originalWidth: verification.width || descriptor.width,
    original_width: verification.width || descriptor.width,
    height: verification.height || descriptor.height,
    originalHeight: verification.height || descriptor.height,
    original_height: verification.height || descriptor.height,
    contentSha256: verification.content_sha256 || descriptor.contentSha256,
    content_sha256: verification.content_sha256 || descriptor.contentSha256
  };
}

async function verifyExistingLocalImageOnCloud({
  baseUrl,
  cookie,
  caseId,
  imageId,
  role,
  objectPath,
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 240_000
}) {
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/listing-image-verify-existing`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...optionalProtectionHeaders(env)
    },
    body: JSON.stringify({
      assetId: caseId,
      imageId,
      role,
      objectPath
    })
  }, requestTimeoutMs, "Cloud existing image verification");
  const payload = await parseJsonResponse(response, "Cloud existing image verification");
  const verification = payload.verification;
  if (!verification?.verification_token) throw new Error("Cloud existing image verification did not return a verification token.");
  return {
    id: imageId,
    image_id: imageId,
    name: `blind_image_${imageId.split("_img_").pop() || "0"}`,
    bucket: verification.bucket,
    objectPath: verification.object_path,
    object_path: verification.object_path,
    role,
    capture_angle: role === "front_original" ? "front" : role === "back_original" ? "back" : "detail",
    storageVerified: true,
    storage_verified: true,
    storageVerificationToken: verification.verification_token,
    storage_verification_token: verification.verification_token,
    contentType: verification.content_type,
    content_type: verification.content_type,
    originalType: verification.content_type,
    original_type: verification.content_type,
    size: verification.size,
    originalSize: verification.size,
    original_size: verification.size,
    width: verification.width,
    originalWidth: verification.width,
    original_width: verification.width,
    height: verification.height,
    originalHeight: verification.height,
    original_height: verification.height,
    contentSha256: verification.content_sha256 || null,
    content_sha256: verification.content_sha256 || null
  };
}

function blindProviderOptions(providerMode = "openai_vector") {
  const cGroup = normalizeText(providerMode || "openai_vector").toLowerCase() !== "openai_baseline";
  return {
    single_model_fast: !cGroup,
    corrected_title_as_temporary_gt: false,
    send_corrected_title_hint_to_cloud: false,
    cloud_eval_blind_to_corrected_title_hint: true,
    enable_evidence_completion: cGroup,
    enable_catalog_assist: cGroup,
    enable_vector_assist: cGroup,
    enable_stored_visual_features: cGroup,
    enable_query_visual_embeddings: cGroup,
    enable_vector_retrieval: cGroup,
    vector_retrieval_mode: cGroup ? "assist" : "off",
    vector_corrected_title_as_temporary_gt: false,
    vector_query_timeout_ms: cGroup ? Math.max(1, Number(process.env.CLOUD_LISTING_API_VECTOR_QUERY_TIMEOUT_MS || process.env.VECTOR_QUERY_TIMEOUT_MS || 120000)) : undefined,
    vector_retrieval_internal_top_n: cGroup ? 10 : undefined,
    enable_advanced_retrieval: cGroup,
    enable_hybrid_retrieval: cGroup,
    enable_gpt_failure_fallback: false,
    enable_gpt_provider_failure_fallback: false,
    enable_gpt_critical_verifier: false,
    blind_eval: true,
    eval_flags: {
      BLIND_EBAY_EVAL: true,
      ENABLE_CATALOG_ASSIST: cGroup,
      ENABLE_VECTOR_ASSIST: cGroup,
      CORRECTED_TITLE_AS_TEMPORARY_GT: false,
      SEND_CORRECTED_TITLE_HINT_TO_CLOUD: false,
      BLIND_TO_CORRECTED_TITLE_HINT: true
    }
  };
}

function retryableBlindRecognitionResult(response = {}, data = {}) {
  const status = Number(response.status || 0);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  if (!response.ok && status >= 500) return true;
  const errorText = normalizeText([
    data.provider_error_code,
    data.provider_error_type,
    data.error_type,
    data.error,
    data.reason,
    data.message,
    data.confidence
  ].filter(Boolean).join(" "));
  if (!errorText) return false;
  return /timeout|timed out|rate.?limit|429|temporar|overload|provider|invalid_json_response|network|fetch failed/i.test(errorText)
    && /failed|timeout|timed out|rate.?limit|429|temporar|overload|provider|invalid_json_response|network|fetch failed/i.test(errorText);
}

function valueFromFields(fields = {}, keys = []) {
  for (const key of keys) {
    const value = fields?.[key];
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === "boolean") return value;
    if (normalizeText(value)) return value;
  }
  return "";
}

function boolFromFields(fields = {}, keys = []) {
  for (const key of keys) {
    if (fields?.[key] === true) return true;
    if (fields?.[key] === false) return false;
  }
  return null;
}

function playersFromFields(fields = {}) {
  const players = valueFromFields(fields, ["players", "subjects"]);
  if (Array.isArray(players)) return players.map(normalizeText).filter(Boolean);
  const player = valueFromFields(fields, ["player", "subject"]);
  return normalizeText(player) ? [normalizeText(player)] : [];
}

function canonicalPredictionParallelFromText(text = "") {
  const normalized = normalizeText(text);
  const tigerMatch = normalized.match(/\b(?:(?:Prizm\s+)?Choice\s+)?Tiger(?:\s+Stripes?)?\b/i);
  if (tigerMatch) {
    return {
      value: "Tiger Stripe",
      raw_evidence: normalizeText(tigerMatch[0])
    };
  }
  const colorMatch = normalized.match(/\b(Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/i);
  if (colorMatch) {
    return {
      value: colorMatch[1].replace(/\b\w/g, (letter) => letter.toUpperCase()),
      raw_evidence: normalizeText(colorMatch[0])
    };
  }
  return {
    value: "",
    raw_evidence: ""
  };
}

function productFromPredictionText(text = "", brand = "") {
  const normalized = normalizeText(text);
  if (/\bPanini\b/i.test(normalized) && /\bPrizm\b/i.test(normalized) && /\bChoice\b/i.test(normalized)) return "Prizm Choice";
  if (/\bPrizm\b/i.test(normalized) && /\bChoice\b/i.test(normalized)) return "Prizm Choice";
  if (/\bPrizm\b/i.test(normalized)) return "Prizm";
  if (/\bTopps\s+Chrome\b/i.test(normalized)) return "Topps Chrome";
  const parsed = parseReviewedTitleFields(normalized);
  return normalizeText(parsed.product || parsed.set || "").replace(new RegExp(`^${escapeRegExp(normalizeText(brand))}\\s+`, "i"), "");
}

function extractFieldsFromPredictionText(rawPredictionText = "") {
  const raw = normalizeText(rawPredictionText);
  if (!raw) return { fields: {}, evidence: {} };
  const parsed = parseReviewedTitleFields(raw);
  const parallel = canonicalPredictionParallelFromText(raw);
  const players = Array.isArray(parsed.players) && parsed.players.length
    ? parsed.players.map(normalizeText).filter(Boolean)
    : fallbackPlayersFromTitle(raw, parsed);
  const grade = gradeFromSellerTitle(raw, parsed);
  const year = raw.match(/\b(\d{4}(?:-\d{2})?)\b/)?.[1] || parsed.year || "";
  const brand = parsed.manufacturer || parsed.brand || raw.match(/\b(Topps|Panini|Bowman|Upper Deck|Fleer|Donruss|Leaf|Score)\b/i)?.[1] || "";
  const cardNumber = parsed.collector_number || raw.match(/#\s*([A-Z0-9][A-Z0-9-]{0,18})\b/i)?.[1] || "";
  const fields = {
    raw_prediction_text: raw,
    year: normalizeText(year),
    brand: normalizeText(brand),
    set: productFromPredictionText(raw, brand),
    player: players.join(" / "),
    players,
    card_number: normalizeText(cardNumber).toUpperCase(),
    parallel: parallel.value,
    rookie: /\b(?:RC|Rookie)\b/i.test(raw) ? true : null,
    autograph: /\b(?:Auto|Autograph|Signed|Signature)\b/i.test(raw) ? true : null,
    relic: /\b(?:Patch|Relic|Swatch|Memorabilia|Jersey)\b/i.test(raw) ? true : null,
    serial_number: normalizeSerial(raw),
    grade_company: grade.grade_company,
    grade: grade.grade
  };
  const compactFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value === true;
    return normalizeText(value) !== "";
  }));
  return {
    fields: compactFields,
    evidence: {
      parallel: parallel.raw_evidence
    }
  };
}

function mergePredictionTextFields(structured = {}, extracted = {}) {
  const merged = { ...structured };
  for (const [field, value] of Object.entries(extracted.fields || {})) {
    if (field === "raw_prediction_text") continue;
    if (Array.isArray(value)) {
      if (!Array.isArray(merged[field]) || merged[field].length === 0) merged[field] = value;
      continue;
    }
    if (typeof value === "boolean") {
      if (merged[field] === null || merged[field] === undefined) merged[field] = value;
      continue;
    }
    const current = normalizeText(merged[field]);
    const next = normalizeText(value);
    if (!next) continue;
    if (!current) {
      merged[field] = next;
      continue;
    }
    if (field === "set" && next.length > current.length && next.toLowerCase().includes(current.toLowerCase())) {
      merged[field] = next;
    }
  }
  return merged;
}

export function predictionSelfConsistencyWarnings(structured = {}, extracted = {}) {
  const warnings = [];
  const extractedFields = extracted.fields || {};
  for (const field of ["parallel", "set", "card_number", "grade"]) {
    const rawValue = extractedFields[field];
    if (!normalizeText(rawValue)) continue;
    const structuredValue = normalizeText(structured[field]);
    const missing = !structuredValue;
    const lessSpecific = field === "set"
      && structuredValue
      && normalizeText(rawValue).length > structuredValue.length
      && normalizeText(rawValue).toLowerCase().includes(structuredValue.toLowerCase());
    if (!missing && !lessSpecific) continue;
    warnings.push({
      type: "STRUCTURED_FIELD_MISSING_FROM_RAW_PREDICTION",
      field,
      raw_evidence: field === "parallel" ? extracted.evidence?.parallel || rawValue : rawValue
    });
  }
  return warnings;
}

export function recognitionOutputFromCloudData(data = {}) {
  const fields = data.resolved_fields || data.resolved || data.fields || {};
  const rawPredictionText = normalizeText(data.final_title || data.title || data.rendered_title);
  const players = playersFromFields(fields);
  const structuredFields = {
    title: rawPredictionText,
    player: players.join(" / ") || normalizeText(fields.player || fields.subject),
    players,
    year: normalizeText(valueFromFields(fields, ["year", "season_year", "product_year"])),
    brand: normalizeText(valueFromFields(fields, ["manufacturer", "brand"])),
    set: normalizeText(valueFromFields(fields, ["product", "set", "product_or_set"])),
    card_number: normalizeText(valueFromFields(fields, ["collector_number", "checklist_code", "card_number"])),
    surface_color: normalizeText(valueFromFields(fields, ["surface_color", "color"])),
    parallel: normalizeText(valueFromFields(fields, ["parallel_exact", "parallel", "variant_or_parallel", "surface_color"])),
    rookie: boolFromFields(fields, ["rc", "rookie"]),
    autograph: boolFromFields(fields, ["auto", "autograph"]),
    relic: boolFromFields(fields, ["relic", "patch", "jersey"]),
    serial_number: normalizeText(valueFromFields(fields, ["serial_number"])),
    grade_company: normalizeText(valueFromFields(fields, ["grade_company"])),
    grade: normalizeText(valueFromFields(fields, ["card_grade", "grade", "auto_grade"])),
    cert_number: normalizeText(valueFromFields(fields, ["cert_number", "certification_number"]))
  };
  const extracted = extractFieldsFromPredictionText(rawPredictionText);
  const merged = mergePredictionTextFields(structuredFields, extracted);
  return {
    ...merged,
    raw_prediction_text: rawPredictionText,
    structured_fields: structuredFields,
    prediction_text_extracted_fields: extracted.fields,
    self_consistency_warnings: predictionSelfConsistencyWarnings(structuredFields, extracted)
  };
}

export async function runBlindRecognition({
  inputPath = join(defaultBlindEvalDir, "inference_bundle"),
  outputPath = join(defaultBlindEvalDir, "predictions", "predictions.jsonl"),
  predictionsSha256Path = "",
  baseUrl,
  username,
  password,
  provider = "openai_legacy",
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 240_000,
  resume = true,
  providerMode = "openai_vector",
  onProgress = null
} = {}) {
  const resolvedInputPath = await resolveRecognitionInputPath(inputPath);
  const rows = await readJsonl(resolvedInputPath);
  assertBlindInputRows(rows);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const cookie = await loginToCloud({ baseUrl: normalizedBaseUrl, username, password, env, requestTimeoutMs, fetchImpl });
  const existingPredictions = resume && await pathExists(outputPath) ? await readJsonl(outputPath) : [];
  const existingByCaseId = new Map(existingPredictions
    .filter((prediction) => normalizeText(prediction.case_id))
    .map((prediction) => [normalizeText(prediction.case_id), prediction]));
  const predictions = [];
  const maxRecognitionAttempts = Math.max(1, Number(env.BLIND_EVAL_RECOGNITION_ATTEMPTS || 2));
  for (const [index, row] of rows.entries()) {
    const existingPrediction = existingByCaseId.get(normalizeText(row.case_id));
    if (existingPrediction) {
      predictions.push(existingPrediction);
      if (typeof onProgress === "function") {
        onProgress({
          case_id: row.case_id,
          index: index + 1,
          total: rows.length,
          skipped: true,
          prediction_count: predictions.length
        });
      }
      continue;
    }
    const images = [];
    for (const [imageIndex, imagePath] of row.image_paths.entries()) {
      images.push(await uploadLocalImageToCloud({
        baseUrl: normalizedBaseUrl,
        cookie,
        caseId: row.case_id,
        imagePath,
        imageIndex,
        env,
        fetchImpl,
        requestTimeoutMs
      }));
    }
    const payload = {
      provider,
      provider_id: provider,
      provider_eval_mode: providerMode,
      provider_options: blindProviderOptions(providerMode),
      catalog_observation_hint: null,
      explicitEmergency: provider === "openai_legacy",
      explicit_emergency: provider === "openai_legacy",
      maxTitleLength: 80,
      captureProfileId: "ebay_blind_eval",
      assetId: row.case_id,
      asset_id: row.case_id,
      images
    };
    const started = Date.now();
    let response = null;
    let data = {};
    let recognitionAttempts = 0;
    for (let attempt = 1; attempt <= maxRecognitionAttempts; attempt += 1) {
      recognitionAttempts = attempt;
      response = await fetchWithTimeout(fetchImpl, `${normalizedBaseUrl}/api/listing-copilot-title`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          ...optionalProtectionHeaders(env)
        },
        body: JSON.stringify(payload)
      }, requestTimeoutMs, "Cloud blind recognition");
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {
          confidence: "FAILED",
          provider_error_code: "invalid_json_response",
          reason: text.slice(0, 240)
        };
      }
      if (!retryableBlindRecognitionResult(response, data) || attempt >= maxRecognitionAttempts) break;
      await delay(Math.min(5000, 1000 * attempt));
    }
    const recognitionOutput = recognitionOutputFromCloudData(data);
    predictions.push({
      case_id: row.case_id,
      recognition_output: recognitionOutput,
      model_confidence: data.confidence || null,
      model_notes: Array.isArray(data.unresolved) ? data.unresolved : [],
      provider,
      model_id: data.model_id || data.provider_model_id || null,
      provider_mode: providerMode,
      recognition_status: data.provider_recognition_status || data.identity_resolution_status || data.recognition_status || null,
      error_type: response.ok ? data.provider_error_code || data.provider_error_type || null : `http_${response.status}`,
      http_status: response.status,
      timing: {
        ...(data.timing || { total_ms: Date.now() - started }),
        blind_recognition_attempts: recognitionAttempts
      },
      usage: data.usage || null,
      c_group_diagnostics: {
        catalog_prompt_assist_used: data.catalog_prompt_assist_used ?? null,
        vector_prompt_assist_used: data.vector_prompt_assist_used ?? null,
        retrieval_title_assist_used: data.retrieval_title_assist_used ?? null,
        catalog_assist_eligibility: data.catalog_assist_eligibility || null,
        vector_assist_eligibility: data.vector_assist_eligibility || null,
        catalog_retrieval_metrics: data.catalog_retrieval?.catalog_retrieval_metrics || data.catalog_retrieval_metrics || null,
        vector_retrieval_metrics: data.vector_retrieval?.visual_vector_metrics || data.vector_retrieval_metrics || null,
        open_set_decision: data.open_set_decision || data.open_set || null,
        retrieval_sources: [
          ...(Array.isArray(data.catalog_retrieval?.sources) ? data.catalog_retrieval.sources : []),
          ...(Array.isArray(data.vector_retrieval?.sources) ? data.vector_retrieval.sources : []),
          ...(Array.isArray(data.retrieval?.sources) ? data.retrieval.sources : [])
        ].slice(0, 12).map((source) => ({
          provider_id: source.provider_id || source.provider || "",
          source_type: source.source_type || source.type || "",
          source_trust: source.source_trust || source.trust || "",
          title: source.title || "",
          candidate_identity_id: source.candidate_identity_id || source.identity_id || "",
          matched_fields: source.matched_fields || source.supporting_fields || [],
          conflicting_fields: source.conflicting_fields || source.direct_evidence_conflicts || source.conflicts || []
        }))
      },
      used_inputs: {
        image_paths: row.image_paths
      }
    });
    await writeJsonl(outputPath, predictions);
    if (typeof onProgress === "function") {
      onProgress({
        case_id: row.case_id,
        index: index + 1,
        total: rows.length,
        skipped: false,
        prediction_count: predictions.length,
        attempts: recognitionAttempts,
        error_type: response.ok ? data.provider_error_code || data.provider_error_type || null : `http_${response.status}`,
        recognition_status: data.provider_recognition_status || data.identity_resolution_status || data.recognition_status || null
      });
    }
  }
  await writeJsonl(outputPath, predictions);
  const predictionHash = await sha256File(outputPath);
  const hashPath = predictionsSha256Path || join(dirname(resolve(outputPath)), "predictions.sha256");
  await writeFile(resolve(hashPath), `${predictionHash}  ${basename(outputPath)}\n`);
  return {
    ok: true,
    prediction_count: predictions.length,
    blind_inputs_path: relativePortablePath(resolvedInputPath),
    predictions_path: relativePortablePath(outputPath),
    predictions_sha256_path: relativePortablePath(hashPath),
    predictions_sha256: predictionHash,
    predictions
  };
}

export async function sha256File(path) {
  const bytes = await readFile(resolve(path));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizeComparable(value = "") {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr)\./g, "$1")
    .replace(/\b(?:gem|mint|card|cards)\b/g, " ")
    .replace(/[^a-z0-9/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSerial(value = "") {
  const match = normalizeText(value).match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "";
}

function titleWithoutGradeText(title = "") {
  return normalizeText(title).replace(
    /\b(?:PSA|BGS|SGC|CGC|Beckett)\s+(?:Authentic\s+)?(?:Gem\s+Mint\s+)?(?:AUTO\s+)?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\b/gi,
    " "
  );
}

function serialDenominator(value = "") {
  const full = normalizeSerial(titleWithoutGradeText(value));
  if (full) return full.split("/")[1] || "";
  const hashMatch = titleWithoutGradeText(value).match(/#\s*\/\s*0*(\d+)\b/);
  return hashMatch ? String(Number(hashMatch[1])) : "";
}

function surfaceColorFromText(value = "") {
  const matches = [...normalizeText(value).matchAll(/\b(Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/gi)]
    .map((match) => match[1].toLowerCase());
  const unique = [...new Set(matches)];
  if (unique.length !== 1) return "";
  return unique[0].replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parallelExactFromTitle(title = "") {
  const text = normalizeText(title);
  if (/\bTiger\s+Stripe\b/i.test(text)) {
    return [
      /\bPrizm\b/i.test(text) ? "Prizm" : null,
      /\bChoice\b/i.test(text) ? "Choice" : null,
      "Tiger Stripe"
    ].filter(Boolean).join(" ");
  }
  const color = text.match(/\b(Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/i)?.[1] || "";
  const suffixes = [...text.matchAll(/\b(Cracked Ice|Geometric|Hyper|Mojo|Prizm|Refractor|Shimmer|Sparkle|Sparkles|Speckle|Tiger Stripe|Vinyl|Wave|Sapphire)\b/gi)]
    .map((match) => normalizeText(match[1]))
    .filter(Boolean);
  if (color && suffixes.length) return [color, ...suffixes].join(" ");
  if (color) return color;
  return suffixes[0] || "";
}

const titleSubjectStopWords = new Set([
  "adidas",
  "all",
  "angels",
  "apparent",
  "art",
  "atomic",
  "authentic",
  "autograph",
  "autographs",
  "auto",
  "basketball",
  "bgs",
  "blue",
  "bowman",
  "camo",
  "card",
  "cards",
  "chasing",
  "chiefs",
  "choice",
  "chrome",
  "collaboration",
  "collegiate",
  "court",
  "crystal",
  "dual",
  "emerald",
  "ex",
  "flawless",
  "gold",
  "grail",
  "greats",
  "guardians",
  "heir",
  "holo",
  "hawks",
  "inception",
  "jersey",
  "kaboom",
  "kings",
  "manga",
  "mint",
  "mosaic",
  "national",
  "nba",
  "nebula",
  "new",
  "nfl",
  "one",
  "panini",
  "patch",
  "perfect",
  "pitch",
  "pokemon",
  "prizm",
  "prizms",
  "promo",
  "psa",
  "rc",
  "red",
  "refractor",
  "relic",
  "rookie",
  "royals",
  "sapphire",
  "shield",
  "signature",
  "signatures",
  "signed",
  "silver",
  "sp",
  "spectra",
  "ssp",
  "status",
  "story",
  "superfractor",
  "spurs",
  "team",
  "topps",
  "toy",
  "treasures",
  "upper",
  "warriors",
  "yankees",
  "yu",
  "yugioh"
]);

const knownSubjectPatterns = Object.freeze([
  /\bBlue[-\s]+Eyes\s+White\s+Dragon\b/i,
  /\bDark\s+Magician(?:\s+Girl)?\b/i,
  /\bCharizard\b/i,
  /\bPikachu\b/i,
  /\bAlakazam\b/i,
  /\bPortgas[.\s]+D[.\s]+Ace\b/i
]);

function cleanSubjectToken(token = "") {
  return normalizeText(token)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, "")
    .replace(/\.$/, "");
}

function titleCaseSubject(value = "") {
  return normalizeText(value)
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\b(?:Ii|Iii|Iv|Jr|Sr)\b\.?/g, (suffix) => suffix.replace(/\.$/, "").toUpperCase().replace(/^JR$/, "Jr").replace(/^SR$/, "Sr"));
}

function subjectLooksPolluted(value = "") {
  const normalized = normalizeComparable(value);
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.some((token) => titleSubjectStopWords.has(token));
}

function fallbackPlayersFromTitle(title = "", parsed = {}) {
  let text = normalizeText(title)
    .replace(/\b\d{4}(?:-\d{2})?\b/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/#\s*[A-Z0-9][A-Z0-9-]{0,18}\b/gi, " ")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s+(?:Authentic\s+)?(?:Gem\s+Mint\s+)?(?:AUTO\s+)?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b(?:Auto|Autograph|Autographs|Authenticated|Authentic|RC|Rookie|SP|SSP|Dual|Triple|Prizm|Choice|Tiger|Stripe|Refractor|Sapphire|Gold|Silver|Blue|Red|Green|Purple|Orange|Black|Card|Cards)\b/gi, " ");
  for (const phrase of [parsed.product, parsed.manufacturer, parsed.brand, parsed.set].filter(Boolean)) {
    text = text.replace(new RegExp(`\\b${String(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "ig"), " ");
  }
  const words = normalizeText(text).split(/\s+/).filter((word) => /^[A-Z][A-Za-z'.-]*$/.test(word) || /^(?:Jr|Sr|II|III|IV)\.?$/.test(word));
  if (words.length < 2 || words.length > 6) return [];
  if (words.length === 5 && /^(?:Jr|Sr|II|III|IV)\.?$/.test(words[4])) {
    return [
      `${words[0]} ${words[1]}`,
      `${words[2]} ${words[3]} ${words[4].replace(/\.$/, ".")}`
    ];
  }
  if (words.length === 4) return [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`];
  return [words.join(" ")];
}

function strictSubjectsFromTitle(title = "", parsed = {}) {
  const raw = normalizeText(title);
  const knownSubjects = knownSubjectPatterns
    .map((pattern) => raw.match(pattern)?.[0])
    .filter(Boolean)
    .map(titleCaseSubject);
  if (knownSubjects.length) return [...new Set(knownSubjects)];

  let text = titleWithoutGradeText(raw)
    .replace(/\b\d{4}(?:-\d{2})?\b/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/#\s*\/\s*\d+\b/gi, " ")
    .replace(/#\s*[A-Z0-9][A-Z0-9-]{0,18}\b/gi, " ")
    .replace(/[!'"(),]/g, " ")
    .replace(/\b1st\b/gi, " ");
  for (const phrase of [
    parsed.product,
    parsed.manufacturer,
    parsed.brand,
    parsed.set
  ].filter(Boolean)) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(normalizeText(phrase)).replace(/\s+/g, "\\s+")}\\b`, "ig"), " ");
  }
  const tokens = normalizeText(text)
    .split(/\s+/)
    .map(cleanSubjectToken)
    .filter(Boolean)
    .filter((token) => {
      const comparable = normalizeComparable(token);
      if (!comparable || titleSubjectStopWords.has(comparable)) return false;
      if (/^(?:gem|mint|authentic|collaboration)$/i.test(token)) return false;
      if (/^[A-Z]{2,}$/.test(token) && !/^(?:II|III|IV)$/.test(token)) return false;
      return /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'.-]*$/.test(token) || /^(?:II|III|IV|Jr|Sr)\.?$/i.test(token);
    })
    .map(titleCaseSubject);

  if (!tokens.length) return [];
  if (tokens.length === 1) {
    return /\b(?:Pokemon|Yu[-\s]*Gi[-\s]*Oh|One\s+Piece)\b/i.test(raw) ? [tokens[0]] : [];
  }
  if (tokens.length === 2) return [tokens.join(" ")];
  if (tokens.length === 3 && /^(?:Jr|Sr|II|III|IV)$/i.test(tokens[2])) return [tokens.join(" ")];
  if (tokens.length === 4) return [`${tokens[0]} ${tokens[1]}`, `${tokens[2]} ${tokens[3]}`];
  if (tokens.length === 5 && /^(?:Jr|Sr|II|III|IV)$/i.test(tokens[4])) {
    return [`${tokens[0]} ${tokens[1]}`, `${tokens[2]} ${tokens[3]} ${tokens[4]}`];
  }
  return [];
}

function gradeFromSellerTitle(title = "", parsed = {}) {
  if (parsed.grade_company && (parsed.card_grade || parsed.auto_grade)) {
    return {
      grade_company: parsed.grade_company,
      grade: parsed.card_grade || parsed.auto_grade,
      card_grade: parsed.card_grade || "",
      auto_grade: parsed.auto_grade || ""
    };
  }
  const match = normalizeText(title).match(/\b(PSA|BGS|SGC|CGC|Beckett)\s+(?:Authentic\s+)?(?:Gem\s+Mint\s+)?(?:AUTO\s+)?(\d+(?:\.\d+)?)\b/i);
  if (!match) return {
    grade_company: "",
    grade: "",
    card_grade: "",
    auto_grade: ""
  };
  const company = /^beckett$/i.test(match[1]) ? "BGS" : match[1].toUpperCase();
  return {
    grade_company: company,
    grade: match[2],
    card_grade: match[2],
    auto_grade: ""
  };
}

export function titleWeakLabelFromTitle(title = "") {
  const parsed = parseReviewedTitleFields(title);
  const hasIdentityAnchor = Boolean(parsed.year || parsed.product || parsed.collector_number || parsed.checklist_code);
  const parsedPlayers = hasIdentityAnchor && Array.isArray(parsed.players)
    ? parsed.players.map(normalizeText).filter(Boolean).filter((player) => !subjectLooksPolluted(player))
    : [];
  const strictPlayers = hasIdentityAnchor ? strictSubjectsFromTitle(title, parsed) : [];
  const players = strictPlayers.length ? strictPlayers : parsedPlayers.length ? parsedPlayers : hasIdentityAnchor ? fallbackPlayersFromTitle(title, parsed).filter((player) => !subjectLooksPolluted(player)) : [];
  const fullSerial = normalizeSerial(titleWithoutGradeText(title));
  const grade = gradeFromSellerTitle(title, parsed);
  const parallel = parallelExactFromTitle(title) || parsed.parallel_exact || parsed.parallel || parsed.surface_color || "";
  const surfaceColor = parsed.surface_color || surfaceColorFromText(parallel) || surfaceColorFromText(title);
  return {
    raw_title: normalizeText(title),
    player: players.length ? players.join(" / ") : null,
    players,
    year: parsed.year || "",
    brand: parsed.manufacturer || parsed.brand || "",
    set: parsed.product || parsed.set || "",
    card_number: parsed.collector_number || parsed.checklist_code || "",
    parallel,
    surface_color: surfaceColor,
    rookie: parsed.rc === true ? true : false,
    autograph: parsed.auto === true ? true : false,
    relic: (parsed.relic || parsed.patch || parsed.jersey) === true ? true : false,
    serial_number: fullSerial || "",
    serial_denominator: serialDenominator(title),
    grade_company: grade.grade_company,
    grade: grade.grade,
    card_grade: grade.card_grade,
    auto_grade: grade.auto_grade
  };
}

function compareBoolean(modelValue, titleValue) {
  if (titleValue === null || titleValue === undefined) return "UNCERTAIN";
  if (modelValue === null || modelValue === undefined) return titleValue === false ? "MATCH" : "MISSING_MODEL";
  return Boolean(modelValue) === Boolean(titleValue) ? "MATCH" : "MISMATCH";
}

function subjectNeedle(value = "") {
  return normalizeComparable(value)
    .replace(/[./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleContainsSubject(title = "", subject = "") {
  const needle = subjectNeedle(subject);
  if (!needle) return false;
  const haystack = ` ${subjectNeedle(title)} `;
  return haystack.includes(` ${needle} `);
}

function comparePlayers(modelOutput = {}, titleLabel = {}) {
  const titlePlayers = Array.isArray(titleLabel.players) ? titleLabel.players.map(normalizeComparable).filter(Boolean) : [];
  const modelPlayers = Array.isArray(modelOutput.players) && modelOutput.players.length
    ? modelOutput.players.map(normalizeComparable).filter(Boolean)
    : normalizeComparable(modelOutput.player).split(/\s+\/\s+/).filter(Boolean);
  if (!modelPlayers.length) return titlePlayers.length ? "MISSING_MODEL" : "UNCERTAIN";
  if (normalizeText(titleLabel.raw_title)
    && modelPlayers.every((player) => titleContainsSubject(titleLabel.raw_title, player))) {
    return "MATCH";
  }
  if (!titlePlayers.length) return "UNCERTAIN";
  if (modelPlayers.length !== titlePlayers.length) return "MISMATCH";
  const modelSet = new Set(modelPlayers);
  return titlePlayers.every((player) => modelSet.has(player)) ? "MATCH" : "MISMATCH";
}

function stripLeadingBrand(value = "", brand = "") {
  const normalized = normalizeComparable(value);
  const normalizedBrand = normalizeComparable(brand);
  if (!normalizedBrand) return normalized;
  if (normalized === normalizedBrand) return "";
  return normalized.replace(new RegExp(`^${escapeRegExp(normalizedBrand)}\\s+`), "");
}

export function compareField(modelOutput = {}, titleLabel = {}, field) {
  if (field === "player") return comparePlayers(modelOutput, titleLabel);
  if (["rookie", "autograph", "relic"].includes(field)) return compareBoolean(modelOutput[field], titleLabel[field]);
  const titleValue = field === "grade"
    ? [titleLabel.grade_company, titleLabel.grade].filter(Boolean).join(" ")
    : titleLabel[field];
  const modelValue = field === "grade"
    ? [modelOutput.grade_company, modelOutput.grade].filter(Boolean).join(" ")
    : modelOutput[field];
  if (field === "serial_number" && !normalizeSerial(titleValue) && titleLabel.serial_denominator) return "UNCERTAIN";
  if (titleValue === null || titleValue === undefined) return "UNCERTAIN";
  if (!normalizeText(titleValue)) return "MISSING_TITLE";
  if (!normalizeText(modelValue)) return "MISSING_MODEL";
  if (field === "serial_number") {
    return normalizeSerial(modelValue) && normalizeSerial(modelValue) === normalizeSerial(titleValue) ? "MATCH" : "MISMATCH";
  }
  if (field === "year") {
    const modelYear = normalizeComparable(modelValue);
    const titleYear = normalizeComparable(titleValue);
    if (modelYear === titleYear) return "MATCH";
    if (/^\d{4}$/.test(modelYear) && titleYear.startsWith(`${modelYear}-`)) return "MATCH";
    if (/^\d{4}$/.test(titleYear) && modelYear.startsWith(`${titleYear}-`)) return "MATCH";
    return "MISMATCH";
  }
  if (field === "set") {
    const modelSet = stripLeadingBrand(modelValue, modelOutput.brand);
    const titleSet = stripLeadingBrand(titleValue, titleLabel.brand);
    if (!titleSet) return "UNCERTAIN";
    if (modelSet === titleSet) return "MATCH";
    if (modelSet.includes(titleSet) || titleSet.includes(modelSet)) return "UNCERTAIN";
    return "MISMATCH";
  }
  return normalizeComparable(modelValue) === normalizeComparable(titleValue) ? "MATCH" : "MISMATCH";
}

function compareSurfaceColor(modelOutput = {}, titleLabel = {}) {
  const titleColor = normalizeComparable(titleLabel.surface_color || surfaceColorFromText(titleLabel.parallel || titleLabel.raw_title));
  if (!titleColor) return "UNCERTAIN";
  const modelColor = normalizeComparable(modelOutput.surface_color || surfaceColorFromText(modelOutput.parallel || modelOutput.raw_prediction_text));
  if (!modelColor) return "MISSING_MODEL";
  return modelColor === titleColor ? "MATCH" : "MISMATCH";
}

function compareSerialDenominatorDiagnostic(modelOutput = {}, titleLabel = {}) {
  const titleDenominator = normalizeText(titleLabel.serial_denominator);
  if (!titleDenominator) return "UNCERTAIN";
  const modelDenominator = serialDenominator(modelOutput.serial_number || modelOutput.raw_prediction_text || "");
  if (!modelDenominator) return "MISSING_MODEL";
  return modelDenominator === titleDenominator ? "MATCH" : "MISMATCH";
}

function compareCoreIdentityDiagnostic(fieldComparison = {}) {
  const coreFields = ["player", "year", "brand", "set"];
  const available = coreFields.filter((field) => fieldComparison[field] !== "MISSING_TITLE" && fieldComparison[field] !== "UNCERTAIN");
  if (!available.length) return "UNCERTAIN";
  if (available.some((field) => fieldComparison[field] === "MISMATCH")) return "MISMATCH";
  if (available.some((field) => fieldComparison[field] === "MISSING_MODEL")) return "MISSING_MODEL";
  return available.length >= 3 ? "MATCH" : "UNCERTAIN";
}

function narrowDiagnosticComparison(modelOutput = {}, titleLabel = {}, fieldComparison = {}) {
  return {
    core_identity: compareCoreIdentityDiagnostic(fieldComparison),
    surface_color: compareSurfaceColor(modelOutput, titleLabel),
    serial_denominator: compareSerialDenominatorDiagnostic(modelOutput, titleLabel)
  };
}

export function comparePredictionToTitle(prediction = {}, answer = {}) {
  const recognitionOutput = prediction.recognition_output || {};
  const titleWeakLabel = titleWeakLabelFromTitle(answer.title || "");
  const fieldComparison = Object.fromEntries(
    weakLabelFields.map((field) => [field, compareField(recognitionOutput, titleWeakLabel, field)])
  );
  const narrowComparison = narrowDiagnosticComparison(recognitionOutput, titleWeakLabel, fieldComparison);
  const values = Object.values(fieldComparison);
  const mismatchCount = values.filter((value) => value === "MISMATCH").length;
  const matchCount = values.filter((value) => value === "MATCH").length;
  const abstained = /ABSTAIN/i.test(normalizeText(prediction.recognition_status))
    || /ABSTAIN/i.test(normalizeText(prediction.model_confidence))
    || !Object.values(recognitionOutput).some((value) => Array.isArray(value) ? value.length : normalizeText(value) || typeof value === "boolean");
  let overallStatus = "PARTIAL";
  if (abstained) overallStatus = "ABSTAIN";
  else if (mismatchCount > 0) overallStatus = "FAIL";
  else if (values.some((value) => value === "MISSING_MODEL" || value === "UNCERTAIN")) overallStatus = "PARTIAL";
  else if (matchCount >= 3) overallStatus = "PASS";
  return {
    case_id: prediction.case_id,
    title: answer.title || "",
    item_id: answer.item_id || "",
    item_web_url: answer.item_web_url || "",
    recognition_output: recognitionOutput,
    title_weak_label: titleWeakLabel,
    field_comparison: fieldComparison,
    narrow_diagnostic_comparison: narrowComparison,
    overall_status: overallStatus,
    notes: [
      titleWeakLabel.player === null ? "title subject ambiguous under weak parser" : null,
      fieldComparison.serial_number === "UNCERTAIN" && titleWeakLabel.serial_denominator ? "title only exposes serial denominator or incomplete serial" : null
    ].filter(Boolean)
  };
}

export async function scoreBlindEval({
  predictionsPath = join(defaultBlindEvalDir, "predictions", "predictions.jsonl"),
  answerKeyPath = join(defaultBlindEvalDir, "sealed_answers", "answer_key.jsonl"),
  outputPath = join(defaultBlindEvalDir, "scoring", "scored_results.jsonl"),
  summaryPath = join(defaultBlindEvalDir, "scoring", "summary.json"),
  predictionsSha256Path = ""
} = {}) {
  const preferredHashPath = predictionsSha256Path || join(dirname(resolve(predictionsPath)), "predictions.sha256");
  const expectedHashPath = await pathExists(preferredHashPath) ? preferredHashPath : `${predictionsPath}.sha256`;
  const [predictions, answerRows, expectedHashText] = await Promise.all([
    readJsonl(predictionsPath),
    readJsonl(answerKeyPath),
    readFile(resolve(expectedHashPath), "utf8")
  ]);
  const expectedHash = normalizeText(expectedHashText).split(/\s+/)[0];
  const actualHash = await sha256File(predictionsPath);
  if (!expectedHash || expectedHash !== actualHash) {
    throw new Error("Predictions hash mismatch. Refusing to score mutable or unfrozen predictions.");
  }
  const answersByCase = new Map(answerRows.map((row) => [row.case_id, row]));
  const scored = predictions.map((prediction) => {
    const answer = answersByCase.get(prediction.case_id);
    if (!answer) throw new Error(`Missing answer key row for case_id=${prediction.case_id}`);
    return comparePredictionToTitle(prediction, answer);
  });
  await writeJsonl(outputPath, scored);
  const overallCounts = scored.reduce((acc, row) => {
    acc[row.overall_status] = (acc[row.overall_status] || 0) + 1;
    return acc;
  }, {});
  const fieldCounts = {};
  for (const field of weakLabelFields) {
    fieldCounts[field] = scored.reduce((acc, row) => {
      const status = row.field_comparison[field];
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
  }
  const narrowDiagnosticCounts = {};
  for (const field of narrowDiagnosticFields) {
    narrowDiagnosticCounts[field] = scored.reduce((acc, row) => {
      const status = row.narrow_diagnostic_comparison?.[field] || "UNCERTAIN";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
  }
  const summary = {
    ok: true,
    generated_at: new Date().toISOString(),
    predictions_sha256: actualHash,
    prediction_hash_verified: true,
    total: scored.length,
    overall_counts: overallCounts,
    field_counts: fieldCounts,
    narrow_diagnostic_counts: narrowDiagnosticCounts,
    anti_leakage: {
      scoring_reads_answer_key: true,
      recognition_predictions_frozen_before_scoring: true
    }
  };
  await writeJson(summaryPath, summary);
  return {
    ...summary,
    scored_results_path: relativePortablePath(outputPath),
    summary_path: relativePortablePath(summaryPath),
    scored
  };
}
