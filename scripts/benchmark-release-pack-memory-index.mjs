import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { compileReleasePackMemoryIndex } from "../lib/listing/catalog/release-pack-memory-index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = "/Users/paidaxin/Documents/Lynca/lynca-catalog-vocab/data/catalog/official/panini-mapped-2023-2025.json";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function summarize(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null, mean: null };
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length
  };
}

function timedQuery(index, query) {
  const started = performance.now();
  const result = index.query(query, { limit: 20 });
  return { elapsed_ms: performance.now() - started, candidate_count: result.candidate_count };
}

const sourcePath = path.resolve(argument("--source", defaultSource));
const outputPath = argument("--out");
if (typeof global.gc === "function") global.gc();
const beforeRead = process.memoryUsage();
const readStarted = performance.now();
const bytes = fs.readFileSync(sourcePath);
const readMs = performance.now() - readStarted;
const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
const parseStarted = performance.now();
const pack = JSON.parse(bytes.toString("utf8"));
const parseMs = performance.now() - parseStarted;
if (!Array.isArray(pack.rows)) throw new Error("source pack rows array is required");

if (typeof global.gc === "function") global.gc();
const beforeBuild = process.memoryUsage();
const buildStarted = performance.now();
const index = compileReleasePackMemoryIndex({
  rows: pack.rows,
  pack_version: cleanVersion(pack.schema_version, pack.generated_at),
  provenance: {
    source_id: "panini-mapped-2023-2025",
    source_type: "OFFICIAL_CATALOG",
    source_version: cleanVersion(pack.schema_version, pack.generated_at),
    source_sha256: sourceSha256,
    source_uri: `file://${sourcePath}`,
    generated_at: pack.generated_at
  }
});
const buildMs = performance.now() - buildStarted;
if (typeof global.gc === "function") global.gc();
const afterBuild = process.memoryUsage();

function cleanVersion(...values) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean).join("@");
}

const sampleSize = Math.min(Number(argument("--queries", 5_000)) || 5_000, pack.rows.length);
const sampledRows = Array.from({ length: sampleSize }, (_, offset) => (
  pack.rows[Math.floor(offset * pack.rows.length / sampleSize)]
));

// Warm the JIT and map access before collecting query latency.
for (const row of sampledRows.slice(0, Math.min(500, sampledRows.length))) {
  index.query({ year: row.season_year, sport: row.sport, product: row.product, set: row.set_or_insert });
}

const profiles = {
  year_sport_product: [],
  year_sport_product_set: [],
  year_sport_product_set_card_code: []
};
const candidateCounts = Object.fromEntries(Object.keys(profiles).map((key) => [key, []]));
for (const row of sampledRows) {
  const base = { year: row.season_year, sport: row.sport, product: row.product };
  const product = timedQuery(index, base);
  profiles.year_sport_product.push(product.elapsed_ms);
  candidateCounts.year_sport_product.push(product.candidate_count);

  const set = timedQuery(index, { ...base, set: row.set_or_insert });
  profiles.year_sport_product_set.push(set.elapsed_ms);
  candidateCounts.year_sport_product_set.push(set.candidate_count);

  const card = Array.isArray(row.cards) ? row.cards.find((value) => value) : null;
  const cardCode = typeof card === "object"
    ? card.card_code ?? card.card_number ?? card.checklist_code ?? card.code
    : card;
  if (cardCode) {
    const code = timedQuery(index, { ...base, set: row.set_or_insert, card_code: cardCode });
    profiles.year_sport_product_set_card_code.push(code.elapsed_ms);
    candidateCounts.year_sport_product_set_card_code.push(code.candidate_count);
  }
}

const memoryDelta = (field) => afterBuild[field] - beforeBuild[field];
const sourceRowsWithCards = pack.rows.filter((row) => Array.isArray(row.cards) && row.cards.length > 0).length;
const sourceNestedCardCount = pack.rows.reduce((sum, row) => sum + (Array.isArray(row.cards) ? row.cards.length : 0), 0);
const report = {
  schema_version: "release-pack-memory-index-benchmark-v1",
  generated_at: new Date().toISOString(),
  mode: "OFFLINE_SHADOW_ONLY",
  production_behavior_changed: false,
  holdout_consumed: false,
  source: {
    path: sourcePath,
    bytes: bytes.length,
    sha256: sourceSha256,
    declared_row_count: pack.row_count ?? null,
    parsed_row_count: pack.rows.length,
    rows_with_cards: sourceRowsWithCards,
    nested_card_count: sourceNestedCardCount,
    schema_version: pack.schema_version ?? null,
    generated_at: pack.generated_at ?? null
  },
  timing_ms: {
    file_read: readMs,
    json_parse: parseMs,
    index_build: buildMs,
    queries: Object.fromEntries(Object.entries(profiles).map(([name, values]) => [name, summarize(values)]))
  },
  candidate_counts: Object.fromEntries(Object.entries(candidateCounts).map(([name, values]) => [name, summarize(values)])),
  memory_bytes: {
    gc_exposed: typeof global.gc === "function",
    measurement_scope: "parsed source retained; incremental values bracket index compilation with forced GC when available",
    process_before_read: beforeRead,
    incremental_index_heap_used: memoryDelta("heapUsed"),
    incremental_index_heap_total: memoryDelta("heapTotal"),
    incremental_index_rss: memoryDelta("rss"),
    process_after_build: afterBuild
  },
  index: {
    schema_version: index.schema_version,
    pack_version: index.pack_version,
    index_fingerprint: index.index_fingerprint,
    source_row_count: index.source_row_count,
    indexed_release_count: index.indexed_release_count,
    duplicate_release_count: index.duplicate_release_count,
    key_counts: index.key_counts
  },
  limitations: sourceNestedCardCount === 0 ? [{
    code: "SOURCE_CARD_CODES_ABSENT",
    detail: "All source rows contain empty cards arrays; the card-code contract is fixture-tested but has no real-source latency or accuracy denominator."
  }] : []
};

const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const absolute = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, rendered);
}
process.stdout.write(rendered);
