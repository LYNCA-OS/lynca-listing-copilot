import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeText,
  displayCardNumber,
  productHierarchyText,
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
  return serialLimitText(resolved.numerical_rarity, { oneOfOne: resolved.one_of_one })
    || (resolved.one_of_one ? "1/1" : "");
}

export function renderGenericTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const collector = resolved.collector_number
    ? `#${displayCardNumber(resolved.collector_number, resolved)}`
    : "";
  const items = [
    { key: "year", text: resolved.year, priority: 8 },
    { key: "product_identity", text: productHierarchyText(resolved), priority: 5, required: Boolean(productHierarchyText(resolved)), compactable: true },
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
