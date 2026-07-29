// Decide whether a card is worth a second look, and what to look at.
//
// Route C is a two-stage read: a cheap first pass, the world engine filling
// what it can derive, and a targeted second pass only for what is still
// missing. The expensive half of that already exists and is in production
// behind a gate -- the targeted assist executor takes at most two original
// images and four crops with a 3.5 second deadline.
//
// What did not exist is the decision. This module is that decision, and
// nothing else: it does not call a provider, does not read an image, and does
// not name a card. It answers one question -- given what stage one read and
// what the engine derived, is a second call worth 3.5 seconds, and which crops
// would earn it?
//
// The economics, measured, are why this has to be a decision rather than a
// habit. A second call costs roughly the candidate p50 of 4.27s on top of the
// first. Asking for one on every card doubles latency to buy nothing on the
// cards that were already complete. Production data says how often that is:
//
//   surface_color read on 46% of cards        serial_denominator on 55%
//   card_number missing on 51%                team empty on 57%
//   product resolvable by the engine on 30%   team on 65%
//
// So the second look is worth it exactly when a field is BOTH missing after
// derivation AND visible somewhere on a card. A field the engine can derive
// needs no photograph, and a field no camera can settle -- the manufacturer's
// proper name for a new parallel -- is not made knowable by looking harder.

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const filled = (value) => {
  if (Array.isArray(value)) return value.some((item) => cleanText(item));
  if (typeof value === "boolean") return value;
  return Boolean(cleanText(value));
};

// Where each field is printed, and therefore which crop could recover it.
// A field with no region is not readable from a photograph at all, and asking
// for another look at it is spending 3.5 seconds on nothing.
export const fieldRegions = Object.freeze({
  card_number: "card_code_crop",
  collector_number: "card_code_crop",
  serial_number: "serial_crop",
  serial_denominator: "serial_crop",
  print_run_denominator: "serial_crop",
  set: "card_type_crop",
  card_name: "card_type_crop",
  insert: "card_type_crop",
  year: "year_product_crop",
  manufacturer: "year_product_crop",
  brand: "year_product_crop",
  player: "subject_crop",
  players: "subject_crop",
  team: "subject_crop",
  card_grade: "grade_label_crop",
  grade_company: "grade_label_crop",
  cert_number: "grade_label_crop",
  surface_color: null,      // a whole-card judgement, not a region
  parallel_exact: null,     // manufacturer vocabulary, not printed
  sport: null               // inferred from the product, never printed
});

// Every card has these, so an absence is a gap worth a photograph.
//
// The distinction matters more than it looks. Most cards are not serial
// numbered, most are not graded, most carry no insert name -- production has a
// serial on 55% and a grade on 35%. Treating those absences as gaps makes every
// ordinary card look incomplete and earns a second call it does not need, which
// is the same error as confusing EMPTY with UNKNOWN, one layer earlier.
export const alwaysPresentFields = Object.freeze({
  player: 100,
  year: 90,
  product: 85,
  card_number: 70,
  set: 60
});

// These exist on some cards and not others. An absence is only a gap when
// something else on the card says the field should be there -- a serial
// denominator is missing only if a serial number was seen, a grade only if the
// card is in a slab.
export const conditionalFields = Object.freeze({
  serial_denominator: { weight: 55, impliedBy: ["serial_number", "numerical_rarity", "print_run_number"] },
  card_grade: { weight: 30, impliedBy: ["grade_company", "cert_number", "grade_type"] },
  team: { weight: 35, impliedBy: [] },
  surface_color: { weight: 45, impliedBy: [] },
  insert: { weight: 25, impliedBy: [] }
});

/**
 * @param {object} observed  what stage one read
 * @param {object} derived   per-field {status} from the constraint enumerator
 * @returns {{worthIt: boolean, crops: string[], fields: string[], reason: string, recoverableValue: number}}
 */
export function planSecondLook(observed = {}, derived = {}, {
  maxCrops = 4,
  minValue = 60
} = {}) {
  const settled = (field) => {
    // The engine settled it, so no photograph is needed. EMPTY counts as
    // settled: a Mickey Mouse card is not missing a team, it has none.
    const status = derived[field]?.status;
    return status === "VALUE" || status === "EMPTY";
  };

  const missing = [];
  for (const [field, weight] of Object.entries(alwaysPresentFields)) {
    if (filled(observed[field]) || settled(field)) continue;
    missing.push({ field, weight, region: fieldRegions[field] ?? null });
  }
  for (const [field, spec] of Object.entries(conditionalFields)) {
    if (filled(observed[field]) || settled(field)) continue;
    // No sign the card carries this field at all, so its absence is an answer
    // rather than a gap.
    if (!spec.impliedBy.some((hint) => filled(observed[hint]))) continue;
    missing.push({ field, weight: spec.weight, region: fieldRegions[field] ?? null });
  }

  if (!missing.length) {
    return { worthIt: false, crops: [], fields: [], reason: "nothing_missing", recoverableValue: 0 };
  }

  // A missing field with no region cannot be recovered by looking again. It is
  // still missing, and saying so honestly is the correct outcome -- this is
  // where abstention belongs, not another provider call.
  const recoverable = missing.filter((entry) => entry.region);
  const unrecoverable = missing.filter((entry) => !entry.region);
  if (!recoverable.length) {
    return {
      worthIt: false,
      crops: [],
      fields: unrecoverable.map((entry) => entry.field),
      reason: "missing_but_not_visible",
      recoverableValue: 0
    };
  }

  recoverable.sort((a, b) => b.weight - a.weight);
  const crops = [];
  const fields = [];
  let recoverableValue = 0;
  for (const entry of recoverable) {
    if (!crops.includes(entry.region)) {
      if (crops.length >= maxCrops) continue;
      crops.push(entry.region);
    }
    fields.push(entry.field);
    recoverableValue += entry.weight;
  }

  // Below the threshold the second call costs more latency than the field is
  // worth. One missing team on an otherwise complete card is not worth 3.5
  // seconds; a missing player and year is.
  if (recoverableValue < minValue) {
    return { worthIt: false, crops: [], fields, reason: "not_worth_the_latency", recoverableValue };
  }
  return { worthIt: true, crops, fields, reason: "recoverable_fields_missing", recoverableValue };
}
