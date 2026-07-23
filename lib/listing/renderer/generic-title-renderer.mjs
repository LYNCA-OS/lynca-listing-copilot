import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeText,
  brandIdentityText,
  displayCardNumber,
  pushUniquePhrase,
  renderGrade,
  serialLimitText,
  subjectText
} from "./title-cleanup.mjs";
import { titleParallelText } from "../parallel-policy.mjs";
import { cardTypeTextParts } from "../card-type-policy.mjs";

function parallelVariantText(resolved = {}) {
  return titleParallelText(resolved);
}

function variantTexts(resolved) {
  const parts = [];
  [
    resolved.insert,
    parallelVariantText(resolved),
    resolved.variation,
    resolved.subset
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts;
}

function attributeTexts(resolved) {
  return [
    resolved.rc ? "RC" : null,
    resolved.first_bowman ? "1st Bowman" : null,
    resolved.ssp ? "SSP" : null,
    resolved.case_hit ? "Case Hit" : null,
    resolved.one_of_one ? "1/1" : null
  ].filter(Boolean);
}

function cardTypeTexts(resolved) {
  return cardTypeTextParts(resolved);
}

function numericalRarityText(resolved = {}) {
  return serialLimitText(resolved, { oneOfOne: resolved.one_of_one })
    || (resolved.one_of_one ? "1/1" : "");
}

export function renderGenericTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  // A bare numeric collector number (standard_card_number, SEM weight 1) is not
  // a title field and reviewed titles omit it; suppress only the numeric form so
  // it never inflates titles. Alphabetic insert/parallel codes are kept.
  const rawCollector = resolved.collector_number
    ? displayCardNumber(resolved.collector_number, resolved)
    : "";
  const collector = rawCollector && !/^#?\d+$/.test(rawCollector)
    ? `#${rawCollector.replace(/^#/, "")}`
    : "";
  const brand = brandIdentityText(resolved);
  const product = normalizeText(resolved.product || resolved.set || brand);
  const set = normalizeText(resolved.product ? resolved.set : "");
  const items = [
    { key: "year", text: resolved.year, priority: 8 },
    // Generic entertainment/non-sport identities often have a long publisher
    // plus release/set hierarchy. Keeping that entire phrase as one required
    // atom can crowd out the subject, autograph/relic identity and grading.
    // Product is the stable identity floor; publisher and set remain useful
    // optional context and are admitted only after higher-weight SEM modules.
    { key: "franchise_brand", text: brand, priority: 40, compactable: true },
    { key: "product_identity", text: product, priority: 5, required: Boolean(product), compactable: true },
    { key: "product_set", text: set, priority: 28, compactable: true },
    { key: "subject", text: subjectText(resolved), priority: 10, required: Boolean(subjectText(resolved)), compactable: true },
    { key: "card_name", text: resolved.card_name, priority: 7, compactable: true },
    ...cardTypeTexts(resolved).map((text) => ({ key: "release_variant", text, priority: 20 })),
    ...variantTexts(resolved).map((text) => ({ key: "release_variant", text, priority: 28 })),
    {
      key: "serial_limit",
      text: numericalRarityText(resolved),
      priority: 6,
      required: Boolean(numericalRarityText(resolved)),
      compactable: false
    },
    { key: "card_number", text: collector, priority: 95 },
    ...attributeTexts(resolved).map((text) => ({ key: "search_optimization", text, priority: 16 })),
    { key: "grading", text: renderGrade(resolved), priority: 6, compactable: false }
  ].filter((item) => normalizeText(item.text));
  const fitted = fitTitleItems(items, { maxLength });

  return {
    title: fitted.title,
    policy: fitted.policy
  };
}
