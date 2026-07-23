#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyIndependentIdentityLabels } from "../lib/listing/evaluation/independent-identity-truth.mjs";

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

async function json(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = arg(argv, "--dataset");
  const labelsPath = arg(argv, "--labels");
  const catalogPath = arg(argv, "--catalog");
  const outputPath = resolve(arg(argv, "--out", ".local/oracle/independent-identity/labeled-devval.json"));
  if (!datasetPath || !labelsPath || !catalogPath) throw new Error("--dataset, --labels, and --catalog are required");
  const output = applyIndependentIdentityLabels(
    await json(datasetPath),
    await json(labelsPath),
    await json(catalogPath)
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: outputPath, item_count: output.items.length, summary: output.identity_truth_summary }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
