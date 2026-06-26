import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeText,
  brandIdentityText,
  productSetText,
  pushUniquePhrase,
  renderGrade,
  subjectText
} from "./title-cleanup.mjs";
import { titleParallelText } from "../parallel-policy.mjs";

function parallelVariantText(resolved = {}) {
  return titleParallelText(resolved);
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
  const brand = brandIdentityText(resolved);
  const product = productSetText(resolved);
  const subject = subjectText(resolved);
  const collector = resolved.collector_number
    ? `#${String(resolved.collector_number).replace(/^#/, "")}`
    : "";
  const grade = renderGrade(resolved);

  return [
    { key: "year", text: resolved.year, priority: 42 },
    { key: "franchise_brand", text: brand, priority: 32, compactable: true },
    { key: "product_set", text: product, priority: 30, compactable: true },
    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    ...variantTexts(resolved).map((text) => ({ key: "variant_parallel_rarity", text, priority: 28 })),
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
