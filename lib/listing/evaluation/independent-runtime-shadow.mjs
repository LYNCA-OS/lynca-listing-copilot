import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const INDEPENDENT_RUNTIME_SHADOW_RECEIPT_SCHEMA =
  "independent-runtime-shadow-receipt-v1";
export const LYNCA_RUNTIME_REPO = "LYNCA-OS/lynca-runtime";
export const LYNCA_RUNTIME_PACKAGE_NAME = "lynca-runtime";
export const LYNCA_RUNTIME_PINNED_SHA = "8a75ff73aef9953e143a851d97977b33b35631bf";
export const LYNCA_RUNTIME_IDENTIFY_CLI = "bin/lynca.mjs";
export const LYNCA_RUNTIME_IDENTIFY_COMMAND = "identify";
export const LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED =
  "LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED";
export const LYNCA_RUNTIME_CHECKOUT = "LYNCA_RUNTIME_CHECKOUT";
export const LISTING_INDEPENDENT_RUNTIME_SHADOW_ALLOW_PROVIDER =
  "LISTING_INDEPENDENT_RUNTIME_SHADOW_ALLOW_PROVIDER";

const LISTING_COPILOT_PACKAGE_NAME = "lynca-listing-copilot";
const PROVIDER_ENV_KEYS = Object.freeze([
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_LYNCA",
  "ANTHROPIC_API_KEY",
  "AZURE_OPENAI_API_KEY"
]);
const WRITER_VISIBLE_KEYS = Object.freeze([
  "title",
  "listing_title",
  "canonical_title",
  "message",
  "error_type",
  "recognition_session_id",
  "review_required",
  "trace_status",
  "ok",
  "code"
]);

export class IndependentRuntimeShadowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IndependentRuntimeShadowError";
    this.code = code;
    this.details = details;
  }
}

export function explicitTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function isProductionDeployment(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  const vercelEnv = String(env.VERCEL_ENV || "").trim().toLowerCase();
  return nodeEnv === "production" || vercelEnv === "production";
}

export function isCiEnvironment(env = process.env) {
  return explicitTrue(env.CI) || explicitTrue(env.GITHUB_ACTIONS);
}

export function listingIndependentRuntimeShadowEnabled(env = process.env) {
  return decideIndependentRuntimeShadowEnablement(env).enabled;
}

export function decideIndependentRuntimeShadowEnablement(env = process.env) {
  if (isProductionDeployment(env)) {
    return Object.freeze({
      enabled: false,
      skip_code: "shadow_forbidden_in_production",
      detail: "Independent Runtime shadow must not run in NODE_ENV or VERCEL_ENV production."
    });
  }
  if (!explicitTrue(env[LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED])) {
    return Object.freeze({
      enabled: false,
      skip_code: "shadow_disabled",
      detail: `${LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED} defaults off and must be the exact non-production value true.`
    });
  }
  return Object.freeze({
    enabled: true,
    skip_code: null,
    detail: "Explicit non-production enablement."
  });
}

export function independentRuntimeShadowAllowsProvider(env = process.env) {
  if (isCiEnvironment(env)) return false;
  if (isProductionDeployment(env)) return false;
  return explicitTrue(env[LISTING_INDEPENDENT_RUNTIME_SHADOW_ALLOW_PROVIDER]);
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

function pathIsEphemeralTmp(absolutePath) {
  const normalized = absolutePath.split(sep).join("/");
  return normalized === "/tmp"
    || normalized === "/private/tmp"
    || normalized.startsWith("/tmp/")
    || normalized.startsWith("/private/tmp/");
}

function readPackageName(checkoutPath) {
  const packageJsonPath = resolvePath(checkoutPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_unreadable",
      `Runtime checkout has no package.json: ${packageJsonPath}. Absence is a failure, not an empty repository.`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_unreadable",
      `Runtime checkout package.json is unreadable: ${error.message}`
    );
  }
  const name = String(parsed?.name || "").trim();
  if (!name) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_unreadable",
      "Runtime checkout package.json has no name. Empty identity is a failure, not proof the repository is empty."
    );
  }
  return name;
}

async function gitHeadSha(checkoutPath) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: checkoutPath,
      timeout: 5_000,
      maxBuffer: 64 * 1024
    });
    const sha = String(stdout || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new IndependentRuntimeShadowError(
        "runtime_sha_unreadable",
        `Runtime checkout HEAD is not a 40-character SHA (${JSON.stringify(sha) || "empty"}). Empty git output is a failure, not an empty repository.`
      );
    }
    return sha;
  } catch (error) {
    if (error instanceof IndependentRuntimeShadowError) throw error;
    throw new IndependentRuntimeShadowError(
      "runtime_sha_unreadable",
      `Runtime checkout git rev-parse HEAD failed: ${error.message || error}`
    );
  }
}

export async function resolveIndependentRuntimeCheckout({
  checkoutPath,
  expectedSha = LYNCA_RUNTIME_PINNED_SHA,
  env = process.env
} = {}) {
  const requested = String(checkoutPath || env[LYNCA_RUNTIME_CHECKOUT] || "").trim();
  if (!requested) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_absent",
      `${LYNCA_RUNTIME_CHECKOUT} is unset. Independent Runtime shadow fails closed; it does not treat a missing checkout as an empty runtime.`
    );
  }
  const absolute = isAbsolute(requested) ? requested : resolvePath(requested);
  if (pathIsEphemeralTmp(absolute)) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_ephemeral_tmp",
      `Runtime checkout ${absolute} is under /tmp or /private/tmp. Those paths are not a source of truth.`
    );
  }
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_absent",
      `Runtime checkout does not exist as a directory: ${absolute}`
    );
  }
  const packageName = readPackageName(absolute);
  if (packageName === LISTING_COPILOT_PACKAGE_NAME) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_is_listing_copilot",
      "LYNCA_RUNTIME_CHECKOUT points at lynca-listing-copilot. That is the gamma-53 lie; the Runtime arm must be LYNCA-OS/lynca-runtime."
    );
  }
  if (packageName !== LYNCA_RUNTIME_PACKAGE_NAME) {
    throw new IndependentRuntimeShadowError(
      "runtime_checkout_not_lynca_runtime",
      `Runtime checkout package name is ${packageName}, expected ${LYNCA_RUNTIME_PACKAGE_NAME}.`
    );
  }
  const identifyCli = resolvePath(absolute, LYNCA_RUNTIME_IDENTIFY_CLI);
  if (!existsSync(identifyCli)) {
    throw new IndependentRuntimeShadowError(
      "runtime_identify_cli_absent",
      `Pinned Runtime identify CLI is missing: ${identifyCli}`
    );
  }
  const sha = await gitHeadSha(absolute);
  const expected = String(expectedSha || LYNCA_RUNTIME_PINNED_SHA).trim().toLowerCase();
  if (sha !== expected) {
    throw new IndependentRuntimeShadowError(
      "runtime_sha_mismatch",
      `Runtime checkout HEAD ${sha} does not match pinned origin/main ${expected}. Shadow does not float.`
    );
  }
  return Object.freeze({
    checkout_path: absolute,
    package_name: packageName,
    repo: LYNCA_RUNTIME_REPO,
    sha,
    identify_cli: identifyCli
  });
}

function childEnvWithoutProviderSecrets(env, { allowProvider }) {
  const childEnv = { ...env };
  if (allowProvider) return childEnv;
  for (const key of PROVIDER_ENV_KEYS) {
    if (key in childEnv) delete childEnv[key];
  }
  return childEnv;
}

export function spawnIndependentIdentifyProcess({
  execPath = process.execPath,
  cliPath,
  frontPath,
  backPath,
  cwd,
  env = process.env,
  timeoutMs = 15_000,
  allowProvider = false
}) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolvePromise(payload);
    };
    let child;
    try {
      child = spawn(execPath, [cliPath, LYNCA_RUNTIME_IDENTIFY_COMMAND, frontPath, backPath], {
        cwd,
        env: childEnvWithoutProviderSecrets(env, { allowProvider }),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish({
        exit_code: null,
        signal: null,
        stdout: "",
        stderr: String(error?.message || error),
        timed_out: false,
        elapsed_ms: Date.now() - started,
        spawn_error: String(error?.message || error)
      });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exit_code: null,
        signal: "SIGKILL",
        stdout,
        stderr,
        timed_out: true,
        elapsed_ms: Date.now() - started
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        exit_code: null,
        signal: null,
        stdout,
        stderr: stderr || String(error?.message || error),
        timed_out: false,
        elapsed_ms: Date.now() - started,
        spawn_error: String(error?.message || error)
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish({
        exit_code: code,
        signal,
        stdout,
        stderr,
        timed_out: false,
        elapsed_ms: Date.now() - started
      });
    });
  });
}

function inputHashesFromPaths(frontPath, backPath) {
  const hashes = {};
  for (const [role, path] of [["front", frontPath], ["back", backPath]]) {
    if (!path || !existsSync(path) || !statSync(path).isFile()) {
      hashes[role] = {
        path: path || null,
        present: false,
        sha256: null
      };
      continue;
    }
    hashes[role] = {
      path,
      present: true,
      sha256: sha256Bytes(readFileSync(path)),
      byte_length: statSync(path).size
    };
  }
  return hashes;
}

export function classifyIndependentIdentifyOutput({ exit_code, stdout, timed_out, spawn_error }) {
  if (spawn_error) return "runtime_spawn_failed";
  if (timed_out) return "runtime_identify_timeout";
  if (exit_code !== 0) return "runtime_identify_nonzero_exit";
  if (!String(stdout || "").trim()) return "runtime_output_empty";
  return null;
}

function baseReceipt(fields) {
  return Object.freeze({
    schema_version: INDEPENDENT_RUNTIME_SHADOW_RECEIPT_SCHEMA,
    writer_influence: false,
    production_authority_unchanged: true,
    ...fields
  });
}

export async function runIndependentRuntimeShadow({
  frontPath,
  backPath,
  env = process.env,
  expectedSha = LYNCA_RUNTIME_PINNED_SHA,
  timeoutMs = 15_000,
  spawnIdentify = spawnIndependentIdentifyProcess,
  listingSha = null
} = {}) {
  const enablement = decideIndependentRuntimeShadowEnablement(env);
  const inputHashes = inputHashesFromPaths(frontPath, backPath);
  if (!enablement.enabled) {
    return baseReceipt({
      ran: false,
      ok: false,
      skip_code: enablement.skip_code,
      failure_code: null,
      detail: enablement.detail,
      runtime_repo: LYNCA_RUNTIME_REPO,
      runtime_pinned_sha: expectedSha,
      listing_sha: listingSha,
      input_hashes: inputHashes,
      provider_attempts: 0,
      cost: null
    });
  }
  if (isCiEnvironment(env) && explicitTrue(env[LISTING_INDEPENDENT_RUNTIME_SHADOW_ALLOW_PROVIDER])) {
    return baseReceipt({
      ran: false,
      ok: false,
      skip_code: null,
      failure_code: "shadow_provider_forbidden_in_ci",
      detail: "CI must not fire unpaid provider calls. Independent Runtime shadow stays offline here.",
      runtime_repo: LYNCA_RUNTIME_REPO,
      runtime_pinned_sha: expectedSha,
      listing_sha: listingSha,
      input_hashes: inputHashes,
      provider_attempts: 0,
      cost: null
    });
  }
  if (!inputHashes.front.present || !inputHashes.back.present) {
    return baseReceipt({
      ran: false,
      ok: false,
      skip_code: null,
      failure_code: "shadow_input_absent",
      detail: "Approved front/back bytes are required. Missing inputs fail closed.",
      runtime_repo: LYNCA_RUNTIME_REPO,
      runtime_pinned_sha: expectedSha,
      listing_sha: listingSha,
      input_hashes: inputHashes,
      provider_attempts: 0,
      cost: null
    });
  }
  let checkout;
  try {
    checkout = await resolveIndependentRuntimeCheckout({ env, expectedSha });
  } catch (error) {
    const code = error instanceof IndependentRuntimeShadowError
      ? error.code
      : "runtime_checkout_unreadable";
    return baseReceipt({
      ran: false,
      ok: false,
      skip_code: null,
      failure_code: code,
      detail: error.message,
      runtime_repo: LYNCA_RUNTIME_REPO,
      runtime_pinned_sha: expectedSha,
      listing_sha: listingSha,
      input_hashes: inputHashes,
      provider_attempts: 0,
      cost: null
    });
  }
  const allowProvider = independentRuntimeShadowAllowsProvider(env);
  const spawned = await spawnIdentify({
    cliPath: checkout.identify_cli,
    frontPath,
    backPath,
    cwd: checkout.checkout_path,
    env,
    timeoutMs,
    allowProvider
  });
  const failureCode = classifyIndependentIdentifyOutput(spawned);
  return baseReceipt({
    ran: true,
    ok: failureCode === null,
    skip_code: null,
    failure_code: failureCode,
    detail: failureCode
      ? `Independent Runtime identify failed closed: ${failureCode}`
      : "Independent Runtime identify returned non-empty stdout.",
    runtime_repo: LYNCA_RUNTIME_REPO,
    runtime_package_name: checkout.package_name,
    runtime_sha: checkout.sha,
    runtime_pinned_sha: expectedSha,
    runtime_identify_cli: checkout.identify_cli,
    listing_sha: listingSha,
    input_hashes: inputHashes,
    provider_attempts: allowProvider ? null : 0,
    cost: null,
    allow_provider: allowProvider,
    exit_code: spawned.exit_code,
    signal: spawned.signal || null,
    timed_out: spawned.timed_out === true,
    elapsed_ms: spawned.elapsed_ms,
    stdout: String(spawned.stdout || ""),
    stderr: String(spawned.stderr || "").slice(0, 8_000)
  });
}

export function applyShadowReceiptWithoutMutatingWriter(writerResult, _receipt) {
  void _receipt;
  return writerResult;
}

export function assertShadowDidNotInfluenceWriter(writerBefore, writerAfter, receipt) {
  if (!Object.is(writerBefore, writerAfter)) {
    throw new Error("independent_runtime_shadow_mutated_writer_result_identity");
  }
  const beforeJson = JSON.stringify(writerBefore);
  const afterJson = JSON.stringify(writerAfter);
  if (beforeJson !== afterJson) {
    throw new Error("independent_runtime_shadow_mutated_writer_result");
  }
  if (receipt && receipt.writer_influence !== false) {
    throw new Error("independent_runtime_shadow_claimed_writer_influence");
  }
  for (const key of WRITER_VISIBLE_KEYS) {
    if (receipt && Object.hasOwn(receipt, "writer_" + key)) {
      throw new Error(`independent_runtime_shadow_writer_key_leaked:${key}`);
    }
  }
  return true;
}
