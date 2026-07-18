import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeComparable,
  normalizeText,
  brandIdentityText,
  productSetText,
  phraseIncludes,
  pushUniquePhrase,
  renderGrade,
  serialLimitText,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";
import { titleParallelText } from "../parallel-policy.mjs";
import { officialCardTypeText } from "../card-type-policy.mjs";
import { semReleaseVariantText, semTcgIpLabel } from "../csm/sem-definition.mjs";

function parallelVariantText(resolved = {}) {
  return titleParallelText(resolved);
}

function variantTexts(resolved, existingText = "") {
  const parts = [];
  [
    resolved.subset,
    officialCardTypeText(resolved),
    resolved.insert,
    semReleaseVariantText(resolved.variation)
  ].forEach((part) => {
    if (phraseIncludes(existingText, part)) return;
    pushUniquePhrase(parts, part);
  });
  return parts;
}

function productFinishText(resolved = {}) {
  const parts = [];
  [
    parallelVariantText(resolved),
    resolved.parallel_family,
    resolved.surface_color
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts.join(" ");
}

function tcgIpText(resolved = {}) {
  const canonicalIp = semTcgIpLabel(resolved);
  if (canonicalIp) return canonicalIp;
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
  if (/^(?:en|eng|english)$/i.test(text)) return "";
  if (/^(?:jp|jpn|ja|japanese)$/i.test(text)) return "Japanese";
  if (/^(?:cn|zh|chinese)$/i.test(text)) return "Chinese";
  if (/^(?:kr|kor|ko|korean)$/i.test(text)) return "Korean";
  return text.toUpperCase();
}

function cleanTcgSetText(value = "") {
  return titleCleanup(normalizeText(value)
    .replace(/\bPokémon\b/giu, "Pokemon")
    .replace(/^Pokemon\s+Pokemon\b/i, "Pokemon")
    .replace(/\bCard\s+Game\b/gi, " ")
    .replace(/\bTrading\s+Card\s+Game\b/gi, " "));
}

function tcgProductSeriesText(resolved = {}, ip = "") {
  const product = cleanTcgSetText(resolved.product);
  let set = cleanTcgSetText(resolved.set);
  if (/^Pokemon$/i.test(ip) && /^Pokemon\s+\S+/i.test(set)) {
    set = titleCleanup(set.replace(/^Pokemon\s+/i, ""));
  }
  if (set) {
    if (/^Promo$/i.test(product)) {
      if (/\bCoroCoro\b/i.test(set)) return "CoroCoro Promo";
      return set;
    }
    if (product && (phraseIncludes(set, product) || phraseIncludes(product, set))) return set.length >= product.length ? set : product;
    return set;
  }
  return product || productSetText(resolved);
}

function tcgCardNumberText(resolved = {}) {
  const collector = normalizeText(resolved.collector_number).replace(/^#/, "");
  const checklist = normalizeText(resolved.checklist_code).replace(/^#/, "");
  return [collector, checklist].filter(Boolean).join(" ");
}

function descriptiveRarityText(resolved = {}, existingText = "") {
  const raw = normalizeText(resolved.rarity);
  if (!raw) return "";
  const parts = raw.split(/\s*\/\s*/).map(normalizeText).filter(Boolean);
  const retained = [];
  parts.forEach((part) => {
    if (/^(?:Promo|Prize\s+Card)$/i.test(part) && /\b(?:Promo|CoroCoro|Trophy|Illustrator)\b/i.test(existingText)) return;
    if (/^Trophy$/i.test(part) && phraseIncludes(existingText, "Trophy")) return;
    if (phraseIncludes(existingText, part)) return;
    pushUniquePhrase(retained, part);
  });
  return retained.join(" / ");
}

function specialStampText(resolved = {}, existingText = "") {
  const parts = [];
  if (resolved.first_bowman || /\b1st\s+Edition\b/i.test(normalizeText(resolved.subset))) {
    parts.push("1st Edition");
  }
  const insert = normalizeText(resolved.insert);
  if (insert && !phraseIncludes(existingText, insert) && /\b(?:Staff|Promo|Prize|Tournament|Championship|CoroCoro|Parent\/Child|Event)\b/i.test(insert)) {
    parts.push(insert);
  }
  return parts.reduce((acc, part) => {
    pushUniquePhrase(acc, part);
    return acc;
  }, []).join(" ");
}

function pokemonItems(resolved) {
  const ip = tcgIpText(resolved);
  const language = languageText(resolved.language);
  const product = tcgProductSeriesText(resolved, ip);
  const subject = subjectText(resolved);
  const grade = renderGrade(resolved);
  const serialLimit = serialLimitText(resolved, { oneOfOne: resolved.one_of_one });
  const cardNumber = tcgCardNumberText(resolved);
  const finish = productFinishText(resolved);
  const existingBeforeRarity = [product, subject, resolved.card_name, finish].filter(Boolean).join(" ");
  const rarity = descriptiveRarityText(resolved, existingBeforeRarity);
  const specialStamp = specialStampText(resolved, existingBeforeRarity);
  const description = [
    resolved.ssp ? "SSP" : null,
    resolved.case_hit ? "Case Hit" : null
  ].filter(Boolean).join(" ");

  return [
    { key: "year", text: resolved.year, priority: 1, required: Boolean(resolved.year), compactable: false },
    { key: "language", text: language, priority: 2, compactable: true },
    { key: "franchise_brand", text: ip, priority: 3, required: Boolean(ip), compactable: true },
    { key: "product_set", text: product, priority: 6, required: Boolean(product), compactable: true },
    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    { key: "card_name", text: resolved.card_name, priority: 7, compactable: true },
    { key: "card_number", text: cardNumber, priority: 8, compactable: false },
    { key: "descriptive_rarity", text: rarity, priority: 12, compactable: false },
    { key: "serial_limit", text: serialLimit, priority: 7, required: Boolean(serialLimit), compactable: false },
    ...variantTexts(resolved, [product, subject, resolved.card_name, rarity, finish, specialStamp].filter(Boolean).join(" ")).map((text) => ({ key: "variant_parallel_rarity", text, priority: 28 })),
    { key: "print_finish", text: finish, priority: 14, compactable: true },
    { key: "special_stamp", text: specialStamp, priority: 9, compactable: false },
    { key: "grading", text: grade, priority: 6, compactable: false },
    { key: "description", text: description, priority: 68, compactable: false },
    { key: "search_optimization", text: "", priority: 70, compactable: false }
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
