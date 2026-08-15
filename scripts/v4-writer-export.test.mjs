import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildWriterExportObjectPath,
  buildWriterExportWorkbook,
  createWriterBatchExport,
  normalizeWriterExportRows
} from "../lib/listing/v4/export/writer-batch-export.mjs";

const exportApiSource = await readFile(new URL("../api/v4/listing-export-workbook.js", import.meta.url), "utf8");
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
assert.ok(workbook.buffer.length > 1000);
assert.equal(workbook.buffer.slice(0, 2).toString("utf8"), "PK");

const fetchCalls = [];
const uploadedObjects = new Map();
const persistedBatchRows = [];
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
          return String(name).toLowerCase() === "content-type" ? "image/png" : "";
        }
      },
      arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)
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
    persistedBatchRows.push(JSON.parse(init.body));
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
        name: "front.png",
        objectPath: "listing-assets/2026-07-07/asset-1/image_1_original-front.png",
        bucket: "listing-card-images",
        originalType: "image/png",
        storageVerified: true
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
assert.equal(result.persistence.items.saved, true);
assert.equal(uploadedObjects.size, 1);
assert.equal(persistedBatchRows.length, 1);
assert.equal(persistedBatchRows[0].tenant_id, "tenant_a");
assert.equal(persistedItemRows.length, 1);
assert.equal(persistedItemRows[0].tenant_id, "tenant_a");
assert.equal(persistedItemRows[0].export_batch_id, persistedBatchRows[0].id);
assert.equal(persistedItemRows[0].training_use, "operational_only_never_training");
assert.equal(persistedBatchRows[0].manifest.training_use, "operational_only_never_training");
assert.equal(persistedBatchRows[0].manifest.training_eligible, false);
assert.equal(
  persistedBatchRows[0].manifest.training_admission,
  "requires_independent_persisted_review_event"
);
assert.doesNotMatch(
  JSON.stringify({ batch: persistedBatchRows[0], items: persistedItemRows }),
  /writer_export_reviewed_title|reviewed_title_dataset_candidate/i,
  "exporting an unreviewed READY title must never synthesize review or dataset-candidate evidence"
);
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_batches")));
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/v4_writer_export_items")));
const batchWrite = fetchCalls.find((call) => call.url.includes("/rest/v1/v4_writer_export_batches"));
assert.equal(
  new URL(batchWrite.url).searchParams.get("on_conflict"),
  "tenant_id,id",
  "batch upserts must resolve identity inside the authenticated tenant boundary"
);
const itemWrite = fetchCalls.find((call) => call.url.includes("/rest/v1/v4_writer_export_items"));
assert.equal(
  new URL(itemWrite.url).searchParams.get("on_conflict"),
  "id",
  "item upserts must target the deployed global id primary key; tenant lineage is enforced by the parent batch"
);

console.log("v4 writer export tests passed");
