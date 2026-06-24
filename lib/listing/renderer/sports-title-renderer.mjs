import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeSerial,
  normalizeText,
  phraseIncludes,
  productIdentityText,
  pushUniquePhrase,
  renderGrade,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";

function variantItems(resolved) {
  const seen = [];
  const parts = [
    { field: "card_type", text: normalizeCardTypeText(resolved.card_type), priority: cardTypePriority(resolved.card_type) },
    { field: "insert", text: resolved.insert, priority: 14 },
    { field: "parallel", text: resolved.parallel, priority: 32 },
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
      text: /^Dual\s+Signatures(?:\s+Jersey\s+No\.)?$/i.test(text) ? `${text} Auto` : text
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

function cardTypePriority(value) {
  const text = normalizeCardTypeText(value);
  if (/\b(?:auto|autograph|signature|signed|relic|memorabilia|patch|jersey|logoman)\b/i.test(text)) return 12;
  return 38;
}

function attributeTexts(resolved, existingText) {
  const parts = [];
  const subset = normalizeText(resolved.subset);
  const combinedExisting = `${existingText} ${subset}`;
  const hasAutoWording = /\b(?:auto|autograph|signature|signatures)\b/i.test(combinedExisting);
  const hasRelicWording = /\b(?:swatch|logoman|patch|relic|memorabilia)\b/i.test(combinedExisting);

  if (resolved.rc || /^(?:RC|Rookie|Rookie Card|Rated Rookie)$/i.test(subset) || /Chrome\s+Rookie\s+Auto/i.test(existingText)) parts.push("RC");
  if (resolved.first_bowman || /^1st Bowman$/i.test(subset)) parts.push("1st Bowman");
  if (resolved.ssp) parts.push("SSP");
  if (resolved.case_hit) parts.push("Case Hit");
  if (resolved.auto && !hasAutoWording) parts.push("Auto");
  if (resolved.patch && !hasRelicWording) parts.push("Patch");
  if (resolved.relic && !hasRelicWording) parts.push("Relic");
  if (resolved.sketch) parts.push("Sketch");
  if (resolved.redemption) parts.push("Redemption");
  if (resolved.one_of_one && !phraseIncludes(existingText, "1/1")) parts.push("1/1");

  return parts;
}

function productTitleText(resolved = {}) {
  const product = productIdentityText(resolved);
  const year = normalizeText(resolved.year);
  if (!year) return product;
  return titleCleanup(product.replace(new RegExp(`^${year.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
}

function titleItems(resolved) {
  const product = productTitleText(resolved);
  const subject = subjectText(resolved);
  const variants = variantItems(resolved);
  const existingVariantText = variants.map((item) => item.text).join(" ");
  const serial = normalizeSerial(resolved.serial_number);
  const grade = renderGrade(resolved);
  const attributes = attributeTexts(resolved, existingVariantText);

	  return [
	    { key: "year", text: resolved.year, priority: 30, required: Boolean(resolved.year), compactable: false },
	    { key: "product_identity", text: product, priority: 16, required: Boolean(product), compactable: true },
	    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    ...variants.map((item) => ({ key: "card_variant", text: item.text, priority: item.priority })),
    { key: "serial_number", text: serial, priority: 5, required: Boolean(serial), compactable: false },
    ...attributes.map((text) => ({
      key: text === "RC" || text === "1st Bowman" ? "rookie_marker" : "attributes",
      text,
      priority: text === "RC" || text === "1st Bowman" ? 8 : 28,
      required: text === "RC" || text === "1st Bowman",
      compactable: false
    })),
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
