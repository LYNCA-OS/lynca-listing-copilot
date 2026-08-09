import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  open,
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
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function execFileText(command, args, { cwd, execFileImpl = execFile } = {}) {
  return new Promise((resolvePromise, reject) => {
    execFileImpl(command, args, { cwd, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error); else resolvePromise(String(stdout || ""));
    });
  });
}

export async function cleanCommittedSourceState(repositoryRoot, options = {}) {
  const [head, status] = await Promise.all([
    execFileText("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, ...options }),
    execFileText("git", ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: repositoryRoot, ...options })
  ]);
  const headSha = head.trim();
  if (!/^[0-9a-f]{40}$/.test(headSha) || status !== "") {
    throw new Error("compact_v4_source_checkout_not_clean_committed");
  }
  return { head_sha: headSha, clean: true, status_porcelain_sha256: sha256(status) };
}

export function deploymentOrigin(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".vercel.app")) {
    throw new Error("preview_deployment_url_invalid");
  }
  return parsed.origin;
}

const defaultAtomicIo = Object.freeze({ open, rename, unlink });

export async function writeJsonAtomic(path, value, { io = defaultAtomicIo } = {}) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let fileHandle = null;
  let directoryHandle = null;
  try {
    fileHandle = await io.open(temporary, "wx", 0o600);
    await fileHandle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;
    await io.rename(temporary, path);
    directoryHandle = await io.open(dirname(path), "r");
    await directoryHandle.sync();
    await directoryHandle.close();
    directoryHandle = null;
  } catch (error) {
    await fileHandle?.close().catch(() => {});
    await directoryHandle?.close().catch(() => {});
    await io.unlink(temporary).catch(() => {});
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

export function durableJsonWriter(path, options = {}) {
  let tail = Promise.resolve();
  return async (value) => {
    const snapshot = structuredClone(value);
    tail = tail.then(() => writeJsonAtomic(path, snapshot, options));
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

export async function invokePreview({ deployment, body, runToken }) {
  const secretDirectory = await mkdtemp(join(tmpdir(), "lynca-cloud-sim-header-"));
  const headerPath = join(secretDirectory, "header.txt");
  await writeFile(headerPath, `x-lynca-cloud-sim-token: ${runToken}\n`, {
    flag: "wx",
    mode: 0o600
  });
  const args = [
    "curl", "/api/accuracy", "--deployment", deployment, "--",
    "--silent", "--show-error", "--max-time", "150", "--request", "POST",
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

function childResult(spawnImpl, command, args, options) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnImpl(command, args, options); }
    catch (error) { resolve({ code: null, stdout: "", error }); return; }
    const stdout = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.once("error", (error) => resolve({ code: null, stdout: "", error }));
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8") }));
  });
}

export async function runTokenFromKeychain({ spawnImpl = spawn } = {}) {
  const keychain = await childResult(spawnImpl, "security", [
      "find-generic-password",
      "-a", "lynca-cloud-sim",
      "-s", "lynca-cloud-sim-preview-run-token",
      "-w"
    ], { stdio: ["ignore", "pipe", "ignore"] });
  const keychainToken = keychain.stdout.trim();
  if (keychain.code === 0 && keychainToken) return keychainToken;
  throw new Error("cloud_sim_run_token_unavailable");
}
