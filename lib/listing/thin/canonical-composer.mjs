// Canonical fields -> marketplace title. Deterministic, no model, no lookups.
//
// The bracket ORDER is imported from CSM, not written here. The hand-written
// table this replaced got two things wrong against the standard that was in the
// repository the whole time: [Card Number] sat BEFORE [Numerical Rarity], and
// [Subject] sat after [Release Variant]. An ordering I choose drifts toward
// what I am building; the contract's does not.

import {
  MARKETPLACE_PROFILES,
  compressAutograph,
  inferParentManufacturer,
  stripCategoryFiller
} from "./marketplace-composer-rules.mjs";
import {
  semStandardTitleOrder,
  semTcgTitleOrder,
  semLotTitleOrder
} from "../csm/sem-definition.mjs";
import { productsSemanticallyEquivalent } from "../csm/product-semantics.mjs";

// The subset of CSM's canonical fields this path carries. Filtering the
// standard order by this set keeps the ORDER canonical while letting the schema
// stay small -- a field we do not collect simply never appears, rather than the
// order being rewritten around what we happen to have.
const THIN_FIELDS = new Set([
  "lot", "ip", "year", "manufacturer", "manufacturer_product", "product", "set",
  "subject", "card_name", "release_variant", "print_finish", "numerical_rarity",
  "descriptive_rarity", "observable_components", "card_number",
  "search_optimization", "grading_info"
]);

// CSM's TCG grammar names the same concepts differently from the Standard one:
// [Variant] and [Product Finish] where Standard says [Release Variant] and
// [Print Finish]. Without this map the filter silently drops the parallel
// bracket from every TCG title -- which it did, and the composed title lost
// "Shiny Ultra Rare Full Art" while reporting `dropped: []`, because nothing
// was dropped: the bracket was never in the order to begin with.
const TCG_ALIASES = Object.freeze({
  variant: "release_variant",
  product_finish: "print_finish"
});

// CSM's Lot grammar collapses manufacturer + product + set into ONE bracket.
// Mapping it to `manufacturer` alone silently dropped the product from every
// lot title -- "12 Card Lot 2023 Panini ..." with no "Prizm".
const LOT_ALIASES = Object.freeze({
  lot_quantity: "lot",
  manufacturer_product_set: "manufacturer_product",
  subjects_max_3: "subject",
  shared_card_name_or_design: "card_name",
  shared_print_finish: "print_finish",
  shared_numerical_rarity: "numerical_rarity"
});

function insertAfter(order, anchor, name) {
  const index = order.indexOf(anchor);
  if (index < 0) return [...order, name];
  return [...order.slice(0, index + 1), name, ...order.slice(index + 1)];
}

export const BRACKET_ORDER = Object.freeze({
  // NOTE: `observable_components` (Auto / RC / Patch / Relic) is a CSM field --
  // it is in `csmFieldLabels` and the keep-list names "Auto, RC" explicitly --
  // but `semStandardTitleOrder` does not place it. Slotting it after
  // [Numerical Rarity] is MY inference, and it is the only entry here that is.
  standard: Object.freeze(insertAfter(
    semStandardTitleOrder.filter((name) => THIN_FIELDS.has(name)),
    "numerical_rarity", "observable_components"
  )),
  tcg: Object.freeze(insertAfter(
    [...new Set(semTcgTitleOrder.map((name) => TCG_ALIASES[name] || name))].filter((name) => THIN_FIELDS.has(name)),
    "numerical_rarity", "observable_components"
  )),
  // semLotTitleOrder carries `shared_numerical_rarity`. The hand-written Lot
  // grammar dropped the print run entirely on the reasoning that a lot has no
  // single copy number -- CSM disagrees, and it is the contract.
  lot: Object.freeze(semLotTitleOrder.map((name) => LOT_ALIASES[name] || name).filter((name) => THIN_FIELDS.has(name)))
});

/**
 * Which bracket yields first when over budget: the inverse of the keep-list
 * ("Subject, Card Name, Print Finish, Numerical Rarity, Auto, RC, Grade").
 * `subject` and `grading_info` are in no list: they are the identity and the
 * price, and a title that has lost either is not cheaper, it is a different
 * card. `search_optimization` is absent because the eBay profile suppresses it
 * before the budget is ever consulted.
 */
export const DROP_ORDER = Object.freeze({
  // COS-8 Standard Card Grammar assigns three priority tiers and says
  // compression removes them in order: tertiary, then secondary, then highest
  // "only if absolutely necessary".
  //
  //   ***  Card Number
  //   **   Print Finish, Descriptive Rarity
  //   *    Year, Manufacturer, Product, Set, Subject, Card Name,
  //        Release Variant, Numerical Rarity, Search Optimization, Grading Info
  //
  // The previous table was written from the Marketplace Composer keep-list
  // alone and put Release Variant second to yield, when COS-8 has it in the
  // highest tier. Subject, Numerical Rarity and Grading Info are absent from
  // every list here: they are identity and price, and the grammar says the
  // highest tier goes only as a last resort.
  standard: Object.freeze([
    "card_number",
    "print_finish", "descriptive_rarity",
    "manufacturer", "product", "set", "release_variant", "card_name",
    "observable_components", "year"
  ]),
  // COS-9 TCG Grammar inverts two of those. Manufacturer and Product are
  // ****, the LOWEST tier -- "in the vast majority of marketplace listings
  // these fields should be omitted", because Set is the product identifier in
  // TCG ecosystems. Card Number is * and must survive; Variant, Product Finish
  // and Descriptive Rarity are **.
  tcg: Object.freeze([
    "manufacturer", "product",
    "descriptive_rarity", "release_variant", "print_finish",
    "observable_components", "set", "card_name", "year"
  ]),
  lot: Object.freeze([
    "observable_components", "descriptive_rarity", "release_variant",
    "print_finish", "card_name", "extra_subjects", "year", "manufacturer_product"
  ])
});

// CSM bracket name -> the field this path collects. Where the schema already
// uses CSM's name the map is the identity and the entry is omitted.
const FIELD_FOR_BRACKET = Object.freeze({
  subject: "subjects",
  numerical_rarity: "serial",
  grading_info: "grade",
  search_optimization: "team",
  observable_components: "components"
});

const fieldFor = (name) => FIELD_FOR_BRACKET[name] || name;
const isEmptyBracket = (value) => !value || (Array.isArray(value) && value.length === 0);

function renderBracket(name, fields) {
  switch (name) {
    // "[Lot*n]" when the count was read, a bare "Card Lot" when it was not.
    // Inventing a count from `subjects` -- which caps at 3 -- would be a
    // fabricated value in the highest-priority bracket of the grammar.
    case "lot":
      return fields.lot_count ? `${fields.lot_count} Card Lot` : "Card Lot";
    case "manufacturer_product":
      return [fields.manufacturer, fields.product].filter(Boolean).join(" ");
    case "subject":
      return (fields.subjects || []).join(" ");
    case "card_number":
      return fields.card_number ? `#${fields.card_number}` : "";
    // [Print Finish] is projected only when GROUNDED: the exact name was printed
    // on the card, or a colour comes with a finish family the model recognised.
    // A bare colour is not projected.
    //
    // Measured on 150 cards. Making surface_color a required enum raised
    // coverage a lot -- a colour present on 59 of the 68 cards that have one,
    // up from 41 -- but 17 of those 59 were the WRONG colour, 29% against 22%
    // before. Under F1 a wrong colour costs precision and buys almost no
    // recall, and the change came out at -0.0112 overall. Projecting only the
    // grounded ones recovers +0.0064 (31 wins : 10 losses) and keeps "Gold
    // Refractor" whole; 46 of 148 cards carry a bare colour and are the ones
    // this withholds.
    //
    // The colour stays in the canonical object either way. This is a
    // marketplace projection decision of the same kind as [Card Number] and
    // [Search Optimization], and it is what CSM's own warning asks for:
    // "never default a reflective card to Silver".
    case "print_finish": {
      if (fields.parallel_exact) return fields.parallel_exact;
      if (fields.surface_color && fields.parallel_family) return fields.print_finish || "";
      if (fields.parallel_family) return fields.parallel_family;
      return "";
    }
    case "observable_components":
      return (fields.components || []).join(" ");
    default:
      return fields[fieldFor(name)] ?? "";
  }
}

const tokenKey = (word) => word.toLowerCase().replace(/[^a-z0-9/&.-]/g, "");

/**
 * Drop a bracket's LEADING tokens when an earlier bracket already said them.
 *
 * Leading only, and this is the whole design. Removing every repeated token
 * anywhere was the first version, and it turned the variant "Historic Ties
 * Triple Relic" into "Historic Ties Relic" because the product happened to be
 * "Triple Threads" -- a real word deleted from a keep-list bracket to save
 * nothing. Duplication between fields shows up as a shared prefix.
 */
function dropRepeatedPrefix(text, seen) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < words.length && seen.has(tokenKey(words[start]))) start += 1;
  const kept = words.slice(start);
  for (const word of kept) seen.add(tokenKey(word));
  return kept.join(" ");
}

function assemble(fields, order, omitted) {
  const seen = new Set();
  const brackets = [];
  for (const name of order) {
    if (omitted.has(name)) continue;
    let text = renderBracket(name, fields);
    // Per bracket rather than on the finished title, so the Lot bracket's own
    // "2 Card Lot" is rendered before anything looks at the word "Card".
    if (name !== "lot") text = stripCategoryFiller(text).title;
    if (!text) continue;
    // Subject and grade are never de-duplicated away: a player whose surname
    // matches the product ("Bowman") would lose their name to the set.
    if (name !== "subject" && name !== "grading_info") text = dropRepeatedPrefix(text, seen);
    else for (const word of text.split(/\s+/)) seen.add(tokenKey(word));
    if (text) brackets.push({ bracket: name, text });
  }
  return brackets;
}

/**
 * Compose a marketplace title from canonical fields.
 */
export function composeFromCanonicalFields(fields, { profile = MARKETPLACE_PROFILES.ebay, limit } = {}) {
  const budget = limit ?? profile.characterBudget;
  const grammar = BRACKET_ORDER[fields?.grammar] ? fields.grammar : "standard";
  const order = BRACKET_ORDER[grammar];

  // CSM's own product comparison rather than a string prefix test.
  const productRedundant = fields.manufacturer && fields.product
    && productsSemanticallyEquivalent(fields.manufacturer, fields.product);

  const working = {
    ...fields,
    product: productRedundant ? "" : fields.product,
    print_finish: compressAutograph(fields.print_finish ?? "").title,
    card_name: compressAutograph(fields.card_name ?? "").title,
    manufacturer: fields.manufacturer || inferParentManufacturer(fields.product) || ""
  };
  const inferredParent = !fields.manufacturer && working.manufacturer ? working.manufacturer : null;

  // Profile-level suppression, before anything else: these brackets are in the
  // canonical object and simply not projected onto this marketplace. They are
  // not "dropped" -- dropping is what priority compression does when the budget
  // is tight, and reporting them as dropped would make a standing policy look
  // like a per-card accident.
  const suppressed = Object.entries(profile.suppress || {})
    .filter(([, grammars]) => grammars.includes(grammar))
    .map(([name]) => name);
  const omitted = new Set(suppressed);

  const empty = order.filter((name) => name !== "lot" && name !== "manufacturer_product"
    && isEmptyBracket(working[fieldFor(name)]));

  let trimmedSubjects = false;
  let brackets = assemble(working, order, omitted);
  const render = () => {
    brackets = assemble(working, order, omitted);
    return brackets.map((entry) => entry.text).join(" ");
  };
  let title = brackets.map((entry) => entry.text).join(" ");

  // Priority compression: yield whole brackets, lowest priority first, and stop
  // as soon as it fits. Dropping the cheapest bracket that gets under budget
  // would make the output depend on value lengths rather than the contract's
  // ranking -- which is the "model preference" the contract is written against.
  for (const name of DROP_ORDER[grammar]) {
    if (title.length <= budget) break;
    if (name === "extra_subjects") {
      if (working.subjects.length <= 1) continue;
      working.subjects = working.subjects.slice(0, 1);
      trimmedSubjects = true;
    } else {
      if (name !== "manufacturer_product" && (isEmptyBracket(working[fieldFor(name)]) || omitted.has(name))) continue;
      if (name === "manufacturer_product" && omitted.has(name)) continue;
      omitted.add(name);
    }
    title = render();
  }

  // Restore pass, highest priority first.
  //
  // Yielding one bracket at a time overshoots whenever a low-priority bracket
  // is long: a TCG card dropped three cheap brackets and only then reached the
  // long one, ending 21 characters under budget. Walking the drop list backwards
  // and reinstating whatever now fits spends that slack in contract order -- a
  // bracket only returns if every higher-priority bracket was offered the room.
  const restored = [];
  for (const name of [...DROP_ORDER[grammar]].reverse()) {
    if (name === "extra_subjects" || suppressed.includes(name) || !omitted.has(name)) continue;
    omitted.delete(name);
    const candidate = render();
    if (candidate.length <= budget) { title = candidate; restored.push(name); }
    else omitted.add(name);
  }
  title = render();

  const dropped = [
    ...DROP_ORDER[grammar].filter((name) => omitted.has(name) && !suppressed.includes(name)),
    ...(trimmedSubjects ? ["extra_subjects"] : [])
  ];

  // Backstop, and it should stay rare. Everything still standing is on the
  // keep-list, so a cut here removes something the contract says to preserve.
  let truncated = false;
  if (title.length > budget) {
    const cut = title.slice(0, budget);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
    truncated = true;
  }

  return {
    title,
    grammar,
    marketplace: profile.id,
    brackets: brackets.map((entry) => entry.bracket),
    bracket_text: brackets,
    dropped,
    suppressed,
    restored,
    truncated,
    empty_fields: empty,
    unreadable: [...(working.unreadable ?? [])],
    low_confidence: [...(working.low_confidence ?? [])],
    inferred_parent: inferredParent,
    length: title.length
  };
}
