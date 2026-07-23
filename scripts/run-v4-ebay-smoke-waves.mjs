import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as runSmokeCli } from "./v4-ebay-smoke.mjs";

function cleanText(value) {
  return String(value ?? "").trim();
}

function argValue(argv, name, fallback = "") {
  const inline = argv.find((arg) => String(arg).startsWith(`${name}=`));
  if (inline) return String(inline).slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function withoutOptions(argv, names = []) {
  const blocked = new Set(names);
  const output = argv.slice(0, 2);
  for (let index = 2; index < argv.length; index += 1) {
    const value = String(argv[index]);
    const inlineName = names.find((name) => value.startsWith(`${name}=`));
    if (inlineName) continue;
    if (!blocked.has(value)) {
      output.push(argv[index]);
      continue;
    }
    if (index + 1 < argv.length && !String(argv[index + 1]).startsWith("--")) index += 1;
  }
  return output;
}

export function planSmokeWaves({ offset = 0, limit = 10, waveSize = 10 } = {}) {
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const count = positiveInteger(limit, 10);
  const size = positiveInteger(waveSize, 10, { max: 10 });
  const waves = [];
  for (let consumed = 0; consumed < count; consumed += size) {
    waves.push({
      index: waves.length + 1,
      offset: start + consumed,
      limit: Math.min(size, count - consumed)
    });
  }
  return waves;
}

export function waveOutputPath(outPath, waveIndex) {
  const normalized = resolve(outPath);
  const detectedExtension = extname(normalized);
  const extension = detectedExtension || ".json";
  const base = detectedExtension ? normalized.slice(0, -detectedExtension.length) : normalized;
  return `${base}.wave-${String(waveIndex).padStart(3, "0")}${extension}`;
}

export function waveBatchId(batchId, waveIndex) {
  const base = cleanText(batchId) || "v4-smoke-waves";
  return `${base}-w${String(waveIndex).padStart(3, "0")}`.slice(0, 120);
}

function reportPassed(report = {}) {
  const attempted = Number(report?.summary?.attempted_count || 0);
  const ok = Number(report?.summary?.ok_count || 0);
  const titleReady = Number(report?.summary?.title_ready_count || 0);
  return attempted > 0 && ok === attempted && titleReady === attempted;
}

export async function runSmokeWaves(argv = process.argv, env = process.env, {
  runWave = runSmokeCli,
  readJson = async (path) => JSON.parse(await readFile(path, "utf8")),
  writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
} = {}) {
  const offset = Math.max(0, Math.trunc(Number(argValue(argv, "--offset", "0")) || 0));
  const limit = positiveInteger(argValue(argv, "--limit", "10"), 10);
  const waveSize = positiveInteger(argValue(argv, "--wave-size", "10"), 10, { max: 10 });
  const settleMs = positiveInteger(argValue(argv, "--wave-settle-ms", "2000"), 2000, { min: 0, max: 30_000 });
  const outPath = resolve(argValue(argv, "--out", `data/eval/workflow-sidecar-smoke/v4-ebay-smoke-waves-${Date.now()}.json`));
  const batchId = cleanText(argValue(argv, "--batch-id", `v4-smoke-waves-${Date.now()}`));
  const baseArgs = withoutOptions(argv, ["--offset", "--limit", "--out", "--batch-id", "--wave-size", "--wave-settle-ms"]);
  const waves = planSmokeWaves({ offset, limit, waveSize });
  const reports = [];

  for (const wave of waves) {
    const waveOut = waveOutputPath(outPath, wave.index);
    const currentBatchId = waveBatchId(batchId, wave.index);
    await runWave([
      ...baseArgs,
      "--offset", String(wave.offset),
      "--limit", String(wave.limit),
      "--out", waveOut,
      "--batch-id", currentBatchId
    ], env);
    const report = await readJson(waveOut);
    reports.push({
      ...wave,
      batch_id: currentBatchId,
      report_path: waveOut,
      attempted_count: Number(report?.summary?.attempted_count || 0),
      ok_count: Number(report?.summary?.ok_count || 0),
      title_ready_count: Number(report?.summary?.title_ready_count || 0),
      preparation_p95_ms: report?.summary?.preparation_p95_ms ?? null,
      writer_visible_recognition_p95_ms: report?.summary?.writer_visible_recognition_p95_ms ?? null,
      passed: reportPassed(report)
    });
    if (!reports.at(-1).passed) break;
    if (wave.index < waves.length && settleMs > 0) await sleep(settleMs);
  }

  const manifest = {
    schema_version: "v4-smoke-wave-manifest-v1",
    generated_at: new Date().toISOString(),
    contract: {
      max_inflight_cards: 10,
      next_wave_requires_previous_terminal_success: true,
      deterministic_wave_batch_ids: true,
      purpose: "bound Supabase and queue pressure without changing recognition strategy"
    },
    requested: { offset, limit, wave_size: waveSize, wave_settle_ms: settleMs },
    completed_wave_count: reports.length,
    passed: reports.length === waves.length && reports.every((report) => report.passed),
    waves: reports
  };
  await writeJson(outPath, manifest);
  if (!manifest.passed) throw new Error(`wave_gate_failed:${reports.at(-1)?.batch_id || "no_wave"}`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSmokeWaves().then((manifest) => {
    process.stdout.write(`v4 smoke waves passed: ${manifest.completed_wave_count}\nmanifest: ${resolve(argValue(process.argv, "--out"))}\n`);
  }).catch((error) => {
    console.error(`v4 smoke waves failed: ${error.message}`);
    process.exit(1);
  });
}
