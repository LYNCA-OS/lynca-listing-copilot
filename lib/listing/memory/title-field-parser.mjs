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
  const match = normalizeText(title).match(/\b((?:19|20)\d{2}(?:-\d{2})?)\b/);
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
  const text = normalizeText(title);
  const rarityNumber = text.match(/#\s*(C|U|R|M|E|L|SR|SEC|SCR|SP|SSP)\s+([A-Z0-9][A-Z0-9-]{1,14})\b/i);
  if (rarityNumber) return rarityNumber[2].toUpperCase();
  const matches = [...text.matchAll(/#\s*([A-Z0-9][A-Z0-9-]{0,14})\b/gi)]
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
  "Definitive": "Topps Definitive",
  "Donruss Optic": "Panini Donruss Optic",
  "Eminence": "Panini Eminence",
  "Encased": "Panini Encased",
  "Finest Flashbacks": "Topps Finest Flashbacks",
  "Finest UCL": "Topps Finest UCL",
  "Flawless": "Panini Flawless",
  "Flawless Collegiate": "Panini Flawless Collegiate",
  "Hoops": "Panini Hoops",
  "Immaculate": "Panini Immaculate",
  "Mosaic": "Panini Mosaic",
  "National Treasures": "Panini National Treasures",
  "Noir": "Panini Noir",
  "Obsidian": "Panini Obsidian",
  "One and One": "Panini One and One",
  "Plates & Patches": "Panini Plates & Patches",
  "Shonen Jump": "Yu-Gi-Oh Shonen Jump",
  "SJC-EN001": "Yu-Gi-Oh Shonen Jump Championship",
  "SJC-EN002": "Yu-Gi-Oh Shonen Jump Championship",
  "Skybox Thunder": "Skybox Thunder",
  "Skybox x Thunder": "Skybox Thunder",
  "SkyBox Metal Universe": "SkyBox Metal Universe",
  "Metal Universe": "SkyBox Metal Universe",
  "Spectra": "Panini Spectra",
  "UD Goodwin": "Upper Deck Goodwin Champions",
  "UD Exquisite Collection": "Upper Deck Exquisite Collection",
  "UD Credentials": "Upper Deck Credentials",
  "Credentials": "Upper Deck Credentials",
  "Allen Ginter": "Topps Allen & Ginter",
  "Allen & Ginter": "Topps Allen & Ginter",
  "Garbage Pail Kids": "Topps Garbage Pail Kids",
  "Game Of Thrones": "Game of Thrones",
  "Harry Potter": "Kakawow Harry Potter",
  "V Jump Festa": "Yu-Gi-Oh V Jump Festa",
  "Worlds Prize Card": "Yu-Gi-Oh Worlds Prize Card",
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
  if (/\bFinal\s+Fantasy\s+MTG\b/i.test(text)) {
    hints.manufacturer = "Wizards of the Coast";
    hints.brand = "Magic: The Gathering";
    hints.product = "Magic: The Gathering Final Fantasy";
    return hints;
  }
  if (/\bO-?Pee-?Chee\b/i.test(text)) {
    hints.manufacturer = "Upper Deck";
    hints.brand = "O-Pee-Chee";
  }
  if (/\bSP\s+Game\s+Used\b/i.test(text)) {
    hints.manufacturer = "Upper Deck";
    hints.brand = "Upper Deck";
  }
  const brandMatch = text.match(/\b(Topps|Panini|Bowman|Upper Deck|Fleer|Donruss|Cardsmiths|How2Work)\b/i);
  if (brandMatch) hints.manufacturer = brandMatch[1].replace(/\b\w/g, (letter) => letter.toUpperCase());

  const productPatterns = [
    /\bMagic:?\s+The\s+Gathering\s+Final\s+Fantasy\b/i,
    /\bFinal\s+Fantasy\s+MTG\b/i,
    /\bMagic:?\s+The\s+Gathering\b/i,
    /\bTopps\s+Chrome\s+Formula\s+1\b/i,
    /\bTopps\s+Chrome\s+Marvel\b/i,
    /\bTopps\s+Chrome\s+WWE\b/i,
    /\bTopps\s+Chrome\s+UFC\b/i,
    /\bTopps\s+Series\s+2\b/i,
    /\bTopps\s+Inception\b/i,
    /\bTopps\s+Resurgence\b/i,
    /\bPanini\s+Prizm\s+Deca\b/i,
    /\bPanini\s+Prizm\s+FIFA\s+Soccer\b/i,
    /\bPanini\s+Prizm\s+FIFA\b/i,
    /\bPanini\s+Score\b/i,
    /\bPanini\s+Minecraft\b/i,
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
    /\bPanini\s+Clearly\s+Donruss\b/i,
    /\bDonruss\s+Elite\b/i,
    /\bPanini\s+Black\b/i,
    /\bPanini\s+Obsidian\b/i,
    /\bPanini\s+Spectra\b/i,
    /\bPanini\s+Certified\b/i,
    /\bPanini\s+Flawless\b/i,
    /\bFlawless\s+Collegiate\b/i,
    /\bFlawless\b/i,
    /\bNational\s+Treasures\b/i,
    /\bPanini\s+Prizm\b/i,
    /\bPanini\s+Hoops\b/i,
    /\bHoops\b/i,
    /\bPanini\s+Absolute\b/i,
    /\bAbsolute\b/i,
    /\bAbsolute\s+Hoopla\b/i,
    /\bPanini\s+Select\b/i,
    /\bSelect\b/i,
    /\bPanini\s+Mosaic\b/i,
    /\bMosaic\b/i,
    /\bDonruss\s+Optic\b/i,
    /\bPanini\s+Impeccable\b/i,
    /\bImpeccable\b/i,
    /\bPanini\s+Contenders\b/i,
    /\bNoir\b/i,
    /\bSpectra\b/i,
    /\bImmaculate\b/i,
    /\bEncased\b/i,
    /\bObsidian\b/i,
    /\bOne\s+and\s+One\b/i,
    /\bPlates\s+&\s+Patches\b/i,
    /\bEminence\b/i,
    /\bDefinitive\b/i,
    /\bFinest\s+Flashbacks\b/i,
    /\bFinest\s+UCL\b/i,
    /\bUpper\s+Deck\s+Sweet\s+Shot\b/i,
    /\bUpper\s+Deck\s+Draft\s+Edition\b/i,
    /\bUpper\s+Deck\s+MJx\b/i,
    /\bFleer\s+Greats\b/i,
    /\bFleer\s+Legacy\b/i,
    /\bFleer\s+ProCards\b/i,
    /\bUpper\s+Deck\s+Credentials\b/i,
    /\bUD\s+Credentials\b/i,
    /\bCredentials\b/i,
    /\bUD\s+Goodwin\b/i,
    /\bUD\s+Exquisite\s+Collection\b/i,
    /\bUpper\s+Deck\s+Exquisite\s+Collection\b/i,
    /\bO-?Pee-?Chee\b/i,
    /\bSP\s+Game\s+Used\b/i,
    /\bSP\s+Game\s+Used\s+Edition\b/i,
    /\bSkyBox\s+Metal\s+Universe\b/i,
    /\bMetal\s+Universe\b/i,
    /\bAllen\s+Ginter\b/i,
    /\bAllen\s+&\s+Ginter\b/i,
    /\bTopps\s+Garbage\s+Pail\s+Kids\b/i,
    /\bGarbage\s+Pail\s+Kids\b/i,
    /\bGame\s+Of\s+Thrones\b/i,
    /\bKakawow\s+Harry\s+Potter\b/i,
    /\bHarry\s+Potter\b/i,
    /\bHow2Work\s+The\s+Monsters\b/i,
    /\bLeaf\s+Optichrome\b/i,
    /\bLeaf\s+Metal\s+Draft\b/i,
    /\bLeaf\s+Metal\b/i,
    /\bLeaf\s+Eclectic\b/i,
    /\bWild\s+Card\s+Wildchrome\s+Draft\b/i,
    /\bGoodwin\s+Champions\b/i,
    /\bPokemon\s+EN\s+SWSH\s+Lost\s+Origin\b/i,
    /\bYu-?Gi-?Oh!?\b/i,
    /\bShonen\s+Jump\b/i,
    /\bSJC-[A-Z]{2}\d{3}\b/i,
    /\bV\s+Jump\s+Festa\b/i,
    /\bWorlds\s+Prize\s+Card\b/i,
    /\bOne\s+Piece\s+Romance\s+Dawn\b/i,
    /\bOne\s+Piece\s+New\s+Era\b/i,
    /\bOne\s+Piece\b/i,
    /\bDisney\s+Lorcana\s+JP\b/i,
    /\bFutera\s+Unique\b/i,
    /\bDonruss\s+Road\s+to\s+FIFA\s+World\s+Cup\s+26'?\b/i,
    /\bStar\s+Court\s+Kings\b/i,
    /\bSkybox\s+x\s+Thunder\b/i,
    /\bSkybox\s+Thunder\b/i,
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
  if (!hints.product) {
    if (/\bFanatics\s+Certif(?:ies|ied)\b|\bGame\s+Worn\s+Authentic\s+Jersey\b/i.test(text)) {
      hints.manufacturer = "Fanatics";
      hints.brand = "Fanatics Authentic";
      hints.product = "Fanatics Authentic Game Worn Jersey";
    } else if (/\bGemblo\b/i.test(text)) {
      hints.manufacturer = "Gemblo";
      hints.brand = "Gemblo";
      hints.product = "Gemblo";
    } else if (/\bMatch\s+Attax\b/i.test(text)) {
      hints.manufacturer = "Topps";
      hints.brand = "Match Attax";
      hints.product = "Topps Match Attax";
    } else if (/\bLeveling\b/i.test(text)) {
      hints.product = "Leveling Collectible Cards";
    } else if (/\bNikke\b/i.test(text)) {
      hints.product = "NIKKE Collectible Cards";
    } else {
      hints.product = "Other Collectibles";
    }
  }

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
  if (/\b(?:Final\s+Fantasy\s+MTG|Magic:?\s+The\s+Gathering|MTG|Pokemon|Pok[eé]mon|Yu-?Gi-?Oh!?|One\s+Piece|Lorcana|Dragon\s+Ball|Digimon|Union\s+Arena|Battle\s+Spirits)\b/i.test(haystack)) {
    return { category: "tcg", sport: "tcg" };
  }
  if (/\b(?:Marvel|Star\s+Wars|Disney|Minecraft|VeeFriends|Labubu|How2Work|The\s+Monsters)\b/i.test(haystack)) {
    return { category: "non_sports", sport: "non_sports" };
  }
  if (/\b(?:UFC|MMA)\b/i.test(haystack)) {
    return { category: "mma", sport: "mma", league: "UFC" };
  }
  if (/\b(?:WWE|Wrestling)\b/i.test(haystack)) {
    return { category: "wrestling", sport: "wrestling", league: "WWE" };
  }
  if (/\b(?:Formula\s*1|Formula\s+One|F1)\b/i.test(haystack)) {
    return { category: "racing", sport: "racing", league: "F1" };
  }
  if (/\b(?:Hockey|NHL|O-?Pee-?Chee|Young\s+Guns|SP\s+Game\s+Used)\b/i.test(haystack)) {
    return { category: "hockey", sport: "hockey", league: "NHL" };
  }
  if (/\b(?:Upper\s+Deck\s+Credentials|UD\s+Credentials|Credentials|SkyBox\s+Metal\s+Universe|Metal\s+Universe)\b/i.test(haystack) && /\b20\d{2}-\d{2}\b/i.test(haystack)) {
    return { category: "hockey", sport: "hockey", league: "NHL" };
  }
  if (/\b(?:Fanatics\s+Certif(?:ies|ied)|Game\s+Worn\s+Authentic\s+Jersey|Game\s+Used\s+Jersey)\b/i.test(haystack)) {
    return { category: "sports_memorabilia", sport: "sports_memorabilia" };
  }
  if (/\b(?:Game\s+Of\s+Thrones|Harry\s+Potter|Kakawow|Batman|SpongeBob|Nikke|Garbage\s+Pail\s+Kids)\b/i.test(haystack)) {
    return { category: "non_sports", sport: "non_sports" };
  }
  if (/\b(?:Bundesliga|UCL|Match\s+Attax)\b/i.test(haystack)) {
    return { category: "soccer", sport: "soccer" };
  }
  if (/\b(?:FIFA|UEFA|MLS|Soccer|Club Legends|FC\s+Barcelona)\b/i.test(haystack)) {
    return { category: "soccer", sport: "soccer" };
  }
  if (/\bGoodwin\s+Champions\b/i.test(haystack)) {
    return { category: "multi_sport", sport: "multi_sport" };
  }
  if (/\b(?:Tennis|Topps\s+Graphite\s+Tennis)\b/i.test(haystack)) {
    return { category: "tennis", sport: "tennis" };
  }
  if (
    /\b(?:Topps|Bowman|MLB|Baseball)\b/i.test(haystack)
    && /\b(?:Dodgers|Yankees|Mets|Padres|Phillies|Red\s+Sox|Cubs|Orioles|Reds|Pirates|Mariners|Royals|Tigers|Athletics|Rangers|Angels|Astros|Blue\s+Jays|Braves|Twins|Guardians|Brewers|White\s+Sox|Diamondbacks|Nationals|Rays|Rockies|Marlins)\b/i.test(haystack)
  ) {
    return { category: "baseball", sport: "baseball", league: "MLB" };
  }
  if (
    /\b(?:Panini|Donruss|Score|Prizm|Mosaic|Noir|Hoops|NBA|Basketball)\b/i.test(haystack)
    && /\b(?:Lakers|Warriors|Celtics|Spurs|Mavericks|Knicks|Bulls|Heat|Suns|Magic|Hornets|Thunder|Nuggets|Clippers|Grizzlies|Nets|Pacers|Pelicans|Hawks|Wizards|Jazz|Trail\s+Blazers|Raptors|76ers|Bucks|Rockets|Cavaliers|Timberwolves|Pistons|Kings|WNBA|Fever|Aces|Liberty|Storm|Sky|Lynx|Mercury|Sparks|Dream|Sun|Wings|Mystics|Valkyries)\b/i.test(haystack)
  ) {
    return { category: "basketball", sport: "basketball", league: /\bWNBA\b/i.test(haystack) ? "WNBA" : "NBA" };
  }
  if (/\b20\d{2}-\d{2}\b/i.test(haystack) && /\bPanini\s+(?:Mosaic|Prizm|Select|Noir|Obsidian|National\s+Treasures|Hoops)\b/i.test(haystack)) {
    return { category: "basketball", sport: "basketball", league: "NBA" };
  }
  if (
    /\b(?:Panini|Donruss|Score|Contenders|NFL|Football|Topps\s+Inception|Topps\s+Resurgence|Panini\s+Clearly\s+Donruss)\b/i.test(haystack)
    && /\b(?:Cowboys|Patriots|Chiefs|Bills|Raiders|Packers|Steelers|Eagles|Broncos|49ers|Rams|Vikings|Lions|Texans|Titans|Colts|Chargers|Saints|Buccaneers|Commanders|Panthers|Ravens|Bears|Jaguars|Seahawks|Falcons|Dolphins|Jets|Bengals|Browns)\b/i.test(haystack)
  ) {
    return { category: "football", sport: "football", league: "NFL" };
  }
  if (/\bPanini\s+Clearly\s+Donruss\b/i.test(haystack)) {
    return { category: "football", sport: "football", league: "NFL" };
  }
  if (/\b(?:NBA|Basketball|Hoops|Impeccable|Prizm Basketball)\b/i.test(haystack)) {
    return { category: "basketball", sport: "basketball", league: /\bNBA\b/i.test(haystack) ? "NBA" : null };
  }
  if (/\b(?:MLB|Baseball|Bowman|Topps Chrome Baseball|Topps Heritage|Topps Series 2)\b/i.test(haystack)) {
    return { category: "baseball", sport: "baseball" };
  }
  if (/\b(?:NFL|Football|Panini Black|Donruss Optic Football|Panini Score|Panini Contenders|Topps Inception|Topps Resurgence|Quarterback|Running Back|Wide Receiver)\b/i.test(haystack)) {
    return { category: "football", sport: "football" };
  }
  if (/\b(?:Star Wars)\b/i.test(haystack)) return { category: "non_sports" };
  if (/\b(?:Street Fighter|Cardsmiths)\b/i.test(haystack)) return { category: "tcg" };
  return { category: "other_collectibles", sport: "other_collectibles" };
}

function categoryCandidatesFromTitle(title, product = "") {
  const haystack = `${title} ${product}`;
  const candidates = [];
  const add = (category, reason) => {
    if (!category || candidates.some((item) => item.category === category)) return;
    candidates.push({ category, reason });
  };
  if (/\b(?:Final\s+Fantasy\s+MTG|Magic:?\s+The\s+Gathering|MTG|Pokemon|Pok[eé]mon|Yu-?Gi-?Oh!?|One\s+Piece|Lorcana|Dragon\s+Ball|Digimon|Union\s+Arena|Battle\s+Spirits|Trading\s+Card\s+Game|TCG)\b/i.test(haystack)) {
    add("tcg", "tcg_ip_or_game_signal");
  }
  if (/\b(?:Topps|Panini|Upper\s+Deck|Fleer|Donruss|Leaf|Bowman|Fanatics|NBA|NFL|MLB|NHL|UFC|FIFA|UEFA|MLS|WNBA|Formula\s*1|F1|WWE|O-?Pee-?Chee|Goodwin\s+Champions)\b/i.test(haystack)) {
    add("sports_card", "sports_publisher_or_league_signal");
  }
  if (/\b(?:Marvel|Star\s+Wars|Disney|Harry\s+Potter|Game\s+Of\s+Thrones|Garbage\s+Pail\s+Kids|VeeFriends|Labubu|SpongeBob|Nikke|Minecraft)\b/i.test(haystack)) {
    add("non_sports", "entertainment_or_character_ip_signal");
  }
  if (/\b(?:Game\s+Worn|Game\s+Used|Fanatics\s+Authentic|Authentic\s+Jersey|Memorabilia)\b/i.test(haystack)) {
    add("sports_memorabilia", "memorabilia_signal");
  }
  return candidates;
}

function languageFromTitle(title) {
  const text = normalizeText(title);
  const match = text.match(/\b(JPN|JP|Japanese|EN|ENG|English|CN|Chinese|KR|Korean)\b/i);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  if (raw === "jpn" || raw === "jp" || raw === "japanese") return "JPN";
  if (raw === "en" || raw === "eng" || raw === "english") return "EN";
  if (raw === "cn" || raw === "chinese") return "CN";
  if (raw === "kr" || raw === "korean") return "KR";
  return match[1].toUpperCase();
}

function rarityFromTitle(title) {
  const match = normalizeText(title).match(/#\s*(C|U|R|M|E|L|SR|SEC|SCR|SP|SSP)\s+[A-Z0-9][A-Z0-9-]{1,14}\b/i);
  return match?.[1]?.toUpperCase() || null;
}

function tcgCardNameFromTitle(title, product = "") {
  const text = normalizeText(title);
  if (!/\b(?:MTG|Magic:?\s+The\s+Gathering|Pokemon|Pok[eé]mon|Yu-?Gi-?Oh!?|One\s+Piece|Lorcana|Dragon\s+Ball|Digimon)\b/i.test(`${text} ${product}`)) return null;
  let working = text;
  working = stripKnownPhrase(working, product);
  working = working.replace(/\bFinal\s+Fantasy\s+MTG\b/i, " ");
  working = working.replace(/\bMagic:?\s+The\s+Gathering\b/i, " ");
  working = working.replace(/\b(?:JPN|JP|Japanese|EN|ENG|English|CN|Chinese|KR|Korean)\b/gi, " ");
  working = working.replace(/#\s*(?:C|U|R|M|E|L|SR|SEC|SCR|SP|SSP)?\s*[A-Z0-9][A-Z0-9-]{1,14}\b/gi, " ");
  working = working.replace(/\b(?:FFI|FFII|FFIII|FFIV|FFV|FFVI|FFVII|FFVIII|FFIX|FFX|FFXI|FFXII|FFXIII|FFXIV|FFXV|FFXVI)\b/gi, " ");
  working = working.replace(/\b(?:Surge\s+)?Foil\b/gi, " ");
  working = working.replace(/\b(?:Borderless|Showcase|Extended\s+Art|Alternate\s+Art|Alt\s+Art)\b/gi, " ");
  working = normalizeText(working.replace(/^[,;: -]+|[,;: -]+$/g, ""));
  if (!working || working.length < 2 || working.length > 80) return null;
  return titleCase(working);
}

export function parseReviewedTitleFields(title = {}) {
  const text = normalizeText(title);
  const productHints = productHintsFromTitle(text);
  const officialCardType = officialCardTypeFromTitle(text);
  const team = teamFromTitle(text);
  const tcgCardName = tcgCardNameFromTitle(text, productHints.product);
  const surfaceColor = surfaceColorFromTitle(stripKnownPhrase(text, productHints.product));
  const players = playersFromTitle(text, {
    product: productHints.product,
    officialCardType,
    team
  });
  const categoryHints = categoryHintsFromTitle(text, productHints.product);
  const categoryCandidates = categoryCandidatesFromTitle(text, productHints.product);
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
    category_candidates: categoryCandidates.map((candidate) => candidate.category),
    secondary_categories: categoryCandidates
      .map((candidate) => candidate.category)
      .filter((category) => category !== categoryHints.category),
    year: yearFromTitle(text),
    language: languageFromTitle(text),
    players,
    character: tcgCardName,
    card_name: tcgCardName,
    rarity: rarityFromTitle(text),
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
  if (compactFields.rarity) {
    normalized.rarity = compactFields.rarity;
  }
  if (compactFields.league) {
    normalized.league = compactFields.league;
  }
  if (compactFields.category_candidates) {
    normalized.category_candidates = compactFields.category_candidates;
  }
  if (compactFields.secondary_categories) {
    normalized.secondary_categories = compactFields.secondary_categories;
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
