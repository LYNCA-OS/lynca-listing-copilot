#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoldenSemReviewPacket } from "../lib/listing/evaluation/golden-sem-release.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

async function readJson(path) {
  const target = resolve(path);
  if (!existsSync(target)) throw new Error(`input not found: ${target}`);
  return JSON.parse(await readFile(target, "utf8"));
}

async function writeJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const input = argValue(argv, "--input");
  const output = argValue(argv, "--out", "data/eval/launch-benchmark/golden-sem-review-packet-v1.json");
  const datasetId = argValue(argv, "--dataset-id", "supabase-writer-reviewed-sem-v1");
  if (!input) throw new Error("--input is required");
  const packet = buildGoldenSemReviewPacket(await readJson(input), { datasetId });
  await writeJson(output, packet);
  console.log(JSON.stringify({
    output: resolve(output),
    dataset_id: packet.dataset_id,
    review_items: packet.summary.review_item_count,
    with_titles: packet.summary.with_writer_reviewed_title_count,
    with_images: packet.summary.with_image_count,
    field_ground_truth_ready: false
  }, null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Golden SEM review packet build failed: ${error.message}`);
    process.exitCode = 2;
  });
}
