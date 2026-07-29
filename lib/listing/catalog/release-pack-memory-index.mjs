import { createHash } from "node:crypto";

// A Release Pack is an offline-compiled, immutable vocabulary index. It is a
// retrieval aid only: this module deliberately has no SEM, Resolver, Renderer,
// storage, queue, network or provider dependency.
export const releasePackIndexContractVersion = "release-pack-memory-index-v1";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalizedText = (value) => cleanText(value)
  .normalize("NFKC")
  .replace(/[®™©]/g, "")
  .toLowerCase()
  .trim();

function normalizedSeasonYear(value) {
  const text = normalizedText(value);
  const match = text.match(/^(?:season\s+)?((?:19|20)\d{2})(?:\s*[-/]\s*(?:\d{2}|\d{4}))?$/);
  return match?.[1] || text;
}

function normalizedCardCode(value) {
  return normalizedText(value)
    .replace(/^#\s*/, "")
    .replace(/[‐‑‒–—−/\s]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function assertSha256(value, field) {
  const hash = cleanText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new TypeError(`${field} must be a lowercase 64-character sha256`);
  }
  return hash;
}

function validateProvenance(input = {}) {
  const sourceId = cleanText(input.source_id);
  const sourceType = cleanText(input.source_type).toUpperCase();
  const sourceVersion = cleanText(input.source_version);
  if (!sourceId) throw new TypeError("provenance.source_id is required");
  if (!sourceType) throw new TypeError("provenance.source_type is required");
  if (!sourceVersion) throw new TypeError("provenance.source_version is required");
  return Object.freeze({
    source_id: sourceId,
    source_type: sourceType,
    source_version: sourceVersion,
    source_sha256: assertSha256(input.source_sha256, "provenance.source_sha256"),
    source_uri: cleanText(input.source_uri) || null,
    generated_at: cleanText(input.generated_at) || null
  });
}

function stableReleaseIdentity(record) {
  return [
    record.year_or_season,
    record.sport,
    record.manufacturer,
    record.brand,
    record.product,
    record.set_or_insert,
    record.source_set_name,
    record.program_id,
    record.card_set_id,
    record.card_codes.join("|")
  ].map(normalizedText).join("\u001f");
}

function cardCodesForRow(row = {}) {
  const values = [row.card_code, row.card_number, row.checklist_code];
  if (Array.isArray(row.cards)) {
    for (const card of row.cards) {
      if (typeof card === "string" || typeof card === "number") values.push(card);
      else if (card && typeof card === "object") {
        values.push(card.card_code, card.card_number, card.checklist_code, card.code);
      }
    }
  }
  return [...new Set(values.map(normalizedCardCode).filter(Boolean))].sort();
}

function releaseRecord(row = {}) {
  return {
    year_or_season: cleanText(row.season_year ?? row.season ?? row.year ?? row.release_year),
    sport: cleanText(row.sport ?? row.category),
    manufacturer: cleanText(row.manufacturer),
    brand: cleanText(row.brand),
    product: cleanText(row.product ?? row.product_name),
    set_or_insert: cleanText(row.set_or_insert ?? row.set ?? row.insert),
    source_set_name: cleanText(row.source_set_name),
    program_id: cleanText(row.program_id) || null,
    card_set_id: cleanText(row.card_set_id) || null,
    card_codes: cardCodesForRow(row)
  };
}

function normalizedDimensions(record) {
  return {
    year: normalizedSeasonYear(record.year_or_season),
    sport: normalizedText(record.sport),
    product: normalizedText(record.product),
    sets: [...new Set([record.set_or_insert, record.source_set_name].map(normalizedText).filter(Boolean))],
    card_codes: record.card_codes
  };
}

function pushPosting(index, key, id) {
  if (!key) return;
  const posting = index.get(key);
  if (posting) posting.push(id);
  else index.set(key, [id]);
}

function freezePostings(index) {
  for (const [key, ids] of index) index.set(key, Uint32Array.from(ids));
  return index;
}

function intersectSorted(left, right) {
  if (!right) return [];
  if (!left) return right ? Array.from(right) : [];
  const output = [];
  let a = 0;
  let b = 0;
  while (a < left.length && b < right.length) {
    const leftId = left[a];
    const rightId = right[b];
    if (leftId === rightId) {
      output.push(leftId);
      a += 1;
      b += 1;
    } else if (leftId < rightId) a += 1;
    else b += 1;
  }
  return output;
}

function queryDimensions(query = {}) {
  return [
    ["year_or_season", normalizedSeasonYear(query.year_or_season ?? query.season ?? query.year)],
    ["sport", normalizedText(query.sport)],
    ["product", normalizedText(query.product)],
    ["set_or_insert", normalizedText(query.set_or_insert ?? query.set ?? query.insert)],
    ["card_code", normalizedCardCode(query.card_code ?? query.card_number ?? query.checklist_code)]
  ].filter(([, value]) => Boolean(value));
}

function finiteLimit(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 100);
}

function publicCandidate(record, releaseId, provenance) {
  return Object.freeze({
    release_id: releaseId,
    year_or_season: record.year_or_season || null,
    sport: record.sport || null,
    manufacturer: record.manufacturer || null,
    brand: record.brand || null,
    product: record.product || null,
    set_or_insert: record.set_or_insert || null,
    source_set_name: record.source_set_name || null,
    program_id: record.program_id,
    card_set_id: record.card_set_id,
    matched_card_codes: Object.freeze([...record.card_codes]),
    provenance
  });
}

export function compileReleasePackMemoryIndex({ rows, provenance, pack_version: packVersion } = {}) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const source = validateProvenance(provenance);
  const version = cleanText(packVersion);
  if (!version) throw new TypeError("pack_version is required");

  const canonical = rows
    .map(releaseRecord)
    .filter((record) => record.year_or_season || record.sport || record.product || record.set_or_insert)
    .map((record) => ({ record, identity: stableReleaseIdentity(record) }))
    .sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0);

  const records = [];
  let previousIdentity = null;
  for (const item of canonical) {
    if (item.identity === previousIdentity) continue;
    previousIdentity = item.identity;
    records.push(item.record);
  }

  const indexFingerprint = createHash("sha256").update(JSON.stringify({
    contract_version: releasePackIndexContractVersion,
    pack_version: version,
    source_id: source.source_id,
    source_type: source.source_type,
    source_version: source.source_version,
    source_sha256: source.source_sha256
  })).digest("hex");
  const indexes = {
    year_or_season: new Map(),
    sport: new Map(),
    product: new Map(),
    set_or_insert: new Map(),
    card_code: new Map()
  };
  const candidates = records.map((record, id) => {
    const dimensions = normalizedDimensions(record);
    pushPosting(indexes.year_or_season, dimensions.year, id);
    pushPosting(indexes.sport, dimensions.sport, id);
    pushPosting(indexes.product, dimensions.product, id);
    for (const setName of dimensions.sets) pushPosting(indexes.set_or_insert, setName, id);
    for (const cardCode of dimensions.card_codes) pushPosting(indexes.card_code, cardCode, id);
    return publicCandidate(record, `release:${indexFingerprint.slice(0, 12)}:${id}`, source);
  });
  for (const index of Object.values(indexes)) freezePostings(index);
  Object.freeze(candidates);

  const query = (input = {}, options = {}) => {
    const dimensions = queryDimensions(input);
    const trace = [];
    let matches = null;
    for (const [dimension, value] of dimensions) {
      const posting = indexes[dimension].get(value);
      matches = intersectSorted(matches, posting);
      trace.push(Object.freeze({
        dimension,
        normalized_value: value,
        candidate_count: matches.length
      }));
      if (matches.length === 0) break;
    }
    if (matches === null) matches = [];
    const limit = finiteLimit(options.limit, 20);
    const count = matches.length;
    return Object.freeze({
      schema_version: "release-pack-query-result-v1",
      index_fingerprint: indexFingerprint,
      pack_version: version,
      source,
      query_dimensions: Object.freeze(dimensions.map(([dimension, value]) => Object.freeze({ dimension, normalized_value: value }))),
      narrowing_trace: Object.freeze(trace),
      match_status: count === 0 ? "NOT_FOUND" : count === 1 ? "UNIQUE" : "AMBIGUOUS",
      ambiguous: count > 1,
      candidate_count: count,
      truncated: count > limit,
      candidates: Object.freeze(matches.slice(0, limit).map((id) => candidates[id]))
    });
  };

  return Object.freeze({
    schema_version: releasePackIndexContractVersion,
    pack_version: version,
    index_fingerprint: indexFingerprint,
    source,
    source_row_count: rows.length,
    indexed_release_count: candidates.length,
    duplicate_release_count: canonical.length - candidates.length,
    key_counts: Object.freeze(Object.fromEntries(
      Object.entries(indexes).map(([name, index]) => [name, index.size])
    )),
    query
  });
}
