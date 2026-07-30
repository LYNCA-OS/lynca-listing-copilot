// One entry point for everything the constraints can settle without another
// look at the image.
//
// This exists because of a counting exercise rather than a design idea. Three
// finished, tested modules were running in no production path at all:
//
//   constraint-enumerator   resolves 65% of empty teams, 30% of products
//   composeParallel         turns a field filled 0.8% of the time into "Silver /75"
//   subject-normalizer      undoes the truncated-duplicate and foreign-token damage
//
// Alongside four tables built with correct schemas and zero rows. The pattern
// is not that the work was wrong; it is that "built and tested" was treated as
// "done", and nothing was ever wired. So this collapses the wiring cost to a
// single import and a single call, and returns a shape that makes the
// before/after measurable rather than assumed.
//
// It never overwrites an observation. A derived value fills a gap the card did
// not answer; it does not overrule what was read. And it labels every value
// with where it came from, so a derived field can be evaluated separately from
// an observed one -- which is the only way to tell whether wiring this was a
// positive asset.

import { enumerateProduct, enumerateTeam, outcomes } from "./constraint-enumerator.mjs";
import { normalizeSubject } from "./subject-normalizer.mjs";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isFilled = (value) => {
  if (Array.isArray(value)) return value.some((item) => cleanText(item));
  return Boolean(cleanText(value));
};

export const provenance = Object.freeze({
  OBSERVED: "OBSERVED",   // the card said it
  DERIVED: "DERIVED",     // the constraints determined it
  COMPOSED: "COMPOSED",   // assembled from observations
  EMPTY: "EMPTY",         // the field cannot apply here
  UNKNOWN: "UNKNOWN"      // our coverage cannot say
});

/**
 * @param {object} fields    a card's resolved fields
 * @param {object} model     a constraints.json payload
 * @param {object} options   composeParallel is injected to keep this module free
 *                           of the renderer's dependency graph
 */
export function deriveFields(fields = {}, model = null, { composeParallel = null } = {}) {
  const out = { ...fields };
  const trace = {};

  // 1. Clean the subject before anything is looked up with it. 23 cards are
  //    Luka Doncic under two spellings; 60 more carry a sport, brand or team
  //    word inside the name.
  const subject = normalizeSubject(fields);
  if (subject.changed && subject.subject) {
    out.player = subject.subject;
    out.players = subject.subjects;
    trace.subject = { status: provenance.OBSERVED, cleaned: true, from: fields.player ?? fields.players };
  }

  // 1b. Type the card before anything is asked of the constraints, because the
  //     sport is what lets team come back EMPTY instead of UNKNOWN, and what
  //     separates namesakes. The provider is asked for it 4,695 times and has
  //     returned it zero times, so it is derived from the product line here.
  let sport = cleanText(fields.sport) || null;
  if (!sport) {
    const typed = deriveCardType(out);
    if (typed.sport) {
      sport = typed.sport;
      out.sport = typed.sport;
      trace.sport = { status: "VALUE", provenance: provenance.DERIVED, reason: typed.reason, category: typed.category };
    } else {
      trace.sport = { status: outcomes.UNKNOWN, provenance: provenance.UNKNOWN, reason: typed.reason };
    }
  }

  const claim = { ...out, sport };

  // 2. Team. Only when the card did not answer it -- 57% of the time.
  if (!isFilled(out.team)) {
    const team = enumerateTeam(claim, model);
    trace.team = { status: team.status, reason: team.reason, candidates: team.candidates };
    if (team.status === outcomes.VALUE) {
      out.team = team.value;
      trace.team.provenance = provenance.DERIVED;
    } else if (team.status === outcomes.EMPTY) {
      // Not a gap. A Mickey Mouse card has no team, and saying so is an answer.
      trace.team.provenance = provenance.EMPTY;
    } else {
      trace.team.provenance = provenance.UNKNOWN;
    }
  }

  // 3. Product. Never printed as text on the card -- it is an emblem -- so it
  //    is the field most worth deriving and the one most often invented.
  if (!isFilled(out.product)) {
    const product = enumerateProduct(claim, model);
    trace.product = { status: product.status, reason: product.reason, candidates: product.candidates };
    if (product.status === outcomes.VALUE) {
      out.product = product.value;
      trace.product.provenance = provenance.DERIVED;
    } else {
      trace.product.provenance = provenance.UNKNOWN;
    }
  }

  // 4. Parallel. Composed from what was already read, never invented: the
  //    manufacturer's proper noun when the vocabulary attests one, otherwise
  //    the honest descriptive form.
  if (!isFilled(out.parallel) && typeof composeParallel === "function") {
    const parallel = composeParallel(out);
    if (parallel?.value) {
      out.parallel = parallel.value;
      trace.parallel = { status: parallel.form, provenance: provenance.COMPOSED, basis: parallel.basis };
    }
  }

  return { fields: out, trace, changed: Object.keys(trace).length > 0 };
}

/**
 * Whether wiring this was worth it, counted rather than assumed.
 *
 * Feed it the traces from a run and it reports how many gaps were filled, how
 * many were honestly declared empty, and how many the constraints could not
 * answer. A wiring that fills nothing should be removed again, and this is what
 * says so.
 */
export function summariseDerivation(traces = []) {
  const tally = { filled: 0, empty: 0, unknown: 0, subjectsCleaned: 0, byField: {} };
  for (const trace of traces) {
    if (trace?.subject?.cleaned) tally.subjectsCleaned += 1;
    for (const field of ["team", "product", "parallel"]) {
      const entry = trace?.[field];
      if (!entry) continue;
      tally.byField[field] = tally.byField[field] || { filled: 0, empty: 0, unknown: 0 };
      const bucket = entry.provenance === provenance.DERIVED || entry.provenance === provenance.COMPOSED
        ? "filled"
        : entry.provenance === provenance.EMPTY ? "empty" : "unknown";
      tally[bucket] += 1;
      tally.byField[field][bucket] += 1;
    }
  }
  return tally;
}

// Absorbed from the CSM proposal: type the card as TCG or non-TCG.
//
// The proposal frames this as "label typing for evidence collection". Its real
// value is narrower and larger: it is the `sport` field, which the provider is
// asked for on all 4,695 production calls and has returned zero times, and
// which gates two decisions the enumerator cannot make without it.
//
//   * EMPTY versus UNKNOWN for team. 38 Mickey Mouse cards and 26 Dark Magician
//     cards were counted as *missing* a team rather than having none.
//   * separating namesakes. Five people are called Michael Jordan; without a
//     sport an ambiguous name must stay UNKNOWN, which costs five points of
//     coverage.
//
// It is derived from the product line, which the card does state, rather than
// asked of the model, which has proven it will not answer. And it is a
// deliberately small, checkable list -- a claim about the product, not about the
// subject, so it cannot quietly decide who is on the card.
const TCG_PRODUCT_PATTERN = /\b(lorcana|magic|mtg|pok[eé]mon|yu-?gi-?oh|weiss schwarz|one piece|dragon ball|flesh and blood|digimon|metazoo)\b/i;
const ENTERTAINMENT_PRODUCT_PATTERN = /\b(disney|star wars|marvel|dc comics|game of thrones|garbage pail|veefriends|dune|topps now star wars)\b/i;
// Only a product line that *states* its sport counts.
//
// The first version inferred it from the brand, and got Tom Brady on a 2000
// Bowman Chrome card typed as baseball -- Bowman prints football too. The wrong
// sport is worse than none: it made the namesake filter reject his real career
// and sent team back to UNKNOWN, which is precisely the failure this typing was
// added to prevent.
//
// So brands that span sports -- Bowman, Topps Chrome, Prizm, Donruss, Select --
// are absent by design. They resolve only when the product name carries the
// sport word itself, and otherwise stay UNKNOWN.
const SPORT_PRODUCT_HINTS = Object.freeze([
  [/\bbaseball\b/i, "baseball"],
  [/\bbasketball\b/i, "basketball"],
  [/\bfootball\b/i, "football"],
  [/\b(hockey|nhl)\b/i, "hockey"],
  [/\b(soccer|uefa|fifa|champions league|la liga|futera|road to fifa)\b/i, "soccer"],
  [/\b(wwe|aew)\b/i, "wwe"],
  [/\bufc\b/i, "ufc"],
  [/\btennis\b/i, "tennis"],
  [/\bgolf\b/i, "golf"],
  [/\b(racing|formula 1|f1|nascar)\b/i, "racing"]
]);

export function deriveCardType(fields = {}) {
  const haystack = [fields.product, fields.brand, fields.manufacturer, fields.set, fields.card_name]
    .map((value) => String(value ?? "")).filter(Boolean).join(" ");
  if (!haystack) return { sport: null, category: null, reason: "no_product_context" };
  if (TCG_PRODUCT_PATTERN.test(haystack)) return { sport: "tcg", category: "TCG", reason: "tcg_product_line" };
  if (ENTERTAINMENT_PRODUCT_PATTERN.test(haystack)) {
    return { sport: "entertainment", category: "NON_TCG_ENTERTAINMENT", reason: "entertainment_licence" };
  }
  for (const [pattern, sport] of SPORT_PRODUCT_HINTS) {
    if (pattern.test(haystack)) return { sport, category: "SPORT", reason: "sport_product_line" };
  }
  // Unrecognised is UNKNOWN, never a guessed sport. Guessing here would hand the
  // enumerator a wrong basis for separating namesakes, which is worse than
  // leaving it unable to separate them at all.
  return { sport: null, category: null, reason: "product_not_in_type_map" };
}
