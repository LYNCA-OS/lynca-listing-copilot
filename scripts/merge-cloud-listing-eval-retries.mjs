import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rebuildCloudListingEvalReport } from "./evaluate-cloud-listing-api.mjs";

function argValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

export async function main(argv = process.argv) {
  const basePath = argValues(argv, "--base")[0];
  const retryPaths = argValues(argv, "--retry");
  const outPath = argValues(argv, "--out")[0];
  if (!basePath || !retryPaths.length || !outPath) {
    throw new Error("Usage: node scripts/merge-cloud-listing-eval-retries.mjs --base <report.json> --retry <retry.json> [--retry <retry.json>] --out <merged.json>");
  }

  const [baseReport, ...retryReports] = await Promise.all([
    readJson(basePath),
    ...retryPaths.map(readJson)
  ]);
  const merged = rebuildCloudListingEvalReport(baseReport, retryReports);
  await writeFile(resolve(outPath), `${JSON.stringify(merged, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    out: resolve(outPath),
    attempted_count: merged.attempted_count,
    provider_success_count: merged.provider_success_count,
    technical_failure_count: merged.technical_failure_count,
    retry_recovery: merged.retry_recovery
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
