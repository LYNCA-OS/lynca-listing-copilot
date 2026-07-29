// Clean the subject before asking the world engine who it is.
//
// The subject field arrives with two kinds of damage, both measured against
// 4,614 production cards, and both of which make a name fail to match a person
// who is plainly in the index.
//
// 1. A truncated duplicate of the same person.
//
//    Titles read "Pelé / Pel", "Dončić / Donči", "Modrić / Modri", "Mbappé /
//    Mbapp". The subject is not misread -- one person is being carried as two,
//    the second being the first with its final non-ASCII character dropped, and
//    the pair then renders in the multi-subject "A / B" form. 13 cards say
//    "luka dončić" and another 10 say "luka donči"; they are one player.
//
//    The rule is structural rather than a list: within one card's subjects, an
//    entry that is a prefix of another entry is the same person, and the longer
//    spelling is the one to keep.
//
// 2. Tokens belonging to other fields.
//
//    "tennis grigor dimitrov", "platinum luisangel acuna", "dan marino teal
//    dolphins", "veefriends hustling hamster", "tyran stokes elite". 60 cards
//    carry a sport, brand, parallel, attribute or team word inside the subject.
//
//    Rather than guess with a blocklist -- "Gold" is a surname as well as a
//    parallel -- a token is removed only when that same token already appears
//    in another field of the same card. The card itself supplies the evidence
//    that the word belongs elsewhere.
//
// Neither rule invents a name. Both only ever remove or merge, so a subject
// this cannot improve is returned unchanged.

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => cleanText(value).toLowerCase();

// Compare without the accents themselves, so "Donči" is recognised as a prefix
// of "Dončić" even where the truncation fell inside a decomposed character.
const foldAccents = (value) => norm(value).normalize("NFD").replace(/[̀-ͯ]/g, "");

export function isTruncationOf(shorter, longer) {
  const a = foldAccents(shorter);
  const b = foldAccents(longer);
  if (!a || !b || a === b) return false;
  // Only a tail-truncation counts, and only a short one: "Pel" from "Pelé" is a
  // dropped character, while "Luka" from "Luka Modric" is a real given name and
  // must not be merged away.
  return b.startsWith(a) && b.length - a.length <= 2;
}

/**
 * Collapse subjects that are the same person spelled two ways.
 *
 * @param {string[]} subjects
 * @returns {string[]} the surviving subjects, longest spelling kept
 */
export function mergeTruncatedSubjects(subjects = []) {
  const kept = cleanText(Array.isArray(subjects) ? "" : subjects) ? [String(subjects)] : [...subjects];
  const list = kept.map(cleanText).filter(Boolean);
  return list.filter((candidate) => !list.some((other) => isTruncationOf(candidate, other)));
}

// Words that are part of a name even when they also appear elsewhere on the
// card. Without this a player really called "Chase Young" on a Panini Chase
// insert would lose half his name.
const NEVER_STRIPPED = new Set(["jr", "sr", "ii", "iii", "iv", "de", "la", "van", "von", "da", "di", "del"]);

/**
 * Remove tokens from the subject that the card states in another field.
 *
 * @param {string} subject
 * @param {object} claim the other fields of the same card
 */
export function stripForeignTokens(subject = "", claim = {}) {
  const text = cleanText(subject);
  if (!text) return "";
  const elsewhere = new Set(
    [claim.product, claim.brand, claim.manufacturer, claim.set, claim.card_name,
      claim.insert, claim.parallel, claim.parallel_exact, claim.parallel_family,
      claim.surface_color, claim.team, claim.sport, claim.variation, claim.subset]
      .flatMap((value) => norm(value).split(/[^a-z0-9]+/))
      .filter(Boolean)
  );
  if (!elsewhere.size) return text;

  const words = text.split(" ");
  const survivors = words.filter((word) => {
    const key = norm(word).replace(/[^a-z0-9]/g, "");
    if (!key || NEVER_STRIPPED.has(key)) return true;
    return !elsewhere.has(key);
  });
  // Never strip a subject down to nothing, and never to a single fragment when
  // the original had a first and last name: that would be inventing a different
  // person rather than cleaning this one.
  if (!survivors.length) return text;
  if (words.length >= 2 && survivors.length < 2) return text;
  return survivors.join(" ");
}

/**
 * The subject as the world engine should see it.
 *
 * @param {object} claim a card's resolved fields
 * @returns {{subject: string, subjects: string[], changed: boolean}}
 */
export function normalizeSubject(claim = {}) {
  const raw = Array.isArray(claim.players) && claim.players.length
    ? claim.players.map(cleanText).filter(Boolean)
    : [cleanText(claim.player)].filter(Boolean);

  const merged = mergeTruncatedSubjects(raw);
  const cleaned = merged.map((subject) => stripForeignTokens(subject, claim)).filter(Boolean);
  const subjects = cleaned.length ? cleaned : merged;
  return {
    subject: subjects[0] || "",
    subjects,
    changed: subjects.join(" / ") !== raw.join(" / ")
  };
}

// Resolve a subject against the keys the index actually holds.
//
// Cleaning the subject is not enough on its own, because the damage and the
// index disagree in ways no within-card rule can see:
//
//   the card says   luka donči          the index holds  luka dončić
//   the card says   luisangel acuna     the index holds  luisangel acuña
//
// The first is the truncation arriving alone, with no fuller spelling on the
// same card to merge with. The second is a card that simply prints the name
// without its accent, which is normal on a trading card.
//
// Both resolve by folding accents and allowing a short missing tail -- and both
// require the match to be unique. Two index keys that fold together are not a
// match, they are a coin flip, and the caller is better served by the miss.
export function resolveAgainstIndex(subject = "", indexKeys = []) {
  const wanted = cleanText(subject);
  if (!wanted) return null;
  const keys = Array.isArray(indexKeys) ? indexKeys : [...indexKeys];
  if (keys.includes(norm(wanted))) return norm(wanted);

  const folded = foldAccents(wanted);
  const exact = keys.filter((key) => foldAccents(key) === folded);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const tail = keys.filter((key) => isTruncationOf(wanted, key));
  return tail.length === 1 ? tail[0] : null;
}
