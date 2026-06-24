import { fitTitleItems } from "./title-length-policy.mjs";
import {
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
    resolved.subset,
    resolved.card_type,
    resolved.insert,
    parallelVariantText(resolved),
    resolved.variation
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts;
}

function pokemonItems(resolved) {
  const product = productIdentityText(resolved);
  const subject = subjectText(resolved);
  const collector = resolved.collector_number
    ? `#${String(resolved.collector_number).replace(/^#/, "")}`
    : "";
  const grade = renderGrade(resolved);

  return [
    { key: "year", text: resolved.year, priority: 42 },
    { key: "product_identity", text: product, priority: 30, compactable: true },
    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    ...variantTexts(resolved).map((text) => ({ key: "card_variant", text, priority: 28 })),
    { key: "collector_number", text: collector, priority: 8, required: Boolean(collector), compactable: false },
    { key: "serial_number", text: resolved.serial_number, priority: 7, required: Boolean(resolved.serial_number), compactable: false },
    { key: "grading", text: grade, priority: 6, required: Boolean(grade), compactable: false }
  ].filter((item) => normalizeText(item.text));
}

export function renderPokemonTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const fitted = fitTitleItems(pokemonItems(resolved), { maxLength });

  return {
    title: fitted.title,
    policy: fitted.policy
  };
}
