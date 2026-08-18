#!/usr/bin/env node
import { runDualConsumerDryRun } from "../lib/listing/evaluation/dual-consumer-comparison.mjs";

const argv = process.argv.slice(2);
if (!argv.includes("--dry-run")) {
  process.stderr.write("Usage: node scripts/dual-consumer-comparison.mjs --dry-run\n");
  process.stderr.write("Live provider execution is not available from this CLI. CI stays offline.\n");
  process.exit(2);
}

const comparison = runDualConsumerDryRun();
process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
