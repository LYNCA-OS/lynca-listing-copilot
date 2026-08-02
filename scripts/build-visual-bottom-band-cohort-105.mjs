#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { imageSetFingerprint, signImageUrls } from "./run-thin-path-eval.mjs";

const ROOT = resolve("/Users/paidaxin/lynca-eval-root");
const DATASET_PATH = join(ROOT, "data/eval/reviewed-title-blind/reviewed-title-image-only.json");
const ASSET_IDS_PATH = resolve("artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105.asset-ids.json");
const OUT_DIR = resolve("artifacts/accuracy-visual-bottom-band-v1-105-2026-08-02");
const IMAGE_DIR = join(OUT_DIR, "images");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || "");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function requireEnv() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("SUPABASE_URL_and_SUPABASE_SECRET_KEY_required");
}

async function fetchImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`image_fetch_failed:${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderBottomBandSheet(buffers) {
  const images = await Promise.all(buffers.map((buffer) => loadImage(buffer)));
  const band = (image) => ({
    left: 0,
    top: Math.round(image.height * 0.65),
    width: image.width,
    height: Math.max(1, image.height - Math.round(image.height * 0.65))
  });
  const bands = images.map(band);
  const width = Math.max(...bands.map(({ width: bandWidth }) => bandWidth));
  const height = bands.reduce((sum, { height: bandHeight }) => sum + bandHeight, 0);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#777777";
  context.fillRect(0, 0, width, height);
  let top = 0;
  for (const [index, image] of images.entries()) {
    const source = bands[index];
    context.drawImage(image, source.left, source.top, source.width, source.height,
      Math.round((width - source.width) / 2), top, source.width, source.height);
    top += source.height;
  }
  return canvas.toBuffer("image/jpeg", 90);
}

async function main() {
  requireEnv();
  mkdirSync(IMAGE_DIR, { recursive: true });
  const datasetBody = readFileSync(DATASET_PATH, "utf8");
  const dataset = JSON.parse(datasetBody);
  const selectedIds = JSON.parse(readFileSync(ASSET_IDS_PATH, "utf8"));
  if (!Array.isArray(selectedIds) || selectedIds.length !== 105) throw new Error(`expected_105_asset_ids:${selectedIds?.length}`);
  const selected = new Set(selectedIds);
  const byId = new Map((dataset.items || []).map((item) => [item.asset_id, item]));
  const missing = selectedIds.filter((assetId) => !byId.has(assetId));
  if (missing.length) throw new Error(`asset_ids_missing_from_dataset:${missing.slice(0, 3).join(",")}`);

  const outputItems = (dataset.items || []).map((item) => ({ ...item }));
  const generated = [];
  for (const [index, assetId] of selectedIds.entries()) {
    const item = byId.get(assetId);
    const originalImages = (item.images || []).slice(0, 2);
    if (!originalImages.length) throw new Error(`asset_requires_original_image:${assetId}`);
    const signed = await signImageUrls(originalImages, {
      supabaseUrl: SUPABASE_URL,
      serviceKey: SUPABASE_SECRET_KEY,
      expiresIn: 3600
    });
    if (signed.length !== originalImages.length) throw new Error(`signed_image_count_mismatch:${assetId}:${signed.length}`);
    const sourceBuffers = await Promise.all(signed.map(fetchImage));
    const sheetBuffer = await renderBottomBandSheet(sourceBuffers);
    const imagePath = join(IMAGE_DIR, `${assetId}__bottom-sheet.jpg`);
    writeFileSync(imagePath, sheetBuffer);
    const outputItem = outputItems.find((candidate) => candidate.asset_id === assetId);
    outputItem.visual_extra_images = [{
      role: "visual_bottom_two_band_v1",
      local_path: imagePath,
      content_type: "image/jpeg",
      content_sha256: sha256(sheetBuffer)
    }];
    generated.push({
      asset_id: assetId,
      source_image_set_sha256: imageSetFingerprint(item),
      extra_image_sha256: sha256(sheetBuffer),
      extra_image_bytes: sheetBuffer.length,
      extra_image_path: imagePath
    });
    if ((index + 1) % 10 === 0 || index + 1 === selectedIds.length) {
      process.stderr.write(`visual cohort ${index + 1}/${selectedIds.length}\n`);
    }
  }

  const cohort = {
    ...dataset,
    schema_version: `${dataset.schema_version}+visual_bottom_two_band_v1`,
    generated_at: new Date().toISOString(),
    items: outputItems
  };
  const cohortBody = `${JSON.stringify(cohort, null, 2)}\n`;
  const manifest = {
    schema_version: "visual-bottom-two-band-cohort-v1",
    transform: "native-pixel available original-side bottom 35% bands stacked vertically, JPEG quality 90",
    source_dataset: DATASET_PATH,
    source_dataset_sha256: sha256(datasetBody),
    selected_asset_ids_path: ASSET_IDS_PATH,
    selected_asset_ids_sha256: sha256(readFileSync(ASSET_IDS_PATH)),
    selected_count: generated.length,
    generated,
    cohort_dataset_sha256: sha256(cohortBody)
  };
  writeFileSync(join(OUT_DIR, "visual-cohort.dataset.json"), cohortBody);
  writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ out_dir: OUT_DIR, selected_count: generated.length, cohort_dataset_sha256: manifest.cohort_dataset_sha256 }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`visual cohort failed: ${error?.message || error}\n`);
  process.exitCode = 1;
});
