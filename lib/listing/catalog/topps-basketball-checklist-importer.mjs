import {
  basketballToppsChecklistAllowlist,
  basketballToppsChecklistExclusions,
  catalogFieldStatuses,
  catalogImportStatuses,
  catalogSourceTypes
} from "./catalog-contract.mjs";
import { inflateRawSync } from "node:zlib";

export const defaultToppsChecklistIndexUrl = "https://www.topps.com/pages/checklists";

function normalizeText(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
}

function decodeXml(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
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
  const firstToken = normalizeText(line).match(/^\s*([A-Z0-9]{1,8}-[A-Z0-9]{1,16}|[A-Z]{1,8}[0-9][A-Z0-9]{0,8})\b/i)?.[1] || "";
  return firstToken ? firstToken.toUpperCase().replace(/\s+/g, "-") : null;
}

function maybeCardNumber(line = "") {
  return normalizeText(line).match(/^\s*#?\s*(\d{1,4}|[A-Z0-9]{1,8}-[A-Z0-9]{1,16}|[A-Z]{1,8}[0-9][A-Z0-9]{0,8})\b/i)?.[1]?.toUpperCase() || null;
}

function parseCardLine(line = "") {
  const text = normalizeText(line);
  const match = text.match(/^(\d{1,4}|[A-Z0-9]{1,8}-[A-Z0-9]{1,16}|[A-Z]{1,8}[0-9][A-Z0-9]{0,8})\s+(.+)$/i);
  if (!match) return null;

  const cardNumber = match[1].toUpperCase();
  const rest = normalizeText(match[2].replace(/#\s*[A-Z0-9-]+\s*$/i, " "));
  if (!rest || /^\d+\s+cards?$/i.test(`${cardNumber} ${rest}`)) return null;
  if (/\b(?:checklist|parallel|parallels|cards?)\b/i.test(rest) && !/,/.test(rest)) return null;

  const rc = /\bRC\b/i.test(rest);
  const withoutRc = normalizeText(rest.replace(/\bRC\b/gi, " "));
  const [namePart, ...teamParts] = withoutRc.split(",").map(normalizeText);
  if (!namePart || !/\p{L}/u.test(namePart)) return null;
  if (/\b(?:checklist|parallel|parallels|autographs?|variations?|cards?)\b/i.test(namePart) && !/\s/.test(namePart.replace(/-/g, " "))) return null;

  const players = namePart.split(/\s+(?:\/|&|and)\s+/i)
    .map(normalizeText)
    .filter((value) => /\p{L}/u.test(value) && !/\b(?:checklist|parallel|cards?)\b/i.test(value));
  if (!players.length) return null;

  return {
    card_number: cardNumber,
    checklist_code: /[A-Z]/i.test(cardNumber) || cardNumber.includes("-") ? cardNumber : null,
    players: [...new Set(players)],
    team: normalizeText(teamParts.join(", ")).replace(/\bRC\b/gi, "").trim() || null,
    observable_components: rc ? ["rc"] : []
  };
}

function sectionInfo(section = "") {
  const text = normalizeText(section).replace(/\s+Checklist$/i, "");
  const isBase = /\bBase(?: Set)?\b/i.test(text);
  const isAuto = /\bAuto(?:graph)?s?\b/i.test(text);
  const isCombo = /\bCombo\b/i.test(text);
  return {
    set_or_insert: isBase ? null : text || null,
    official_card_type: isBase ? "Base" : isAuto ? "Autograph" : isCombo ? "Combo" : null,
    observable_components: isAuto ? ["auto"] : []
  };
}

function isSectionHeading(line = "") {
  const text = normalizeText(line);
  if (!text || /^\d+\s+cards?$/i.test(text)) return false;
  if (/^parallels?$/i.test(text)) return false;
  if (/^player number \(select cards/i.test(text)) return false;
  if (/^(?:Blackout|Clear|Golden Mirror|Team Color Border|First Card\s*\/\s*1)$/i.test(text)) return false;
  if (/\b(?:Checklist|Autographs?|Variation|Insert|Refractors?|Selections|Stars|Real Ones|Throwback|Combo)\b/i.test(text)) return true;
  if (parseCardLine(text)) return false;
  return false;
}

function zipEntries(buffer) {
  const entries = new Map();
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return entries;

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
      let data = Buffer.alloc(0);
      if (compressionMethod === 0) data = compressed;
      if (compressionMethod === 8) data = inflateRawSync(compressed);
      if (data.length) entries.set(fileName, data);
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function sharedStringsFromXml(xml = "") {
  const strings = [];
  for (const match of String(xml || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((part) => decodeXml(part[1]));
    strings.push(normalizeText(parts.join("")));
  }
  return strings;
}

function columnIndex(cellRef = "") {
  const letters = String(cellRef || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function cellText(cellXml = "", sharedStrings = []) {
  const type = cellXml.match(/\bt=["']([^"']+)["']/i)?.[1] || "";
  if (type === "inlineStr") {
    return normalizeText([...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join(""));
  }
  const value = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || "";
  if (!value) return "";
  if (type === "s") return normalizeText(sharedStrings[Number(value)] || "");
  return normalizeText(decodeXml(value));
}

export function extractXlsxText(buffer) {
  const entries = zipEntries(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []));
  if (!entries.size) return "";
  const sharedStrings = sharedStringsFromXml(entries.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/sheet(\d+)/i)?.[1] || 0) - Number(b.match(/sheet(\d+)/i)?.[1] || 0));
  const lines = [];

  for (const sheetName of sheetNames) {
    const xml = entries.get(sheetName)?.toString("utf8") || "";
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const ref = cellMatch[1].match(/\br=["']([^"']+)["']/i)?.[1] || "";
        cells[columnIndex(ref)] = cellText(`<c ${cellMatch[1]}>${cellMatch[2]}</c>`, sharedStrings);
      }
      const line = cells.map((value) => normalizeText(value)).filter(Boolean).join("\t");
      if (line) lines.push(line);
    }
  }

  return lines.join("\n");
}

export function extractToppsChecklistText(payload, {
  sourceUrl = "",
  contentType = ""
} = {}) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const type = normalizeText(contentType).toLowerCase();
  const lowerUrl = String(sourceUrl || "").toLowerCase();
  if (buffer.slice(0, 4).toString("hex") === "504b0304" || type.includes("spreadsheet") || lowerUrl.endsWith(".xlsx")) {
    return extractXlsxText(buffer);
  }
  return buffer.toString("utf8");
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
  let currentSection = "";
  lines.forEach((line, index) => {
    if (isSectionHeading(line)) {
      currentSection = line;
      return;
    }
    const parsed = parseCardLine(line);
    if (!parsed) return;
    const checklistCode = maybeChecklistCode(line) || parsed.checklist_code;
    const cardNumber = maybeCardNumber(line) || parsed.card_number;
    const section = sectionInfo(currentSection);
    const observableComponents = [...new Set([
      ...section.observable_components,
      ...parsed.observable_components
    ])];
    const players = parsed.players;
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
        set_or_insert: section.set_or_insert,
        players,
        team: parsed.team,
        card_number: cardNumber,
        checklist_code: checklistCode,
        official_card_type: section.official_card_type,
        observable_components: observableComponents
      },
      physical_instance_fields: {},
      field_statuses: {
        sport: catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE,
        season_year: product.year ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        product: product.product ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        set_or_insert: section.set_or_insert ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : undefined,
        players: players.length ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        team: parsed.team ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : undefined,
        card_number: cardNumber ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        checklist_code: checklistCode ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : catalogFieldStatuses.REVIEW_REQUIRED,
        official_card_type: section.official_card_type ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : undefined,
        observable_components: observableComponents.length ? catalogFieldStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE : undefined
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

async function fetchChecklistText(fetchImpl, url) {
  const response = await fetchImpl(url);
  const contentType = response.headers?.get?.("content-type") || "";
  const payload = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`Topps checklist fetch failed ${response.status}: ${payload.toString("utf8").slice(0, 120)}`);
  return extractToppsChecklistText(payload, {
    sourceUrl: url,
    contentType
  });
}

export async function buildToppsBasketballChecklistImport({
  fetchImpl = globalThis.fetch,
  indexUrl = defaultToppsChecklistIndexUrl,
  sourceUrls = []
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const explicitLinks = (Array.isArray(sourceUrls) ? sourceUrls : [])
    .map((source) => typeof source === "string" ? { href: source, text: checklistName("", source) } : source)
    .map((source) => ({
      href: absoluteUrl(source.href || source.source_url || source.url, indexUrl),
      text: checklistName(source.text || source.source_name || source.name, source.href || source.source_url || source.url)
    }))
    .filter((source) => source.href && isAllowedToppsBasketballChecklistLink(source));
  const links = explicitLinks.length
    ? explicitLinks
    : extractToppsBasketballChecklistLinks(await fetchText(fetchImpl, indexUrl), { baseUrl: indexUrl });
  const sources = [];
  const staging = [];

  for (const link of links) {
    const raw = await fetchChecklistText(fetchImpl, link.href);
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
