#!/usr/bin/env node
import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { screenCardJoinCatalog } from "../lib/listing/evaluation/cardjoin-catalog-screening.mjs";

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return crypto.createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function main(argv = process.argv.slice(2)) {
  const datasetPath = resolve(arg(argv, "--dataset"));
  const manifestPath = resolve(arg(argv, "--manifest"));
  const catalogPath = resolve(arg(argv, "--catalog"));
  const outputPath = resolve(arg(argv, "--out", "docs/reports/cardjoin-addressability-current.json"));
  if (!arg(argv, "--dataset") || !arg(argv, "--manifest") || !arg(argv, "--catalog")) {
    throw new Error("--dataset, --manifest, and --catalog are required; holdout input is intentionally unsupported");
  }
  const [dataset, manifest, catalog, datasetSha, manifestSha, catalogSha] = await Promise.all([
    readJson(datasetPath),
    readJson(manifestPath),
    readJson(catalogPath),
    sha256(datasetPath),
    sha256(manifestPath),
    sha256(catalogPath)
  ]);
  const report = screenCardJoinCatalog({ dataset, manifest, catalog });
  report.inputs = {
    dataset: { path: datasetPath, sha256: datasetSha },
    manifest: { path: manifestPath, sha256: manifestSha },
    catalog: { path: catalogPath, sha256: catalogSha }
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    output: outputPath,
    status: report.status,
    denominator: report.denominator,
    split: report.split,
    combined: report.combined,
    classification_counts: report.classification_counts,
    report_sha256: report.report_sha256
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
