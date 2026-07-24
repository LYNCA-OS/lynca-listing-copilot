import { catalogSourceTypes } from "./catalog-contract.mjs";
import { decisionActiveCatalogCard } from "./catalog-decision-eligibility.mjs";

const FAMILY_DEFINITIONS = [
  {
    family: "dragon_ball_fusion_world",
    label: "Dragon Ball Super Fusion World",
    official_source_types: [catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE],
    matches: (text) => /\bfusion\s+world\b/i.test(text),
    anchor_patterns: [/\b(?:FB|FS|EX|PR|SD)\d{2}[- ]?\d{2,3}\b/gi]
  },
  {
    family: "dragon_ball_masters",
    label: "Dragon Ball Super Masters",
    official_source_types: [catalogSourceTypes.BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE],
    matches: (text) => !/\bfusion\s+world\b/i.test(text) && /\b(?:dragon\s*ball|dbs)\b/i.test(text),
    anchor_patterns: [/\bBT\d{4,5}\b/gi, /\bBT\d{1,2}[- ]\d{3}\b/gi]
  },
  {
    family: "one_piece",
    label: "One Piece Card Game",
    official_source_types: [catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST],
    matches: (text) => /\bone\s+piece\b/i.test(text),
    anchor_patterns: [/\b(?:OP|ST|EB|PRB)\d{2}[- ]\d{3}\b/gi, /\bP[- ]\d{3}\b/gi]
  },
  {
    family: "digimon",
    label: "Digimon Card Game",
    official_source_types: [catalogSourceTypes.BANDAI_DIGIMON_OFFICIAL_CARDLIST],
    matches: (text) => /\bdigimon\b/i.test(text),
    anchor_patterns: [/\b(?:BT|EX)\d{1,2}[- ]\d{3}\b/gi, /\bST\d{1,2}[- ]\d{2,3}\b/gi, /\b(?:P|LM)[- ]\d{3}\b/gi]
  },
  {
    family: "pokemon",
    label: "Pokemon TCG",
    official_source_types: [catalogSourceTypes.POKEMON_OFFICIAL_CARD_SEARCH],
    matches: (text) => /\bpok[eé]mon\b/i.test(text),
    anchor_patterns: []
  },
  {
    family: "magic",
    label: "Magic: The Gathering",
    official_source_types: [catalogSourceTypes.WOTC_GATHERER_OFFICIAL_DATABASE],
    matches: (text) => /\bmagic\s*:?\s*the\s+gathering\b|\bmtg\b/i.test(text),
    anchor_patterns: []
  },
  {
    family: "yugioh",
    label: "Yu-Gi-Oh!",
    official_source_types: [catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE],
    matches: (text) => /\byu[- ]?gi[- ]?oh\b|\byugioh\b/i.test(text),
    anchor_patterns: [/\b[A-Z0-9]{2,8}-(?:EN|JP|EU)?\d{2,4}[A-Z]?\b/gi]
  },
  {
    family: "lorcana",
    label: "Disney Lorcana",
    official_source_types: [catalogSourceTypes.LORCANA_OFFICIAL_CARD_DATABASE],
    matches: (text) => /\blorcana\b/i.test(text),
    anchor_patterns: []
  },
  {
    family: "star_wars_unlimited",
    label: "Star Wars Unlimited",
    official_source_types: [catalogSourceTypes.STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST],
    matches: (text) => /\bstar\s+wars\s+unlimited\b|\bswu\s+tcg\b/i.test(text),
    anchor_patterns: []
  },
  {
    family: "flesh_and_blood",
    label: "Flesh and Blood",
    official_source_types: [catalogSourceTypes.FAB_OFFICIAL_CARD_DATABASE],
    matches: (text) => /\bflesh\s+and\s+blood\b/i.test(text),
    anchor_patterns: [/\b[A-Z]{3}\d{3}\b/gi]
  },
  {
    family: "union_arena",
    label: "Union Arena",
    official_source_types: [catalogSourceTypes.BANDAI_UNION_ARENA_OFFICIAL_CARDLIST],
    matches: (text) => /\bunion\s+arena\b/i.test(text),
    anchor_patterns: [/\bUA\d{2}BT[- ][A-Z0-9]+[- ]\d{3}\b/gi]
  },
  {
    family: "battle_spirits",
    label: "Battle Spirits Saga",
    official_source_types: [catalogSourceTypes.BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST],
    matches: (text) => /\bbattle\s+spirits(?:\s+saga)?\b/i.test(text),
    anchor_patterns: [/\bBSS\d{2}[- ]\d{3}\b/gi]
  },
  {
    family: "weiss_schwarz",
    label: "Weiss Schwarz",
    official_source_types: [catalogSourceTypes.BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST],
    matches: (text) => /\bwei(?:ss|ß)\s+schwarz\b/i.test(text),
    anchor_patterns: [/\b[A-Z0-9]{2,8}\/[A-Z0-9]{2,8}-\d{2,3}[A-Z]?\b/gi]
  },
  {
    family: "vanguard",
    label: "Cardfight!! Vanguard",
    official_source_types: [catalogSourceTypes.BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST],
    matches: (text) => /\bcardfight!?\s*vanguard\b|\bvanguard\s+tcg\b/i.test(text),
    anchor_patterns: [/\bD-(?:BT|SS|PR)\d{2}\/\d{3}[A-Z]?\b/gi]
  },
  {
    family: "shadowverse_evolve",
    label: "Shadowverse Evolve",
    official_source_types: [catalogSourceTypes.BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST],
    matches: (text) => /\bshadowverse\s+evolve\b/i.test(text),
    anchor_patterns: [/\bBP\d{2}[- ]\d{3}\b/gi]
  },
  {
    family: "grand_archive",
    label: "Grand Archive TCG",
    official_source_types: [catalogSourceTypes.GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE],
    matches: (text) => /\bgrand\s+archive(?:\s+tcg)?\b/i.test(text),
    anchor_patterns: []
  },
  {
    family: "altered",
    label: "Altered TCG",
    official_source_types: [catalogSourceTypes.ALTERED_OFFICIAL_CARD_DATABASE],
    matches: (text) => /\baltered\s+tcg\b/i.test(text),
    anchor_patterns: []
  }
];

export const tcgDemandCoverageContract = Object.freeze({
  schema_version: "tcg-demand-coverage-contract-v1",
  scope: "WRITER_REVIEWED_TCG_FAMILIES",
  title_derived_anchor_authority: "DIAGNOSTIC_ONLY",
  writes_database: false,
  changes_catalog_decisions: false,
  families: Object.freeze(FAMILY_DEFINITIONS.map((definition) => Object.freeze({ ...definition })))
});

function cleanText(value = "") {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function sourceType(value = "") {
  return cleanText(value).toUpperCase();
}

function rowText(row = {}) {
  return [row.canonical_title, row.product, row.sport, row.manufacturer, row.brand, row.set_or_insert]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function definitionForFamily(family = "") {
  return FAMILY_DEFINITIONS.find((definition) => definition.family === family) || null;
}

export function classifyTcgDemandRow(row = {}) {
  const text = rowText(row);
  const matches = FAMILY_DEFINITIONS.filter((definition) => definition.matches(text));
  if (matches.length === 1) return { status: "CLASSIFIED", family: matches[0].family };
  if (matches.length > 1) return { status: "AMBIGUOUS", family: null };
  return { status: "OUT_OF_SCOPE", family: null };
}

function normalizeHyphen(value = "") {
  return cleanText(value).toUpperCase().replace(/[‐‑‒–—―]/g, "-").replace(/^#\s*/, "");
}

function normalizeDragonBallMastersAnchor(value = "") {
  const compact = normalizeHyphen(value).replace(/\s+/g, "");
  const compactMatch = compact.match(/^BT(\d{1,2})(\d{3})(?:_[A-Z0-9]+)?$/);
  if (compactMatch) {
    const setNumber = Number(compactMatch[1]);
    if (setNumber >= 1 && setNumber <= 31) return `BT${setNumber}-${compactMatch[2]}`;
  }
  const separated = compact.match(/^BT(\d{1,2})-(\d{3})(?:_[A-Z0-9]+)?$/);
  if (!separated) return null;
  const setNumber = Number(separated[1]);
  return setNumber >= 1 && setNumber <= 31 ? `BT${setNumber}-${separated[2]}` : null;
}

function matchesWholePattern(value, pattern) {
  const flags = pattern.flags.replaceAll("g", "");
  return new RegExp(`^(?:${pattern.source})$`, flags).test(value);
}

export function normalizeTcgCardCode(value = "", family = "") {
  const definition = definitionForFamily(family);
  if (!definition) return null;
  if (family === "dragon_ball_masters") return normalizeDragonBallMastersAnchor(value);
  const compact = normalizeHyphen(value).replace(/\s*([-\/])\s*/g, "$1").replace(/\s+/g, "");
  return definition.anchor_patterns.some((pattern) => matchesWholePattern(compact, pattern)) ? compact : null;
}

function normalizedUnique(values = [], family = "") {
  return [...new Set(values.map((value) => normalizeTcgCardCode(value, family)).filter(Boolean))];
}

function titleAnchorCandidates(title = "", family = "") {
  const definition = definitionForFamily(family);
  if (!definition) return [];
  const candidates = [];
  for (const pattern of definition.anchor_patterns) {
    pattern.lastIndex = 0;
    for (const match of cleanText(title).matchAll(pattern)) candidates.push(match[0]);
  }
  return normalizedUnique(candidates, family);
}

export function extractTcgDemandCardCode(row = {}, family = "") {
  const structured = normalizedUnique([row.card_number, row.checklist_code], family);
  if (structured.length === 1) {
    return { status: "MEASURABLE", origin: "STRUCTURED_FIELD", card_code: structured[0] };
  }
  if (structured.length > 1) {
    return { status: "AMBIGUOUS", origin: "STRUCTURED_FIELD", card_code: null };
  }
  const titleAnchors = titleAnchorCandidates(row.canonical_title, family);
  if (titleAnchors.length === 1) {
    return { status: "MEASURABLE", origin: "TITLE_DIAGNOSTIC", card_code: titleAnchors[0] };
  }
  if (titleAnchors.length > 1) {
    return { status: "AMBIGUOUS", origin: "TITLE_DIAGNOSTIC", card_code: null };
  }
  return { status: "NONE", origin: null, card_code: null };
}

function operationalStage({ sourceCount = 0, cardCount = 0, decisionActiveCardCount = 0 } = {}) {
  if (decisionActiveCardCount > 0) return "DECISION_ACTIVE";
  if (cardCount > 0) return "INGESTED";
  if (sourceCount > 0) return "DISCOVERED";
  return "REGISTERED_ONLY";
}

function coverageState(row = {}) {
  if (row.reviewed_demand_count === 0) return "NO_DEMAND";
  if (row.official_source_count === 0) return "OFFICIAL_SOURCE_MISSING";
  if (row.official_decision_active_card_count === 0) return "OFFICIAL_SOURCE_NOT_DECISION_ACTIVE";
  if (row.measurable_card_code_anchor_count === 0) return "OFFICIAL_NO_MEASURABLE_CARD_CODE_ANCHORS";
  if (row.card_code_match_count === row.measurable_card_code_anchor_count) return "OFFICIAL_CARD_CODE_ANCHORS_COVERED";
  if (row.card_code_match_count > 0) return "OFFICIAL_PARTIAL_CARD_CODE_COVERAGE";
  return "OFFICIAL_CARD_CODE_ANCHORS_UNCOVERED";
}

function redundancyState(row = {}) {
  if (row.reviewed_demand_count === 0) return "NO_DEMAND";
  return row.official_decision_active_card_count > 0 ? "WRITER_AND_OFFICIAL" : "WRITER_ONLY";
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function cardCodePrefix(cardCode = "") {
  const normalized = cleanText(cardCode).toUpperCase();
  if (!normalized) return null;
  if (/^[A-Z]{3}\d{3}$/.test(normalized)) return normalized.slice(0, 3);
  if (/^D-[A-Z]{2}\d{2}\//.test(normalized)) return normalized.split("/")[0];
  if (normalized.includes("/")) return normalized.slice(0, normalized.lastIndexOf("/"));
  if (normalized.includes("-")) return normalized.split("-")[0];
  return null;
}

function sortedBreakdown(counts = new Map()) {
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((left, right) => right.count - left.count || left.prefix.localeCompare(right.prefix));
}

export function buildTcgDemandCoverage({ sources = [], cards = [], generatedAt = new Date().toISOString() } = {}) {
  const sourcesById = new Map(sources.map((source) => [cleanText(source.id), source]));
  const reviewedRows = cards.filter((card) => {
    const source = sourcesById.get(cleanText(card.source_id));
    return sourceType(source?.source_type) === catalogSourceTypes.INTERNAL_CORRECTED_TITLE
      && decisionActiveCatalogCard({ source, card });
  });
  const demandByFamily = new Map(FAMILY_DEFINITIONS.map(({ family }) => [family, []]));
  let ambiguousFamilyCount = 0;
  for (const card of reviewedRows) {
    const classification = classifyTcgDemandRow(card);
    if (classification.status === "CLASSIFIED") demandByFamily.get(classification.family).push(card);
    else if (classification.status === "AMBIGUOUS") ambiguousFamilyCount += 1;
  }

  const rows = FAMILY_DEFINITIONS.map((definition) => {
    const allowedSourceTypes = new Set(definition.official_source_types);
    const familySources = sources.filter((source) => allowedSourceTypes.has(sourceType(source.source_type)));
    const familySourceIds = new Set(familySources.map((source) => cleanText(source.id)));
    const familyCards = cards.filter((card) => familySourceIds.has(cleanText(card.source_id)));
    const activeFamilyCards = familyCards.filter((card) => decisionActiveCatalogCard({
      source: sourcesById.get(cleanText(card.source_id)),
      card
    }));
    const officialCodes = new Set(activeFamilyCards.flatMap((card) => normalizedUnique([
      card.card_number,
      card.checklist_code
    ], definition.family)));
    const demands = demandByFamily.get(definition.family);
    let structuredAnchorCount = 0;
    let titleDiagnosticAnchorCount = 0;
    let ambiguousAnchorCount = 0;
    let matchCount = 0;
    const unmatchedPrefixCounts = new Map();
    for (const demand of demands) {
      const anchor = extractTcgDemandCardCode(demand, definition.family);
      if (anchor.status === "AMBIGUOUS") {
        ambiguousAnchorCount += 1;
        continue;
      }
      if (anchor.status !== "MEASURABLE") continue;
      if (anchor.origin === "STRUCTURED_FIELD") structuredAnchorCount += 1;
      if (anchor.origin === "TITLE_DIAGNOSTIC") titleDiagnosticAnchorCount += 1;
      if (officialCodes.has(anchor.card_code)) matchCount += 1;
      else {
        const prefix = cardCodePrefix(anchor.card_code);
        if (prefix) unmatchedPrefixCounts.set(prefix, Number(unmatchedPrefixCounts.get(prefix) || 0) + 1);
      }
    }
    const measurableCount = structuredAnchorCount + titleDiagnosticAnchorCount;
    const row = {
      family: definition.family,
      label: definition.label,
      official_source_types: definition.official_source_types,
      reviewed_demand_count: demands.length,
      writer_directory_decision_active_count: demands.length,
      official_source_count: familySources.length,
      official_card_count: familyCards.length,
      official_decision_active_card_count: activeFamilyCards.length,
      source_operational_stage: operationalStage({
        sourceCount: familySources.length,
        cardCount: familyCards.length,
        decisionActiveCardCount: activeFamilyCards.length
      }),
      measurable_card_code_anchor_count: measurableCount,
      structured_card_code_anchor_count: structuredAnchorCount,
      title_diagnostic_card_code_anchor_count: titleDiagnosticAnchorCount,
      ambiguous_card_code_anchor_count: ambiguousAnchorCount,
      card_code_match_count: matchCount,
      unmatched_card_code_anchor_count: measurableCount - matchCount,
      unmatched_card_code_prefix_breakdown: sortedBreakdown(unmatchedPrefixCounts),
      card_code_match_rate: ratio(matchCount, measurableCount)
    };
    return {
      ...row,
      directory_redundancy_state: redundancyState(row),
      coverage_state: coverageState(row)
    };
  });

  const classifiedCount = rows.reduce((sum, row) => sum + row.reviewed_demand_count, 0);
  const measurableCount = rows.reduce((sum, row) => sum + row.measurable_card_code_anchor_count, 0);
  const matchCount = rows.reduce((sum, row) => sum + row.card_code_match_count, 0);
  return {
    schema_version: "tcg-demand-coverage-v1",
    contract_version: tcgDemandCoverageContract.schema_version,
    generated_at: generatedAt,
    scope: tcgDemandCoverageContract.scope,
    invariants: {
      read_only: true,
      raw_writer_titles_emitted: false,
      title_derived_anchors_are_diagnostic_only: true,
      card_code_match_is_not_title_or_field_truth: true,
      writer_directory_rows_modified: false,
      changes_catalog_decisions: false
    },
    summary: {
      reviewed_internal_card_count: reviewedRows.length,
      classified_tcg_demand_count: classifiedCount,
      ambiguous_family_count: ambiguousFamilyCount,
      out_of_scope_reviewed_count: reviewedRows.length - classifiedCount - ambiguousFamilyCount,
      demanded_family_count: rows.filter((row) => row.reviewed_demand_count > 0).length,
      official_source_active_demanded_family_count: rows.filter((row) => row.reviewed_demand_count > 0 && row.source_operational_stage === "DECISION_ACTIVE").length,
      missing_or_inactive_official_source_demand_count: rows
        .filter((row) => row.source_operational_stage !== "DECISION_ACTIVE")
        .reduce((sum, row) => sum + row.reviewed_demand_count, 0),
      measurable_card_code_anchor_count: measurableCount,
      card_code_match_count: matchCount,
      card_code_match_rate: ratio(matchCount, measurableCount),
      structured_card_code_anchor_count: rows.reduce((sum, row) => sum + row.structured_card_code_anchor_count, 0),
      title_diagnostic_card_code_anchor_count: rows.reduce((sum, row) => sum + row.title_diagnostic_card_code_anchor_count, 0),
      ambiguous_card_code_anchor_count: rows.reduce((sum, row) => sum + row.ambiguous_card_code_anchor_count, 0)
    },
    families: rows
  };
}
