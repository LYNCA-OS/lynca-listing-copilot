import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "../lib/vendor/exceljs-browser/exceljs.min.js";
import { writerExportFailureResponse } from "../api/v4/listing-export-workbook.js";
import { inspectXlsxImagePackage } from "./xlsx-package-inspection.mjs";
import {
  buildWriterExportObjectPath,
  buildWriterExportWorkbook,
  createWriterBatchExport,
  normalizeWriterExportRows
} from "../lib/listing/v4/export/writer-batch-export.mjs";

const exportApiSource = await readFile(new URL("../api/v4/listing-export-workbook.js", import.meta.url), "utf8");
const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const exportGuardMigration = await readFile(new URL(
  "../infrastructure/supabase-production/supabase/migrations/20260815131050_writer_export_operational_only_v1.sql",
  import.meta.url
), "utf8");
assert.doesNotMatch(exportApiSource, /new pg\.Client|client\.query\(sql\)/, "a writer export request must never apply database migrations at runtime");
assert.match(exportApiSource, /context = await requireTenantAccess\(req\)/, "export attribution must come from the authenticated tenant session");
assert.match(exportApiSource, /exportedBy:\s*context\.userId/, "the server-derived operator must be persisted on the export batch");
assert.match(exportApiSource, /tenantId:\s*context\.tenantId/, "the authenticated tenant must scope the export batch");
assert.doesNotMatch(exportApiSource, /payload\.exported_by\s*\|\|/, "client-controlled exporter identity must be ignored");
assert.match(exportApiSource, /WRITER_EXPORT_SCHEMA_UNAVAILABLE/, "missing export schema must fail closed with an explicit deployment error");
assert.equal(vercelConfig.functions["api/v4/listing-export-workbook.js"]?.maxDuration, 300);
assert.deepEqual(vercelConfig.functions["api/v4/listing-export-workbook.js"]?.regions, ["sin1"]);
assert.equal(packageJson.dependencies?.sharp, undefined, "native image conversion must not inflate the export function bundle");
assert.match(exportGuardMigration, /alter column training_use set default 'operational_only_never_training'/);
assert.match(exportGuardMigration, /training_use = 'operational_only_never_training'[\s\S]*not valid/);
assert.match(exportGuardMigration, /validate constraint v4_writer_export_items_operational_only_training_use/);
assert.match(exportGuardMigration, /v4_writer_export_batches_operational_only_manifest/);
assert.match(exportGuardMigration, /requires_independent_persisted_review_event/);
assert.doesNotMatch(
  exportGuardMigration,
  /writer_export_reviewed_title|reviewed_title_dataset_candidate/i,
  "the fail-safe migration must not preserve a reviewed-title export label"
);

const pngBytes = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex"
);
const pngDataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
const webpBytes = Buffer.from("UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==", "base64");
const webpDataUrl = `data:image/webp;base64,${webpBytes.toString("base64")}`;
const jpegBytes = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/n/ooooA/9k=",
  "base64"
);
const jpegDataUrl = `data:image/jpeg;base64,${jpegBytes.toString("base64")}`;
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  LISTING_IMAGE_BUCKET: "listing-card-images"
};

assert.throws(
  () => normalizeWriterExportRows([{ asset_id: "asset-1", images: [{ embedDataUrl: pngDataUrl }] }]),
  /missing final_title/
);
assert.throws(
  () => normalizeWriterExportRows([{
    asset_id: "asset-1",
    final_title: "X".repeat(81),
    images: [{ embedDataUrl: pngDataUrl }]
  }]),
  /limited to 80 characters/,
  "the server export boundary must enforce the same eBay title limit as the browser and Composer"
);
assert.throws(
  () => normalizeWriterExportRows([{ asset_id: "asset-1", final_title: "Title" }]),
  /missing uploaded image references/
);

const workbook = await buildWriterExportWorkbook({
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
assert.equal(workbook.embedded_image_count, 2);
assert.equal(workbook.source_image_bytes, pngBytes.byteLength * 2);
assert.ok(workbook.buffer.length > 1000);
assert.equal(workbook.buffer.slice(0, 2).toString("utf8"), "PK");
const pngPackage = inspectXlsxImagePackage(workbook.buffer);
assert.match(pngPackage.contentTypes, /Extension="png" ContentType="image\/png"/);
assert.equal(pngPackage.media.length, 2);
assert.ok(pngPackage.media.every((entry) => entry.extension === "png"
  && entry.bytes.equals(pngBytes)));
assert.equal(pngPackage.drawingRelationships.length, 1);
for (const media of pngPackage.media) {
  assert.match(pngPackage.drawingRelationships[0].xml, new RegExp(`Target="\.\./media/${media.name.split("/").at(-1)}"`));
}
const pngRoundTrip = new ExcelJS.Workbook();
await pngRoundTrip.xlsx.load(workbook.buffer);
assert.equal(pngRoundTrip.model.media.filter((entry) => entry.type === "image").length, 2);

await assert.rejects(
  buildWriterExportWorkbook({
    rows: [{
      asset_id: "asset-mismatch",
      final_title: "Signature Mismatch",
      images: [{ embedDataUrl: `data:image/png;base64,${webpBytes.toString("base64")}` }]
    }],
    env
  }),
  /content-type\/signature mismatch/,
  "a forged image MIME must fail the whole workbook instead of becoming a placeholder"
);
await assert.rejects(
  buildWriterExportWorkbook({
    rows: [{
      asset_id: "asset-direct-webp",
      final_title: "Direct WebP Must Fail Closed",
      images: [{
        objectPath: "listing-assets/direct/front.webp",
        originalType: "image/webp"
      }]
    }],
    env,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/webp" },
      arrayBuffer: async () => webpBytes.buffer.slice(webpBytes.byteOffset, webpBytes.byteOffset + webpBytes.byteLength)
    })
  }),
  /requires a JPEG or PNG display derivative/,
  "WebP must be converted by the existing browser canvas before ExcelJS packaging"
);

const fetchCalls = [];
const uploadedObjects = new Map();
const batchMutations = [];
const persistedItemRows = [];
const fakeFetch = async (url, init = {}) => {
  const urlString = String(url);
  fetchCalls.push({ url: urlString, init });

  if (urlString.includes("/storage/v1/object/sign/")) {
    const signedPath = new URL(urlString).pathname.replace(/^\/storage\/v1/, "");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ signedURL: `${signedPath}?token=signed` })
    };
  }

  if (urlString.includes("/storage/v1/object/listing-card-images/listing-assets/")) {
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-type" ? "image/webp" : "";
        }
      },
      arrayBuffer: async () => webpBytes.buffer.slice(webpBytes.byteOffset, webpBytes.byteOffset + webpBytes.byteLength)
    };
  }

  if (urlString.includes("/storage/v1/object/listing-card-images/tenants/") && urlString.includes("/exports/writer-batches/")) {
    uploadedObjects.set(urlString, init.body);
    return {
      ok: true,
      status: 200,
      text: async () => "{}"
    };
  }

  if (urlString.includes("/rest/v1/v4_writer_export_batches")) {
    batchMutations.push({ method: init.method, row: JSON.parse(init.body), url: urlString });
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([{ id: "batch-row" }])
    };
  }

  if (urlString.includes("/rest/v1/v4_writer_export_items")) {
    const rows = JSON.parse(init.body);
    persistedItemRows.push(...rows);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(rows)
    };
  }

  throw new Error(`Unexpected fetch URL ${urlString}`);
};

const fixedNow = new Date("2026-07-07T13:00:00Z");
assert.equal(
  buildWriterExportObjectPath({ tenantId: "tenant_legacy", batchId: "writer_export_legacy", now: fixedNow }),
  "tenants/tenant_legacy/exports/writer-batches/2026/07/writer_export_legacy.xlsx",
  "the compatibility tenant must remain supported without sharing a global export prefix"
);
assert.notEqual(
  buildWriterExportObjectPath({ tenantId: "tenant_a", batchId: "writer_export_same", now: fixedNow }),
  buildWriterExportObjectPath({ tenantId: "tenant_b", batchId: "writer_export_same", now: fixedNow }),
  "even an identical object name must be isolated by tenant"
);
assert.throws(
  () => buildWriterExportObjectPath({ tenantId: "tenant_a/../tenant_b", batchId: "writer_export_bad", now: fixedNow }),
  /invalid_writer_export_tenant_id/
);
const callsBeforeInvalidTenant = fetchCalls.length;
await assert.rejects(
  createWriterBatchExport({ rows: [], tenantId: "", exportedBy: "operator-1", env, fetchImpl: fakeFetch, now: fixedNow }),
  /invalid_writer_export_tenant_id/
);
assert.equal(fetchCalls.length, callsBeforeInvalidTenant, "an invalid or omitted tenant must fail before storage or database writes");

const result = await createWriterBatchExport({
  rows: [{
    asset_id: "asset-1",
    asset_index: 1,
    recognition_session_id: "v4sess-1",
    final_title: "1997-98 Bowman's Best Michael Jordan Best Performance Chicago Bulls",
    images: [
      {
        id: "front",
        name: "front.webp",
        objectPath: "listing-assets/2026-07-07/asset-1/image_1_original-front.webp",
        bucket: "listing-card-images",
        originalType: "image/webp",
        storageVerified: true,
        embedDataUrl: jpegDataUrl
      }
    ]
  }],
  tenantId: "tenant_a",
  exportedBy: "operator-1",
  env,
  fetchImpl: fakeFetch,
  now: fixedNow
});
assert.equal(result.ok, true);
assert.equal(result.tenant_id, "tenant_a");
assert.equal(result.asset_count, 1);
assert.equal(result.item_count, 1);
assert.match(result.download_url, /token=signed/);
assert.equal(result.storage_bucket, "listing-card-images");
assert.match(result.storage_object_path, /^tenants\/tenant_a\/exports\/writer-batches\/2026\/07\/writer_export_/);
assert.equal(result.persistence.batch.saved, true);
assert.equal(result.persistence.pending_batch.saved, true);
assert.equal(result.persistence.items.saved, true);
assert.equal(uploadedObjects.size, 1);
const uploadedWorkbookPackage = inspectXlsxImagePackage([...uploadedObjects.values()][0]);
assert.equal(uploadedWorkbookPackage.media.length, 1);
assert.equal(uploadedWorkbookPackage.media[0].extension, "jpeg");
assert.ok(uploadedWorkbookPackage.media[0].bytes.equals(jpegBytes));
assert.match(uploadedWorkbookPackage.contentTypes, /Extension="jpeg" ContentType="image\/jpeg"/);
assert.match(uploadedWorkbookPackage.drawingRelationships[0].xml, /Target="\.\.\/media\/image1\.jpeg"/);
assert.equal(batchMutations.length, 2);
assert.equal(batchMutations[0].method, "POST");
assert.equal(batchMutations[0].row.tenant_id, "tenant_a");
assert.equal(batchMutations[0].row.status, "PENDING");
assert.equal(batchMutations[0].row.manifest.embedded_image_count, null);
assert.equal(batchMutations[1].method, "PATCH");
assert.equal(batchMutations[1].row.status, "READY");
assert.equal(batchMutations[1].row.manifest.embedded_image_count, 1);
assert.equal(result.manifest.image_count, 1);
assert.equal(result.manifest.embedded_image_count, 1);
assert.equal(result.manifest.image_embedding, "excel_png_jpeg_display_bytes");
assert.equal(result.manifest.display_derivative_count, 1);
assert.equal(persistedItemRows.length, 1);
assert.equal(persistedItemRows[0].tenant_id, "tenant_a");
assert.equal(persistedItemRows[0].export_batch_id, batchMutations[0].row.id);
assert.equal(persistedItemRows[0].training_use, "operational_only_never_training");
assert.equal(persistedItemRows[0].image_refs[0].objectPath,
  "listing-assets/2026-07-07/asset-1/image_1_original-front.webp");
assert.doesNotMatch(JSON.stringify(persistedItemRows), /embedDataUrl|embed_data_url|data:image/i,
  "display derivatives must live only through workbook construction, never in durable item rows");
assert.equal(batchMutations[1].row.manifest.training_use, "operational_only_never_training");
assert.equal(batchMutations[1].row.manifest.training_eligible, false);
assert.equal(
  batchMutations[1].row.manifest.training_admission,
  "requires_independent_persisted_review_event"
);
assert.doesNotMatch(
  JSON.stringify({ batches: batchMutations, items: persistedItemRows }),
  /writer_export_reviewed_title|reviewed_title_dataset_candidate/i,
  "exporting an unreviewed READY title must never synthesize review or dataset-candidate evidence"
);
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_batches")));
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_items")));
const batchWrite = fetchCalls.find((call) => call.url.includes("/rest/v1/v4_writer_export_batches")
  && call.init.method === "POST");
assert.equal(
  new URL(batchWrite.url).searchParams.get("on_conflict"),
  null,
  "a random batch id must be inserted once as PENDING, never merged into an older export"
);
const itemWrite = fetchCalls.find((call) => call.url.includes("/rest/v1/v4_writer_export_items"));
assert.equal(
  new URL(itemWrite.url).searchParams.get("on_conflict"),
  "id",
  "item upserts must target the deployed global id primary key; tenant lineage is enforced by the parent batch"
);
const signedUrlCallIndex = fetchCalls.findIndex((call) => call.url.includes("/storage/v1/object/sign/"));
const readyPatchCallIndex = fetchCalls.findIndex((call) => call.url.includes("/rest/v1/v4_writer_export_batches")
  && call.init.method === "PATCH");
assert.ok(signedUrlCallIndex >= 0 && signedUrlCallIndex < readyPatchCallIndex,
  "READY must be the last state transition after the download receipt is available");

let activeImageReads = 0;
let peakImageReads = 0;
let completedImageReads = 0;
const concurrencyFetch = async () => {
  activeImageReads += 1;
  peakImageReads = Math.max(peakImageReads, activeImageReads);
  await new Promise((resolve) => setTimeout(resolve, 15));
  activeImageReads -= 1;
  completedImageReads += 1;
  return {
    ok: true,
    status: 200,
    headers: { get: () => "image/jpeg" },
    arrayBuffer: async () => jpegBytes.buffer.slice(jpegBytes.byteOffset, jpegBytes.byteOffset + jpegBytes.byteLength)
  };
};
const concurrentWorkbook = await buildWriterExportWorkbook({
  rows: Array.from({ length: 3 }, (_, index) => ({
    asset_id: `asset-concurrency-${index + 1}`,
    final_title: `Concurrent export ${index + 1}`,
    images: ["front", "back"].map((side) => ({
      objectPath: `listing-assets/${index + 1}/${side}.jpg`,
      bucket: "listing-card-images",
      originalType: "image/jpeg"
    }))
  })),
  env,
  fetchImpl: concurrencyFetch
});
assert.equal(concurrentWorkbook.embedded_image_count, 6);
assert.equal(completedImageReads, 6);
assert.equal(peakImageReads, 4, "storage reads must use the bounded four-worker export pool");

const failureBatchMutations = [];
let failureObjectUploaded = false;
const failureFetch = async (url, init = {}) => {
  const urlString = String(url);
  if (urlString.includes("/storage/v1/object/listing-card-images/listing-assets/")) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/webp" },
      arrayBuffer: async () => webpBytes.buffer.slice(webpBytes.byteOffset, webpBytes.byteOffset + webpBytes.byteLength)
    };
  }
  if (urlString.includes("/storage/v1/object/listing-card-images/tenants/")
      && urlString.includes("/exports/writer-batches/")) {
    failureObjectUploaded = true;
    return { ok: true, status: 200, text: async () => "{}" };
  }
  if (urlString.includes("/rest/v1/v4_writer_export_batches")) {
    failureBatchMutations.push({ method: init.method, row: JSON.parse(init.body), url: urlString });
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "failure-batch" }]) };
  }
  if (urlString.includes("/rest/v1/v4_writer_export_items")) {
    return { ok: false, status: 500, text: async () => "controlled item write failure" };
  }
  throw new Error(`Unexpected failure fetch URL ${urlString}`);
};
let retainedFailure;
await assert.rejects(
  createWriterBatchExport({
    rows: [{
      asset_id: "asset-failure",
      final_title: "Controlled Atomic Export Failure",
      images: [{
        objectPath: "listing-assets/failure/front.webp",
        bucket: "listing-card-images",
        originalType: "image/webp",
        embedDataUrl: jpegDataUrl
      }]
    }],
    tenantId: "tenant_a",
    exportedBy: "operator-1",
    env,
    fetchImpl: failureFetch,
    now: fixedNow
  }),
  (error) => {
    retainedFailure = error;
    return error.message === "Writer export failed during item_persistence."
      && /^writer_export_[0-9a-f-]{36}$/.test(error.batchId)
      && error.failurePhase === "item_persistence";
  }
);
assert.equal(failureObjectUploaded, true);
assert.equal(failureBatchMutations.length, 2);
assert.equal(failureBatchMutations[0].row.status, "PENDING");
assert.equal(failureBatchMutations[1].row.status, "FAILED");
assert.equal(failureBatchMutations[1].row.manifest.failure_phase, "item_persistence");
assert.equal(failureBatchMutations[1].row.manifest.training_use, "operational_only_never_training");
const publicFailure = writerExportFailureResponse(retainedFailure);
assert.equal(publicFailure.status, 503);
assert.equal(publicFailure.body.batch_id, retainedFailure.batchId);
assert.equal(publicFailure.body.failure_phase, "item_persistence");
assert.doesNotMatch(JSON.stringify(publicFailure.body), /service-role|controlled item write failure/,
  "the public receipt identifies the durable batch without exposing infrastructure detail");

console.log("v4 writer export tests passed");
