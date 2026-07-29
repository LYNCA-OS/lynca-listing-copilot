// The world engine, used forwards.
//
// build-constraint-model.mjs answers "is this claim impossible". That is worth
// having, but it only ever arrives after the model has already guessed, and a
// refusal does not tell anyone what the answer was.
//
// The same constraints run forwards answer a better question: given what the
// card plainly states, what is the answer allowed to be? Kobe Bryant played for
// one team, so a Kobe card's team is not a thing to read off the image or guess
// -- it is determined. Tom Brady played for two, so the answer is a choice
// between two, and the year is already printed on the card.
//
// Measured on the current model (2,293,502 harvested cards):
//
//   89.0% of covered players have exactly one team -- determined outright
//   49% of the rest have at least one year that narrows to one team
//
// Three outcomes, and the difference between the last two is the whole point:
//
//   VALUE    the constraints determine it. Nobody needs to look.
//   EMPTY    the field cannot apply here. A Mickey Mouse card has no team, and
//            saying so is an answer, not a gap.
//   UNKNOWN  our coverage cannot say. Never a guess, and never EMPTY --
//            treating absent coverage as evidence is the error that has already
//            cost two reverted changes.
//
// UNKNOWN carries `candidates` so the caller can go looking for the evidence
// that decides between them, rather than starting from nothing.

import { normalizeSubject, resolveAgainstIndex } from "./subject-normalizer.mjs";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const norm = (value) => cleanText(value).toLowerCase().replace(/[®™©]/g, "").trim();

export const outcomes = Object.freeze({
  VALUE: "VALUE",
  EMPTY: "EMPTY",
  UNKNOWN: "UNKNOWN"
});

// Sports where a subject belongs to a team. Trading-card games and
// entertainment licences have subjects with no team at all, and 38 Mickey
// Mouse cards and 26 Dark Magician cards in our own traffic were each counted
// as a missing team rather than a field that does not apply.
const TEAM_BEARING_SPORTS = new Set([
  "football", "basketball", "baseball", "hockey", "soccer", "wwe", "ufc", "racing", "golf"
]);
const TEAMLESS_SPORTS = new Set(["tcg", "entertainment", "gaming", "non-sport", "nonsport"]);

function seasonStartYear(value) {
  const match = cleanText(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

function result(status, { value = null, candidates = [], reason }) {
  return { status, value, candidates, reason };
}

// The sport the athlete index records for this subject, or null when it has
// never heard of them.
function knownSport(model, player) {
  const people = model.player_team_intervals?.[player];
  if (!Array.isArray(people) || !people.length) return null;
  const sport = people.map((person) => norm(person.sport)).find(Boolean);
  return sport || null;
}

// Product lines that publish subjects with no team at all. This is a claim
// about the product, which the card does state, rather than about the subject,
// which is what we are trying to decide -- so it stays a small, checkable list
// instead of a guess about who the subject is.
const TEAMLESS_PRODUCT_PATTERN = /\b(lorcana|magic|pok[eé]mon|yu-?gi-?oh|star wars|disney|marvel|dc|veefriends|garbage pail|topps now star wars|weiss schwarz|one piece|dragon ball)\b/i;

function looksTeamless(claim = {}) {
  const haystack = [claim.product, claim.brand, claim.manufacturer, claim.set, claim.card_name]
    .map((value) => cleanText(value)).filter(Boolean).join(" ");
  return TEAMLESS_PRODUCT_PATTERN.test(haystack);
}

// A card year falls inside a career interval when the season it names overlaps
// it. An open end means the player is still there, so anything from the start
// year onwards counts.
// An unknown start is unknown, not the beginning of time. Treating a missing
// start as -Infinity made every undated membership cover every year: a 2000
// Tom Brady card came back with "sale sharks" and "geelong football club"
// alongside the Patriots, because two other men called Tom Brady have
// memberships Wikidata never dated. An open END is different -- it means the
// player is still there -- so only the start is required.
export function intervalCoversYear(interval = {}, year = null) {
  if (!Number.isFinite(year)) return false;
  if (!Number.isFinite(interval.start)) return false;
  const end = Number.isFinite(interval.end) ? interval.end : Infinity;
  return year >= interval.start && year <= end;
}

// Pick the team whose career interval contains the card's year.
//
// Ambiguous names are never resolved by guessing. Two NFL players are called
// Josh Allen and five people are called Michael Jordan; where the sport does
// not separate them, the answer is the candidate set and UNKNOWN.
function matchTeamInterval(claim, model, player) {
  // The card's spelling and the index's spelling disagree often enough to
  // matter: 10 cards say "luka donči" while the index holds "luka dončić", and
  // a card that prints "acuna" without its accent is ordinary. A unique
  // accent-folded or short-tail match is the same person; an ambiguous one is
  // not resolved.
  const key = model.player_team_intervals?.[player]
    ? player
    : resolveAgainstIndex(player, Object.keys(model.player_team_intervals || {}));
  const people = key ? model.player_team_intervals?.[key] : null;
  if (!Array.isArray(people) || !people.length) return null;
  const year = seasonStartYear(claim.year ?? claim.season_year);
  if (!Number.isFinite(year)) return null;

  const sport = norm(claim.sport);
  const eligible = sport
    ? people.filter((person) => !person.sport || norm(person.sport).includes(sport) || sport.includes(norm(person.sport)))
    : people;
  const pool = eligible.length ? eligible : people;

  const hits = [];
  for (const person of pool) {
    for (const interval of person.teams || []) {
      if (intervalCoversYear(interval, year)) hits.push(norm(interval.team));
    }
  }
  const distinct = [...new Set(hits)].filter(Boolean);
  if (distinct.length === 1) {
    // One hit among several people sharing this name is not the same as one
    // answer. The others may simply have no dated memberships, and absent data
    // about them is not evidence against them -- the discipline that has
    // already cost two reverted changes.
    //
    // This is what put "arizona cardinals" on a 2025-26 Bowman Chrome Caleb
    // Wilson: the NFL tight end has dates, the basketball prospect does not, so
    // the only dated career won by default.
    //
    // The sport separates them, and the sport is exactly what the provider is
    // asked for on every call and has returned zero times out of 4,695. Until
    // it does, an ambiguous name is UNKNOWN.
    const separatedBySport = Boolean(sport) && eligible.length === 1;
    if (people.length > 1 && !separatedBySport) {
      return result(outcomes.UNKNOWN, {
        candidates: distinct,
        reason: "ambiguous_subject_needs_sport"
      });
    }
    return result(outcomes.VALUE, {
      value: distinct[0],
      candidates: distinct,
      reason: separatedBySport ? "career_interval_and_sport_narrow_to_one_team" : "career_interval_narrows_to_one_team"
    });
  }
  if (distinct.length > 1) {
    return result(outcomes.UNKNOWN, { candidates: distinct, reason: "several_teams_in_that_year" });
  }
  return null;
}

/**
 * What team can this card's subject belong to?
 *
 * @param {{player?: string, players?: string[], year?: string|number, sport?: string}} claim
 * @param {object} model  a constraints.json payload
 */
export function enumerateTeam(claim = {}, model = null) {
  if (!model) return result(outcomes.UNKNOWN, { reason: "no_model" });

  const sport = norm(claim.sport);
  if (sport && TEAMLESS_SPORTS.has(sport)) {
    return result(outcomes.EMPTY, { reason: "sport_has_no_teams" });
  }

  // The subject arrives carrying a truncated duplicate of itself, or a word
  // that belongs to another field, on enough cards to matter: 23 cards are
  // Luka Doncic under two spellings and 60 more hold a sport, brand, parallel
  // or team word inside the name. Either makes a lookup miss a person the
  // index plainly contains.
  const player = norm(normalizeSubject(claim).subject);
  if (!player) return result(outcomes.UNKNOWN, { reason: "no_subject_read" });

  // A teamless product settles the question before any lookup, and it has to
  // come first because the checklist-derived team set is not clean here: it
  // holds franchise names parsed out of the team column, so Mickey Mouse
  // resolved to the "team" mickey & friends and Elsa to frozen ii. A confident
  // wrong answer is worse than UNKNOWN, and worse still than the EMPTY that is
  // actually correct.
  if (looksTeamless(claim)) {
    return result(outcomes.EMPTY, { reason: "product_has_no_teams" });
  }

  // Career intervals are consulted before the checklist-derived team set,
  // because the two have different coverage and the intervals are wider. Kobe
  // Bryant is absent from player_teams -- Panini does not print a team and
  // Topps is mostly baseball and football -- but his career is ordinary world
  // knowledge. Checking the narrow source first would answer
  // subject_not_in_model for a player whose team we know exactly.
  const byInterval = matchTeamInterval(claim, model, player);
  if (byInterval?.status === outcomes.VALUE) return byInterval;

  const teams = model.player_teams?.[player];
  if (!teams || !teams.length) {
    if (byInterval) return byInterval;
    // A subject we have never harvested. If the sport is one where teams do not
    // exist at all we can still answer EMPTY; otherwise we must not pretend.
    if (sport && !TEAM_BEARING_SPORTS.has(sport)) {
      return result(outcomes.EMPTY, { reason: "sport_has_no_teams" });
    }
    // `sport` is populated on 0 of 4,695 production sessions, so it cannot be
    // relied on to reach EMPTY. A subject the athlete index knows nothing about,
    // on a card from a product line that is not a team sport, is a card with no
    // team rather than a card whose team we failed to find -- 39 Mickey Mouse
    // cards and 26 Dark Magician cards were being counted as missing teams.
    if (!sport && knownSport(model, player) === null && looksTeamless(claim)) {
      return result(outcomes.EMPTY, { reason: "subject_is_not_an_athlete" });
    }
    return result(outcomes.UNKNOWN, { reason: "subject_not_in_model" });
  }

  if (teams.length === 1) {
    return result(outcomes.VALUE, { value: teams[0], candidates: teams, reason: "single_team_in_career" });
  }

  // Career intervals answer what year lists cannot. The checklist harvest only
  // covers 2024-2026, while 49% of the cards we see are older, so a Brady card
  // from 2000 or a LeBron card from 2003-04 read its year off the card and
  // still could not choose. An interval -- "Lakers 1996-2016" -- covers a whole
  // career in one row, so the year printed on the card lands inside exactly one
  // of them.
  const intervalMatch = matchTeamInterval(claim, model, player);
  if (intervalMatch) return intervalMatch;

  // More than one team, so use the year -- which the card prints, and which the
  // model could not previously apply because teams and years were stored apart.
  const year = seasonStartYear(claim.year ?? claim.season_year);
  const byYear = year ? model.player_team_years?.[player]?.[String(year)] : null;
  if (byYear?.length === 1) {
    return result(outcomes.VALUE, { value: byYear[0], candidates: byYear, reason: "year_narrows_to_one_team" });
  }
  if (byYear?.length > 1) {
    return result(outcomes.UNKNOWN, { candidates: byYear, reason: "year_narrows_but_not_to_one" });
  }
  return result(outcomes.UNKNOWN, { candidates: teams, reason: "multiple_teams_in_career" });
}

/**
 * What product line publishes this set name?
 *
 * The product line is never printed on the card -- it is an emblem -- so it
 * cannot be read. The set name is printed large, and mostly identifies the
 * product on its own.
 */
export function enumerateProduct(claim = {}, model = null) {
  if (!model) return result(outcomes.UNKNOWN, { reason: "no_model" });
  const set = norm(claim.set || claim.set_or_insert || claim.card_name);
  if (!set) return result(outcomes.UNKNOWN, { reason: "no_set_name_read" });

  const entries = model.set_product_years?.[set];
  if (!entries || !entries.length) return result(outcomes.UNKNOWN, { reason: "set_not_in_model" });

  const year = seasonStartYear(claim.year ?? claim.season_year);
  const products = [...new Set(entries.map((entry) => entry.split("|").slice(-1)[0]))];
  if (products.length === 1) {
    return result(outcomes.VALUE, { value: products[0], candidates: products, reason: "set_identifies_one_product" });
  }
  if (year) {
    const forYear = [...new Set(entries
      .filter((entry) => entry.startsWith(`${year}|`))
      .map((entry) => entry.split("|").slice(-1)[0]))];
    if (forYear.length === 1) {
      return result(outcomes.VALUE, { value: forYear[0], candidates: forYear, reason: "year_narrows_to_one_product" });
    }
    if (forYear.length > 1) return result(outcomes.UNKNOWN, { candidates: forYear, reason: "year_narrows_but_not_to_one" });
  }
  return result(outcomes.UNKNOWN, { candidates: products, reason: "set_used_by_several_products" });
}

/**
 * Everything the constraints can settle without looking at the image again.
 * Returned per field so a caller can see which answers were derived and which
 * still need evidence.
 */
export function enumerateAll(claim = {}, model = null) {
  return {
    team: enumerateTeam(claim, model),
    product: enumerateProduct(claim, model)
  };
}
