#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import readline from "node:readline";
import {
  providerOutputFieldContract,
  providerFieldsByClass
} from "../lib/listing/providers/provider-output-field-contract.mjs";

const defaultTelemetryDir = resolve(process.env.LYNCA_TELEMETRY_DIR || "../lynca-telemetry");
const defaultOutput = resolve("docs/reports/provider-output-contract-audit.json");

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? resolve(argv[index + 1] || fallback) : fallback;
}

function present(value) {
  if (Array.isArray(value)) return value.some(present);
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

async function jsonlFiles(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".jsonl")
    .map((entry) => join(directory, entry.name))
    .sort();
}

async function productionResolvedCounts(telemetryDir) {
  const sessionDir = join(telemetryDir, "v4_recognition_sessions");
  const counts = Object.fromEntries(Object.keys(providerOutputFieldContract).map((field) => [field, 0]));
  let rows = 0;
  let rowsWithFinalTitle = 0;
  for (const file of await jsonlFiles(sessionDir)) {
    const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      rows += 1;
      if (!String(row.final_title || row.l2_title || "").trim()) continue;
      rowsWithFinalTitle += 1;
      const resolved = row.resolved_fields || {};
      for (const field of Object.keys(counts)) {
        if (present(resolved[field])) counts[field] += 1;
      }
    }
  }
  return { rows, rows_with_final_title: rowsWithFinalTitle, counts };
}

const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const ignoredDirectories = new Set([".git", "node_modules", "scripts", "docs", "data", "migrations", "vendor"]);
const ignoredFiles = new Set([
  "lib/listing/providers/openai-emergency-provider.mjs",
  "lib/listing/providers/provider-output-field-contract.mjs",
  "lib/listing/pipeline/provider-prompt.mjs"
]);

async function sourceFiles(root, directory = root) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(root, path));
    else if (sourceExtensions.has(extname(entry.name))) found.push(path);
  }
  return found;
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function consumerFiles(repoRoot) {
  const output = Object.fromEntries(Object.keys(providerOutputFieldContract).map((field) => [field, []]));
  for (const path of await sourceFiles(repoRoot)) {
    const rel = relative(repoRoot, path);
    if (ignoredFiles.has(rel)) continue;
    const text = await readFile(path, "utf8");
    for (const field of Object.keys(output)) {
      const name = escaped(field);
      const consumerPattern = new RegExp(`(?:\\.${name}\\b|["']${name}["']\\s*[:),\\]])`);
      if (consumerPattern.test(text)) output[field].push(rel);
    }
  }
  return output;
}

export async function auditProviderOutputContract({ telemetryDir = defaultTelemetryDir, repoRoot = resolve("."), generatedAt = new Date().toISOString() } = {}) {
  const production = await productionResolvedCounts(telemetryDir);
  const consumers = await consumerFiles(repoRoot);
  return {
    schema_version: "provider-output-contract-audit-v1",
    generated_at: generatedAt,
    evidence_scope: {
      telemetry_snapshot: basename(telemetryDir),
      production_value_semantics: "post_resolver resolved_fields; not raw provider observations",
      consumer_semantics: "unique runtime source files with a syntactic field reference; definitions, tests, scripts, docs and data excluded"
    },
    totals: {
      exported_session_rows: production.rows,
      rows_with_final_title: production.rows_with_final_title,
      field_count: Object.keys(providerOutputFieldContract).length,
      read_field_count: providerFieldsByClass("READ").length,
      derived_field_count: providerFieldsByClass("DERIVED").length,
      drop_field_count: providerFieldsByClass("DROP").length
    },
    fields: Object.fromEntries(Object.entries(providerOutputFieldContract).map(([field, spec]) => [field, {
      ...spec,
      production_resolved_nonempty_rows: production.counts[field],
      runtime_consumer_file_count: consumers[field].length,
      runtime_consumer_files: consumers[field]
    }]))
  };
}

async function main() {
  const telemetryDir = argValue(process.argv, "--telemetry-dir", defaultTelemetryDir);
  const output = argValue(process.argv, "--out", defaultOutput);
  const report = await auditProviderOutputContract({ telemetryDir });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
