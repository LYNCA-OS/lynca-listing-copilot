import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeComparable,
  normalizeText,
  brandIdentityText,
  productSetText,
  pushUniquePhrase,
  renderGrade,
  serialLimitText,
  subjectText
} from "./title-cleanup.mjs";
import { titleParallelText } from "../parallel-policy.mjs";
import { officialCardTypeText } from "../card-type-policy.mjs";

function parallelVariantText(resolved = {}) {
  return titleParallelText(resolved);
}

function variantTexts(resolved) {
  const parts = [];
  [
    resolved.subset,
    officialCardTypeText(resolved),
    resolved.insert,
    parallelVariantText(resolved),
    resolved.variation
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts;
}

function tcgIpText(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.set
  ].filter(Boolean).join(" "));
  if (/\bpokemon\b|\bpokemon tcg\b|\bpokémon\b/.test(text)) return "Pokemon";
  if (/\bone piece\b/.test(text)) return "One Piece";
  if (/\byu gi oh\b|\byugioh\b|\byu-gi-oh\b/.test(text)) return "Yu-Gi-Oh!";
  if (/\bdragon ball\b|\bdragonball\b/.test(text)) return "Dragon Ball";
  return brandIdentityText(resolved);
}

function languageText(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^(?:en|eng|english)$/i.test(text)) return "EN";
  if (/^(?:jp|jpn|ja|japanese)$/i.test(text)) return "JP";
  if (/^(?:cn|zh|chinese)$/i.test(text)) return "CN";
  if (/^(?:kr|kor|ko|korean)$/i.test(text)) return "KR";
  return text.toUpperCase();
}

function pokemonItems(resolved) {
  const ip = tcgIpText(resolved);
  const language = languageText(resolved.language);
  const product = productSetText(resolved);
  const subject = subjectText(resolved);
  const collector = resolved.collector_number
    ? `#${String(resolved.collector_number).replace(/^#/, "")}`
    : "";
  const grade = renderGrade(resolved);
  const serialLimit = serialLimitText(resolved.serial_number, { oneOfOne: resolved.one_of_one });
  const additionalInfo = [collector, resolved.checklist_code].map(normalizeText).filter(Boolean).join(" ");

  return [
    { key: "year", text: resolved.year, priority: 42 },
    { key: "franchise_brand", text: ip, priority: 32, compactable: true },
    { key: "language", text: language, priority: 36, compactable: false },
    { key: "product_set", text: product, priority: 6, required: Boolean(product), compactable: true },
    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    { key: "card_name", text: resolved.card_name, priority: 7, compactable: true },
    ...variantTexts(resolved).map((text) => ({ key: "variant_parallel_rarity", text, priority: 28 })),
    { key: "serial_limit", text: serialLimit, priority: 7, required: Boolean(serialLimit), compactable: false },
    { key: "additional_info", text: additionalInfo, priority: 8, required: Boolean(additionalInfo), compactable: false },
    { key: "grading", text: grade, priority: 6, compactable: false }
  ].filter((item) => normalizeText(item.text));
}

export function renderPokemonTitle(resolved = {}, {
  maxLength = 85
} = {}) {
  const fitted = fitTitleItems(pokemonItems(resolved), { maxLength });

  return {
    title: fitted.title,
    policy: fitted.policy
  };
}
