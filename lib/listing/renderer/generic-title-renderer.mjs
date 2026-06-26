import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeSerial,
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

function normalizeCardTypeText(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^(?:base|standard|regular|insert)$/i.test(text)) return "";
  if (/^(?:relic|memorabilia|patch|jersey)\s*\/\s*(?:auto|autograph|signature)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|signature)\s*\/\s*(?:relic|memorabilia|patch|jersey)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|autographed|signature|signed)$/i.test(text)) return "Auto";
  return text;
}

function cardTypeTexts(resolved) {
  const parts = [];
  pushUniquePhrase(parts, normalizeCardTypeText(resolved.card_type));
  if (resolved.auto) pushUniquePhrase(parts, "Auto");
  if (resolved.patch) pushUniquePhrase(parts, "Patch");
  if (resolved.relic) pushUniquePhrase(parts, "Relic");
  if (resolved.sketch) pushUniquePhrase(parts, "Sketch");
  if (resolved.redemption) pushUniquePhrase(parts, "Redemption");
  return parts;
}

export function renderGenericTitle(resolved = {}, {
  maxLength = 80
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
    { key: "serial_number", text: normalizeSerial(resolved.serial_number), priority: 6, required: Boolean(resolved.serial_number), compactable: false },
    { key: "collector_number", text: collector, priority: 45 },
    { key: "grading", text: renderGrade(resolved), priority: 6, required: Boolean(renderGrade(resolved)), compactable: false }
  ].filter((item) => normalizeText(item.text));
  const fitted = fitTitleItems(items, { maxLength });

  return {
    title: fitted.title,
    policy: fitted.policy
  };
}
