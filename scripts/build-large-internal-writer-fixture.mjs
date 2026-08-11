#!/usr/bin/env node

// Page/app network requests are blocked inside Chromium. Strict process-level
// network isolation requires an outer sandbox:
//   node scripts/build-large-internal-writer-fixture.mjs \
//     --source-manifest /absolute/materialized-source.json \
//     --out-dir /absolute/new-directory
// The source receipt is produced by materialize-writer-journey-source.mjs. The
// CLI exposes no source selector, seed, codec, size, quality, or browser flag.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  stat
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const sourceRoleOrder = Object.freeze(["front_original", "back_original"]);
const outputSides = Object.freeze(["front", "back"]);
const manifestRootKeys = Object.freeze([
  "accuracy_claim", "cases", "evidence_scope", "schema_version"
]);
const feedbackManifestCaseKeys = Object.freeze([
  "case_id", "evaluation_cohort", "expected_grammar", "files", "hash_provenance",
  "image_count", "source_feedback_id"
]);
const productionAssetManifestCaseKeys = Object.freeze([
  "case_id", "evaluation_cohort", "expected_grammar", "files", "hash_provenance",
  "image_count", "source_asset_id", "source_kind", "source_record_id"
]);
const manifestFileKeys = Object.freeze([
  "bytes", "content_sha256", "content_type", "path", "role"
]);

// Intentionally self-contained. The materializer now exposes multiple cases;
// this fixture always selects NON_TCG by identity, never by array position.
export const LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT = Object.freeze({
  case_id: "NON_TCG",
  expected_grammar: "NON_TCG",
  source_kind: "PRODUCTION_ASSET",
  source_record_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
  source_asset_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
  evaluation_cohort: "PRODUCTION_LOW_REASONING_VERIFIED",
  hash_provenance: "2026-08-11_PRODUCTION_ASSET_EXACT_VERIFICATION",
  content_type: "image/webp",
  images: Object.freeze([
    Object.freeze({
      image_id: "f55f120f-09e0-4c2f-9166-8bcf7310b4d0",
      role: "front_original",
      content_sha256:
        "161f0d97df619f8d34b2453551567a0473d3e477c3e0ec9295029fbce8c59e44"
    }),
    Object.freeze({
      image_id: "cd43a047-0472-441e-bc4d-00e53b04634f",
      role: "back_original",
      content_sha256:
        "cef46b5d761d2d20f5cd21d611cab8d8037721bcdb4ae8c1a0d4441439a6fdc3"
    })
  ])
});

export const LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT = Object.freeze({
  schema_version: "large-internal-writer-fixture-receipt-v2",
  builder_id: "large-internal-writer-fixture-builder",
  builder_version: "1.2.0",
  source_class: "LYNCA_INTERNAL_SYNTHETIC_TEST",
  allowed_use: "PRODUCTION_RELEASE_TRANSPORT_ONLY",
  forbidden_uses: Object.freeze([
    "ACCURACY_BENCHMARK",
    "GROUND_TRUTH",
    "TRAINING",
    "SHARED_KNOWLEDGE",
    "PRODUCTION_PROMOTION"
  ]),
  seed: 0x4c594e43,
  output_width: 3000,
  output_height: 4200,
  original_jpeg_quality: 0.8,
  semantic_panel: Object.freeze({ x: 240, y: 280, width: 2520, height: 3640, padding: 48 }),
  staged_lane_version: "readability-derived-inline-v2",
  staged_long_edge: 1600,
  staged_jpeg_quality: 0.8,
  original_total_min_bytes_exclusive: 3_200_000,
  original_each_max_bytes: 25 * 1024 * 1024,
  original_each_relay_max_bytes: 3_200_000,
  derived_total_max_bytes: 3_200_000,
  playwright_version: "1.61.1"
});

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function hasExactKeys(value, expected) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object"
    && Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

export function assertLargeInternalFixturePosixRuntime({
  platform = process.platform,
  getuid = process.getuid
} = {}) {
  if (!["darwin", "linux"].includes(platform) || typeof getuid !== "function") {
    throw failure("large_fixture_posix_required");
  }
  const uid = Number(getuid());
  if (!Number.isSafeInteger(uid) || uid < 0) throw failure("large_fixture_posix_required");
  return uid;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function fileSha256(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function inspectJpegDimensions(bytes) {
  if (!bytes?.length || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw failure("large_fixture_output_jpeg_invalid");
  }
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let offset = 2;
  while (offset < bytes.length - 1) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrame.has(marker) && segmentLength >= 8) {
      return {
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        height: (bytes[offset + 3] << 8) | bytes[offset + 4]
      };
    }
    offset += segmentLength;
  }
  throw failure("large_fixture_output_jpeg_invalid");
}

/**
 * Accept only the already-approved Writer Journey source receipt. Paths remain
 * local implementation details; source identity and bytes are pinned here.
 */
export function validateApprovedSourceManifest(manifest) {
  const contract = LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT;
  if (!hasExactKeys(manifest, manifestRootKeys)
      || !Array.isArray(manifest.cases)
      || manifest.cases.length !== 2
      || manifest.cases.some((entry) => (
        !hasExactKeys(entry, entry?.case_id === contract.case_id
          ? productionAssetManifestCaseKeys
          : feedbackManifestCaseKeys)
        || !Array.isArray(entry.files)
        || entry.files.length !== 2
        || entry.files.some((file) => !hasExactKeys(file, manifestFileKeys))
      ))
      || new Set(manifest.cases.map((entry) => entry.case_id)).size !== 2
      || !manifest.cases.some((entry) => entry.case_id === "TCG")) {
    throw failure("large_fixture_source_manifest_not_approved");
  }
  const matches = Array.isArray(manifest?.cases)
    ? manifest.cases.filter((entry) => entry?.case_id === contract.case_id)
    : [];
  const source = matches.length === 1 ? matches[0] : null;
  if (manifest?.schema_version !== "writer-journey-cases-v2"
      || manifest?.evidence_scope !== "LIVE_CONTRACT_RECEIPT_ONLY"
      || manifest?.accuracy_claim !== null
      || source?.source_kind !== contract.source_kind
      || source?.source_record_id !== contract.source_record_id
      || source?.source_asset_id !== contract.source_asset_id
      || source?.evaluation_cohort !== contract.evaluation_cohort
      || source?.expected_grammar !== contract.expected_grammar
      || source?.hash_provenance !== contract.hash_provenance
      || source?.image_count !== 2
      || !Array.isArray(source.files)
      || source.files.length !== 2) {
    throw failure("large_fixture_source_manifest_not_approved");
  }
  return source.files.map((file, index) => {
    const expectedImage = contract.images[index];
    const localPath = String(file?.path || "").trim();
    const contentSha256 = String(file?.content_sha256 || "").trim().toLowerCase();
    const bytes = Number(file?.bytes);
    const contentType = String(file?.content_type || "").trim().toLowerCase();
    if (!path.isAbsolute(localPath)
        || file?.role !== sourceRoleOrder[index]
        || expectedImage?.role !== sourceRoleOrder[index]
        || contentSha256 !== expectedImage?.content_sha256
        || !Number.isSafeInteger(bytes) || bytes < 1
        || contentType !== contract.content_type) {
      throw failure("large_fixture_source_manifest_not_approved");
    }
    return {
      image_id: expectedImage.image_id,
      side: outputSides[index],
      role: sourceRoleOrder[index],
      path: localPath,
      bytes,
      content_type: contentType,
      content_sha256: contentSha256
    };
  });
}

async function loadApprovedSourceFiles(manifest) {
  const entries = validateApprovedSourceManifest(manifest);
  return Promise.all(entries.map(async (entry) => {
    const info = await stat(entry.path).catch(() => null);
    if (!info?.isFile()) throw failure("large_fixture_source_file_missing");
    if (info.size !== entry.bytes || info.size > LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.original_each_max_bytes) {
      throw failure("large_fixture_source_file_size_mismatch");
    }
    const buffer = await readFile(entry.path);
    if (sha256(buffer) !== entry.content_sha256) {
      throw failure("large_fixture_source_file_hash_mismatch");
    }
    return { ...entry, buffer };
  }));
}

function browserRevision(executablePath) {
  return executablePath.match(/chromium(?:_headless_shell)?-(\d+)/)?.[1] || null;
}

function loadPlaywright() {
  let playwright;
  let packageJson;
  let browsers;
  try {
    playwright = require("@playwright/test");
    packageJson = require("@playwright/test/package.json");
    const corePackagePath = require.resolve("playwright-core/package.json");
    browsers = require(path.join(path.dirname(corePackagePath), "browsers.json"));
  } catch {
    throw failure("large_fixture_playwright_missing");
  }
  if (packageJson.version !== LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.playwright_version) {
    throw failure("large_fixture_playwright_version_mismatch");
  }
  const expectedChromium = browsers.browsers?.find((browser) => browser.name === "chromium");
  if (!expectedChromium?.revision || !expectedChromium?.browserVersion) {
    throw failure("large_fixture_playwright_executor_contract_missing");
  }
  return { chromium: playwright.chromium, packageJson, expectedChromium };
}

function renderedImage(dataUrl, role, sourceRole) {
  const encoded = String(dataUrl || "");
  if (!encoded.startsWith("data:image/jpeg;base64,")) {
    throw failure("large_fixture_output_jpeg_invalid");
  }
  const buffer = Buffer.from(encoded.slice("data:image/jpeg;base64,".length), "base64");
  const dimensions = inspectJpegDimensions(buffer);
  return {
    role,
    source_role: sourceRole,
    content_type: "image/jpeg",
    bytes: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    content_sha256: sha256(buffer),
    buffer
  };
}

function assertRenderedContract(originals, derived) {
  const contract = LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT;
  if (originals.length !== 2 || derived.length !== 2) {
    throw failure("large_fixture_output_count_invalid");
  }
  if (originals.some((image) => (
    image.width !== contract.output_width
    || image.height !== contract.output_height
    || image.bytes > contract.original_each_max_bytes
    || image.bytes > contract.original_each_relay_max_bytes
  ))) {
    throw failure("large_fixture_original_contract_failed");
  }
  const originalTotal = originals.reduce((total, image) => total + image.bytes, 0);
  if (originalTotal <= contract.original_total_min_bytes_exclusive) {
    throw failure("large_fixture_original_total_too_small");
  }
  const expectedDerivedWidth = Math.round(
    contract.output_width * contract.staged_long_edge / contract.output_height
  );
  if (derived.some((image, index) => (
    image.width !== expectedDerivedWidth
    || image.height !== contract.staged_long_edge
    || image.bytes >= originals[index].bytes
  ))) {
    throw failure("large_fixture_derived_contract_failed");
  }
  const derivedTotal = derived.reduce((total, image) => total + image.bytes, 0);
  if (derivedTotal > contract.derived_total_max_bytes) {
    throw failure("large_fixture_derived_total_too_large");
  }
  return { originalTotal, derivedTotal };
}

/**
 * Chromium is the codec. Byte determinism is deliberately scoped to the exact
 * executor captured in the receipt, never claimed across browsers or builds.
 */
export async function renderLargeInternalFixture({
  sources,
  chromiumExecutablePath = ""
} = {}) {
  assertLargeInternalFixturePosixRuntime();
  if (!Array.isArray(sources) || sources.length !== 2
      || sources.some((source) => !Buffer.isBuffer(source?.buffer))) {
    throw failure("large_fixture_render_sources_invalid");
  }
  const { chromium, packageJson, expectedChromium } = loadPlaywright();
  const executablePath = chromiumExecutablePath || chromium.executablePath();
  const executable = await stat(executablePath).catch(() => null);
  if (!executable?.isFile()) throw failure("large_fixture_chromium_executor_missing");
  const executableSha256 = await fileSha256(executablePath);
  const launchArgs = [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-gpu",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run"
  ];
  const browser = await chromium.launch({ headless: true, executablePath, args: launchArgs });
  let blockedNetworkRequests = 0;
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route(/^(?:https?|wss?):/i, async (route) => {
      blockedNetworkRequests += 1;
      await route.abort();
    });
    const page = await context.newPage();
    const rendered = await page.evaluate(async ({ sourceInputs, contract }) => {
      const loadImage = (dataUrl) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("source_decode_failed"));
        image.src = dataUrl;
      });
      const nextRandom = (state) => {
        let value = (state.value + 0x6d2b79f5) >>> 0;
        state.value = value;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return (value ^ (value >>> 14)) >>> 0;
      };
      const makeOriginal = async (source, index) => {
        const image = await loadImage(source.data_url);
        const canvas = document.createElement("canvas");
        canvas.width = contract.output_width;
        canvas.height = contract.output_height;
        const context = canvas.getContext("2d", { alpha: false });
        const texture = context.createImageData(canvas.width, canvas.height);
        const random = { value: (contract.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0 };
        for (let offset = 0; offset < texture.data.length; offset += 4) {
          const value = nextRandom(random);
          texture.data[offset] = value & 0xff;
          texture.data[offset + 1] = (value >>> 8) & 0xff;
          texture.data[offset + 2] = (value >>> 16) & 0xff;
          texture.data[offset + 3] = 0xff;
        }
        context.putImageData(texture, 0, 0);
        const panel = contract.semantic_panel;
        context.fillStyle = "#ffffff";
        context.fillRect(panel.x, panel.y, panel.width, panel.height);
        const availableWidth = panel.width - panel.padding * 2;
        const availableHeight = panel.height - panel.padding * 2;
        const scale = Math.min(
          availableWidth / image.naturalWidth,
          availableHeight / image.naturalHeight
        );
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const x = panel.x + Math.round((panel.width - width) / 2);
        const y = panel.y + Math.round((panel.height - height) / 2);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, x, y, width, height);
        return {
          data_url: canvas.toDataURL("image/jpeg", contract.original_jpeg_quality),
          source_width: image.naturalWidth,
          source_height: image.naturalHeight,
          placement: { x, y, width, height, fit_mode: "contain", cropped: false }
        };
      };
      const makeDerived = async (original) => {
        const image = await loadImage(original.data_url);
        const scale = Math.min(1, contract.staged_long_edge / Math.max(
          image.naturalWidth,
          image.naturalHeight
        ));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        return { data_url: canvas.toDataURL("image/jpeg", contract.staged_jpeg_quality) };
      };

      const originals = [];
      const derived = [];
      for (const [index, source] of sourceInputs.entries()) {
        const original = await makeOriginal(source, index);
        originals.push(original);
        derived.push(await makeDerived(original));
      }
      return { originals, derived };
    }, {
      sourceInputs: sources.map((source) => ({
        data_url: `data:${source.content_type};base64,${source.buffer.toString("base64")}`
      })),
      contract: LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT
    });
    await context.close();
    if (blockedNetworkRequests !== 0) throw failure("large_fixture_network_request_blocked");

    const originals = rendered.originals.map((image, index) => ({
      ...renderedImage(image.data_url, `image_${index + 1}_original`, sources[index].role),
      source_width: image.source_width,
      source_height: image.source_height,
      placement: image.placement
    }));
    const derived = rendered.derived.map((image, index) => renderedImage(
      image.data_url,
      "readability_derived",
      originals[index].role
    ));
    const totals = assertRenderedContract(originals, derived);
    return {
      originals,
      derived,
      totals,
      executor: {
        family: "playwright-chromium-canvas",
        determinism_scope: "EXECUTOR_BOUND",
        cross_browser_byte_stability_claimed: false,
        network_boundary: "PAGE_AND_APP_REQUESTS_BLOCKED_OUTER_SANDBOX_REQUIRED",
        playwright_version: packageJson.version,
        playwright_expected_chromium_revision: String(expectedChromium.revision),
        playwright_expected_chromium_version: expectedChromium.browserVersion,
        chromium_revision: browserRevision(executablePath),
        chromium_version: await browser.version(),
        chromium_executable_sha256: executableSha256,
        matches_playwright_default_executor: path.resolve(executablePath) === path.resolve(chromium.executablePath()),
        platform: process.platform,
        arch: process.arch,
        headless: true,
        launch_args: launchArgs
      }
    };
  } finally {
    await browser.close();
  }
}

function receiptImage(image, file) {
  return {
    file,
    file_mode: "0600",
    role: image.role,
    source_role: image.source_role,
    content_type: image.content_type,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    content_sha256: image.content_sha256,
    ...(image.source_width ? {
      source_width: image.source_width,
      source_height: image.source_height,
      placement: image.placement
    } : {})
  };
}

async function buildReceipt({ sources, rendered }) {
  const contract = LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT;
  const scriptSha256 = await fileSha256(scriptPath);
  const sourceRecords = sources.map(({ buffer: _buffer, path: _path, ...source }) => source);
  const body = {
    schema_version: contract.schema_version,
    fixture_id: "large-internal-writer-fixture-v2",
    source_class: contract.source_class,
    allowed_use: contract.allowed_use,
    forbidden_uses: [...contract.forbidden_uses],
    provider_calls: 0,
    output_directory_mode: "0700",
    receipt_file_mode: "0600",
    builder: {
      id: contract.builder_id,
      version: contract.builder_version,
      script_sha256: scriptSha256,
      seed: contract.seed,
      algorithm: "seeded-noise-border-with-contained-source-v1"
    },
    executor: rendered.executor,
    source: {
      source_kind: LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.source_kind,
      source_record_id: LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.source_record_id,
      source_asset_id: LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.source_asset_id,
      evaluation_cohort: LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.evaluation_cohort,
      hash_provenance: LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.hash_provenance,
      manifest_contract_sha256: sha256(Buffer.from(stableJson(sourceRecords))),
      images: sourceRecords
    },
    transform: {
      output_width: contract.output_width,
      output_height: contract.output_height,
      original_jpeg_quality: contract.original_jpeg_quality,
      semantic_panel: contract.semantic_panel,
      source_fit: "contain",
      source_crop: false,
      background_texture_semantics: "NONE_SEEDED_PIXEL_NOISE",
      staged_algorithm: "production-canvas-white-fill-draw-image-jpeg-v1",
      staged_lane_version: contract.staged_lane_version,
      staged_long_edge: contract.staged_long_edge,
      staged_jpeg_quality: contract.staged_jpeg_quality
    },
    limits: {
      original_total_min_bytes_exclusive: contract.original_total_min_bytes_exclusive,
      original_each_max_bytes: contract.original_each_max_bytes,
      original_each_relay_max_bytes: contract.original_each_relay_max_bytes,
      derived_total_max_bytes: contract.derived_total_max_bytes
    },
    original_total_bytes: rendered.totals.originalTotal,
    derived_total_bytes: rendered.totals.derivedTotal,
    originals: rendered.originals.map((image, index) => receiptImage(
      image,
      `${index + 1}-${outputSides[index]}-original.jpg`
    )),
    derived: rendered.derived.map((image, index) => receiptImage(
      image,
      `${index + 1}-${outputSides[index]}-readability-derived.jpg`
    ))
  };
  const receiptedBody = {
    ...body,
    receipt_hash_scope: "LEXICOGRAPHIC_SORTED_JSON_WITHOUT_RECEIPT_SHA256"
  };
  return {
    ...receiptedBody,
    receipt_sha256: sha256(Buffer.from(stableJson(receiptedBody)))
  };
}

export async function prepareLargeInternalFixtureOutputDirectory(outDir, {
  uid = assertLargeInternalFixturePosixRuntime()
} = {}) {
  const directory = path.resolve(String(outDir || "").trim());
  if (!outDir || directory === path.parse(directory).root) {
    throw failure("large_fixture_out_dir_invalid");
  }
  const parent = path.dirname(directory);
  const parentInfo = await lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory()
      || parentInfo.isSymbolicLink()
      || parentInfo.uid !== uid) {
    throw failure("large_fixture_out_parent_invalid");
  }
  if ((parentInfo.mode & 0o077) !== 0) {
    throw failure("large_fixture_out_parent_permissions_invalid");
  }
  const existing = await lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) throw failure("large_fixture_out_dir_exists");
  try {
    await mkdir(directory, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw failure("large_fixture_out_dir_exists");
    throw error;
  }
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== uid
      || (info.mode & 0o777) !== 0o700) {
    throw failure("large_fixture_out_dir_permissions_invalid");
  }
  return directory;
}

async function secureWriteFixtureFile(filePath, bytes, uid) {
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw failure("large_fixture_output_exists");
    throw error;
  }
  let openedInfo;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o600);
    openedInfo = await handle.stat();
    if (!openedInfo.isFile() || openedInfo.uid !== uid
        || (openedInfo.mode & 0o777) !== 0o600) {
      throw failure("large_fixture_output_permissions_invalid");
    }
  } finally {
    await handle.close();
  }
  const finalInfo = await lstat(filePath);
  if (finalInfo.isSymbolicLink() || !finalInfo.isFile() || finalInfo.uid !== uid
      || (finalInfo.mode & 0o777) !== 0o600
      || finalInfo.dev !== openedInfo.dev || finalInfo.ino !== openedInfo.ino) {
    throw failure("large_fixture_output_permissions_invalid");
  }
}

async function writeFixtureBundle(directory, rendered, receipt, uid) {
  const files = [
    ...rendered.originals.map((image, index) => ({
      name: `${index + 1}-${outputSides[index]}-original.jpg`, buffer: image.buffer
    })),
    ...rendered.derived.map((image, index) => ({
      name: `${index + 1}-${outputSides[index]}-readability-derived.jpg`, buffer: image.buffer
    })),
    { name: "receipt.json", buffer: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`) }
  ];
  for (const file of files) {
    const filePath = path.join(directory, file.name);
    await secureWriteFixtureFile(filePath, file.buffer, uid);
  }
  return files.map((file) => path.join(directory, file.name));
}

export async function buildLargeInternalWriterFixture({
  sourceManifestPath,
  outDir,
  chromiumExecutablePath = ""
} = {}) {
  const uid = assertLargeInternalFixturePosixRuntime();
  const suppliedManifestPath = String(sourceManifestPath || "").trim();
  if (!path.isAbsolute(suppliedManifestPath)) {
    throw failure("large_fixture_source_manifest_path_invalid");
  }
  const manifestPath = path.resolve(suppliedManifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw failure("large_fixture_source_manifest_invalid");
  }
  const sources = await loadApprovedSourceFiles(manifest);
  const directory = await prepareLargeInternalFixtureOutputDirectory(outDir, { uid });
  const rendered = await renderLargeInternalFixture({ sources, chromiumExecutablePath });
  const receipt = await buildReceipt({ sources, rendered });
  const files = await writeFixtureBundle(directory, rendered, receipt, uid);
  return {
    ok: true,
    out_dir: directory,
    receipt_path: path.join(directory, "receipt.json"),
    receipt_sha256: receipt.receipt_sha256,
    files
  };
}

function parseArguments(argv) {
  const allowed = new Set(["--source-manifest", "--out-dir"]);
  if (argv.length !== 4) throw failure("large_fixture_arguments_invalid");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || values.has(name) || !value || value.startsWith("--")) {
      throw failure("large_fixture_arguments_invalid");
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size) throw failure("large_fixture_arguments_invalid");
  return {
    sourceManifestPath: values.get("--source-manifest"),
    outDir: values.get("--out-dir")
  };
}

if (scriptPath === path.resolve(process.argv[1] || "")) {
  try {
    const result = await buildLargeInternalWriterFixture(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: String(error?.code || error?.message || error).slice(0, 160)
    })}\n`);
    process.exitCode = 1;
  }
}
