import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareVectorLazyGuardrail } from "./compare-vector-lazy-guardrail.mjs";
import { evaluateCloudListingApi } from "./evaluate-cloud-listing-api.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function flag(argv, name, fallback = false) {
  if (!argv.includes(name)) return fallback;
  const value = argValue(argv, name, "true");
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) ? value : fallback;
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultOutDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `data/eval/timing-accuracy-smoke/${stamp}`;
}

export async function runTimingAccuracySmoke({
  dataset,
  baseUrl,
  provider = "d",
  limit = 10,
  concurrency = 1,
  username,
  password,
  bypassSecret = "",
  requestTimeoutMs = 240_000,
  outDir = defaultOutDir(),
  progress = true,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!dataset) throw new Error("--dataset is required.");
  if (!baseUrl) throw new Error("--base-url or API_BASE_URL is required.");
  if (!username) throw new Error("--username or METAVERSE_USERNAME is required.");
  if (!password) throw new Error("--password or METAVERSE_PASSWORD is required.");

  const baseOptions = {
    dataset,
    baseUrl,
    provider,
    limit,
    concurrency,
    username,
    password,
    bypassSecret,
    requestTimeoutMs,
    correctedTitleAsTemporaryGt: true,
    sendCorrectedTitleHintToCloud: false,
    progress,
    fetchImpl
  };

  const noLazyReport = await evaluateCloudListingApi({
    ...baseOptions,
    disableVectorLazyMode: true
  });
  const noLazyPath = resolve(outDir, "no-lazy.json");
  await writeJson(noLazyPath, noLazyReport);

  const lazyReport = await evaluateCloudListingApi({
    ...baseOptions,
    disableVectorLazyMode: false
  });
  const lazyPath = resolve(outDir, "latest-lazy.json");
  await writeJson(lazyPath, lazyReport);

  const guardrail = await compareVectorLazyGuardrail({
    noLazyPath,
    lazyPath,
    requiredLazySkipCount: 1
  });
  const guardrailPath = resolve(outDir, "guardrail.json");
  await writeJson(guardrailPath, guardrail);

  return {
    schema_version: "timing-accuracy-smoke-replay-v1",
    out_dir: resolve(outDir),
    no_lazy_report_path: noLazyPath,
    lazy_report_path: lazyPath,
    guardrail_report_path: guardrailPath,
    guardrail_status: guardrail.status,
    summary: guardrail.summary
  };
}

export async function main(argv = process.argv, env = process.env) {
  const report = await runTimingAccuracySmoke({
    dataset: argValue(argv, "--dataset", env.CLOUD_EVAL_DATASET || ""),
    baseUrl: argValue(argv, "--base-url", env.API_BASE_URL || ""),
    provider: argValue(argv, "--provider", "d"),
    limit: Math.max(1, numberArg(argv, "--limit", 10)),
    concurrency: Math.max(1, numberArg(argv, "--concurrency", 1)),
    username: argValue(argv, "--username", env.METAVERSE_USERNAME || ""),
    password: argValue(argv, "--password", env.METAVERSE_PASSWORD || ""),
    bypassSecret: argValue(argv, "--bypass-secret", env.VERCEL_AUTOMATION_BYPASS_SECRET || ""),
    requestTimeoutMs: Math.max(30_000, numberArg(argv, "--request-timeout-ms", 240_000)),
    outDir: argValue(argv, "--out-dir", defaultOutDir()),
    progress: flag(argv, "--progress", true)
  });
  process.stdout.write([
    `timing accuracy smoke ${report.guardrail_status}`,
    `out_dir: ${report.out_dir}`,
    `no_lazy_report_path: ${report.no_lazy_report_path}`,
    `lazy_report_path: ${report.lazy_report_path}`,
    `guardrail_report_path: ${report.guardrail_report_path}`,
    `vector_lazy_skip_count: ${report.summary.vector_lazy_skip_count}`,
    `vector_lazy_skip_regression_count: ${report.summary.vector_lazy_skip_regression_count}`,
    `copied_serial_grade_cert_from_reference_count: ${JSON.stringify(report.summary.copied_serial_grade_cert_from_reference_count)}`,
    `p50_delta_ms: ${report.summary.p50_delta_ms ?? "n/a"}`,
    `p95_delta_ms: ${report.summary.p95_delta_ms ?? "n/a"}`,
    `fail_reasons: ${(report.summary.fail_reasons || []).join(",") || "n/a"}`
  ].join("\n") + "\n");
  return report.guardrail_status === "passed" ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Timing accuracy smoke failed: ${error.message}`);
    process.exit(1);
  }
}
