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

  const claim = { ...out, sport: fields.sport };

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
