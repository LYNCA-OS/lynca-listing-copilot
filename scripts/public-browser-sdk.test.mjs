import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(process.execPath, ["scripts/build-public-browser-sdk.mjs", "--check"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  encoding: "utf8"
});

assert.equal(result.status, 0, result.stderr || result.stdout || "public browser SDK check failed");
console.log("public browser SDK tests passed");
