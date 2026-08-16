#!/usr/bin/env node

// csmdata boundary: project accepted image pairs into a label-free execution
// manifest and freeze the later scoring contract. This process reads label
// references and hashes, never sealed title bytes.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { lunaParityArm, sha256 } from "./luna-parity-core.mjs";
import { writeFileAtomic } from "../../scripts/run-thin-path-eval.mjs";

const SCORE_SCHEMA = "luna-parity-score-contract-v1";
const ASSET_SCHEMA = "luna-parity-assets-only-v1";
const LABEL_MAP_SCHEMA = "luna-parity-sealed-label-map-v1";

const arg = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || "");
};

const readJson = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

async function writeJson(path, value) {
  await writeFileAtomic(resolve(path), `${JSON.stringify(value, null, 2)}\n`);
}

function exactPair(item, receipts) {
  const images = (item?.images || []).map((image) => ({
    role: image.role,
    ...(image.local_path || image.localPath
      ? { local_path: image.local_path || image.localPath }
      : { bucket: image.bucket, object_path: image.object_path || image.objectPath })
  }));
  if (images.length !== 2
      || images[0]?.role !== "front_original"
      || images[1]?.role !== "back_original") {
    throw new Error(`luna_parity_complete_pair_required:${item?.asset_id || "missing"}`);
  }
  const bySlot = new Map(receipts.map((row) => [row.slot, row]));
  return images.map((image, index) => {
    const receipt = bySlot.get(index + 1);
    if (!receipt || receipt.role !== image.role
        || !/^[0-9a-f]{64}$/.test(String(receipt.content_sha256 || ""))
        || !Number.isInteger(receipt.byte_length) || receipt.byte_length < 1) {
      throw new Error(`luna_parity_image_receipt_invalid:${item.asset_id}:${index + 1}`);
    }
    return {
      ...image,
      content_sha256: receipt.content_sha256,
      byte_length: receipt.byte_length
    };
  });
}

export async function prepareLunaParityScoreContract({
  datasetBody,
  assetIds,
  reverifyReceipt,
  trustedLabelReceipt,
  scorerBody,
  controlArm,
  treatmentArm,
  selectionRole = "csmdata_mechanism_screen"
}) {
  const datasetSha256 = sha256(datasetBody);
  let dataset;
  try { dataset = JSON.parse(String(datasetBody)); }
  catch { throw new Error("luna_parity_dataset_invalid_json"); }
  if (!Array.isArray(dataset?.items)
      || !Array.isArray(assetIds) || assetIds.length < 1
      || new Set(assetIds).size !== assetIds.length
      || reverifyReceipt?.all_match !== true
      || trustedLabelReceipt?.sealed_label_bytes_read !== false
      || trustedLabelReceipt?.dataset_sha256 !== datasetSha256
      || !/^[0-9a-f]{64}$/.test(String(trustedLabelReceipt?.sealed_labels_sha256 || ""))) {
    throw new Error("luna_parity_preparation_input_invalid");
  }
  const arms = [lunaParityArm(controlArm), lunaParityArm(treatmentArm)];
  if (controlArm === treatmentArm) throw new Error("luna_parity_arms_must_be_distinct_keys");

  const itemById = new Map(dataset.items.map((item) => [item.asset_id, item]));
  const receiptByAsset = new Map();
  for (const receipt of reverifyReceipt.images || []) {
    if (!receiptByAsset.has(receipt.asset_id)) receiptByAsset.set(receipt.asset_id, []);
    receiptByAsset.get(receipt.asset_id).push(receipt);
  }
  const trustedMapping = new Map((trustedLabelReceipt.selected || []).map((row) => [
    row.asset_id, row.sealed_eval_label_ref
  ]));
  const labelPaths = new Set();
  const labelKeys = new Set();
  const mapping = [];
  const assets = assetIds.map((assetId) => {
    const item = itemById.get(assetId);
    const trustedRef = trustedMapping.get(assetId);
    if (!item || !trustedRef
        || item.sealed_eval_label_ref?.key !== trustedRef.key
        || item.sealed_eval_label_ref?.path !== trustedRef.path
        || labelKeys.has(trustedRef.key)) {
      throw new Error(`luna_parity_asset_authority_invalid:${assetId}`);
    }
    labelKeys.add(trustedRef.key);
    labelPaths.add(trustedRef.path);
    mapping.push({ asset_id: assetId, label_key: trustedRef.key });
    const images = exactPair(item, receiptByAsset.get(assetId) || []);
    return {
      asset_id: assetId,
      image_set_sha256: sha256(JSON.stringify(images)),
      images
    };
  });
  if (labelPaths.size !== 1
      || [...labelPaths][0] !== trustedLabelReceipt.expected_labels_path) {
    throw new Error("luna_parity_label_path_invalid");
  }

  const assetsManifest = {
    schema_version: ASSET_SCHEMA,
    authority: "csmdata_writer_reviewed_title_gold",
    source_dataset_sha256: datasetSha256,
    source_reverify_sha256: sha256(JSON.stringify(reverifyReceipt)),
    sealed_label_bytes_read: false,
    selected_asset_ids_sha256: sha256(JSON.stringify(assetIds)),
    assets
  };
  const assetsManifestSha256 = sha256(JSON.stringify(assetsManifest));
  const labelMap = {
    schema_version: LABEL_MAP_SCHEMA,
    assets_manifest_sha256: assetsManifestSha256,
    dataset_sha256: datasetSha256,
    expected_labels_path: [...labelPaths][0],
    sealed_labels_sha256: trustedLabelReceipt.sealed_labels_sha256,
    sealed_label_bytes_read: false,
    selected_asset_ids_sha256: assetsManifest.selected_asset_ids_sha256,
    mapping_sha256: sha256(JSON.stringify(mapping)),
    mapping
  };
  const scoreContract = {
    schema_version: SCORE_SCHEMA,
    authority: "evaluation_only",
    production_authorized: false,
    assets_manifest_sha256: assetsManifestSha256,
    label_map_sha256: sha256(JSON.stringify(labelMap)),
    sealed_labels_sha256: trustedLabelReceipt.sealed_labels_sha256,
    scorer_sha256: sha256(scorerBody),
    selected_asset_ids_sha256: assetsManifest.selected_asset_ids_sha256,
    selected_cards: assets.length,
    arms: arms.map(({ key }) => key),
    control_arm: controlArm,
    treatment_arm: treatmentArm,
    selection_role: selectionRole,
    primary_metric: "reviewed_title_token_f1",
    paired_test: "exact_two_sided_sign_test",
    complete_pair_only: true,
    no_replacement: true,
    typed_field_gold: false
  };
  return {
    assetsManifest,
    labelMap,
    scoreContract: {
      ...scoreContract,
      score_contract_sha256: sha256(JSON.stringify(scoreContract))
    }
  };
}

export async function main(argv = process.argv.slice(2)) {
  const required = [
    "--dataset", "--asset-ids", "--reverify-receipt", "--trusted-label-receipt",
    "--assets-out", "--label-map-out", "--score-contract-out",
    "--control-arm", "--treatment-arm"
  ];
  if (required.some((name) => !arg(argv, name))) {
    throw new Error("luna_parity_preparation_path_missing");
  }
  const scorerPath = resolve(arg(argv, "--scorer",
    fileURLToPath(new URL("./score-luna-parity-blind.mjs", import.meta.url))));
  const [datasetBody, assetIds, reverifyReceipt, trustedLabelReceipt, scorerBody] =
    await Promise.all([
      readFile(resolve(arg(argv, "--dataset"))),
      readJson(arg(argv, "--asset-ids")),
      readJson(arg(argv, "--reverify-receipt")),
      readJson(arg(argv, "--trusted-label-receipt")),
      readFile(scorerPath)
    ]);
  const built = await prepareLunaParityScoreContract({
    datasetBody,
    assetIds,
    reverifyReceipt,
    trustedLabelReceipt,
    scorerBody,
    controlArm: arg(argv, "--control-arm"),
    treatmentArm: arg(argv, "--treatment-arm"),
    selectionRole: arg(argv, "--selection-role", "csmdata_mechanism_screen")
  });
  await Promise.all([
    writeJson(arg(argv, "--assets-out"), built.assetsManifest),
    writeJson(arg(argv, "--label-map-out"), built.labelMap),
    writeJson(arg(argv, "--score-contract-out"), built.scoreContract)
  ]);
  process.stdout.write(`${JSON.stringify({
    cards: built.assetsManifest.assets.length,
    score_contract_sha256: built.scoreContract.score_contract_sha256,
    sealed_label_bytes_read: false,
    provider_calls: 0
  })}\n`);
  return built;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
