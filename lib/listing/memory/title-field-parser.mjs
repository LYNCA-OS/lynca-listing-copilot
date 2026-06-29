import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";

const colorWords = Object.freeze([
  "Black",
  "Blue",
  "Bronze",
  "Dark Blue",
  "Gold",
  "Green",
  "Orange",
  "Pink",
  "Purple",
  "Red",
  "Silver",
  "White",
  "Yellow"
]);

const parallelSuffixes = Object.freeze([
  "Bordered",
  "Cracked Ice",
  "Geometric",
  "Hyper",
  "Mojo",
  "Prizm",
  "Refractor",
  "Shimmer",
  "Sparkle",
  "Sparkles",
  "Speckle",
  "Vinyl",
  "Wave"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\b(?:Nba|Mlb|Nfl|Mls|Ufc|Uefa|Fifa|Wwe|Rc|Fc|Cf|Usa)\b/g, (word) => word.toUpperCase());
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function yearFromTitle(title) {
  const match = normalizeText(title).match(/\b(\d{4}(?:-\d{2})?)\b/);
  return match?.[1] || null;
}

function serialFromTitle(title) {
  const serials = (String(title || "").match(/\b\d+\s*\/\s*\d+\b/g) || []).map(normalizeSerial).filter(Boolean);
  return serials.at(-1) || null;
}

function serialDenominatorFromTitle(title) {
  return serialFromTitle(title)?.split("/")?.[1] || null;
}

function collectorNumberFromTitle(title) {
  const matches = [...normalizeText(title).matchAll(/#\s*([A-Z0-9][A-Z0-9-]{0,14})\b/gi)]
    .map((match) => match[1].toUpperCase())
    .filter((value) => !/^\d{4}$/.test(value));
  return matches.at(-1) || null;
}

function gradeFromTitle(title) {
  const match = normalizeText(title).match(/\b(PSA|BGS|SGC|CGC|Beckett)\s+(?:Gem\s+Mint\s+)?(AUTO\s+)?(\d+(?:\.\d+)?)\b/i);
  if (!match) return {};
  const company = /^beckett$/i.test(match[1]) ? "BGS" : match[1].toUpperCase();
  return match[2]
    ? { grade_company: company, auto_grade: match[3], grade_type: "AUTO_ONLY" }
    : { grade_company: company, card_grade: match[3], grade_type: "CARD_ONLY" };
}

const canonicalProductAliases = Object.freeze({
  "Panini Prizm FIFA": "Panini Prizm FIFA Soccer",
  "Topps Chrome UCC": "Topps Chrome UEFA Club Competitions",
  "Topps Chrome UEFA": "Topps Chrome UEFA Club Competitions",
  "Bowman Sapphire": "Bowman Chrome Sapphire",
  "Donruss Optic": "Panini Donruss Optic",
  "Contenders Optic": "Panini Contenders Optic",
  "Panini Contenders": "Panini Contenders"
});

function canonicalProductName(value = "") {
  const normalized = normalizeText(value);
  return canonicalProductAliases[normalized] || normalized;
}

function productHintsFromTitle(title) {
  const text = normalizeText(title);
  const hints = {};
  const brandMatch = text.match(/\b(Topps|Panini|Bowman|Upper Deck|Fleer|Donruss|Cardsmiths)\b/i);
  if (brandMatch) hints.manufacturer = brandMatch[1].replace(/\b\w/g, (letter) => letter.toUpperCase());

  const productPatterns = [
    /\bPanini\s+Prizm\s+FIFA\s+Soccer\b/i,
    /\bPanini\s+Prizm\s+FIFA\b/i,
    /\bTopps\s+Chrome\s+UEFA\s+Club\s+Competitions\b/i,
    /\bTopps\s+Chrome\s+UEFA\b/i,
    /\bTopps\s+Chrome\s+UCC\b/i,
    /\bTopps\s+Chrome\s+MLS\b/i,
    /\bTopps\s+Cosmic\s+Chrome\b/i,
    /\bTopps\s+Star\s+Wars\s+Chrome\s+Black\b/i,
    /\bTopps\s+Chrome\s+Platinum\s+Anniversary\b/i,
    /\bTopps\s+Chrome\s+Platinum\b/i,
    /\bTopps\s+Chrome\s+VeeFriends\b/i,
    /\bTopps\s+Chrome\s+UFC\b/i,
    /\bTopps\s+Chrome\s+Formula\s+1\b/i,
    /\bStar\s+Wars\s+Smugglers\s+Outpost\b/i,
    /\bCardsmiths\s+Street\s+Fighter\s+Alpha\s+Warriors'?\s+Dreams\b/i,
    /\bTopps\s+Chrome\s+Black\b/i,
    /\bTopps\s+Chrome\s+Sapphire\b/i,
    /\bTopps\s+Sapphire\b/i,
    /\bTopps\s+Chrome\b/i,
    /\bTopps\s+Finest\b/i,
    /\bTopps\s+Tier\s+One\b/i,
    /\bTopps\s+Definitive\b/i,
    /\bTopps\s+Dynasty\b/i,
    /\bTopps\s+Reverence\s+UEFA\b/i,
    /\bTopps\s+Signature\s+Class\b/i,
    /\bTopps\s+Graphite\s+Tennis\b/i,
    /\bTopps\s+Graphite\b/i,
    /\bTopps\s+Now\b/i,
    /\bTopps\s+Crystal\s+Premium\s+UEFA\b/i,
    /\bTopps\s+1st\s+Edition\b/i,
    /\bTopps\s+Heritage\s+High\s+Number\b/i,
    /\bTopps\s+Heritage\b/i,
    /\bTopps\s+Stadium\s+Club\b/i,
    /\bStadium\s+Club\b/i,
    /\bTopps\s+Triple\s+Threads\b/i,
    /\bTriple\s+Threads\b/i,
    /\bBowman\s+Chrome\b/i,
    /\bBowman\s+Sapphire\b/i,
    /\bBowman\s+Draft\b/i,
    /\bBowman\b/i,
    /\bPanini\s+Noir\s+Road\s+to\s+FIFA\s+World\s+Cup\b/i,
    /\bPanini\s+Noir\b/i,
    /\bPanini\s+Signature\s+Series\b/i,
    /\bPanini\s+Gold\s+Standard\b/i,
    /\bPanini\s+Contenders\s+Optic\b/i,
    /\bPanini\s+Donruss\s+Optic\b/i,
    /\bDonruss\s+Elite\b/i,
    /\bPanini\s+Black\b/i,
    /\bPanini\s+Obsidian\b/i,
    /\bPanini\s+Spectra\b/i,
    /\bPanini\s+Certified\b/i,
    /\bPanini\s+Flawless\b/i,
    /\bPanini\s+Prizm\b/i,
    /\bPanini\s+Hoops\b/i,
    /\bPanini\s+Absolute\b/i,
    /\bAbsolute\s+Hoopla\b/i,
    /\bPanini\s+Select\b/i,
    /\bPanini\s+Mosaic\b/i,
    /\bDonruss\s+Optic\b/i,
    /\bPanini\s+Impeccable\b/i,
    /\bPanini\s+Contenders\b/i,
    /\bUpper\s+Deck\s+Sweet\s+Shot\b/i,
    /\bUpper\s+Deck\s+Draft\s+Edition\b/i,
    /\bUpper\s+Deck\s+MJx\b/i,
    /\bFleer\s+Greats\b/i,
    /\bFleer\s+Legacy\b/i,
    /\bFleer\s+ProCards\b/i,
    /\bSP\s+Game\s+Used\s+Edition\b/i,
    /\bLeaf\s+Optichrome\b/i,
    /\bLeaf\s+Metal\s+Draft\b/i,
    /\bLeaf\s+Metal\b/i,
    /\bLeaf\s+Eclectic\b/i,
    /\bWild\s+Card\s+Wildchrome\s+Draft\b/i,
    /\bGoodwin\s+Champions\b/i,
    /\bPokemon\s+EN\s+SWSH\s+Lost\s+Origin\b/i,
    /\bDisney\s+Lorcana\s+JP\b/i,
    /\bFutera\s+Unique\b/i,
    /\bDonruss\s+Road\s+to\s+FIFA\s+World\s+Cup\s+26'?\b/i,
    /\bStar\s+Court\s+Kings\b/i,
    /\bSkybox\s+E-?Motion\b/i,
    /\bBBM\s+Rookie\s+Edition\b/i,
    /\bBBM\b/i,
    /\bContenders\b/i,
    /\bPrizm\b/i,
    /\bTopps\b/i,
    /\bPanini\b/i,
    /\bUpper\s+Deck\b/i,
    /\bFleer\b/i,
    /\bLeaf\b/i,
    /\bDonruss\b/i,
    /\bPokemon\b/i
  ];
  const product = productPatterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  if (product) hints.product = canonicalProductName(product);

  return hints;
}

function teamFromTitle(title) {
  const text = normalizeText(title);
  const teamPatterns = [
    /\b(?:Los Angeles|LA)\s+Lakers\b/i,
    /\bGolden\s+State\s+Warriors\b/i,
    /\bBoston\s+Celtics\b/i,
    /\bNew\s+York\s+Knicks\b/i,
    /\bPhiladelphia\s+76ers\b/i,
    /\bSan\s+Antonio\s+Spurs\b/i,
    /\bDallas\s+Mavericks\b/i,
    /\bChicago\s+Bulls\b/i,
    /\bMiami\s+Heat\b/i,
    /\bNew\s+York\s+Mets\b/i,
    /\bLos\s+Angeles\s+Dodgers\b/i,
    /\bChicago\s+White\s+Sox\b/i,
    /\bNew\s+York\s+Yankees\b/i,
    /\bDallas\s+Cowboys\b/i,
    /\bNew\s+England\s+Patriots\b/i,
    /\b(?:Tampa\s+Bay\s+)?Buccaneers\b/i,
    /\bLas\s+Vegas\s+Raiders\b/i,
    /\bFC\s+Barcelona\b/i,
    /\bBayern\s+Munich\b/i,
    /\bReal\s+Madrid\b/i,
    /\bParis\s+Saint-?Germain\b/i,
    /\bInter\s+Miami\s+CF\b/i,
    /\bManchester\s+(?:United|City)\b/i,
    /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,1}\s+(?:FC|CF|United|City|Town|Athletic|Rovers)\b/i,
    /\b(?:England|France|Spain|Germany|Italy|Portugal|Argentina|Brazil|Netherlands|Japan|USA|United\s+States)\b/i
  ];
  const match = teamPatterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  return match ? titleCase(match.replace(/^LA\s+/i, "Los Angeles ")) : null;
}

function surfaceColorFromTitle(title) {
  const text = normalizeText(title);
  const escapedColors = colorWords.map((color) => color.replace(/\s+/g, "\\s+")).join("|");
  const escapedSuffixes = parallelSuffixes.map((suffix) => suffix.replace(/\s+/g, "\\s+")).join("|");
  const colorSuffix = text.match(new RegExp(`\\b(${escapedColors})(?:[-\\s]+(${escapedSuffixes})(?:[-\\s]+(${escapedSuffixes}))?)?\\b`, "i"));
  if (!colorSuffix) return null;
  return normalizeText(colorSuffix[1]).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function officialCardTypeFromTitle(title) {
  const text = normalizeText(title);
  const officialPhrases = [
    "Chrome Rookie Auto",
    "Next Stop Signatures",
    "Rookie Ticket",
    "Rated Rookie",
    "Rookie Refractor",
    "Rookie Auto",
    "RPS Rookie Ticket",
    "Green Pulsar Ticket RPS",
    "Canvas Creations",
    "Material Signatures",
    "Hoopla Material Signatures",
    "Dual Signatures",
    "Duo Logoman Autographs",
    "Club Legends",
    "Metallic Marks",
    "Key Art Meta Rare",
    "Historic Ties Triple Autograph Relic Card",
    "Historic Ties",
    "Star Swatch Signatures",
    "Smugglers Outpost",
    "Variation Autograph",
    "Finest Autographs",
    "Finest Performance",
    "Chrome Auto",
    "Chrome Autographs",
    "Retro 1986 Signatures",
    "Graphite Signatures",
    "Graphite Relic Signature",
    "Holo Prizm",
    "Blue Hyper Prizm",
    "Lucky Hyper",
    "Shadow Etch",
    "Mini Diamond",
    "Duel of the Fates",
    "Passing the Torch",
    "Dark Blue Bordered",
    "All Kings",
    "Timepieces",
    "Next In Line",
    "Portrait Auto",
    "WildLiquid Wave",
    "Rush",
    "Authentic Fabric",
    "Crush",
    "Freshman Fabric",
    "Splash of Color",
    "Break Out Autograph",
    "Star Clusters",
    "Major League Material",
    "Kaboom",
    "Raindrops Signatures",
    "Card Shop Promo",
    "Rookie Stars",
    "Special PR Volume",
    "Elite Jersey",
    "Exotic Kaleidoscope Clown Fish"
  ];
  return officialPhrases.find((phrase) => new RegExp(`\\b${escapeRegExp(phrase).replace(/\s+/g, "\\s+")}\\b`, "i").test(text)) || null;
}

function stripKnownPhrase(text, phrase) {
  const normalized = normalizeText(phrase);
  if (!normalized) return text;
  return normalizeText(text.replace(new RegExp(`\\b${escapeRegExp(normalized).replace(/\s+/g, "\\s+")}\\b`, "ig"), " "));
}

function subjectStopWords() {
  return new Set([
    "auto",
    "autograph",
    "autographs",
    "signed",
    "signature",
    "signatures",
    "patch",
    "relic",
    "swatch",
    "memorabilia",
    "logoman",
    "jersey",
    "rc",
    "rookie",
    "rated",
    "ticket",
    "sketch",
    "redemption",
    "base",
    "insert",
    "variation",
    "parallel",
    "prizm",
    "refractor",
    "wave",
    "shimmer",
    "mojo",
    "sparkle",
    "sparkles",
    "speckle",
    "hyper",
    "geometric",
    "bordered",
    "vinyl",
    "chrome",
    "sapphire",
    "holo",
    "foil",
    "gold",
    "purple",
    "red",
    "blue",
    "green",
    "silver",
    "black",
    "orange",
    "white",
    "yellow",
    "bronze",
    "pink",
    "dark",
    "fifa",
    "uefa",
    "ucc",
    "nba",
    "nfl",
    "mlb",
    "mls",
    "ufc",
    "wwe",
    "soccer",
    "basketball",
    "baseball",
    "football",
    "star",
    "wars",
    "street",
    "fighter",
    "alpha",
    "warriors",
    "dreams",
    "cardsmiths",
    "topps",
    "panini",
    "bowman",
    "donruss",
    "upper",
    "deck",
    "fleer",
    "psa",
    "bgs",
    "sgc",
    "cgc",
    "beckett",
    "gem",
    "mint",
    "cert",
    "number",
    "card",
    "legends",
    "club",
    "marks",
    "metallic",
    "key",
    "art",
    "meta",
    "rare",
    "smugglers",
    "outpost",
    "all",
    "kings",
    "timepieces",
    "rush",
    "authentic",
    "fabric",
    "crush",
    "freshman",
    "splash",
    "color",
    "break",
    "out",
    "clusters",
    "major",
    "league",
    "material",
    "kaboom",
    "raindrops",
    "tense",
    "promo",
    "prospect",
    "iconic",
    "exotic",
    "kaleidoscope",
    "clown",
    "fish",
    "proof",
    "edition",
    "draft",
    "gallery",
    "trainer",
    "volume",
    "white",
    "sox",
    "raiders",
    "buccaneers"
  ]);
}

function maybeSubjectChunk(chunk = "") {
  const cleaned = normalizeText(chunk
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
    .replace(/\b(?:and|with|featuring|feat)\b/gi, " "));
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return "";
  const stopWords = subjectStopWords();
  const nameWords = words.filter((word) => {
    const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!normalized) return false;
    if (stopWords.has(normalized)) return false;
    return /^[a-z][a-z'.-]*$/i.test(word);
  });
  if (nameWords.length < 2) return "";
  return titleCase(nameWords.join(" "));
}

function playersFromTitle(title, {
  product = "",
  officialCardType = "",
  team = ""
} = {}) {
  let text = normalizeText(title);
  text = text
    .replace(/\b\d{4}(?:-\d{2})?\b/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/#\s*[A-Z0-9][A-Z0-9-]{0,18}\b/gi, " ")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s+(?:Gem\s+Mint\s+)?(?:AUTO\s+)?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\bCert(?:ificate)?\s*#?\s*[A-Z0-9-]+\b/gi, " ");
  text = stripKnownPhrase(text, product);
  text = stripKnownPhrase(text, officialCardType);
  text = stripKnownPhrase(text, team);
  for (const color of colorWords) text = stripKnownPhrase(text, color);
  for (const suffix of parallelSuffixes) text = stripKnownPhrase(text, suffix);
  text = normalizeText(text.replace(/[()]/g, " ").replace(/\s+-\s+/g, " / "));

  const slashSplit = text.split(/\s+(?:\/|&|\+|and)\s+/i).map(maybeSubjectChunk).filter(Boolean);
  if (slashSplit.length > 1) return unique(slashSplit);

  const single = maybeSubjectChunk(text);
  return single ? [single] : [];
}

function categoryHintsFromTitle(title, product = "") {
  const haystack = `${title} ${product}`;
  if (/\b(?:FIFA|UEFA|MLS|Soccer|Club Legends|FC\s+Barcelona)\b/i.test(haystack)) {
    return { category: "soccer", sport: "soccer" };
  }
  if (/\b(?:NBA|Basketball|Hoops|Impeccable|Prizm Basketball)\b/i.test(haystack)) {
    return { category: "basketball", sport: "basketball", league: /\bNBA\b/i.test(haystack) ? "NBA" : null };
  }
  if (/\b(?:MLB|Baseball|Bowman|Topps Chrome Baseball|Topps Heritage)\b/i.test(haystack)) {
    return { category: "baseball", sport: "baseball" };
  }
  if (/\b(?:NFL|Football|Panini Black|Donruss Optic Football)\b/i.test(haystack)) {
    return { category: "football", sport: "football" };
  }
  if (/\b(?:Star Wars)\b/i.test(haystack)) return { category: "non_sports" };
  if (/\b(?:Street Fighter|Cardsmiths)\b/i.test(haystack)) return { category: "tcg" };
  return {};
}

export function parseReviewedTitleFields(title = {}) {
  const text = normalizeText(title);
  const productHints = productHintsFromTitle(text);
  const officialCardType = officialCardTypeFromTitle(text);
  const team = teamFromTitle(text);
  const surfaceColor = surfaceColorFromTitle(stripKnownPhrase(text, productHints.product));
  const players = playersFromTitle(text, {
    product: productHints.product,
    officialCardType,
    team
  });
  const categoryHints = categoryHintsFromTitle(text, productHints.product);
  const observableComponents = [
    /\b(?:Auto|Autograph|Signed|Signature|Signatures)\b/i.test(text) ? "auto" : null,
    /\bPatch\b/i.test(text) ? "patch" : null,
    /\b(?:Relic|Swatch|Memorabilia|Logoman)\b/i.test(text) ? "relic" : null,
    /\bJersey\b/i.test(text) ? "jersey" : null,
    /\b(?:RC|Rookie|Rated Rookie|Rookie Ticket)\b/i.test(text) ? "rc" : null,
    /\bSketch\b/i.test(text) ? "sketch" : null,
    /\bRedemption\b/i.test(text) ? "redemption" : null
  ].filter(Boolean);
  const fields = {
    ...categoryHints,
    ...productHints,
    year: yearFromTitle(text),
    players,
    serial_number: serialFromTitle(text),
    serial_denominator: serialDenominatorFromTitle(text),
    collector_number: collectorNumberFromTitle(text),
    team,
    official_card_type: officialCardType,
    observable_components: observableComponents,
    surface_color: surfaceColor,
    ...gradeFromTitle(text),
    rc: observableComponents.includes("rc"),
    first_bowman: /\b(?:1st|First)\s+Bowman\b/i.test(text),
    auto: observableComponents.includes("auto"),
    patch: observableComponents.includes("patch"),
    relic: observableComponents.includes("relic"),
    jersey: observableComponents.includes("jersey"),
    sketch: observableComponents.includes("sketch"),
    redemption: observableComponents.includes("redemption"),
    one_of_one: /\b0*1\s*\/\s*0*1\b/.test(text)
  };

  const compactFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "boolean") return value === true;
      return value !== null && value !== undefined && value !== "";
    })
  );
  const normalized = normalizeResolvedFields(compactFields);
  if (compactFields.serial_denominator) {
    normalized.serial_denominator = compactFields.serial_denominator;
  }
  return normalized;
}

export function reviewedTitleRecordToMemoryRecord(record = {}) {
  const title = normalizeText(record.corrected_title || record.final_title || record.title);
  const fields = parseReviewedTitleFields(title);
  const populatedFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "boolean") return value === true;
      return value !== null && value !== undefined && value !== "" && value !== "UNKNOWN";
    })
  );

  return {
    id: record.id || record.source_feedback_id || "",
    title,
    final_title: title,
    fields: populatedFields,
    review_outcome: record.review_outcome || "CORRECTED_FIELDS",
    stable_training_sample: record.stable_training_sample === true,
    training_status: record.training_status || "title_parsed_local",
    reusable_approved_title: false,
    source_feedback_id: record.source_feedback_id || record.id || ""
  };
}

export function reviewedTitleRowsToMemoryRecords(rows = []) {
  return unique((Array.isArray(rows) ? rows : [])
    .map((row) => reviewedTitleRecordToMemoryRecord(row))
    .filter((record) => record.title && Object.keys(record.fields || {}).length > 0)
    .map((record) => JSON.stringify(record)))
    .map((record) => JSON.parse(record));
}
