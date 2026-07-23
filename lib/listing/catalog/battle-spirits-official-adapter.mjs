export const battleSpiritsParserRevision = "battle-spirits-detail-v1";

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
  return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
}

function absoluteUrl(href = "", baseUrl = "") {
  const candidate = decodeHtmlEntities(String(href || "").trim());
  if (!candidate || candidate.length > 2048 || /[<>\\\u0000-\u001f\u007f]/.test(candidate)) return "";
  try {
    const parsed = new URL(candidate, baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function htmlClassText(block = "", className = "") {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(`<([a-z0-9]+)[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"));
  return match ? stripHtml(match[2]) : "";
}

function htmlHeadingValue(block = "", label = "") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(
    `<h3[^>]*>\\s*${escaped}\\s*<\\/h3>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`,
    "i"
  ));
  return match ? normalizeText(decodeHtmlEntities(stripHtml(match[1]))) : "";
}

export function battleSpiritsDetailUrls(html = "", sourceUrl = "") {
  const urls = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(sourceUrl);
  } catch {
    return urls;
  }
  for (const match of String(html).matchAll(/\bdata-src=["']([^"']*detail\.php\?card_no=[A-Z0-9-]+)["']/gi)) {
    const href = absoluteUrl(match[1], sourceUrl);
    if (!href || seen.has(href)) continue;
    const parsed = new URL(href);
    if (parsed.origin !== base.origin
      || parsed.pathname !== "/cards/detail.php"
      || !/^[A-Z0-9]{3,10}-\d{3}$/.test(normalizeText(parsed.searchParams.get("card_no")).toUpperCase())) continue;
    seen.add(href);
    urls.push(href);
  }
  return urls;
}

export function parseBattleSpiritsDetailBundle(rawText = "", { sourceUrl = "" } = {}) {
  let bundle;
  try {
    bundle = JSON.parse(String(rawText || ""));
  } catch {
    return [];
  }
  if (bundle?.schema_version !== "battle-spirits-detail-bundle-v1" || !Array.isArray(bundle.detail_pages)) return [];
  const rows = [];
  const seenCardNumbers = new Set();
  for (const [index, detail] of bundle.detail_pages.entries()) {
    const html = String(detail?.html || "");
    const block = html.match(/<dl\b[^>]*class=["'][^"']*\bmodalInfoCol\b[^"']*["'][^>]*>([\s\S]*?)<\/dl>/i)?.[1] || "";
    const info = block.match(/class=["'][^"']*\binfoCol\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    const spans = [...info.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((entry) => stripHtml(entry[1]));
    const cardNumber = normalizeText(spans[0]).toUpperCase();
    const rarity = normalizeText(spans[1]).toUpperCase();
    const cardName = htmlClassText(block, "cardName");
    const product = normalizeText(decodeHtmlEntities(stripHtml(
      block.match(/class=["'][^"']*\bdataProductsInner\b[^"']*["'][^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""
    )));
    const officialCardType = htmlHeadingValue(block, "Card Type");
    const color = htmlHeadingValue(block, "Color");
    const traits = htmlHeadingValue(block, "Type");
    const imagePath = block.match(/<img\b[^>]+src=["']([^"']*\/images\/cards\/card\/[^"']+)["']/i)?.[1] || "";
    const imageUrl = absoluteUrl(imagePath, detail?.href || sourceUrl);
    let detailCardNumber = "";
    try {
      detailCardNumber = normalizeText(new URL(detail?.href).searchParams.get("card_no")).toUpperCase();
    } catch {
      detailCardNumber = "";
    }
    if (!cardNumber || !cardName || !product || !officialCardType || !rarity || !imageUrl) {
      throw new Error(`battle_spirits_detail_contract_incomplete:${detailCardNumber || index + 1}`);
    }
    if (detailCardNumber !== cardNumber) throw new Error(`battle_spirits_detail_identity_mismatch:${detailCardNumber}:${cardNumber}`);
    if (seenCardNumbers.has(cardNumber)) throw new Error(`battle_spirits_duplicate_card_number:${cardNumber}`);
    seenCardNumbers.add(cardNumber);
    rows.push({
      category: "tcg",
      game: "Battle Spirits Saga",
      language: "EN",
      manufacturer: "Bandai",
      product,
      set_or_insert: product,
      name: cardName,
      card_name: cardName,
      card_number: cardNumber,
      checklist_code: cardNumber,
      rarity,
      official_card_type: officialCardType,
      observable_components: [color && color !== "-" ? `Color:${color}` : "", traits && traits !== "-" ? `Type:${traits}` : ""].filter(Boolean),
      image_url: imageUrl,
      image_urls: [imageUrl],
      external_id: cardNumber
    });
  }
  return rows;
}
