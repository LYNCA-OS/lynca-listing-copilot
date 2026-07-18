#!/usr/bin/env node

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tls from "node:tls";
import {
  defaultProviderModels,
  visionProviderIds
} from "../lib/listing/providers/provider-contract.mjs";

const datasetPath = "docs/v2/evaluation-dataset-001.md";
const auditPath = "docs/v2/benchmark-image-access-audit-001.md";
const runnerPlanPath = "docs/v2/evaluation-runner-plan-001.md";
const repoRoot = process.cwd();
const candidatePromptPatchPath = process.env.CANDIDATE_PROMPT_PATCH_PATH || "";
const runMode = candidatePromptPatchPath ? "candidate" : "baseline";
const runId = process.env.EVALUATION_RUN_ID || "eval-001-smoke-baseline";
const outputDir = `data/evaluation/runs/${runId}`;
const outputPath = `${outputDir}/outputs.jsonl`;
const reportPath = process.env.EVALUATION_REPORT_PATH || "docs/v2/evaluation-run-001-smoke-results.md";
const rowLimit = 25;
const cookieName = "lynca_metaverse_session";
const maxTitleLength = 80;
let handler;
let proxyFetch = null;
let proxyMode = "none";

loadLocalEnv();
await configureProxyDispatcher();
handler = await loadListingHandler();

const startedAt = new Date().toISOString();
await fs.mkdir(resolve(repoRoot, outputDir), { recursive: true });
await fs.writeFile(resolve(repoRoot, outputPath), "");

const rows = parseBenchmarkRows(await fs.readFile(resolve(repoRoot, datasetPath), "utf8")).slice(0, rowLimit);
validateRows(rows);

const config = {
  supabaseUrl: String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  authSecret: process.env.METAVERSE_AUTH_SECRET || "",
  openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
  model: process.env.OPENAI_LISTING_MODEL || defaultProviderModels[visionProviderIds.OPENAI_LEGACY],
  proxyMode,
  runMode,
  candidatePromptPatchPath: candidatePromptPatchPath || null
};

const runResults = [];

for (const row of rows) {
  const result = await runRow(row, config);
  runResults.push(result);
  await fs.appendFile(resolve(repoRoot, outputPath), `${JSON.stringify(result)}\n`);
  console.log(`row ${row.row_index}: ${result.status} ${result.pipeline_confidence || ""}`.trim());
}

const finishedAt = new Date().toISOString();
await fs.writeFile(resolve(repoRoot, reportPath), renderReport({
  startedAt,
  finishedAt,
  rows,
  results: runResults,
  config
}));

console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${reportPath}`);

async function loadListingHandler() {
  if (!candidatePromptPatchPath) {
    const module = await import("../lib/listing/v4/pipeline/native-recognition-core.mjs");
    return nativeRecognitionHandler(module.runNativeV4Recognition);
  }

  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "lynca-eval-prompt-"));
  await fs.cp(resolve(repoRoot, "prompts"), join(tempRoot, "prompts"), { recursive: true });

  const candidatePrompt = await fs.readFile(resolve(repoRoot, candidatePromptPatchPath), "utf8");
  await fs.appendFile(
    join(tempRoot, "prompts", "listing-intelligence-v1.md"),
    `\n\n--- Candidate prompt patch injected by evaluation-smoke-runner ---\n${candidatePrompt.trim()}\n`
  );

  process.chdir(tempRoot);
  const module = await import(`${pathToFileURL(resolve(repoRoot, "lib/listing/v4/pipeline/native-recognition-core.mjs")).href}?run=${encodeURIComponent(runId)}`);
  return nativeRecognitionHandler(module.runNativeV4Recognition);
}

function nativeRecognitionHandler(runNativeV4Recognition) {
  return async (req, res) => {
    let body = "";
    await new Promise((resolveBody, rejectBody) => {
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", resolveBody);
      req.on("error", rejectBody);
    });
    const payload = body ? JSON.parse(body) : {};
    const response = await runNativeV4Recognition({ payload, requestContext: { headers: req.headers || {} } });
    res.statusCode = response.statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(response.body || {}));
  };
}

function loadLocalEnv() {
  for (const envPath of [".env.local", ".env"]) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function configureProxyDispatcher() {
  const proxyUrl = await resolveProxyUrl();
  if (!proxyUrl) return;

  const originalFetch = globalThis.fetch;
  proxyFetch = (url, options) => fetchViaHttpProxy(url, options, proxyUrl, originalFetch);
  globalThis.fetch = (url, options) => {
    const target = new URL(String(url));
    return target.hostname === "api.openai.com"
      ? proxyFetch(url, options)
      : originalFetch(url, options);
  };
  proxyMode = "openai_only_http_connect_proxy";
}

async function resolveProxyUrl() {
  const configured = String(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
  if (configured) return configured;

  const localCodexProxy = "http://127.0.0.1:7897";
  if (await canConnect("127.0.0.1", 7897, 750)) {
    return localCodexProxy;
  }

  return "";
}

function canConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function parseBenchmarkRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\| \d+ \|/.test(line))
    .map((line) => {
      const cells = splitMarkdownRow(line);
      const imageCell = cells[2] || "";
      const imageUrls = [...imageCell.matchAll(/\[(front|back)\]\((https?:\/\/[^)]+)\)/g)]
        .reduce((acc, match) => {
          acc[match[1]] = match[2];
          return acc;
        }, {});

      return {
        row_index: Number(cells[0]),
        feedback_id: stripBackticks(cells[1]),
        front_image_url: imageUrls.front || "",
        back_image_url: imageUrls.back || "",
        baseline_generated_title: unescapeMarkdownCell(cells[3] || ""),
        corrected_title: unescapeMarkdownCell(cells[4] || ""),
        category: stripBackticks(cells[5] || "")
      };
    });
}

function splitMarkdownRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/g)
    .map((cell) => cell.trim());
}

function stripBackticks(value) {
  return String(value || "").replace(/^`|`$/g, "").trim();
}

function unescapeMarkdownCell(value) {
  return String(value || "").replace(/\\\|/g, "|").trim();
}

function validateRows(rows) {
  if (rows.length !== rowLimit) {
    throw new Error(`Expected ${rowLimit} smoke rows, found ${rows.length}.`);
  }

  const ids = new Set();
  for (const row of rows) {
    if (!row.feedback_id) throw new Error(`Row ${row.row_index} missing feedback_id.`);
    if (ids.has(row.feedback_id)) throw new Error(`Duplicate feedback_id: ${row.feedback_id}`);
    ids.add(row.feedback_id);
    if (!row.front_image_url) throw new Error(`Row ${row.row_index} missing front image URL.`);
    if (!row.baseline_generated_title) throw new Error(`Row ${row.row_index} missing generated title.`);
    if (!row.corrected_title) throw new Error(`Row ${row.row_index} missing corrected title.`);
  }
}

async function runRow(row, config) {
  const started = performance.now();
  const base = {
    run_id: runId,
    row_index: row.row_index,
    feedback_id: row.feedback_id,
    category: row.category,
    front_image_url: row.front_image_url,
    back_image_url: row.back_image_url || null,
    image_backed_status: row.back_image_url ? "front_and_back" : "front_only",
    baseline_generated_title: row.baseline_generated_title,
    corrected_title: row.corrected_title,
    pipeline_generated_title: "",
    pipeline_confidence: "",
    pipeline_reason: "",
    pipeline_fields: {},
    pipeline_unresolved: [],
    pipeline_source: "",
    status: "failed",
    error: null,
    pipeline_attempts: 0,
    image_fetch: {
      front_status: "pending",
      back_status: row.back_image_url ? "pending" : "url_missing"
    },
    latency_ms: 0,
    usage: {
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost_usd: null
    }
  };

  try {
    const frontImage = await fetchImageAsDataUrl(row.front_image_url, "front", config);
    base.image_fetch.front_status = "front_download_ok";

    const images = [{
      name: `${row.feedback_id}-front.${frontImage.extension}`,
      dataUrl: frontImage.dataUrl
    }];

    if (row.back_image_url) {
      const backImage = await fetchImageAsDataUrl(row.back_image_url, "back", config);
      base.image_fetch.back_status = "back_download_ok";
      images.push({
        name: `${row.feedback_id}-back.${backImage.extension}`,
        dataUrl: backImage.dataUrl
      });
    }

    const apiResult = await callListingPipelineWithRetry({
      assetId: `eval-001:${row.feedback_id}`,
      mode: runMode === "candidate" ? "evaluation-candidate-smoke" : "evaluation-baseline-smoke",
      images,
      resolutionMap: {},
      maxTitleLength
    }, config);

    base.pipeline_generated_title = String(apiResult.title || "");
    base.pipeline_confidence = String(apiResult.confidence || "");
    base.pipeline_reason = String(apiResult.reason || "");
    base.pipeline_fields = apiResult.fields || {};
    base.pipeline_unresolved = Array.isArray(apiResult.unresolved) ? apiResult.unresolved : [];
    base.pipeline_source = String(apiResult.source || "");
    base.pipeline_attempts = apiResult.__attempts || 1;
    base.status = base.pipeline_source === "error" || base.pipeline_confidence === "FAILED" ? "failed" : "completed";
    if (base.status === "failed") {
      base.error = base.pipeline_reason || "Pipeline returned failed result.";
    }
  } catch (error) {
    base.error = error.message;
    if (/front image/i.test(error.message)) base.image_fetch.front_status = "front_failed";
    if (/back image/i.test(error.message)) base.image_fetch.back_status = "back_failed";
  } finally {
    base.latency_ms = Math.round(performance.now() - started);
  }

  return base;
}

async function callListingPipelineWithRetry(payload, config, attempts = 3) {
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await callListingPipeline(payload, config);
    result.__attempts = attempt;
    if (!isRetryablePipelineFailure(result) || attempt === attempts) {
      return result;
    }
    lastResult = result;
    await delay(1000 * attempt);
  }

  return lastResult;
}

function isRetryablePipelineFailure(result) {
  const reason = String(result?.reason || "").toLowerCase();
  return result?.source === "error" && (
    reason.includes("fetch failed")
    || reason.includes("proxy")
    || reason.includes("timeout")
    || reason.includes("network")
    || reason.includes("invalid http response")
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchImageAsDataUrl(url, side, config) {
  if (!url) throw new Error(`${side} image URL missing.`);
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    throw new Error("Supabase auth/config missing.");
  }

  const response = await fetch(downloadUrlForAuthenticatedUrl(url, config.supabaseUrl), {
    method: "GET",
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`
    }
  });

  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(`${side} image fetch failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = extensionForContentType(contentType);

  return {
    dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
    extension
  };
}

function downloadUrlForAuthenticatedUrl(url, supabaseUrl) {
  const objectPath = objectPathFromAuthenticatedUrl(url);
  if (!objectPath) return url;
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${encoded}`;
}

function objectPathFromAuthenticatedUrl(url) {
  const parsed = new URL(url);
  const marker = "/storage/v1/object/authenticated/";
  const index = parsed.pathname.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(parsed.pathname.slice(index + marker.length));
}

function extensionForContentType(contentType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif"
  }[String(contentType || "").toLowerCase()] || "jpg";
}

async function fetchViaHttpProxy(url, options = {}, proxyUrl, originalFetch) {
  const target = new URL(url);
  const proxy = new URL(proxyUrl);
  if (target.protocol !== "https:" || proxy.protocol !== "http:") {
    return originalFetch(url, options);
  }

  const body = options.body ? Buffer.from(String(options.body)) : Buffer.alloc(0);
  const headers = new Map();
  for (const [key, value] of Object.entries(options.headers || {})) {
    headers.set(key.toLowerCase(), String(value));
  }
  headers.set("host", target.host);
  headers.set("connection", "close");
  if (body.length) {
    headers.set("content-length", String(body.length));
  }

  const timeoutMs = 60000;
  const socket = await connectProxySocket({ proxy, target, timeoutMs, signal: options.signal });
  const secureSocket = tls.connect({
    socket,
    servername: target.hostname
  });

  try {
    await onceSecure(secureSocket, timeoutMs, options.signal);
    const requestPath = `${target.pathname || "/"}${target.search || ""}`;
    const headerText = Array.from(headers.entries())
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    secureSocket.write(`${options.method || "GET"} ${requestPath} HTTP/1.1\r\n${headerText}\r\n\r\n`);
    if (body.length) {
      secureSocket.write(body);
    }
    return await readHttpResponse(secureSocket, timeoutMs, options.signal);
  } finally {
    secureSocket.destroy();
  }
}

function connectProxySocket({ proxy, target, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({
      host: proxy.hostname,
      port: Number(proxy.port || 80)
    });
    let settled = false;
    let buffered = Buffer.alloc(0);

    const cleanup = () => {
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.off("data", onData);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onError = (error) => fail(error);
    const onTimeout = () => fail(new Error("Proxy connection timed out"));
    const onAbort = () => fail(new Error("Proxy request aborted"));
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffered.slice(0, headerEnd).toString("latin1");
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(header)) {
        fail(new Error(`Proxy CONNECT failed: ${header.split("\r\n")[0] || "unknown status"}`));
        return;
      }

      settled = true;
      cleanup();
      const leftover = buffered.slice(headerEnd + 4);
      if (leftover.length) {
        socket.unshift(leftover);
      }
      resolve(socket);
    };

    socket.setTimeout(timeoutMs);
    socket.on("error", onError);
    socket.on("timeout", onTimeout);
    socket.on("data", onData);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("connect", () => {
      socket.write(`CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\nConnection: close\r\n\r\n`);
    });
  });
}

function onceSecure(socket, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TLS connection timed out")), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("secureConnect", onSecure);
      socket.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onSecure = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Proxy request aborted"));
    };

    socket.once("secureConnect", onSecure);
    socket.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readHttpResponse(socket, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => reject(new Error("Proxy response timed out")), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onData = (chunk) => chunks.push(chunk);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Proxy request aborted"));
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(parseHttpResponse(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    };

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseHttpResponse(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    throw new Error("Invalid HTTP response from proxy request");
  }

  const headerText = buffer.slice(0, headerEnd).toString("latin1");
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const status = Number(statusLine.match(/^HTTP\/1\.[01]\s+(\d+)/)?.[1] || 0);
  const headers = new Map();
  for (const line of headerLines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }

  let body = buffer.slice(headerEnd + 4);
  if (/chunked/i.test(headers.get("transfer-encoding") || "")) {
    body = decodeChunkedBody(body);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers.get(String(name || "").toLowerCase()) || null;
      }
    },
    async text() {
      return body.toString("utf8");
    },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
    async json() {
      return JSON.parse(body.toString("utf8"));
    },
    body: {
      async cancel() {}
    }
  };
}

function decodeChunkedBody(buffer) {
  const chunks = [];
  let offset = 0;

  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeText = buffer.slice(offset, lineEnd).toString("latin1").split(";")[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(buffer.slice(offset, offset + size));
    offset += size + 2;
  }

  return Buffer.concat(chunks);
}

async function callListingPipeline(payload, config) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = {
    cookie: sessionCookie(config.authSecret)
  };

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value) {
      this.body = String(value || "");
    }
  };

  const promise = handler(req, res);
  req.emit("data", JSON.stringify(payload));
  req.emit("end");
  await promise;

  let parsed;
  try {
    parsed = JSON.parse(res.body || "{}");
  } catch {
    throw new Error(`Pipeline returned invalid JSON with status ${res.statusCode}.`);
  }

  if (res.statusCode >= 400) {
    throw new Error(`Pipeline request failed with status ${res.statusCode}: ${parsed.message || "unknown error"}`);
  }

  return parsed;
}

function sessionCookie(secret) {
  if (!secret) throw new Error("METAVERSE_AUTH_SECRET missing.");
  const payload = Buffer.from(JSON.stringify({
    user: "evaluation-smoke-runner",
    exp: Date.now() + 60 * 60 * 1000
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${cookieName}=${payload}.${signature}`;
}

function renderReport({ startedAt, finishedAt, rows, results, config }) {
  const attempted = rows.length;
  const completed = results.filter((row) => row.status === "completed").length;
  const failed = results.filter((row) => row.status !== "completed").length;
  const confidenceCounts = countBy(results, (row) => row.pipeline_confidence || "NONE");
  const sourceCounts = countBy(results, (row) => row.pipeline_source || "none");
  const latencies = results.map((row) => row.latency_ms).filter((value) => Number.isFinite(value));
  const imageFetchFailures = results.filter((row) => row.image_fetch.front_status === "front_failed" || row.image_fetch.back_status === "back_failed");
  const apiFailures = results.filter((row) => row.pipeline_source === "error" || row.pipeline_confidence === "FAILED" || row.error);
  const readyForScoring = completed === attempted && imageFetchFailures.length === 0 && apiFailures.length === 0;
  const isCandidate = config.runMode === "candidate";
  const lines = [];

  lines.push(isCandidate ? "# Evaluation Run #001 Smoke Candidate #001 Results" : "# Evaluation Run #001 Smoke Results");
  lines.push("");
  lines.push(isCandidate ? "Status: Smoke Candidate Generation Complete" : "Status: Smoke Baseline Generation Complete");
  lines.push("Owner: LYNCA Listing Intelligence");
  lines.push("Generated: 2026-06-22");
  lines.push("");
  lines.push("Inputs:");
  lines.push("");
  lines.push(`- \`${datasetPath}\``);
  lines.push(`- \`${runnerPlanPath}\``);
  lines.push(`- \`${auditPath}\``);
  if (isCandidate) lines.push(`- \`${config.candidatePromptPatchPath}\``);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  if (isCandidate) {
    lines.push("This smoke run executed rows 1-25 from Evaluation Dataset #001 against the current Listing Copilot pipeline with Prompt Upgrade Candidate #001 injected only inside the isolated evaluation runner. It does not score field-level accuracy.");
  } else {
    lines.push("This smoke run executed rows 1-25 from Evaluation Dataset #001 against the current Listing Copilot pipeline. It is baseline-only and does not score field-level accuracy.");
  }
  lines.push("");
  lines.push("The isolated evaluation runner configures local OpenAI proxy access before invoking the current title handler. No production prompt, registry, resolver, or runtime title-generation behavior was modified. No corrected titles were sent to the generation call. No images were committed.");
  if (isCandidate) {
    lines.push("");
    lines.push("The candidate prompt was appended to a temporary copied prompt directory before importing the title handler for this run only.");
  }
  lines.push("");
  lines.push("## Run Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Rows attempted | ${attempted} |`);
  lines.push(`| Rows completed | ${completed} |`);
  lines.push(`| Rows failed | ${failed} |`);
  lines.push(`| Image fetch failures | ${imageFetchFailures.length} |`);
  lines.push(`| OpenAI/API failures | ${apiFailures.length} |`);
  lines.push("");
  lines.push("## System Snapshot");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Run ID | \`${runId}\` |`);
  lines.push(`| Run mode | \`${config.runMode}\` |`);
  lines.push(`| Started at | \`${startedAt}\` |`);
  lines.push(`| Finished at | \`${finishedAt}\` |`);
  lines.push(`| Pipeline | \`lib/listing/v4/pipeline/native-recognition-core.mjs\` |`);
  if (isCandidate) lines.push(`| Candidate prompt patch | \`${config.candidatePromptPatchPath}\` |`);
  lines.push(`| Model | \`${config.model}\` |`);
  lines.push(`| OpenAI configured | \`${config.openAiConfigured ? "yes" : "no"}\` |`);
  lines.push(`| Local proxy mode | \`${config.proxyMode}\` |`);
  lines.push(`| Raw output path | \`${outputPath}\` |`);
  lines.push("");
  lines.push("## Confidence Distribution");
  lines.push("");
  lines.push("| Confidence | Rows |");
  lines.push("| --- | ---: |");
  for (const [confidence, count] of Object.entries(confidenceCounts).sort()) {
    lines.push(`| \`${confidence}\` | ${count} |`);
  }
  lines.push("");
  lines.push("## Pipeline Source Distribution");
  lines.push("");
  lines.push("| Source | Rows |");
  lines.push("| --- | ---: |");
  for (const [source, count] of Object.entries(sourceCounts).sort()) {
    lines.push(`| \`${source}\` | ${count} |`);
  }
  lines.push("");
  lines.push("## Latency Summary");
  lines.push("");
  lines.push("| Metric | Milliseconds |");
  lines.push("| --- | ---: |");
  lines.push(`| Min | ${Math.min(...latencies)} |`);
  lines.push(`| Median | ${percentile(latencies, 50)} |`);
  lines.push(`| P95 | ${percentile(latencies, 95)} |`);
  lines.push(`| Max | ${Math.max(...latencies)} |`);
  lines.push(`| Average | ${Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)} |`);
  lines.push("");
  lines.push("## Generated Titles");
  lines.push("");
  lines.push("| Row | feedback_id | Category | Generated title | Confidence | Latency ms | Status |");
  lines.push("| ---: | --- | --- | --- | --- | ---: | --- |");
  for (const row of results) {
    lines.push(`| ${row.row_index} | \`${row.feedback_id}\` | \`${row.category}\` | ${escapeCell(row.pipeline_generated_title || "")} | \`${row.pipeline_confidence || "NONE"}\` | ${row.latency_ms} | \`${row.status}\` |`);
  }
  lines.push("");
  lines.push("## Image Fetch Failures");
  lines.push("");
  if (imageFetchFailures.length === 0) {
    lines.push("No image fetch failures.");
  } else {
    lines.push("| Row | feedback_id | front_status | back_status |");
    lines.push("| ---: | --- | --- | --- |");
    for (const row of imageFetchFailures) {
      lines.push(`| ${row.row_index} | \`${row.feedback_id}\` | \`${row.image_fetch.front_status}\` | \`${row.image_fetch.back_status}\` |`);
    }
  }
  lines.push("");
  lines.push("## OpenAI/API Failures");
  lines.push("");
  if (apiFailures.length === 0) {
    lines.push("No OpenAI/API failures.");
  } else {
    lines.push("| Row | feedback_id | Source | Confidence | Error |");
    lines.push("| ---: | --- | --- | --- | --- |");
    for (const row of apiFailures) {
      lines.push(`| ${row.row_index} | \`${row.feedback_id}\` | \`${row.pipeline_source || "none"}\` | \`${row.pipeline_confidence || "NONE"}\` | ${escapeCell(row.error || row.pipeline_reason || "")} |`);
    }
  }
  lines.push("");
  lines.push("## Scoring Readiness");
  lines.push("");
  if (readyForScoring) {
    lines.push(isCandidate ? "Candidate generation is ready for lightweight baseline comparison." : "Baseline generation is ready for field-level scoring.");
  } else {
    lines.push(isCandidate ? "Candidate generation is not ready for lightweight comparison until failed rows are rerun or adjudicated." : "Baseline generation is not ready for field-level scoring until failed rows are rerun or adjudicated.");
  }
  lines.push("");
  lines.push("## Not Changed");
  lines.push("");
  lines.push("This smoke run did not modify production prompts, registry data, resolver logic, runtime title-generation behavior, benchmark rows, or image files.");
  lines.push("");

  return lines.join("\n");
}

function countBy(values, keyFn) {
  return values.reduce((acc, value) => {
    const key = keyFn(value);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
