import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runListingImageRetentionCleanup,
  summarizeListingImageRetentionCleanup
} from "../lib/listing/storage/storage-retention.mjs";

function loadLocalEnv() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const apply = process.argv.includes("--apply");

loadLocalEnv();

try {
  const result = await runListingImageRetentionCleanup({
    dryRun: !apply
  });
  console.log(JSON.stringify(summarizeListingImageRetentionCleanup(result), null, 2));
  if (!apply && result.enabled && !result.skipped) {
    console.log("Dry run only. Re-run with --apply to delete expired objects.");
  }
} catch (error) {
  console.error(error.message || "Storage retention cleanup failed.");
  process.exitCode = 1;
}
