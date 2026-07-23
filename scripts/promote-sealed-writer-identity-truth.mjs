#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditIndependentIdentityReviewPacket,
  promoteSealedWriterIdentityTruth
} from "../lib/listing/evaluation/independent-identity-truth.mjs";

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

async function json(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const reviewPath = arg(argv, "--review");
  const datasetPath = arg(argv, "--dataset");
  const catalogPath = arg(argv, "--catalog");
  const manualPath = arg(argv, "--manual-labels");
  const outputPath = resolve(arg(argv, "--out", ".local/oracle/independent-identity/review-packet-v2.json"));
  const auditPath = resolve(arg(argv, "--audit-out", ".local/oracle/independent-identity/audit-v2.json"));
  if (!reviewPath || !datasetPath || !catalogPath) throw new Error("--review, --dataset, and --catalog are required");
  const [review, dataset, catalog, manualImageLabels] = await Promise.all([
    json(reviewPath), json(datasetPath), json(catalogPath), manualPath ? json(manualPath) : {}
  ]);
  const promoted = promoteSealedWriterIdentityTruth(review, dataset, { manualImageLabels });
  const audit = auditIndependentIdentityReviewPacket(promoted, catalog);
  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(promoted, null, 2)}\n`, { mode: 0o600 }),
    writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 })
  ]);
  console.log(JSON.stringify({ output: outputPath, audit: auditPath, counts: audit.counts, gate: audit.gate }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
