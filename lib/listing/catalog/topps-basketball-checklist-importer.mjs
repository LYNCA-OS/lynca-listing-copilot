import {
  basketballToppsChecklistAllowlist,
  basketballToppsChecklistExclusions,
  catalogFieldStatuses,
  catalogImportStatuses,
  catalogSourceTypes
} from "./catalog-contract.mjs";

export const defaultToppsChecklistIndexUrl = "https://www.topps.com/pages/checklists";

function normalizeText(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
}

function absoluteUrl(href = "", baseUrl = defaultToppsChecklistIndexUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return "";
  }
}

function checklistName(text = "", href = "") {
  return normalizeText(stripHtml(text) || href.split("/").pop()?.replace(/[-_]+/g, " "));
}

export function isAllowedToppsBasketballChecklistLink({ text = "", href = "" } = {}) {
  const name = checklistName(text, href);
  if (!name) return false;
  if (basketballToppsChecklistExclusions.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(name))) {
    return false;
  }
  if (!/\bbasketball\b/i.test(name)) return false;
  return basketballToppsChecklistAllowlist.some((term) => {
    const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${pattern}\\b`, "i").test(name);
  });
}

export function extractToppsBasketballChecklistLinks(html = "", {
  baseUrl = defaultToppsChecklistIndexUrl
} = {}) {
  const links = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(anchorPattern)) {
    const href = absoluteUrl(match[1], baseUrl);
    const text = stripHtml(match[2]);
    if (!href || !isAllowedToppsBasketballChecklistLink({ text, href })) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({
      href,
      text: checklistName(text, href)
    });
  }
  return links;
}

function maybeChecklistCode(line = "") {
  return normalizeText(line).match(/\b[A-Z]{1,8}[- ][A-Z0-9]{1,16}\b/i)?.[0]?.toUpperCase().replace(/\s+/g, "-") || null;
}

function maybeCardNumber(line = "") {
  return normalizeText(line).match(/(?:^|\s)#?\s*([A-Z0-9]{1,8}[-]?[A-Z0-9]{0,12})(?:\s|$)/i)?.[1]?.toUpperCase() || null;
}

function linePlayers(line = "") {
  const withoutCode = normalizeText(line)
    .replace(/\b[A-Z]{1,8}[- ][A-Z0-9]{1,16}\b/g, " ")
    .replace(/#\s*[A-Z0-9-]+/g, " ")
    .replace(/\b(?:Topps|Chrome|Basketball|Bowman|University|Sapphire|Finest|Card|Checklist|Auto|Autograph|Parallel)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const names = withoutCode.split(/\s+(?:\/|&|and)\s+/i)
    .map(normalizeText)
    .filter((value) => /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}$/.test(value));
  return [...new Set(names)];
}

function parseProductFromName(name = "") {
  const text = normalizeText(name);
  const year = text.match(/\b(20\d{2}(?:-\d{2})?)\b/)?.[1] || null;
  const product = text
    .replace(/\b(20\d{2}(?:-\d{2})?)\b/g, " ")
    .replace(/\bChecklist\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    year,
    manufacturer: "Topps",
    brand: product.match(/\bBowman\b/i) ? "Bowman" : "Topps",
    product: product || "Topps Basketball"
  };
}

export function parseToppsBasketballChecklistText(rawText = "", {
  sourceName = "",
  sourceUrl = ""
} = {}) {
  const product = parseProductFromName(sourceName);
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map(stripHtml)
    .filter((line) => line.length >= 4);

  const rows = [];
  lines.forEach((line, index) => {
    const checklistCode = maybeChecklistCode(line);
    const cardNumber = maybeCardNumber(line);
    const players = linePlayers(line);
    if (!checklistCode && !cardNumber && !players.length) return;
    const reviewRequired = !players.length || (!checklistCode && !cardNumber);
    rows.push({
      import_status: reviewRequired
        ? catalogImportStatuses.REVIEW_REQUIRED
        : catalogImportStatuses.READY_CANDIDATE,
      source_row_key: `${sourceUrl || sourceName || "topps"}:${index + 1}`,
      canonical_title: normalizeText([product.year, product.product, players.join(" / "), cardNumber ? `#${cardNumber}` : checklistCode].filter(Boolean).join(" ")),
      identity_fields: {
        sport: "basketball",
        league: /NBA/i.test(line) ? "NBA" : null,
        season_year: product.year,
        manufacturer: product.manufacturer,
        brand: product.brand,
        product: product.product,
        players,
        card_number: cardNumber,
        checklist_code: checklistCode
      },
      physical_instance_fields: {},
      field_statuses: {
        sport: catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE,
        season_year: product.year ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        product: product.product ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        players: players.length ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        card_number: cardNumber ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        checklist_code: checklistCode ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED
      },
      parse_confidence: reviewRequired ? 0.4 : 0.68,
      review_notes: reviewRequired ? "Topps checklist row is ambiguous and requires review" : null
    });
  });
  return rows;
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`Topps checklist fetch failed ${response.status}: ${text.slice(0, 120)}`);
  return text;
}

export async function buildToppsBasketballChecklistImport({
  fetchImpl = globalThis.fetch,
  indexUrl = defaultToppsChecklistIndexUrl
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const indexHtml = await fetchText(fetchImpl, indexUrl);
  const links = extractToppsBasketballChecklistLinks(indexHtml, { baseUrl: indexUrl });
  const sources = [];
  const staging = [];

  for (const link of links) {
    const raw = await fetchText(fetchImpl, link.href);
    const source = {
      source_type: catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST,
      source_status: "TOPPS_OFFICIAL_RAW",
      source_name: link.text,
      source_url: link.href,
      source_metadata: {
        index_url: indexUrl,
        corrected_title_used: false,
        third_party_used: false
      },
      raw_text: raw
    };
    const rows = parseToppsBasketballChecklistText(raw, {
      sourceName: link.text,
      sourceUrl: link.href
    });
    sources.push(source);
    rows.forEach((row) => staging.push({ source, staging: row }));
  }

  return {
    sources,
    staging,
    metrics: {
      topps_basketball_link_count: links.length,
      topps_file_download_count: sources.length,
      catalog_card_count: staging.length,
      review_required_count: staging.filter((row) => row.staging.import_status === catalogImportStatuses.REVIEW_REQUIRED).length
    }
  };
}
