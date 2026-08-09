#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildCompactV4ForwardDiagnosticV2 } from
  "../lib/listing/evaluation/model-residual-compact-v4-forward-diagnostic-v2.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

async function json(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

export async function writeCompactV4ForwardDiagnosticV2({ checkpointPath,
  analysisPath, outPath }) {
  if (!checkpointPath || !analysisPath || !outPath) {
    throw new Error("usage: --checkpoint <json> --analysis <json> --out <json>");
  }
  const [checkpoint, analysis] = await Promise.all([
    json(checkpointPath), json(analysisPath)
  ]);
  const diagnostic = buildCompactV4ForwardDiagnosticV2({ checkpoint, analysis });
  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(diagnostic, null, 2)}\n`, { mode: 0o600 });
  return diagnostic;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  writeCompactV4ForwardDiagnosticV2({
    checkpointPath: option(process.argv.slice(2), "--checkpoint"),
    analysisPath: option(process.argv.slice(2), "--analysis"),
    outPath: option(process.argv.slice(2), "--out")
  }).then((diagnostic) => {
    process.stdout.write(`${JSON.stringify({
      schema_version: diagnostic.schema_version,
      source: diagnostic.source,
      summary: diagnostic.summary,
      factual_metrics: diagnostic.factual_metrics,
      interpretation: diagnostic.interpretation
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
