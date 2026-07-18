#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const LOCK_PATH = path.join(REPO_ROOT, "maintenance", "harness-handbook.lock.json");
const REQUIRED_PACKAGE_SCRIPTS = Object.freeze([
  "maintenance:handbook:check",
  "maintenance:handbook:test",
  "maintenance:handbook:bootstrap",
  "maintenance:handbook:phase1",
  "maintenance:handbook:full",
]);
const SOURCE_EXTENSIONS = /\.(?:[cm]?js|tsx?)$/i;
const RUNTIME_ROOTS = new Set(["api", "app", "lib", "scripts"]);

function fail(message) {
  throw new Error(`[harness-handbook] ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio || "pipe",
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || ""}`.trim().slice(-4000);
    fail(`${command} exited ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return `${result.stdout || ""}`.trim();
}

function parseCli(argv) {
  const [command = "check", ...rest] = argv;
  const options = {
    command,
    phase: "1",
    profile: "runtime",
    allowLlm: false,
    workDir: "",
    cacheDir: "",
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--allow-llm") options.allowLlm = true;
    else if (token === "--phase") options.phase = rest[++index] || "";
    else if (token === "--profile") options.profile = rest[++index] || "";
    else if (token === "--work-dir") options.workDir = rest[++index] || "";
    else if (token === "--cache-dir") options.cacheDir = rest[++index] || "";
    else fail(`unknown argument: ${token}`);
  }
  return options;
}

export function loadHandbookLock(repoRoot = REPO_ROOT) {
  const lock = readJson(path.join(repoRoot, "maintenance", "harness-handbook.lock.json"));
  if (lock.schema_version !== 1) fail("unsupported lock schema");
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(lock.upstream_repository || "")) {
    fail("upstream_repository must be an HTTPS GitHub clone URL");
  }
  if (!/^[0-9a-f]{40}$/.test(lock.upstream_commit || "")) fail("upstream_commit must be a full commit SHA");
  if (lock.integration_mode !== "PINNED_EXTERNAL_TOOL_NO_VENDORED_SOURCE") fail("unsafe integration mode");
  if (lock.license_status !== "NO_LICENSE_FILE_AT_PIN") fail("license boundary changed; review before continuing");
  if (lock.privacy?.default_mode !== "STATIC_LOCAL_ONLY") fail("static local mode must remain the default");
  if (lock.privacy?.llm_phases_require_explicit_opt_in !== true) fail("LLM phases must remain opt-in");
  return lock;
}

export function phaseNeedsLlm(phase) {
  const phases = `${phase || ""}`.toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
  return phases.length === 0 || phases.some((value) => value !== "1");
}

function sourceProfileAllows(file, profile) {
  if (!SOURCE_EXTENSIONS.test(file)) return false;
  if (file.includes(",") || file.includes("\n")) fail(`unsupported source path: ${file}`);
  if (profile === "full") return true;
  if (profile !== "runtime") fail(`unknown source profile: ${profile}`);
  if (file === "middleware.js") return true;
  const [root] = file.split("/");
  if (!RUNTIME_ROOTS.has(root)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file)) return false;
  if (file.startsWith("prototypes/")) return false;
  return true;
}

export function collectSourceFiles(repoRoot = REPO_ROOT, profile = "runtime") {
  const output = runSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: repoRoot });
  return [...new Set(output.split("\n").map((value) => value.trim()).filter(Boolean))]
    .filter((file) => sourceProfileAllows(file, profile))
    .sort();
}

export function buildHandbookArgs({ lock, generatorRoot, sourceRoot, sourceFiles, workDir, phase = "1" }) {
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) fail("source inventory is empty");
  return [
    path.join(generatorRoot, lock.generator_entrypoint),
    "--lang", lock.source_language,
    "--source-root", sourceRoot,
    "--files", sourceFiles.join(","),
    "--work-dir", workDir,
    "--phase", phase,
  ];
}

function resolveCache(lock, requestedCacheDir = "") {
  const musicianRoot = path.join("/Volumes", "musician");
  const musicianCache = path.join(musicianRoot, ".cache", "lynca-listing-copilot", "harness-handbook");
  const base = path.resolve(
    requestedCacheDir
      || process.env.HARNESS_HANDBOOK_CACHE_DIR
      || (fs.existsSync(musicianRoot) ? musicianCache : "")
      || path.join(os.homedir(), ".cache", "lynca-listing-copilot", "harness-handbook"),
  );
  const short = lock.upstream_commit.slice(0, 12);
  return {
    base,
    sourceDir: path.join(base, "source", short),
    venvDir: path.join(base, "venv", short),
  };
}

function findPython() {
  const candidates = [
    process.env.HARNESS_HANDBOOK_PYTHON,
    "/usr/bin/python3",
    "/opt/homebrew/bin/python3",
    "python3",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-c", "import sys; assert sys.version_info >= (3, 9)"], { stdio: "ignore" });
    if (!result.error && result.status === 0) return candidate;
  }
  fail("Python 3.9+ is required; set HARNESS_HANDBOOK_PYTHON");
}

function pythonInVenv(venvDir) {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function ensurePinnedSource(lock, sourceDir) {
  fs.mkdirSync(sourceDir, { recursive: true });
  if (!fs.existsSync(path.join(sourceDir, ".git"))) {
    runSync("git", ["init"], { cwd: sourceDir });
    runSync("git", ["remote", "add", "origin", lock.upstream_repository], { cwd: sourceDir });
  }
  const remote = runSync("git", ["remote", "get-url", "origin"], { cwd: sourceDir });
  if (remote !== lock.upstream_repository) fail(`cache remote mismatch: ${remote}`);
  let head = "";
  try {
    head = runSync("git", ["rev-parse", "HEAD"], { cwd: sourceDir });
  } catch {
    head = "";
  }
  if (head !== lock.upstream_commit) {
    runSync("git", ["fetch", "--depth=1", "origin", lock.upstream_commit], { cwd: sourceDir, stdio: "inherit" });
    runSync("git", ["checkout", "--detach", lock.upstream_commit], { cwd: sourceDir, stdio: "inherit" });
  }
  const verified = runSync("git", ["rev-parse", "HEAD"], { cwd: sourceDir });
  if (verified !== lock.upstream_commit) fail(`pinned checkout verification failed: ${verified}`);
  const dirty = runSync("git", ["status", "--porcelain"], { cwd: sourceDir });
  if (dirty) fail("pinned upstream cache is dirty");
  const unexpectedLicense = ["LICENSE", "LICENSE.md", "COPYING"]
    .filter((name) => fs.existsSync(path.join(sourceDir, name)));
  if (unexpectedLicense.length > 0) fail("upstream license state changed; review and update the lock deliberately");
}

function ensureVenv(lock, venvDir) {
  const requirementsPath = path.join(REPO_ROOT, lock.requirements_file);
  const requirementsHash = sha256(fs.readFileSync(requirementsPath));
  const markerPath = path.join(venvDir, ".lynca-requirements.sha256");
  let python = pythonInVenv(venvDir);
  if (!fs.existsSync(python)) {
    fs.mkdirSync(path.dirname(venvDir), { recursive: true });
    runSync(findPython(), ["-m", "venv", venvDir], { stdio: "inherit" });
  }
  python = pythonInVenv(venvDir);
  const currentHash = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : "";
  if (currentHash !== requirementsHash) {
    runSync(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", requirementsPath], { stdio: "inherit" });
    fs.writeFileSync(markerPath, `${requirementsHash}\n`, "utf8");
  }
  const shimDir = path.dirname(path.join(REPO_ROOT, lock.compatibility_shim));
  const env = { ...process.env, PYTHONPATH: [shimDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
  runSync(python, [
    "-c",
    "from tree_sitter_language_pack import get_parser; n=get_parser('typescript').parse(b'function f(){}').root_node; assert n.kind == 'program'; assert n.start_position.row == 0; assert n.end_position.row == 0",
  ], { env });
  return { python, env };
}

export function checkIntegration(repoRoot = REPO_ROOT) {
  const lock = loadHandbookLock(repoRoot);
  for (const relativePath of [lock.requirements_file, lock.compatibility_shim, "docs/operations/HARNESS-HANDBOOK.md"]) {
    if (!fs.existsSync(path.join(repoRoot, relativePath))) fail(`missing integration file: ${relativePath}`);
  }
  const packageJson = readJson(path.join(repoRoot, "package.json"));
  for (const script of REQUIRED_PACKAGE_SCRIPTS) {
    if (!packageJson.scripts?.[script]) fail(`missing package script: ${script}`);
  }
  const runtimeFiles = collectSourceFiles(repoRoot, lock.default_profile);
  if (!runtimeFiles.includes("lib/listing/v4/pipeline/native-recognition-core.mjs")) {
    fail("runtime profile does not include the native V4 recognition core");
  }
  return {
    upstream_commit: lock.upstream_commit,
    integration_mode: lock.integration_mode,
    default_mode: lock.privacy.default_mode,
    runtime_source_count: runtimeFiles.length,
  };
}

async function bootstrap(options) {
  const lock = loadHandbookLock();
  const cache = resolveCache(lock, options.cacheDir);
  ensurePinnedSource(lock, cache.sourceDir);
  const runtime = ensureVenv(lock, cache.venvDir);
  return { lock, cache, ...runtime };
}

export function runLogged(command, args, { cwd, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "w");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      fs.closeSync(logFd);
      if (error) reject(error);
      else resolve();
    };
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", logFd, logFd] });
    child.once("error", finish);
    child.on("exit", (code, signal) => {
      finish(code === 0 ? null : new Error(`generator exited ${code ?? signal}; inspect ${logPath}`));
    });
  });
}

function readGraphSummary(workDir) {
  const graphPath = path.join(workDir, "phase1", "graph.json");
  if (!fs.existsSync(graphPath)) fail(`missing phase 1 graph: ${graphPath}`);
  const graph = readJson(graphPath);
  return {
    graph_path: path.relative(workDir, graphPath),
    scanned_file_count: graph.metadata?.scanned_files?.length || 0,
    internal_function_count: graph.metadata?.n_internal_functions || 0,
    boundary_node_count: graph.metadata?.n_boundary_nodes || 0,
    edge_count: graph.metadata?.n_edges || 0,
  };
}

async function runHandbook(options) {
  const needsLlm = phaseNeedsLlm(options.phase);
  if (needsLlm && (!options.allowLlm || process.env.HARNESS_HANDBOOK_ALLOW_LLM !== "1")) {
    fail("phase 2/3 sends source-derived content to an LLM; require both --allow-llm and HARNESS_HANDBOOK_ALLOW_LLM=1");
  }
  if (needsLlm && !(process.env.HANDBOOK_LLM_API_KEY || process.env.OPENAI_API_KEY)) {
    fail("LLM phase requested but HANDBOOK_LLM_API_KEY/OPENAI_API_KEY is absent");
  }
  const runtime = await bootstrap(options);
  const sourceFiles = collectSourceFiles(REPO_ROOT, options.profile);
  const repoHead = runSync("git", ["rev-parse", "HEAD"]);
  const repoDirty = Boolean(runSync("git", ["status", "--porcelain"]));
  const workDir = path.resolve(
    options.workDir
      || path.join(REPO_ROOT, "artifacts", "maintenance-handbook", `${repoHead.slice(0, 12)}-${runtime.lock.upstream_commit.slice(0, 12)}-${options.profile}`),
  );
  fs.mkdirSync(workDir, { recursive: true });
  const args = buildHandbookArgs({
    lock: runtime.lock,
    generatorRoot: runtime.cache.sourceDir,
    sourceRoot: REPO_ROOT,
    sourceFiles,
    workDir,
    phase: options.phase,
  });
  const logPath = path.join(workDir, "generator.log");
  await runLogged(runtime.python, args, {
    cwd: runtime.cache.sourceDir,
    env: runtime.env,
    logPath,
  });
  const graph = readGraphSummary(workDir);
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    upstream_repository: runtime.lock.upstream_repository,
    upstream_commit: runtime.lock.upstream_commit,
    lynca_commit: repoHead,
    lynca_worktree_dirty: repoDirty,
    phase: options.phase,
    profile: options.profile,
    llm_enabled: needsLlm,
    source_inventory_count: sourceFiles.length,
    source_inventory_sha256: sha256(`${sourceFiles.join("\n")}\n`),
    graph,
  };
  fs.writeFileSync(path.join(workDir, "lynca-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const summary = [
    "# LYNCA Harness Handbook Summary",
    "",
    `- LYNCA commit: \`${repoHead}\`${repoDirty ? " (dirty worktree)" : ""}`,
    `- Harness Handbook commit: \`${runtime.lock.upstream_commit}\``,
    `- Mode: \`${needsLlm ? "LLM_OPT_IN" : "STATIC_LOCAL_ONLY"}\``,
    `- Source profile: \`${options.profile}\` (${sourceFiles.length} files)`,
    `- Parsed files: ${graph.scanned_file_count}`,
    `- Internal functions: ${graph.internal_function_count}`,
    `- Boundary nodes: ${graph.boundary_node_count}`,
    `- Edges: ${graph.edge_count}`,
    `- Generator log: \`${path.basename(logPath)}\``,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(workDir, "maintenance-summary.md"), summary, "utf8");
  return { workDir, manifest };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.command === "check") {
    console.log(JSON.stringify(checkIntegration(), null, 2));
    return;
  }
  if (options.command === "bootstrap") {
    const runtime = await bootstrap(options);
    console.log(JSON.stringify({
      upstream_commit: runtime.lock.upstream_commit,
      source_dir: runtime.cache.sourceDir,
      venv_dir: runtime.cache.venvDir,
      status: "READY",
    }, null, 2));
    return;
  }
  if (options.command === "run") {
    const result = await runHandbook(options);
    console.log(JSON.stringify({ status: "COMPLETE", ...result }, null, 2));
    return;
  }
  fail(`unknown command: ${options.command}`);
}

if (path.resolve(process.argv[1] || "") === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
