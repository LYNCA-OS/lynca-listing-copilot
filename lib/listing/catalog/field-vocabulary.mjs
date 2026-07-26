// Catalog field vocabulary — pure extraction/normalisation logic.
//
// Why this exists: most cards we handle are newly released, so the catalog will
// never hold the *row* for the card in hand. What it can hold is the *legal
// vocabulary* of each field: that "Gold Shimmer Refractor" is a real Topps
// finish, that "Superior Signatures" is a real insert. Row-level retrieval
// misses new cards by construction; vocabulary does not.
//
// The 14k AUTO_PARSED_FROM_VERIFIED_TITLE rows are poor identity records (12%
// card-number coverage, player fields polluted with team names and lot markers)
// but they are the single best vocabulary source in the system: they are parsed
// from human-verified sale titles, which is where new-release wording appears
// first. Official checklists are authoritative but always lag a release.
//
// Everything here is dependency-free so it can be unit tested without a DB.

const FINISH_HEADS = [
  "refractor", "prizm", "sparkle", "shimmer", "wave", "holo", "sapphire",
  "mojo", "lava", "ice", "disco", "velocity", "scope", "hyper", "pulsar",
  "cracked ice", "foilboard", "vapor", "kaleidoscope"
];

// Words that sit next to a finish phrase in a title but belong to other SEM
// fields. Left-trimming these is what separates "Auto Blue Refractor" (an
// attribute plus a finish) from the finish itself.
const ATTRIBUTE_PREFIXES = new Set([
  "auto", "autograph", "autographed", "rc", "rookie", "1st", "first",
  "patch", "relic", "jersey", "ssp", "sp", "case", "hit", "insert",
  "base", "parallel", "variation", "numbered", "card", "cards", "lot"
]);

const COLOR_WORDS = new Set([
  "gold", "silver", "black", "red", "blue", "green", "orange", "purple",
  "pink", "aqua", "teal", "yellow", "bronze", "copper", "white", "grey",
  "gray", "rose", "amber", "emerald", "sapphire", "ruby", "onyx", "platinum"
]);

// A finish qualifier is a colour, another finish head, or a known pattern word.
// Without this, any alphabetic word before a head is swept in and the vocabulary
// fills with player names ("peyton manning lava") and article fragments ("of the
// ice"), which would then be attested as if they were real parallel names.
const PATTERN_WORDS = new Set([
  "geometric", "etched", "atomic", "speckle", "speckled", "mosaic", "mini",
  "superfractor", "xfractor", "x-fractor", "cracked", "raywave", "ray",
  "logofractor", "pulsar", "dragon", "tiger", "zebra", "snakeskin", "fluorescent",
  "neon", "rainbow", "galactic", "cosmic", "marble", "camo", "checker",
  "checkerboard", "starball", "flash", "shock", "laser", "prismatic", "reactive"
]);

export function isFinishQualifier(word = "") {
  const text = normalizeTerm(word);
  if (!text) return false;
  return COLOR_WORDS.has(text) || PATTERN_WORDS.has(text) || FINISH_HEADS.includes(text);
}

export function normalizeTerm(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9'&/\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Drop leading attribute words so the term names one field, not several.
export function trimAttributePrefix(term = "") {
  let words = normalizeTerm(term).split(" ").filter(Boolean);
  while (words.length > 1 && ATTRIBUTE_PREFIXES.has(words[0])) words = words.slice(1);
  return words.join(" ");
}

export function isFinishTerm(term = "") {
  const text = normalizeTerm(term);
  if (!text) return false;
  return FINISH_HEADS.some((head) => text === head || text.endsWith(` ${head}`));
}

// A finish phrase is the finish head plus up to two qualifying words in front
// of it ("gold geometric refractor"), once attribute words are stripped.
export function extractFinishTerms(title = "") {
  const text = normalizeTerm(title);
  if (!text) return [];
  const words = text.split(" ").filter(Boolean);
  const spans = [];
  for (let i = 0; i < words.length; i += 1) {
    for (const head of FINISH_HEADS) {
      const headWords = head.split(" ");
      const end = i + headWords.length;
      if (words.slice(i, end).join(" ") !== head) continue;
      // Only colour/pattern/finish words qualify. Card numbers sit next to the
      // finish ("#DF-3 Gold Sapphire") and so do player names ("Peyton Manning
      // Lava"); neither belongs in a parallel name.
      let start = i;
      while (start > 0 && (i - start) < 2 && isFinishQualifier(words[start - 1])) start -= 1;
      for (let from = start; from <= i; from += 1) {
        const phrase = trimAttributePrefix(words.slice(from, end).join(" "));
        if (!phrase || !isFinishTerm(phrase)) continue;
        // trimAttributePrefix may have dropped leading words; recover the real
        // span so overlap resolution below compares like with like.
        const trimmedStart = end - phrase.split(" ").length;
        spans.push({ start: trimmedStart, end, term: phrase });
        break;
      }
    }
  }
  // "Gold Shimmer Refractor" matches both `shimmer` and `refractor` as heads,
  // and a surname before a head can be swept in ("Aidan West Teal Wave" vs
  // "Teal Wave Refractor"). Those two overlap without either containing the
  // other, so resolve greedily: longest span wins, then the rightmost head,
  // and nothing overlapping an accepted span survives.
  const ordered = [...spans].sort((a, b) => (
    ((b.end - b.start) - (a.end - a.start)) || (b.end - a.end)
  ));
  const kept = [];
  for (const span of ordered) {
    if (kept.some((other) => span.start < other.end && other.start < span.end)) continue;
    kept.push(span);
  }
  return [...new Set(kept.sort((a, b) => a.start - b.start).map((span) => span.term))];
}

export function finishTermQuality(term = "") {
  const words = normalizeTerm(term).split(" ").filter(Boolean);
  if (words.length <= 1) return "head_only";
  if (COLOR_WORDS.has(words[0])) return "color_qualified";
  return "qualified";
}

export const vocabularySourceTiers = Object.freeze({
  OFFICIAL: "official_checklist",
  VERIFIED_TITLE: "verified_sale_title"
});

// Official wording outranks marketplace wording for the same term, but a term
// attested only by verified titles is still real — that is the new-release case.
export function mergeVocabularyEntries(entries = []) {
  const byTerm = new Map();
  for (const entry of entries) {
    const term = normalizeTerm(entry?.term);
    if (!term) continue;
    const field = String(entry?.field || "").trim();
    if (!field) continue;
    const key = `${field}::${term}`;
    const current = byTerm.get(key) || {
      field,
      term,
      count: 0,
      tiers: new Set(),
      years: new Set()
    };
    current.count += Number(entry.count || 1);
    if (entry.tier) current.tiers.add(entry.tier);
    for (const year of entry.years || []) if (year) current.years.add(String(year));
    byTerm.set(key, current);
  }
  return [...byTerm.values()]
    .map((entry) => ({
      field: entry.field,
      term: entry.term,
      count: entry.count,
      official: entry.tiers.has(vocabularySourceTiers.OFFICIAL),
      tiers: [...entry.tiers].sort(),
      years: [...entry.years].sort()
    }))
    .sort((a, b) => (b.count - a.count) || a.term.localeCompare(b.term));
}

// Attestation is the question the pipeline actually asks: "is this wording a
// real value for this field?" Official attestation is strongest; a marketplace
// term needs to have been seen more than once so a single typo cannot mint
// vocabulary.
export function attestTerm(vocabulary = [], field = "", value = "", { minVerifiedCount = 2 } = {}) {
  const term = trimAttributePrefix(value);
  if (!term) return { attested: false, reason: "empty_term" };
  const entry = vocabulary.find((row) => row.field === field && row.term === term);
  if (!entry) return { attested: false, reason: "not_in_vocabulary", term };
  if (entry.official) return { attested: true, strength: "official", term, count: entry.count };
  if (entry.count >= minVerifiedCount) {
    return { attested: true, strength: "verified_title", term, count: entry.count };
  }
  return { attested: false, reason: "below_verified_threshold", term, count: entry.count };
}
