#!/usr/bin/env node

// Reads the physical image-only dataset, projects only Storage identity and
// front/back role, and never opens the sealed-label file.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeJsonAtomic } from "./cloud-io.mjs";
import { buildAssetsOnlyManifestFromDataset } from "./materialize-residual-v3-payload.mjs";

const argument = (argv, name) => {
  const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || "");
};
const load = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = argument(argv, "--dataset");
  const preregPath = argument(argv, "--prereg");
  const outPath = argument(argv, "--out");
  if (!datasetPath || !preregPath || !outPath) throw new Error("v3_assets_only_builder_path_missing");
  const manifest = buildAssetsOnlyManifestFromDataset({
    dataset: await load(datasetPath), prereg: await load(preregPath)
  });
  await writeJsonAtomic(resolve(outPath), manifest);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((manifest) => process.stdout.write(`${JSON.stringify({ provider_calls: 0,
    label_files_read: 0, cards: manifest.assets.length })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
