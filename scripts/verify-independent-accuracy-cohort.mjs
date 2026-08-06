#!/usr/bin/env node

// Fail closed unless a label-blind, materializable, independent accuracy
// cohort exists. A same-card fresh response is useful evidence, but it is not
// an independent-card confirmation and must never pass this gate.

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function fail(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function pathExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function validateIndependentAccuracyCohort({
  dataset,
  developmentAssetIds = [],
  selectedAssetIds = null,
  sealedLabels = null,
  targetCount = 150,
  requireLocalImages = false
} = {}) {
  const sourceItems = Array.isArray(dataset?.items) ? dataset.items : [];
  if (!Number.isInteger(targetCount) || targetCount < 1) fail("target_count_invalid");
  if (!sourceItems.length) fail("dataset_items_missing");

  let items = sourceItems;
  if (selectedAssetIds !== null) {
    if (!Array.isArray(selectedAssetIds) || selectedAssetIds.some((id) => !text(id))) {
      fail("selected_asset_ids_invalid");
    }
    const selected = selectedAssetIds.map(text);
    if (new Set(selected).size !== selected.length) fail("selected_asset_ids_not_unique");
    const byId = new Map(sourceItems.map((item) => [text(item?.asset_id), item]));
    const missing = selected.filter((id) => !byId.has(id));
    if (missing.length) fail("selected_asset_ids_missing_from_dataset", { missing: missing.slice(0, 20) });
    items = selected.map((id) => byId.get(id));
  }

  const development = new Set(developmentAssetIds.map(text).filter(Boolean));
  const ids = items.map((item) => text(item?.asset_id));
  if (ids.some((id) => !id)) fail("asset_id_missing");
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) fail("asset_ids_not_unique", { duplicate_ids: [...new Set(duplicateIds)] });

  const overlap = ids.filter((id) => development.has(id));
  if (overlap.length) fail("cohort_overlaps_development", { overlap_count: overlap.length });
  if (items.length < targetCount) fail("independent_cohort_too_small", {
    available: items.length,
    required: targetCount
  });

  const failures = [];
  const sealedByKey = sealedLabels === null
    ? null
    : new Map((Array.isArray(sealedLabels) ? sealedLabels : []).map((row) => [text(row?.key), row]));
  for (const item of items.slice(0, targetCount)) {
    if (text(item?.canonical_title) || Object.keys(item?.source_titles || {}).length) {
      failures.push({ asset_id: item.asset_id, reason: "label_visible_in_item" });
    }
    const source = item?.source_record || {};
    if (source.reviewed_title_visible_to_model !== false
        || source.title_derived_fields_visible_to_model !== false) {
      failures.push({ asset_id: item.asset_id, reason: "source_not_blind" });
    }
    const labelRef = item?.sealed_eval_label_ref || {};
    if (!text(labelRef.path) || !text(labelRef.key)) {
      failures.push({ asset_id: item.asset_id, reason: "sealed_label_reference_missing" });
    } else if (sealedByKey) {
      const sealed = sealedByKey.get(text(labelRef.key));
      if (!sealed) {
        failures.push({ asset_id: item.asset_id, reason: "sealed_label_key_missing" });
      } else if (sealed?.policy?.reviewed_title_is_ground_truth !== true
          || sealed?.policy?.model_prompt_visible !== false
          || sealed?.policy?.load_after_predictions_frozen !== true) {
        failures.push({ asset_id: item.asset_id, reason: "sealed_label_policy_invalid" });
      }
    }
    const images = Array.isArray(item?.images) ? item.images : [];
    const materializable = images.some((image) => {
      const bucket = text(image?.bucket);
      const objectPath = text(image?.object_path || image?.objectPath);
      const localPath = text(image?.local_path || image?.localPath);
      return (bucket && objectPath && !objectPath.startsWith("/benchmark-fixture-not-required/"))
        || (requireLocalImages && localPath && !localPath.startsWith("/benchmark-fixture-not-required/"));
    });
    if (!materializable) failures.push({ asset_id: item.asset_id, reason: "materializable_image_missing" });
    if (requireLocalImages) {
      const localImages = images.filter((image) => text(image?.local_path || image?.localPath));
      for (const image of localImages) {
        const localPath = resolve(text(image.local_path || image.localPath));
        if (!(await pathExists(localPath))) failures.push({ asset_id: item.asset_id, reason: "local_image_missing" });
      }
    }
  }
  if (failures.length) fail("cohort_contract_invalid", { failures: failures.slice(0, 20), failure_count: failures.length });

  const selected = ids.slice(0, targetCount);
  return {
    ok: true,
    claim_boundary: "independent_card_cohort",
    count: selected.length,
    asset_ids_sha256: sha256(selected.join("\n")),
    development_overlap_count: 0
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const datasetPath = resolve(arg("--dataset"));
  const developmentPath = arg("--development");
  const selectedPath = arg("--asset-ids-file");
  const sealedLabelsPath = arg("--sealed-labels");
  if (!datasetPath || !developmentPath) fail("dataset_and_development_required");
  const [dataset, developmentAssetIds, selectedAssetIds, sealedLabels] = await Promise.all([
    readFile(datasetPath, "utf8").then(JSON.parse),
    readFile(resolve(developmentPath), "utf8").then(JSON.parse),
    selectedPath ? readFile(resolve(selectedPath), "utf8").then(JSON.parse) : Promise.resolve(null),
    sealedLabelsPath ? readFile(resolve(sealedLabelsPath), "utf8").then((body) => (
      body.split(/\n+/).filter((line) => line.trim()).map(JSON.parse)
    )) : Promise.resolve(null)
  ]);
  try {
    console.log(JSON.stringify(await validateIndependentAccuracyCohort({
      dataset,
      developmentAssetIds,
      selectedAssetIds,
      sealedLabels,
      targetCount: Number(arg("--count", "150")),
      requireLocalImages: process.argv.includes("--require-local-images")
    }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code || "cohort_validation_failed", ...error.detail }, null, 2));
    process.exitCode = 1;
  }
}
