// When two strings state the same fact, a scorer that calls one of them wrong
// is measuring itself, not the pipeline.
//
// Measured on the 150-card confirmatory cohort, changing no pipeline output at
// all, only letting the metric recognise what the pipeline already knows:
//
//   synonym classes        +0.0108   45 cards
//   partial finish credit  +0.0096   26 cards
//   redundant hypernyms    +0.0053   23 cards
//   season spans           +0.0036   54 cards
//   orthography            +0.0029
//   plural folding         +0.0024
//   unobtainable facts               18 cards made unwinnable-free
//
// Every rule below was adjudicated by the founder against real examples, not
// chosen by me. That matters: several looked like recognition failures until
// someone who writes these titles said what they were.
//
// The total is larger than every pipeline mechanism this repository shipped on
// the same day put together, and none of it changes an output.
//
// WHY THIS IS NOT A PIPELINE CHANGE. The obvious reading -- emit both forms --
// was measured and is decisively wrong: rendering "Auto Autograph" scored
// -0.009094 with 7 wins to 47 losses, and "Rookie RC" -0.002712 with 13 to 29,
// because writers overwhelmingly publish one form and the second word is a
// precision cost on every card that used it alone. The composer's choice is
// correct. The metric's blindness is the defect.
//
// HIERARCHY IS DELIBERATELY ABSENT. Scoring "Refractor" against a writer's
// "Gold Refractor" already behaves correctly under token overlap: we earn
// `refractor` and lose `gold`, and losing `gold` is right because we did not
// identify the colour. Granting ancestor credit was measured at +0.001897 over
// 6 cards and would be paying us for a fact we never established. Hierarchy is
// needed by the claim-level ruler, where a true generalisation is otherwise
// judged a false claim with no partial credit available -- a correctness
// requirement there, not a score recovery here.
//
// This module NEVER becomes the default silently. Every reading is labelled
// with EQUIVALENCE_VERSION, and callers opt in. A scorer quietly changed
// between runs is the confound the paired design exists to prevent, and every
// number recorded before this file must stay comparable to itself.

import { createHash } from "node:crypto";

/**
 * Classes of strings that state the same fact. Membership is evidence-led, from
 * what the writer publishes across 358 confirmed titles, not from what looks
 * interchangeable. `signature` folds into `auto` because the writer uses them
 * for one thing; `relic` and `memorabilia` likewise.
 */
export const SYNONYM_CLASSES = Object.freeze([
  Object.freeze({ canonical: "auto", forms: Object.freeze(["auto", "autos", "autograph", "autographs", "autographed", "signature", "signatures", "sig", "sigs"]) }),
  Object.freeze({ canonical: "rc", forms: Object.freeze(["rc", "rookie", "rookies"]) }),
  Object.freeze({ canonical: "relic", forms: Object.freeze(["relic", "relics", "memorabilia"]) }),
  Object.freeze({ canonical: "patch", forms: Object.freeze(["patch", "patches"]) }),
  Object.freeze({ canonical: "refractor", forms: Object.freeze(["refractor", "refractors"]) }),
  Object.freeze({ canonical: "prizm", forms: Object.freeze(["prizm", "prizms"]) })
]);

const FORM_TO_CANONICAL = new Map();
for (const cls of SYNONYM_CLASSES) for (const form of cls.forms) FORM_TO_CANONICAL.set(form, cls.canonical);

/**
 * Abbreviations writers publish, against the expansions we produce.
 *
 * This is not the hypernym case, which forgives an extra word beside a term we
 * both used. Here the two titles share no token at all: the writer types UCC
 * and we render "UEFA Champions League", so the phrase has to collapse before
 * tokenisation or nothing lines up.
 *
 * Direction matters and the fold is symmetric: expanding an abbreviation the
 * writer used and abbreviating an expansion they wrote are the same statement,
 * and neither should be paid for or charged.
 *
 * Membership is what writers actually publish in the confirmed library, not
 * every abbreviation that exists.
 */
// Collapse toward the shared root, not toward the abbreviation. Writers use
// UCC, UEFA and the full name interchangeably, so folding everything to `ucc`
// broke the cards where they wrote UEFA alone and we wrote the expansion --
// both sides ended up with tokens that no longer met. `uefa` is present in
// every variant, so it is the form that makes them all agree.
const ABBREVIATIONS = Object.freeze([
  [/\buefa\s+champions\s+league\b/gi, "uefa"],
  [/\buefa\s+club\s+competitions?\b/gi, "uefa"],
  [/\bchampions\s+league\b/gi, "uefa"],
  [/\bucc\b/gi, "uefa"],
  [/\bmajor\s+league\s+baseball\b/gi, "mlb"],
  [/\bnational\s+basketball\s+association\b/gi, "nba"]
]);
function foldAbbreviations(text) {
  return ABBREVIATIONS.reduce((acc, [re, short]) => acc.replace(re, short), String(text ?? ""));
}

/**
 * A season span and its opening year state the same issue.
 *
 * Whether a release is a single-year or a cross-season one is a fact about the
 * sport's calendar, not a fact printed on the card: 2025 Topps Chrome baseball
 * and 2025-26 Topps Chrome basketball look identical to a reader of the card
 * face. The writer supplies the convention from trade knowledge. Graders do not
 * reliably supply it either.
 *
 * The evidence that this is metric noise rather than a real miss is that we are
 * never WRONG here. Across the 150-card cohort, on every card where the writer
 * used a span and we returned a bare year, our year fell inside their span:
 * 22 inside, 0 outside. Folding both sides to the opening year is worth
 * +0.003639 and touches 54 cards.
 *
 * Folding is symmetric -- a span we produce collapses too -- so this cannot
 * become a way to be paid for a span we guessed.
 */
function foldSeasonSpan(text) {
  return String(text ?? "").replace(/\b((?:19|20)\d{2})\s*[-/]\s*(?:\d{2}|(?:19|20)\d{2})\b/g, "$1");
}

/**
 * The years a span covers, as strings. "2025-26" -> ["2025", "2026"].
 *
 * The two-digit tail is completed from the opening year's century, and a tail
 * that would run backwards (2099-00) rolls into the next century, which is how
 * the hobby writes a season that crosses one.
 */
function seasonSpanYears(opening, tail) {
  const start = Number(opening);
  const end = tail.length === 4 ? Number(tail) : Number(`${String(start).slice(0, 2)}${tail}`);
  const closing = end < start ? end + 100 : end;
  const years = [];
  for (let y = start; y <= closing && years.length < 8; y += 1) years.push(String(y));
  return years;
}

/**
 * Any year INSIDE the span is the right year. Founder ruling, 2026-08-05.
 *
 * The previous fold collapsed a span to its OPENING year on both sides, which
 * paid us for "2025" against "2025-26" and charged us for "2026" -- and 2026 is
 * just as true. The card carries one printed year; whether the trade writes the
 * single year or the crossing season is a convention the reader supplies, and
 * the ruling is that either endpoint states the same issue.
 *
 * Pair-aware by necessity: containment is a relation between the two texts, not
 * a property of one, so this cannot be a single-text fold like the others.
 * Symmetric, so a span we produce is credited against a bare year the writer
 * used exactly as the reverse is. A year OUTSIDE the span is untouched --
 * "2023" against "2025-26" stays wrong.
 */
function foldSeasonSpanAgainst(text, other) {
  const spans = [...String(other ?? "").matchAll(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2}|(?:19|20)\d{2})\b/g)];
  if (!spans.length) return String(text ?? "");
  let out = String(text ?? "");
  for (const [, opening, tail] of spans) {
    const members = new Set(seasonSpanYears(opening, tail));
    out = out.replace(/\b((?:19|20)\d{2})\b(?!\s*[-/]\s*\d)/g, (year) => (members.has(year) ? opening : year));
  }
  return out;
}

/**
 * Rendering differences that carry no meaning. We publish Ibrahimović, Dončić,
 * Pokémon and a typographic apostrophe in D'Angelo; the writer types ASCII. Our
 * rendering is the more faithful one, so folding these is not a concession.
 */
function foldOrthography(text) {
  return foldSeasonSpan(foldAbbreviations(String(text ?? "")))
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Plural of a term, not a word ending in s. `is`/`us`/`ss` are not plurals. */
function foldPlural(word) {
  if (/(ss|us|is)$/.test(word)) return word;
  return word.replace(/s$/, "");
}

/**
 * One token's canonical form. Order matters: orthography first so `Dončić`
 * reaches the synonym table as `doncic`, then the synonym class, then plurals
 * for anything the table does not cover.
 */
export function canonicaliseToken(token) {
  const folded = foldOrthography(token).toLowerCase();
  const mapped = FORM_TO_CANONICAL.get(folded);
  if (mapped) return mapped;
  return foldPlural(folded);
}

/**
 * Tokenise and canonicalise a title. Returns a Set, because the scorer this
 * feeds compares presence rather than counts.
 */
export function equivalenceTokens(text) {
  return new Set(foldOrthography(text)
    .toLowerCase()
    .split(/[^a-z0-9/']+/)
    .filter(Boolean)
    .map(canonicaliseToken));
}

/**
 * Finish vocabulary, for the partial-credit rule below. Colours and treatments
 * together, because the rule does not care which of the two we produced.
 */
export const FINISH_VOCABULARY = Object.freeze(new Set([
  "refractor", "prizm", "holo", "foil", "sapphire", "mojo", "wave", "raywave", "xfractor",
  "shimmer", "sparkle", "pulsar", "geometric", "hyper", "shock", "velocity", "disco", "scope",
  "marble", "cracked", "ice", "prismatic", "lucky", "speckle", "reptilian", "crystallized",
  "mosaic", "pixel", "burst", "rainbow", "gold", "silver", "red", "blue", "green", "orange",
  "purple", "pink", "black", "yellow", "teal", "bronze", "platinum", "emerald", "white",
  "aqua", "violet", "magenta", "copper"
]));

/**
 * Broader terms that add nothing once the specific one is present.
 *
 * A Patch IS a relic; a Jersey IS a relic; Bowman IS a Topps brand. When the
 * writer names the specific thing and we name it too, our extra category word
 * states no new fact and contradicts nothing. It is the mirror of the finish
 * rule above: there we forgive the writer being more specific than us, here we
 * forgive ourselves being more general than them.
 *
 * The guard is what keeps this honest. A hypernym is only free when we ALSO
 * produced the writer's own specific term. Saying "Relic" while missing their
 * "Patch" is not redundancy, it is a coarser answer to a question they
 * answered precisely, and it stays charged.
 *
 * Publisher parents come from CSM's own list rather than a second copy here;
 * see product-semantics.mjs. Measured at +0.005286 over 23 cards for the brand
 * case, with one card correctly refused because the writer's brand was absent
 * from our title.
 */
export const HYPERNYMS = Object.freeze({
  relic: Object.freeze(["patch", "jersey", "costume", "memorabilia", "swatch", "button", "glove", "bat"]),
  // Upper Deck owns Skybox; writers publish the sub-brand alone.
  upper: Object.freeze(["skybox", "metal"]),
  deck: Object.freeze(["skybox", "metal"]),
  auto: Object.freeze(["autograph", "signature"]),
  topps: Object.freeze(["bowman", "chrome", "finest", "stadium"]),
  panini: Object.freeze(["prizm", "donruss", "optic", "select", "obsidian", "mosaic", "revolution", "immaculate", "eminence", "contenders"]),
  fleer: Object.freeze(["ultra", "skybox"]),
  leaf: Object.freeze(["metal"])
});

/**
 * Drop our redundant hypernyms, but only the ones whose specific term we and
 * the writer both produced.
 */
// The table is written in ordinary spelling and must be read through the same
// folds as the titles, or an entry never matches. `Topps` tokenises to `topp`
// once plurals are folded, which is why the raw table silently did nothing.
const FOLDED_HYPERNYMS = new Map(Object.entries(HYPERNYMS).map(([broad, narrow]) =>
  [canonicaliseToken(broad), narrow.map(canonicaliseToken)]));

export function applyHypernymRedundancy(wanted, got) {
  const free = new Set();
  for (const [broad, narrow] of FOLDED_HYPERNYMS) {
    if (!got.has(broad) || wanted.has(broad)) continue;
    // The specific term must be the writer's AND ours, or this is not redundancy.
    if (narrow.some((n) => wanted.has(n) && got.has(n))) free.add(broad);
  }
  if (!free.size) return got;
  return new Set([...got].filter((t) => !free.has(t)));
}

/**
 * Facts a reader of the card cannot obtain.
 *
 * SSP means the print run is unusually short relative to the rest of the set.
 * Nothing on the card says so -- it is a property of the checklist. The cohort
 * shows this cleanly: the writer used SSP on 13 cards, we produced it on 0, and
 * we never produced it falsely either. A term we can neither find nor guess is
 * measuring our access to a checklist, not our reading of the card.
 *
 * Charging for it also distorts what the score is for. Every one of those 13
 * cards is unwinnable by any amount of recognition work, so their weight in the
 * metric is weight that no improvement can ever move.
 *
 * If a catalogue is ever wired in, this set must shrink -- these become
 * scoreable the moment they become obtainable.
 */
export const TRADE_KNOWLEDGE_TOKENS = Object.freeze(new Set(["ssp", "sp"]));

/**
 * The rookie-card designation is printed on modern cards and is trade knowledge
 * on old ones. Topps began putting an RC logo on cards in 2006, and the cohort
 * splits on exactly that line: from 2006 the writer used RC on 55 cards and we
 * found it on 49 (89%); before 2006, 5 cards and 1 (20%). The later misses are
 * real and stay charged.
 */
const RC_LOGO_FROM_YEAR = 2006;

/**
 * Drop recall demands that no reading of the images could satisfy.
 */
export function applyUnobtainableFacts(wanted, referenceText, got = null) {
  const year = Number((/\b(19|20)\d{2}\b/.exec(String(referenceText ?? "")) || [])[0]);
  const drop = new Set(TRADE_KNOWLEDGE_TOKENS);
  if (year && year < RC_LOGO_FROM_YEAR) drop.add("rc");
  const prune = (set) => (set && [...drop].some((t) => set.has(t))
    ? new Set([...set].filter((t) => !drop.has(t)))
    : set);
  // The exemption has to cut both ways. Removing a token only from `wanted`
  // stops requiring it and starts CHARGING for it: a 2003 rookie card whose RC
  // we correctly identified became a precision loss, because the writer's `rc`
  // had been exempted away while ours remained. Not asking for a fact and
  // penalising the fact are not the same mercy.
  return got === null ? prune(wanted) : { wanted: prune(wanted), got: prune(got) };
}

/**
 * How a multi-card listing announces itself.
 *
 * CSM's Lot grammar opens the title with "4 Card Lot". The writers close it
 * instead, and spell it differently: `lot`, `lotx1`, `lotx4`, sometimes nothing
 * at all. Both say the same thing about the same listing, and the founder's
 * ruling is that the difference does not matter.
 *
 * The guard is that it must actually BE a lot by the writer's own reckoning.
 * On one of the seven cards we announced a 2-card lot and the writer described
 * a single card -- that is a misjudgement about the listing, not a wording
 * difference, and forgiving it would hide the only real error in the group.
 *
 * Two cards where the writer listed several players without any lot marker
 * stay charged as well. We cannot tell from the title alone that they meant a
 * lot, and guessing in our own favour is how a metric stops being one.
 */
// Both separators. We print `Lot*4` (COS-14 as amended 2026-08-08) and the
// writers typed `lotx4`; the founder's ruling is that they say the same
// thing, so a marker written either way must match here.
const LOT_MARKER = /\blot(?:\s*[x*]\s*\d+)?\b/i;
export function applyLotFormatTolerance(wanted, got, referenceText) {
  if (!LOT_MARKER.test(String(referenceText ?? ""))) return got;
  if (!got.has("lot")) return got;
  // Our opening bracket is "<count> Card Lot"; the count and the word Card are
  // the wording, not the fact.
  return new Set([...got].filter((t) => !((t === "card" || /^\d+$/.test(t)) && !wanted.has(t))));
}

/**
 * Observable components the writer chose not to publish.
 *
 * `attributes` is a closed enum -- Auto, RC, Patch, Relic, Jersey and a few
 * more -- so unlike a card name it cannot be invented, only misapplied. The
 * founder's ruling is that emitting one the writer omitted is a habit
 * difference rather than an error.
 *
 * The boundary keeps it falsifiable: this applies only when the writer
 * published NO component at all. A title listing none of them has opted out of
 * the bracket, and our components state facts they declined to state. A title
 * listing Jersey and Auto but not Patch has made a specific choice, and our
 * extra Patch disagrees with it -- that stays charged, because a rule that
 * forgave it could no longer see a component we got wrong.
 *
 * 13 cards of the 255 fall on the exempt side, 10 on the charged side.
 */
const COMPONENT_TOKENS = Object.freeze(new Set(["auto", "rc", "patch", "relic", "jersey"]));
export function applyComponentPolicyTolerance(wanted, got) {
  if ([...COMPONENT_TOKENS].some((t) => wanted.has(t))) return got;
  if (![...COMPONENT_TOKENS].some((t) => got.has(t))) return got;
  return new Set([...got].filter((t) => !COMPONENT_TOKENS.has(t)));
}

/**
 * A parallel names two things at once and we are not asking for both.
 *
 * "Gold Refractor" is a colour and a treatment. Saying Gold identifies the
 * card; saying Refractor identifies the card; the writer's phrase carries both
 * because writers are thorough, not because both are required. Demanding the
 * full phrase asks a harder question than the product currently needs answered.
 *
 * The rule is one-sided on purpose. A NON-EMPTY SUBSET of the writer's finish
 * terms satisfies the finish, so Gold counts against "Gold Refractor" and so
 * does Refractor. A term the writer does not have is still charged: Green
 * against "Gold Refractor" is a misreading, not a coarser reading, and a metric
 * that forgave it could no longer tell those apart. An empty finish layer is
 * charged too -- saying nothing is not a partial answer.
 *
 * Measured on 150 cards: 54 satisfied, 12 still wrong for naming another
 * finish, 31 still wrong for saying nothing. Worth +0.009569 over 26 cards.
 */
export function applyPartialFinishCredit(wanted, got) {
  const wantFinish = [...wanted].filter((t) => FINISH_VOCABULARY.has(t));
  if (!wantFinish.length) return wanted;
  const overlap = wantFinish.filter((t) => got.has(t));
  if (!overlap.length) return wanted;

  // Forgiveness is for saying LESS, never for saying something else. Founder
  // ruling, 2026-08-05: the finish has a safe degradation, and a safe
  // degradation must rank strictly above a wrong claim.
  //
  // The rule as first written forgave every unmatched finish token the moment
  // ANY finish token overlapped, so "Blue Refractor" against "Gold Refractor"
  // had `gold` forgiven on the strength of `refractor` -- and scored the same
  // as saying "Gold" alone, which is incomplete but true. Being wrong and
  // being brief cannot cost the same.
  //
  // So a wanted finish token is forgiven only when we emitted NO competing
  // finish token that the reference does not have. One unsupported finish word
  // is enough to withdraw the credit: it is a claim, not an omission.
  const unsupported = [...got].filter((t) => FINISH_VOCABULARY.has(t) && !wanted.has(t));
  if (unsupported.length) return wanted;

  return new Set([...wanted].filter((t) => !(FINISH_VOCABULARY.has(t) && !got.has(t))));
}

/**
 * Stable identity of the vocabulary above. A reading taken under one version is
 * not comparable to a reading taken under another, so the version travels with
 * every result rather than living in a changelog.
 */
export const EQUIVALENCE_VERSION = `sem-equiv-1+${createHash("sha256")
  // Every fold that can change a reading, not just the synonym table. Season
  // spans and orthography move results too, and a version that ignored them
  // would file two incomparable readings under one label -- the exact failure
  // this stamp exists to prevent.
  .update(JSON.stringify({
    synonyms: SYNONYM_CLASSES,
    finish: [...FINISH_VOCABULARY],
    hypernyms: HYPERNYMS,
    abbreviations: ABBREVIATIONS.map(([re, short]) => [re.source, short]),
    components: [...COMPONENT_TOKENS],
    unobtainable: [...TRADE_KNOWLEDGE_TOKENS, `rc<${RC_LOGO_FROM_YEAR}`],
    lot_tolerance: LOT_MARKER.source,
    folds: [foldSeasonSpan.toString(), foldSeasonSpanAgainst.toString(), seasonSpanYears.toString(),
      foldOrthography.toString(), foldPlural.toString(),
      applyPartialFinishCredit.toString(), applyHypernymRedundancy.toString()],
    folded_hypernyms: [...FOLDED_HYPERNYMS]
  }))
  .digest("hex")
  .slice(0, 12)}`;

/**
 * Score a title against a reference, both raw and equivalence-aware.
 *
 * Both readings are always returned. Reporting only the higher one would make
 * this file a way to improve numbers rather than a way to measure honestly,
 * and the raw reading is what every prior result in this repository used.
 */
export function scoreWithEquivalence(reference, title) {
  const plain = (text) => new Set(String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
  const f1 = (want, got) => {
    const hits = [...want].filter((t) => got.has(t)).length;
    const recall = want.size ? hits / want.size : 0;
    const precision = got.size ? hits / got.size : 0;
    return {
      recall,
      precision,
      f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0
    };
  };
  // Season-span containment is pair-aware, so it runs here rather than inside
  // the single-text folds: each side is rewritten against the OTHER's span
  // before tokenising, which keeps it symmetric.
  const refFolded = foldSeasonSpanAgainst(reference, title);
  const titleFolded = foldSeasonSpanAgainst(title, reference);
  const exempt = applyUnobtainableFacts(
    equivalenceTokens(refFolded), reference, equivalenceTokens(titleFolded)
  );
  const wanted = exempt.wanted;
  const got = applyComponentPolicyTolerance(wanted, applyLotFormatTolerance(wanted,
    applyHypernymRedundancy(wanted, exempt.got), reference));
  return {
    raw: f1(plain(reference), plain(title)),
    equivalent: f1(applyPartialFinishCredit(wanted, got), got),
    equivalence_version: EQUIVALENCE_VERSION
  };
}
