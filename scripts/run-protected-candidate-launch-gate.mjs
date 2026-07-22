#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { main as runLaunchGate } from "./run-launch-gate-eval.mjs";

const execFile = promisify(execFileCallback);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

export function assertCredentialEnvironment(env = {}) {
  if (!cleanText(env.METAVERSE_USERNAME) || !cleanText(env.METAVERSE_PASSWORD)) {
    throw new Error("METAVERSE_USERNAME and METAVERSE_PASSWORD must be injected through the process environment.");
  }
  return true;
}

async function assertPinnedVercelCli(vercelBin, execFileImpl) {
  const { stdout = "", stderr = "" } = await execFileImpl(vercelBin, ["--version"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  const observed = `${stdout}\n${stderr}`.match(/(?:Vercel CLI\s+)?(\d+\.\d+\.\d+)/i)?.[1] || "";
  if (observed !== PINNED_VERCEL_CLI_VERSION) {
    throw new Error(`Vercel CLI drift: expected ${PINNED_VERCEL_CLI_VERSION}, observed ${observed || "unknown"}. Run npm ci.`);
  }
}

function protectionBypassRetryable(error) {
  if (error?.killed === true || error?.signal === "SIGTERM") return true;
  const text = String(error?.stderr || error?.stdout || error?.message || error || "");
  return /(?:connection reset|recv failure|curl:\s*\((?:6|7|18|28|35|52|56)\)|econnreset|etimedout|socket hang up|http[_ ]5\d\d)/i.test(text);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
    for (let attempt = 1; attempt <= 3; attempt += 1) {
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
          "--fail-with-body",
          "--yes"
        ], {
          cwd: projectRoot,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024
        });
        break;
      } catch (error) {
        if (attempt >= 3 || !protectionBypassRetryable(error)) throw error;
        await wait(attempt * 750);
      }
    }
    const bypassSecret = extractProtectionBypass(await readFile(tracePath, "utf8"));
    JSON.parse(await readFile(bodyPath, "utf8"));
    return bypassSecret;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { baseUrl } = assertProtectedCandidateConfig(argv);
  assertCredentialEnvironment(env);
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
