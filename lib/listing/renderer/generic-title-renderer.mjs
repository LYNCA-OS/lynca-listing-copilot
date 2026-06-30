import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeText,
  brandIdentityText,
  productSetText,
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

export function renderGenericTitle(resolved = {}, {
  maxLength = 85
} = {}) {
  const collector = resolved.collector_number
    ? `#${String(resolved.collector_number).replace(/^#/, "")}`
    : "";
  const items = [
    { key: "year", text: resolved.year, priority: 34 },
    { key: "franchise_brand", text: brandIdentityText(resolved), priority: 36, compactable: true },
    { key: "product_set", text: productSetText(resolved), priority: 35, compactable: true },
    { key: "subject", text: subjectText(resolved), priority: 10, required: Boolean(subjectText(resolved)), compactable: true },
    ...cardTypeTexts(resolved).map((text) => ({ key: "card_type", text, priority: 20 })),
    ...variantTexts(resolved).map((text) => ({ key: "variant_parallel_rarity", text, priority: 28 })),
    ...attributeTexts(resolved).map((text) => ({ key: "variant_parallel_rarity", text, priority: 26 })),
    {
      key: "serial_limit",
      text: serialLimitText(resolved.serial_number, { oneOfOne: resolved.one_of_one }),
      priority: 6,
      required: Boolean(serialLimitText(resolved.serial_number, { oneOfOne: resolved.one_of_one })),
      compactable: false
    },
    { key: "collector_number", text: collector, priority: 45 },
    { key: "grading", text: renderGrade(resolved), priority: 6, required: Boolean(renderGrade(resolved)), compactable: false }
  ].filter((item) => normalizeText(item.text));
  const fitted = fitTitleItems(items, { maxLength });

  return {
    title: fitted.title,
    policy: fitted.policy
  };
}
