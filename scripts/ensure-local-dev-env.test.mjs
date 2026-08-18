import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/ensure-local-dev-env.mjs");
const localPath = join(root, ".env.local");

function envKeys(source) {
  return new Set(
    String(source)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.slice(0, line.indexOf("=")).trim())
  );
}

function runEnsure() {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

const first = runEnsure();
assert.match(first, /\.env\.local/);
assert.equal(existsSync(localPath), true);

const exampleKeys = envKeys(readFileSync(join(root, ".env.example"), "utf8"));
const localSource = readFileSync(localPath, "utf8");
const localKeys = envKeys(localSource);
for (const key of exampleKeys) {
  assert.equal(localKeys.has(key), true, `missing ${key}`);
}

assert.match(localSource, /^METAVERSE_USERNAME=listing$/m);
assert.doesNotMatch(localSource, /^METAVERSE_AUTH_SECRET=replace-with-a-long-random-secret$/m);
assert.doesNotMatch(localSource, /^CRON_SECRET=replace-with-a-long-random-cron-secret$/m);
assert.doesNotMatch(localSource, /^LISTING_IMAGE_VERIFICATION_SECRET=$/m);
assert.doesNotMatch(localSource, /replace-with-a-long-random/);

const second = runEnsure();
assert.equal(second, ".env.local already present");
assert.equal(readFileSync(localPath, "utf8"), localSource);

console.log("ensure-local-dev-env tests passed");
