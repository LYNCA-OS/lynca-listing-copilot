import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildWriterExportWorkbook,
  createWriterBatchExport,
  normalizeWriterExportRows,
  writerExportImageLimits
} from "../lib/listing/v4/export/writer-batch-export.mjs";
import { writerExportFailureResponse } from "../api/v4/listing-export-workbook.js";

const exportApiSource = await readFile(new URL("../api/v4/listing-export-workbook.js", import.meta.url), "utf8");
const exportHelperSource = await readFile(new URL("../lib/listing/v4/export/writer-batch-export.mjs", import.meta.url), "utf8");
assert.doesNotMatch(exportApiSource, /new pg\.Client|client\.query\(sql\)/, "a writer export request must never apply database migrations at runtime");
assert.match(exportApiSource, /requireTenantAccess\(req\)/, "export must resolve a trusted tenant membership context");
assert.match(exportApiSource, /requirePermission\(context, TENANT_PERMISSIONS\.EXPORT_DATA\)/, "export must require Owner export permission");
assert.match(exportApiSource, /tenantId:\s*context\.tenantId/, "export persistence must use the server-derived tenant");
assert.match(exportApiSource, /exportedBy:\s*context\.userId/, "export attribution must use the server-derived user");
assert.doesNotMatch(exportApiSource, /payload\.exported_by\s*\|\|/, "client-controlled exporter identity must be ignored");
assert.match(exportApiSource, /WRITER_EXPORT_SCHEMA_UNAVAILABLE/, "missing export schema must fail closed with an explicit deployment error");
assert.match(exportApiSource, /writerExportFailureResponse\(error\)/, "resource failures must use the explicit API error contract");
assert.doesNotMatch(exportHelperSource, /response\.arrayBuffer\(/, "storage downloads must never use an unbounded full-body read");
assert.match(exportHelperSource, /response\?\.body\?\.getReader/, "storage downloads must be counted from the response stream");

const pngBytes = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex"
);
const pngDataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  LISTING_IMAGE_BUCKET: "listing-card-images"
};
const tenantId = "tenant_a";

function streamedBytesResponse(chunks, {
  contentType = "image/png",
  contentLength = null,
  status = 200
} = {}) {
  const normalizedHeaders = new Map([["content-type", contentType]]);
  if (contentLength !== null) normalizedHeaders.set("content-length", String(contentLength));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) || "";
      }
    },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
        controller.close();
      }
    })
  };
}

assert.deepEqual(writerExportImageLimits({
  WRITER_EXPORT_MAX_IMAGE_BYTES: String(1024 * 1024 * 1024),
  WRITER_EXPORT_MAX_TOTAL_UNIQUE_IMAGE_BYTES: String(1024 * 1024 * 1024),
  WRITER_EXPORT_MAX_UNIQUE_IMAGES: "999999",
  WRITER_EXPORT_IMAGE_DOWNLOAD_CONCURRENCY: "999",
  WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT_MS: "999999"
}), {
  max_image_bytes: 25 * 1024 * 1024,
  max_total_unique_image_bytes: 64 * 1024 * 1024,
  max_unique_images: 500,
  download_concurrency: 4,
  download_timeout_ms: 15_000
}, "environment values must never raise the fixed production hard limits");
assert.deepEqual(writerExportImageLimits({
  WRITER_EXPORT_MAX_IMAGE_BYTES: "1024",
  WRITER_EXPORT_MAX_TOTAL_UNIQUE_IMAGE_BYTES: "2048",
  WRITER_EXPORT_MAX_UNIQUE_IMAGES: "3",
  WRITER_EXPORT_IMAGE_DOWNLOAD_CONCURRENCY: "2",
  WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT_MS: "100"
}), {
  max_image_bytes: 1024,
  max_total_unique_image_bytes: 2048,
  max_unique_images: 3,
  download_concurrency: 2,
  download_timeout_ms: 100
}, "environment values may only tighten the fixed limits");

assert.throws(
  () => normalizeWriterExportRows([{ asset_id: "asset-1", images: [{ embedDataUrl: pngDataUrl }] }]),
  /missing final_title/
);
assert.throws(
  () => normalizeWriterExportRows([{ asset_id: "asset-1", final_title: "Title" }]),
  /missing uploaded image references/
);

const workbook = await buildWriterExportWorkbook({
  tenantId,
  rows: [{
    asset_id: "asset-1",
    asset_index: 1,
    recognition_session_id: "v4sess-1",
    final_title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5",
    images: [
      { id: "front", name: "front.png", embedDataUrl: pngDataUrl },
      { id: "back", name: "back.png", embedDataUrl: pngDataUrl }
    ]
  }],
  env
});
assert.equal(workbook.rows.length, 1);
assert.ok(workbook.buffer.length > 1000);
assert.equal(workbook.buffer.slice(0, 2).toString("utf8"), "PK");

const fetchCalls = [];
const uploadedObjects = new Map();
const fakeFetch = async (url, init = {}) => {
  const urlString = String(url);
  fetchCalls.push({ url: urlString, init });

  if (urlString.includes("/storage/v1/object/sign/")) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ signedURL: "/object/sign/listing-card-images/tenants/tenant_a/exports/test.xlsx?token=signed" })
    };
  }

  if (urlString.includes("/storage/v1/object/listing-card-images/tenants/tenant_a/listing-assets/")) {
    return streamedBytesResponse([pngBytes], { contentLength: pngBytes.byteLength });
  }

  if (urlString.includes("/storage/v1/object/listing-card-images/tenants/tenant_a/exports/writer-batches/")) {
    uploadedObjects.set(urlString, init.body);
    return {
      ok: true,
      status: 200,
      text: async () => "{}"
    };
  }

  if (urlString.includes("/rest/v1/v4_writer_export_batches")) {
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([{ id: "batch-row" }])
    };
  }

  if (urlString.includes("/rest/v1/v4_writer_export_items")) {
    const rows = JSON.parse(init.body);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(rows)
    };
  }

  throw new Error(`Unexpected fetch URL ${urlString}`);
};

const result = await createWriterBatchExport({
  tenantId,
  rows: [{
    asset_id: "asset-1",
    asset_index: 1,
    recognition_session_id: "v4sess-1",
    final_title: "1997-98 Bowman's Best Michael Jordan Best Performance Chicago Bulls",
    images: [
      {
        id: "front",
        name: "front.png",
        objectPath: "tenants/tenant_a/listing-assets/2026-07-07/asset-1/image_1_original-front.png",
        bucket: "listing-card-images",
        originalType: "image/png",
        storageVerified: true
      }
    ]
  }],
  exportedBy: "operator-1",
  env,
  fetchImpl: fakeFetch,
  now: new Date("2026-07-07T13:00:00Z")
});
assert.equal(result.ok, true);
assert.equal(result.asset_count, 1);
assert.equal(result.item_count, 1);
assert.match(result.download_url, /token=signed/);
assert.equal(result.storage_bucket, "listing-card-images");
assert.match(result.storage_object_path, /^tenants\/tenant_a\/exports\/writer-batches\/2026\/07\/writer_export_/);
assert.equal(result.persistence.batch.saved, true);
assert.equal(result.persistence.items.saved, true);
assert.equal(uploadedObjects.size, 1);
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_batches")));
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_items")));
const batchWrite = fetchCalls.find((call) => call.url.includes("/rest/v1/v4_writer_export_batches"));
const itemWrite = fetchCalls.find((call) => call.url.includes("/rest/v1/v4_writer_export_items"));
assert.equal(JSON.parse(batchWrite.init.body).tenant_id, tenantId);
assert.equal(JSON.parse(itemWrite.init.body)[0].tenant_id, tenantId);

const repeatedObjectPath = "tenants/tenant_a/listing-assets/2026-07-07/shared/image_1_original-front.png";
let repeatedDownloadCount = 0;
const repeatedImage = {
  name: "shared.png",
  objectPath: repeatedObjectPath,
  bucket: "listing-card-images"
};
const repeatedWorkbook = await buildWriterExportWorkbook({
  tenantId,
  rows: Array.from({ length: 250 }, (_, index) => ({
    asset_id: `asset-repeat-${index + 1}`,
    asset_index: index + 1,
    final_title: `Repeated export title ${index + 1}`,
    images: [repeatedImage, repeatedImage]
  })),
  env,
  fetchImpl: async () => {
    repeatedDownloadCount += 1;
    return streamedBytesResponse([pngBytes], { contentLength: pngBytes.byteLength });
  }
});
assert.equal(repeatedWorkbook.rows.length, 250);
assert.equal(repeatedDownloadCount, 1, "500 references to one tenant/bucket/path must perform exactly one download");
assert.equal(repeatedWorkbook.buffer.slice(0, 2).toString("utf8"), "PK");

let foreignTenantFetches = 0;
await buildWriterExportWorkbook({
  tenantId,
  rows: [{
    asset_id: "asset-foreign-path",
    final_title: "Foreign path stays unavailable",
    images: [{
      name: "foreign.png",
      objectPath: "tenants/tenant_b/listing-assets/foreign.png",
      bucket: "listing-card-images"
    }]
  }],
  env,
  fetchImpl: async () => {
    foreignTenantFetches += 1;
    return streamedBytesResponse([pngBytes]);
  }
});
assert.equal(foreignTenantFetches, 0, "tenant-path rejection must remain ahead of service-role storage access");

const oversizedCalls = [];
let oversizedError = null;
await assert.rejects(
  createWriterBatchExport({
    tenantId,
    rows: [{
      asset_id: "asset-oversized-stream",
      final_title: "Actual bytes must beat a deceptive header",
      images: [{
        objectPath: "tenants/tenant_a/listing-assets/oversized.png",
        bucket: "listing-card-images"
      }]
    }],
    exportedBy: "operator-1",
    env: {
      ...env,
      WRITER_EXPORT_MAX_IMAGE_BYTES: "8",
      WRITER_EXPORT_MAX_TOTAL_UNIQUE_IMAGE_BYTES: "32",
      WRITER_EXPORT_IMAGE_DOWNLOAD_CONCURRENCY: "1",
      WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT_MS: "1000"
    },
    fetchImpl: async (url) => {
      oversizedCalls.push(String(url));
      return streamedBytesResponse([Buffer.alloc(5), Buffer.alloc(5)], { contentLength: 1 });
    }
  }),
  (error) => {
    oversizedError = error;
    return error?.code === "WRITER_EXPORT_IMAGE_TOO_LARGE" && error?.statusCode === 413;
  }
);
assert.equal(oversizedCalls.length, 1, "oversized content must fail before workbook upload or database persistence");
assert.match(oversizedCalls[0], /\/listing-assets\/oversized\.png$/);
const oversizedFailure = writerExportFailureResponse(oversizedError);
assert.equal(oversizedFailure.status, 413);
assert.equal(oversizedFailure.body.error_type, "WRITER_EXPORT_IMAGE_TOO_LARGE");
assert.equal(oversizedFailure.body.retryable, false);

let totalBudgetError = null;
await assert.rejects(
  buildWriterExportWorkbook({
    tenantId,
    rows: [{
      asset_id: "asset-total-budget",
      final_title: "Aggregate image budget",
      images: [
        { objectPath: "tenants/tenant_a/listing-assets/total-a.png", bucket: "listing-card-images" },
        { objectPath: "tenants/tenant_a/listing-assets/total-b.png", bucket: "listing-card-images" }
      ]
    }],
    env: {
      ...env,
      WRITER_EXPORT_MAX_IMAGE_BYTES: "8",
      WRITER_EXPORT_MAX_TOTAL_UNIQUE_IMAGE_BYTES: "10",
      WRITER_EXPORT_IMAGE_DOWNLOAD_CONCURRENCY: "1"
    },
    fetchImpl: async () => streamedBytesResponse([Buffer.alloc(6)], { contentLength: 1 })
  }),
  (error) => {
    totalBudgetError = error;
    return error?.code === "WRITER_EXPORT_IMAGE_BUDGET_EXCEEDED" && error?.statusCode === 413;
  }
);
assert.equal(writerExportFailureResponse(totalBudgetError).status, 413);

await assert.rejects(
  buildWriterExportWorkbook({
    tenantId,
    rows: [{
      asset_id: "asset-inline-limit",
      final_title: "Inline data URL limit",
      images: [{ embedDataUrl: `data:image/png;base64,${Buffer.alloc(10).toString("base64")}` }]
    }],
    env: {
      ...env,
      WRITER_EXPORT_MAX_IMAGE_BYTES: "8",
      WRITER_EXPORT_MAX_TOTAL_UNIQUE_IMAGE_BYTES: "32"
    }
  }),
  (error) => error?.code === "WRITER_EXPORT_IMAGE_TOO_LARGE" && error?.statusCode === 413
);

let abortedInFlightDownloads = 0;
const abortStartedAt = Date.now();
await assert.rejects(
  buildWriterExportWorkbook({
    tenantId,
    rows: [{
      asset_id: "asset-batch-abort",
      final_title: "Fatal download aborts its peers",
      images: [
        { objectPath: "tenants/tenant_a/listing-assets/fatal.png", bucket: "listing-card-images" },
        { objectPath: "tenants/tenant_a/listing-assets/slow.png", bucket: "listing-card-images" }
      ]
    }],
    env: {
      ...env,
      WRITER_EXPORT_MAX_IMAGE_BYTES: "8",
      WRITER_EXPORT_MAX_TOTAL_UNIQUE_IMAGE_BYTES: "32",
      WRITER_EXPORT_IMAGE_DOWNLOAD_CONCURRENCY: "2",
      WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT_MS: "1000"
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith("/fatal.png")) {
        return streamedBytesResponse([Buffer.alloc(5), Buffer.alloc(5)], { contentLength: 1 });
      }
      return new Promise((resolve, reject) => {
        const abort = () => {
          abortedInFlightDownloads += 1;
          reject(init.signal?.reason || new Error("aborted"));
        };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }),
  (error) => error?.code === "WRITER_EXPORT_IMAGE_TOO_LARGE"
);
assert.equal(abortedInFlightDownloads, 1, "a fatal safety error must abort every other in-flight storage download");
assert.ok(Date.now() - abortStartedAt < 500, "batch abort must not wait for the per-image timeout");

let uniqueImageFetches = 0;
await assert.rejects(
  buildWriterExportWorkbook({
    tenantId,
    rows: [{
      asset_id: "asset-unique-budget",
      final_title: "Unique image count budget",
      images: [
        { objectPath: "tenants/tenant_a/listing-assets/unique-a.png", bucket: "listing-card-images" },
        { objectPath: "tenants/tenant_a/listing-assets/unique-b.png", bucket: "listing-card-images" }
      ]
    }],
    env: { ...env, WRITER_EXPORT_MAX_UNIQUE_IMAGES: "1" },
    fetchImpl: async () => {
      uniqueImageFetches += 1;
      return streamedBytesResponse([pngBytes]);
    }
  }),
  (error) => error?.code === "WRITER_EXPORT_TOO_MANY_UNIQUE_IMAGES" && error?.statusCode === 413
);
assert.equal(uniqueImageFetches, 0, "unique-image overflow must fail before any storage request");

const timeoutStartedAt = Date.now();
let timeoutError = null;
const timeoutCalls = [];
await assert.rejects(
  createWriterBatchExport({
    tenantId,
    rows: [{
      asset_id: "asset-timeout",
      final_title: "Timed storage image",
      images: [{ objectPath: "tenants/tenant_a/listing-assets/timeout.png", bucket: "listing-card-images" }]
    }],
    exportedBy: "operator-1",
    env: { ...env, WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT_MS: "20" },
    fetchImpl: async (url) => {
      timeoutCalls.push(String(url));
      return new Promise(() => {});
    }
  }),
  (error) => {
    timeoutError = error;
    return error?.code === "WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT" && error?.statusCode === 504;
  }
);
assert.ok(Date.now() - timeoutStartedAt < 500, "download timeout must reject promptly");
assert.equal(timeoutCalls.length, 1, "timed out content must fail before workbook upload or database persistence");
assert.match(timeoutCalls[0], /\/listing-assets\/timeout\.png$/);
const timeoutFailure = writerExportFailureResponse(timeoutError);
assert.equal(timeoutFailure.status, 504);
assert.equal(timeoutFailure.body.error_type, "WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT");
assert.equal(timeoutFailure.body.retryable, true);

let activeDownloads = 0;
let peakDownloads = 0;
await buildWriterExportWorkbook({
  tenantId,
  rows: Array.from({ length: 5 }, (_, index) => ({
    asset_id: `asset-concurrency-${index}`,
    final_title: `Concurrency ${index}`,
    images: [{
      objectPath: `tenants/tenant_a/listing-assets/concurrency-${index}.png`,
      bucket: "listing-card-images"
    }]
  })),
  env: { ...env, WRITER_EXPORT_IMAGE_DOWNLOAD_CONCURRENCY: "999" },
  fetchImpl: async () => {
    activeDownloads += 1;
    peakDownloads = Math.max(peakDownloads, activeDownloads);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeDownloads -= 1;
    return streamedBytesResponse([pngBytes], { contentLength: pngBytes.byteLength });
  }
});
assert.equal(peakDownloads, 4, "download concurrency must remain capped by the hard production limit");

console.log("v4 writer export tests passed");
