#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promoteGoldenSemWithTrustedCatalog } from "../lib/listing/evaluation/trusted-catalog-sem-promotion.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const packetPath = resolve(argValue(argv, "--packet"));
  const catalogPath = resolve(argValue(argv, "--catalog"));
  if (!argValue(argv, "--packet")) throw new Error("--packet is required");
  if (!argValue(argv, "--catalog")) throw new Error("--catalog is required");
  const outputDir = resolve(argValue(argv, "--output-dir", "data/eval/v4-chain-oracle/trusted-promotion"));
  const result = promoteGoldenSemWithTrustedCatalog(
    JSON.parse(await readFile(packetPath, "utf8")),
    JSON.parse(await readFile(catalogPath, "utf8"))
  );
  await Promise.all([
    writeJson(resolve(outputDir, "golden-sem-promoted.json"), result.packet),
    writeJson(resolve(outputDir, "golden-sem-image-backed-approved.json"), result.audit_packet),
    writeJson(resolve(outputDir, "promotion-report.json"), result.report),
    writeJson(resolve(outputDir, "manual-review-worklist.json"), result.review_worklist)
  ]);
  console.log(JSON.stringify(result.report, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
