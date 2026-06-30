import { fitTitleItems } from "./title-length-policy.mjs";
import { resolveKnowledgeEntry } from "../../listing-knowledge-registry.mjs";
import {
  normalizeComparable,
  normalizeText,
  phraseIncludes,
  brandIdentityText,
  productSetText,
  pushUniquePhrase,
  renderGrade,
  serialLimitText,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";
import { titleParallelText } from "../parallel-policy.mjs";
import { cardTypeTextParts, officialCardTypeText } from "../card-type-policy.mjs";

function parallelVariantText(resolved = {}) {
  return titleParallelText(resolved);
}

function legacyNamedInsertFromCardType(value) {
  const text = normalizeText(value);
  if (!text || !/\b(?:auto|autograph|autographs|autographed|signature|signatures|signed|relic|patch|jersey|memorabilia|card)\b/i.test(text)) return "";
  const named = titleCleanup(text
    .replace(/\b(?:auto|autograph|autographs|autographed|signature|signatures|signed|relic|patch|jersey|memorabilia|card)\b/gi, " ")
    .replace(/\b(?:triple|dual|quad|single)\b\s*$/i, " "));
  if (!named || /^(?:auto|autograph|relic|patch|jersey|memorabilia|card)$/i.test(named)) return "";
  return named;
}

function variantItems(resolved, identityText = "") {
  const seen = [];
  const insertText = normalizeText(resolved.insert) || legacyNamedInsertFromCardType(resolved.card_type);
  const displayInsertText = /\bSignatures?\b/i.test(insertText)
    && resolved.auto
    && !/\bAuto\b/i.test(insertText)
    && !/\b(?:Swatch|Jersey|Patch|Relic|Memorabilia|Logoman)\b/i.test(insertText)
    ? `${insertText} Auto`
    : insertText;
  const insertIsIdentityCritical = /\b(?:historic\s+ties|dual\s+signatures?|triple|auto|autograph|signatures?|relic|patch|jersey|memorabilia|booklet|rookie\s+ticket|rated\s+rookie)\b/i.test(insertText);
  const parts = [
    {
      field: "insert",
      text: displayInsertText && phraseIncludes(identityText, displayInsertText)
        ? null
        : displayInsertText,
      priority: insertIsIdentityCritical ? 9 : 14,
      required: insertIsIdentityCritical
    },
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
      text,
      required: part.required === true
        || part.field === "subset" && /\b(?:Auto|Autograph|Autographs|Autographed|Signature|Signatures|Signed)\b/i.test(text)
    }];
  });
}

function cardTypeItems(resolved) {
  const parts = cardTypeTextParts(resolved);
  const official = officialCardTypeText(resolved);
  const namedConstructionCardType = Boolean(official && /\b(?:Auto|Autograph|Autographs|Autographed|Signature|Signatures|Relic|Jersey|Patch|Memorabilia|Card)\b/i.test(official));

  return parts.map((text) => {
    const criticalAutoText = /\b(?:Auto|Autograph|Autographs|Autographed|Signature|Signatures|Signed)\b/i.test(text);
    return {
      key: "card_type",
      text,
      priority: namedConstructionCardType && normalizeText(text) === normalizeText(official)
      ? 9
      : /\b(?:rookie\s+ticket|rated\s+rookie|historic\s+ties|canvas\s+creations|next\s+stop|spotlight|kaboom|color\s+blast|downtown|signatures?|ticket|booklet)\b/i.test(text)
      ? 13
      : /\bCard\b/i.test(text) && /\b(?:auto|autograph|signature|signed|relic|memorabilia|patch|jersey|logoman)\b/i.test(text)
      ? 26
      : /\b(?:auto|autograph|signature|signed|relic|memorabilia|patch|jersey|logoman)\b/i.test(text) ? 12 : 38,
      required: criticalAutoText,
      compactable: false
    };
  });
}

function preserveCriticalCardAttribute(item) {
  const text = normalizeText(item.text);
  const required = /^(?:Auto|Auto Relic|Auto Patch)$/i.test(text);
  if (!/^(?:Auto|Patch|Relic|Jersey|Auto Relic|Auto Patch)$/i.test(text)) return item;
  return {
    ...item,
    required,
    priority: /^(?:Auto Relic|Auto Patch)$/i.test(text) ? 9 : required ? 11 : 12,
    compactable: false
  };
}

function checklistTitleText(resolved = {}) {
  const checklist = normalizeText(resolved.checklist_code);
  if (!checklist) return "";
  if (normalizeText(resolved.insert) && /^[A-Z]{2,8}[- ][A-Z0-9]{1,16}$/i.test(checklist)) return "";
  const entry = resolveKnowledgeEntry(checklist);
  if (!entry?.label) return checklist;
  const expressedText = normalizeComparable([
    resolved.insert,
    resolved.parallel_exact,
    resolved.parallel,
    resolved.variation,
    resolved.subset,
    resolved.card_type
  ].filter(Boolean).join(" "));
  const label = normalizeComparable(entry.label);
  return label && expressedText.includes(label) ? "" : checklist;
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

function cardNameText(resolved = {}, subject = "") {
  const text = normalizeText(resolved.card_name);
  if (!text || phraseIncludes(subject, text)) return "";
  return text;
}

function teamTitleText(value) {
  const team = normalizeText(value);
  return team ? `(${team})` : "";
}

function titleItems(resolved, {
  includeTeam = false
} = {}) {
  const brand = brandIdentityText(resolved);
  const product = productSetText(resolved);
  const subject = subjectText(resolved);
  const team = normalizeText(resolved.team);
  const cardName = cardNameText(resolved, subject);
  const identityText = titleCleanup([brand, product].filter(Boolean).join(" "));
  const variants = variantItems(resolved, identityText);
  const existingVariantText = variants.map((item) => item.text).join(" ");
  const serialLimit = serialLimitText(resolved.serial_number, { oneOfOne: resolved.one_of_one });
  const grade = renderGrade(resolved);
  const cardTypes = cardTypeItems(resolved);
  const isDelayedCriticalAttribute = (item) => /^(?:Auto|Patch|Relic|Auto Relic)$/i.test(normalizeText(item.text));
  const delayedAttributeCardTypes = cardTypes
    .filter(isDelayedCriticalAttribute)
    .map(preserveCriticalCardAttribute);
  const leadingCardTypes = cardTypes.filter((item) => !isDelayedCriticalAttribute(item));
  const rarity = rarityItems(resolved, existingVariantText);
  const rookieAutoInsert = /\bRookie\s+Auto\b/i.test(existingVariantText);
  const rarityBeforeSerial = rookieAutoInsert
    ? rarity.filter((item) => normalizeText(item.text).toUpperCase() !== "RC")
    : rarity;
  const rarityAfterSerial = rookieAutoInsert
    ? rarity.filter((item) => normalizeText(item.text).toUpperCase() === "RC")
    : [];

  return [
    { key: "year", text: resolved.year, priority: 30, required: Boolean(resolved.year), compactable: false },
    { key: "franchise_brand", text: brand, priority: 18, compactable: true },
    { key: "product_set", text: product, priority: 16, required: Boolean(product), compactable: true },
    { key: "subject", text: subject, priority: 10, required: Boolean(subject), compactable: true },
    { key: "card_name", text: cardName, priority: 13, required: Boolean(cardName), compactable: true },
    ...leadingCardTypes,
    ...variants.map((item) => ({ key: "variant_parallel_rarity", text: item.text, priority: item.priority, required: item.required === true })),
    { key: "serial_limit", text: serialLimit, priority: 5, required: Boolean(serialLimit), compactable: false },
    ...rarityBeforeSerial,
    ...delayedAttributeCardTypes,
    ...rarityAfterSerial,
    { key: "grading", text: grade, priority: 6, required: Boolean(grade), compactable: false },
    includeTeam ? {
      key: "team",
      text: team && !phraseIncludes(subject, team) ? teamTitleText(team) : null,
      priority: 42,
      compactable: true
    } : null
  ].filter((item) => item && normalizeText(item.text));
}

function moveGradeToEnd(title, grade) {
  if (!grade || title.endsWith(grade)) return title;
  const withoutGrade = titleCleanup(title.replace(new RegExp(`\\b${grade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " "));
  return titleCleanup(`${withoutGrade} ${grade}`);
}

export function renderSportsTitle(resolved = {}, {
  maxLength = 85
} = {}) {
  const grade = renderGrade(resolved);
  const baseItems = titleItems(resolved);
  const team = normalizeText(resolved.team);
  const teamText = teamTitleText(team);
  const baseFitted = fitTitleItems(baseItems, { maxLength });
  const teamLimit = Math.min(maxLength, 85);
  const shouldTryTeam = team
    && !phraseIncludes(subjectText(resolved), team)
    && baseFitted.title.length < teamLimit
    && baseFitted.title.length + teamText.length + 1 <= teamLimit;
  const fitted = shouldTryTeam
    ? fitTitleItems(titleItems(resolved, { includeTeam: true }), { maxLength })
    : baseFitted;
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
