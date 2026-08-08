import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("./deploy-production-release.mjs", import.meta.url));
const result = spawnSync(process.execPath, [entrypoint], {
  encoding: "utf8",
  env: { ...process.env, VERCEL_CLI: "must-not-be-executed" }
});

assert.notEqual(result.status, 0, "the retired local production deploy must fail closed");
const refusal = JSON.parse(result.stderr);
assert.equal(refusal.code, "DIRECT_PRODUCTION_DEPLOY_RETIRED");
assert.equal(refusal.workflow, ".github/workflows/deploy-production.yml");
assert.match(fs.readFileSync(".vercelignore", "utf8"), /^\.secrets\/\*\*$/m,
  "Git-backed production builds must continue to exclude local secrets");

console.log("production deploy release tests passed");
