function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sameText(left, right) {
  return cleanText(left).localeCompare(cleanText(right), undefined, { sensitivity: "base" }) === 0;
}

function playerValues(fields = {}) {
  return [
    ...(Array.isArray(fields.players) ? fields.players : []),
    fields.player,
    fields.subject,
    fields.character
  ].map(cleanText).filter(Boolean);
}

// Facts live outside strategy and transport code. Each overlay must be backed
// by an independent directory source and may contain release/card identity
// only; physical-instance fields (serial numerator, grade, cert, condition)
// are forbidden here.
export const trustedDirectoryFactSources = Object.freeze({
  TOPPS_2026_BOWMAN_MEGA: Object.freeze({
    source_type: "TOPPS_OFFICIAL_PRODUCT",
    source_url: "https://www.topps.com/products/2026-bowman-baseball-mega-box",
    supports: Object.freeze(["brand", "product", "release_finish"])
  }),
  BOWMAN_MEGA_2026_CHECKLIST_DIRECTORY: Object.freeze({
    source_type: "EXTERNAL_CHECKLIST_DIRECTORY",
    source_url: "https://www.beckett.com/news/2026-bowman-mega-box-baseball-cards/",
    supports: Object.freeze(["insert", "subject", "collector_number", "rc"])
  })
});

export function trustedDirectoryOverlay(fields = {}) {
  const megaFuturesObserved = [fields.product, fields.set, fields.insert, fields.card_name]
    .some((value) => sameText(value, "Mega Futures"));
  if (!megaFuturesObserved) return {};

  const overlay = {
    manufacturer: cleanText(fields.manufacturer) || "Topps",
    brand: "Bowman",
    product: "Bowman Mega Box",
    insert: "Mega Futures",
    parallel_exact: cleanText(fields.parallel_exact) || "Mega Chrome"
  };

  if (sameText(fields.set, "Mega Futures")) overlay.set = null;

  const romanAnthony2026 = sameText(fields.year, "2026")
    && playerValues(fields).some((value) => sameText(value, "Roman Anthony"));
  if (romanAnthony2026) {
    overlay.collector_number = "MF-21";
    overlay.rc = true;
  }

  return overlay;
}
