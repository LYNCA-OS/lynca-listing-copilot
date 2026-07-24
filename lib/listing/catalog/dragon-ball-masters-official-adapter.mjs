export const dragonBallMastersParserRevision = "dragon-ball-masters-post-v1";

const officialHostname = "www.dbs-cardgame.com";
const officialListingPath = "/us-en/cardlist/";
const officialPostPath = "/us-en/cardlist/index.php";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function stripHtml(value = "") {
  return normalizeText(decodeHtmlEntities(String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
}

function classText(block = "", className = "") {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(
    `<([a-z0-9]+)[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i"
  ));
  return match ? stripHtml(match[2]) : "";
}

function definitionValue(block = "", className = "") {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(
    `<dl[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>[\\s\\S]*?<dd[^>]*>([\\s\\S]*?)<\\/dd>`,
    "i"
  ));
  return match ? stripHtml(match[1]) : "";
}

function absoluteOfficialImageUrl(href = "") {
  try {
    const url = new URL(decodeHtmlEntities(href), `https://${officialHostname}${officialListingPath}`);
    return url.protocol === "https:" && url.hostname === officialHostname ? url.href : "";
  } catch {
    return "";
  }
}

function normalizedSeries(value = "") {
  return normalizeText(String(value || "")
    .replace(/^Series\s*/i, "Series ")
    .replace(/[～〜]+/g, " - ")
    .replace(/\s*-\s*-+/g, " - "))
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .trim();
}

function baseCardNumber(value = "") {
  return normalizeText(value).toUpperCase().replace(/_[A-Z0-9]+(?:_[A-Z0-9]+)*$/, "");
}

function rarityCode(value = "") {
  return normalizeText(value.match(/\[([^\]]+)\]\s*$/)?.[1]).toUpperCase();
}

export function dragonBallMastersSourceIdentity(href = "") {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== officialHostname || url.pathname !== officialListingPath || url.hash) return null;
    if (url.searchParams.getAll("search").length !== 1 || url.searchParams.get("search") !== "true") return null;
    if (url.searchParams.getAll("category_exp").length !== 1) return null;
    if ([...url.searchParams.keys()].some((key) => !["search", "category_exp"].includes(key))) return null;
    const categoryId = url.searchParams.get("category_exp") || "";
    if (!/^428\d{3}$/.test(categoryId)) return null;
    return {
      category_id: categoryId,
      source_url: url.href,
      post_url: `https://${officialHostname}${officialPostPath}?search=true`
    };
  } catch {
    return null;
  }
}

export function validateDragonBallMastersResponse(html = "", { categoryId = "" } = {}) {
  const selectedPattern = new RegExp(`<option\\s+value=["']${categoryId}["'][^>]*\\bselected=["']selected["']`, "i");
  if (!selectedPattern.test(String(html))) throw new Error("dragon_ball_masters_category_contract_mismatch");
  const cardCount = (String(html).match(/<dl\b[^>]*class=["'][^"']*\bcardListCol\b/gi) || []).length;
  if (cardCount < 1) throw new Error("dragon_ball_masters_cards_empty");
  if (cardCount > 1000) throw new Error(`dragon_ball_masters_card_count_out_of_bounds:${cardCount}`);
  return { card_count: cardCount };
}

export function parseDragonBallMastersHtml(html = "", { sourceUrl = "" } = {}) {
  const rows = [];
  const blocks = String(html || "").split(/(?=<li>\s*<dl\b[^>]*class=["'][^"']*\bcardListCol\b)/gi).slice(1);
  for (const block of blocks) {
    const rawCardNumber = classText(block, "cardNumber").toUpperCase();
    const cardName = classText(block, "cardName");
    const product = normalizedSeries(definitionValue(block, "seriesCol"));
    if (!rawCardNumber || !cardName || !product) continue;
    const rarity = definitionValue(block, "rarityCol");
    const officialCardType = definitionValue(block, "typeCol").toUpperCase();
    const color = definitionValue(block, "colorCol");
    const notes = definitionValue(block, "notesCol");
    const imagePath = block.match(/<div[^>]+class=["'][^"']*\bcardimg\b[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    const rarityShort = rarityCode(rarity);
    const parallelExact = rawCardNumber.includes("_")
      ? normalizeText([rarity.replace(/\s*\[[^\]]+\]\s*$/, ""), notes].filter(Boolean).join(" "))
      : "";
    rows.push({
      category: "tcg",
      game: "Dragon Ball Super Masters",
      language: "EN",
      manufacturer: "Bandai",
      product,
      set_or_insert: product,
      name: cardName,
      card_name: cardName,
      card_number: baseCardNumber(rawCardNumber),
      checklist_code: rawCardNumber,
      rarity: rarityShort || rarity,
      official_card_type: officialCardType,
      parallel_name: parallelExact,
      parallel_exact: parallelExact,
      observable_components: [color ? `Color:${color}` : "", notes ? `Notes:${notes}` : ""].filter(Boolean),
      image_url: absoluteOfficialImageUrl(imagePath),
      external_id: rawCardNumber,
      source_url: sourceUrl
    });
  }
  return rows;
}
