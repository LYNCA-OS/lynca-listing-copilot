import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeSerial,
  normalizeText,
  phraseIncludes,
  productIdentityText,
  pushUniquePhrase,
  renderGrade,
  subjectText
} from "./title-cleanup.mjs";

function parallelVariantText(resolved = {}) {
  if (resolved.parallel_exact) return resolved.parallel_exact;
  const color = normalizeText(resolved.surface_color);
  const family = normalizeText(resolved.parallel_family);
  const legacy = normalizeText(resolved.parallel);
  if (color && family && !phraseIncludes(family, color)) return `${color} ${family}`;
  if (color && legacy && !phraseIncludes(legacy, color)) return `${color} ${legacy}`;
  return legacy || (color && family ? `${color} ${family}` : color || family);
}

function variantTexts(resolved) {
  const parts = [];
  [
    resolved.card_type,
    resolved.insert,
    parallelVariantText(resolved),
    resolved.variation,
    resolved.subset
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts;
}

function attributeTexts(resolved) {
  return [
    resolved.auto ? "Auto" : null,
    resolved.patch ? "Patch" : null,
    resolved.relic ? "Relic" : null,
    resolved.sketch ? "Sketch" : null,
    resolved.redemption ? "Redemption" : null,
    resolved.one_of_one ? "1/1" : null
  ].filter(Boolean);
}

export function renderGenericTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const collector = resolved.collector_number
    ? `#${String(resolved.collector_number).replace(/^#/, "")}`
    : "";
  const items = [
    { key: "year", text: resolved.year, priority: 34 },
    { key: "product_identity", text: productIdentityText(resolved), priority: 35, compactable: true },
    { key: "subject", text: subjectText(resolved), priority: 10, required: Boolean(subjectText(resolved)), compactable: true },
    ...variantTexts(resolved).map((text) => ({ key: "card_variant", text, priority: 28 })),
    { key: "serial_number", text: normalizeSerial(resolved.serial_number), priority: 6, required: Boolean(resolved.serial_number), compactable: false },
    { key: "collector_number", text: collector, priority: 45 },
    ...attributeTexts(resolved).map((text) => ({ key: "attributes", text, priority: 26 })),
    { key: "grading", text: renderGrade(resolved), priority: 6, required: Boolean(renderGrade(resolved)), compactable: false }
  ].filter((item) => normalizeText(item.text));
  const fitted = fitTitleItems(items, { maxLength });

  return {
    title: fitted.title,
    policy: fitted.policy
  };
}
