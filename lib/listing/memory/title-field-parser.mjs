import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { expandPrintRunFields, parsePrintRunValue } from "../print-run/print-run-fields.mjs";

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
  "X-Fractor",
  "XFractor",
  "Bordered",
  "Cracked Ice",
  "Geometric",
  "Hyper",
  "Ice",
  "Lava",
  "Mojo",
  "Pulsar",
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
    .replace(/\b(?:Nba|Mlb|Nfl|Mls|Ufc|Uefa|Fifa|Wwe|Rc|Fc|Cf|Usa|Ii|Iii|Iv)\b/g, (word) => word.toUpperCase())
    .replace(/\b(Jr|Sr)\b\.?/g, (word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1, 2).toLowerCase()}${word.endsWith(".") ? "." : ""}`);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSerial(value) {
  return parsePrintRunValue(value).print_run_number || "";
}

function yearFromTitle(title) {
  const match = normalizeText(title).match(/\b((?:19|20)\d{2}(?:-\d{2})?)\b/);
  return match?.[1] || null;
}

function serialFromTitle(title) {
  const sanitized = String(title || "")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s*(?:Gem\s+Mint\s+)?(?:AUTO\s*)?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\b/gi, " ")
    .replace(/\b\d+\.\d+\s*\/\s*\d+(?:\.\d+)?\b/g, " ");
  const serials = ([...sanitized.matchAll(/(?:^|[\s#])0*(\d+)\s*\/\s*0*(\d+)\b/g)] || [])
    .map((match) => normalizeSerial(`${match[1]}/${match[2]}`))
    .filter(Boolean);
  return serials.at(-1) || null;
}

function serialDenominatorFromTitle(title) {
  const full = serialFromTitle(title)?.split("/")?.[1];
  if (full) return full;
  const sanitized = String(title || "")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s*(?:Gem\s+Mint\s+)?(?:AUTO\s*)?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\b/gi, " ")
    .replace(/\b\d+\.\d+\s*\/\s*\d+(?:\.\d+)?\b/g, " ");
  const denomOnly = normalizeText(sanitized).match(/(?:^|\s)#?\s*\/\s*0*(\d+)\b/i);
  return denomOnly ? String(Number(denomOnly[1])) : null;
}

function collectorNumberFromTitle(title) {
  const text = normalizeText(title);
  const rarityNumber = text.match(/#\s*(C|U|R|M|E|L|SR|SEC|SCR|SP|SSP)\s+([A-Z0-9][A-Z0-9-]{1,14})\b/i);
  if (rarityNumber) return rarityNumber[2].toUpperCase();
  const matches = [...text.matchAll(/#\s*([A-Z0-9][A-Z0-9-]{0,14})\b(?!\s*\/)/gi)]
    .map((match) => match[1].toUpperCase())
    .filter((value) => !/^\d{4}$/.test(value));
  return matches.at(-1) || null;
}

function tcgCardNumberFromTitle(title) {
  const text = normalizeText(title).toUpperCase();
  const match = text.match(/\b(?:OP|EB|ST|BT|EX|FB|UA|SV|SWSH|SM|XY|CORI|TAEV|LOB|MRD|PSV|IOC|CRV)[A-Z0-9-]*-\d{3,4}\b/);
  return match?.[0] || null;
}

function gradeFromTitle(title) {
  const dualMatch = normalizeText(title).match(/\b(BGS|Beckett)\s+(?:Gem\s+Mint\s+)?(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\b/i);
  if (dualMatch) {
    return {
      grade_company: "BGS",
      card_grade: dualMatch[2],
      auto_grade: dualMatch[3],
      grade_type: "CARD_AND_AUTO"
    };
  }
  const match = normalizeText(title).match(/\b(PSA|BGS|SGC|CGC|Beckett)\s*(?:Gem\s+Mint\s+)?(AUTO\s*)?(\d+(?:\.\d+)?)\b/i);
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
  "Donruss": "Panini Donruss",
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
  "Panini Contenders": "Panini Contenders",
  "Panini Prizm World Cup": "Panini Prizm FIFA World Cup",
  "Prizm World Cup": "Panini Prizm FIFA World Cup",
  "Status": "Panini Status",
  "Luminance": "Panini Luminance",
  "Phoenix": "Panini Phoenix",
  "XR": "Panini XR",
  "Origins": "Panini Origins",
  "Crown Royale": "Panini Crown Royale",
  "Revolution": "Panini Revolution",
  "Court Kings": "Panini Court Kings",
  "Photogenic": "Panini Photogenic",
  "Chronicles": "Panini Chronicles",
  "Elite": "Panini Elite",
  "Zenith": "Panini Zenith",
  "MVP Hockey": "Upper Deck MVP Hockey",
  "UD Marvel Masterpieces": "Upper Deck Marvel Masterpieces",
  "Marvel Masterpieces": "Upper Deck Marvel Masterpieces",
  "Marvel Beginnings": "Upper Deck Marvel Beginnings",
  "Topps Star Wars Masterwork": "Topps Star Wars Masterwork",
  "Topps Star Wars Meiyo": "Topps Star Wars Meiyo",
  "Topps Royalty": "Topps Royalty Tennis",
  "Topps Argentina Team Set": "Topps Argentina Team Set",
  "Topps Jade Edition UEFA": "Topps Jade Edition UEFA",
  "Topps Superstars UEFA": "Topps Superstars UEFA",
  "Topps Manchester United": "Topps Manchester United",
  "Topps Knockout UEFA": "Topps Knockout UEFA",
  "Topps Star Wars Chrome Sapphire": "Topps Star Wars Chrome Sapphire",
  "Topps Motif": "Topps Motif",
  "Topps Lights Out F1": "Topps Lights Out F1",
  "Finest": "Topps Finest",
  "Panini Donruss": "Panini Donruss",
  "Panini The National VIP Gold Pack": "Panini The National VIP Gold Pack",
  "Panini Silhouette": "Panini Silhouette",
  "Panini Instant": "Panini Instant",
  "Panini Treble": "Panini Treble",
  "Panini Boys Of Summer": "Panini Boys of Summer",
  "Panini Prestige": "Panini Prestige",
  "Panini Immaculte": "Panini Immaculate",
  "Panini Immaculaate": "Panini Immaculate",
  "Panini One": "Panini One",
  "Panini Studio": "Panini Studio",
  "Panini Basketball": "Panini Basketball",
  "Panini Authentically Mahomes": "Panini Authentically Mahomes",
  "Upper Deck Allure": "Upper Deck Allure",
  "Upper Deck SP Authentic": "Upper Deck SP Authentic",
  "Upper Deck SPx": "Upper Deck SPx",
  "Upper Deck SP Edition": "Upper Deck SP Edition",
  "Upper Deck Series 2": "Upper Deck Series 2",
  "Upper Deck Clear Cut": "Upper Deck Clear Cut",
  "Upper Deck Choice": "Upper Deck Choice",
  "Upper Deck Dual Game Materials": "Upper Deck Dual Game Materials",
  "Upper Deck Fleer": "Upper Deck Fleer",
  "Upper Deck Marvel Renditions": "Upper Deck Marvel Renditions",
  "UD Marvel Renditions": "Upper Deck Marvel Renditions",
  "Upper Deck Marvel Allegiance Secret Wars": "Upper Deck Marvel Allegiance Secret Wars",
  "UD Marvel Allegiance Secret Wars": "Upper Deck Marvel Allegiance Secret Wars",
  "Upper Deck Marvel Multiverse Madness": "Upper Deck Marvel Multiverse Madness",
  "UD Marvel Multiverse Madness": "Upper Deck Marvel Multiverse Madness",
  "Upper Deck Marvel Allegiance Avengers Vs X-Men": "Upper Deck Marvel Allegiance Avengers vs X-Men",
  "Allegiance: Avengers Vs X-men": "Upper Deck Marvel Allegiance Avengers vs X-Men",
  "Upper Deck The Cup Hockey": "Upper Deck The Cup Hockey",
  "Upper Deck The Cup": "Upper Deck The Cup",
  "Upper Deck NBA SP Edition": "Upper Deck SP Edition",
  "CZX Crisis On Infinite Earths": "Cryptozoic CZX Crisis on Infinite Earths",
  "Kakawow Disney Aura": "Kakawow Disney Aura",
  "Kakawow Aura Disney": "Kakawow Disney Aura",
  "Kakawow Disney Cosmos": "Kakawow Disney Cosmos",
  "Kakawow Cosmos Disney": "Kakawow Disney Cosmos",
  "Kakawow Disney": "Kakawow Disney"
});

function canonicalProductName(value = "") {
  const normalized = normalizeText(value);
  if (/^(?:UD|Upper\s+Deck)\s+Marvel\b.*\bMultiverse\s+Madness\b/i.test(normalized)) return "Upper Deck Marvel Multiverse Madness";
  if (/^CZX\s+Crisis\s+on\s+Infinite\s+Earths\b/i.test(normalized)) return "Cryptozoic CZX Crisis on Infinite Earths";
  return canonicalProductAliases[normalized] || normalized;
}

function inferPublisherFromProduct(product = "") {
  const normalized = normalizeText(product);
  if (!normalized) return {};
  if (/^Bowman\b/i.test(normalized)) return { manufacturer: "Topps", brand: "Bowman" };
  if (/^Topps\b/i.test(normalized)) return { manufacturer: "Topps", brand: "Topps" };
  if (/^Panini\b/i.test(normalized)) return { manufacturer: "Panini", brand: "Panini" };
  if (/^(?:Upper\s+Deck|O-?Pee-?Chee|SkyBox|UD)\b/i.test(normalized)) return { manufacturer: "Upper Deck", brand: "Upper Deck" };
  if (/^Fleer\b/i.test(normalized)) return { manufacturer: "Fleer", brand: "Fleer" };
  if (/^Donruss\b/i.test(normalized)) return { manufacturer: "Panini", brand: "Donruss" };
  if (/^Leaf\b/i.test(normalized)) return { manufacturer: "Leaf", brand: "Leaf" };
  if (/^Kakawow\b/i.test(normalized)) return { manufacturer: "Kakawow", brand: "Kakawow" };
  if (/^Magic:?\s+The\s+Gathering\b/i.test(normalized)) return { manufacturer: "Wizards of the Coast", brand: "Magic: The Gathering" };
  if (/^Pokemon\b/i.test(normalized)) return { manufacturer: "Pokemon", brand: "Pokemon" };
  return {};
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
    /\bTopps\s+Star\s+Wars\s+Masterwork\b/i,
    /\bTopps\s+Star\s+Wars\s+Meiyo\b/i,
    /\bTopps\s+Royalty\b/i,
    /\bTopps\s+Argentina\s+Team\s+Set\b/i,
    /\bTopps\s+Jade\s+Edition\s+UEFA\b/i,
    /\bTopps\s+Superstars\s+UEFA\b/i,
    /\bTopps\s+Manchester\s+United\b/i,
    /\bTopps\s+Knockout\s+UEFA\b/i,
    /\bTopps\s+Star\s+Wars\s+Chrome\s+Sapphire\b/i,
    /\bTopps\s+Motif\b/i,
    /\bTopps\s+Lights\s+Out\s+F1\b/i,
    /\bPanini\s+Prizm\s+Deca\b/i,
    /\bPanini\s+Prizm\s+(?:FIFA\s+)?World\s+Cup\b/i,
    /\bPrizm\s+(?:FIFA\s+)?World\s+Cup\b/i,
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
    /\bPanini\s+The\s+National\s+VIP\s+Gold\s+Pack\b/i,
    /\bPanini\s+Silhouette\b/i,
    /\bPanini\s+Instant\b/i,
    /\bPanini\s+Treble\b/i,
    /\bPanini\s+Boys\s+Of\s+Summer\b/i,
    /\bPanini\s+Prestige\b/i,
    /\bPanini\s+Immaculte\b/i,
    /\bPanini\s+Immaculaate\b/i,
    /\bPanini\s+One\b/i,
    /\bPanini\s+Studio\b/i,
    /\bPanini\s+Basketball\b/i,
    /\bPanini\s+Authentically\s+Mahomes\b/i,
    /\bPanini\s+National\s+Treasures\b/i,
    /\bPanini\s+Contenders\s+Optic\b/i,
    /\bPanini\s+Donruss\s+Optic\b/i,
    /\bPanini\s+Clearly\s+Donruss\b/i,
    /\bPanini\s+Donruss\b/i,
    /\bPanini\s+Court\s+Kings\b/i,
    /\bPanini\s+Crown\s+Royale\b/i,
    /\bPanini\s+Revolution\b/i,
    /\bPanini\s+Photogenic\b/i,
    /\bPanini\s+Chronicles\b/i,
    /\bPanini\s+Luminance\b/i,
    /\bPanini\s+Phoenix\b/i,
    /\bPanini\s+Origins\b/i,
    /\bPanini\s+Status\b/i,
    /\bPanini\s+Eminence\b/i,
    /\bPanini\s+Encased\b/i,
    /\bPanini\s+Elite\b/i,
    /\bPanini\s+Zenith\b/i,
    /\bPanini\s+XR\b/i,
    /\bDonruss\s+Elite\b/i,
    /\bDonruss\b/i,
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
    /\bStatus\b/i,
    /\bLuminance\b/i,
    /\bPhoenix\b/i,
    /\bOrigins\b/i,
    /\bCrown\s+Royale\b/i,
    /\bRevolution\b/i,
    /\bCourt\s+Kings\b/i,
    /\bPhotogenic\b/i,
    /\bChronicles\b/i,
    /\bZenith\b/i,
    /\bXR\b/i,
    /\bDefinitive\b/i,
    /\bFinest\b/i,
    /\bFinest\s+Flashbacks\b/i,
    /\bFinest\s+UCL\b/i,
    /\bUpper\s+Deck\s+Sweet\s+Shot\b/i,
    /\bUpper\s+Deck\s+Draft\s+Edition\b/i,
    /\bUpper\s+Deck\s+MJx\b/i,
    /\bUpper\s+Deck\s+SP\s+Authentic\b/i,
    /\bUpper\s+Deck\s+SPx\b/i,
    /\bUpper\s+Deck\s+SP\s+Edition\b/i,
    /\bUpper\s+Deck\s+NBA\s+SP\s+Edition\b/i,
    /\bUpper\s+Deck\s+Series\s+2\b/i,
    /\bUpper\s+Deck\s+Clear\s+Cut\b/i,
    /\bUpper\s+Deck\s+Allure\b/i,
    /\bUpper\s+Deck\s+Choice\b/i,
    /\bUpper\s+Deck\s+The\s+Cup\s+Hockey\b/i,
    /\bUpper\s+Deck\s+The\s+Cup\b/i,
    /\bUpper\s+Deck\s+Dual\s+Game\s+Materials\b/i,
    /\bUpper\s+Deck\s+Fleer\b/i,
    /\bUD\s+Marvel\s+Masterpieces\b/i,
    /\bUD\s+Marvel\s+Renditions\b/i,
    /\bUpper\s+Deck\s+Marvel\s+Renditions\b/i,
    /\bUD\s+Marvel\s+Allegiance\s+Secret\s+Wars\b/i,
    /\bUpper\s+Deck\s+Marvel\s+Allegiance\s+Secret\s+Wars\b/i,
    /\bUD\s+Marvel\s+Multiverse\s+Madness\b/i,
    /\bUpper\s+Deck\s+Marvel\s+Multiverse\s+Madness\b/i,
    /\bUD\s+Marvel\s+.+?\s+Multiverse\s+Madness\b/i,
    /\bUpper\s+Deck\s+Marvel\s+.+?\s+Multiverse\s+Madness\b/i,
    /\bAllegiance:\s+Avengers\s+Vs\s+X-?men\b/i,
    /\bCZX\s+Crisis\s+on\s+Infinite\s+Earths\b/i,
    /\bUpper\s+Deck\s+Marvel\s+Masterpieces\b/i,
    /\bMarvel\s+Masterpieces\b/i,
    /\bUpper\s+Deck\s+Marvel\s+Beginnings\b/i,
    /\bMarvel\s+Beginnings\b/i,
    /\bUpper\s+Deck\s+MVP\s+Hockey\b/i,
    /\bMVP\s+Hockey\b/i,
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
    /\bKakawow\s+Aura\s+Disney\b/i,
    /\bKakawow\s+Cosmos\s+Disney\b/i,
    /\bKakawow\s+Disney\b/i,
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
  let product = productPatterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  if (!product && /\bBowman\b/i.test(text) && /\bSpotlights?\s+Chrome\b/i.test(text)) {
    product = "Bowman Chrome";
  } else if (product && /^Bowman$/i.test(product) && /\bChrome\b/i.test(text)) {
    product = "Bowman Chrome";
  }
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

  const inferredPublisher = inferPublisherFromProduct(hints.product);
  if (inferredPublisher.manufacturer) hints.manufacturer = inferredPublisher.manufacturer;
  if (inferredPublisher.brand) hints.brand = inferredPublisher.brand;
  return hints;
}

function teamFromTitle(title) {
  const text = normalizeText(title);
  if (/\b(?:Final\s+Fantasy\s+MTG|Magic:?\s+The\s+Gathering|Pokemon|Pok[eé]mon|Yu-?Gi-?Oh!?|One\s+Piece|Lorcana|Dragon\s+Ball|Digimon|Union\s+Arena|Battle\s+Spirits|Disney|Marvel|Star\s+Wars|Kakawow|The\s+Monsters|Labubu)\b/i.test(text)) {
    return null;
  }
  const teamPatterns = [
    /\b(?:Los Angeles|LA)\s+Lakers\b/i,
    /\bGolden\s+State\s+Warriors\b/i,
    /\bBoston\s+Celtics\b/i,
    /\bNew\s+York\s+Knicks\b/i,
    /\bPhiladelphia\s+76ers\b/i,
    /\bSan\s+Antonio\s+Spurs\b/i,
    /\bDallas\s+Mavericks\b/i,
    /\bChicago\s+Bulls\b/i,
    /\bMemphis\s+Grizzlies\b/i,
    /\bAtlanta\s+Hawks\b/i,
    /\bMilwaukee\s+Bucks\b/i,
    /\bHouston\s+Rockets\b/i,
    /\bCleveland\s+Cavaliers\b/i,
    /\bMinnesota\s+Timberwolves\b/i,
    /\bDetroit\s+Pistons\b/i,
    /\bSacramento\s+Kings\b/i,
    /\bBrooklyn\s+Nets\b/i,
    /\bIndiana\s+Pacers\b/i,
    /\bNew\s+Orleans\s+Pelicans\b/i,
    /\bWashington\s+Wizards\b/i,
    /\bUtah\s+Jazz\b/i,
    /\bPortland\s+Trail\s+Blazers\b/i,
    /\bToronto\s+Raptors\b/i,
    /\bMiami\s+Heat\b/i,
    /\bNew\s+York\s+Mets\b/i,
    /\bLos\s+Angeles\s+Dodgers\b/i,
    /\bMilwaukee\s+Brewers\b/i,
    /\bSan\s+Diego\s+Padres\b/i,
    /\bPhiladelphia\s+Phillies\b/i,
    /\bBoston\s+Red\s+Sox\b/i,
    /\bChicago\s+Cubs\b/i,
    /\bBaltimore\s+Orioles\b/i,
    /\bCincinnati\s+Reds\b/i,
    /\bPittsburgh\s+Pirates\b/i,
    /\bSeattle\s+Mariners\b/i,
    /\bKansas\s+City\s+Royals\b/i,
    /\bDetroit\s+Tigers\b/i,
    /\bTexas\s+Rangers\b/i,
    /\bLos\s+Angeles\s+Angels\b/i,
    /\bHouston\s+Astros\b/i,
    /\bToronto\s+Blue\s+Jays\b/i,
    /\bAtlanta\s+Braves\b/i,
    /\bChicago\s+White\s+Sox\b/i,
    /\bNew\s+York\s+Yankees\b/i,
    /\bDallas\s+Cowboys\b/i,
    /\bKansas\s+City\s+Chiefs\b/i,
    /\bGreen\s+Bay\s+Packers\b/i,
    /\bPittsburgh\s+Steelers\b/i,
    /\bPhiladelphia\s+Eagles\b/i,
    /\bDenver\s+Broncos\b/i,
    /\bSan\s+Francisco\s+49ers\b/i,
    /\bLos\s+Angeles\s+Rams\b/i,
    /\bMinnesota\s+Vikings\b/i,
    /\bDetroit\s+Lions\b/i,
    /\bHouston\s+Texans\b/i,
    /\bIndianapolis\s+Colts\b/i,
    /\bLos\s+Angeles\s+Chargers\b/i,
    /\bNew\s+Orleans\s+Saints\b/i,
    /\bWashington\s+Commanders\b/i,
    /\bCarolina\s+Panthers\b/i,
    /\bBaltimore\s+Ravens\b/i,
    /\bChicago\s+Bears\b/i,
    /\bJacksonville\s+Jaguars\b/i,
    /\bSeattle\s+Seahawks\b/i,
    /\bAtlanta\s+Falcons\b/i,
    /\bMiami\s+Dolphins\b/i,
    /\bNew\s+York\s+Jets\b/i,
    /\bCincinnati\s+Bengals\b/i,
    /\bCleveland\s+Browns\b/i,
    /\bNew\s+England\s+Patriots\b/i,
    /\b(?:Tampa\s+Bay\s+)?Buccaneers\b/i,
    /\bLas\s+Vegas\s+Raiders\b/i,
    /\bFC\s+Barcelona\b/i,
    /\bBayern\s+Munich\b/i,
    /\bReal\s+Madrid\b/i,
    /\bParis\s+Saint-?Germain\b/i,
    /\bInter\s+Miami\s+CF\b/i,
    /\bManchester\s+(?:United|City)\b/i,
    /\b(?:Grizzlies|Hawks|Chiefs|Brewers|Warriors|Bulls|Lakers|Celtics|Knicks|Spurs|Mavericks|Heat|Suns|Magic|Hornets|Thunder|Nuggets|Clippers|Nets|Pacers|Pelicans|Wizards|Jazz|Raptors|Bucks|Rockets|Cavaliers|Timberwolves|Pistons|Kings|Cowboys|Patriots|Bills|Raiders|Packers|Steelers|Eagles|Broncos|49ers|Rams|Vikings|Lions|Texans|Titans|Colts|Chargers|Saints|Commanders|Panthers|Ravens|Bears|Jaguars|Seahawks|Falcons|Dolphins|Jets|Bengals|Browns|Dodgers|Yankees|Mets|Padres|Phillies|Cubs|Orioles|Reds|Pirates|Mariners|Royals|Tigers|Rangers|Angels|Astros|Braves)\b/i,
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

function parallelFamilyFromTitle(title) {
  const text = normalizeText(title);
  const suffixes = [...parallelSuffixes]
    .sort((left, right) => right.length - left.length)
    .map((suffix) => escapeRegExp(suffix).replace(/\s+/g, "\\s+"))
    .join("|");
  const matches = [...text.matchAll(new RegExp(`\\b(?:(Common)\\s+)?(${suffixes})(?:[-\\s]+(${suffixes}))?\\b`, "gi"))];
  const match = matches.at(-1);
  if (!match) return null;
  return titleCase([match[1], match[2], match[3]].filter(Boolean).join(" "))
    .replace(/\bXfractor\b/g, "X-Fractor");
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
    "New Breed",
    "Choice Nebula",
    "NFL Shield",
    "Luxury Platinum Bar",
    "Spotlights Chrome",
    "Spotlight",
    "Signatures Breakaway",
    "Breakaway Gold",
    "The Beautiful Game",
    "Future Watch",
    "Die-cut",
    "Game-Worn",
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

function stripMarketplaceQuantityTerms(text = "") {
  return normalizeText(String(text || "")
    .replace(/\b(?:lot|lots|qty|quantity|bundle)\s*(?:of\s*)?(?:x|\*)?\s*\d+\b/gi, " ")
    .replace(/\b(?:x|\*)\s*\d+\b/gi, " ")
    .replace(/\b\d+\s*(?:x|pcs|ct|count)\b/gi, " ")
    .replace(/\bset\s+of\s+\d+\b/gi, " "));
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
    "common",
    "new",
    "breed",
    "insert",
    "variation",
    "parallel",
    "prizm",
    "refractor",
    "wave",
    "shimmer",
    "mojo",
    "lava",
    "pulsar",
    "ice",
    "disco",
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
    "fotl",
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
    "world",
    "cup",
    "uefa",
    "ucc",
    "nba",
    "nfl",
    "choice",
    "nebula",
    "shield",
    "luxury",
    "platinum",
    "bar",
    "rainbow",
    "dragon",
    "jumbo",
    "game",
    "worn",
    "beautiful",
    "future",
    "watch",
    "die",
    "cut",
    "spotlights",
    "spotlight",
    "breakaway",
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
    "kakawow",
    "cosmos",
    "aura",
    "disney",
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
    "status",
    "encased",
    "flawless",
    "mosaic",
    "eminence",
    "treasures",
    "national",
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

function knownMononymSubjects() {
  return new Set(["pele", "pelé", "neymar", "messi"]);
}

function maybeSubjectChunk(chunk = "") {
  const cleaned = normalizeText(chunk
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
    .replace(/\b(?:and|with|featuring|feat)\b/gi, " "));
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return "";
  const stopWords = subjectStopWords();
  const nameWords = words.filter((word) => {
    const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!normalized) return false;
    if (stopWords.has(normalized)) return false;
    return /^[a-z][a-z'.-]*$/i.test(word);
  });
  if (nameWords.length < 2) {
    const mono = nameWords[0]?.toLowerCase();
    if (!mono || !knownMononymSubjects().has(mono)) return "";
  }
  return titleCase(nameWords.join(" "));
}

function playersFromTitle(title, {
  product = "",
  officialCardType = "",
  team = ""
} = {}) {
  let text = normalizeText(title);
  text = stripMarketplaceQuantityTerms(text);
  text = text
    .replace(/\b\d{4}(?:-\d{2})?\b/g, " ")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s*(?:Gem\s+Mint\s+)?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s*(?:Gem\s+Mint\s+)?(?:AUTO\s*)?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/#\s*\/\s*\d+\b/g, " ")
    .replace(/#\s*[A-Z0-9][A-Z0-9-]{0,18}\b(?!\s*\/)/gi, " ")
    .replace(/\b[A-Z]{1,5}-[A-Z0-9]{1,8}\b/g, " ")
    .replace(/\bCert(?:ificate)?\s*#?\s*[A-Z0-9-]+\b/gi, " ");
  text = stripKnownPhrase(text, product);
  text = stripKnownPhrase(text, officialCardType);
  text = stripKnownPhrase(text, team);
  for (const color of colorWords) text = stripKnownPhrase(text, color);
  for (const suffix of parallelSuffixes) text = stripKnownPhrase(text, suffix);
  text = normalizeText(text.replace(/[()]/g, " ").replace(/\s+-\s+/g, " / "));

  const stopWords = subjectStopWords();
  const delimitered = text.split(/\s+/).map((word) => {
    const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
    return stopWords.has(normalized) ? " / " : word;
  }).join(" ");
  const slashSplit = delimitered.split(/\s+(?:\/|&|\+|and)\s+/i).map(maybeSubjectChunk).filter(Boolean);
  if (slashSplit.length >= 1) return unique(slashSplit);

  const single = maybeSubjectChunk(text);
  return single ? [single] : [];
}

function categoryHintsFromTitle(title, product = "") {
  const haystack = `${title} ${product}`;
  if (/\b(?:Final\s+Fantasy\s+MTG|Magic:?\s+The\s+Gathering|MTG|Pokemon|Pok[eé]mon|Yu-?Gi-?Oh!?|One\s+Piece|Lorcana|Dragon\s+Ball|Digimon|Union\s+Arena|Battle\s+Spirits)\b/i.test(haystack)) {
    return { category: "tcg", sport: "tcg" };
  }
  if (/\b(?:Marvel|Star\s+Wars|Disney|Minecraft|VeeFriends|Labubu|How2Work|The\s+Monsters|Kakawow)\b/i.test(haystack)) {
    return { category: "non_sports", sport: "non_sports" };
  }
  if (/\b(?:CZX|Cryptozoic|Crisis\s+on\s+Infinite\s+Earths)\b/i.test(haystack)) {
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
  if (/\b(?:Upper\s+Deck\s+SP\s+Authentic|Future\s+Watch|Upper\s+Deck\s+Series\s+2|Upper\s+Deck\s+Clear\s+Cut|Upper\s+Deck\s+Allure)\b/i.test(haystack)) {
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
  if (/\b(?:FIFA|UEFA|MLS|Soccer|World\s+Cup|Club Legends|FC\s+Barcelona|Pel[eé])\b/i.test(haystack)) {
    return { category: "soccer", sport: "soccer" };
  }
  if (/\bThe\s+Beautiful\s+Game\b/i.test(haystack)) {
    return { category: "soccer", sport: "soccer" };
  }
  if (/\b(?:Panini\s+Treble|Topps\s+Jade\s+Edition\s+UEFA|Topps\s+Superstars\s+UEFA|Topps\s+Manchester\s+United|Topps\s+Knockout\s+UEFA)\b/i.test(haystack)) {
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
  if (/\b(?:LeBron\s+James|Lebron\s+James|Anthony\s+Edwards|Stephen\s+Curry|Trae\s+Young|Jaren\s+Jackson|Caitlin\s+Clark)\b/i.test(haystack)) {
    return { category: "basketball", sport: "basketball", league: "NBA" };
  }
  if (/\b(?:MLB|Baseball|Bowman|Topps Chrome Baseball|Topps Heritage|Topps Series 2)\b/i.test(haystack)) {
    return { category: "baseball", sport: "baseball" };
  }
  if (/\bPanini\s+Boys\s+Of\s+Summer\b/i.test(haystack)) {
    return { category: "baseball", sport: "baseball" };
  }
  if (/\b(?:Shohei\s+Ohtani|Yoshinobu\s+Yamamoto|Roki\s+Sasaki|Jesus\s+Made|Mike\s+Trout|Aaron\s+Judge)\b/i.test(haystack)) {
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
  working = stripMarketplaceQuantityTerms(working);
  working = stripKnownPhrase(working, product);
  working = working.replace(/\bFinal\s+Fantasy\s+MTG\b/i, " ");
  working = working.replace(/\bMagic:?\s+The\s+Gathering\b/i, " ");
  working = working.replace(/\b(?:JPN|JP|Japanese|EN|ENG|English|CN|Chinese|KR|Korean)\b/gi, " ");
  working = working.replace(/#\s*(?:C|U|R|M|E|L|SR|SEC|SCR|SP|SSP)?\s*[A-Z0-9][A-Z0-9-]{1,14}\b/gi, " ");
  working = working.replace(/\b\d{3,6}\b/g, " ");
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
  const parallelFamily = parallelFamilyFromTitle(stripKnownPhrase(text, productHints.product));
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
  const printRun = expandPrintRunFields({
    print_run_number: serialFromTitle(text) || (/\bOne\s+of\s+One\b/i.test(text) ? "1/1" : null),
    serial_denominator: serialDenominatorFromTitle(text)
  });
  const tcgCardNumber = tcgCardNumberFromTitle(text);
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
    ...printRun,
    serial_number: printRun.serial_number || null,
    serial_denominator: printRun.serial_denominator || null,
    collector_number: collectorNumberFromTitle(text),
    card_number: collectorNumberFromTitle(text),
    tcg_card_number: tcgCardNumber,
    checklist_code: tcgCardNumber || null,
    team,
    official_card_type: officialCardType,
    observable_components: observableComponents,
    surface_color: surfaceColor,
    parallel_family: parallelFamily,
    ...gradeFromTitle(text),
    rc: observableComponents.includes("rc"),
    first_bowman: /\b(?:1st|First)\s+Bowman\b/i.test(text),
    auto: observableComponents.includes("auto"),
    patch: observableComponents.includes("patch"),
    relic: observableComponents.includes("relic"),
    jersey: observableComponents.includes("jersey"),
    sketch: observableComponents.includes("sketch"),
    redemption: observableComponents.includes("redemption"),
    one_of_one: printRun.one_of_one === true || /\b(?:0*1\s*\/\s*0*1|one\s+of\s+one)\b/i.test(text)
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
