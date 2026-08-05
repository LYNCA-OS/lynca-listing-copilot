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
  dedupeAdjacentTokens,
  inferParentManufacturer,
  stripCategoryFiller
} from "./marketplace-composer-rules.mjs";
import {
  semStandardTitleOrder,
  semTcgTitleOrder,
  semLotTitleOrder,
  semCanonicalBracket
} from "../csm/sem-definition.mjs";
import { productsSemanticallyEquivalent } from "../csm/product-semantics.mjs";

// The subset of CSM's canonical fields this path carries. Filtering the
// standard order by this set keeps the ORDER canonical while letting the schema
// stay small -- a field we do not collect simply never appears, rather than the
// order being rewritten around what we happen to have.
const THIN_FIELDS = new Set([
  "lot", "ip", "language", "year", "manufacturer", "manufacturer_product_set", "product", "set",
  "subject", "card_name", "release_variant", "print_finish", "numerical_rarity",
  "descriptive_rarity", "card_number",
  "search_optimization", "grading_info"
]);

// Bracket names differ per grammar -- TCG says [Product Finish] where Standard
// says [Print Finish] -- and filtering an order by names from another grammar's
// vocabulary drops those brackets without erroring. It did: TCG titles lost
// "Shiny Ultra Rare Full Art" while the composer reported `dropped: []`,
// correctly, because the bracket was never in the order to begin with.
//
// The translation now comes from CSM via `semCanonicalBracket`. It lived here
// as a private table, which is the guessing COS-39 describes: this layer was
// inferring a mapping the contract had never stated, and got it wrong twice.

function insertAfter(order, anchor, name) {
  const index = order.indexOf(anchor);
  if (index < 0) return [...order, name];
  return [...order.slice(0, index + 1), name, ...order.slice(index + 1)];
}

export const BRACKET_ORDER = Object.freeze({
  // COS-41 (founder, 2026-08-04): there is no [Visible Components] bracket.
  // Auto, RC, Patch and Relic belong to [Search Optimization], and
  // `observable_components` is an implementation grouping rather than a CSM
  // semantic field. The previous entry here slotted it after [Numerical
  // Rarity] and was marked in this comment as the one inference in the table;
  // the decision replaced the inference rather than confirming it.
  standard: Object.freeze(semStandardTitleOrder.filter((name) => THIN_FIELDS.has(name))),
  tcg: Object.freeze([...new Set(semTcgTitleOrder.map((name) => semCanonicalBracket("tcg", name)))]
    .filter((name) => THIN_FIELDS.has(name))),
  // semLotTitleOrder carries `shared_numerical_rarity`. The hand-written Lot
  // grammar dropped the print run entirely on the reasoning that a lot has no
  // single copy number -- CSM disagrees, and it is the contract.
  lot: Object.freeze(semLotTitleOrder.map((name) => semCanonicalBracket("lot", name)).filter((name) => THIN_FIELDS.has(name)))
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
    "manufacturer", "product", "set", "release_variant", "card_name", "year"
  ]),
  // COS-9 TCG Grammar inverts two of those. Manufacturer and Product are
  // ****, the LOWEST tier -- "in the vast majority of marketplace listings
  // these fields should be omitted", because Set is the product identifier in
  // TCG ecosystems. Card Number is * and must survive; Variant, Product Finish
  // and Descriptive Rarity are **.
  tcg: Object.freeze([
    "manufacturer", "product",
    "descriptive_rarity", "release_variant", "print_finish",
    "set", "card_name", "year"
  ]),
  lot: Object.freeze([
    "descriptive_rarity", "release_variant",
    "print_finish", "card_name", "extra_subjects", "year", "manufacturer_product_set"
  ])
});

// CSM bracket name -> the field this path collects. Where the schema already
// uses CSM's name the map is the identity and the entry is omitted.
const FIELD_FOR_BRACKET = Object.freeze({
  subject: "subjects",
  numerical_rarity: "serial",
  grading_info: "grade",
  search_optimization: "team"
});

const fieldFor = (name) => FIELD_FOR_BRACKET[name] || name;
const isEmptyBracket = (value) => !value || (Array.isArray(value) && value.length === 0);

function inputValueForBracket(name, fields = {}) {
  if (name === "lot") return fields.lot_count;
  // COS-39: a composition responsibility over three canonical fields, not a
  // fourth field and not an alias for the first of them.
  if (name === "manufacturer_product_set") {
    return [fields.manufacturer, fields.product, fields.set].filter(Boolean).join(" ");
  }
  return fields[fieldFor(name)];
}

function normalizeSlashSpacing(value) {
  return String(value ?? "").replace(/\s*\/\s*/g, "/").trim();
}

function normalizedComponentToken(value) {
  return compressAutograph(value).title.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Remove only semantic duplicates from the component bracket.
 *
 * This is deliberately narrower than global token de-duplication. `Triple`
 * may legitimately occur in Product and Card Name, but `Auto` need not be
 * rendered twice after `Autograph` was already normalized to `Auto`. Patch,
 * Jersey and Relic deliberately stay distinct: reviewed titles sometimes use
 * both a subtype and `Relic`, and CSM names them separately.
 */
function compactObservableComponents(fields, normalizationReasons) {
  const components = [...(fields.components || [])];
  const identityText = [
    fields.card_name,
    fields.release_variant,
    fields.print_finish,
    fields.descriptive_rarity,
    fields.grade
  ].map((value) => compressAutograph(value).title).join(" ");

  return components.filter((component) => {
    const key = normalizedComponentToken(component);
    const token = compressAutograph(component).title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (token && new RegExp(`(?:^|\\s)${token}(?:$|\\s|[,;/])`, "i").test(identityText)) {
      normalizationReasons.push(`observable_components:${key}_duplicate`);
      return false;
    }
    return true;
  });
}

/**
 * Product is a hierarchy. When the full leaf would make Composer delete the
 * entire Product bracket, offer only contract-safe parent forms. The canonical
 * value remains untouched; this is marketplace serialization only.
 */
function productHierarchyCandidates(value, { preserveTypedIdentity = true } = {}) {
  const full = String(value ?? "").replace(/\s+/g, " ").trim();
  const candidates = [{ value: full, reason: null }];
  const push = (candidate, reason) => {
    const text = String(candidate ?? "").replace(/\s+/g, " ").trim();
    if (!text || candidates.some((row) => row.value === text)) return;
    candidates.push({ value: text, reason });
  };

  const displayFull = stripCategoryFiller(full, { semanticRole: preserveTypedIdentity ? "product" : "description" }).title;
  const hierarchyBase = displayFull
    .replace(/\s+The\s+Complete\s+Series\s+Volume\s+\d+$/i, "")
    .replace(/\s+Collection$/i, "");
  if (hierarchyBase !== displayFull) {
    push(hierarchyBase, /Collection$/i.test(displayFull)
      ? "product:collection_suffix_removed"
      : "product:hierarchy_suffix_removed");
  }

  return candidates;
}

function singleLeafAfterManufacturer(product, manufacturer) {
  const full = String(product ?? "").replace(/\s+/g, " ").trim();
  const prefix = String(manufacturer ?? "").trim();
  if (!full || !prefix) return "";
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = full.match(new RegExp(`^${escaped}\\s+([^\\s]+)$`, "i"));
  return match ? match[1] : "";
}

function renderBracket(name, fields, {
  preserveTypedIdentity = true,
  suppressedHere = false,
  retainable = []
} = {}) {
  switch (name) {
    // "LotxN" when the count was read, a bare "Lot" when it was not.
    //
    // COS-49 (Fei, 2026-08-04) names `LotxN` as the ONE merchant-facing quantity
    // marker, and names the split this code created -- `LotxN` in
    // listing-renderer.mjs against `Lot*N` here -- as implementation drift to
    // close. The `*` spelling came out of a conversation and was never written
    // into Linear, so under COS-49's authority order it does not outrank the
    // decision that was.
    //
    // The reviewed corpus agrees with Linear: writers spell it `lot`, `lotx4`,
    // `Lotx16`. None writes `Lot*4`. The earlier "n Card Lot" rendering that
    // both spellings replaced is the one no writer uses at all.
    //
    // Position stays where CSM's lot grammar puts it -- `lot_quantity` is its
    // opening bracket. Inventing a count from `subjects`, which caps at 3,
    // would be a fabricated value in the grammar's highest-priority bracket.
    // COS-14 (Fei, re-confirmed 2026-08-04) names `LotxN` as the ONE approved
    // quantity format, and requires abstaining when the count cannot be
    // established: "route for review or abstain rather than inventing N".
    //
    // Two states used to ship a title anyway. `lot_count` arrives as a STRING,
    // so "0" is truthy and rendered `Lotx0` -- a lot of no cards. A missing
    // count fell through to a bare `Lot`, which is a fourth marker the contract
    // never approved, alongside the three it names as forbidden. Neither
    // invents an N, but neither abstains either: both put an unapproved
    // quantity marker in the grammar's highest-priority bracket.
    //
    // The bracket is now emitted only for a positive integer. Anything else
    // yields nothing here and is reported as `lot_quantity_unresolved` on the
    // result, which is the caller's signal to route for review.
    case "lot": {
      const count = String(fields.lot_count ?? "").trim();
      return /^[1-9]\d*$/.test(count) ? `Lotx${count}` : "";
    }
    // COS-39 (founder, 2026-08-04): this bracket is a composition duty over
    // three canonical fields, and must "emit the most specific, widely accepted
    // market expression" -- never concatenate all three, never pick one blindly.
    //
    //   Topps + Topps Chrome + Topps Chrome Update -> Topps Chrome Update
    //   Topps + Topps Chrome + Topps Chrome Disney -> Topps Chrome Disney
    //
    // The previous branch read `product` alone, so a lot title carrying
    // "Topps Chrome Update" rendered as "Topps Chrome" and silently lost the
    // set. Picking one field blindly is exactly what the decision forbids.
    case "manufacturer_product_set": {
      const role = { semanticRole: preserveTypedIdentity ? "product" : "description" };
      const [maker, product, set] = [fields.manufacturer, fields.product, fields.set]
        .map((v) => stripCategoryFiller(v, role).title.trim());
      const contains = (outer, inner) => Boolean(outer && inner)
        && outer.length > inner.length && outer.toLowerCase().includes(inner.toLowerCase());

      // The decision's examples are all CONTAINMENT: Topps inside Topps Chrome
      // inside Topps Chrome Update. There the most specific member of the chain
      // is the whole answer.
      if (contains(set, product) || (contains(set, maker) && !product)) return set;
      if (contains(product, maker)) return dedupeAdjacentTokens([product, set].filter(Boolean).join(" ")).title;

      // No chain. "Bowman Briefing" is an insert line beside "Bowman Chrome",
      // not an extension of it, and emitting all three produces "Topps Bowman
      // Chrome Bowman Briefing" -- the concatenation the decision forbids, and
      // a phrase no writer publishes. The product is the widely accepted
      // expression here, with the manufacturer only when it is not implied.
      return dedupeAdjacentTokens([maker, product].filter(Boolean).join(" ")).title;
    }
    case "manufacturer_product": {
      const product = stripCategoryFiller(fields.product,
        { semanticRole: preserveTypedIdentity ? "product" : "description" }).title;
      // The schema tells the model not to repeat the manufacturer inside the
      // product, and one card in 150 does it anyway ("BBM" plus "BBM Rookie
      // Edition" rendering as "BBM BBM Rookie Edition"). The instruction is
      // right and the composer should not depend on it being followed: a
      // deterministic stage that trusts the model's compliance is not
      // deterministic. Reuses the existing dedupe rather than adding a second
      // copy of the same rule.
      return dedupeAdjacentTokens([fields.manufacturer, product].filter(Boolean).join(" ")).title;
    }
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
    // COS-41: the components live here, in CSM's own bracket for them. When a
    // profile suppresses this bracket the retained subset still renders --
    // suppressing the whole thing removed `auto` and `rc` from every eBay
    // title, worth -0.03 across 255 cards, which the decision names as a
    // Composer priority problem rather than a missing CSM field.
    case "search_optimization": {
      const components = fields.components || [];
      const team = String(fields.team || "").trim();
      if (!suppressedHere) return [team, ...components].filter(Boolean).join(" ");
      const retained = components.filter((c) =>
        retainable.includes(compressAutograph(c).title.toLowerCase()));
      return retained.join(" ");
    }
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

function assemble(fields, order, omitted, {
  preserveTypedIdentity = true,
  partiallySuppressed = new Map()
} = {}) {
  const seen = new Set();
  const brackets = [];
  for (const name of order) {
    if (omitted.has(name)) continue;
    // A bracket the profile suppresses but whose high-value terms are retained
    // reaches here rather than being skipped. Skipping it entirely is what
    // removed `auto` and `rc` from every eBay title; COS-41 says that is a
    // Composer priority problem, so the priority is expressed here instead of
    // by promoting those terms into a bracket of their own.
    const retainable = partiallySuppressed.get(name) || null;
    let text = renderBracket(name, fields, {
      preserveTypedIdentity,
      suppressedHere: Boolean(retainable),
      retainable: retainable || []
    });
    // Per bracket rather than on the finished title, so the Lot bracket's own
    // "2 Card Lot" is rendered before anything looks at the word "Card".
    if (name !== "lot" && name !== "manufacturer_product") {
      const semanticRole = preserveTypedIdentity && (name === "manufacturer" || name === "product")
        ? name
        : "description";
      text = stripCategoryFiller(text, { semanticRole }).title;
    }
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
export function composeFromCanonicalFields(fields, {
  profile = MARKETPLACE_PROFILES.ebay,
  limit,
  features = {}
} = {}) {
  // This recovery is deliberately outside the normal priority walk. First
  // render the exact current policy, then consider a leaf only when that
  // policy would delete BOTH repeated Manufacturer and Product. That keeps a
  // separately retained Manufacturer untouched on other schema shapes.
  if (features.product_leaf_recovery !== false) {
    const withoutLeafRecovery = composeFromCanonicalFields(fields, {
      profile,
      limit,
      features: { ...features, product_leaf_recovery: false }
    });
    const manufacturer = fields?.manufacturer;
    const leaf = singleLeafAfterManufacturer(fields?.product, manufacturer);
    if (withoutLeafRecovery.dropped.includes("manufacturer")
      && withoutLeafRecovery.dropped.includes("product")
      && leaf) {
      const withLeaf = composeFromCanonicalFields({ ...fields, product: leaf }, {
        profile,
        limit,
        features: { ...features, product_leaf_recovery: false }
      });
      if (withLeaf.length <= (limit ?? profile.characterBudget)
        && !withLeaf.dropped.includes("product")) {
        return {
          ...withLeaf,
          normalization_reasons: [
            ...withLeaf.normalization_reasons,
            "product:manufacturer_prefix_removed"
          ]
        };
      }
    }
    return withoutLeafRecovery;
  }
  const budget = limit ?? profile.characterBudget;
  const grammar = BRACKET_ORDER[fields?.grammar] ? fields.grammar : "standard";
  const order = BRACKET_ORDER[grammar];
  const useSlashSpacing = features.slash_spacing !== false;
  const useComponentDedupe = features.component_dedupe !== false;
  const preserveTypedIdentity = features.typed_identity !== false;
  const useProductHierarchy = features.product_hierarchy !== false;

  // CSM's own product comparison rather than a string prefix test.
  const productRedundant = fields.manufacturer && fields.product
    && productsSemanticallyEquivalent(fields.manufacturer, fields.product);

  const normalizationReasons = [];
  const manufacturerCategory = preserveTypedIdentity
    ? stripCategoryFiller(fields.manufacturer, { semanticRole: "manufacturer" })
    : { preserved: false };
  const productCategory = preserveTypedIdentity
    ? stripCategoryFiller(fields.product, { semanticRole: "product" })
    : { preserved: false };
  if (manufacturerCategory.preserved) normalizationReasons.push("manufacturer:identity_category_preserved");
  if (productCategory.preserved) normalizationReasons.push("product:identity_category_preserved");
  const compressedFinish = compressAutograph(fields.print_finish ?? "");
  const compressedCardName = compressAutograph(fields.card_name ?? "");
  if (compressedFinish.applied) normalizationReasons.push("print_finish:autograph_to_auto");
  if (compressedCardName.applied) normalizationReasons.push("card_name:autograph_to_auto");

  const normalizedSerial = useSlashSpacing ? normalizeSlashSpacing(fields.serial) : String(fields.serial ?? "");
  const normalizedCardNumber = useSlashSpacing ? normalizeSlashSpacing(fields.card_number) : String(fields.card_number ?? "");
  if (normalizedSerial !== String(fields.serial ?? "").trim()) {
    normalizationReasons.push("numerical_rarity:separator_spacing_normalized");
  }
  if (normalizedCardNumber !== String(fields.card_number ?? "").trim()) {
    normalizationReasons.push("card_number:separator_spacing_normalized");
  }

  const working = {
    ...fields,
    product: productRedundant ? "" : fields.product,
    print_finish: compressedFinish.title,
    card_name: compressedCardName.title,
    serial: normalizedSerial,
    card_number: normalizedCardNumber,
    manufacturer: fields.manufacturer || inferParentManufacturer(fields.product) || ""
  };
  working.components = useComponentDedupe
    ? compactObservableComponents(working, normalizationReasons)
    : [...(working.components || [])];
  const inferredParent = !fields.manufacturer && working.manufacturer ? working.manufacturer : null;

  // Profile-level suppression, before anything else: these brackets are in the
  // canonical object and simply not projected onto this marketplace. They are
  // not "dropped" -- dropping is what priority compression does when the budget
  // is tight, and reporting them as dropped would make a standing policy look
  // like a per-card accident.
  const suppressed = Object.entries(profile.suppress || {})
    .filter(([, grammars]) => grammars.includes(grammar))
    .map(([name]) => name);
  // Suppression is a policy about a bracket, but not always about every term
  // in it. Where the profile names terms to retain, the bracket stays in the
  // order and renders only those; where it names none, it is omitted as before.
  const partiallySuppressed = new Map();
  for (const name of suppressed) {
    const retainable = profile.retainWithinSuppressed?.[name];
    if (retainable?.length) partiallySuppressed.set(name, retainable);
  }
  const omitted = new Set(suppressed.filter((name) => !partiallySuppressed.has(name)));

  const empty = order.filter((name) => name !== "lot" && name !== "manufacturer_product_set"
    && isEmptyBracket(working[fieldFor(name)]));
  const inputEmpty = order.filter((name) => isEmptyBracket(inputValueForBracket(name, fields)));

  let trimmedSubjects = false;
  let brackets = assemble(working, order, omitted, { preserveTypedIdentity, partiallySuppressed });
  const render = () => {
    brackets = assemble(working, order, omitted, { preserveTypedIdentity, partiallySuppressed });
    return brackets.map((entry) => entry.text).join(" ");
  };
  let title = brackets.map((entry) => entry.text).join(" ");

  // Priority compression: yield whole brackets, lowest priority first, and stop
  // as soon as it fits. Dropping the cheapest bracket that gets under budget
  // would make the output depend on value lengths rather than the contract's
  // ranking -- which is the "model preference" the contract is written against.
  for (const name of DROP_ORDER[grammar]) {
    if (title.length <= budget) break;
    // Try the parent form before the first high-priority identity bracket is
    // removed. Never wait until Manufacturer has already yielded and then
    // trade it for Product; the two share COS-8's highest tier.
    if (useProductHierarchy && name === "manufacturer" && !omitted.has("product")) {
      const originalProduct = working.product;
      const candidates = productHierarchyCandidates(originalProduct, { preserveTypedIdentity }).slice(1);
      let compacted = null;
      for (const candidate of candidates) {
        working.product = candidate.value;
        const candidateTitle = render();
        if (candidateTitle.length <= budget) {
          compacted = { ...candidate, title: candidateTitle };
          break;
        }
      }
      if (compacted) {
        title = compacted.title;
        normalizationReasons.push(compacted.reason);
        break;
      }
      working.product = originalProduct;
      title = render();
    }
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
    input_empty_fields: inputEmpty,
    unreadable: [...(working.unreadable ?? [])],
    low_confidence: [...(working.low_confidence ?? [])],
    inferred_parent: inferredParent,
    // COS-14: a lot whose count could not be established must be routed for
    // review, not published with an unapproved marker. The composer's duty is
    // to withhold the bracket and say so; routing is the caller's.
    lot_quantity_unresolved: working.grammar === "lot"
      && !/^[1-9]\d*$/.test(String(working.lot_count ?? "").trim()),
    normalization_reasons: [...new Set(normalizationReasons)],
    character_budget: budget,
    length: title.length
  };
}
