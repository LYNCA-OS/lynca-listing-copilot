#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argValues(argv, name) {
  return argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1]] : []);
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function fieldValue(item, field) {
  return item.reviewed_ground_truth?.field_statuses?.[field] === "CONFIRMED"
    ? item.reviewed_ground_truth.fields[field]
    : "";
}

function canonicalImageReference(image = {}) {
  if (image.bucket && image.object_path) return image;
  try {
    const url = new URL(image.url || "");
    const marker = "/storage/v1/object/authenticated/";
    const offset = url.pathname.indexOf(marker);
    if (offset < 0) return image;
    const objectReference = decodeURIComponent(url.pathname.slice(offset + marker.length));
    const separator = objectReference.indexOf("/");
    if (separator <= 0) return image;
    return {
      ...image,
      bucket: objectReference.slice(0, separator),
      object_path: objectReference.slice(separator + 1),
      url: undefined
    };
  } catch {
    return image;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const inputs = argValues(argv, "--input");
  if (!inputs.length) throw new Error("at least one --input partition is required");
  const output = resolve(argValue(argv, "--out", "data/eval/v4-chain-oracle/cloud-dataset.json"));
  const partitions = await Promise.all(inputs.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))));
  const items = partitions.flatMap((partition) => (partition.items || []).map((item) => ({
    candidate_id: item.item_id,
    id: item.item_id,
    source_feedback_id: item.source_feedback_id,
    category: fieldValue(item, "ip_sport"),
    images: (item.recognition_input?.images || []).map((image) => canonicalImageReference({
      ...image,
      role: image.image_role || image.role || null
    })),
    corrected_title: item.sealed_evaluation_reference?.writer_reviewed_title || "",
    ground_truth: {
      corrected_title: item.sealed_evaluation_reference?.writer_reviewed_title || "",
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_is_field_ground_truth: false,
      model_prompt_visible: false,
      marketplace_weak_label: false
    },
    reviewed_ground_truth: item.reviewed_ground_truth,
    retrieval_ground_truth: item.retrieval_ground_truth,
    oracle_partition: partition.partition
  })));
  const dataset = {
    schema_version: "v4-oracle-cloud-eval-dataset-v1",
    generated_at: new Date().toISOString(),
    truth_policy: {
      corrected_title_visible_to_model: false,
      field_ground_truth_class: "TRUSTED_CATALOG_PROMOTED_GOLDEN_SEM"
    },
    item_count: items.length,
    items
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(JSON.stringify({ output, item_count: items.length }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
