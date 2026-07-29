#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  auditCardLevelReleasePack,
  compileCardLevelReleasePackIndex,
  validateCardLevelReleasePackDatasetBinding,
  validateCardLevelReleasePackManifest
} from "../lib/listing/evaluation/card-level-release-pack-audit.mjs";

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * probability) - 1)].toFixed(3));
}

async function readJsonWithHash(path) {
  const buffer = await readFile(path);
  return {
    value: JSON.parse(buffer.toString("utf8")),
    sha256: sha256(buffer)
  };
}

export async function main(argv = process.argv.slice(2)) {
  const runnerPath = fileURLToPath(import.meta.url);
  const modulePath = resolve(dirname(runnerPath), "../lib/listing/evaluation/card-level-release-pack-audit.mjs");
  const datasetArg = arg(argv, "--dataset");
  const manifestArg = arg(argv, "--manifest");
  const bindingArg = arg(argv, "--binding");
  const catalogArg = arg(argv, "--catalog");
  if (!datasetArg || !manifestArg || !bindingArg || !catalogArg) {
    throw new Error(
      "--dataset, --manifest, --binding, and --catalog are required; holdout input is unsupported"
    );
  }
  const datasetPath = resolve(datasetArg);
  const manifestPath = resolve(manifestArg);
  const bindingPath = resolve(bindingArg);
  const catalogPath = resolve(catalogArg);
  const outputPath = resolve(arg(
    argv,
    "--out",
    "docs/reports/card-level-release-pack-audit-current.json"
  ));
  const [dataset, manifest, binding, catalog, runnerSource, moduleSource] = await Promise.all([
    readJsonWithHash(datasetPath),
    readJsonWithHash(manifestPath),
    readJsonWithHash(bindingPath),
    readJsonWithHash(catalogPath),
    readFile(runnerPath),
    readFile(modulePath)
  ]);
  const packProvenance = {
    source_id: "trusted-catalog-snapshot",
    source_type: "TRUSTED_CATALOG_SNAPSHOT",
    source_version: catalog.value.schema_version || "unknown",
    source_sha256: catalog.sha256
  };
  // Fail closed on the frozen truth packet before compiling the catalog index
  // or issuing any truth-fed query.
  const validatedManifest = validateCardLevelReleasePackManifest(manifest.value);
  validateCardLevelReleasePackDatasetBinding({
    dataset: dataset.value,
    manifest: manifest.value,
    binding: binding.value
  });
  const compileStartedAt = performance.now();
  const compiledIndex = compileCardLevelReleasePackIndex({
    cards: catalog.value.cards || [],
    provenance: packProvenance,
    pack_version: `${catalog.value.schema_version || "catalog"}:${catalog.value.generated_at || "undated"}`
  });
  const compileMs = performance.now() - compileStartedAt;
  const devvalIds = new Set([
    ...validatedManifest.partitions.development,
    ...validatedManifest.partitions.validation
  ]);
  const queryTimes = [];
  for (const item of dataset.value.items || []) {
    if (!devvalIds.has(String(item.item_id))) continue;
    const truth = item.retrieval_ground_truth || {};
    if (!truth.retrieval_evaluable || !truth.identity_fields) continue;
    const queryStartedAt = performance.now();
    compiledIndex.query(truth.identity_fields, { limit: 20, query_source: "BENCHMARK_TRUTH_FED" });
    queryTimes.push(performance.now() - queryStartedAt);
  }
  const auditStartedAt = performance.now();
  const report = auditCardLevelReleasePack({
    dataset: dataset.value,
    manifest: manifest.value,
    dataset_binding: binding.value,
    catalog: catalog.value,
    provenance: packProvenance,
    compiled_index: compiledIndex
  });
  report.execution = {
    compile_wall_ms: Number(compileMs.toFixed(3)),
    audit_wall_ms: Number((performance.now() - auditStartedAt).toFixed(3)),
    truth_fed_query_count: queryTimes.length,
    truth_fed_query_p50_ms: percentile(queryTimes, 0.5),
    truth_fed_query_p95_ms: percentile(queryTimes, 0.95),
    truth_fed_query_max_ms: queryTimes.length > 0 ? Number(Math.max(...queryTimes).toFixed(3)) : null,
    paid_provider_calls: 0,
    network_calls: 0
  };
  report.inputs = {
    dataset: { path: datasetPath, sha256: dataset.sha256 },
    manifest: { path: manifestPath, sha256: manifest.sha256 },
    binding: { path: bindingPath, sha256: binding.sha256 },
    catalog: { path: catalogPath, sha256: catalog.sha256 }
  };
  report.code_contract = {
    module: { path: modulePath, sha256: sha256(moduleSource) },
    runner: { path: runnerPath, sha256: sha256(runnerSource) }
  };
  report.report_sha256 = createHash("sha256").update(JSON.stringify({
    ...report,
    generated_at: null,
    execution: null,
    report_sha256: null
  })).digest("hex");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    output: outputPath,
    status: report.status,
    holdout_consumed: report.holdout_consumed,
    index: report.index,
    denominator: report.denominator,
    split: report.split,
    combined: report.combined,
    execution: report.execution,
    report_sha256: report.report_sha256
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
