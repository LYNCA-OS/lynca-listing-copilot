#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freezeGoldenSemReleaseSets } from "../lib/listing/evaluation/golden-sem-release.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const input = resolve(argValue(argv, "--input", "data/eval/launch-benchmark/golden-sem-review-packet-v1.json"));
  const outDir = resolve(argValue(argv, "--out-dir", "data/eval/launch-benchmark/frozen-v1"));
  const version = argValue(argv, "--version", "v1");
  const seed = argValue(argv, "--seed", "lynca-golden-sem-v1");
  if (!existsSync(input)) throw new Error(`review packet not found: ${input}`);
  const packet = JSON.parse(await readFile(input, "utf8"));
  const bundle = freezeGoldenSemReleaseSets(packet, { version, seed });
  await mkdir(outDir, { recursive: true });
  await writeJson(join(outDir, "release-bundle.json"), bundle);
  await writeJson(join(outDir, "development.json"), bundle.partitions.development);
  await writeJson(join(outDir, "validation.json"), bundle.partitions.validation);
  await writeJson(join(outDir, "core-holdout.json"), bundle.holdout_release_set);
  console.log(JSON.stringify({
    output_directory: outDir,
    dataset_id: bundle.dataset_id,
    counts: bundle.split_policy.actual_counts,
    identity_groups: bundle.split_policy.identity_group_count,
    cross_split_identity_overlap_count: bundle.split_policy.cross_split_identity_overlap_count,
    holdout_release_set_valid: bundle.validation.holdout_release_set.ok
  }, null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Golden SEM release freeze failed: ${error.message}`);
    process.exitCode = 2;
  });
}
