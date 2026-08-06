#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const context = JSON.parse(await readFile(
  join(repoRoot, "docs/operations/active-service-context.json"),
  "utf8"
));

function parseOptions(argv) {
  const allowed = new Set(["--payload", "--deployment", "--concurrency", "--out"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key)) throw new Error("unsupported_option");
    if (!value || value.startsWith("--")) throw new Error("option_value_required");
    if (Object.hasOwn(values, key)) throw new Error("duplicate_option");
    values[key] = value;
  }
  return values;
}

function requiredInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error(`${label}_must_be_between_1_and_500`);
  }
  return parsed;
}

function canonicalDeployment(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".vercel.app")) {
    throw new Error("deployment_url_invalid");
  }
  return parsed.origin;
}

async function writeJsonAtomic(outPath, value) {
  const temp = join(dirname(outPath), `.${basename(outPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, outPath);
    await chmod(outPath, 0o600);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

async function vercelCurl({ deployment, payload }) {
  const labCwd = context.vercel.capacity_lab.cwd;
  if (await fileURLToPath(pathToFileURL(labCwd)) !== labCwd) throw new Error("capacity_lab_cwd_invalid");
  const args = [
    "curl", "/api/control", "--deployment", deployment, "--",
    "--silent", "--show-error", "--max-time", "360", "--request", "POST",
    "--header", "content-type: application/json", "--data-binary", "@-"
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("vercel", args, {
      cwd: labCwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        const sanitized = Buffer.concat(stderr).toString("utf8")
          .replace(/https?:\/\/\S+/g, "[redacted-url]")
          .slice(-800);
        reject(new Error(`vercel_curl_failed_${code}:${sanitized}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function runHostedCapacityArm({ payloadPath, deployment, concurrency, outPath }) {
  const payload = JSON.parse(await readFile(payloadPath, "utf8"));
  if (payload.mode !== "vision_canonical") throw new Error("canonical_payload_required");
  if (!Array.isArray(payload.assets) || payload.assets.length !== 150) throw new Error("exactly_150_assets_required");
  const effectiveConcurrency = requiredInteger(concurrency, "concurrency");
  const responseText = await vercelCurl({
    deployment: canonicalDeployment(deployment),
    payload: { ...payload, concurrency: effectiveConcurrency }
  });
  const report = JSON.parse(responseText);
  if (report.request_kind !== "canonical_card_fields" || report.tasks !== 150) {
    throw new Error("hosted_report_contract_invalid");
  }
  await writeJsonAtomic(outPath, report);
  return {
    concurrency: report.concurrency,
    succeeded: report.succeeded_count,
    failed: report.failed_count,
    wall_ms: report.wall_ms,
    throughput_per_minute: report.throughput_per_minute,
    latency_p50_ms: report.latency_p50_ms,
    latency_p95_ms: report.latency_p95_ms,
    latency_max_ms: report.latency_max_ms,
    input_tokens: report.input_tokens,
    cached_input_tokens: report.cached_input_tokens,
    uncached_input_tokens: report.uncached_input_tokens,
    output_tokens: report.output_tokens,
    minimum_request_remaining: report.minimum_request_remaining,
    minimum_token_remaining: report.minimum_token_remaining
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const summary = await runHostedCapacityArm({
    payloadPath: options["--payload"],
    deployment: options["--deployment"],
    concurrency: options["--concurrency"],
    outPath: options["--out"]
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || "hosted_capacity_arm_failed").slice(0, 1000)}\n`);
    process.exitCode = 1;
  });
}
