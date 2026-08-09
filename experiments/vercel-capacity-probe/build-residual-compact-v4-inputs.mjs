#!/usr/bin/env node

// Zero-network, zero-provider input builder. It projects only physical image
// identity and sealed-label references; it never opens the sealed-label file.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ARM_SPECS } from "../../scripts/run-thin-path-eval.mjs";
import { imageSetFingerprint } from "../../scripts/run-thin-path-eval.mjs";
import { withModelResidualCompactV4 } from
  "../accuracy/model-residual-compact-v4-cloud-plan.mjs";
import { writeJsonAtomic } from "./cloud-io.mjs";
import { validateAssetsOnlyManifest } from "./materialize-residual-v3-payload.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const arg = (argv, name) => {
  const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || "");
};

function compactTemplates() {
  const control = ARM_SPECS.thin_canonical_high_effort_low.buildRequest({
    imageUrls: [], model: "gpt-5.6-luna", effort: "low", imageDetail: "high"
  });
  return { control, treatment: withModelResidualCompactV4(control) };
}

export function buildResidualCompactV4Inputs({ datasetBody, prereg, v3Prereg }) {
  const dataset = JSON.parse(String(datasetBody));
  const ids = prereg?.confirmatory_70?.asset_ids;
  if (prereg?.schema_version !== "model-residual-compact-v4-cloud-prereg-v1"
      || !Array.isArray(ids) || ids.length !== 70 || new Set(ids).size !== 70
      || sha256(datasetBody) !== v3Prereg?.analysis_inputs?.dataset_sha256) {
    throw new Error("compact_v4_input_source_invalid");
  }
  const byId = new Map((dataset.items || []).map((item) => [item.asset_id, item]));
  if (byId.size !== (dataset.items || []).length) {
    throw new Error("compact_v4_dataset_asset_id_duplicate");
  }
  const labelRefs = [];
  const assets = ids.map((assetId) => {
    const item = byId.get(assetId);
    const images = (item?.images || []).map(({ bucket, object_path, role }) => ({
      bucket, object_path, role
    }));
    const imageSetSha256 = imageSetFingerprint({ images });
    if (!item || images.length < 1 || images.length > 2
        || images[0]?.role !== "front_original"
        || (images.length === 2 && images[1]?.role !== "back_original")
        || typeof item.sealed_eval_label_ref?.path !== "string"
        || typeof item.sealed_eval_label_ref?.key !== "string") {
      throw new Error(`compact_v4_input_pairing_invalid:${assetId}`);
    }
    labelRefs.push({ asset_id: assetId,
      sealed_eval_label_ref: structuredClone(item.sealed_eval_label_ref) });
    return { asset_id: assetId, image_set_sha256: imageSetSha256, images };
  });
  const manifest = validateAssetsOnlyManifest({
    schema_version: "residual-compact-v4-assets-only-manifest-v1", assets
  }, { expectedCards: 70, minimumImages: 1, maximumImages: 2,
    schemaVersion: "residual-compact-v4-assets-only-manifest-v1" });
  const labelsPath = new Set(labelRefs.map((row) => row.sealed_eval_label_ref.path));
  const selectedLabelKeys = new Set(labelRefs.map((row) => row.sealed_eval_label_ref.key));
  if (selectedLabelKeys.size !== labelRefs.length) {
    throw new Error("compact_v4_selected_label_key_duplicate");
  }
  if (labelsPath.size !== 1
      || [...labelsPath][0] !== v3Prereg.analysis_inputs.expected_labels_path) {
    throw new Error("compact_v4_label_ref_path_invalid");
  }
  const labelRefReceipt = {
    schema_version: "residual-compact-v4-label-ref-receipt-v1",
    dataset_sha256: sha256(datasetBody),
    mapping_sha256: sha256(JSON.stringify(labelRefs)),
    expected_labels_path: [...labelsPath][0],
    sealed_labels_sha256: v3Prereg.analysis_inputs.sealed_labels_sha256,
    sealed_label_bytes_read: false,
    selected: labelRefs
  };
  return { manifest, labelRefReceipt, ...compactTemplates() };
}

export async function main(argv = process.argv.slice(2)) {
  const required = ["--dataset", "--prereg", "--v3-prereg", "--assets-out",
    "--label-ref-out", "--control-template-out", "--treatment-template-out"];
  if (required.some((name) => !arg(argv, name))) {
    throw new Error("compact_v4_input_builder_path_missing");
  }
  const [datasetBody, preregBody, v3PreregBody] = await Promise.all([
    readFile(resolve(arg(argv, "--dataset"))),
    readFile(resolve(arg(argv, "--prereg"))),
    readFile(resolve(arg(argv, "--v3-prereg")))
  ]);
  const built = buildResidualCompactV4Inputs({ datasetBody,
    prereg: JSON.parse(preregBody), v3Prereg: JSON.parse(v3PreregBody) });
  await Promise.all([
    writeJsonAtomic(resolve(arg(argv, "--assets-out")), built.manifest),
    writeJsonAtomic(resolve(arg(argv, "--label-ref-out")), built.labelRefReceipt),
    writeJsonAtomic(resolve(arg(argv, "--control-template-out")), built.control),
    writeJsonAtomic(resolve(arg(argv, "--treatment-template-out")), built.treatment)
  ]);
  return built;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((result) => process.stdout.write(`${JSON.stringify({ provider_calls: 0,
    network_calls: 0, label_files_read: 0, cards: result.manifest.assets.length,
    mapping_sha256: result.labelRefReceipt.mapping_sha256 })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
