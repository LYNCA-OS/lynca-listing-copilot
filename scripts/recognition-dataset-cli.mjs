import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assignRecognitionSplits,
  createRecognitionCandidatesFromFeedbackRows,
  detectRecognitionLeakage,
  readRecognitionDatasetDir,
  readRecognitionDatasetFile,
  recognitionDatasetStats,
  validateRecognitionDataset
} from "../lib/listing/recognition/recognition-dataset.mjs";
import { evaluateRecognitionAblation, evaluateRecognitionDataset } from "../lib/listing/recognition/recognition-evaluation.mjs";

function argValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (filePath) {
    await writeFile(filePath, text);
  } else {
    process.stdout.write(text);
  }
}

async function datasetFromArg(args) {
  const input = argValue(args, "--input") || argValue(args, "-i");
  const dir = argValue(args, "--dir");
  if (dir) return readRecognitionDatasetDir(dir);
  if (!input) throw new Error("Missing --input or --dir.");
  return readRecognitionDatasetFile(input);
}

export async function runRecognitionDatasetCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const output = argValue(args, "--output") || argValue(args, "-o");

  if (command === "export-candidates") {
    const input = argValue(args, "--input") || argValue(args, "-i");
    if (!input) throw new Error("Missing --input feedback export.");
    const payload = await readJson(input);
    const rows = Array.isArray(payload) ? payload : payload.rows || payload.items || [];
    return writeJson(output, {
      schema_version: "recognition-candidate-export-v1",
      generated_at: new Date().toISOString(),
      items: createRecognitionCandidatesFromFeedbackRows(rows)
    });
  }

  if (command === "validate") {
    const items = await datasetFromArg(args);
    const errors = validateRecognitionDataset(items);
    const result = {
      ok: errors.length === 0,
      item_count: items.length,
      errors
    };
    if (!result.ok && !output) {
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    if (!result.ok) process.exitCode = 1;
    return writeJson(output, result);
  }

  if (command === "split") {
    const items = await datasetFromArg(args);
    const splitItems = assignRecognitionSplits(items);
    return writeJson(output, {
      schema_version: "recognition-split-manifest-v1",
      generated_at: new Date().toISOString(),
      items: splitItems
    });
  }

  if (command === "leakage") {
    const items = await datasetFromArg(args);
    const leaks = detectRecognitionLeakage(items);
    const result = {
      ok: leaks.length === 0,
      leak_count: leaks.length,
      leaks
    };
    if (!result.ok) process.exitCode = 1;
    return writeJson(output, result);
  }

  if (command === "stats") {
    const items = await datasetFromArg(args);
    return writeJson(output, recognitionDatasetStats(items));
  }

  if (command === "eval") {
    const items = await datasetFromArg(args);
    const variant = argValue(args, "--variant", "current");
    return writeJson(output, evaluateRecognitionDataset(items, { variant }));
  }

  if (command === "ablation") {
    const variantsDir = argValue(args, "--variants-dir");
    if (!variantsDir) throw new Error("Missing --variants-dir.");
    const manifest = await readJson(path.join(variantsDir, "manifest.json"));
    const variantRuns = {};
    for (const [variant, relativePath] of Object.entries(manifest.variants || {})) {
      variantRuns[variant] = await readRecognitionDatasetFile(path.join(variantsDir, relativePath));
    }
    return writeJson(output, evaluateRecognitionAblation(variantRuns));
  }

  throw new Error(`Unknown recognition dataset command: ${command || "(missing)"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRecognitionDatasetCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
