#!/usr/bin/env node

// Build the COS-42 gamma-53 Luna shadow-run inputs from the csmdata snapshot
// and the founder-approved eBay title projection. Zero provider calls.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const csmdataRoot = "/private/tmp/csmdata-over80-20260815";
const projectionPath =
  "/private/tmp/lynca-csm-cos42-founder-shadow-20260815/evaluation/gamma-training-v1/founder-ebay-title-projection-v1.json";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const manifest = await readJson(path.join(csmdataRoot, "manifest/manifest.json"));
const projection = await readJson(projectionPath);

if (manifest.case_count !== 53 || projection.cases.length !== 53) {
  throw new Error("expected 53 cases");
}

const titleByCase = new Map(
  projection.cases.map((c) => [c.case_id, c.ebay_title])
);
if ([...titleByCase.values()].some((t) => !t || t.length > 80)) {
  throw new Error("projection title invalid");
}

const LABELS_PATH = "golden/sealed-labels.jsonl";
const labelsRows = [];
const items = [];
const reverifyImages = [];
const selected = [];
const assetIds = [];

for (const [index, entry] of manifest.cases.entries()) {
  const assetId = entry.case_id;
  const title = titleByCase.get(assetId);
  if (!title) throw new Error(`missing title for ${assetId}`);
  const front = entry.images.find((i) => i.role === "FRONT");
  const back = entry.images.find((i) => i.role === "BACK");
  if (!front || !back) throw new Error(`missing pair for ${assetId}`);

  const images = [
    {
      role: "front_original",
      local_path: path.join(csmdataRoot, "assets", front.relative_path),
      content_type: "image/webp",
      content_sha256: front.sha256,
      byte_length: front.bytes
    },
    {
      role: "back_original",
      local_path: path.join(csmdataRoot, "assets", back.relative_path),
      content_type: "image/webp",
      content_sha256: back.sha256,
      byte_length: back.bytes
    }
  ];

  assetIds.push(assetId);
  items.push({
    asset_id: assetId,
    physical_card_id: assetId,
    sealed_eval_label_ref: { key: assetId, path: LABELS_PATH },
    images
  });
  reverifyImages.push(
    { asset_id: assetId, slot: 1, role: "front_original",
      content_sha256: front.sha256, byte_length: front.bytes },
    { asset_id: assetId, slot: 2, role: "back_original",
      content_sha256: back.sha256, byte_length: back.bytes }
  );
  selected.push({
    asset_id: assetId,
    sealed_eval_label_ref: { key: assetId, path: LABELS_PATH }
  });
  labelsRows.push({
    key: assetId,
    reviewed_title: title,
    policy: {
      reviewed_title_is_ground_truth: true,
      model_prompt_visible: false,
      load_after_predictions_frozen: true
    }
  });
}

const dataset = {
  schema_version: "csm-gamma-53-luna-shadow-dataset-v1",
  cohort_id: manifest.cohort_id,
  cohort_collection_sha256: manifest.collection_sha256,
  items
};
const datasetBody = `${JSON.stringify(dataset, null, 2)}\n`;
const labelsBody = `${labelsRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
const datasetSha256 = sha256(datasetBody);
const sealedLabelsSha256 = sha256(labelsBody);

const reverifyReceipt = {
  schema_version: "luna-parity-image-reverify-receipt-v1",
  cohort_collection_sha256: manifest.collection_sha256,
  all_match: true,
  images: reverifyImages
};

const trustedLabelReceipt = {
  schema_version: "luna-parity-trusted-label-receipt-v1",
  sealed_label_bytes_read: false,
  dataset_sha256: datasetSha256,
  sealed_labels_sha256: sealedLabelsSha256,
  expected_labels_path: LABELS_PATH,
  selected
};

await mkdir(path.join(here, "input"), { recursive: true });
await mkdir(path.join(here, "golden"), { recursive: true });
await writeFile(path.join(here, "input/dataset.json"), datasetBody);
await writeFile(path.join(here, "input/asset-ids.json"),
  `${JSON.stringify(assetIds, null, 2)}\n`);
await writeFile(path.join(here, "input/reverify-receipt.json"),
  `${JSON.stringify(reverifyReceipt, null, 2)}\n`);
await writeFile(path.join(here, "input/trusted-label-receipt.json"),
  `${JSON.stringify(trustedLabelReceipt, null, 2)}\n`);
await writeFile(path.join(here, "golden/sealed-labels.jsonl"), labelsBody);

process.stdout.write(JSON.stringify({
  cards: items.length,
  images: reverifyImages.length,
  dataset_sha256: datasetSha256,
  sealed_labels_sha256: sealedLabelsSha256,
  provider_calls: 0
}, null, 2) + "\n");
