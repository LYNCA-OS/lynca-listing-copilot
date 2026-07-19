#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { main as runLaunchGate } from "./run-launch-gate-eval.mjs";

const execFile = promisify(execFileCallback);

export const PINNED_VERCEL_CLI_VERSION = "54.14.5";

function cleanText(value) {
  return String(value || "").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export function extractProtectionBypass(trace = "") {
  const match = String(trace).match(/x-vercel-protection-bypass:\s*([A-Za-z0-9_-]+)/i);
  if (!match?.[1]) throw new Error("Vercel CLI did not provide an automation protection bypass.");
  return match[1];
}

export function assertProtectedCandidateConfig(argv = []) {
  const baseUrl = cleanText(argValue(argv, "--base-url"));
  const expectedDeploymentId = cleanText(argValue(argv, "--expected-deployment-id"));
  if (!baseUrl) throw new Error("--base-url is required.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app")) {
    throw new Error("Protected launch gates must target an immutable *.vercel.app candidate URL.");
  }
  if (!/^dpl_[A-Za-z0-9]+$/.test(expectedDeploymentId)) {
    throw new Error("--expected-deployment-id must pin the immutable candidate deployment.");
  }
  for (const forbidden of ["--username", "--password"]) {
    if (argv.includes(forbidden)) throw new Error(`${forbidden} is forbidden; provide login credentials through the environment.`);
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), expectedDeploymentId };
}

async function assertPinnedVercelCli(vercelBin, execFileImpl) {
  const { stdout = "", stderr = "" } = await execFileImpl(vercelBin, ["--version"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  const observed = `${stdout}\n${stderr}`.match(/(?:Vercel CLI\s+)?(\d+\.\d+\.\d+)/i)?.[1] || "";
  if (observed !== PINNED_VERCEL_CLI_VERSION) {
    throw new Error(`Vercel CLI drift: expected ${PINNED_VERCEL_CLI_VERSION}, observed ${observed || "unknown"}. Run npm ci.`);
  }
}

export async function acquireProtectionBypass({
  baseUrl,
  vercelBin = "vercel",
  execFileImpl = execFile
} = {}) {
  await assertPinnedVercelCli(vercelBin, execFileImpl);
  const tempRoot = await mkdtemp(join(tmpdir(), "lynca-vercel-protection-"));
  const tracePath = join(tempRoot, "trace");
  const bodyPath = join(tempRoot, "health.json");
  try {
    await execFileImpl(vercelBin, [
      "curl",
      "/api/v4/health",
      "--deployment",
      baseUrl,
      "--trace-ascii",
      tracePath,
      "--output",
      bodyPath,
      "--silent",
      "--show-error",
      "--fail-with-body"
    ], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });
    const bypassSecret = extractProtectionBypass(await readFile(tracePath, "utf8"));
    JSON.parse(await readFile(bodyPath, "utf8"));
    return bypassSecret;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { baseUrl } = assertProtectedCandidateConfig(argv);
  const bypassSecret = await acquireProtectionBypass({
    baseUrl,
    vercelBin: dependencies.vercelBin,
    execFileImpl: dependencies.execFileImpl
  });
  return (dependencies.runLaunchGate || runLaunchGate)(argv, {
    ...env,
    VERCEL_AUTOMATION_BYPASS_SECRET: bypassSecret
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Protected candidate launch gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
