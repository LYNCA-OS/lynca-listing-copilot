import { spawnSync } from "node:child_process";
import fs from "node:fs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe"
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "command failed").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout || "").trim();
}

function requireCleanMain() {
  const branch = run("git", ["branch", "--show-current"]);
  if (branch !== "main") throw new Error(`Production deploy requires main, received ${branch || "detached HEAD"}`);

  const dirty = run("git", ["status", "--porcelain"]);
  if (dirty) throw new Error("Production deploy requires a clean worktree");

  const sha = run("git", ["rev-parse", "HEAD"]);
  const originSha = run("git", ["rev-parse", "origin/main"]);
  if (sha !== originSha) throw new Error("Production deploy requires HEAD to match origin/main");
  return { branch, sha };
}

function assertSecretExclusion() {
  const ignore = fs.readFileSync(new URL("../.vercelignore", import.meta.url), "utf8");
  if (!/^\.secrets\/\*\*$/m.test(ignore)) {
    throw new Error(".vercelignore must exclude .secrets/** before production deploy");
  }
}

const dryRun = process.argv.includes("--dry-run");
assertSecretExclusion();
const release = requireCleanMain();
const args = [
  "deploy",
  "--prod",
  "--yes",
  "--env",
  `LYNCA_RELEASE_GIT_SHA=${release.sha}`,
  "--env",
  `LYNCA_RELEASE_GIT_REF=${release.branch}`
];

if (dryRun) {
  console.log(JSON.stringify({ ok: true, dry_run: true, release, command: ["vercel", ...args] }, null, 2));
} else {
  run(process.env.VERCEL_CLI || "vercel", args, { inherit: true });
}
