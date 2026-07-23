#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planGoldenSemReviewSplits } from "../lib/listing/evaluation/golden-sem-release.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildReproducibleOracleSplits(packet = {}, {
  minimumHoldout = 45,
  sourceCutoff = null
} = {}) {
  const imageBackedItems = (packet.items || []).filter((item) => item.recognition_input?.images?.length);
  const imageBackedPacket = {
    ...packet,
    dataset_id: `${packet.dataset_id}-image-backed`,
    items: imageBackedItems
  };
  const splitPlan = planGoldenSemReviewSplits(imageBackedPacket, { minimumHoldout });
  const partitionById = new Map(Object.entries(splitPlan.partitions).flatMap(([partition, rows]) => (
    rows.map((row) => [row.item_id, partition])
  )));
  const groups = Object.fromEntries(Object.entries(splitPlan.partitions).map(([partition, rows]) => [
    partition,
    [...new Set(rows.map((row) => row.planning_group_id))].sort()
  ]));
  const ids = Object.fromEntries(Object.entries(splitPlan.partitions).map(([partition, rows]) => [
    partition,
    rows.map((row) => row.item_id).sort()
  ]));
  const identityOverlap = {
    development_validation: groups.development.filter((id) => groups.validation.includes(id)),
    development_holdout: groups.development.filter((id) => groups.holdout.includes(id)),
    validation_holdout: groups.validation.filter((id) => groups.holdout.includes(id))
  };
  if (Object.values(identityOverlap).some((rows) => rows.length)) {
    throw new Error("Oracle split leakage detected");
  }
  if (ids.holdout.length < minimumHoldout) {
    throw new Error(`Oracle holdout requires ${minimumHoldout} image-backed cards`);
  }
  const sourceFingerprint = sha256(JSON.stringify(imageBackedItems.map((item) => ({
    item_id: item.item_id,
    source_feedback_id: item.source_feedback_id,
    images: item.recognition_input.images
  })).sort((left, right) => String(left.item_id).localeCompare(String(right.item_id)))));
  const manifest = {
    schema_version: "v4-oracle-reproducible-split-manifest-v1",
    dataset_id: imageBackedPacket.dataset_id,
    source_cutoff_created_at: sourceCutoff,
    source_item_count: packet.items?.length || 0,
    image_backed_item_count: imageBackedItems.length,
    source_fingerprint_sha256: sourceFingerprint,
    split_seed: splitPlan.seed,
    minimum_holdout: minimumHoldout,
    actual_counts: splitPlan.actual_counts,
    identity_group_counts: Object.fromEntries(Object.entries(groups).map(([partition, rows]) => [
      partition,
      rows.length
    ])),
    leakage_check: Object.fromEntries(Object.entries(identityOverlap).map(([key, rows]) => [key, rows.length])),
    partitions: ids
  };
  const partitions = Object.fromEntries(["development", "validation", "holdout"].map((partition) => [
    partition,
    {
      ...imageBackedPacket,
      partition,
      sealed: partition === "holdout",
      items: imageBackedItems.filter((item) => partitionById.get(item.item_id) === partition)
    }
  ]));
  return { manifest, partitions };
}

export async function main(argv = process.argv.slice(2)) {
  const input = argValue(argv, "--input");
  if (!input) throw new Error("--input is required");
  const outputDir = resolve(argValue(argv, "--output-dir", ".local/oracle/reproducible"));
  const minimumHoldout = Number(argValue(argv, "--minimum-holdout", "45"));
  const sourceCutoff = argValue(argv, "--source-cutoff") || null;
  const result = buildReproducibleOracleSplits(
    JSON.parse(await readFile(resolve(input), "utf8")),
    { minimumHoldout, sourceCutoff }
  );
  await Promise.all([
    writeJson(resolve(outputDir, "manifest.json"), result.manifest),
    ...Object.entries(result.partitions).map(([partition, value]) => (
      writeJson(resolve(outputDir, `${partition}.json`), value)
    ))
  ]);
  console.log(JSON.stringify(result.manifest, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
