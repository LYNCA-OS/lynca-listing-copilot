import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const defaultArtifactNames = new Set([
  "fresh-ebay-smoke-report",
  "unseen-ebay-soak-report",
  "concurrency-capacity-sweep",
  "provider-transport-ablation"
]);
const defaultDownloadConcurrency = 4;
const githubRequestTimeoutMs = 45_000;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function listArg(value = "") {
  return String(value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function errorDetail(error) {
  return cleanText(error?.cause?.code || error?.cause?.message || error?.message || error || "unknown_error");
}

async function runProcess(command, args, { input = "", maxBytes = 256 * 1024 * 1024 } = {}) {
  return await new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let rejected = false;
    const rejectOnce = (error) => {
      if (rejected) return;
      rejected = true;
      child.kill("SIGKILL");
      rejectProcess(error);
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) return rejectOnce(new Error(`${command} stdout exceeded ${maxBytes} bytes`));
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxBytes) return rejectOnce(new Error(`${command} stderr exceeded ${maxBytes} bytes`));
      stderr.push(chunk);
    });
    child.once("error", rejectOnce);
    child.stdin.once("error", rejectOnce);
    child.once("close", (code, signal) => {
      if (rejected) return;
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        rejectProcess(new Error(`${command} failed (${signal || code}): ${stderrText || "no stderr"}`));
        return;
      }
      resolveProcess({ stdout: Buffer.concat(stdout), stderr: stderrText });
    });
    child.stdin.end(input);
  });
}

function responseFromBuffer(buffer) {
  return {
    ok: true,
    status: 200,
    async json() {
      return JSON.parse(buffer.toString("utf8"));
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

async function curlGitHubRequest({ url, token }) {
  if (/[\r\n"]/.test(token)) throw new Error("GITHUB_TOKEN contains unsupported characters.");
  const config = [
    "silent",
    "show-error",
    "location",
    "fail-with-body",
    "connect-timeout = 15",
    "max-time = 90",
    "retry = 2",
    "retry-delay = 1",
    "retry-all-errors",
    'header = "Accept: application/vnd.github+json"',
    `header = "Authorization: Bearer ${token}"`,
    'header = "X-GitHub-Api-Version: 2022-11-28"'
  ].join("\n");
  const { stdout } = await runProcess("curl", ["--config", "-", url], { input: config });
  return responseFromBuffer(stdout);
}

async function githubRequest({ url, token, label, fetchImpl, diagnostics }) {
  const globalFetch = fetchImpl === globalThis.fetch;
  const proxyConfigured = Boolean(process.env.HTTPS_PROXY || process.env.ALL_PROXY || process.env.HTTP_PROXY);
  if (globalFetch && proxyConfigured) {
    diagnostics.curl_request_count += 1;
    try {
      return await curlGitHubRequest({ url, token });
    } catch (error) {
      throw new Error(`${label} failed via proxy-aware curl: ${errorDetail(error)}`);
    }
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      diagnostics.fetch_request_count += 1;
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(githubRequestTimeoutMs)
      });
      if (response.ok) return response;
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`${label} returned HTTP ${response.status}`);
      }
      lastError = new Error(`${label} returned retryable HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (/returned HTTP (401|403|404)/.test(String(error?.message || ""))) throw error;
    }
    if (attempt < 3) {
      diagnostics.retry_count += 1;
      await sleep(attempt * 500);
    }
  }

  if (globalFetch) {
    diagnostics.curl_fallback_count += 1;
    diagnostics.curl_request_count += 1;
    try {
      return await curlGitHubRequest({ url, token });
    } catch (error) {
      throw new Error(`${label} failed after fetch retries (${errorDetail(lastError)}) and curl fallback (${errorDetail(error)})`);
    }
  }
  throw new Error(`${label} failed after 3 attempts: ${errorDetail(lastError)}`);
}

async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  let firstError = null;
  const worker = async () => {
    while (cursor < items.length && !firstError) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await mapper(items[index], index);
      } catch (error) {
        firstError ||= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (firstError) throw firstError;
  return output;
}

async function walk(root) {
  const rows = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) rows.push(...await walk(path));
    else rows.push(path);
  }
  return rows;
}

function historyJsonlName(path) {
  return /(?:sealed[-_]?labels?|answer[-_]?key).*\.jsonl$/i.test(basename(path));
}

async function itemIdsFromFile(path, idFields = ["item_id"]) {
  const text = await readFile(path, "utf8");
  const ids = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
    }
    const itemId = idFields.map((field) => cleanText(row?.[field])).find(Boolean) || "";
    if (itemId) ids.push(itemId);
  }
  return ids;
}

export async function githubArtifacts({
  repository,
  token,
  artifactNames = defaultArtifactNames,
  fetchImpl = globalThis.fetch,
  diagnostics = { fetch_request_count: 0, curl_request_count: 0, curl_fallback_count: 0, retry_count: 0 },
  maxPages = 100
}) {
  if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required with --github.");
  const artifacts = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await githubRequest({
      url: `https://api.github.com/repos/${repository}/actions/artifacts?per_page=100&page=${page}`,
      token,
      label: `GitHub artifact history page ${page}`,
      fetchImpl,
      diagnostics
    });
    const body = await response.json();
    const pageArtifacts = Array.isArray(body.artifacts) ? body.artifacts : [];
    artifacts.push(...pageArtifacts.filter((artifact) => (
      artifact?.expired !== true && artifactNames.has(cleanText(artifact?.name))
    )));
    if (pageArtifacts.length < 100) break;
    if (page === maxPages) throw new Error(`GitHub artifact history exceeded the fail-closed page limit (${maxPages}).`);
  }
  return artifacts;
}

async function downloadArtifact({ artifact, repository, token, root, fetchImpl, diagnostics }) {
  const response = await githubRequest({
    url: `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
    token,
    label: `GitHub artifact ${artifact.id} download`,
    fetchImpl,
    diagnostics
  });
  const artifactRoot = join(root, String(artifact.id));
  const zipPath = join(root, `${artifact.id}.zip`);
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  await runProcess("unzip", ["-q", "-o", zipPath, "-d", artifactRoot], { maxBytes: 4 * 1024 * 1024 });
  return artifactRoot;
}

export async function collectEbayEvaluationHistory({
  seedPaths = [],
  artifactRoots = [],
  github = false,
  repository = process.env.GITHUB_REPOSITORY || "",
  token = process.env.GITHUB_TOKEN || "",
  outPath = "",
  fetchImpl = globalThis.fetch,
  downloadConcurrency = defaultDownloadConcurrency,
  artifactNames = defaultArtifactNames,
  idFields = ["item_id"],
  outputField = "item_id"
} = {}) {
  const sources = [];
  for (const path of seedPaths.map((value) => resolve(value))) sources.push({ path, source: `seed:${basename(path)}` });
  for (const root of artifactRoots.map((value) => resolve(value))) {
    for (const path of await walk(root)) {
      if (historyJsonlName(path)) sources.push({ path, source: `artifact_root:${basename(root)}` });
    }
  }

  let tempRoot = null;
  let artifacts = [];
  const networkDiagnostics = {
    fetch_request_count: 0,
    curl_request_count: 0,
    curl_fallback_count: 0,
    retry_count: 0
  };
  try {
    if (github) {
      tempRoot = await mkdtemp(join(tmpdir(), "lynca-ebay-eval-history-"));
      artifacts = await githubArtifacts({ repository, token, artifactNames, fetchImpl, diagnostics: networkDiagnostics });
      const githubRoots = await mapConcurrent(artifacts, downloadConcurrency, async (artifact) => (
        await downloadArtifact({
          artifact,
          repository,
          token,
          root: tempRoot,
          fetchImpl,
          diagnostics: networkDiagnostics
        })
      ));
      for (let index = 0; index < artifacts.length; index += 1) {
        const artifact = artifacts[index];
        const artifactRoot = githubRoots[index];
        for (const path of await walk(artifactRoot)) {
          if (historyJsonlName(path)) {
            sources.push({ path, source: `github_artifact:${artifact.name}:${artifact.id}` });
          }
        }
      }
    }

    const history = new Map();
    for (const source of sources) {
      for (const itemId of await itemIdsFromFile(source.path, idFields)) {
        if (!history.has(itemId)) history.set(itemId, new Set());
        history.get(itemId).add(source.source);
      }
    }
    const rows = [...history.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([itemId, itemSources]) => ({
        [outputField]: itemId,
        source_count: itemSources.size,
        sources: [...itemSources].sort()
      }));
    if (outPath) {
      await mkdir(dirname(resolve(outPath)), { recursive: true });
      await writeFile(resolve(outPath), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
    }
    return {
      rows,
      unique_item_count: rows.length,
      source_file_count: sources.length,
      github_artifact_count: artifacts.length,
      github_download_concurrency: github ? downloadConcurrency : 0,
      github_network: networkDiagnostics
    };
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const artifactNames = new Set(listArg(argValue(argv, "--artifact-names", "")));
  const result = await collectEbayEvaluationHistory({
    seedPaths: listArg(argValue(argv, "--seed", "")),
    artifactRoots: listArg(argValue(argv, "--artifact-roots", "")),
    github: argv.includes("--github"),
    repository: argValue(argv, "--repository", process.env.GITHUB_REPOSITORY || ""),
    token: process.env.GITHUB_TOKEN || "",
    outPath: argValue(argv, "--out", "/tmp/ebay-evaluation-history.jsonl"),
    downloadConcurrency: positiveInteger(argValue(argv, "--download-concurrency", ""), defaultDownloadConcurrency),
    artifactNames: artifactNames.size ? artifactNames : defaultArtifactNames,
    idFields: listArg(argValue(argv, "--id-fields", "item_id")),
    outputField: cleanText(argValue(argv, "--output-field", "item_id")) || "item_id"
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result, rows: undefined }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
