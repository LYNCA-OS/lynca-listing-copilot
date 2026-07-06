function textOf(value) {
  if (Array.isArray(value)) return value.join(" ");
  return String(value || "");
}

export function classifyV4Segment(fields = {}, payload = {}) {
  const haystack = [
    textOf(fields.category),
    textOf(fields.ip),
    textOf(fields.manufacturer),
    textOf(fields.product),
    textOf(fields.set),
    textOf(fields.subject),
    textOf(fields.players),
    textOf(payload.category),
    textOf(payload.segment)
  ].join(" ").toLowerCase();

  if (/pok[eé]mon|pokemon|pikachu|charizard|scarlet|violet/.test(haystack)) return "pokemon";
  if (/yu-?gi-?oh|konami|yugioh/.test(haystack)) return "yugioh";
  if (/one piece|bandai/.test(haystack)) return "one_piece";
  if (/magic|mtg|scryfall|wizards of the coast/.test(haystack)) return "mtg";
  if (/tcg|digimon|dragon ball|lorcana|weiss|vanguard|union arena/.test(haystack)) return "generic_tcg";
  if (/basketball|nba|panini|prizm|immaculate|national treasures|jordan|lebron|wembanyama/.test(haystack)) return "basketball";
  if (/baseball|mlb|bowman|topps chrome|dodgers|yankees/.test(haystack)) return "baseball";
  if (/soccer|football club|uefa|fifa|messi|ronaldo/.test(haystack)) return "soccer";
  if (/nfl|football|quarterback|wide receiver|rookie ticket/.test(haystack)) return "football";
  if (/hockey|nhl|upper deck/.test(haystack)) return "hockey";
  return "sports";
}
