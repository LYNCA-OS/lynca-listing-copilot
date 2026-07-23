import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  catalogFieldStatuses,
  catalogImportStatuses,
  catalogSourceTypes,
  isCommunityCatalogSourceType,
  isExternalDirectoryCatalogSourceType,
  isOfficialCatalogSourceType,
  isOfficialReleaseCatalogSourceType
} from "./catalog-contract.mjs";
import {
  buildOfficialChecklistImport,
  defaultOfficialChecklistIndexUrls,
  extractOfficialChecklistPayload,
  extractOfficialChecklistLinks,
  parseOfficialChecklistText,
  parseOfficialReleaseMetadata,
  sourceTypeFromOfficialChecklistProvider
} from "./topps-basketball-checklist-importer.mjs";
import {
  catalogSourceImportPolicy,
  curatedCatalogSource
} from "./curated-catalog-source-registry.mjs";
import { buildCatalogDecisionFingerprint } from "./catalog-source-fingerprint.mjs";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function providerKey(value = "topps") {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function absoluteUrl(href = "", baseUrl = "") {
  const candidate = decodeHtmlEntities(String(href || "").trim());
  if (!candidate || candidate.length > 2048 || /[<>\\\u0000-\u001f\u007f]/.test(candidate)) return "";
  try {
    const parsed = new URL(candidate, baseUrl || "https://example.invalid");
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function inferCategory(value = "") {
  const text = normalizeText(value);
  if (/\b(?:basketball|nba|wnba|nbl|g[-\s]?league)\b/i.test(text)) return "basketball";
  if (/\b(?:hockey|nhl)\b/i.test(text)) return "hockey";
  if (/\b(?:soccer|football club|uefa|fifa|club)\b/i.test(text)) return "soccer";
  if (/\b(?:baseball|mlb)\b/i.test(text)) return "baseball";
  if (/\b(?:football|nfl)\b/i.test(text)) return "football";
  if (/\b(?:pokemon|pok[eé]mon|one piece|yugioh|yu-gi-oh|dragonball|tcg)\b/i.test(text)) return "tcg";
  return "other";
}

function stripHtml(value = "") {
  return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
}

function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function linkTitle(text = "", href = "") {
  return stripHtml(text) || normalizeText(href.split("/").pop()?.replace(/[-_]+/g, " "));
}

function defaultLinkFilter(profile = {}) {
  return (link = {}) => {
    const haystack = `${link.text || ""} ${link.href || ""}`;
    if (profile.kind === "release") return /\b(?:release|releases|catalog|product|products|checklist)\b/i.test(haystack);
    if (profile.kind === "official_cardlist" || profile.kind === "official_card_database") return /\b(?:cardlist|card[-_\s]?list|card|cards|database|search)\b/i.test(haystack);
    return /\bchecklist\b/i.test(haystack);
  };
}

function catalogFetchHeaders(profile = {}) {
  return {
    accept: profile.kind?.includes("api") ? "application/json,text/plain,*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": "Mozilla/5.0 (compatible; LYNCA-Catalog-Importer/0.1; +https://lyncafei.team)"
  };
}

function registryProfile(provider, overrides = {}) {
  const entry = curatedCatalogSource(provider) || {};
  const providerId = entry.provider || providerKey(provider);
  const defaultCategory = entry.segments?.includes("tcg") ? "tcg" : entry.segments?.includes("sports") ? "sports" : "all";
  return {
    source_id: providerId,
    label: entry.label || normalizeText(provider) || "Official Catalog Source",
    source_type: entry.source_type || sourceTypeFromOfficialChecklistProvider(provider),
    default_index_url: entry.default_index_url || defaultOfficialChecklistIndexUrls[providerId] || defaultOfficialChecklistIndexUrls.topps,
    default_category: defaultCategory,
    kind: entry.kind || "checklist_discovery",
    source_scope: entry.quality_tier || "curated_catalog_source",
    priority: entry.quality_tier || "custom",
    manual_csv_fallback: entry.manual_csv_fallback !== false,
    prompt_eligible_by_default: entry.prompt_eligible_by_default === true,
    quality_tier: entry.quality_tier,
    import_mode: entry.import_mode,
    parser_strategy: entry.parser_strategy,
    ...overrides
  };
}

export const officialCatalogSourceProfiles = Object.freeze({
  topps: {
    source_id: "topps",
    label: "Topps / Fanatics Official Checklists",
    source_type: catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST,
    default_index_url: defaultOfficialChecklistIndexUrls.topps,
    default_category: "basketball",
    kind: "checklist",
    source_scope: "sports_first",
    priority: "P1",
    manual_csv_fallback: false
  },
  panini: {
    source_id: "panini",
    label: "Panini America Official Checklists",
    source_type: catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST,
    default_index_url: defaultOfficialChecklistIndexUrls.panini,
    default_category: "basketball",
    kind: "checklist_discovery",
    source_scope: "sports_first",
    priority: "P2",
    manual_csv_fallback: true
  },
  upper_deck: {
    source_id: "upper_deck",
    label: "Upper Deck e-Pack Product Checklists",
    source_type: catalogSourceTypes.UPPER_DECK_OFFICIAL_CHECKLIST,
    default_index_url: defaultOfficialChecklistIndexUrls.upper_deck,
    default_category: "sports",
    kind: "checklist_discovery",
    source_scope: "sports_first",
    priority: "P3",
    manual_csv_fallback: true
  },
  leaf: {
    source_id: "leaf",
    label: "Leaf Official Releases / Catalog",
    source_type: catalogSourceTypes.LEAF_OFFICIAL_RELEASE,
    default_index_url: defaultOfficialChecklistIndexUrls.leaf,
    default_category: "sports",
    kind: "release",
    source_scope: "release_metadata",
    priority: "P4",
    manual_csv_fallback: true
  },
  futera: {
    source_id: "futera",
    label: "Futera Official Checklists",
    source_type: catalogSourceTypes.FUTERA_OFFICIAL_CHECKLIST,
    default_index_url: defaultOfficialChecklistIndexUrls.futera,
    default_category: "soccer",
    kind: "checklist_discovery",
    source_scope: "soccer_first",
    priority: "P4",
    manual_csv_fallback: true
  },
  parkside: {
    source_id: "parkside",
    label: "Parkside Official Releases",
    source_type: catalogSourceTypes.PARKSIDE_OFFICIAL_RELEASE,
    default_index_url: defaultOfficialChecklistIndexUrls.parkside,
    default_category: "sports",
    kind: "release",
    source_scope: "small_manufacturer_release_metadata",
    priority: "P4",
    manual_csv_fallback: true
  },
  onit: {
    source_id: "onit",
    label: "ONIT Official Releases",
    source_type: catalogSourceTypes.ONIT_OFFICIAL_RELEASE,
    default_index_url: defaultOfficialChecklistIndexUrls.onit,
    default_category: "sports",
    kind: "release",
    source_scope: "small_manufacturer_release_metadata",
    priority: "P4",
    manual_csv_fallback: true
  },
  one_piece: {
    source_id: "one_piece",
    label: "Bandai One Piece Official Card List",
    source_type: catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST,
    default_index_url: defaultOfficialChecklistIndexUrls.one_piece,
    default_category: "tcg",
    kind: "bandai_cardlist",
    source_scope: "tcg_official_cardlist",
    priority: "P1",
    manual_csv_fallback: true
  },
  digimon: {
    source_id: "digimon",
    label: "Bandai Digimon Official Card List",
    source_type: catalogSourceTypes.BANDAI_DIGIMON_OFFICIAL_CARDLIST,
    default_index_url: defaultOfficialChecklistIndexUrls.digimon,
    default_category: "tcg",
    kind: "bandai_cardlist",
    source_scope: "tcg_official_cardlist",
    priority: "P1",
    manual_csv_fallback: true
  },
  dragon_ball_fusion_world: {
    source_id: "dragon_ball_fusion_world",
    label: "Dragon Ball Super Fusion World Official Card Database",
    source_type: catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE,
    default_index_url: defaultOfficialChecklistIndexUrls.dragon_ball_fusion_world,
    default_category: "tcg",
    kind: "bandai_cardlist",
    source_scope: "tcg_official_card_database",
    priority: "P1",
    manual_csv_fallback: true
  },
  dragon_ball_masters: registryProfile("dragon_ball_masters"),
  union_arena: registryProfile("union_arena"),
  battle_spirits: registryProfile("battle_spirits"),
  pokemon_official: {
    source_id: "pokemon_official",
    label: "Pokemon Official Card Search",
    source_type: catalogSourceTypes.POKEMON_OFFICIAL_CARD_SEARCH,
    default_index_url: defaultOfficialChecklistIndexUrls.pokemon_official,
    default_category: "tcg",
    kind: "official_card_database",
    source_scope: "tcg_official_discovery",
    priority: "P2",
    manual_csv_fallback: true
  },
  pokemon_tcg_api: {
    source_id: "pokemon_tcg_api",
    label: "Pokemon TCG Community API",
    source_type: catalogSourceTypes.POKEMON_TCG_COMMUNITY_API,
    default_index_url: defaultOfficialChecklistIndexUrls.pokemon_tcg_api,
    default_category: "tcg",
    kind: "pokemon_tcg_api",
    source_scope: "tcg_community_api",
    priority: "P1",
    manual_csv_fallback: false
  },
  scryfall: {
    source_id: "scryfall",
    label: "Scryfall Community API",
    source_type: catalogSourceTypes.SCRYFALL_COMMUNITY_API,
    default_index_url: defaultOfficialChecklistIndexUrls.scryfall,
    default_category: "tcg",
    kind: "scryfall_api",
    source_scope: "tcg_community_api",
    priority: "P1",
    manual_csv_fallback: false
  },
  konami_yugioh: {
    source_id: "konami_yugioh",
    label: "Konami Yu-Gi-Oh! Official Card Database",
    source_type: catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE,
    default_index_url: defaultOfficialChecklistIndexUrls.konami_yugioh,
    default_category: "tcg",
    kind: "official_card_database",
    source_scope: "tcg_official_discovery",
    priority: "P1",
    manual_csv_fallback: true
  },
  ygoprodeck: {
    source_id: "ygoprodeck",
    label: "YGOPRODeck Community API",
    source_type: catalogSourceTypes.YGOPRODECK_COMMUNITY_API,
    default_index_url: defaultOfficialChecklistIndexUrls.ygoprodeck,
    default_category: "tcg",
    kind: "ygoprodeck_api",
    source_scope: "tcg_community_api",
    priority: "P1",
    manual_csv_fallback: false
  },
  wotc_gatherer: registryProfile("wotc_gatherer"),
  lorcana_official: registryProfile("lorcana_official"),
  lorcast: registryProfile("lorcast"),
  star_wars_unlimited: registryProfile("star_wars_unlimited"),
  swu_db: registryProfile("swu_db"),
  flesh_and_blood: registryProfile("flesh_and_blood"),
  weiss_schwarz: registryProfile("weiss_schwarz"),
  vanguard: registryProfile("vanguard"),
  shadowverse_evolve: registryProfile("shadowverse_evolve"),
  grand_archive: registryProfile("grand_archive"),
  altered: registryProfile("altered")
});

const providerAliases = Object.freeze({
  pokemon: "pokemon_tcg_api",
  mtg: "scryfall",
  magic: "scryfall",
  yugioh: "ygoprodeck",
  ygo: "ygoprodeck",
  konami: "konami_yugioh",
  dbfw: "dragon_ball_fusion_world",
  dbs_fusion_world: "dragon_ball_fusion_world",
  dbs_masters: "dragon_ball_masters",
  dragon_ball_super_masters: "dragon_ball_masters",
  bandai_union_arena: "union_arena",
  battle_spirits_saga: "battle_spirits",
  bandai_battle_spirits: "battle_spirits",
  bandai_one_piece: "one_piece",
  bandai_digimon: "digimon",
  gatherer: "wotc_gatherer",
  wotc: "wotc_gatherer",
  lorcana: "lorcana_official",
  lorcana_community: "lorcast",
  lorcana_api: "lorcast",
  star_wars_unlimited_community: "swu_db",
  swudb: "swu_db",
  fab: "flesh_and_blood",
  fabtcg: "flesh_and_blood",
  swu: "star_wars_unlimited",
  ws_tcg: "weiss_schwarz",
  bushiroad_weiss_schwarz: "weiss_schwarz",
  cardfight_vanguard: "vanguard",
  bushiroad_vanguard: "vanguard",
  shadowverse: "shadowverse_evolve",
  bushiroad_shadowverse: "shadowverse_evolve",
  gatcg: "grand_archive"
});

export function officialCatalogSourceProfile(provider = "topps") {
  const key = providerKey(provider);
  const resolvedKey = providerAliases[key] || key;
  return officialCatalogSourceProfiles[resolvedKey] || {
    source_id: resolvedKey || "official",
    label: normalizeText(provider) || "Official Catalog Source",
    source_type: sourceTypeFromOfficialChecklistProvider(provider),
    default_index_url: defaultOfficialChecklistIndexUrls[resolvedKey] || defaultOfficialChecklistIndexUrls.topps,
    default_category: "all",
    kind: "checklist_discovery",
    source_scope: "custom",
    priority: "custom",
    manual_csv_fallback: true
  };
}

function isCatalogEndpointHint(href = "") {
  try {
    const parsed = new URL(href);
    if (/\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(parsed.pathname)) return false;
    const route = `${parsed.pathname}${parsed.search}`.toLowerCase();
    const hasCatalogIdentityRoute = /(?:^|[/_.-])(?:checklists?|cardlists?|card[-_]?search|cards?)(?:$|[/_.?&=-])/i.test(route);
    const hasEndpointRoute = /(?:^|[/_.-])(?:api|ajax|graphql)(?:$|[/_.?&=-])/i.test(route);
    const hasCatalogCollectionRoute = /(?:^|[/_.-])(?:products?|sets?|releases?|catalog|digital[-_]?library|search)(?:$|[/_.?&=-])/i.test(route);
    return hasCatalogIdentityRoute || (hasEndpointRoute && hasCatalogCollectionRoute);
  } catch {
    return false;
  }
}

function networkEndpointHints(html = "", baseUrl = "") {
  const hints = [];
  const seen = new Set();
  const patterns = [
    /["']([^"']*(?:api|ajax|graphql|checklist|checklists|digital-library|product|products)[^"']*)["']/gi,
    /\b(?:fetch|axios|getJSON)\s*\(\s*["']([^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    for (const match of String(html || "").matchAll(pattern)) {
      const href = absoluteUrl(match[1], baseUrl);
      if (!href || !isCatalogEndpointHint(href) || seen.has(href)) continue;
      seen.add(href);
      hints.push(href);
    }
  }
  return hints.slice(0, 50);
}

function manualCsvColumns(profile = {}) {
  return [
    "source_url",
    "source_title",
    "category",
    "game",
    "language",
    "season_year",
    "manufacturer",
    "brand",
    "product",
    "set_or_insert",
    "set_type",
    "card_number",
    "checklist_code",
    "players",
    "team",
    "official_card_type",
    "rarity",
    "parallel_exact",
    "serial_denominator",
    "image_url",
    "observable_components",
    profile.kind === "release" ? "release_notes" : ""
  ].filter(Boolean);
}

async function writeJson(path = "", value = {}) {
  if (!path) return;
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function summarizeImport(importReport = {}) {
  const rows = Array.isArray(importReport.staging) ? importReport.staging : [];
  const metrics = importReport.metrics || {};
  const imageReferenceCount = rows.filter((row) => {
    const fields = row.staging?.identity_fields || row.identity_fields || {};
    return fields.image_url || fields.image_urls?.length || fields.reference_image_url;
  }).length;
  const rarityCount = new Set(rows.map((row) => row.staging?.identity_fields?.rarity || row.identity_fields?.rarity).filter(Boolean)).size;
  return {
    source_count: metrics.source_count ?? (importReport.sources || []).length,
    fetched_count: metrics.fetched_count ?? metrics.file_count ?? (importReport.sources || []).length,
    file_count: metrics.file_count ?? (importReport.sources || []).length,
    parse_success_count: metrics.parse_success_count ?? rows.filter((row) => row.staging?.import_status !== catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED).length,
    parse_error_count: metrics.parse_error_count ?? 0,
    raw_text_extract_success_count: metrics.raw_text_extract_success_count ?? 0,
    raw_text_extract_error_count: metrics.raw_text_extract_error_count ?? 0,
    parsed_row_count: metrics.parsed_row_count ?? rows.length,
    product_count: metrics.product_count ?? 0,
    set_count: metrics.set_count ?? 0,
    card_count: metrics.card_count ?? rows.length,
    parallel_count: metrics.parallel_count ?? 0,
    rarity_count: metrics.rarity_count ?? rarityCount,
    image_reference_count: metrics.image_reference_count ?? imageReferenceCount,
    review_required_count: metrics.review_required_count ?? rows.filter((row) => [
      catalogImportStatuses.REVIEW_REQUIRED,
      catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED
    ].includes(row.staging?.import_status)).length,
    parser_confidence_distribution: metrics.parser_confidence_distribution || metrics.parse_confidence_distribution || { high: 0, medium: 0, low: 0 },
    parse_confidence_distribution: metrics.parse_confidence_distribution || metrics.parser_confidence_distribution || { high: 0, medium: 0, low: 0 },
    skipped_count: metrics.skipped_count ?? metrics.skipped_non_scope_count ?? 0,
    skipped_non_scope_count: metrics.skipped_non_scope_count ?? metrics.skipped_count ?? 0,
    duplicate_count: metrics.duplicate_count ?? 0,
    promotion_candidate_count: metrics.promotion_candidate_count ?? 0
  };
}

function parseJson(rawText = "") {
  try {
    return JSON.parse(String(rawText || ""));
  } catch {
    return null;
  }
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (Array.isArray(entry)) return entry.length > 0;
    return entry !== null && entry !== undefined && entry !== "";
  }));
}

function profileFieldStatus(profile = {}) {
  if (isCommunityCatalogSourceType(profile.source_type)) return catalogFieldStatuses.COMMUNITY_API_CANDIDATE;
  if (isExternalDirectoryCatalogSourceType(profile.source_type)) return catalogFieldStatuses.EXTERNAL_DIRECTORY_CANDIDATE;
  return catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST;
}

function profileImportStatus(profile = {}) {
  if (isCommunityCatalogSourceType(profile.source_type)) return catalogImportStatuses.COMMUNITY_API_CANDIDATE;
  if (isExternalDirectoryCatalogSourceType(profile.source_type)) return catalogImportStatuses.EXTERNAL_DIRECTORY_CANDIDATE;
  return catalogImportStatuses.OFFICIAL_CHECKLIST_CANDIDATE;
}

function sourceTrustForProfile(profile = {}) {
  if (isCommunityCatalogSourceType(profile.source_type)) return catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK;
  if (isExternalDirectoryCatalogSourceType(profile.source_type)) return profile.source_type;
  if (isOfficialReleaseCatalogSourceType(profile.source_type)) return "OFFICIAL_RELEASE_SUPPORT";
  return "OFFICIAL_CHECKLIST_CANDIDATE";
}

function adapterParserVersion(profile = {}) {
  return [
    "catalog-source-adapter-v1",
    profile.source_id || "unknown",
    profile.parser_strategy || profile.kind || "generic"
  ].join(":");
}

function genericSourceRecord({
  profile = {},
  source = {},
  sourceUrl = "",
  rawText = "",
  decisionFingerprint = null,
  category = ""
} = {}) {
  const official = isOfficialCatalogSourceType(profile.source_type);
  const release = isOfficialReleaseCatalogSourceType(profile.source_type);
  const sourceName = source.text || source.source_name || source.source_title || source.title || profile.label;
  const rawTextLimit = 200_000;
  return {
    source_type: profile.source_type,
    source_status: release
      ? catalogImportStatuses.OFFICIAL_RELEASE_METADATA
      : official
        ? "OFFICIAL_CHECKLIST_RAW"
        : isCommunityCatalogSourceType(profile.source_type)
          ? catalogImportStatuses.COMMUNITY_API_CANDIDATE
          : catalogImportStatuses.EXTERNAL_DIRECTORY_CANDIDATE,
    source_name: sourceName,
    source_url: sourceUrl || source.href || source.source_url || source.url || "",
    source_trust: sourceTrustForProfile(profile),
    parser_version: adapterParserVersion(profile),
    raw_checksum: decisionFingerprint?.checksum || sha256(rawText),
    source_metadata: {
      provider: profile.source_id,
      category: category || profile.default_category,
      adapter_kind: profile.kind,
      parser_strategy: profile.parser_strategy || null,
      fingerprint_kind: decisionFingerprint?.fingerprint_kind || "RAW_PAYLOAD",
      fingerprint_schema_version: decisionFingerprint?.schema_version || null,
      fingerprint_row_count: decisionFingerprint?.row_count ?? null,
      fingerprint_payload_length: decisionFingerprint?.payload_length ?? null,
      raw_payload_checksum: sha256(rawText),
      raw_text_length: rawText.length,
      raw_text_persisted: rawText.length <= rawTextLimit,
      third_party_used: !official
    },
    // Large API payloads are recoverable from the immutable URL + checksum.
    // Keeping one bounded source copy avoids multiplying it across every row.
    raw_text: rawText.length <= rawTextLimit ? rawText : null
  };
}

function rowFromFields(fields = {}, {
  profile = {},
  sourceUrl = "",
  sourceName = "",
  sourceRowKey = "",
  confidence = 0.66,
  reviewNotes = ""
} = {}) {
  const status = profileImportStatus(profile);
  const fieldStatus = profileFieldStatus(profile);
  const normalizedFields = compactObject({
    category: fields.category || profile.default_category || inferCategory(`${sourceName} ${sourceUrl}`),
    sport: fields.sport || fields.category || profile.default_category || inferCategory(`${sourceName} ${sourceUrl}`),
    game: fields.game,
    language: fields.language,
    season_year: fields.season_year || fields.year,
    year: fields.year,
    manufacturer: fields.manufacturer,
    brand: fields.brand || fields.manufacturer,
    product: fields.product || fields.set_name,
    set_or_insert: fields.set_or_insert || fields.subset,
    set_type: fields.set_type,
    players: arrayValue(fields.players || fields.subject || fields.name).map(normalizeText),
    subject: fields.subject || fields.name,
    card_name: fields.card_name || fields.name,
    team: fields.team,
    card_number: fields.card_number || fields.collector_number,
    collector_number: fields.collector_number || fields.card_number,
    checklist_code: fields.checklist_code || fields.code,
    official_card_type: fields.official_card_type || fields.card_type,
    rarity: fields.rarity,
    parallel_name: fields.parallel_name,
    parallel_exact: fields.parallel_exact,
    serial_denominator: fields.serial_denominator,
    observable_components: arrayValue(fields.observable_components),
    image_url: fields.image_url,
    image_urls: arrayValue(fields.image_urls),
    external_id: fields.external_id || fields.id
  });
  const requiredFields = ["product", "players", "card_number"].filter((field) => {
    const value = normalizedFields[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
  const canonicalTitle = normalizeText([
    normalizedFields.season_year || normalizedFields.year,
    normalizedFields.product,
    normalizedFields.players?.join(" / ") || normalizedFields.card_name,
    normalizedFields.parallel_exact || normalizedFields.parallel_name,
    normalizedFields.card_number ? `#${normalizedFields.card_number}` : normalizedFields.checklist_code,
    normalizedFields.rarity
  ].filter(Boolean).join(" "));
  return {
    import_status: requiredFields.length ? catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED : status,
    source_row_key: sourceRowKey || `${sourceUrl || sourceName || profile.source_id}:${normalizedFields.external_id || normalizedFields.card_number || canonicalTitle}`,
    canonical_title: canonicalTitle,
    identity_fields: normalizedFields,
    physical_instance_fields: {},
    field_statuses: Object.fromEntries(Object.keys(normalizedFields).map((field) => [field, fieldStatus])),
    parse_confidence: requiredFields.length ? Math.min(confidence, 0.45) : confidence,
    review_notes: requiredFields.length
      ? reviewNotes || `Missing normalized fields: ${requiredFields.join(", ")}`
      : reviewNotes || null
  };
}

function setNameFromPokemonSet(set = {}) {
  return normalizeText([set.name, set.series].filter(Boolean).join(" "));
}

function parsePokemonTcgApiRows(rawText = "", metadata = {}, profile = {}) {
  const json = parseJson(rawText);
  const cards = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return cards.map((card, index) => rowFromFields({
    category: "tcg",
    game: "Pokemon",
    language: "EN",
    manufacturer: "The Pokemon Company",
    product: setNameFromPokemonSet(card.set || {}),
    set_or_insert: card.set?.name,
    name: card.name,
    card_name: card.name,
    card_number: card.number,
    checklist_code: card.id,
    rarity: card.rarity,
    official_card_type: arrayValue(card.supertype).concat(arrayValue(card.subtypes)).filter(Boolean).join(" "),
    observable_components: arrayValue(card.subtypes).map((value) => String(value).toLowerCase()),
    image_url: card.images?.large || card.images?.small,
    external_id: card.id
  }, {
    profile,
    sourceUrl: metadata.sourceUrl,
    sourceName: metadata.sourceName || "Pokemon TCG API",
    sourceRowKey: `${metadata.sourceUrl || "pokemon_tcg_api"}:${card.id || index + 1}`,
    confidence: 0.62
  }));
}

function parseScryfallRows(rawText = "", metadata = {}, profile = {}) {
  const json = parseJson(rawText);
  const cards = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return cards.map((card, index) => rowFromFields({
    category: "tcg",
    game: "Magic: The Gathering",
    language: (card.lang || "en").toUpperCase(),
    manufacturer: "Wizards of the Coast",
    product: card.set_name,
    set_or_insert: card.set_name,
    name: card.name,
    card_name: card.name,
    card_number: card.collector_number,
    checklist_code: card.oracle_id || card.id,
    rarity: card.rarity,
    official_card_type: card.type_line,
    image_url: card.image_uris?.normal || card.image_uris?.large || card.card_faces?.[0]?.image_uris?.normal,
    external_id: card.id
  }, {
    profile,
    sourceUrl: metadata.sourceUrl,
    sourceName: metadata.sourceName || "Scryfall",
    sourceRowKey: `${metadata.sourceUrl || "scryfall"}:${card.id || index + 1}`,
    confidence: 0.60
  }));
}

function parseYgoproDeckRows(rawText = "", metadata = {}, profile = {}) {
  const json = parseJson(rawText);
  const cards = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const rows = [];
  cards.forEach((card, index) => {
    const sets = Array.isArray(card.card_sets) && card.card_sets.length ? card.card_sets : [{}];
    sets.forEach((set, setIndex) => {
      rows.push(rowFromFields({
        category: "tcg",
        game: "Yu-Gi-Oh!",
        language: "EN",
        manufacturer: "Konami",
        product: set.set_name || card.archetype || "Yu-Gi-Oh!",
        set_or_insert: set.set_name,
        name: card.name,
        card_name: card.name,
        card_number: set.set_code,
        checklist_code: set.set_code || String(card.id || ""),
        rarity: set.set_rarity,
        official_card_type: card.type,
        image_url: card.card_images?.[0]?.image_url,
        external_id: [card.id, set.set_code].filter(Boolean).join(":")
      }, {
        profile,
        sourceUrl: metadata.sourceUrl,
        sourceName: metadata.sourceName || "YGOPRODeck",
        sourceRowKey: `${metadata.sourceUrl || "ygoprodeck"}:${card.id || index + 1}:${setIndex + 1}`,
        confidence: 0.58
      }));
    });
  });
  return rows;
}

function parseLorcanaRows(rawText = "", metadata = {}, profile = {}) {
  const json = parseJson(rawText);
  const cards = Array.isArray(json?.results) ? json.results : Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return cards.map((card, index) => rowFromFields({
    category: "tcg",
    game: "Lorcana",
    language: String(card.lang || "en").toUpperCase(),
    manufacturer: "Ravensburger",
    product: card.set?.name || card.set_name || "Disney Lorcana",
    set_or_insert: card.set?.name || card.set_name,
    name: card.version ? `${card.name} - ${card.version}` : card.name,
    card_name: card.version ? `${card.name} - ${card.version}` : card.name,
    card_number: card.collector_number,
    checklist_code: [card.set?.code, card.collector_number].filter(Boolean).join("-"),
    rarity: card.rarity,
    official_card_type: arrayValue(card.type).join(" "),
    observable_components: arrayValue(card.classifications).concat(arrayValue(card.ink)).filter(Boolean),
    image_url: card.image_uris?.digital?.large || card.image_uris?.digital?.normal || card.image_url,
    external_id: card.id
  }, {
    profile,
    sourceUrl: metadata.sourceUrl,
    sourceName: metadata.sourceName || "Lorcast",
    sourceRowKey: `${metadata.sourceUrl || "lorcast"}:${card.id || index + 1}`,
    confidence: 0.58
  }));
}

function parseSwuDbRows(rawText = "", metadata = {}, profile = {}) {
  const json = parseJson(rawText);
  const cards = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return cards.map((card, index) => rowFromFields({
    category: "tcg",
    game: "Star Wars Unlimited",
    language: "EN",
    manufacturer: "Fantasy Flight Games",
    product: card.Set ? `Star Wars Unlimited ${card.Set}` : "Star Wars Unlimited",
    set_or_insert: card.Set,
    name: card.Subtitle ? `${card.Name} - ${card.Subtitle}` : card.Name,
    card_name: card.Subtitle ? `${card.Name} - ${card.Subtitle}` : card.Name,
    card_number: card.Number,
    checklist_code: [card.Set, card.Number].filter(Boolean).join("-"),
    rarity: card.Rarity,
    official_card_type: card.Type,
    observable_components: arrayValue(card.Aspects).concat(arrayValue(card.Traits)).concat(arrayValue(card.VariantType)).filter(Boolean),
    image_url: card.FrontArt,
    external_id: [card.Set, card.Number, card.VariantType].filter(Boolean).join(":")
  }, {
    profile,
    sourceUrl: metadata.sourceUrl,
    sourceName: metadata.sourceName || "SWUDB",
    sourceRowKey: `${metadata.sourceUrl || "swu_db"}:${card.Set || ""}:${card.Number || index + 1}:${card.VariantType || ""}`,
    confidence: 0.56
  }));
}

const bandaiCardCodePattern = "(?:(?=[A-Z0-9]{2,10}-)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\\d)[A-Z0-9]{2,10}-\\d{2,4})";

function extractBandaiCardBlocks(rawText = "") {
  const normalized = decodeHtmlEntities(String(rawText || ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:li|tr|article|section|div|p|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
  return normalized
    .split(new RegExp(`(?=\\b${bandaiCardCodePattern}\\b)`, "gi"))
    .map(normalizeText)
    .filter((block) => new RegExp(`^${bandaiCardCodePattern}\\b`, "i").test(block));
}

function htmlClassText(block = "", className = "") {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(`<([a-z0-9]+)[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"));
  return match ? stripHtml(match[2]) : "";
}

function htmlLabelValue(block = "", label = "") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(
    `<h6[^>]*>\\s*${escaped}\\s*<\\/h6>[\\s\\S]*?<div[^>]+class=["'][^"']*\\bdata\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`,
    "i"
  ));
  return match ? normalizeText(decodeHtmlEntities(stripHtml(match[1]))) : "";
}

async function mapWithConcurrency(values = [], concurrency = 6, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchOfficialDetailHtml(fetchImpl, href, profile = {}) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(href, {
        headers: catalogFetchHeaders(profile),
        signal: AbortSignal.timeout(8_000)
      });
      lastStatus = Number(response.status || 0);
      const html = Buffer.from(await response.arrayBuffer()).toString("utf8");
      if (response.ok && normalizeText(html)) return html;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error(`official_detail_download_failed:${lastStatus || "empty"}`);
}

function dbfwDetailUrls(html = "", sourceUrl = "") {
  const urls = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/\bdata-src=["']([^"']*detail\.php\?[^"']+)["']/gi)) {
    const href = absoluteUrl(match[1], sourceUrl);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    urls.push(href);
  }
  return urls;
}

function parseOnePieceOfficialRows(rawText = "", metadata = {}, profile = {}) {
  const rows = [];
  const sourceUrl = metadata.sourceUrl || "";
  const blockPattern = /<dl\b[^>]*class=["'][^"']*\bmodalCol\b[^"']*["'][^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/dl>/gi;
  for (const match of String(rawText || "").matchAll(blockPattern)) {
    const modalId = normalizeText(match[1]);
    const block = match[2];
    const info = block.match(/class=["'][^"']*\binfoCol\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    const spans = [...info.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((entry) => stripHtml(entry[1]));
    const cardNumber = normalizeText(spans[0]).toUpperCase();
    const cardName = htmlClassText(block, "cardName");
    if (!cardNumber || !cardName) continue;
    const parallelIndex = modalId.match(/_p(\d+)$/i)?.[1] || "";
    const imagePath = block.match(/\bdata-src=["']([^"']*\/card\/[^"']+)["']/i)?.[1] || "";
    let imageUrl = "";
    try {
      imageUrl = imagePath ? new URL(imagePath, sourceUrl).href : "";
    } catch {
      imageUrl = "";
    }
    const row = rowFromFields({
      category: "tcg",
      game: "One Piece",
      language: "EN",
      manufacturer: "Bandai",
      product: metadata.sourceName || profile.label,
      set_or_insert: htmlClassText(block, "getInfo").replace(/^Card Set\(s\)\s*/i, "") || metadata.sourceName || profile.label,
      name: cardName,
      card_name: cardName,
      card_number: cardNumber,
      checklist_code: cardNumber,
      rarity: spans[1],
      official_card_type: spans[2],
      parallel_name: parallelIndex ? "Alternate Art" : "",
      parallel_exact: parallelIndex ? `Alternate Art ${parallelIndex}` : "",
      observable_components: parallelIndex ? ["alternative_art"] : [],
      image_url: imageUrl,
      external_id: modalId
    }, {
      profile,
      sourceUrl,
      sourceName: metadata.sourceName || profile.label,
      sourceRowKey: `${sourceUrl || profile.source_id}:${modalId}`,
      confidence: parallelIndex ? 0.74 : 0.98
    });
    if (parallelIndex) {
      row.import_status = catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED;
      row.field_statuses.parallel_exact = catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED;
      row.review_notes = "Official variant id is preserved, but the human-readable parallel name is inferred from the _p suffix.";
    }
    rows.push(row);
  }
  return rows;
}

function parseDigimonOfficialRows(rawText = "", metadata = {}, profile = {}) {
  const rows = [];
  const sourceUrl = metadata.sourceUrl || "";
  const sourceName = metadata.sourceName || profile.label;
  const blocks = String(rawText || "").split(/(?=<li\b[^>]*class=["'][^"']*\bimage_lists_item\b)/gi).slice(1);
  for (const block of blocks) {
    const externalId = normalizeText(block.match(/class=["'][^"']*\bpopupCol\b[^"']*["'][^>]*id=["']([^"']+)["']/i)?.[1]);
    const cardNumber = htmlClassText(block, "cardNo").toUpperCase();
    const cardName = htmlClassText(block, "cardTitle");
    if (!externalId || !cardNumber || !cardName) continue;
    const explicitParallel = htmlClassText(block, "cardParallel");
    const imagePath = block.match(/class=["'][^"']*\bcard_img\b[^"']*["'][\s\S]*?<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || "";
    let imageUrl = "";
    try {
      imageUrl = imagePath ? new URL(imagePath, sourceUrl).href : "";
    } catch {
      imageUrl = "";
    }
    const attributes = [];
    for (const match of block.matchAll(/<dl\b[^>]*class=["'][^"']*\bcardInfoBox\b[^"']*["'][^>]*>([\s\S]*?)<\/dl>/gi)) {
      const label = htmlClassText(match[1], "cardInfoTit");
      const value = htmlClassText(match[1], "cardInfoData");
      if (label && value && /^(?:Color|Form|Attribute|Type)$/i.test(label)) attributes.push(`${label}:${value}`);
    }
    const row = rowFromFields({
      category: "tcg",
      game: "Digimon",
      language: "EN",
      manufacturer: "Bandai",
      product: sourceName,
      set_or_insert: sourceName,
      name: cardName,
      card_name: cardName,
      card_number: cardNumber,
      checklist_code: cardNumber,
      rarity: htmlClassText(block, "cardRarity"),
      official_card_type: htmlClassText(block, "cardType"),
      parallel_name: explicitParallel,
      parallel_exact: explicitParallel,
      observable_components: attributes.concat(explicitParallel ? ["alternative_art"] : []),
      image_url: imageUrl,
      external_id: externalId
    }, {
      profile,
      sourceUrl,
      sourceName,
      sourceRowKey: `${sourceUrl || profile.source_id}:${externalId}`,
      confidence: 0.98
    });
    rows.push(row);
  }
  return rows;
}

function parseDragonBallFusionWorldRows(rawText = "", metadata = {}, profile = {}) {
  const bundle = parseJson(rawText);
  const detailPages = Array.isArray(bundle?.detail_pages) ? bundle.detail_pages : [];
  const rows = [];
  for (const [index, detail] of detailPages.entries()) {
    const block = String(detail?.html || "");
    const cardNumber = normalizeText(decodeHtmlEntities(htmlClassText(block, "cardNo"))).toUpperCase();
    const cardName = normalizeText(decodeHtmlEntities(htmlClassText(block, "cardName")));
    if (!cardNumber || !cardName) continue;
    const rarity = normalizeText(decodeHtmlEntities(htmlClassText(block, "rarity")));
    const officialCardType = htmlLabelValue(block, "Card type");
    const color = htmlLabelValue(block, "Color");
    const traits = htmlLabelValue(block, "Special Traits");
    const officialProduct = normalizeText(decodeHtmlEntities(htmlClassText(block, "productName")));
    const detailUrl = detail?.href || metadata.sourceUrl || "";
    let variantId = "";
    try {
      variantId = new URL(detailUrl).searchParams.get("p") || "";
    } catch {
      variantId = "";
    }
    const imageUrls = [...block.matchAll(/<img\b[^>]+src=["']([^"']*\/images\/cards\/card\/[^"']+)["']/gi)]
      .map((match) => absoluteUrl(match[1], detailUrl))
      .filter(Boolean);
    const externalId = `${cardNumber}${variantId}`;
    const row = rowFromFields({
      category: "tcg",
      game: "Dragon Ball Super Fusion World",
      language: "EN",
      manufacturer: "Bandai",
      product: officialProduct,
      set_or_insert: officialProduct,
      name: cardName,
      card_name: cardName,
      card_number: cardNumber,
      checklist_code: cardNumber,
      rarity,
      official_card_type: officialCardType,
      observable_components: [color ? `Color:${color}` : "", traits ? `Special Traits:${traits}` : ""].filter(Boolean),
      image_url: imageUrls[0],
      image_urls: imageUrls,
      external_id: externalId
    }, {
      profile,
      sourceUrl: metadata.sourceUrl,
      sourceName: metadata.sourceName || profile.label,
      sourceRowKey: `${metadata.sourceUrl || profile.source_id}:${externalId || index + 1}`,
      confidence: 0.98
    });
    const missingDetailFields = [
      ["product", officialProduct],
      ["rarity", rarity],
      ["official_card_type", officialCardType],
      ["image_url", imageUrls[0]]
    ].filter(([, value]) => !value).map(([field]) => field);
    if (missingDetailFields.length) {
      row.import_status = catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED;
      for (const field of missingDetailFields) row.field_statuses[field] = catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED;
      row.parse_confidence = Math.min(row.parse_confidence, 0.45);
      row.review_notes = `Missing official detail fields: ${missingDetailFields.join(", ")}`;
    }
    rows.push(row);
  }
  return rows;
}

function parseBandaiRows(rawText = "", metadata = {}, profile = {}) {
  const sourceName = metadata.sourceName || profile.label;
  const blocks = extractBandaiCardBlocks(rawText);
  const gameBySource = {
    one_piece: "One Piece",
    digimon: "Digimon",
    dragon_ball_fusion_world: "Dragon Ball Super Fusion World",
    dragon_ball_masters: "Dragon Ball Super Masters",
    union_arena: "Union Arena",
    battle_spirits: "Battle Spirits"
  };
  return blocks.map((block, index) => {
    const cardNumber = block.match(new RegExp(`\\b(${bandaiCardCodePattern})\\b`, "i"))?.[1]?.toUpperCase().replace("_", "-") || "";
    const rarity = block.match(/\b(SEC|SR|R|UC|C|L|DON!!|P|SP|SCR|Super Rare|Common|Uncommon|Rare)\b/i)?.[1] || "";
    const afterNumber = cardNumber ? normalizeText(block.slice(block.toUpperCase().indexOf(cardNumber) + cardNumber.length)) : block;
    const name = afterNumber
      .replace(new RegExp(`\\b${rarity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ")
      .split(/\b(?:Color|Type|Power|Cost|Attribute|Rarity|Card Type|Effect|Form|DP|Lv\.)\b/i)[0]
      .replace(/\b(?:Alternative Art|Parallel|CARD LIST|PREV|NEXT)\b/gi, " ")
      .trim();
    return rowFromFields({
      category: "tcg",
      game: gameBySource[profile.source_id] || profile.label || "Bandai TCG",
      language: "EN",
      manufacturer: "Bandai",
      product: sourceName,
      set_or_insert: sourceName,
      name,
      card_name: name,
      card_number: cardNumber,
      checklist_code: cardNumber,
      rarity,
      official_card_type: block.match(/\b(?:Leader|Character|Event|Stage|DON!!|Digimon|Tamer|Option|Battle|Extra)\b/i)?.[0] || "",
      observable_components: /\bAlternative Art\b/i.test(block) ? ["alternative_art"] : [],
      external_id: cardNumber
    }, {
      profile,
      sourceUrl: metadata.sourceUrl,
      sourceName,
      sourceRowKey: `${metadata.sourceUrl || profile.source_id}:${cardNumber || index + 1}`,
      confidence: cardNumber && name ? 0.64 : 0.38
    });
  }).filter((row) => row.identity_fields.card_number || row.identity_fields.card_name);
}

function parseExternalRowsByKind(rawText = "", metadata = {}, profile = {}) {
  if (profile.kind === "pokemon_tcg_api") return parsePokemonTcgApiRows(rawText, metadata, profile);
  if (profile.kind === "scryfall_api") return parseScryfallRows(rawText, metadata, profile);
  if (profile.kind === "ygoprodeck_api") return parseYgoproDeckRows(rawText, metadata, profile);
  if (profile.kind === "lorcana_api") return parseLorcanaRows(rawText, metadata, profile);
  if (profile.kind === "swu_db_api") return parseSwuDbRows(rawText, metadata, profile);
  if (profile.source_id === "one_piece") return parseOnePieceOfficialRows(rawText, metadata, profile);
  if (profile.source_id === "digimon") return parseDigimonOfficialRows(rawText, metadata, profile);
  if (profile.source_id === "dragon_ball_fusion_world") return parseDragonBallFusionWorldRows(rawText, metadata, profile);
  if (profile.kind === "bandai_cardlist") return parseBandaiRows(rawText, metadata, profile);
  return null;
}

function confidenceDistribution(rows = []) {
  return rows.reduce((acc, row) => {
    const confidence = Number(row.parse_confidence ?? row.staging?.parse_confidence ?? 0);
    if (confidence >= 0.7) acc.high += 1;
    else if (confidence >= 0.5) acc.medium += 1;
    else acc.low += 1;
    return acc;
  }, { high: 0, medium: 0, low: 0 });
}

function uniqueCount(rows = [], field) {
  return new Set(rows.map((row) => row.identity_fields?.[field] || row.staging?.identity_fields?.[field]).filter(Boolean)).size;
}

function reviewRequiredFields(row = {}) {
  const statuses = row.field_statuses || row.staging?.field_statuses || {};
  return Object.entries(statuses)
    .filter(([, status]) => status === catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED || status === catalogFieldStatuses.REVIEW_REQUIRED)
    .map(([field]) => field);
}

function wrapStagingRow(row = {}, {
  profile = {},
  source = {},
  rawText = "",
  decisionFingerprint = null
} = {}) {
  const sourceUrl = source.href || source.source_url || source.url || "";
  const sourceTitle = source.text || source.source_title || source.title || profile.label;
  const sourceTrust = sourceTrustForProfile(profile);
  const sourceRecord = genericSourceRecord({
    profile,
    source: { ...source, text: sourceTitle },
    sourceUrl,
    rawText,
    decisionFingerprint
  });
  const staging = {
    ...row,
    source_type: profile.source_type,
    source_trust: sourceTrust,
    raw_checksum: sourceRecord.raw_checksum,
    raw_text: row.raw_text || null,
    source_url: sourceUrl,
    source_title: sourceTitle,
    parsed_fields: row.identity_fields || {},
    field_status_by_name: row.field_statuses || {},
    review_required_fields: reviewRequiredFields(row),
    physical_instance_fields: {}
  };
  return {
    source: sourceRecord,
    raw_text: null,
    staging
  };
}

async function buildGenericImportReport(adapter, {
  indexUrl = adapter.profile.default_index_url,
  sourceUrls = [],
  category = adapter.profile.default_category
} = {}) {
  const sources = sourceUrls.length ? sourceUrls : [{ href: indexUrl, text: adapter.profile.label }];
  const sourceRecords = [];
  const staging = [];
  let fetchedCount = 0;
  let parseErrorCount = 0;
  let rawTextErrorCount = 0;

  for (const source of sources) {
    try {
      const sourceFile = await adapter.downloadSource(source);
      fetchedCount += 1;
      const rawText = await adapter.extractRawText(sourceFile);
      const rows = adapter.parseRows(rawText, {
        sourceUrl: sourceFile.source_url,
        sourceName: source.text || source.title || adapter.profile.label,
        category
      });
      const decisionFingerprint = buildCatalogDecisionFingerprint(rows);
      rows.forEach((row) => staging.push(wrapStagingRow(row, {
        profile: adapter.profile,
        source,
        rawText,
        decisionFingerprint
      })));
      if (!rows.length) parseErrorCount += 1;
      sourceRecords.push(genericSourceRecord({
        profile: adapter.profile,
        source,
        sourceUrl: sourceFile.source_url,
        rawText,
        decisionFingerprint,
        category
      }));
    } catch (error) {
      rawTextErrorCount += 1;
      sourceRecords.push({
        source_type: adapter.profile.source_type,
        source_status: catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
        source_name: source.text || source.title || adapter.profile.label,
        source_trust: sourceTrustForProfile(adapter.profile),
        source_url: source.href || source.source_url || source.url || "",
        parser_version: adapterParserVersion(adapter.profile),
        source_metadata: {
          provider: adapter.profile.source_id,
          category,
          adapter_kind: adapter.profile.kind,
          third_party_used: !isOfficialCatalogSourceType(adapter.profile.source_type)
        },
        fetch_error: error?.message || String(error)
      });
    }
  }

  return {
    sources: sourceRecords,
    staging,
    metrics: {
      source_count: sources.length,
      fetched_count: fetchedCount,
      file_count: fetchedCount,
      parse_success_count: staging.length,
      parse_error_count: parseErrorCount,
      raw_text_extract_success_count: fetchedCount,
      raw_text_extract_error_count: rawTextErrorCount,
      parsed_row_count: staging.length,
      product_count: uniqueCount(staging, "product"),
      set_count: uniqueCount(staging, "set_or_insert"),
      card_count: staging.length,
      parallel_count: uniqueCount(staging, "parallel_exact"),
      rarity_count: uniqueCount(staging, "rarity"),
      image_reference_count: staging.filter((row) => row.staging.identity_fields.image_url || row.staging.identity_fields.image_urls?.length).length,
      review_required_count: staging.filter((row) => row.staging.import_status === catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED).length,
      parser_confidence_distribution: confidenceDistribution(staging),
      parse_confidence_distribution: confidenceDistribution(staging),
      skipped_count: 0,
      skipped_non_scope_count: 0,
      duplicate_count: 0,
      promotion_candidate_count: staging.filter((row) => ![
        catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
        catalogImportStatuses.REVIEW_REQUIRED,
        catalogImportStatuses.REJECTED
      ].includes(row.staging.import_status)).length
    }
  };
}

export function createOfficialCatalogSourceAdapter({
  provider = "topps",
  fetchImpl = globalThis.fetch,
  pdfExtractor
} = {}) {
  const profile = officialCatalogSourceProfile(provider);
  const linkFilter = defaultLinkFilter(profile);

  return {
    source_id: profile.source_id,
    source_type: profile.source_type,
    profile,

    async discoverSources({
      indexUrl = profile.default_index_url,
      category = profile.default_category,
      html = ""
    } = {}) {
      if (typeof fetchImpl !== "function" && !html) throw new Error("fetch_unavailable");
      let pageText = html;
      let fetch_error = "";
      if (!pageText) {
        try {
          const response = await fetchImpl(indexUrl, {
            headers: catalogFetchHeaders(profile)
          });
          pageText = await response.text();
          if (!response.ok) fetch_error = `http_${response.status}`;
        } catch (error) {
          fetch_error = error?.message || String(error);
        }
      }
      const links = extractOfficialChecklistLinks(pageText, {
        baseUrl: indexUrl,
        provider: profile.source_id,
        category: category === "all" ? "" : category,
        linkFilter
      }).map((link) => ({
        ...link,
        source_type: profile.source_type,
        source_scope: profile.source_scope
      }));
      return {
        provider: profile.source_id,
        source_type: profile.source_type,
        index_url: indexUrl,
        fetch_error,
        discovered_source_count: links.length,
        sources: links,
        network_endpoint_hints: networkEndpointHints(pageText, indexUrl),
        manual_csv_fallback: {
          enabled: profile.manual_csv_fallback === true || Boolean(fetch_error) || links.length === 0,
          columns: manualCsvColumns(profile),
          reason: fetch_error ? "index_fetch_failed" : links.length ? "optional_fallback" : "no_stable_source_links_discovered"
        },
        policy: {
          staging_only: true,
          reviewed_internal_auto_promotion: false,
          marketplace_titles_allowed: false,
          physical_instance_fields_allowed: false,
          curated_source_policy: catalogSourceImportPolicy(profile.source_type)
        }
      };
    },

    async downloadSource(source = {}) {
      if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
      const href = source.href || source.source_url || source.url;
      const response = await fetchImpl(href, {
        headers: catalogFetchHeaders(profile)
      });
      const contentType = response.headers?.get?.("content-type") || "";
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!response.ok) throw new Error(`official_source_download_failed:${response.status}`);
      const sourceFile = {
        source,
        source_url: href,
        content_type: contentType,
        payload: buffer
      };
      if (profile.source_id === "dragon_ball_fusion_world" && /html/i.test(contentType)) {
        const sourceUrl = new URL(href);
        const categoryIds = sourceUrl.searchParams.getAll("category[]").filter((value) => /^\d+$/.test(value));
        if (categoryIds.length) {
          const html = buffer.toString("utf8");
          const detailUrls = dbfwDetailUrls(html, href);
          if (!detailUrls.length) throw new Error("official_detail_links_empty");
          if (detailUrls.length > 64) throw new Error(`official_detail_source_exceeds_bound:${detailUrls.length}`);
          sourceFile.detail_pages = await mapWithConcurrency(detailUrls, 6, async (detailUrl) => {
            const detailHtml = await fetchOfficialDetailHtml(fetchImpl, detailUrl, profile);
            return { href: detailUrl, html: detailHtml };
          });
        }
      }
      return sourceFile;
    },

    async fetchSource(source = {}) {
      return this.downloadSource(source);
    },

    async extractRawText(sourceFile = {}) {
      if (profile.source_id === "dragon_ball_fusion_world" && Array.isArray(sourceFile.detail_pages)) {
        return JSON.stringify({
          schema_version: "bandai-detail-bundle-v1",
          listing_html: Buffer.isBuffer(sourceFile.payload)
            ? sourceFile.payload.toString("utf8")
            : Buffer.from(sourceFile.payload || []).toString("utf8"),
          detail_pages: sourceFile.detail_pages
        });
      }
      if (["one_piece", "digimon"].includes(profile.source_id) && /html/i.test(sourceFile.content_type || "")) {
        const html = Buffer.isBuffer(sourceFile.payload)
          ? sourceFile.payload.toString("utf8")
          : Buffer.from(sourceFile.payload || []).toString("utf8");
        if (!normalizeText(html)) throw new Error("official_html_text_extraction_empty");
        return html;
      }
      const extracted = await extractOfficialChecklistPayload(sourceFile.payload || "", {
        sourceUrl: sourceFile.source_url,
        contentType: sourceFile.content_type,
        pdfExtractor
      });
      return extracted.text;
    },

    parseRows(rawText = "", metadata = {}) {
      const baseMetadata = {
        provider: profile.source_id,
        sourceType: profile.source_type,
        category: metadata.category || profile.default_category,
        ...metadata
      };
      const specializedRows = parseExternalRowsByKind(rawText, baseMetadata, profile);
      if (specializedRows) return specializedRows;
      return isOfficialReleaseCatalogSourceType(profile.source_type)
        ? parseOfficialReleaseMetadata(rawText, baseMetadata)
        : parseOfficialChecklistText(rawText, baseMetadata);
    },

    normalizeRows(rows = []) {
      return rows.map((row) => ({
        ...row,
        physical_instance_fields: {},
        import_status: row.import_status === catalogImportStatuses.REVIEWED_INTERNAL
          ? catalogImportStatuses.OFFICIAL_CHECKLIST_CONFIRMED
          : row.import_status
      }));
    },

    writeImportStaging(rows = []) {
      return {
        dry_run: true,
        row_count: rows.length,
        rows: this.normalizeRows(rows)
      };
    },

    async buildImportReport({
      indexUrl = profile.default_index_url,
      sourceUrls = [],
      category = profile.default_category,
      outPath = ""
    } = {}) {
      const useGenericPipeline = [
        "bandai_cardlist",
        "pokemon_tcg_api",
        "scryfall_api",
        "ygoprodeck_api",
        "official_card_database"
      ].includes(profile.kind) || isCommunityCatalogSourceType(profile.source_type) || isExternalDirectoryCatalogSourceType(profile.source_type);
      const report = useGenericPipeline
        ? await buildGenericImportReport(this, {
          indexUrl,
          sourceUrls,
          category: category === "all" ? "" : category
        })
        : await buildOfficialChecklistImport({
          fetchImpl,
          indexUrl,
          sourceUrls,
          provider: profile.source_id,
          sourceType: profile.source_type,
          category: category === "all" ? "" : category,
          linkFilter,
          pdfExtractor
        });
      const output = {
        schema_version: "official-catalog-source-adapter-report-v0",
        provider: profile.source_id,
        source_type: profile.source_type,
        source_scope: profile.source_scope,
        source_kind: profile.kind,
        source_trust: sourceTrustForProfile(profile),
        source_policy: catalogSourceImportPolicy(profile.source_type),
        staging_only: true,
        reviewed_internal_auto_promotion: false,
        external_title_final_title_allowed: false,
        paid_recognition_eval_ran: false,
        metrics: summarizeImport(report),
        raw: report
      };
      await writeJson(outPath, output);
      return output;
    },

    async report(options = {}) {
      return this.buildImportReport(options);
    }
  };
}

export class OfficialCatalogSourceAdapter {
  constructor(options = {}) {
    Object.assign(this, createOfficialCatalogSourceAdapter(options));
  }
}

export class ExternalCatalogAdapter {
  constructor(options = {}) {
    const provider = options.provider || "external";
    const profile = officialCatalogSourceProfile(provider);
    if (isOfficialCatalogSourceType(profile.source_type)) {
      throw new Error(`external_adapter_requires_external_source:${profile.source_type}`);
    }
    Object.assign(this, createOfficialCatalogSourceAdapter(options));
  }
}

export async function buildOfficialCatalogImportReport(options = {}) {
  const adapter = createOfficialCatalogSourceAdapter(options);
  return adapter.buildImportReport(options);
}

export async function discoverOfficialCatalogSource(options = {}) {
  const adapter = createOfficialCatalogSourceAdapter(options);
  return adapter.discoverSources(options);
}
