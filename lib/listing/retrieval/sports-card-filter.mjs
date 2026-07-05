export const sportsCardFilterVersion = "sports_card_filter_v1";

const explicitNonSportsPatterns = Object.freeze([
  ["pokemon", /\bpok[eé]mon\b/i],
  ["yu_gi_oh", /\b(?:yu[\s-]*gi[\s-]*oh|yugioh)\b/i],
  ["one_piece", /\bone\s+piece\b/i],
  ["magic_mtg", /\b(?:magic\s+the\s+gathering|mtg)\b/i],
  ["lorcana", /\blorcana\b/i],
  ["marvel", /\bmarvel\b/i],
  ["dc_comics", /\bdc\s+(?:comics|universe|heroes)\b/i],
  ["disney", /\bdisney\b/i],
  ["star_wars", /\bstar\s+wars\b/i],
  ["dragon_ball", /\bdragon\s+ball\b/i],
  ["weiss_schwarz", /\bweiss\s+schwarz\b/i],
  ["digimon", /\bdigimon\b/i],
  ["flesh_and_blood", /\bflesh\s+and\s+blood\b/i],
  ["anime", /\banime\b/i],
  ["tcg_ccg", /\b(?:tcg|ccg)\b/i],
  ["non_sports", /\bnon[\s-]?sports?\b/i]
]);

const nonSingleCardPatterns = Object.freeze([
  ["factory_sealed", /\bfactory\s+sealed\b/i],
  ["sealed_box_or_case", /\bsealed\s+(?:hobby\s+)?(?:box|case|pack|packs)\b/i],
  ["hobby_box", /\bhobby\s+box(?:es)?\b/i],
  ["sealed_case", /\b(?:box|hobby)\s+case\b/i],
  ["retail_box", /\b(?:blaster|mega|retail|hanger|collector|booster)\s+box(?:es)?\b/i],
  ["numbered_lot", /^\s*\(?\d+\)?\s*lot\b/i],
  ["lot_of_cards", /\blot\s+of\b/i],
  ["card_lot", /\bcard\s+lot\b/i]
]);

const sportsSignalPatterns = Object.freeze([
  ["basketball", /\b(?:basketball|nba|wnba)\b/i],
  ["football", /\b(?:football|nfl)\b/i],
  ["baseball", /\b(?:baseball|mlb)\b/i],
  ["soccer", /\b(?:soccer|fifa|uefa|premier\s+league|la\s+liga|serie\s+a)\b/i],
  ["hockey", /\b(?:hockey|nhl)\b/i],
  ["combat", /\b(?:ufc|mma|boxing|wwe|wrestling)\b/i],
  ["racing", /\b(?:formula\s+1|f1|nascar|racing)\b/i],
  ["golf_tennis", /\b(?:golf|tennis)\b/i],
  ["sports_product", /\b(?:panini|topps|bowman|donruss|prizm|optic|select|mosaic|national\s+treasures|flawless|immaculate|contenders|chronicles|chrome|finest|stadium\s+club|score|upper\s+deck)\b/i],
  ["sports_card_terms", /\b(?:rookie|rc|auto|autograph|patch|jersey|relic|parallel|refractor|prizm|psa|bgs|sgc)\b/i]
]);

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function listingSearchText(listing = {}) {
  return [
    listing.title,
    listing.category,
    listing.category_text,
    listing.evidence_excerpt,
    listing.condition
  ].map(compactText).filter(Boolean).join(" | ");
}

export function classifySportsCardListing(listing = {}) {
  const text = listingSearchText(listing);
  const nonSportsMatch = explicitNonSportsPatterns.find(([, pattern]) => pattern.test(text));
  if (nonSportsMatch) {
    return {
      eligible: false,
      classification: "EXPLICIT_NON_SPORTS",
      reason: nonSportsMatch[0],
      sports_signals: []
    };
  }

  const nonSingleCardMatch = nonSingleCardPatterns.find(([, pattern]) => pattern.test(text));
  if (nonSingleCardMatch) {
    return {
      eligible: false,
      classification: "NON_SINGLE_CARD",
      reason: nonSingleCardMatch[0],
      sports_signals: []
    };
  }

  const sportsSignals = sportsSignalPatterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([reason]) => reason);
  if (sportsSignals.length) {
    return {
      eligible: true,
      classification: "SPORTS_SIGNAL",
      reason: sportsSignals[0],
      sports_signals: sportsSignals.slice(0, 8)
    };
  }

  return {
    eligible: true,
    classification: "UNKNOWN_ALLOWED",
    reason: "no_explicit_non_sports_signal",
    sports_signals: []
  };
}

export function listingLooksSportsCard(listing = {}) {
  return classifySportsCardListing(listing).eligible;
}

export function filterSportsCardListings(listings = []) {
  const kept = [];
  const discarded = [];
  const discardReasons = {};

  for (const listing of listings) {
    const classification = classifySportsCardListing(listing);
    if (classification.eligible) {
      kept.push({
        ...listing,
        sports_filter_classification: classification.classification,
        sports_filter_reason: classification.reason,
        sports_signals: classification.sports_signals
      });
      continue;
    }
    discarded.push({
      item_id: listing?.item_id || "",
      title: listing?.title || "",
      reason: classification.reason,
      classification: classification.classification
    });
    discardReasons[classification.reason] = (discardReasons[classification.reason] || 0) + 1;
  }

  return {
    listings: kept,
    discarded,
    discarded_count: discarded.length,
    discard_reasons: discardReasons,
    filter_version: sportsCardFilterVersion
  };
}
