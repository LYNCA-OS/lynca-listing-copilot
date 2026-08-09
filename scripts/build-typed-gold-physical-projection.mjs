#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildPhysicalOnlyProjection } from "../lib/listing/evaluation/typed-gold-annotation-pilot.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.split(/=(.*)/s).slice(0, 2)));
const datasetPath = resolve(args["--dataset"] || "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json");
const cohortPath = resolve(args["--cohort"] || "artifacts/accuracy-mechanism-confirmatory-2026-08-02/mixed-150.asset-ids.json");
const projectionPath = resolve(args["--projection"] || "artifacts/typed-gold-pilot20-2026-08-09/physical-only.json");
const manifestPath = resolve(args["--manifest"] || "artifacts/typed-gold-pilot20-2026-08-09/physical-only.manifest.json");
const [datasetBytes, cohortBytes] = await Promise.all([readFile(datasetPath), readFile(cohortPath)]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const built = buildPhysicalOnlyProjection({
  dataset: JSON.parse(datasetBytes), cohortAssetIds: JSON.parse(cohortBytes),
  datasetSha256: sha(datasetBytes), sourceCohortSha256: sha(cohortBytes)
});
await mkdir(dirname(projectionPath), { recursive: true, mode: 0o700 });
await Promise.all([
  writeFile(projectionPath, `${JSON.stringify(built.projection, null, 2)}\n`, { mode: 0o600 }),
  writeFile(manifestPath, `${JSON.stringify(built.manifest, null, 2)}\n`, { mode: 0o600 })
]);
await Promise.all([chmod(projectionPath, 0o600), chmod(manifestPath, 0o600)]);
console.log(JSON.stringify({ projection_sha256: built.manifest.projection_sha256, items: built.manifest.item_count, sealed_labels_read: false }));
