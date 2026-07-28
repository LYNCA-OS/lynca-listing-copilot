// Versioned, read-only adapter for the committed product schema artifact.
//
// The source document contains exactly three useful relations:
//   product-year -> sets
//   product-year -> card_numbers
//   set -> product-years (set_to_products)
//
// It is deliberately not adapted into the older identity-resolution
// `productSchemas` input. That input expects additional taxonomies which this
// artifact does not contain. Keeping a separate runtime contract prevents set
// names from silently becoming constraints of a different semantic type.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const productSchemaRuntimeAdapterVersion = "product-schema-runtime-adapter-v1";
export const supportedProductSchemaDocumentVersion = "product-schemas-v1";

const defaultArtifactPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../data/catalog/product-schemas.json"
);
const defaultSourceLocator = "committed:data/catalog/product-schemas.json";
const loadedAdaptersByPath = new Map();
const ownerSampleLimit = 3;

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const normalizeProductSchemaText = (value) => cleanText(value)
  .normalize("NFKC")
  .toLowerCase();

export const normalizeProductSchemaCardNumber = (value) => cleanText(value)
  .normalize("NFKC")
  .replace(/^#\s*/, "")
  .toUpperCase();

function unique(values = [], normalize = cleanText) {
  const output = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = cleanText(rawValue);
    const key = normalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function frozenList(values = []) {
  return Object.freeze([...values]);
}

function frozenRecord(record = {}) {
  return Object.freeze({ ...record });
}

function emptySetOwnershipSummary() {
  return frozenRecord({
    owner_count: 0,
    agreeing_owner_count: 0,
    owner_sample_limit: ownerSampleLimit,
    owner_sample: frozenList([]),
    owner_identity_hash: null
  });
}

function normalizeSourceId(value = "") {
  return normalizeProductSchemaText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-product-schema-source";
}

function coveredManufacturersFromSource(source = "") {
  const normalized = normalizeProductSchemaText(source);
  return frozenList(["panini"].filter((manufacturer) => normalized.includes(manufacturer)));
}

function productYearKey(seasonYear, product) {
  const year = cleanText(seasonYear);
  const normalizedProduct = normalizeProductSchemaText(product);
  return year && normalizedProduct ? `${year}|${normalizedProduct}` : "";
}

function sourceProductYearKey(seasonYear, product) {
  const year = cleanText(seasonYear);
  const cleanProduct = cleanText(product);
  return year && cleanProduct ? `${year}|${cleanProduct}` : "";
}

function parseSetOwner(value = "") {
  const raw = cleanText(value);
  const separator = raw.indexOf("|");
  if (separator <= 0 || separator >= raw.length - 1) return null;
  const seasonYear = cleanText(raw.slice(0, separator));
  const product = cleanText(raw.slice(separator + 1));
  if (!seasonYear || !product) return null;
  return {
    source_key: raw,
    season_year: seasonYear,
    product,
    normalized_key: productYearKey(seasonYear, product)
  };
}

function numericCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : null;
}

function publicSchemaRecord(record = {}) {
  return frozenRecord({
    schema_key: record.schema_key,
    source_key: record.source_key,
    season_year: record.season_year,
    product: record.product,
    sport: record.sport,
    set_count: record.sets.size,
    card_number_count: record.card_numbers.size
  });
}

function unavailableAdapter({
  reason = "PRODUCT_SCHEMA_UNAVAILABLE",
  source = "",
  sourceLocator = defaultSourceLocator,
  documentVersion = "",
  generatedAt = null,
  sourceContentSha256 = null
} = {}) {
  const sourceName = cleanText(source);
  const sourceContract = frozenRecord({
    source_id: normalizeSourceId(sourceName),
    source_name: sourceName || null,
    source_locator: cleanText(sourceLocator) || null,
    source_version: cleanText(documentVersion) || null,
    source_content_sha256: cleanText(sourceContentSha256) || null,
    generated_at: generatedAt || null,
    covered_manufacturers: coveredManufacturersFromSource(sourceName),
    absence_is_authoritative: false
  });
  const counts = frozenRecord({
    declared_product_year_count: null,
    declared_set_name_count: null,
    declared_discriminating_set_count: null,
    product_schema_record_count: 0,
    set_name_count: 0,
    discriminating_set_count: 0,
    set_ownership_link_count: 0,
    set_membership_count: 0,
    card_number_membership_count: 0,
    invalid_schema_record_count: 0,
    invalid_set_owner_count: 0
  });
  return Object.freeze({
    adapter_version: productSchemaRuntimeAdapterVersion,
    status: "UNAVAILABLE",
    source: sourceContract,
    counts,
    supported_relations: frozenList([]),
    reason_codes: frozenList([reason]),
    findSchemas: () => frozenList([]),
    setOwnershipForSet: () => emptySetOwnershipSummary(),
    schemaHasSet: () => false,
    schemaHasCardNumber: () => false
  });
}

export function createProductSchemaRuntimeAdapter(document = {}, {
  sourceLocator = "in-memory:product-schema-document",
  sourceContentSha256 = ""
} = {}) {
  const source = cleanText(document?.source);
  const documentVersion = cleanText(document?.schema_version);
  const generatedAt = document?.generated_at || null;
  const contentRevision = cleanText(sourceContentSha256)
    || `sha256:${createHash("sha256").update(JSON.stringify(document ?? null)).digest("hex")}`;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return unavailableAdapter({
      reason: "PRODUCT_SCHEMA_DOCUMENT_INVALID",
      sourceLocator
    });
  }
  if (documentVersion !== supportedProductSchemaDocumentVersion) {
    return unavailableAdapter({
      reason: "PRODUCT_SCHEMA_VERSION_UNSUPPORTED",
      source,
      sourceLocator,
      documentVersion,
      generatedAt,
      sourceContentSha256: contentRevision
    });
  }
  if (!Array.isArray(document.schemas)
    || !document.set_to_products
    || typeof document.set_to_products !== "object"
    || Array.isArray(document.set_to_products)) {
    return unavailableAdapter({
      reason: "PRODUCT_SCHEMA_RELATIONS_INVALID",
      source,
      sourceLocator,
      documentVersion,
      generatedAt,
      sourceContentSha256: contentRevision
    });
  }

  const schemaRecords = [];
  const schemasByProduct = new Map();
  const schemasByProductYear = new Map();
  const schemasBySourceKey = new Map();
  let invalidSchemaRecordCount = 0;
  let setMembershipCount = 0;
  let cardNumberMembershipCount = 0;

  for (const rawSchema of document.schemas) {
    if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) {
      invalidSchemaRecordCount += 1;
      continue;
    }
    const seasonYear = cleanText(rawSchema.season_year);
    const product = cleanText(rawSchema.product);
    const schemaKey = productYearKey(seasonYear, product);
    if (!schemaKey) {
      invalidSchemaRecordCount += 1;
      continue;
    }
    const sets = new Set(unique(rawSchema.sets, normalizeProductSchemaText).map(normalizeProductSchemaText));
    const cardNumbers = new Set(
      unique(rawSchema.card_numbers, normalizeProductSchemaCardNumber).map(normalizeProductSchemaCardNumber)
    );
    const record = Object.freeze({
      schema_key: schemaKey,
      source_key: sourceProductYearKey(seasonYear, product),
      season_year: seasonYear,
      product,
      sport: cleanText(rawSchema.sport),
      sets,
      card_numbers: cardNumbers
    });
    schemaRecords.push(record);
    setMembershipCount += sets.size;
    cardNumberMembershipCount += cardNumbers.size;

    const productKey = normalizeProductSchemaText(product);
    schemasByProduct.set(productKey, [...(schemasByProduct.get(productKey) || []), record]);
    schemasByProductYear.set(schemaKey, [...(schemasByProductYear.get(schemaKey) || []), record]);
    schemasBySourceKey.set(record.source_key, [...(schemasBySourceKey.get(record.source_key) || []), record]);
  }

  // Keep the 30k-entry inverse relation lazy. Materializing and freezing every
  // owner at startup would add more than a second to a cold response even
  // though one card queries at most one set name.
  const rawSetOwners = document.set_to_products;
  let setNameCount = 0;
  let discriminatingSetCount = 0;
  let setOwnershipLinkCount = 0;
  let invalidSetOwnerCount = 0;
  for (const [rawSetName, rawOwners] of Object.entries(document.set_to_products)) {
    const setName = normalizeProductSchemaText(rawSetName);
    if (!setName || !Array.isArray(rawOwners)) {
      invalidSetOwnerCount += Array.isArray(rawOwners) ? rawOwners.length : 1;
      continue;
    }
    setNameCount += 1;
    setOwnershipLinkCount += rawOwners.length;
    if (rawOwners.length === 1) discriminatingSetCount += 1;
  }

  const declaredProductYearCount = numericCount(document.product_year_count);
  const declaredSetNameCount = numericCount(document.set_name_count);
  const declaredDiscriminatingSetCount = numericCount(document.discriminating_set_count);
  const reasonCodes = ["PRODUCT_SCHEMA_RUNTIME_READY"];
  if (declaredProductYearCount !== null && declaredProductYearCount !== schemaRecords.length) {
    reasonCodes.push("PRODUCT_SCHEMA_RECORD_COUNT_MISMATCH");
  }
  if (declaredSetNameCount !== null && declaredSetNameCount !== setNameCount) {
    reasonCodes.push("PRODUCT_SCHEMA_SET_COUNT_MISMATCH");
  }
  if (declaredDiscriminatingSetCount !== null
    && declaredDiscriminatingSetCount !== discriminatingSetCount) {
    reasonCodes.push("PRODUCT_SCHEMA_DISCRIMINATING_SET_COUNT_MISMATCH");
  }
  if (invalidSchemaRecordCount > 0) reasonCodes.push("PRODUCT_SCHEMA_INVALID_RECORDS_SKIPPED");
  if (invalidSetOwnerCount > 0) reasonCodes.push("PRODUCT_SCHEMA_INVALID_SET_OWNERS_SKIPPED");

  const sourceContract = frozenRecord({
    source_id: normalizeSourceId(source),
    source_name: source || null,
    source_locator: cleanText(sourceLocator) || null,
    source_version: documentVersion,
    source_content_sha256: contentRevision,
    generated_at: generatedAt,
    covered_manufacturers: coveredManufacturersFromSource(source),
    // The artifact describes harvested rows but does not declare exhaustive
    // manufacturer coverage. Presence can support agreement; absence cannot
    // become a contradiction or a production filter.
    absence_is_authoritative: false
  });
  const counts = frozenRecord({
    declared_product_year_count: declaredProductYearCount,
    declared_set_name_count: declaredSetNameCount,
    declared_discriminating_set_count: declaredDiscriminatingSetCount,
    product_schema_record_count: schemaRecords.length,
    set_name_count: setNameCount,
    discriminating_set_count: discriminatingSetCount,
    set_ownership_link_count: setOwnershipLinkCount,
    set_membership_count: setMembershipCount,
    card_number_membership_count: cardNumberMembershipCount,
    invalid_schema_record_count: invalidSchemaRecordCount,
    invalid_set_owner_count: invalidSetOwnerCount
  });

  function findSchemas({ season_year = "", product = "", sport = "" } = {}) {
    const normalizedProduct = normalizeProductSchemaText(product);
    const year = cleanText(season_year);
    const normalizedSport = normalizeProductSchemaText(sport);
    if (!normalizedProduct && !year && !normalizedSport) return frozenList([]);
    let candidates = normalizedProduct
      ? (year
          ? schemasByProductYear.get(productYearKey(year, product)) || []
          : schemasByProduct.get(normalizedProduct) || [])
      : schemaRecords;
    if (year) candidates = candidates.filter((record) => record.season_year === year);
    if (normalizedSport) {
      candidates = candidates.filter((record) => normalizeProductSchemaText(record.sport) === normalizedSport);
    }
    return frozenList(candidates.map(publicSchemaRecord));
  }

  function setOwnershipForSet(setName = "", {
    season_year = "",
    product = ""
  } = {}) {
    const rawOwners = rawSetOwners[normalizeProductSchemaText(setName)];
    if (!Array.isArray(rawOwners)) return emptySetOwnershipSummary();
    const owners = [];
    const seen = new Set();
    for (const rawOwner of rawOwners) {
      const parsed = parseSetOwner(rawOwner);
      if (!parsed || seen.has(parsed.normalized_key)) continue;
      seen.add(parsed.normalized_key);
      const sourceRecords = schemasBySourceKey.get(parsed.source_key) || [];
      owners.push(frozenRecord({
        source_key: parsed.source_key,
        schema_key: parsed.normalized_key,
        season_year: parsed.season_year,
        product: parsed.product,
        sport: sourceRecords.length === 1 ? sourceRecords[0].sport : null,
        schema_record_count: sourceRecords.length
      }));
    }
    owners.sort((left, right) => (
      left.schema_key.localeCompare(right.schema_key)
        || left.source_key.localeCompare(right.source_key)
    ));
    const normalizedProduct = normalizeProductSchemaText(product);
    const cleanYear = cleanText(season_year);
    const agreeingOwnerCount = normalizedProduct || cleanYear
      ? owners.filter((owner) => (
          (!normalizedProduct
            || normalizeProductSchemaText(owner.product) === normalizedProduct)
          && (!cleanYear || owner.season_year === cleanYear)
        )).length
      : 0;
    const ownerKeys = owners.map((owner) => `${owner.schema_key}|${owner.source_key}`);
    const ownerIdentityHash = ownerKeys.length
      ? `sha256:${createHash("sha256").update(ownerKeys.join("\n")).digest("hex")}`
      : null;
    return frozenRecord({
      owner_count: owners.length,
      agreeing_owner_count: agreeingOwnerCount,
      owner_sample_limit: ownerSampleLimit,
      owner_sample: frozenList(owners.slice(0, ownerSampleLimit)),
      owner_identity_hash: ownerIdentityHash
    });
  }

  function internalRecordsForSchemaKey(schemaKey = "") {
    return schemasByProductYear.get(cleanText(schemaKey)) || [];
  }

  function schemaHasSet(schemaKey = "", setName = "") {
    const normalizedSet = normalizeProductSchemaText(setName);
    if (!normalizedSet) return false;
    return internalRecordsForSchemaKey(schemaKey).some((record) => record.sets.has(normalizedSet));
  }

  function schemaHasCardNumber(schemaKey = "", cardNumber = "") {
    const normalizedCardNumber = normalizeProductSchemaCardNumber(cardNumber);
    if (!normalizedCardNumber) return false;
    return internalRecordsForSchemaKey(schemaKey)
      .some((record) => record.card_numbers.has(normalizedCardNumber));
  }

  return Object.freeze({
    adapter_version: productSchemaRuntimeAdapterVersion,
    status: "READY",
    source: sourceContract,
    counts,
    supported_relations: frozenList(["sets", "card_numbers", "set_to_products"]),
    reason_codes: frozenList(reasonCodes),
    findSchemas,
    setOwnershipForSet,
    schemaHasSet,
    schemaHasCardNumber
  });
}

export function loadProductSchemaRuntimeAdapter({
  path = defaultArtifactPath,
  reload = false,
  sourceLocator = path === defaultArtifactPath ? defaultSourceLocator : "file:product-schema-artifact"
} = {}) {
  const resolvedPath = resolve(path);
  if (!reload && loadedAdaptersByPath.has(resolvedPath)) return loadedAdaptersByPath.get(resolvedPath);
  let adapter;
  try {
    const rawDocument = readFileSync(resolvedPath, "utf8");
    const document = JSON.parse(rawDocument);
    adapter = createProductSchemaRuntimeAdapter(document, {
      sourceLocator,
      sourceContentSha256: `sha256:${createHash("sha256").update(rawDocument).digest("hex")}`
    });
  } catch {
    adapter = unavailableAdapter({
      reason: "PRODUCT_SCHEMA_ARTIFACT_READ_FAILED",
      sourceLocator
    });
  }
  loadedAdaptersByPath.set(resolvedPath, adapter);
  return adapter;
}

export const __productSchemaRuntimeAdapterTestHooks = Object.freeze({
  defaultArtifactPath,
  parseSetOwner,
  productYearKey,
  sourceProductYearKey
});
