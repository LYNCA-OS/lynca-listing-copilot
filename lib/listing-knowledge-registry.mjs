const registryEntries = [
  { label: "Kaboom", aliases: ["Kaboom", "Kaboom!"] },
  { label: "Ultraviolet", aliases: ["Ultraviolet"], codePrefixes: ["UV"] },
  { label: "Shadow Etch", aliases: ["Shadow Etch"], codePrefixes: ["SE"] },
  { label: "Helix", aliases: ["Helix"] },
  { label: "Future Script", aliases: ["Future Script"] },
  { label: "Imperial Ink", aliases: ["Imperial Ink"], codePrefixes: ["IMP"] },
  { label: "Regalia Relics", aliases: ["Regalia Relics"] },
  { label: "All-Star Game", aliases: ["All-Star Game", "All Star Game"] },
  { label: "Power Partnership", aliases: ["Power Partnership"] },
  { label: "Bowman Rookie Refresh", aliases: ["Bowman Rookie Refresh", "Rookie Refresh"], codePrefixes: ["BRR"] },
  { label: "Fantasma", aliases: ["Fantasma"] },
  { label: "Cactus Jack", aliases: ["Cactus Jack"] },
  { label: "Finest Autographs", aliases: ["Finest Autographs"] },
  { label: "Finest Performance", aliases: ["Finest Performance"] },
  { label: "Chrome Autograph Variation", aliases: ["Chrome Autograph Variation"] },
  { label: "Chrome Rookie Auto", aliases: ["Chrome Rookie Auto"], codePrefixes: ["TCAR"] },
  { label: "Variation", aliases: ["Variation"] },
  { label: "Topps Cosmic Chrome", aliases: ["Topps Cosmic Chrome", "Topps Chrome Cosmic", "Cosmic Chrome"] },
  { label: "Red Propulsion", aliases: ["Red Propulsion"] },
  { label: "Propulsion", aliases: ["Propulsion"] },
  { label: "Black Refractor", aliases: ["Black Refractor"] },
  { label: "Green Geometric Refractor", aliases: ["Green Geometric Refractor"] },
  { label: "Downtown", aliases: ["Downtown"] },
  { label: "Explosive", aliases: ["Explosive"] },
  { label: "Color Blast", aliases: ["Color Blast"] },
  { label: "Stained Glass", aliases: ["Stained Glass"] },
  { label: "Manga", aliases: ["Manga"] },
  { label: "1st Bowman Auto", aliases: ["1st Bowman Auto", "First Bowman Auto"] },
  { label: "Gold Wave Refractor", aliases: ["Gold Wave Refractor"] },
  { label: "Blue Wave Refractor", aliases: ["Blue Wave Refractor"] },
  { label: "Royalty Autographs", aliases: ["Royalty Autographs"] },
  { label: "Keapsake Premiere Edition", aliases: ["Keapsake Premiere Edition", "Keepsake Premiere Edition"] },
  { label: "Galactic", aliases: ["Galactic"] },
  { label: "Blank Slate", aliases: ["Blank Slate"] },
  { label: "Night Moves", aliases: ["Night Moves"] },
  { label: "Permit to Dominate", aliases: ["Permit to Dominate"] },
  { label: "Net Marvels", aliases: ["Net Marvels"] },
  { label: "Aurora", aliases: ["Aurora"] },
  { label: "In Motion", aliases: ["In Motion"] },
  { label: "Micro Mosaic", aliases: ["Micro Mosaic"] },
  { label: "Zebra", aliases: ["Zebra"] },
  { label: "Tiger", aliases: ["Tiger"] },
  { label: "Elephant", aliases: ["Elephant"] },
  { label: "Gold Vinyl", aliases: ["Gold Vinyl"] },
  { label: "Black Pandora", aliases: ["Black Pandora"] },
  { label: "Genesis", aliases: ["Genesis"] },
  { label: "SSP", aliases: ["SSP", "Super Short Print", "Short Print", "Case Hit"] },
  { label: "Dual Signatures", aliases: ["Dual Signatures", "Dual Signatures Jersey No."] },
  { label: "Duo Logoman Autographs", aliases: ["Duo Logoman Autographs", "Duo Logoman Auto", "Dual Rookie Logoman Auto"] },
  { label: "Star Swatch Signatures", aliases: ["Star Swatch Signatures"], codePrefixes: ["SR"] },
  { label: "Platinum", aliases: ["Platinum"] }
];

export const listingKnowledgeRegistry = registryEntries.map((entry) => ({
  ...entry,
  type: "insert",
  highValue: true
}));

export const highValueInsertTerms = listingKnowledgeRegistry.map((entry) => entry.label);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasMatches(text, alias) {
  return new RegExp(`\\b${escapedPattern(alias)}\\b`, "i").test(text);
}

function codePrefixMatches(value, prefix) {
  const code = String(value || "").toUpperCase();
  return new RegExp(`(^|\\b)${escapedPattern(prefix.toUpperCase())}[- ][A-Z0-9]+\\b`).test(code);
}

export function resolveKnowledgeEntry(value) {
  const text = String(value || "");
  if (!text.trim()) return null;

  return listingKnowledgeRegistry.find((entry) => {
    const aliasHit = entry.aliases.some((alias) => aliasMatches(text, alias));
    const codeHit = (entry.codePrefixes || []).some((prefix) => codePrefixMatches(text, prefix));
    return aliasHit || codeHit;
  }) || null;
}

export function resolveKnowledgeFromFields(fields = {}) {
  const sources = [
    fields.insert,
    fields.parallel,
    fields.card_number,
    fields.subset,
    fields.set,
    fields.product,
    fields.brand
  ];

  return sources
    .map(resolveKnowledgeEntry)
    .find(Boolean) || null;
}

export function isRegistryInsert(value) {
  return Boolean(resolveKnowledgeEntry(value));
}

export function registryPromptSummary() {
  const codeLines = listingKnowledgeRegistry
    .filter((entry) => entry.codePrefixes?.length)
    .map((entry) => `${entry.codePrefixes.join("/")} -> ${entry.label}`);

  return [
    "Listing Knowledge Registry V2:",
    `High-value insert/case-hit terms: ${highValueInsertTerms.join(", ")}.`,
    `Card code prefixes: ${codeLines.join("; ")}.`,
    "Use registry terms as insert/case-hit identity, not ordinary parallel identity.",
    "Use registry evidence from explicit text, card code, insert title text, or obvious product text."
  ].join("\n");
}

export function hasComplexVisualParallelRisk(value) {
  const text = normalizeText(value);
  if (!text) return false;

  return [
    "geometric",
    "mosaic",
    "sapphire",
    "mojo",
    "wave",
    "shimmer"
  ].some((term) => text.includes(term));
}
