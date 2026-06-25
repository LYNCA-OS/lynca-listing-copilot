import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeSerial,
  normalizeText,
  phraseIncludes,
  brandIdentityText,
  productSetText,
  pushUniquePhrase,
  renderGrade,
  subjectText,
  titleCleanup
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

function variantItems(resolved) {
  const seen = [];
  const parts = [
    { field: "insert", text: resolved.insert, priority: 14 },
    { field: "parallel", text: parallelVariantText(resolved), priority: 32 },
    { field: "variation", text: resolved.variation, priority: 32 },
    {
      field: "subset",
      text: resolved.subset && !/^(?:RC|Rookie|Rookie Card|Rated Rookie|1st Bowman)$/i.test(resolved.subset) ? resolved.subset : null,
      priority: 30
    }
  ];

  return parts.flatMap((part) => {
    const before = seen.length;
    pushUniquePhrase(seen, part.text);
    if (seen.length === before) return [];
    const text = seen.at(-1);
    return [{
      ...part,
      text
    }];
  });
}

function normalizeCardTypeText(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^(?:base|standard|regular|insert)$/i.test(text)) return "";
  if (/^(?:relic|memorabilia|patch|jersey)\s*\/\s*(?:auto|autograph|signature)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|signature)\s*\/\s*(?:relic|memorabilia|patch|jersey)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|autographed|signature|signed)$/i.test(text)) return "Auto";
  return text;
}

function cardTypeItems(resolved) {
  const parts = [];
  const cardType = normalizeCardTypeText(resolved.card_type);
  pushUniquePhrase(parts, cardType);
  if (resolved.auto) pushUniquePhrase(parts, "Auto");
  if (resolved.patch) pushUniquePhrase(parts, "Patch");
  if (resolved.relic) pushUniquePhrase(parts, "Relic");
  if (resolved.sketch) pushUniquePhrase(parts, "Sketch");
  if (resolved.redemption) pushUniquePhrase(parts, "Redemption");

  return parts.map((text) => ({
    key: "card_type",
    text,
    priority: /\b(?:auto|autograph|signature|signed|relic|memorabilia|patch|jersey|logoman)\b/i.test(text) ? 12 : 38,
    compactable: false
  }));
}

function rarityItems(resolved, existingText) {
  const parts = [];
  const subset = normalizeText(resolved.subset);
  const combinedExisting = `${existingText} ${subset}`;

  if (resolved.rc || /^(?:RC|Rookie|Rookie Card|Rated Rookie)$/i.test(subset) || /Chrome\s+Rookie\s+Auto/i.test(existingText)) parts.push("RC");
  if (resolved.first_bowman || /^1st Bowman$/i.test(subset)) parts.push("1st Bowman");
  if (resolved.ssp) parts.push("SSP");
  if (resolved.case_hit) parts.push("Case Hit");
  if (resolved.one_of_one && !phraseIncludes(existingText, "1/1")) parts.push("1/1");

  return parts.map((text) => ({
    key: "variant_parallel_rarity",
    text,
    priority: text === "RC" || text === "1st Bowman" ? 8 : 28,
    required: text === "RC" || text === "1st Bowman",
    compactable: false
  }));
}

function titleItems(resolved) {
  const brand = brandIdentityText(resolved);
  const product = productSetText(resolved);
  const subject = subjectText(resolved);
  const variants = variantItems(resolved);
  const existingVariantText = variants.map((item) => item.text).join(" ");
  const serial = normalizeSerial(resolved.serial_number);
  const collector = resolved.collector_number
    ? `#${String(resolved.collector_number).replace(/^#/, "")}`
    : "";
  const checklist = normalizeText(resolved.checklist_code);
  const grade = renderGrade(resolved);
  const cardTypes = cardTypeItems(resolved);
  const rarity = rarityItems(resolved, existingVariantText);

  return [
    { key: "year", text: resolved.year, priority: 30, required: Boolean(resolved.year), compactable: false },
    { key: "franchise_brand", text: brand, priority: 18, compactable: true },
    { key: "product_set", text: product, priority: 16, required: Boolean(product), compactable: true },
    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    ...cardTypes,
    ...variants.map((item) => ({ key: "variant_parallel_rarity", text: item.text, priority: item.priority })),
    ...rarity,
    { key: "serial_number", text: serial, priority: 5, required: Boolean(serial), compactable: false },
    { key: "collector_number", text: collector, priority: 34, compactable: false },
    { key: "checklist_code", text: checklist, priority: 36, compactable: false },
    { key: "grading", text: grade, priority: 6, required: Boolean(grade), compactable: false }
  ].filter((item) => normalizeText(item.text));
}

function moveGradeToEnd(title, grade) {
  if (!grade || title.endsWith(grade)) return title;
  const withoutGrade = titleCleanup(title.replace(new RegExp(`\\b${grade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " "));
  return titleCleanup(`${withoutGrade} ${grade}`);
}

export function renderSportsTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const grade = renderGrade(resolved);
  const fitted = fitTitleItems(titleItems(resolved), { maxLength });
  const title = moveGradeToEnd(fitted.title, grade);

  return {
    title,
    policy: {
      ...fitted.policy,
      length: title.length,
      exceeded: title.length > maxLength
    }
  };
}
