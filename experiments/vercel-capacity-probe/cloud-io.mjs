import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const labRoot = dirname(fileURLToPath(import.meta.url));

export function deploymentOrigin(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".vercel.app")) {
    throw new Error("preview_deployment_url_invalid");
  }
  return parsed.origin;
}

export async function writeJsonAtomic(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function durableJsonWriter(path) {
  let tail = Promise.resolve();
  return async (value) => {
    const snapshot = structuredClone(value);
    tail = tail.then(() => writeJsonAtomic(path, snapshot));
    await tail;
  };
}

export async function acquireCheckpointLock(path) {
  const lockPath = `${path}.lock`;
  try {
    await writeFile(lockPath, `${JSON.stringify({
      pid: process.pid,
      created_at: new Date().toISOString()
    })}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("cloud_checkpoint_lock_exists");
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  };
}

export async function invokePreview({
  deployment,
  body,
  runToken,
  apiPath = "/api/accuracy",
  maxTimeSeconds = 150
}) {
  if (!["/api/accuracy", "/api/prompt-cache"].includes(apiPath)) {
    throw new Error("preview_api_path_invalid");
  }
  if (!Number.isInteger(maxTimeSeconds) || maxTimeSeconds < 1 || maxTimeSeconds > 295) {
    throw new Error("preview_max_time_invalid");
  }
  const secretDirectory = await mkdtemp(join(tmpdir(), "lynca-cloud-sim-header-"));
  const headerPath = join(secretDirectory, "header.txt");
  await writeFile(headerPath, `x-lynca-cloud-sim-token: ${runToken}\n`, {
    flag: "wx",
    mode: 0o600
  });
  const args = [
    "curl", apiPath, "--deployment", deployment, "--",
    "--silent", "--show-error", "--max-time", String(maxTimeSeconds), "--request", "POST",
    "--header", "content-type: application/json",
    "--header", `@${headerPath}`,
    "--data-binary", "@-"
  ];
  const childEnvironment = { ...process.env };
  delete childEnvironment.LYNCA_CLOUD_SIM_RUN_TOKEN;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("vercel", args, {
        cwd: labRoot,
        env: childEnvironment,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout = [];
      const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8")
            .replace(/https?:\/\/\S+/g, "[redacted-url]")
            .replace(/x-lynca-cloud-sim-token:\s*\S+/gi, "x-lynca-cloud-sim-token: [redacted]")
            .slice(-600);
          reject(new Error(`preview_transport_ambiguous:${code}:${detail}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
        } catch {
          reject(new Error("preview_response_non_json_ambiguous"));
        }
      });
      child.stdin.end(JSON.stringify(body));
    });
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

export async function runTokenFromKeychain() {
  return new Promise((resolve, reject) => {
    const child = spawn("security", [
      "find-generic-password",
      "-a", "lynca-cloud-sim",
      "-s", "lynca-cloud-sim-preview-run-token",
      "-w"
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const token = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0 || !token) reject(new Error("cloud_sim_run_token_keychain_missing"));
      else resolve(token);
    });
  });
}
