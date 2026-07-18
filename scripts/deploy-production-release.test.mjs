import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./deploy-production-release.mjs", import.meta.url), "utf8");
const ignore = fs.readFileSync(new URL("../.vercelignore", import.meta.url), "utf8");

assert.match(source, /branch !== "main"/);
assert.match(source, /Production deploy requires a clean worktree/);
assert.match(source, /origin\/main/);
assert.match(source, /LYNCA_RELEASE_GIT_SHA=/);
assert.match(source, /LYNCA_RELEASE_GIT_REF=/);
assert.match(ignore, /^\.secrets\/\*\*$/m);

console.log("production deploy release tests passed");
