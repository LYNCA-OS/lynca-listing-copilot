import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  cachedAssetEntryForPreparation,
  durableSourceFingerprint,
  login,
  mapWithConcurrency,
  prepareDurableSmokeItem,
  readVerifiedAssetCache,
  writeVerifiedAssetCache
} from "./v4-ebay-smoke.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}

export const DEFAULT_PREPARATION_CONCURRENCY = 2;
export const MAX_PREPARATION_CONCURRENCY = 2;

export function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function datasetItems(payload = {}) {
  if (Array.isArray(payload)) return payload;
  return payload.items || payload.records || payload.results || payload.cards || [];
}

export function percentile(values = [], ratio = 0.5) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

export function preparationConcurrency(value, fallback = DEFAULT_PREPARATION_CONCURRENCY) {
  return Math.min(MAX_PREPARATION_CONCURRENCY, positiveInteger(value, fallback));
}

export async function prepareVerifiedAssets({
  datasetPath,
  cachePath,
  baseUrl,
  username,
  password,
  offset = 0,
  limit = 70,
  concurrency = DEFAULT_PREPARATION_CONCURRENCY,
  requestTimeoutMs = 45_000,
  progress = true
} = {}) {
  if (!datasetPath || !cachePath || !baseUrl || !username || !password) {
    throw new Error("dataset, cache, base URL, username, and password are required");
  }
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const items = datasetItems(dataset).slice(offset, offset + limit);
  if (!items.length) throw new Error("verified asset preparation dataset is empty");

  const cookie = await login({ baseUrl: baseUrl.replace(/\/+$/, ""), username, password });
  const entries = await readVerifiedAssetCache(cachePath);
  let persistChain = Promise.resolve();
  const results = await mapWithConcurrency(items, concurrency, async (item, localIndex) => {
    const index = offset + localIndex;
    const fingerprint = await durableSourceFingerprint(item, index);
    const cachedAssetEntry = cachedAssetEntryForPreparation({ mode: "reuse", entries, fingerprint });
    const startedAt = Date.now();
    try {
      const prepared = await prepareDurableSmokeItem({
        item,
        index,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        cookie,
        requestTimeoutMs,
        sourceFingerprint: fingerprint,
        cachedAssetEntry
      });
      const entry = prepared.asset_cache_entry;
      if (entry?.fingerprint && entry?.asset_id) {
        entries.set(entry.fingerprint, entry);
        persistChain = persistChain.then(() => writeVerifiedAssetCache(cachePath, entries));
        await persistChain;
      }
      const result = {
        ok: true,
        cache_hit: prepared.preparation_diagnostics?.asset_cache_hit === true,
        asset_id: prepared.asset?.asset_id || null,
        elapsed_ms: Date.now() - startedAt
      };
      if (progress) process.stderr.write(`verified asset ${localIndex + 1}/${items.length} ok=${result.ok} cache=${result.cache_hit} elapsed=${result.elapsed_ms}ms\n`);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        cache_hit: false,
        asset_id: null,
        elapsed_ms: Date.now() - startedAt,
        error: String(error?.message || error).slice(0, 320)
      };
      if (progress) process.stderr.write(`verified asset ${localIndex + 1}/${items.length} ok=false elapsed=${result.elapsed_ms}ms error=${result.error}\n`);
      return result;
    }
  });

  const successful = results.filter((result) => result.ok);
  const elapsed = successful.map((result) => result.elapsed_ms);
  return {
    attempted_count: results.length,
    ok_count: successful.length,
    failed_count: results.length - successful.length,
    cache_hit_count: successful.filter((result) => result.cache_hit).length,
    preparation_p50_ms: percentile(elapsed, 0.5),
    preparation_p95_ms: percentile(elapsed, 0.95),
    results
  };
}

async function main(argv = process.argv, env = process.env) {
  const report = await prepareVerifiedAssets({
    datasetPath: argValue(argv, "--dataset"),
    cachePath: argValue(argv, "--cache"),
    baseUrl: argValue(argv, "--base-url", "https://listing.lyncafei.team"),
    username: env.METAVERSE_USERNAME || argValue(argv, "--username"),
    password: env.METAVERSE_PASSWORD || argValue(argv, "--password"),
    offset: Math.max(0, Number(argValue(argv, "--offset", 0)) || 0),
    limit: positiveInteger(argValue(argv, "--limit", 70), 70),
    concurrency: preparationConcurrency(argValue(argv, "--concurrency", DEFAULT_PREPARATION_CONCURRENCY)),
    requestTimeoutMs: Math.max(10_000, positiveInteger(argValue(argv, "--request-timeout-ms", 45_000), 45_000))
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed_count > 0) process.exitCode = 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(`verified asset preparation failed: ${error.message}`);
    process.exit(1);
  });
}
