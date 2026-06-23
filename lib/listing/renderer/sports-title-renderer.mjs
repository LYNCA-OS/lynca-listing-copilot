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

function variantTexts(resolved) {
  const parts = [];
  [
    resolved.card_type,
    resolved.insert,
    resolved.parallel,
    resolved.variation,
    resolved.subset && !/^(?:RC|Rookie|Rookie Card|Rated Rookie|1st Bowman)$/i.test(resolved.subset) ? resolved.subset : null
  ].forEach((part) => pushUniquePhrase(parts, part));

  return parts.map((part) => {
    if (/^Dual\s+Signatures(?:\s+Jersey\s+No\.)?$/i.test(part)) {
      return `${part} Auto`;
    }
    return part;
  });
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

function titleItems(resolved) {
  const product = productIdentityText(resolved);
  const subject = subjectText(resolved);
  const variants = variantTexts(resolved);
  const existingVariantText = variants.join(" ");
  const serial = normalizeSerial(resolved.serial_number);
  const grade = renderGrade(resolved);
  const attributes = attributeTexts(resolved, existingVariantText);

  return [
    { key: "year", text: resolved.year, priority: 30 },
    { key: "product_identity", text: product, priority: 42, compactable: true },
    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    ...variants.map((text) => ({ key: "card_variant", text, priority: 34 })),
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
