// Match a card to one we have already named, without an embedding model.
//
// The plan was to replace the Cloud Run image-embedding worker with a text
// embedding into pgvector. Measuring first made that unnecessary.
//
// What the worker was actually doing: 3,659 calls, 3.5s each, searching an
// index holding 587 rows last written on 2026-07-06, returning zero candidates
// 92.7% of the time. There is nothing there to migrate.
//
// What the replacement needs to survive is spelling drift, because the same
// asset re-recognised within one hour produces the same identity string only
// 50.3% of the time -- `luka dončić` and `luka donči`, `dan marino` and
// `dan marino teal dolphins` are the same card named twice, an hour apart, by
// the same code.
//
// Trigram similarity handles exactly that, and it is already installed
// (pg_trgm 1.6). Measured over 3,345 same-asset pairs inside one hour:
//
//   exact string match       50.3%
//   similarity >= 0.80       71.8%
//   similarity >= 0.65       82.4%   <- the threshold used here
//   similarity >= 0.50       92.6%
//   mean similarity when the exact strings disagreed: 0.714
//
// So 0.65 recovers 32 points over exact matching, costs nothing, adds no
// external service, and is deterministic -- which an embedding API is not.
//
// IMPORTANT, and the reason this returns candidates rather than an answer:
// identity is only 50% stable on identical input, so a match must never be
// used to *replace* a fresh reading. It proposes a card we have named before;
// deciding is still downstream. Caching an answer at 50% stability would be
// freezing a coin flip and serving it repeatedly.
//
// ---------------------------------------------------------------------------
// NEGATIVE RESULT. Do not wire findKnownCard into a lookup path as it stands.
//
// Recall looked excellent and precision destroys it. Over 2,835 distinct assets
// (4,017,195 possible pairs), similarity >= 0.65 puts 15,740 pairs of DIFFERENT
// cards above the line against 3,345 pairs that are genuinely the same card --
// false matches outnumber true ones nearly five to one. Raising the bar does
// not rescue it; 0.80 still admits 9,898.
//
// Blocking on year + card number, which should have fixed it, does not:
// 2,054 true against 8,949 false. The block key collapses because card_number
// is absent on 54% of cards, so `2025#` groups an entire year together.
//
// Three causes, none of them fixable in a matching layer:
//   * cards are near-duplicates by construction -- same player, same product,
//     one digit apart -- so fuzzy string distance is a weak discriminator here
//   * the one strongly discriminating field, card_number, is missing 54% of
//     the time
//   * the identity being matched is itself only 37-50% stable on identical
//     input within one hour
//
// The primitives below are still correct and worth keeping: identityKey
// excludes grade and certificate so a PSA 9 and a PSA 10 are one card, and
// `similarity` is verified to agree with Postgres pg_trgm to four decimals, so
// an offline decision and a SQL query cannot diverge. What is not established
// is that any threshold over them is safe to act on.
//
// What would make this work is upstream, not here: a stable identity and a
// card number that gets read. Until then a matcher is polishing a coin flip.
// ---------------------------------------------------------------------------

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Accents are dropped by the pipeline often enough that folding them is the
// difference between matching a card and missing it.
const fold = (value) => cleanText(value)
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

// The season a card names, reduced to its starting year, so "2018-19" and
// "2018" do not look like different cards.
function startYear(value) {
  const match = cleanText(value).match(/((?:19|20)\d{2})/);
  return match ? match[1] : "";
}

/**
 * The string a card is matched on.
 *
 * Grade and certificate number are deliberately excluded: a PSA 9 and a PSA 10
 * of one card are the same card, and treating them as two is what made 2,066 of
 * 4,349 recognitions repeat work the system had already done.
 */
export function identityKey(fields = {}) {
  const subject = Array.isArray(fields.players) && fields.players.length
    ? fields.players[0]
    : fields.player;
  return [
    startYear(fields.year ?? fields.season_year),
    fold(fields.product),
    fold(subject),
    fold(fields.card_number || fields.collector_number),
    fold(fields.set || fields.card_name)
  ].filter(Boolean).join(" ");
}

// Trigram similarity, matching pg_trgm exactly, so an offline decision and a
// database query never disagree.
//
// The subtlety that cost a round of verification: Postgres pads *each word*
// with two leading spaces and one trailing space, not the string as a whole.
// Padding once gave 0.6744 where Postgres gave 0.7073 -- close enough to look
// right in a test and wrong enough to route a card differently in production.
export function trigrams(value) {
  const set = new Set();
  for (const word of fold(value).split(" ").filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) set.add(padded.slice(i, i + 3));
  }
  return set;
}

export function similarity(a, b) {
  const left = trigrams(a);
  const right = trigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export const defaultMatchThreshold = 0.65;

// A blocking key. Trigram similarity alone MUST NOT be used to search the whole
// corpus, and the measurement says so plainly.
//
// Over 2,835 distinct assets -- 4,017,195 possible pairs -- similarity >= 0.65
// puts 15,740 pairs of DIFFERENT cards above the line, against only 3,345 pairs
// that are genuinely the same card. The false matches outnumber the true ones
// nearly five to one. Raising the bar does not rescue it: 0.80 still admits
// 9,898. Cards are near-duplicates of each other by nature -- the same player,
// the same product, one digit apart -- so a fuzzy string is a weak global
// discriminator no matter where the threshold sits.
//
// So similarity is used only to *rank within a block* of cards that already
// agree on something hard: the year and the card number, the two fields a
// drifting reading rarely invents. Trigram then absorbs the spelling drift
// inside that block, which is the job it is actually good at.
export function blockingKey(fields = {}) {
  const year = startYear(fields.year ?? fields.season_year);
  const number = fold(fields.card_number || fields.collector_number);
  return year || number ? `${year}#${number}` : "";
}

/**
 * Cards we have named before that this one may be.
 *
 * @returns {{matched: boolean, best: object|null, score: number, candidates: object[]}}
 */
export function findKnownCard(fields = {}, known = [], {
  threshold = defaultMatchThreshold,
  limit = 5,
  requireBlock = true
} = {}) {
  const key = identityKey(fields);
  if (!key) return { matched: false, best: null, score: 0, candidates: [] };

  // Block first, rank second. Without this the false matches outnumber the true
  // ones five to one; see blockingKey.
  const block = blockingKey(fields);
  const pool = requireBlock && block
    ? known.filter((entry) => (entry.blocking_key ?? blockingKey(entry)) === block)
    : known;

  const scored = pool
    .map((entry) => ({ entry, score: similarity(key, entry.identity_key ?? identityKey(entry)) }))
    .filter((row) => row.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    matched: scored.length > 0,
    best: scored[0]?.entry ?? null,
    score: scored[0]?.score ?? 0,
    candidates: scored.map((row) => ({ ...row.entry, score: row.score }))
  };
}
