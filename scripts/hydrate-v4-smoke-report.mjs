#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateV4SmokeReport } from "./v4-ebay-smoke.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

export async function main(argv = process.argv, env = process.env) {
  const inputArg = argValue(argv, "--input", "");
  if (!inputArg) throw new Error("--input is required");
  const inputPath = resolve(inputArg);
  const outputPath = resolve(argValue(argv, "--out", inputPath));
  const report = JSON.parse(await readFile(inputPath, "utf8"));
  const hydrated = await hydrateV4SmokeReport({
    report,
    baseUrl: argValue(argv, "--base-url", env.API_BASE_URL || report.base_url || "https://listing.lyncafei.team").replace(/\/+$/, ""),
    username: argValue(argv, "--username", env.METAVERSE_USERNAME || ""),
    password: argValue(argv, "--password", env.METAVERSE_PASSWORD || ""),
    requestTimeoutMs: Number(argValue(argv, "--request-timeout-ms", "90000")),
    concurrency: Number(argValue(argv, "--concurrency", "4"))
  });
  await writeFile(outputPath, `${JSON.stringify(hydrated, null, 2)}\n`);
  process.stdout.write([
    `hydrated_report=${outputPath}`,
    `requested=${hydrated.diagnostic_hydration.requested_count}`,
    `hydrated=${hydrated.diagnostic_hydration.hydrated_count}`,
    `failed=${hydrated.diagnostic_hydration.failed_count}`,
    `node_ledgers=${hydrated.summary.pipeline_node_observability.ledger_present_count}/${hydrated.summary.attempted_count}`
  ].join("\n") + "\n");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`V4 smoke report hydration failed: ${error.message}`);
    process.exit(1);
  }
}
