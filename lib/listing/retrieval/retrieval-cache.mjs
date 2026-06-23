import fs from "node:fs";
import path from "node:path";

const cacheFileVersion = 1;

function now() {
  return Date.now();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function cacheConfigFromEnv(env = process.env) {
  return {
    backend: String(env.RETRIEVAL_CACHE_BACKEND || "memory").toLowerCase(),
    filePath: env.RETRIEVAL_CACHE_FILE || "",
    ttlMs: positiveInteger(env.RETRIEVAL_CACHE_TTL_MS, 15 * 60 * 1000),
    maxEntries: positiveInteger(env.RETRIEVAL_CACHE_MAX_ENTRIES, 500)
  };
}

function defaultFileCachePath() {
  return path.join(process.cwd(), ".cache", "lynca", "retrieval-cache.json");
}

function keyFor(query = {}) {
  return JSON.stringify({
    provider_id: query.provider_id || "",
    family: query.family || "",
    query: query.query || ""
  });
}

function pruneExpired(entries, nowMs = now()) {
  let pruned = false;
  for (const [key, entry] of entries.entries()) {
    if (!entry || entry.expires_at <= nowMs) {
      entries.delete(key);
      pruned = true;
    }
  }
  return pruned;
}

function enforceEntryLimit(entries, maxEntries) {
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value;
    if (!oldest) break;
    entries.delete(oldest);
  }
}

function entrySnapshot(entries) {
  return [...entries.entries()].map(([key, entry]) => ({
    key,
    expires_at: entry.expires_at,
    value: entry.value
  }));
}

function entriesFromSnapshot(snapshot, {
  nowMs = now(),
  maxEntries = 500
} = {}) {
  const entries = new Map();
  if (!Array.isArray(snapshot)) return entries;

  for (const item of snapshot) {
    if (!item || typeof item.key !== "string" || !item.value) continue;
    const expiresAt = Number(item.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) continue;
    entries.set(item.key, {
      expires_at: expiresAt,
      value: item.value
    });
  }

  enforceEntryLimit(entries, maxEntries);
  return entries;
}

function readFileEntries(filePath, {
  maxEntries = 500
} = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return new Map();
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.version !== cacheFileVersion) return new Map();
    return entriesFromSnapshot(parsed.entries, { maxEntries });
  } catch {
    return new Map();
  }
}

function writeFileEntries(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({
    version: cacheFileVersion,
    written_at: new Date().toISOString(),
    entries: entrySnapshot(entries)
  });
  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function createRetrievalCache({
  ttlMs = 15 * 60 * 1000,
  maxEntries = 500,
  initialEntries = null,
  onChange = null
} = {}) {
  const entryLimit = positiveInteger(maxEntries, 500);
  const ttl = positiveInteger(ttlMs, 15 * 60 * 1000);
  const entries = initialEntries instanceof Map
    ? new Map(initialEntries)
    : entriesFromSnapshot(initialEntries, { maxEntries: entryLimit });

  pruneExpired(entries);
  enforceEntryLimit(entries, entryLimit);

  function notifyChange() {
    if (typeof onChange === "function") onChange(entries);
  }

  return {
    get(query) {
      const key = keyFor(query);
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expires_at <= now()) {
        entries.delete(key);
        notifyChange();
        return null;
      }
      return {
        ...entry.value,
        cache_hit: true
      };
    },
    set(query, value) {
      const key = keyFor(query);
      pruneExpired(entries);
      if (entries.size >= entryLimit) {
        const oldest = entries.keys().next().value;
        if (oldest) entries.delete(oldest);
      }
      entries.set(key, {
        expires_at: now() + ttl,
        value
      });
      notifyChange();
    },
    size() {
      if (pruneExpired(entries)) notifyChange();
      return entries.size;
    },
    clear() {
      entries.clear();
      notifyChange();
    },
    snapshot() {
      pruneExpired(entries);
      return entrySnapshot(entries);
    }
  };
}

export function createFileBackedRetrievalCache({
  filePath,
  ttlMs = 15 * 60 * 1000,
  maxEntries = 500
} = {}) {
  const resolvedFilePath = path.resolve(filePath || defaultFileCachePath());
  let lastPersistenceError = null;
  const initialEntries = readFileEntries(resolvedFilePath, { maxEntries });

  const cache = createRetrievalCache({
    ttlMs,
    maxEntries,
    initialEntries,
    onChange(entries) {
      try {
        writeFileEntries(resolvedFilePath, entries);
        lastPersistenceError = null;
      } catch (error) {
        lastPersistenceError = error;
      }
    }
  });

  return {
    ...cache,
    file_path: resolvedFilePath,
    lastPersistenceError() {
      return lastPersistenceError;
    }
  };
}

export function createConfiguredRetrievalCache({
  env = process.env
} = {}) {
  const config = cacheConfigFromEnv(env);
  if (config.backend === "file" || config.filePath) {
    return createFileBackedRetrievalCache({
      filePath: config.filePath || defaultFileCachePath(),
      ttlMs: config.ttlMs,
      maxEntries: config.maxEntries
    });
  }

  return createRetrievalCache({
    ttlMs: config.ttlMs,
    maxEntries: config.maxEntries
  });
}

export const defaultRetrievalCache = createConfiguredRetrievalCache();
