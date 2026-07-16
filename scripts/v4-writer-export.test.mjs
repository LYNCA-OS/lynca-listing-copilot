import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildWriterExportWorkbook,
  createWriterBatchExport,
  normalizeWriterExportRows
} from "../lib/listing/v4/export/writer-batch-export.mjs";

const exportApiSource = await readFile(new URL("../api/v4/listing-export-workbook.js", import.meta.url), "utf8");
assert.doesNotMatch(exportApiSource, /new pg\.Client|client\.query\(sql\)/, "a writer export request must never apply database migrations at runtime");
assert.match(exportApiSource, /const operatorId = operatorIdFromRequest\(req\)/, "export attribution must be derived from the authenticated server session");
assert.match(exportApiSource, /exportedBy:\s*operatorId/, "the server-derived operator must be persisted on the export batch");
assert.doesNotMatch(exportApiSource, /payload\.exported_by\s*\|\|/, "client-controlled exporter identity must be ignored");
assert.match(exportApiSource, /WRITER_EXPORT_SCHEMA_UNAVAILABLE/, "missing export schema must fail closed with an explicit deployment error");

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

assert.throws(
  () => normalizeWriterExportRows([{ asset_id: "asset-1", images: [{ embedDataUrl: pngDataUrl }] }]),
  /missing final_title/
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
      text: async () => JSON.stringify({ signedURL: "/object/sign/listing-card-images/exports/test.xlsx?token=signed" })
    };
  }

  if (urlString.includes("/storage/v1/object/listing-card-images/listing-assets/")) {
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-type" ? "image/png" : "";
        }
      },
      arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)
    };
  }

  if (urlString.includes("/storage/v1/object/listing-card-images/exports/writer-batches/")) {
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
  rows: [{
    asset_id: "asset-1",
    asset_index: 1,
    recognition_session_id: "v4sess-1",
    final_title: "1997-98 Bowman's Best Michael Jordan Best Performance Chicago Bulls",
    images: [
      {
        id: "front",
        name: "front.png",
        objectPath: "listing-assets/2026-07-07/asset-1/image_1_original-front.png",
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
assert.match(result.storage_object_path, /^exports\/writer-batches\/2026\/07\/writer_export_/);
assert.equal(result.persistence.batch.saved, true);
assert.equal(result.persistence.items.saved, true);
assert.equal(uploadedObjects.size, 1);
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_batches")));
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_items")));

console.log("v4 writer export tests passed");
