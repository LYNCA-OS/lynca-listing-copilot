import { createHash } from "node:crypto";

export const cardLevelReleasePackAuditVersion = "card-level-release-pack-audit-v3";
export const cardLevelReleasePackDatasetBindingVersion =
  "card-level-release-pack-dataset-binding-v1";

const allowedSplits = new Set(["development", "validation"]);
const manifestSplits = Object.freeze(["development", "validation", "holdout"]);
const manifestLeakagePairs = Object.freeze([
  ["development", "validation", "development_validation"],
  ["development", "holdout", "development_holdout"],
  ["validation", "holdout", "validation_holdout"]
]);
const identityFields = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_number",
  "print_finish",
  "serial_denominator"
]);

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function normalizedText(value) {
  return cleanText(Array.isArray(value) ? value.join(" ") : value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedYear(value) {
  return normalizedText(value).replace(/\s*\/\s*/g, "-");
}

function yearQueryAlias(value) {
  return normalizedYear(value).match(/(?:19|20)\d{2}/)?.[0] || normalizedYear(value);
}

function normalizedProduct(value, manufacturer = "") {
  let product = normalizedText(value).replace(/^(?:19|20)\d{2}\s+/, "");
  const maker = normalizedText(manufacturer);
  if (maker && product.startsWith(`${maker} `)) product = product.slice(maker.length + 1);
  return product
    .replace(/\s+(?:baseball|basketball|football|hockey|soccer|wrestling|ufc|wwe)$/, "")
    .trim();
}

function normalizedCardNumber(value) {
  return normalizedText(value)
    .replace(/^number\s+/, "")
    .replace(/^0+(?=\d)/, "")
    .replace(/\s+/g, "-");
}

function normalizedSubjects(value) {
  const values = Array.isArray(value) ? value : [value];
  const subjects = values
    .flatMap((entry) => String(entry ?? "").split(/\s*(?:\/|&|\band\b)\s*/i))
    .map(normalizedText)
    .filter(Boolean);
  return [...new Set(subjects)].sort();
}

function normalizedIdentityFields(raw = {}) {
  const manufacturer = normalizedText(raw.manufacturer ?? raw.brand);
  return Object.freeze({
    year: normalizedYear(raw.year ?? raw.season_year ?? raw.season ?? raw.product_year),
    year_query_alias: yearQueryAlias(raw.year ?? raw.season_year ?? raw.season ?? raw.product_year),
    manufacturer,
    product: normalizedProduct(raw.product ?? raw.product_name, manufacturer),
    set: normalizedText(raw.set ?? raw.set_or_insert ?? raw.insert ?? raw.subset),
    subject: normalizedSubjects(raw.subject ?? raw.players ?? raw.player ?? raw.metadata?.character).join("|"),
    card_number: normalizedCardNumber(
      raw.card_number ?? raw.collector_number ?? raw.checklist_code ?? raw.tcg_card_number
    ),
    print_finish: normalizedText(raw.print_finish ?? raw.surface_color),
    serial_denominator: normalizedText(
      raw.serial_denominator ?? raw.numerical_rarity?.denominator
    ).replace(/^0+(?=\d)/, "")
  });
}

function publicIdentityFields(raw = {}) {
  return Object.freeze({
    year: cleanText(raw.year ?? raw.season_year ?? raw.season ?? raw.product_year) || null,
    manufacturer: cleanText(raw.manufacturer ?? raw.brand) || null,
    product: cleanText(raw.product ?? raw.product_name) || null,
    set: cleanText(raw.set ?? raw.set_or_insert ?? raw.insert ?? raw.subset) || null,
    subject: Object.freeze(normalizedSubjects(
      raw.subject ?? raw.players ?? raw.player ?? raw.metadata?.character
    )),
    card_number: cleanText(
      raw.card_number ?? raw.collector_number ?? raw.checklist_code ?? raw.tcg_card_number
    ) || null,
    print_finish: cleanText(raw.print_finish ?? raw.surface_color) || null,
    serial_denominator: cleanText(
      raw.serial_denominator ?? raw.numerical_rarity?.denominator
    ) || null
  });
}

function rawCatalogIdentityFields(raw = {}) {
  return {
    year: raw.year ?? raw.season_year ?? raw.season ?? raw.product_year ?? "",
    manufacturer: raw.manufacturer ?? raw.brand ?? "",
    product: raw.product ?? raw.product_name ?? "",
    set: raw.set ?? raw.set_or_insert ?? raw.insert ?? raw.subset ?? "",
    subject: Array.isArray(raw.players) && raw.players.length
      ? raw.players
      : (raw.subject ?? raw.player ?? raw.metadata?.character ?? []),
    card_number: raw.card_number ?? raw.collector_number ?? raw.checklist_code
      ?? raw.tcg_card_number ?? "",
    print_finish: raw.print_finish ?? raw.surface_color ?? "",
    serial_denominator: raw.serial_denominator ?? raw.numerical_rarity?.denominator ?? ""
  };
}

export function canonicalCardIdentityId(fields = {}) {
  const identity = identityFields.map((field) => {
    const value = Array.isArray(fields[field])
      ? [...new Set(fields[field].map(normalizedText).filter(Boolean))].sort()
      : normalizedText(fields[field]);
    return [field, value];
  });
  return `card_identity:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function publicIdentityFieldsFromNormalized(normalized = {}) {
  return Object.freeze({
    year: normalized.year || null,
    manufacturer: normalized.manufacturer || null,
    product: normalized.product || null,
    set: normalized.set || null,
    subject: Object.freeze(normalized.subject ? normalized.subject.split("|") : []),
    card_number: normalized.card_number || null,
    print_finish: normalized.print_finish || null,
    serial_denominator: normalized.serial_denominator || null
  });
}

function sourceClass(card = {}) {
  const type = cleanText(card.source?.source_type).toUpperCase();
  if (/(?:OFFICIAL|CARDLIST|DATABASE)/.test(type)) return "official";
  if (type === "INTERNAL_CORRECTED_TITLE") {
    return card.source?.source_metadata?.writer_title_batch_id ? "writer" : "reviewed";
  }
  return "ineligible";
}

function sha256Value(value) {
  const text = cleanText(value).toLowerCase().replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    stableJsonValue(value[key])
  ]));
}

function fingerprintDatasetPartitions(partitions = {}) {
  const output = {};
  for (const split of manifestSplits) {
    if (!Array.isArray(partitions[split])) {
      throw new Error(`INVALID_FROZEN_SOURCE_MANIFEST:PARTITION_NOT_ARRAY:${split}`);
    }
    output[split] = partitions[split].map((value) => cleanText(value));
  }
  return output;
}

/**
 * Hashes the exact truth-bearing development/validation packet selected by a
 * frozen manifest. Holdout records are rejected before their content is read.
 * Object key order and input item order cannot change the digest.
 */
function truthItemIsReleasePackEligible(item = {}) {
  const truth = item.retrieval_ground_truth || {};
  const provenance = truth.provenance || {};
  return truth.retrieval_evaluable === true
    && Boolean(truth.accepted_identity_ids?.[0])
    && provenance.independent_from_system_under_test === true
    && provenance.sealed_from_system === true
    && Boolean(provenance.source_id)
    && Boolean(sha256Value(provenance.source_version))
    && Array.isArray(truth.sealed_source_candidate_ids)
    && truth.sealed_source_candidate_ids.length > 0;
}

export function cardLevelReleasePackDatasetBindingMeasurements({
  dataset = {},
  partitions = {}
} = {}) {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    throw new Error("INVALID_TRUTH_DATASET:ROOT_NOT_OBJECT");
  }
  if (!Array.isArray(dataset.items)) throw new Error("INVALID_TRUTH_DATASET:ITEMS_NOT_ARRAY");
  const frozenPartitions = fingerprintDatasetPartitions(partitions);
  const expectedIds = new Set([
    ...frozenPartitions.development,
    ...frozenPartitions.validation
  ]);
  const holdoutIds = new Set(frozenPartitions.holdout);
  const itemsById = new Map();
  for (const item of dataset.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("INVALID_TRUTH_DATASET:ITEM_NOT_OBJECT");
    }
    const itemId = cleanText(item.item_id);
    if (!itemId) throw new Error("INVALID_TRUTH_DATASET:EMPTY_ITEM_ID");
    if (holdoutIds.has(itemId)) throw new Error(`HOLDOUT_INPUT_REJECTED:${itemId}`);
    if (!expectedIds.has(itemId)) throw new Error(`TRUTH_DATASET_ITEM_OUTSIDE_DEVVAL:${itemId}`);
    if (itemsById.has(itemId)) throw new Error(`TRUTH_DATASET_DUPLICATE_ITEM_ID:${itemId}`);
    itemsById.set(itemId, item);
  }
  const truthItems = [...itemsById.entries()]
    .filter(([, item]) => truthItemIsReleasePackEligible(item))
    .sort(([left], [right]) => left.localeCompare(right));
  if (truthItems.length === 0) throw new Error("TRUTH_DATASET_HAS_NO_ELIGIBLE_IDENTITY_TRUTH");
  const datasetContract = Object.fromEntries([
    "schema_version",
    "dataset_id",
    "sem_standard_version",
    "source",
    "evaluation_truth_policy",
    "promotion_contract",
    "review_contract"
  ].filter((key) => Object.hasOwn(dataset, key)).map((key) => [key, dataset[key]]));
  const content = {
    fingerprint_contract: cardLevelReleasePackDatasetBindingVersion,
    dataset_contract: datasetContract,
    items: truthItems.map(([, item]) => item)
  };
  const truthItemIds = truthItems.map(([itemId]) => itemId);
  return Object.freeze({
    truth_item_count: truthItems.length,
    truth_item_ids_sha256: createHash("sha256")
      .update(JSON.stringify(truthItemIds))
      .digest("hex"),
    truth_dataset_content_fingerprint_sha256: createHash("sha256")
    .update(JSON.stringify(stableJsonValue(content)))
      .digest("hex")
  });
}

export function cardLevelReleasePackDatasetFingerprint(input = {}) {
  return cardLevelReleasePackDatasetBindingMeasurements(input)
    .truth_dataset_content_fingerprint_sha256;
}

function stringSet(value) {
  return new Set((Array.isArray(value) ? value : []).map(cleanText).filter(Boolean));
}

function hashSet(value) {
  return new Set((Array.isArray(value) ? value : []).map(sha256Value).filter(Boolean));
}

function sourceRecord(card = {}) {
  const source = card.source || {};
  const metadata = source.source_metadata || {};
  const sourceClassification = sourceClass(card);
  return Object.freeze({
    row_id: cleanText(card.id),
    source_class: sourceClassification,
    source_type: cleanText(source.source_type).toUpperCase(),
    canonical_identity_id: canonicalCardIdentityId(rawCatalogIdentityFields(card)),
    identity_attested: sourceClassification === "official"
      || metadata.identity_fields_reviewed === true
      || metadata.title_derived_fields_are_ground_truth === true,
    source_ids: Object.freeze([...stringSet([
      source.id,
      source.source_id,
      metadata.source_id,
      metadata.source_feedback_id,
      metadata.writer_title_batch_id,
      metadata.source_file_name,
      ...(Array.isArray(metadata.derived_from_source_ids) ? metadata.derived_from_source_ids : [])
    ])].sort()),
    feedback_id: normalizedText(metadata.source_feedback_id),
    content_hashes: Object.freeze([...hashSet([
      source.source_version,
      source.content_sha256,
      metadata.source_file_sha256,
      metadata.content_sha256,
      ...(Array.isArray(metadata.derived_from_content_sha256)
        ? metadata.derived_from_content_sha256
        : [])
    ])].sort())
  });
}

function identityKey(fields) {
  return identityFields.map((field) => `${field}:${fields[field]}`).join("\u001f");
}

function validPackProvenance(provenance = {}) {
  const sourceId = cleanText(provenance.source_id);
  const sourceVersion = cleanText(provenance.source_version);
  const sourceSha256 = sha256Value(provenance.source_sha256);
  if (!sourceId) throw new TypeError("provenance.source_id is required");
  if (!sourceVersion) throw new TypeError("provenance.source_version is required");
  if (!sourceSha256) throw new TypeError("provenance.source_sha256 must be sha256");
  return Object.freeze({
    source_id: sourceId,
    source_type: cleanText(provenance.source_type).toUpperCase() || "TRUSTED_CATALOG_SNAPSHOT",
    source_version: sourceVersion,
    source_sha256: sourceSha256
  });
}

function pushPosting(index, key, id) {
  if (!key) return;
  const posting = index.get(key);
  if (posting) posting.push(id);
  else index.set(key, [id]);
}

function freezePostings(index) {
  for (const [key, ids] of index) index.set(key, Uint32Array.from(ids));
}

function sourceIsIndependent(source, exclusion = {}) {
  if (exclusion.sealed_row_ids?.has(source.row_id)) return false;
  if (source.feedback_id && exclusion.feedback_ids?.has(source.feedback_id)) return false;
  if (source.source_ids.some((id) => exclusion.source_ids?.has(id))) return false;
  if (source.content_hashes.some((hash) => exclusion.content_hashes?.has(hash))) return false;
  return true;
}

function comparison(candidate, truth) {
  let conflictCount = 0;
  let exactMatchCount = 0;
  let missingCount = 0;
  const details = {};
  for (const field of identityFields) {
    const expected = truth[field];
    const observed = candidate[field];
    if (!expected) {
      details[field] = "NOT_IN_TRUTH";
      continue;
    }
    if (!observed) {
      missingCount += 1;
      details[field] = "CANDIDATE_EMPTY";
    } else if (observed === expected) {
      exactMatchCount += 1;
      details[field] = "EXACT";
    } else if (field === "year" && candidate.year_query_alias === truth.year_query_alias) {
      exactMatchCount += 1;
      details[field] = "QUERY_ALIAS_ONLY";
    } else {
      conflictCount += 1;
      details[field] = "CONFLICT";
    }
  }
  const knownFieldCount = identityFields.filter((field) => truth[field]).length;
  const strictExact = knownFieldCount > 0
    && identityFields.every((field) => !truth[field] || candidate[field] === truth[field]);
  const coreFields = ["year", "manufacturer", "product", "subject", "card_number"]
    .filter((field) => truth[field]);
  const coreExact = coreFields.length >= 3
    && coreFields.every((field) => {
      if (field === "year") return candidate.year_query_alias === truth.year_query_alias;
      return candidate[field] && candidate[field] === truth[field];
    });
  return Object.freeze({
    strict_exact: strictExact,
    query_compatible_core: coreExact,
    conflict_count: conflictCount,
    exact_match_count: exactMatchCount,
    candidate_missing_count: missingCount,
    known_field_count: knownFieldCount,
    field_comparison: Object.freeze(details)
  });
}

function rankTuple(candidate) {
  const sourcePriority = candidate.sources.some((source) => source.source_class === "official")
    ? 3
    : candidate.sources.some((source) => source.source_class === "reviewed")
      ? 2
      : 1;
  return [
    candidate.comparison.conflict_count,
    -candidate.comparison.exact_match_count,
    candidate.comparison.candidate_missing_count,
    -sourcePriority
  ];
}

function compareRank(left, right) {
  const leftTuple = rankTuple(left);
  const rightTuple = rankTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] !== rightTuple[index]) return leftTuple[index] - rightTuple[index];
  }
  return left.identity_fingerprint.localeCompare(right.identity_fingerprint);
}

export function compileCardLevelReleasePackIndex({ cards, provenance, pack_version: packVersion } = {}) {
  if (!Array.isArray(cards)) throw new TypeError("cards must be an array");
  const source = validPackProvenance(provenance);
  const version = cleanText(packVersion);
  if (!version) throw new TypeError("pack_version is required");

  const byIdentity = new Map();
  let skippedEligibleRowCount = 0;
  const sourceRowCounts = { official: 0, writer: 0, reviewed: 0, ineligible: 0 };
  for (const card of cards) {
    const classification = sourceClass(card);
    sourceRowCounts[classification] += 1;
    if (classification === "ineligible") continue;
    const normalized = normalizedIdentityFields(card);
    if (!normalized.year_query_alias && !normalized.product && !normalized.subject && !normalized.card_number) {
      skippedEligibleRowCount += 1;
      continue;
    }
    const key = identityKey(normalized);
    const existing = byIdentity.get(key);
    const rowSource = sourceRecord(card);
    if (existing) {
      existing.sources.push(rowSource);
      continue;
    }
    byIdentity.set(key, {
      key,
      normalized,
      fields: publicIdentityFieldsFromNormalized(normalized),
      sources: [rowSource]
    });
  }

  const records = [...byIdentity.values()].sort((left, right) => left.key.localeCompare(right.key));
  const packContentFingerprint = createHash("sha256").update(JSON.stringify(records.map((record) => ({
    key: record.key,
    sources: [...record.sources]
      .map((entry) => ({
        row_id: entry.row_id,
        source_class: entry.source_class,
        source_type: entry.source_type,
        canonical_identity_id: entry.canonical_identity_id,
        identity_attested: entry.identity_attested,
        source_ids: entry.source_ids,
        feedback_id: entry.feedback_id,
        content_hashes: entry.content_hashes
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  })))).digest("hex");
  const packFingerprint = createHash("sha256").update(JSON.stringify({
    contract_version: cardLevelReleasePackAuditVersion,
    pack_version: version,
    source,
    pack_content_fingerprint: packContentFingerprint
  })).digest("hex");
  const indexes = {
    year: new Map(),
    product: new Map(),
    year_product: new Map(),
    subject: new Map(),
    card_number: new Map()
  };
  const candidates = records.map((record, id) => {
    pushPosting(indexes.year, record.normalized.year_query_alias, id);
    pushPosting(indexes.product, record.normalized.product, id);
    pushPosting(
      indexes.year_product,
      record.normalized.year_query_alias && record.normalized.product
        ? `${record.normalized.year_query_alias}\u001f${record.normalized.product}`
        : "",
      id
    );
    pushPosting(indexes.subject, record.normalized.subject, id);
    pushPosting(indexes.card_number, record.normalized.card_number, id);
    const identityFingerprint = createHash("sha256").update(record.key).digest("hex");
    const canonicalIdentityIds = [...new Set(record.sources.map((entry) => (
      entry.canonical_identity_id
    )))].sort();
    return Object.freeze({
      candidate_id: `card-release:${packFingerprint.slice(0, 12)}:${id}`,
      identity_fingerprint: identityFingerprint,
      canonical_identity_ids: Object.freeze(canonicalIdentityIds),
      fields: record.fields,
      normalized: record.normalized,
      sources: Object.freeze([...record.sources].sort((left, right) => (
        `${left.source_class}:${left.row_id}`.localeCompare(`${right.source_class}:${right.row_id}`)
      )))
    });
  });
  for (const index of Object.values(indexes)) freezePostings(index);

  const query = (input = {}, options = {}) => {
    const truth = normalizedIdentityFields(input);
    let seeds = [
      { dimension: "card_number", posting: indexes.card_number.get(truth.card_number) },
      { dimension: "subject", posting: indexes.subject.get(truth.subject) },
      { dimension: "year_product", posting: indexes.year_product.get(
        truth.year_query_alias && truth.product
          ? `${truth.year_query_alias}\u001f${truth.product}`
          : ""
      ) }
    ].filter((entry) => entry.posting);
    if (seeds.length === 0) {
      seeds = [{ dimension: "product", posting: indexes.product.get(truth.product) }]
        .filter((entry) => entry.posting);
    }
    seeds.sort((left, right) => left.posting.length - right.posting.length
      || left.dimension.localeCompare(right.dimension));
    const seed = seeds[0] || null;
    const poolIds = seed ? Array.from(seed.posting) : [];
    const exclusion = options.exclusion || {};
    const ranked = poolIds.flatMap((id) => {
      const candidate = candidates[id];
      const independentSources = candidate.sources.filter((entry) => sourceIsIndependent(entry, exclusion));
      if (independentSources.length === 0) return [];
      return [{
        candidate_id: candidate.candidate_id,
        identity_fingerprint: candidate.identity_fingerprint,
        canonical_identity_ids: Object.freeze([...new Set(independentSources
          .filter((entry) => entry.identity_attested)
          .map((entry) => entry.canonical_identity_id))].sort()),
        fields: candidate.fields,
        normalized: candidate.normalized,
        sources: Object.freeze(independentSources),
        comparison: comparison(candidate.normalized, truth)
      }];
    }).sort(compareRank);
    const strictCandidates = ranked.filter((candidate) => candidate.comparison.strict_exact);
    const coreCandidates = ranked.filter((candidate) => candidate.comparison.query_compatible_core);
    const acceptedIdentityIds = new Set(
      (Array.isArray(options.accepted_identity_ids) ? options.accepted_identity_ids : [])
        .map(cleanText)
        .filter(Boolean)
    );
    const acceptedCandidates = ranked.filter((candidate) => (
      candidate.canonical_identity_ids.some((identityId) => acceptedIdentityIds.has(identityId))
    ));
    const bestStrict = strictCandidates[0] || null;
    const bestCore = coreCandidates[0] || null;
    const ordinalRank = (best) => best ? ranked.indexOf(best) + 1 : null;
    const acceptedRank = acceptedCandidates.length > 0 ? ranked.indexOf(acceptedCandidates[0]) + 1 : null;
    const limit = Math.max(0, Math.min(100, Number.isInteger(options.limit) ? options.limit : 20));
    return Object.freeze({
      schema_version: "card-level-release-pack-query-v1",
      pack_fingerprint: packFingerprint,
      query_source: options.query_source || "OBSERVATION",
      seed_dimension: seed?.dimension || null,
      candidate_pool_count: ranked.length,
      independent_candidate_count: ranked.length,
      strict_exact_identity_count: strictCandidates.length,
      query_compatible_core_count: coreCandidates.length,
      accepted_identity_match_count: acceptedCandidates.length,
      accepted_identity_rank: acceptedRank,
      strict_exact_ordinal_rank: ordinalRank(bestStrict),
      core_ordinal_rank: ordinalRank(bestCore),
      strict_exact_unique: strictCandidates.length === 1,
      core_unique: coreCandidates.length === 1,
      candidates: Object.freeze(ranked.slice(0, limit).map((candidate, index) => Object.freeze({
        rank: index + 1,
        candidate_id: candidate.candidate_id,
        identity_fingerprint: candidate.identity_fingerprint,
        canonical_identity_ids: candidate.canonical_identity_ids,
        fields: candidate.fields,
        source_classes: Object.freeze([...new Set(candidate.sources.map((entry) => entry.source_class))].sort()),
        comparison: candidate.comparison
      })))
    });
  };

  return Object.freeze({
    schema_version: "card-level-release-pack-index-v1",
    pack_version: version,
    pack_fingerprint: packFingerprint,
    pack_content_fingerprint: packContentFingerprint,
    source,
    source_row_count: cards.length,
    eligible_source_row_count: cards.length - sourceRowCounts.ineligible,
    indexed_identity_count: candidates.length,
    skipped_eligible_row_count: skippedEligibleRowCount,
    duplicate_identity_row_count: cards.length - sourceRowCounts.ineligible
      - skippedEligibleRowCount - candidates.length,
    source_row_counts: Object.freeze(sourceRowCounts),
    key_counts: Object.freeze(Object.fromEntries(
      Object.entries(indexes).map(([name, index]) => [name, index.size])
    )),
    query
  });
}

export function validateCardLevelReleasePackManifest(manifest = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("INVALID_FROZEN_SOURCE_MANIFEST:ROOT_NOT_OBJECT");
  }
  if (manifest.schema_version !== "v4-oracle-reproducible-split-manifest-v1") {
    throw new Error("INVALID_FROZEN_SOURCE_MANIFEST:SCHEMA_VERSION");
  }
  const frozenAssignmentId = cleanText(manifest.frozen_assignment_id);
  if (!frozenAssignmentId) {
    throw new Error("INVALID_FROZEN_SOURCE_MANIFEST:FROZEN_ASSIGNMENT_ID");
  }
  const sourceFingerprint = sha256Value(manifest.source_fingerprint_sha256);
  if (!sourceFingerprint) {
    throw new Error("INVALID_FROZEN_SOURCE_MANIFEST:SOURCE_FINGERPRINT");
  }
  if (!manifest.partitions || typeof manifest.partitions !== "object"
    || Array.isArray(manifest.partitions)) {
    throw new Error("INVALID_FROZEN_SOURCE_MANIFEST:PARTITIONS_NOT_OBJECT");
  }
  const unknownPartitions = Object.keys(manifest.partitions)
    .filter((split) => !manifestSplits.includes(split));
  if (unknownPartitions.length > 0) {
    throw new Error(
      `INVALID_FROZEN_SOURCE_MANIFEST:UNKNOWN_PARTITION:${unknownPartitions.sort().join(",")}`
    );
  }

  const partitions = {};
  for (const split of manifestSplits) {
    const rawIds = manifest.partitions[split];
    if (!Array.isArray(rawIds)) {
      throw new Error(`INVALID_FROZEN_SOURCE_MANIFEST:PARTITION_NOT_ARRAY:${split}`);
    }
    const ids = rawIds.map((rawId, index) => {
      if (typeof rawId !== "string" && typeof rawId !== "number") {
        throw new Error(`INVALID_FROZEN_SOURCE_MANIFEST:INVALID_ITEM_ID:${split}:${index}`);
      }
      const itemId = cleanText(rawId);
      if (!itemId) {
        throw new Error(`INVALID_FROZEN_SOURCE_MANIFEST:EMPTY_ITEM_ID:${split}:${index}`);
      }
      if (typeof rawId === "string" && rawId !== itemId) {
        throw new Error(`INVALID_FROZEN_SOURCE_MANIFEST:NON_CANONICAL_ITEM_ID:${split}:${index}`);
      }
      return itemId;
    });
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error(`INVALID_FROZEN_SOURCE_MANIFEST:DUPLICATE_ITEM_ID:${split}`);
    }
    partitions[split] = Object.freeze(ids);
  }

  if (!manifest.actual_counts || typeof manifest.actual_counts !== "object"
    || Array.isArray(manifest.actual_counts)) {
    throw new Error("INVALID_FROZEN_SOURCE_MANIFEST:ACTUAL_COUNTS_NOT_OBJECT");
  }
  const recomputedActualCounts = {};
  for (const split of manifestSplits) {
    const claimed = manifest.actual_counts[split];
    const actual = partitions[split].length;
    if (!Number.isInteger(claimed) || claimed < 0 || claimed !== actual) {
      throw new Error(
        `INVALID_FROZEN_SOURCE_MANIFEST:ACTUAL_COUNT_MISMATCH:${split}:${claimed}:${actual}`
      );
    }
    recomputedActualCounts[split] = actual;
  }

  if (!manifest.leakage_check || typeof manifest.leakage_check !== "object"
    || Array.isArray(manifest.leakage_check)) {
    throw new Error("INVALID_FROZEN_SOURCE_MANIFEST:LEAKAGE_CHECK_NOT_OBJECT");
  }
  const recomputedLeakage = {};
  for (const [leftSplit, rightSplit, field] of manifestLeakagePairs) {
    const rightIds = new Set(partitions[rightSplit]);
    const overlapCount = partitions[leftSplit].filter((itemId) => rightIds.has(itemId)).length;
    recomputedLeakage[field] = overlapCount;
    if (overlapCount !== 0) {
      throw new Error(`INVALID_FROZEN_SOURCE_MANIFEST:CROSS_SPLIT_LEAKAGE:${field}:${overlapCount}`);
    }
    const claimed = manifest.leakage_check[field];
    if (!Number.isInteger(claimed) || claimed !== overlapCount) {
      throw new Error(
        `INVALID_FROZEN_SOURCE_MANIFEST:LEAKAGE_ASSERTION_MISMATCH:${field}:${claimed}:${overlapCount}`
      );
    }
  }

  return Object.freeze({
    schema_version: manifest.schema_version,
    frozen_assignment_id: frozenAssignmentId,
    source_fingerprint_sha256: sourceFingerprint,
    partitions: Object.freeze(partitions),
    actual_counts: Object.freeze(recomputedActualCounts),
    leakage_check: Object.freeze(recomputedLeakage)
  });
}

export function validateCardLevelReleasePackDatasetBinding({
  dataset = {},
  manifest = {},
  binding = {}
} = {}) {
  const validatedManifest = validateCardLevelReleasePackManifest(manifest);
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("INVALID_TRUTH_DATASET_BINDING:ROOT_NOT_OBJECT");
  }
  if (binding.schema_version !== cardLevelReleasePackDatasetBindingVersion) {
    throw new Error("INVALID_TRUTH_DATASET_BINDING:SCHEMA_VERSION");
  }
  if (cleanText(binding.frozen_assignment_id) !== validatedManifest.frozen_assignment_id) {
    throw new Error("INVALID_TRUTH_DATASET_BINDING:FROZEN_ASSIGNMENT_ID");
  }
  if (sha256Value(binding.manifest_source_fingerprint_sha256)
    !== validatedManifest.source_fingerprint_sha256) {
    throw new Error("INVALID_TRUTH_DATASET_BINDING:MANIFEST_SOURCE_FINGERPRINT");
  }
  const manifestContentFingerprint = createHash("sha256")
    .update(JSON.stringify(stableJsonValue(manifest)))
    .digest("hex");
  const expectedManifestContentFingerprint = sha256Value(
    binding.manifest_content_fingerprint_sha256
  );
  if (!expectedManifestContentFingerprint
    || expectedManifestContentFingerprint !== manifestContentFingerprint) {
    throw new Error("INVALID_TRUTH_DATASET_BINDING:MANIFEST_CONTENT_FINGERPRINT");
  }
  const datasetMeasurements = cardLevelReleasePackDatasetBindingMeasurements({
    dataset,
    partitions: validatedManifest.partitions
  });
  if (!Number.isInteger(binding.truth_item_count)
    || binding.truth_item_count !== datasetMeasurements.truth_item_count) {
    throw new Error("INVALID_TRUTH_DATASET_BINDING:TRUTH_ITEM_COUNT");
  }
  if (sha256Value(binding.truth_item_ids_sha256) !== datasetMeasurements.truth_item_ids_sha256) {
    throw new Error("INVALID_TRUTH_DATASET_BINDING:TRUTH_ITEM_IDS");
  }
  const datasetContentFingerprint = datasetMeasurements.truth_dataset_content_fingerprint_sha256;
  const expectedDatasetContentFingerprint = sha256Value(
    binding.truth_dataset_content_fingerprint_sha256
  );
  if (!expectedDatasetContentFingerprint
    || expectedDatasetContentFingerprint !== datasetContentFingerprint) {
    throw new Error(
      `TRUTH_DATASET_CONTENT_FINGERPRINT_MISMATCH:${expectedDatasetContentFingerprint || "missing"}:${datasetContentFingerprint}`
    );
  }
  return Object.freeze({
    schema_version: cardLevelReleasePackDatasetBindingVersion,
    frozen_assignment_id: validatedManifest.frozen_assignment_id,
    manifest_source_fingerprint_sha256: validatedManifest.source_fingerprint_sha256,
    manifest_content_fingerprint_sha256: manifestContentFingerprint,
    truth_item_count: datasetMeasurements.truth_item_count,
    truth_item_ids_sha256: datasetMeasurements.truth_item_ids_sha256,
    truth_dataset_content_fingerprint_sha256: datasetContentFingerprint,
    dataset_binding_verified: true
  });
}

function partitionByItemId(manifest = {}) {
  const output = new Map();
  for (const split of allowedSplits) {
    for (const itemId of manifest.partitions?.[split] || []) output.set(String(itemId), split);
  }
  return output;
}

function truthGroups(dataset = {}, manifest = {}) {
  const partitions = partitionByItemId(manifest);
  const holdoutIds = new Set((manifest.partitions?.holdout || []).map(String));
  const groups = new Map();
  for (const item of dataset.items || []) {
    if (holdoutIds.has(String(item.item_id))) {
      throw new Error(`HOLDOUT_INPUT_REJECTED:${item.item_id}`);
    }
    const truth = item.retrieval_ground_truth || {};
    const provenance = truth.provenance || {};
    const split = partitions.get(String(item.item_id));
    if (!split || !truthItemIsReleasePackEligible(item)) continue;
    const identityId = String(truth.accepted_identity_ids[0]);
    const existing = groups.get(identityId);
    if (existing && existing.split !== split) throw new Error(`IDENTITY_CROSSES_SPLITS:${identityId}`);
    const group = existing || {
      identity_id: identityId,
      accepted_identity_ids: new Set(truth.accepted_identity_ids.map(cleanText).filter(Boolean)),
      split,
      truth_fields: truth.identity_fields || {},
      item_ids: [],
      sealed_row_ids: new Set(),
      feedback_ids: new Set(),
      source_ids: new Set(),
      content_hashes: new Set()
    };
    group.item_ids.push(String(item.item_id));
    for (const acceptedIdentityId of truth.accepted_identity_ids) {
      group.accepted_identity_ids.add(cleanText(acceptedIdentityId));
    }
    for (const id of truth.sealed_source_candidate_ids) group.sealed_row_ids.add(cleanText(id));
    group.feedback_ids.add(normalizedText(item.source_feedback_id || item.item_id));
    group.source_ids.add(cleanText(provenance.source_id));
    group.content_hashes.add(sha256Value(provenance.source_version));
    groups.set(identityId, group);
  }
  return [...groups.values()];
}

function expandCorrelatedSourceExclusions(groups = [], cards = []) {
  const sourceByRowId = new Map((Array.isArray(cards) ? cards : []).map((card) => [
    cleanText(card.id),
    sourceRecord(card)
  ]));
  for (const group of groups) {
    for (const rowId of group.sealed_row_ids) {
      const source = sourceByRowId.get(rowId);
      if (!source) continue;
      if (source.feedback_id) group.feedback_ids.add(source.feedback_id);
      for (const sourceId of source.source_ids) group.source_ids.add(sourceId);
      for (const contentHash of source.content_hashes) group.content_hashes.add(contentHash);
    }
  }
  return groups;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function metrics(rows = []) {
  const count = (predicate) => rows.filter(predicate).length;
  const identityPresence = count((row) => row.accepted_identity_match_count > 0);
  const strictPresence = count((row) => row.strict_exact_identity_count > 0);
  const strictUnique = count((row) => row.strict_exact_unique);
  const corePresence = count((row) => row.query_compatible_core_count > 0);
  const coreUnique = count((row) => row.core_unique);
  const at = (field, maximumRank) => count((row) => (
    row[field] !== null && row[field] <= maximumRank
  ));
  return {
    denominator: rows.length,
    accepted_identity_presence: identityPresence,
    identity_recall_at_1: rate(at("accepted_identity_rank", 1), rows.length),
    identity_recall_at_5: rate(at("accepted_identity_rank", 5), rows.length),
    identity_recall_at_20: rate(at("accepted_identity_rank", 20), rows.length),
    variant_compatible_presence: strictPresence,
    variant_compatible_unique: strictUnique,
    core_compatible_presence: corePresence,
    core_compatible_unique: coreUnique,
    variant_compatibility_at_1: rate(at("strict_exact_ordinal_rank", 1), rows.length),
    variant_compatibility_at_5: rate(at("strict_exact_ordinal_rank", 5), rows.length),
    variant_compatibility_at_20: rate(at("strict_exact_ordinal_rank", 20), rows.length),
    core_compatibility_at_1: rate(at("core_ordinal_rank", 1), rows.length),
    core_compatibility_at_5: rate(at("core_ordinal_rank", 5), rows.length),
    core_compatibility_at_20: rate(at("core_ordinal_rank", 20), rows.length),
    accepted_identity_presence_rate: rate(identityPresence, rows.length),
    variant_compatible_presence_rate: rate(strictPresence, rows.length),
    variant_compatible_unique_rate: rate(strictUnique, rows.length),
    core_compatible_presence_rate: rate(corePresence, rows.length),
    core_compatible_unique_rate: rate(coreUnique, rows.length)
  };
}

export function auditCardLevelReleasePack({
  dataset = {},
  manifest = {},
  dataset_binding: datasetBinding = {},
  catalog = {},
  provenance = {},
  compiled_index: compiledIndex = null
} = {}) {
  const validatedManifest = validateCardLevelReleasePackManifest(manifest);
  const validatedDatasetBinding = validateCardLevelReleasePackDatasetBinding({
    dataset,
    manifest,
    binding: datasetBinding
  });
  const index = compiledIndex || compileCardLevelReleasePackIndex({
    cards: catalog.cards || [],
    provenance,
    pack_version: `${catalog.schema_version || "catalog"}:${catalog.generated_at || "undated"}`
  });
  if (index.schema_version !== "card-level-release-pack-index-v1") {
    throw new TypeError("compiled_index must implement card-level-release-pack-index-v1");
  }
  const groups = expandCorrelatedSourceExclusions(
    truthGroups(dataset, validatedManifest),
    catalog.cards || []
  );
  const rows = groups.map((group) => {
    const result = index.query(group.truth_fields, {
      limit: 20,
      query_source: "SEALED_TRUTH_UPPER_BOUND",
      accepted_identity_ids: [...group.accepted_identity_ids],
      exclusion: {
        sealed_row_ids: group.sealed_row_ids,
        feedback_ids: group.feedback_ids,
        source_ids: group.source_ids,
        content_hashes: group.content_hashes
      }
    });
    const unfiltered = index.query(group.truth_fields, {
      limit: 0,
      query_source: "SEALED_TRUTH_LEAKAGE_DIAGNOSTIC",
      accepted_identity_ids: [...group.accepted_identity_ids]
    });
    const classification = result.accepted_identity_match_count > 0
      ? "INDEPENDENT_IDENTITY_PRESENT"
      : result.strict_exact_identity_count > 0
        ? "FIELD_COMPATIBLE_IDENTITY_UNPROVEN"
        : result.query_compatible_core_count > 0
          ? "CORE_COMPATIBLE_VARIANT_UNRESOLVED"
          : unfiltered.accepted_identity_match_count > 0 || unfiltered.query_compatible_core_count > 0
            ? "CORRELATED_SOURCE_ONLY"
            : "NO_ATTESTED_OR_CORE_MATCH_UNDER_CURRENT_CONTRACT";
    const bestStrictCandidate = result.candidates.find((candidate) => candidate.comparison.strict_exact) || null;
    const bestCoreCandidate = result.candidates.find(
      (candidate) => candidate.comparison.query_compatible_core
    ) || null;
    return {
      identity_id: group.identity_id,
      split: group.split,
      item_count: group.item_ids.length,
      item_ids: group.item_ids,
      classification,
      query_source: result.query_source,
      seed_dimension: result.seed_dimension,
      candidate_pool_count: result.candidate_pool_count,
      accepted_identity_match_count: result.accepted_identity_match_count,
      accepted_identity_rank: result.accepted_identity_rank,
      strict_exact_identity_count: result.strict_exact_identity_count,
      strict_exact_unique: result.strict_exact_unique,
      strict_exact_ordinal_rank: result.strict_exact_ordinal_rank,
      query_compatible_core_count: result.query_compatible_core_count,
      core_unique: result.core_unique,
      core_ordinal_rank: result.core_ordinal_rank,
      best_strict_candidate: bestStrictCandidate,
      best_core_candidate: bestCoreCandidate
    };
  });
  const development = rows.filter((row) => row.split === "development");
  const validation = rows.filter((row) => row.split === "validation");
  const split = {
    development: metrics(development),
    validation: metrics(validation)
  };
  const classifications = [
    "INDEPENDENT_IDENTITY_PRESENT",
    "FIELD_COMPATIBLE_IDENTITY_UNPROVEN",
    "CORE_COMPATIBLE_VARIANT_UNRESOLVED",
    "CORRELATED_SOURCE_ONLY",
    "NO_ATTESTED_OR_CORE_MATCH_UNDER_CURRENT_CONTRACT"
  ];
  const classificationCounts = Object.fromEntries(classifications.map((classification) => [
    classification,
    rows.filter((row) => row.classification === classification).length
  ]));
  const gapByField = Object.fromEntries(identityFields.map((field) => [field, {
    candidate_empty: 0,
    conflict: 0,
    query_alias_only: 0
  }]));
  for (const row of rows) {
    if (row.classification !== "CORE_COMPATIBLE_VARIANT_UNRESOLVED") continue;
    const bestCore = row.best_core_candidate;
    if (!bestCore) continue;
    for (const [field, state] of Object.entries(bestCore.comparison.field_comparison)) {
      if (state === "CANDIDATE_EMPTY") gapByField[field].candidate_empty += 1;
      else if (state === "CONFLICT") gapByField[field].conflict += 1;
      else if (state === "QUERY_ALIAS_ONLY") gapByField[field].query_alias_only += 1;
    }
  }
  const report = {
    schema_version: cardLevelReleasePackAuditVersion,
    generated_at: new Date().toISOString(),
    status: "NO_GO",
    route: "NO_FULL_PROVIDER",
    scope: "DEVELOPMENT_VALIDATION_ONLY",
    holdout_consumed: false,
    production_default_changed: false,
    evidence_class: "TRUTH_FED_CATALOG_UPPER_BOUND",
    warning: "Top-K uses sealed truth fields and is not executable sensor recall. A missing attested/core match under this query contract does not prove that a catalog row is absent.",
    manifest_integrity: {
      gate_version: "card-level-release-pack-manifest-gate-v2",
      frozen_assignment_id: validatedManifest.frozen_assignment_id,
      source_fingerprint_sha256: validatedManifest.source_fingerprint_sha256,
      dataset_binding: validatedDatasetBinding,
      recomputed_actual_counts: validatedManifest.actual_counts,
      recomputed_leakage_check: validatedManifest.leakage_check,
      within_partition_duplicate_count: 0
    },
    index: {
      schema_version: index.schema_version,
      pack_version: index.pack_version,
      pack_fingerprint: index.pack_fingerprint,
      pack_content_fingerprint: index.pack_content_fingerprint,
      source: index.source,
      source_row_count: index.source_row_count,
      eligible_source_row_count: index.eligible_source_row_count,
      indexed_identity_count: index.indexed_identity_count,
      duplicate_identity_row_count: index.duplicate_identity_row_count,
      source_row_counts: index.source_row_counts,
      key_counts: index.key_counts
    },
    denominator: {
      identity_groups: rows.length,
      labeled_rows: rows.reduce((sum, row) => sum + row.item_count, 0),
      frozen_devval_rows: validatedManifest.actual_counts.development
        + validatedManifest.actual_counts.validation
    },
    split,
    combined: metrics(rows),
    classification_counts: classificationCounts,
    best_core_variant_gap_by_field: gapByField,
    rows
  };
  report.status = split.development.accepted_identity_presence_rate >= 0.903775
    && split.validation.accepted_identity_presence_rate >= 0.903775
    ? "CATALOG_ADDRESSABILITY_GO"
    : "NO_GO";
  report.report_sha256 = createHash("sha256").update(JSON.stringify({
    ...report,
    generated_at: null,
    report_sha256: null
  })).digest("hex");
  return report;
}
