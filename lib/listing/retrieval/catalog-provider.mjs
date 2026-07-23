import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { foldLatinDiacritics } from "../pipeline/subject-identity.mjs";
import { expandPrintRunFields, stripReferencePrintRunNumerator } from "../print-run/print-run-fields.mjs";
import { isOfficialCatalogSourceType } from "../catalog/catalog-contract.mjs";
import { catalogSourceCanEnterRetrieval } from "../catalog/curated-catalog-source-registry.mjs";
import {
  buildOfficialCatalogImportReport,
  officialCatalogSourceProfile
} from "../catalog/official-catalog-source-adapter.mjs";
import { parseReviewedTitleFields } from "../memory/title-field-parser.mjs";
import { withoutLegacyCardNameSetAlias } from "../catalog/catalog-field-semantics.mjs";
import {
  retrievalProviderIds,
  retrievalSourceTypes,
  retrievalTrustTiers,
  retrievalUnavailable
} from "./retrieval-contract.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function safeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function serialDenominator(value) {
  return cleanText(value).match(/\/\s*(\d{1,4})\b/)?.[1] || cleanText(value).replace(/[^0-9]/g, "");
}

function lotFieldsFromTitle(title = "") {
  const text = cleanText(title);
  const lotMatch = text.match(/\blot\s*(?:x|of)?\s*(\d{1,3})\b|\blotx(\d{1,3})\b/i);
  if (!lotMatch) return {};
  return {
    lot_type: "LOT",
    card_count: Number(lotMatch[1] || lotMatch[2] || 0) || null
  };
}

function parsedTitleFields(row = {}) {
  const title = cleanText(row.canonical_title || row.title || "");
  if (!title) return {};
  const parsed = parseReviewedTitleFields(title);
  const printRun = expandPrintRunFields(parsed);
  return {
    year: parsed.year || null,
    manufacturer: parsed.manufacturer || null,
    brand: parsed.brand || null,
    product: parsed.product || null,
    set: parsed.set_or_insert || parsed.set || null,
    players: Array.isArray(parsed.players) ? parsed.players : [],
    language: parsed.language || null,
    rarity: parsed.rarity || null,
    card_name: parsed.card_name || parsed.official_card_type || null,
    official_card_type: parsed.official_card_type || null,
    observable_components: parsed.observable_components || [],
    rc: parsed.rc === true,
    first_bowman: parsed.first_bowman === true,
    ssp: parsed.ssp === true,
    case_hit: parsed.case_hit === true,
    auto: parsed.auto === true,
    patch: parsed.patch === true,
    relic: parsed.relic === true,
    jersey: parsed.jersey === true,
    sketch: parsed.sketch === true,
    redemption: parsed.redemption === true,
    surface_color: parsed.surface_color || null,
    parallel_family: parsed.parallel_family || null,
    parallel_exact: parsed.parallel_exact || null,
    parallel: parsed.parallel_exact || parsed.parallel || null,
    variation: parsed.variation || null,
    team: parsed.team || null,
    character: parsed.character || null,
    collector_number: parsed.collector_number || parsed.card_number || null,
    checklist_code: parsed.checklist_code || null,
    print_run_denominator: printRun.print_run_denominator || null,
    numbered_to: printRun.numbered_to || null,
    serial_denominator: printRun.serial_denominator || null,
    expected_serial_denominator: printRun.print_run_denominator || null,
    ...lotFieldsFromTitle(title)
  };
}

function mergeMissingFields(base = {}, fallback = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(fallback)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    if (merged[key] === null || merged[key] === undefined || merged[key] === "" || (Array.isArray(merged[key]) && !merged[key].length)) {
      merged[key] = value;
    }
  }
  return merged;
}

function tokenCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function moreSpecificText(candidate = "", current = "") {
  const candidateText = cleanText(candidate);
  const currentText = cleanText(current);
  if (!candidateText) return false;
  if (!currentText) return true;
  const candidateLower = candidateText.toLowerCase();
  const currentLower = currentText.toLowerCase();
  if (candidateLower === currentLower) return false;
  return candidateLower.includes(currentLower)
    || tokenCount(candidateText) > tokenCount(currentText);
}

function applyInternalWriterTitleSpecificity(fields = {}, titleFields = {}) {
  const enriched = { ...fields };
  for (const key of [
    "manufacturer",
    "brand",
    "product",
    "set",
    "card_name",
    "collector_number",
    "checklist_code",
    "language",
    "rarity",
    "team",
    "official_card_type",
    "parallel_family",
    "parallel_exact",
    "parallel"
  ]) {
    const titleValue = titleFields[key];
    if (Array.isArray(titleValue)) continue;
    if (moreSpecificText(titleValue, enriched[key])) enriched[key] = titleValue;
  }
  if (
    Array.isArray(titleFields.players)
    && titleFields.players.length
    && (!Array.isArray(enriched.players) || enriched.players.length === 0)
  ) {
    enriched.players = titleFields.players;
  }
  // A reviewed title can add a positive identity flag even when an older
  // persisted parse stored the default false. Never use the title to clear a
  // positive observation, and never copy physical-instance fields here.
  for (const key of [
    "rc",
    "first_bowman",
    "ssp",
    "case_hit",
    "auto",
    "patch",
    "relic",
    "jersey",
    "sketch",
    "redemption"
  ]) {
    if (titleFields[key] === true) enriched[key] = true;
  }
  return enriched;
}

function subjectText(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  if (Array.isArray(normalized.players) && normalized.players.length) return normalized.players.join(" ");
  return normalized.character || "";
}

function providerConfig(env = process.env) {
  return {
    enabled: truthy(env.ENABLE_BASKETBALL_CATALOG_RETRIEVAL ?? env.ENABLE_CATALOG_RETRIEVAL, true),
    url: cleanText(env.SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY),
    timeoutMs: positiveInteger(env.CATALOG_RETRIEVAL_TIMEOUT_MS || env.POSTGRES_HYBRID_RETRIEVAL_TIMEOUT_MS, 12000),
    matchCount: positiveInteger(env.CATALOG_RETRIEVAL_TOP_N || env.ADVANCED_RETRIEVAL_STAGE1_TOP_N, 30),
    liveCuratedFallbackEnabled: truthy(env.ENABLE_LIVE_CURATED_CATALOG_FALLBACK, true),
    liveCuratedFallbackAlways: truthy(env.CATALOG_LIVE_CURATED_ALWAYS, false),
    liveCuratedFallbackMaxProviders: positiveInteger(env.CATALOG_LIVE_CURATED_MAX_PROVIDERS, 3),
    liveCuratedFallbackMatchCount: positiveInteger(env.CATALOG_LIVE_CURATED_TOP_N, 8),
    correctedTitleAsTemporaryGt: truthy(
      env.CATALOG_CORRECTED_TITLE_AS_TEMPORARY_GT
        || env.CATALOG_EVAL_CORRECTED_TITLE_AS_GT
        || env.VECTOR_EVAL_CORRECTED_TITLE_AS_GT,
      false
    )
  };
}

function readBody(fields = {}, query = {}) {
  const normalized = normalizeResolvedFields(fields);
  const queryOnly = cleanText(query.lookup_scope) === "product_vocabulary";
  const ignoreObservedYear = query.ignore_observed_year === true;
  const ignoreObservedProduct = query.ignore_observed_product === true;
  return {
    search_text: foldLatinDiacritics(query.search_text || query.query || ""),
    exact_checklist_code: cleanText(query.exact_checklist_code || (queryOnly ? "" : normalized.checklist_code)),
    exact_card_number: cleanText(query.exact_card_number || (queryOnly ? "" : normalized.collector_number)),
    exact_subject: foldLatinDiacritics(query.exact_subject || (queryOnly ? "" : subjectText(normalized))),
    exact_year: cleanText(query.exact_year || (ignoreObservedYear ? "" : normalized.year)),
    exact_product: cleanText(query.exact_product || (ignoreObservedProduct ? "" : normalized.product || normalized.set)),
    exact_serial_denominator: serialDenominator(query.exact_serial_denominator) || (queryOnly ? "" : cleanText(normalized.expected_serial_denominator) || serialDenominator(normalized.serial_number)),
    match_count: query.match_count || null
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function sourceTypeForRow(row = {}) {
  const status = cleanText(row.retrieval_status).toLowerCase();
  if (status === "reviewed") return retrievalSourceTypes.INTERNAL_APPROVED_HISTORY;
  if (isOfficialCatalogSourceType(row.source_type)) return retrievalSourceTypes.OFFICIAL_CHECKLIST;
  return retrievalSourceTypes.STRUCTURED_DATABASE;
}

function rowSourceUrl(row = {}) {
  return cleanText(row.source_url || row.reference_url || row.url || "");
}

function trustTierForSourceType(sourceType) {
  if (sourceType === retrievalSourceTypes.INTERNAL_APPROVED_HISTORY) return retrievalTrustTiers.APPROVED_HISTORY;
  if (sourceType === retrievalSourceTypes.OFFICIAL_CHECKLIST) return retrievalTrustTiers.OFFICIAL;
  return retrievalTrustTiers.STRUCTURED;
}

function rowStatusRejected(row = {}) {
  const status = cleanText(row.retrieval_status || row.reference_status).toLowerCase();
  return ["rejected", "blocked", "disabled", "deprecated"].includes(status);
}

function excludedSourceFeedbackIds(query = {}) {
  return new Set((Array.isArray(query.exclude_source_feedback_ids)
    ? query.exclude_source_feedback_ids
    : [query.exclude_source_feedback_ids])
    .map(cleanText)
    .filter(Boolean));
}

function rowSourceFeedbackId(row = {}) {
  return cleanText(row.source_feedback_id || safeJson(row.fields)?.source_feedback_id);
}

function filterSelfReferences(rows = [], query = {}) {
  const excluded = excludedSourceFeedbackIds(query);
  if (!excluded.size) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const sourceFeedbackId = rowSourceFeedbackId(row);
    return !sourceFeedbackId || !excluded.has(sourceFeedbackId);
  });
}

function missingSourceAwareCatalogRpc(response, text = "") {
  if (Number(response?.status) === 404) return true;
  return /PGRST202|search_catalog_candidates_with_source|could not find the function/i.test(text);
}

function correctedTitleTemporaryGroundTruth(row = {}, config = {}) {
  if (config.correctedTitleAsTemporaryGt !== true) return false;
  if (rowStatusRejected(row)) return false;
  const sourceType = cleanText(row.source_type).toUpperCase();
  const sourceStatus = cleanText(row.source_status).toUpperCase();
  return sourceType === "INTERNAL_CORRECTED_TITLE"
    || sourceStatus === "AUTO_PARSED_FROM_VERIFIED_TITLE";
}

function promptSafeInternalWriterTitle(row = {}) {
  if (rowStatusRejected(row)) return false;
  const sourceType = cleanText(row.source_type).toUpperCase();
  const sourceStatus = cleanText(row.source_status).toUpperCase();
  return sourceType === "INTERNAL_CORRECTED_TITLE"
    && [
      "VERIFIED_CANONICAL_TITLE",
      "AUTO_PARSED_FROM_VERIFIED_TITLE",
      "REVIEWED_INTERNAL"
    ].includes(sourceStatus);
}

function promptSafeOfficialCatalog(row = {}) {
  if (rowStatusRejected(row)) return false;
  if (!isOfficialCatalogSourceType(row.source_type)) return false;
  const sourceStatus = cleanText(row.source_status).toUpperCase();
  const retrievalStatus = cleanText(row.retrieval_status).toLowerCase();
  return retrievalStatus === "registry"
    || [
      "AUTO_PARSED_FROM_OFFICIAL_CHECKLIST",
      "OFFICIAL_CHECKLIST_CANDIDATE",
      "OFFICIAL_CHECKLIST_CONFIRMED",
      "OFFICIAL_RELEASE_SUPPORT",
      "OFFICIAL_RELEASE_METADATA",
      "TOPPS_OFFICIAL_RAW",
      "OFFICIAL_CHECKLIST_RAW"
    ].includes(sourceStatus);
}

function candidatesFromRows(rows = [], query = {}, config = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => (
      cleanText(row.source_type)
      && cleanText(row.source_status)
      && catalogSourceCanEnterRetrieval(row.source_type)
    ))
    .map((row, index) => {
    const temporaryGt = correctedTitleTemporaryGroundTruth(row, config);
    const internalWriterPromptSafe = promptSafeInternalWriterTitle(row);
    const officialCatalogPromptSafe = promptSafeOfficialCatalog(row);
    const promptSafeReference = temporaryGt || internalWriterPromptSafe || officialCatalogPromptSafe;
    const expectedSerialDenominator = serialDenominator(row.expected_serial_denominator);
    const rawFields = safeJson(row.fields) || {};
    const titleFields = parsedTitleFields(row);
    const internalWriterTitle = cleanText(row.source_type).toUpperCase() === "INTERNAL_CORRECTED_TITLE";
    const enrichedFields = internalWriterTitle
      ? applyInternalWriterTitleSpecificity(
        mergeMissingFields(withoutLegacyCardNameSetAlias(rawFields, titleFields), titleFields),
        titleFields
      )
      : mergeMissingFields(rawFields, titleFields);
    const referencePrintRun = expandPrintRunFields({
      ...enrichedFields,
      print_run_denominator: expectedSerialDenominator || enrichedFields.print_run_denominator,
      numbered_to: expectedSerialDenominator || enrichedFields.numbered_to
    });
    const referenceHadFullPrintRun = Boolean(referencePrintRun.print_run_numerator && !referencePrintRun.suspicious_print_run);
    const fields = normalizeResolvedFields(stripReferencePrintRunNumerator({
      ...enrichedFields,
      print_run_denominator: expectedSerialDenominator || referencePrintRun.print_run_denominator,
      numbered_to: expectedSerialDenominator || referencePrintRun.numbered_to,
      serial_denominator: expectedSerialDenominator || referencePrintRun.serial_denominator,
      expected_serial_denominator: expectedSerialDenominator || referencePrintRun.expected_serial_denominator
    }));
    const sourceType = sourceTypeForRow(row);
    return {
      candidate_id: row.identity_id ? `catalog_${row.identity_id}_${index + 1}` : `catalog_candidate_${index + 1}`,
      candidate_identity_id: row.identity_id || row.identity_key || null,
      source_feedback_id: rowSourceFeedbackId(row) || null,
      source_url: row.identity_id ? `supabase://catalog-cards/${row.identity_id}` : rowSourceUrl(row),
      domain: "supabase-catalog",
      source_type: sourceType,
      trust_tier: trustTierForSourceType(sourceType),
      title: cleanText(row.canonical_title),
      evidence_excerpt: [
        "catalog-first identity candidate",
        cleanText(row.identity_key),
        cleanText(row.source_type),
        `score=${Number(row.normalized_score || 0).toFixed(4)}`
      ].filter(Boolean).join(" | "),
      fields,
      matched_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : [],
      supporting_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : [],
      raw_score: Number(row.raw_score || 0),
      normalized_score: Number(row.normalized_score || 0),
      match_score: Number(row.normalized_score || 0),
      source_trust: promptSafeReference ? "APPROVED_REFERENCE" : "",
      channel_id: "catalog_first",
      provider_id: retrievalProviderIds.CATALOG,
      query_family: query.family || "",
      reference_metadata: {
        source_feedback_id: rowSourceFeedbackId(row) || null,
        retrieval_status: row.retrieval_status || "",
        source_type: row.source_type || "",
        source_status: row.source_status || "",
        corrected_title_as_temporary_gt: temporaryGt,
        corrected_title_is_reviewed_title_ground_truth: row.source_type === "INTERNAL_CORRECTED_TITLE" || temporaryGt,
        official_catalog_prompt_safe: officialCatalogPromptSafe,
        prompt_safe_internal_writer_title: internalWriterPromptSafe,
        catalog_full_print_run_copy_violation_count: referenceHadFullPrintRun ? 1 : 0,
        ebay_answer_key_is_reviewed_ground_truth: false,
        temporary_ground_truth_source: temporaryGt ? "corrected_title" : "",
        expected_serial_denominator: expectedSerialDenominator || row.expected_serial_denominator || "",
        provider: retrievalProviderIds.CATALOG
      },
      field_derivation: {
        source: isOfficialCatalogSourceType(row.source_type) ? "official_catalog" : "catalog_v0",
        corrected_title_used: row.source_type === "INTERNAL_CORRECTED_TITLE",
        corrected_title_used_as_ground_truth: false,
        corrected_title_used_as_field_ground_truth: false,
        corrected_title_is_reviewed_title_ground_truth: row.source_type === "INTERNAL_CORRECTED_TITLE" || temporaryGt,
        ebay_answer_key_is_reviewed_ground_truth: false,
        corrected_title_as_temporary_gt: temporaryGt,
        official_catalog_prompt_safe: officialCatalogPromptSafe,
        prompt_safe_internal_writer_title: internalWriterPromptSafe,
        catalog_full_print_run_copy_violation_count: referenceHadFullPrintRun ? 1 : 0,
        title_derived_fields_are_ground_truth: false,
        temporary_ground_truth_source: temporaryGt ? "corrected_title" : "",
        reviewed_ground_truth_used: false
      }
    };
    });
}

function textHaystack(fields = {}, query = {}) {
  return [
    query.search_text,
    query.query,
    query.exact_subject,
    query.exact_product,
    query.exact_card_number,
    query.exact_checklist_code,
    fields.category,
    fields.game,
    fields.product,
    fields.set,
    fields.manufacturer,
    fields.brand,
    fields.character,
    ...(Array.isArray(query.category_candidates) ? query.category_candidates : []),
    subjectText(fields),
    fields.collector_number,
    fields.checklist_code
  ].filter(Boolean).join(" ");
}

function tcgProviderHints(fields = {}, query = {}, config = {}) {
  const text = textHaystack(fields, query).toLowerCase();
  const categoryCandidates = Array.isArray(query.category_candidates)
    ? query.category_candidates.map((category) => String(category || "").trim().toLowerCase())
    : [];
  const providers = [];
  const add = (provider) => {
    if (!providers.includes(provider)) providers.push(provider);
  };
  if (/\bpok[eé]mon\b|\bpokemon\b/.test(text)) add("pokemon_tcg_api");
  if (/\bmagic\b|\bmtg\b|\bscryfall\b|\bwizards\b/.test(text)) add("scryfall");
  if (/\byu[-\s]?gi[-\s]?oh\b|\byugioh\b|\bkonami\b/.test(text)) add("ygoprodeck");
  if (/\blorcana\b|\bdisney lorcana\b/.test(text)) add("lorcast");
  if (/\bstar wars unlimited\b|\bswu\b/.test(text)) add("swu_db");
  if (/\bone piece\b|\bop\d{2}-\d{3}\b|\bst\d{2}-\d{3}\b/.test(text)) add("one_piece");
  if (/\bdigimon\b|\bbt\d{1,2}-\d{3}\b/.test(text)) add("digimon");
  if (/\bdragon ball\b|\bdbs\b|\bdbfw\b|\bfb\d{2}-\d{3}\b/.test(text)) add("dragon_ball_fusion_world");
  if (/\bunion arena\b/.test(text)) add("union_arena");
  if (/\bbattle spirits\b/.test(text)) add("battle_spirits");
  if (!providers.length && (/\btcg\b|trading card game/i.test(text) || categoryCandidates.includes("tcg"))) {
    add("pokemon_tcg_api");
    add("scryfall");
    add("ygoprodeck");
  }
  return providers.slice(0, config.liveCuratedFallbackMaxProviders);
}

function liveCuratedFallbackHasSpecificAnchor(fields = {}, query = {}) {
  const body = readBody(fields, query);
  return Boolean(
    body.exact_checklist_code
    || body.exact_card_number
    || body.exact_subject
    || body.exact_product
    || body.search_text
  );
}

function shouldRunLiveCuratedFallback(rows = [], fields = {}, query = {}, config = {}) {
  if (!config.liveCuratedFallbackEnabled) return false;
  if (config.liveCuratedFallbackAlways) return true;
  if (!Array.isArray(rows) || rows.length === 0) return true;
  // Supabase may return visually or textually similar but wrong local rows. For
  // TCG exact-code / product / subject queries, still append curated official or
  // structured community catalogs so the resolver can see a real catalog option
  // instead of being anchored only by the wrong local neighbors.
  return tcgProviderHints(fields, query, config).length > 0
    && liveCuratedFallbackHasSpecificAnchor(fields, query);
}

function quotedApiTerm(value = "") {
  return cleanText(value).replace(/"/g, "");
}

function queryTerm(fields = {}, query = {}) {
  return cleanText(query.exact_subject || subjectText(fields) || query.search_text || query.query || query.exact_product || fields.product || fields.set);
}

function liveSourceUrls(provider = "", fields = {}, query = {}) {
  const profile = officialCatalogSourceProfile(provider);
  const subject = quotedApiTerm(query.exact_subject || subjectText(fields));
  const cardNumber = quotedApiTerm(query.exact_card_number || fields.collector_number || fields.checklist_code);
  const term = quotedApiTerm(queryTerm(fields, query));
  if (provider === "pokemon_tcg_api") {
    const q = [
      subject ? `name:"${subject}"` : "",
      cardNumber ? `number:${cardNumber}` : ""
    ].filter(Boolean).join(" ") || term;
    return [{ href: `${profile.default_index_url}?q=${encodeURIComponent(q)}`, text: "Pokemon TCG API live catalog fallback" }];
  }
  if (provider === "scryfall") {
    const q = [
      subject || term,
      cardNumber ? `cn:${cardNumber}` : ""
    ].filter(Boolean).join(" ");
    return [{ href: `${profile.default_index_url}?q=${encodeURIComponent(q || term)}`, text: "Scryfall live catalog fallback" }];
  }
  if (provider === "ygoprodeck") {
    const params = subject || term ? `?fname=${encodeURIComponent(subject || term)}` : "";
    return [{ href: `${profile.default_index_url}${params}`, text: "YGOPRODeck live catalog fallback" }];
  }
  if (provider === "lorcast") {
    const q = [subject || term, cardNumber].filter(Boolean).join(" ");
    return [{ href: `https://api.lorcast.com/v0/cards/search?q=${encodeURIComponent(q || term)}&unique=prints`, text: "Lorcast live catalog fallback" }];
  }
  if (provider === "swu_db") {
    const q = subject || term || cardNumber;
    return [{ href: `https://api.swu-db.com/cards/search?q=${encodeURIComponent(q || term)}&format=json`, text: "SWUDB live catalog fallback" }];
  }
  return [{ href: profile.default_index_url, text: `${profile.label} live catalog fallback` }];
}

function fieldList(fields = {}) {
  return [
    ["checklist_code", fields.checklist_code],
    ["collector_number", fields.collector_number || fields.card_number],
    ["players", fields.players || fields.subject || fields.card_name],
    ["product", fields.product || fields.set_or_insert],
    ["year", fields.year || fields.season_year],
    ["rarity", fields.rarity],
    ["card_type", fields.official_card_type]
  ].filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(cleanText(value));
  }).map(([field]) => field);
}

function liveRowMatchesQuery(staging = {}, fields = {}, query = {}) {
  const candidateFields = normalizeResolvedFields(staging.identity_fields || {});
  const wantedNumber = cleanText(query.exact_card_number || fields.collector_number || fields.checklist_code).toLowerCase();
  const candidateNumber = cleanText(candidateFields.collector_number || candidateFields.checklist_code).toLowerCase();
  const wantedSubject = cleanText(query.exact_subject || subjectText(fields)).toLowerCase();
  const candidateSubject = cleanText(subjectText(candidateFields) || candidateFields.card_name).toLowerCase();
  const wantedProduct = cleanText(query.exact_product || fields.product || fields.set).toLowerCase();
  const candidateProduct = cleanText(candidateFields.product || candidateFields.set).toLowerCase();
  if (wantedNumber && candidateNumber) {
    return candidateNumber === wantedNumber || candidateNumber.includes(wantedNumber) || wantedNumber.includes(candidateNumber);
  }
  if (wantedNumber && !candidateNumber) return false;
  if (wantedSubject && candidateSubject && (candidateSubject.includes(wantedSubject) || wantedSubject.includes(candidateSubject))) return true;
  if (wantedProduct && candidateProduct && (candidateProduct.includes(wantedProduct) || wantedProduct.includes(candidateProduct))) return true;
  return !wantedNumber && !wantedSubject && !wantedProduct;
}

function liveStagingToRpcRow(entry = {}, index = 0, {
  provider = "",
  config = {}
} = {}) {
  const staging = entry.staging || entry;
  const fields = staging.identity_fields || {};
  const supporting = fieldList(fields);
  const score = Math.max(0.18, Math.min(0.72, Number(staging.parse_confidence || 0.48) + supporting.length * 0.025));
  return {
    identity_id: "",
    identity_key: staging.source_row_key || `live:${provider}:${index + 1}`,
    canonical_title: staging.canonical_title || [fields.product, fields.card_name, fields.collector_number].filter(Boolean).join(" "),
    fields,
    retrieval_status: "candidate",
    source_type: staging.source_type,
    source_status: staging.import_status,
    supporting_fields: supporting,
    raw_score: score,
    normalized_score: score,
    expected_serial_denominator: fields.serial_denominator || "",
    source_url: staging.source_url || entry.source?.source_url || "",
    reference_url: staging.source_url || entry.source?.source_url || "",
    match_count: config.liveCuratedFallbackMatchCount
  };
}

async function liveCuratedCatalogRows({
  fields = {},
  query = {},
  config = {},
  fetchImpl = globalThis.fetch
} = {}) {
  if (!config.liveCuratedFallbackEnabled || typeof fetchImpl !== "function") return [];
  const providers = tcgProviderHints(fields, query, config);
  const rows = [];
  for (const provider of providers) {
    try {
      const report = await buildOfficialCatalogImportReport({
        provider,
        fetchImpl,
        sourceUrls: liveSourceUrls(provider, fields, query),
        category: "tcg"
      });
      const stagingRows = Array.isArray(report.raw?.staging) ? report.raw.staging : [];
      for (const [index, entry] of stagingRows.entries()) {
        if (!liveRowMatchesQuery(entry.staging || entry, fields, query)) continue;
        rows.push(liveStagingToRpcRow(entry, index, { provider, config }));
        if (rows.length >= config.liveCuratedFallbackMatchCount) return rows;
      }
    } catch {
      continue;
    }
  }
  return rows.slice(0, config.liveCuratedFallbackMatchCount);
}

function unavailable(reason) {
  return retrievalUnavailable(retrievalProviderIds.CATALOG, reason);
}

export function catalogProvider({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = providerConfig(env);

  return {
    id: retrievalProviderIds.CATALOG,
    async search({ query = {}, resolved = {} } = {}) {
      if (!config.enabled) return unavailable("catalog_retrieval_disabled");
      if (typeof fetchImpl !== "function") return unavailable("fetch_unavailable");

      const fields = normalizeResolvedFields(resolved);
      const body = readBody(fields, query);
      if (!body.search_text && !body.exact_checklist_code && !body.exact_card_number && !body.exact_subject && !body.exact_year && !body.exact_product && !body.exact_serial_denominator) {
        return unavailable("catalog_query_missing");
      }

      if (!config.url || !config.serviceRoleKey) {
        const liveRows = await liveCuratedCatalogRows({ fields, query, config, fetchImpl });
        if (liveRows.length) {
          return {
            provider_id: retrievalProviderIds.CATALOG,
            candidates: candidatesFromRows(liveRows, query, config)
          };
        }
        return unavailable("supabase_service_role_not_configured");
      }

      try {
        const rpcBody = JSON.stringify({
          ...body,
          match_count: positiveInteger(body.match_count, config.matchCount)
        });
        let response = await fetchWithTimeout(fetchImpl, `${config.url}/rest/v1/rpc/search_catalog_candidates_with_source`, {
          method: "POST",
          headers: {
            apikey: config.serviceRoleKey,
            authorization: `Bearer ${config.serviceRoleKey}`,
            "content-type": "application/json"
          },
          body: rpcBody
        }, config.timeoutMs);

        let text = await responseText(response);
        if (!response.ok
          && excludedSourceFeedbackIds(query).size === 0
          && missingSourceAwareCatalogRpc(response, text)) {
          response = await fetchWithTimeout(fetchImpl, `${config.url}/rest/v1/rpc/search_catalog_candidates`, {
            method: "POST",
            headers: {
              apikey: config.serviceRoleKey,
              authorization: `Bearer ${config.serviceRoleKey}`,
              "content-type": "application/json"
            },
            body: rpcBody
          }, config.timeoutMs);
          text = await responseText(response);
        }
        if (!response.ok) return unavailable(`supabase_catalog_rpc_${response.status}:${text.slice(0, 80)}`);

        let rows = [];
        try {
          rows = filterSelfReferences(text ? JSON.parse(text) : [], query);
        } catch {
          return unavailable("supabase_catalog_rpc_invalid_json");
        }

        if (shouldRunLiveCuratedFallback(rows, fields, query, config)) {
          const liveRows = await liveCuratedCatalogRows({
            fields,
            query,
            config,
            fetchImpl
          });
          rows = [...(Array.isArray(rows) ? rows : []), ...liveRows];
        }

        return {
          provider_id: retrievalProviderIds.CATALOG,
          candidates: candidatesFromRows(rows, query, config)
        };
      } catch (error) {
        if (error?.name === "AbortError") {
          const liveRows = await liveCuratedCatalogRows({ fields, query, config, fetchImpl });
          if (liveRows.length) {
            return {
              provider_id: retrievalProviderIds.CATALOG,
              candidates: candidatesFromRows(liveRows, query, config)
            };
          }
          return unavailable("catalog_retrieval_timeout");
        }
        const liveRows = await liveCuratedCatalogRows({ fields, query, config, fetchImpl });
        if (liveRows.length) {
          return {
            provider_id: retrievalProviderIds.CATALOG,
            candidates: candidatesFromRows(liveRows, query, config)
          };
        }
        return unavailable("catalog_retrieval_error");
      }
    }
  };
}
