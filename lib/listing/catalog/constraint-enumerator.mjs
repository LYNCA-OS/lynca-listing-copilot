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

  const player = norm(Array.isArray(claim.players) && claim.players.length
    ? claim.players[0]
    : claim.player);
  if (!player) return result(outcomes.UNKNOWN, { reason: "no_subject_read" });

  const teams = model.player_teams?.[player];
  if (!teams || !teams.length) {
    // A subject we have never harvested. If the sport is one where teams do not
    // exist at all we can still answer EMPTY; otherwise we must not pretend.
    if (sport && !TEAM_BEARING_SPORTS.has(sport)) {
      return result(outcomes.EMPTY, { reason: "sport_has_no_teams" });
    }
    return result(outcomes.UNKNOWN, { reason: "subject_not_in_model" });
  }

  if (teams.length === 1) {
    return result(outcomes.VALUE, { value: teams[0], candidates: teams, reason: "single_team_in_career" });
  }

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
