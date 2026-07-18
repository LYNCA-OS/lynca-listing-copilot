import {
  basketballToppsChecklistAllowlist,
  basketballToppsChecklistExclusions,
  catalogFieldStatuses,
  catalogImportStatuses,
  catalogSourceTypes,
  isOfficialReleaseCatalogSourceType,
  officialChecklistCatalogSourceTypes
} from "./catalog-contract.mjs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export const defaultToppsChecklistIndexUrl = "https://www.topps.com/pages/checklists";
export const defaultOfficialChecklistIndexUrls = Object.freeze({
  topps: "https://www.topps.com/pages/checklists",
  panini: "https://www.paniniamerica.net/checklist.html",
  panini_digital_library: "https://www.paniniamerica.net/digital-library.html",
  upper_deck: "https://www.upperdeckepack.com/Checklists",
  leaf: "https://leaftradingcards.com",
  futera: "https://www.futera.com",
  parkside: "https://www.parksidecards.com",
  onit: "https://onitathlete.com",
  one_piece: "https://en.onepiece-cardgame.com/cardlist/",
  digimon: "https://world.digimoncard.com/cardlist/?search=true",
  dragon_ball_fusion_world: "https://www.dbs-cardgame.com/fw/en/cardlist/",
  dragon_ball_masters: "https://www.dbs-cardgame.com/us-en/cardlist/",
  union_arena: "https://www.unionarena-tcg.com/na/cardlist/",
  battle_spirits: "https://battlespirits-saga.com/cards/",
  pokemon_official: "https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/",
  pokemon_tcg_api: "https://api.pokemontcg.io/v2/cards",
  wotc_gatherer: "https://gatherer.wizards.com/",
  scryfall: "https://api.scryfall.com/cards/search",
  konami_yugioh: "https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=1&request_locale=en",
  ygoprodeck: "https://db.ygoprodeck.com/api/v7/cardinfo.php",
  lorcana_official: "https://www.disneylorcana.com/en-US/cards",
  lorcast: "https://api.lorcast.com/v0/cards",
  star_wars_unlimited: "https://starwarsunlimited.com/cards",
  swu_db: "https://api.swu-db.com/cards/search",
  flesh_and_blood: "https://cardvault.fabtcg.com/",
  weiss_schwarz: "https://en.ws-tcg.com/cardlist/",
  vanguard: "https://en.cf-vanguard.com/cardlist/",
  shadowverse_evolve: "https://en.shadowverse-evolve.com/cards/",
  grand_archive: "https://index.gatcg.com/",
  altered: "https://www.altered.gg/cards"
});

export const officialChecklistParserVersion = "official-checklist-v2-pdf-layout";

function normalizeText(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
}

function stripHtmlPreserveTabs(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .split("\t")
    .map(normalizeText)
    .filter(Boolean)
    .join("\t");
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

export function sourceTypeFromOfficialChecklistProvider(provider = "topps") {
  const normalized = normalizeText(provider).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "panini" || normalized === "panini_america") return catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST;
  if (normalized === "upper_deck" || normalized === "upperdeck") return catalogSourceTypes.UPPER_DECK_OFFICIAL_CHECKLIST;
  if (normalized === "leaf" || normalized === "leaf_trading_cards") return catalogSourceTypes.LEAF_OFFICIAL_RELEASE;
  if (normalized === "futera") return catalogSourceTypes.FUTERA_OFFICIAL_CHECKLIST;
  if (normalized === "parkside") return catalogSourceTypes.PARKSIDE_OFFICIAL_RELEASE;
  if (normalized === "onit") return catalogSourceTypes.ONIT_OFFICIAL_RELEASE;
  if (normalized === "one_piece" || normalized === "bandai_one_piece") return catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST;
  if (normalized === "digimon" || normalized === "bandai_digimon") return catalogSourceTypes.BANDAI_DIGIMON_OFFICIAL_CARDLIST;
  if (normalized === "dragon_ball_fusion_world" || normalized === "dbs_fusion_world" || normalized === "dbfw") return catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE;
  if (normalized === "dragon_ball_masters" || normalized === "dbs_masters" || normalized === "dragon_ball_super_masters") return catalogSourceTypes.BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE;
  if (normalized === "union_arena" || normalized === "bandai_union_arena") return catalogSourceTypes.BANDAI_UNION_ARENA_OFFICIAL_CARDLIST;
  if (normalized === "battle_spirits" || normalized === "battle_spirits_saga" || normalized === "bandai_battle_spirits") return catalogSourceTypes.BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST;
  if (normalized === "pokemon_official") return catalogSourceTypes.POKEMON_OFFICIAL_CARD_SEARCH;
  if (normalized === "pokemon_tcg_api" || normalized === "pokemon") return catalogSourceTypes.POKEMON_TCG_COMMUNITY_API;
  if (normalized === "wotc_gatherer" || normalized === "gatherer" || normalized === "wotc") return catalogSourceTypes.WOTC_GATHERER_OFFICIAL_DATABASE;
  if (normalized === "scryfall" || normalized === "mtg" || normalized === "magic") return catalogSourceTypes.SCRYFALL_COMMUNITY_API;
  if (normalized === "konami_yugioh" || normalized === "konami") return catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE;
  if (normalized === "ygoprodeck" || normalized === "yugioh") return catalogSourceTypes.YGOPRODECK_COMMUNITY_API;
  if (normalized === "lorcana_official" || normalized === "lorcana") return catalogSourceTypes.LORCANA_OFFICIAL_CARD_DATABASE;
  if (normalized === "lorcast" || normalized === "lorcana_community" || normalized === "lorcana_api") return catalogSourceTypes.LORCANA_COMMUNITY_API;
  if (normalized === "star_wars_unlimited" || normalized === "swu") return catalogSourceTypes.STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST;
  if (normalized === "swu_db" || normalized === "swudb" || normalized === "star_wars_unlimited_community") return catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK;
  if (normalized === "flesh_and_blood" || normalized === "fab" || normalized === "fabtcg") return catalogSourceTypes.FAB_OFFICIAL_CARD_DATABASE;
  if (normalized === "weiss_schwarz" || normalized === "ws_tcg" || normalized === "bushiroad_weiss_schwarz") return catalogSourceTypes.BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST;
  if (normalized === "vanguard" || normalized === "cardfight_vanguard" || normalized === "bushiroad_vanguard") return catalogSourceTypes.BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST;
  if (normalized === "shadowverse_evolve" || normalized === "shadowverse" || normalized === "bushiroad_shadowverse") return catalogSourceTypes.BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST;
  if (normalized === "grand_archive" || normalized === "gatcg") return catalogSourceTypes.GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE;
  if (normalized === "altered") return catalogSourceTypes.ALTERED_OFFICIAL_CARD_DATABASE;
  return catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST;
}

function providerFromSourceType(sourceType = "") {
  const normalized = normalizeText(sourceType).toUpperCase();
  if (normalized === catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST) return "Panini";
  if (normalized === catalogSourceTypes.UPPER_DECK_OFFICIAL_CHECKLIST) return "Upper Deck";
  if (normalized === catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST || normalized === catalogSourceTypes.LEAF_OFFICIAL_RELEASE) return "Leaf";
  if (normalized === catalogSourceTypes.FUTERA_OFFICIAL_CHECKLIST) return "Futera";
  if (normalized === catalogSourceTypes.PARKSIDE_OFFICIAL_RELEASE) return "Parkside";
  if (normalized === catalogSourceTypes.ONIT_OFFICIAL_RELEASE) return "ONIT";
  if (normalized.startsWith("BANDAI_")) return "Bandai";
  if (normalized.startsWith("POKEMON_")) return "Pokemon";
  if (normalized === catalogSourceTypes.WOTC_GATHERER_OFFICIAL_DATABASE) return "Wizards of the Coast";
  if (normalized === catalogSourceTypes.SCRYFALL_COMMUNITY_API) return "Scryfall";
  if (normalized === catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE) return "Konami";
  if (normalized === catalogSourceTypes.YGOPRODECK_COMMUNITY_API) return "YGOPRODeck";
  if (normalized.startsWith("LORCANA_")) return "Disney Lorcana";
  if (normalized === catalogSourceTypes.STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST) return "Fantasy Flight Games";
  if (normalized === catalogSourceTypes.FAB_OFFICIAL_CARD_DATABASE) return "Legend Story Studios";
  if (normalized.startsWith("BUSHIROAD_")) return "Bushiroad";
  if (normalized === catalogSourceTypes.GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE) return "Weebs of the Shore";
  if (normalized === catalogSourceTypes.ALTERED_OFFICIAL_CARD_DATABASE) return "Equinox";
  return "Topps";
}

function inferCategoryFromName(name = "") {
  const text = normalizeText(name);
  if (/\b(?:basketball|nba|wnba|nbl|g[-\s]?league)\b/i.test(text)) return "basketball";
  if (/\b(?:baseball|mlb|bowman chrome|bowman draft|bowman sterling)\b/i.test(text)) return "baseball";
  if (/\b(?:football|nfl|college football)\b/i.test(text)) return "football";
  if (/\b(?:soccer|uefa|ucl|ucc|mls|bundesliga|champions league|euro)\b/i.test(text)) return "soccer";
  if (/\b(?:hockey|nhl)\b/i.test(text)) return "hockey";
  if (/\b(?:ufc|mma)\b/i.test(text)) return "ufc";
  if (/\b(?:wwe|wrestling)\b/i.test(text)) return "wrestling";
  if (/\b(?:formula\s*1|f1|racing|nascar)\b/i.test(text)) return "racing";
  if (/\b(?:star wars|marvel|disney|garbage pail kids|non[-\s]?sports?|entertainment|celebrity)\b/i.test(text)) return "entertainment";
  if (/\b(?:pokemon|pokémon|one piece|yugioh|yu-gi-oh|dragonball|dragon ball|tcg)\b/i.test(text)) return "tcg";
  return "other";
}

function manufacturerFromProvider(provider = "topps") {
  const normalized = normalizeText(provider).toLowerCase();
  if (normalized.includes("panini")) return "Panini";
  if (normalized.includes("upper")) return "Upper Deck";
  if (normalized.includes("leaf")) return "Leaf";
  if (normalized.includes("futera")) return "Futera";
  if (normalized.includes("parkside")) return "Parkside";
  if (normalized.includes("onit")) return "ONIT";
  if (normalized.includes("bandai")) return "Bandai";
  if (normalized.includes("pokemon")) return "Pokemon";
  if (normalized.includes("wotc") || normalized.includes("gatherer")) return "Wizards of the Coast";
  if (normalized.includes("konami")) return "Konami";
  if (normalized.includes("ygoprodeck")) return "YGOPRODeck";
  if (normalized.includes("lorcana")) return "Disney Lorcana";
  if (normalized.includes("star_wars") || normalized.includes("swu")) return "Fantasy Flight Games";
  if (normalized.includes("flesh") || normalized.includes("fab")) return "Legend Story Studios";
  if (normalized.includes("weiss") || normalized.includes("vanguard") || normalized.includes("shadowverse")) return "Bushiroad";
  if (normalized.includes("grand_archive") || normalized.includes("gatcg")) return "Weebs of the Shore";
  if (normalized.includes("altered")) return "Equinox";
  return "Topps";
}

function sha256(value = "") {
  return createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value || "")).digest("hex");
}

export function isAllowedToppsOfficialChecklistLink({ text = "", href = "" } = {}) {
  const name = checklistName(text, href);
  if (!name) return false;
  if (!/\bchecklist\b/i.test(name) && !/\bchecklist\b/i.test(href)) return false;
  if (!/\.(?:xlsx|xls|csv|txt|pdf)(?:[?#].*)?$/i.test(href) && !/cdn\.shopify\.com/i.test(href)) return false;
  return !/\b(?:poster|sell sheet|odds|wrapper|rules|release calendar)\b/i.test(name);
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

export function extractOfficialChecklistLinks(html = "", {
  baseUrl = defaultToppsChecklistIndexUrl,
  provider = "topps",
  category = "",
  linkFilter = null
} = {}) {
  const links = [];
  const seen = new Set();
  const sourceType = sourceTypeFromOfficialChecklistProvider(provider);
  const categoryFilter = normalizeText(category).toLowerCase();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(anchorPattern)) {
    const href = absoluteUrl(match[1], baseUrl);
    const text = checklistName(stripHtml(match[2]), href);
    if (!href) continue;
    const descriptor = {
      href,
      text,
      provider,
      source_type: sourceType,
      category: inferCategoryFromName(`${text} ${href}`)
    };
    const allowed = typeof linkFilter === "function"
      ? linkFilter(descriptor)
      : provider === "topps"
        ? isAllowedToppsOfficialChecklistLink(descriptor)
        : /\bchecklist\b/i.test(`${text} ${href}`);
    if (!allowed) continue;
    if (categoryFilter && categoryFilter !== "all" && descriptor.category !== categoryFilter) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push(descriptor);
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
  const tabCells = String(line || "").split("\t").map(normalizeText).filter(Boolean);
  if (tabCells.length >= 2) {
    const cardIndex = tabCells.findIndex((cell) => /^(?:#\s*)?(?:\d{1,4}|[A-Z0-9]{1,8}-[A-Z0-9]{1,16}|[A-Z]{1,8}[0-9][A-Z0-9]{0,8})$/i.test(cell));
    const nameIndex = tabCells.findIndex((cell, index) => {
      if (index === cardIndex) return false;
      return /\p{L}/u.test(cell) && !/\b(?:checklist|parallel|cards?|team|card\s*#|number|no\.)\b/i.test(cell);
    });
    if (cardIndex >= 0 && nameIndex >= 0) {
      const namePart = normalizeText(tabCells[nameIndex].replace(/\bRC\b/gi, " "));
      const players = namePart.split(/\s+(?:\/|&|and)\s+/i)
        .map(normalizeText)
        .filter((value) => /\p{L}/u.test(value));
      const team = tabCells.slice(nameIndex + 1).find((cell) => /\p{L}/u.test(cell) && !/^\d+$/.test(cell)) || null;
      if (players.length) {
        const cardNumber = tabCells[cardIndex].replace(/^#\s*/, "").toUpperCase();
        return {
          card_number: cardNumber,
          checklist_code: /[A-Z]/i.test(cardNumber) || cardNumber.includes("-") ? cardNumber : null,
          players: [...new Set(players)],
          team,
          observable_components: /\bRC\b/i.test(tabCells.join(" ")) ? ["rc"] : []
        };
      }
    }
  }

  const text = normalizeText(String(line || "").replace(/[□■☐☑]/g, " "));
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
  const isRelic = /\b(?:Relic|Patch|Memorabilia|Jersey)\b/i.test(text);
  const isCombo = /\bCombo\b/i.test(text);
  const isParallel = /\b(?:Parallel|Refractor|Prizm|Wave|Shimmer|Mojo|Sapphire|Atomic|Gold|Purple|Red|Blue|Green|Orange|Black|Silver)\b/i.test(text);
  const serialDenominator = text.match(/\/\s*(\d{1,4})\b/i)?.[1]
    || text.match(/\b(?:numbered|limited)\s+(?:to|\/)?\s*(\d{1,4})\b/i)?.[1]
    || null;
  const parallelExact = isParallel && !isBase && !isAuto && !isRelic ? text : null;
  return {
    set_or_insert: isBase ? null : text || null,
    set_type: isBase ? "base" : isAuto ? "autograph_set" : isRelic ? "relic_set" : isParallel ? "parallel_group" : text ? "insert" : "unknown",
    official_card_type: isBase ? "Base" : isAuto ? "Autograph" : isRelic ? "Relic" : isCombo ? "Combo" : null,
    observable_components: [
      isAuto ? "auto" : "",
      /\bPatch\b/i.test(text) ? "patch" : "",
      isRelic ? "relic" : ""
    ].filter(Boolean),
    parallel_name: parallelExact,
    parallel_exact: parallelExact,
    serial_denominator: serialDenominator
  };
}

function isSectionHeading(line = "") {
  const text = normalizeText(line);
  if (!text || /^\d+\s+cards?$/i.test(text)) return false;
  if (parseCardLine(text)) return false;
  if (/^#?\s*(?:\d{1,4}|[A-Z0-9]{1,8}-[A-Z0-9]{1,16}|[A-Z]{1,8}[0-9][A-Z0-9]{0,8})\s+/i.test(text)) return false;
  if (/^parallels?$/i.test(text)) return false;
  if (/^player number \(select cards/i.test(text)) return false;
  if (/^(?:Blackout|Clear|Golden Mirror|Team Color Border|First Card\s*\/\s*1)$/i.test(text)) return false;
  if (/\b(?:Checklist|Autographs?|Variation|Insert|Refractors?|Selections|Stars|Real Ones|Throwback|Combo)\b/i.test(text)) return true;
  if (/^[A-Z][A-Z '&/.-]{2,60}$/.test(text)
    && !/^(?:CARD\s*#|CARD NUMBER|PLAYER|SUBJECT|NAME|TEAM|ROOKIE|VETERAN|PARALLELS?|NOTES?)$/i.test(text)) return true;
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

function htmlToChecklistText(value = "") {
  return String(value || "")
    .replace(/<\/(?:tr|li|p|h[1-6])>/gi, "\n")
    .replace(/<\/t[dh]>\s*<t[dh]\b/gi, "\t<td")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\r?\n/)
    .map(stripHtmlPreserveTabs)
    .filter(Boolean)
    .join("\n");
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
  const text = buffer.toString("utf8");
  if (type.includes("html") || /<html|<table|<tr|<li/i.test(text)) return htmlToChecklistText(text);
  return text;
}

function checklistPayloadType(payload, { sourceUrl = "", contentType = "" } = {}) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const type = normalizeText(contentType).toLowerCase();
  let pathname = "";
  try {
    pathname = new URL(sourceUrl).pathname.toLowerCase();
  } catch {
    pathname = String(sourceUrl || "").split("?")[0].toLowerCase();
  }
  const magic = buffer.subarray(0, 5).toString("ascii");
  const zipMagic = buffer.subarray(0, 4).toString("hex") === "504b0304";
  if (magic === "%PDF-") return "pdf";
  if (zipMagic) return "xlsx";
  if (type.includes("application/pdf")) return "pdf";
  if (type.includes("spreadsheet")) return "xlsx";
  if (pathname.endsWith(".pdf")) return "pdf";
  if (pathname.endsWith(".xlsx")) return "xlsx";
  const preview = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
  if (type.includes("html") || /<html|<table|<tr|<li/i.test(preview)) return "html";
  return "plain_text";
}

export async function extractOfficialChecklistPayload(payload, options = {}) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const extractionMethod = checklistPayloadType(buffer, options);
  let text = "";
  let pageCount = null;
  if (extractionMethod === "pdf") {
    if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("official_pdf_magic_invalid");
    }
    if (typeof options.pdfExtractor !== "function") {
      throw new Error("official_pdf_extractor_unavailable");
    }
    const extracted = await options.pdfExtractor(buffer);
    text = extracted.text;
    pageCount = extracted.page_count;
  } else {
    text = extractToppsChecklistText(buffer, options);
  }
  if (!normalizeText(text)) throw new Error(`official_${extractionMethod}_text_extraction_empty`);
  return {
    text,
    extraction_method: extractionMethod === "pdf" ? "pdfjs" : extractionMethod,
    page_count: pageCount,
    raw_bytes: buffer.length,
    text_length: text.length,
    payload_checksum: sha256(buffer)
  };
}

function parseProductFromName(name = "", {
  provider = "topps",
  manufacturer = "",
  category = ""
} = {}) {
  const text = normalizeText(name);
  const year = text.match(/\b(20\d{2}(?:-\d{2})?)\b/)?.[1] || null;
  const resolvedManufacturer = manufacturer || manufacturerFromProvider(provider);
  const product = text
    .replace(/\b(20\d{2}(?:-\d{2})?)\b/g, " ")
    .replace(/\bChecklist\b/gi, " ")
    .replace(new RegExp(`\\b${resolvedManufacturer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), resolvedManufacturer)
    .replace(/\s+/g, " ")
    .trim();
  return {
    year,
    category: category || inferCategoryFromName(text),
    manufacturer: resolvedManufacturer,
    brand: product.match(/\bBowman\b/i) ? "Bowman" : resolvedManufacturer,
    product: product || `${resolvedManufacturer} Checklist`
  };
}

export function parseOfficialChecklistText(rawText = "", {
  sourceName = "",
  sourceUrl = "",
  provider = "topps",
  sourceType = "",
  manufacturer = "",
  category = ""
} = {}) {
  const resolvedSourceType = sourceType || sourceTypeFromOfficialChecklistProvider(provider);
  const product = parseProductFromName(sourceName || sourceUrl, {
    provider: providerFromSourceType(resolvedSourceType),
    manufacturer,
    category
  });
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map(stripHtmlPreserveTabs)
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
    const serialDenominator = section.serial_denominator || line.match(/\/\s*(\d{1,4})\b/)?.[1] || null;
    const players = parsed.players;
    const reviewRequired = !players.length || (!checklistCode && !cardNumber);
    rows.push({
      import_status: reviewRequired
        ? catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED
        : catalogImportStatuses.OFFICIAL_CHECKLIST_CANDIDATE,
      source_row_key: `${sourceUrl || sourceName || "topps"}:${index + 1}`,
      canonical_title: normalizeText([product.year, product.product, players.join(" / "), cardNumber ? `#${cardNumber}` : checklistCode].filter(Boolean).join(" ")),
      identity_fields: {
        sport: product.category,
        category: product.category,
        league: /NBA/i.test(line) ? "NBA" : null,
        season_year: product.year,
        manufacturer: product.manufacturer,
        brand: product.brand,
        product: product.product,
        set_or_insert: section.set_or_insert,
        set_type: section.set_type,
        players,
        team: parsed.team,
        card_number: cardNumber,
        checklist_code: checklistCode,
        official_card_type: section.official_card_type,
        parallel_name: section.parallel_name,
        parallel_exact: section.parallel_exact,
        serial_denominator: serialDenominator,
        observable_components: observableComponents
      },
      physical_instance_fields: {},
      field_statuses: {
        sport: catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST,
        season_year: product.year ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
        product: product.product ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
        set_or_insert: section.set_or_insert ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : undefined,
        set_type: section.set_type ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : undefined,
        players: players.length ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
        team: parsed.team ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : undefined,
        card_number: cardNumber ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
        checklist_code: checklistCode ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
        official_card_type: section.official_card_type ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : undefined,
        parallel_exact: section.parallel_exact ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : undefined,
        serial_denominator: serialDenominator ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : undefined,
        observable_components: observableComponents.length ? catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST : undefined
      },
      parse_confidence: reviewRequired ? 0.4 : 0.68,
      review_notes: reviewRequired ? "Official checklist row is ambiguous and requires review" : null
    });
  });
  const uniqueRows = new Map();
  for (const row of rows) {
    const fields = row.identity_fields || {};
    const identityKey = JSON.stringify([
      fields.season_year || "",
      fields.product || "",
      fields.set_or_insert || "",
      fields.official_card_type || "",
      fields.parallel_exact || fields.parallel_name || "",
      fields.card_number || "",
      fields.checklist_code || "",
      [...(fields.players || [])].sort(),
      fields.team || "",
      fields.serial_denominator || "",
      [...(fields.observable_components || [])].sort()
    ]);
    if (!uniqueRows.has(identityKey)) uniqueRows.set(identityKey, row);
  }
  return [...uniqueRows.values()];
}

export function parseOfficialReleaseMetadata(rawText = "", {
  sourceName = "",
  sourceUrl = "",
  provider = "leaf",
  sourceType = catalogSourceTypes.LEAF_OFFICIAL_RELEASE,
  manufacturer = "",
  category = ""
} = {}) {
  const product = parseProductFromName(sourceName || sourceUrl || rawText.slice(0, 120), {
    provider,
    manufacturer,
    category
  });
  const text = normalizeText(rawText);
  return [{
    import_status: catalogImportStatuses.OFFICIAL_RELEASE_SUPPORT,
    source_row_key: `${sourceUrl || sourceName || provider}:release-metadata`,
    canonical_title: normalizeText([product.year, product.product].filter(Boolean).join(" ")),
    identity_fields: {
      sport: product.category,
      category: product.category,
      season_year: product.year,
      manufacturer: product.manufacturer,
      brand: product.brand,
      product: product.product,
      set_type: "product_metadata",
      observable_components: [
        /\bauto(?:graph)?\b/i.test(text) ? "auto" : "",
        /\bpatch\b/i.test(text) ? "patch" : "",
        /\b(?:relic|memorabilia|jersey)\b/i.test(text) ? "relic" : ""
      ].filter(Boolean)
    },
    physical_instance_fields: {},
    field_statuses: {
      sport: catalogFieldStatuses.OFFICIAL_RELEASE_METADATA,
      season_year: product.year ? catalogFieldStatuses.OFFICIAL_RELEASE_METADATA : catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
      manufacturer: catalogFieldStatuses.OFFICIAL_RELEASE_METADATA,
      product: product.product ? catalogFieldStatuses.OFFICIAL_RELEASE_METADATA : catalogFieldStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED,
      observable_components: catalogFieldStatuses.OFFICIAL_RELEASE_METADATA
    },
    parse_confidence: product.product ? 0.52 : 0.25,
    review_notes: "Official release metadata is not a full card-level checklist."
  }];
}

export function parseToppsBasketballChecklistText(rawText = "", options = {}) {
  return parseOfficialChecklistText(rawText, {
    ...options,
    provider: "topps",
    sourceType: catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST,
    category: "basketball"
  });
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`Topps checklist fetch failed ${response.status}: ${text.slice(0, 120)}`);
  return text;
}

async function fetchChecklistText(fetchImpl, url, { pdfExtractor } = {}) {
  const response = await fetchImpl(url);
  const contentType = response.headers?.get?.("content-type") || "";
  const payload = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`Topps checklist fetch failed ${response.status}: ${payload.toString("utf8").slice(0, 120)}`);
  return extractOfficialChecklistPayload(payload, {
    sourceUrl: url,
    contentType,
    pdfExtractor
  });
}

export async function buildToppsBasketballChecklistImport({
  fetchImpl = globalThis.fetch,
  indexUrl = defaultToppsChecklistIndexUrl,
  sourceUrls = [],
  pdfExtractor
} = {}) {
  return buildOfficialChecklistImport({
    fetchImpl,
    indexUrl,
    sourceUrls,
    provider: "topps",
    sourceType: catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST,
    category: "basketball",
    linkFilter: isAllowedToppsBasketballChecklistLink,
    pdfExtractor
  });
}

export async function buildOfficialChecklistImport({
  fetchImpl = globalThis.fetch,
  indexUrl = defaultToppsChecklistIndexUrl,
  sourceUrls = [],
  provider = "topps",
  sourceType = "",
  category = "",
  manufacturer = "",
  linkFilter = null,
  pdfExtractor
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const resolvedSourceType = sourceType || sourceTypeFromOfficialChecklistProvider(provider);
  if (!officialChecklistCatalogSourceTypes.includes(resolvedSourceType) && !isOfficialReleaseCatalogSourceType(resolvedSourceType)) {
    throw new Error(`unsupported_official_checklist_source_type:${resolvedSourceType}`);
  }
  const explicitLinks = (Array.isArray(sourceUrls) ? sourceUrls : [])
    .map((source) => typeof source === "string" ? { href: source, text: checklistName("", source) } : source)
    .map((source) => ({
      href: absoluteUrl(source.href || source.source_url || source.url, indexUrl),
      text: checklistName(source.text || source.source_name || source.name, source.href || source.source_url || source.url),
      category: source.category || category,
      provider: source.provider || provider,
      source_type: source.source_type || resolvedSourceType
    }))
    .filter((source) => source.href && (
      typeof linkFilter === "function"
        ? linkFilter(source)
        : provider === "topps"
          ? isAllowedToppsOfficialChecklistLink(source)
          : true
    ));
  const links = explicitLinks.length
    ? explicitLinks
    : extractOfficialChecklistLinks(await fetchText(fetchImpl, indexUrl), {
      baseUrl: indexUrl,
      provider,
      category,
      linkFilter
    });
  const sources = [];
  const staging = [];

  for (const link of links) {
    const extracted = await fetchChecklistText(fetchImpl, link.href, { pdfExtractor });
    const raw = extracted.text;
    const source = {
      source_type: link.source_type || resolvedSourceType,
      source_status: isOfficialReleaseCatalogSourceType(link.source_type || resolvedSourceType)
        ? catalogImportStatuses.OFFICIAL_RELEASE_METADATA
        : "OFFICIAL_CHECKLIST_RAW",
      source_name: link.text,
      source_url: link.href,
      source_trust: isOfficialReleaseCatalogSourceType(link.source_type || resolvedSourceType) ? "OFFICIAL_RELEASE_SUPPORT" : "OFFICIAL_CHECKLIST_CANDIDATE",
      parser_version: officialChecklistParserVersion,
      raw_checksum: extracted.payload_checksum,
      source_metadata: {
        provider,
        category: link.category || category || inferCategoryFromName(`${link.text} ${link.href}`),
        index_url: indexUrl,
        extraction_method: extracted.extraction_method,
        extraction_page_count: extracted.page_count,
        raw_bytes: extracted.raw_bytes,
        extracted_text_length: extracted.text_length,
        corrected_title_used: false,
        third_party_used: false
      },
      raw_text: raw
    };
    const metadata = {
      sourceName: link.text,
      sourceUrl: link.href,
      provider,
      sourceType: source.source_type,
      manufacturer,
      category: link.category || category || inferCategoryFromName(`${link.text} ${link.href}`)
    };
    const rows = isOfficialReleaseCatalogSourceType(source.source_type)
      ? parseOfficialReleaseMetadata(raw, metadata)
      : parseOfficialChecklistText(raw, metadata);
    sources.push(source);
    rows.forEach((row) => staging.push({ source, staging: row }));
  }
  const products = new Set();
  const sets = new Set();
  const parallels = new Set();
  const confidenceBuckets = { high: 0, medium: 0, low: 0 };
  staging.forEach(({ staging: row }) => {
    const fields = row.identity_fields || {};
    if (fields.product) products.add([fields.sport, fields.season_year, fields.manufacturer, fields.product].join("\u001f"));
    if (fields.set_or_insert || fields.official_card_type) sets.add([fields.product, fields.set_or_insert, fields.official_card_type].join("\u001f"));
    if (fields.parallel_exact || fields.parallel_name || fields.serial_denominator) parallels.add([fields.product, fields.parallel_exact || fields.parallel_name || "", fields.serial_denominator || ""].join("\u001f"));
    if (Number(row.parse_confidence || 0) >= 0.75) confidenceBuckets.high += 1;
    else if (Number(row.parse_confidence || 0) >= 0.5) confidenceBuckets.medium += 1;
    else confidenceBuckets.low += 1;
  });

  return {
    sources,
    staging,
    metrics: {
      official_source_type: resolvedSourceType,
      official_provider: provider,
      source_count: sources.length,
      file_count: sources.length,
      raw_text_extract_success_count: sources.filter((source) => normalizeText(source.raw_text)).length,
      raw_text_extract_error_count: sources.filter((source) => !normalizeText(source.raw_text)).length,
      extraction_method_counts: sources.reduce((counts, source) => {
        const method = source.source_metadata?.extraction_method || "unknown";
        counts[method] = Number(counts[method] || 0) + 1;
        return counts;
      }, {}),
      extracted_page_count: sources.reduce((total, source) => total + Number(source.source_metadata?.extraction_page_count || 0), 0),
      parsed_row_count: staging.length,
      product_count: products.size,
      set_count: sets.size,
      card_count: staging.filter((row) => !isOfficialReleaseCatalogSourceType(row.source.source_type)).length,
      parallel_count: parallels.size,
      review_required_count: staging.filter((row) => [
        catalogImportStatuses.REVIEW_REQUIRED,
        catalogImportStatuses.OFFICIAL_PARSE_REVIEW_REQUIRED
      ].includes(row.staging.import_status)).length,
      parse_confidence_distribution: confidenceBuckets,
      skipped_non_scope_count: 0,
      duplicate_count: links.length - new Set(links.map((link) => link.href)).size,
      promotion_candidate_count: staging.filter((row) => row.staging.import_status === catalogImportStatuses.OFFICIAL_CHECKLIST_CANDIDATE).length,
      official_link_count: links.length,
      official_file_download_count: sources.length,
      topps_basketball_link_count: category === "basketball" && resolvedSourceType === catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST ? links.length : 0,
      topps_file_download_count: resolvedSourceType === catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST ? sources.length : 0,
      catalog_card_count: staging.length,
      official_release_support_count: staging.filter((row) => row.staging.import_status === catalogImportStatuses.OFFICIAL_RELEASE_SUPPORT).length
    }
  };
}
