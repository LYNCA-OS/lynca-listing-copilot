import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeText,
  brandIdentityText,
  displayCardNumber,
  phraseIncludes,
  productHierarchyText,
  pushUniquePhrase,
  renderGrade,
  serialLimitText,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";
import { looksLikeOpticalParallel, safeSurfaceColor } from "../parallel-policy.mjs";
import { cardTypeTextParts, officialCardTypeText } from "../card-type-policy.mjs";

const productConfigurationPattern = /\b(?:FOTL|First\s+Off\s+The\s+Line|Hobby|Retail|Choice|Fast\s+Break|Sapphire)\b/i;
const releaseVariantPattern = /\b(?:Horizontal|Vertical|Variation|Image\s+Variation|Photo\s+Variation|International)\b/i;
const finishWordPattern = /\b(?:Wave|Shimmer|Sparkle|Speckle|Mojo|Ice|Refractor|Prizm|Prism|Foil|Holo|Holographic|Aqua|Gold|Green|Red|Blue|Purple|Orange|Black|Silver)\b/i;

function stripProductConfigurationTerms(value = "") {
  return titleCleanup(normalizeText(value)
    .replace(/\bFirst\s+Off\s+The\s+Line\b/gi, "FOTL")
    .replace(productConfigurationPattern, " "));
}

function productConfigurationText(resolved = {}) {
  const parts = [];
  [resolved.insert, resolved.variation].forEach((value) => {
    const text = normalizeText(value).replace(/\bFirst\s+Off\s+The\s+Line\b/gi, "FOTL");
    const matches = text.match(new RegExp(productConfigurationPattern.source, "gi")) || [];
    matches.forEach((match) => pushUniquePhrase(parts, /^First/i.test(match) ? "FOTL" : match));
  });
  return parts.join(" ");
}

function finishOnlyText(value = "") {
  const text = normalizeText(value);
  if (!text) return false;
  const stripped = text.replace(new RegExp(finishWordPattern.source, "gi"), " ").replace(/\s+/g, " ").trim();
  return stripped === "";
}

function releaseVariantText(resolved = {}) {
  const parts = [];
  const variation = stripProductConfigurationTerms(resolved.variation);
  if (variation && releaseVariantPattern.test(variation)) pushUniquePhrase(parts, variation);
  return parts.join(" ");
}

function productFinishText(resolved = {}) {
  const exact = stripProductConfigurationTerms(resolved.parallel_exact);
  if (exact) return exact;

  const parts = [];
  const variation = stripProductConfigurationTerms(resolved.variation);
  const insert = stripProductConfigurationTerms(resolved.insert);
  const color = safeSurfaceColor(resolved.surface_color);
  if (color) pushUniquePhrase(parts, color);

  const legacyParallel = normalizeText(resolved.parallel);
  if (legacyParallel && !looksLikeOpticalParallel(legacyParallel)) pushUniquePhrase(parts, legacyParallel);
  const legacyColor = safeSurfaceColor(legacyParallel || resolved.variation);
  if (!parts.length && legacyColor) pushUniquePhrase(parts, legacyColor);
  const finishWords = [
    ...(variation.match(new RegExp(finishWordPattern.source, "gi")) || []),
    ...(insert.match(new RegExp(finishWordPattern.source, "gi")) || [])
  ];
  if (finishWords.length) pushUniquePhrase(parts, finishWords.join(" "));
  const family = normalizeText(resolved.parallel_family);
  if (family) pushUniquePhrase(parts, family);

  return parts.join(" ");
}

function printFinishText(resolved = {}) {
  const finish = productFinishText(resolved);
  if (finish) return finish;
  const family = normalizeText(resolved.parallel_family);
  return family || "";
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
  const rawInsertText = normalizeText(resolved.insert) || legacyNamedInsertFromCardType(resolved.card_type);
  const insertText = finishOnlyText(stripProductConfigurationTerms(rawInsertText))
    ? ""
    : stripProductConfigurationTerms(rawInsertText);
  const variationText = normalizeText(resolved.variation);
  const releaseText = releaseVariantText(resolved);
  const displayReleaseText = variationText && releaseText && phraseIncludes(variationText, releaseText)
    ? variationText
    : releaseText;
  const displayInsertText = /\bSignatures?\b/i.test(insertText)
    && resolved.auto
    && !/\bAuto\b/i.test(insertText)
    && !/\b(?:Swatch|Jersey|Patch|Relic|Memorabilia|Logoman)\b/i.test(insertText)
    ? `${insertText} Auto`
    : insertText;
  const insertIsIdentityCritical = /\b(?:historic\s+ties|dual\s+signatures?|triple|auto|autograph|autographs|autographed|signed|signatures?|relic|patch|jersey|memorabilia|booklet|rookie\s+ticket|rated\s+rookie)\b/i.test(insertText);
  const parts = [
    {
      field: "insert",
      text: displayInsertText && phraseIncludes(identityText, displayInsertText)
        ? null
        : displayInsertText,
      priority: insertIsIdentityCritical ? 9 : 14,
      required: insertIsIdentityCritical
    },
    { field: "release_variant", text: displayReleaseText, priority: 24 },
    {
      field: "variation",
      text: variationText && !phraseIncludes(displayReleaseText, variationText) ? variationText : null,
      priority: 32
    },
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

function rarityItems(resolved) {
  const parts = [];
  const subset = normalizeText(resolved.subset);

  if (resolved.ssp) parts.push("SSP");
  if (resolved.case_hit) parts.push("Case Hit");

  return parts.map((text) => ({
    key: "descriptive_rarity",
    text,
    priority: 72,
    compactable: false
  }));
}

function searchOptimizationItems(resolved, existingText = "") {
  const subset = normalizeText(resolved.subset);
  const parts = [];
  const config = productConfigurationText(resolved);
  const existing = normalizeText(existingText);

  if (resolved.rc || /^(?:RC|Rookie|Rookie Card|Rated Rookie)$/i.test(subset) || /Chrome\s+Rookie\s+Auto/i.test(existingText)) parts.push("RC");
  if (resolved.first_bowman || /^1st Bowman$/i.test(subset)) parts.push("1st Bowman");
  if (resolved.auto && !/\bAuto\b/i.test(existing)) parts.push("Auto");
  if (resolved.patch && !/\bPatch\b/i.test(existing)) parts.push("Patch");
  if (resolved.relic && !/\bRelic\b/i.test(existing)) parts.push("Relic");
  if (resolved.jersey && !/\bJersey\b/i.test(existing)) parts.push("Jersey");
  if (resolved.sketch) parts.push("Sketch");
  if (resolved.redemption) parts.push("Redemption");
  if (config) parts.push(config);

  return parts.map((text) => ({
    key: "search_optimization",
    text,
    priority: /^(?:RC|1st Bowman|Auto)$/i.test(text) ? 8 : productConfigurationPattern.test(text) ? 34 : 18,
    required: /^(?:RC|1st Bowman|Auto)$/i.test(text),
    compactable: false
  }));
}

function cardNameText(resolved = {}, subject = "") {
  const text = normalizeText(resolved.card_name);
  if (!text || phraseIncludes(subject, text)) return "";
  return text;
}

function designTextCoversCardType(designText = "", cardTypeText = "") {
  const design = normalizeText(designText);
  const cardType = normalizeText(cardTypeText);
  if (!design || !cardType) return false;
  if (phraseIncludes(design, cardType)) return true;
  const hasAuto = /\b(?:Auto|Autograph|Autographs|Signature|Signatures|Signed)\b/i.test(design);
  const hasPatch = /\bPatch\b/i.test(design);
  const hasRelic = /\b(?:Relic|Swatch|Memorabilia|Jersey|Logoman)\b/i.test(design);
  if (/^Auto\s+Patch$/i.test(cardType) && hasAuto && hasPatch) return true;
  if (/^Auto\s+Relic$/i.test(cardType) && hasAuto && hasRelic) return true;
  if (/^Auto$/i.test(cardType) && hasAuto) return true;
  if (/^Patch$/i.test(cardType) && hasPatch) return true;
  if (/^(?:Relic|Jersey)$/i.test(cardType) && hasRelic) return true;
  return false;
}

function comparableTokens(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function setLooksLikeProductHierarchy(resolved = {}) {
  const setTokens = new Set(comparableTokens(resolved.set));
  const productTokens = comparableTokens(resolved.product);
  if (!setTokens.size || !productTokens.length) return false;
  const meaningfulProductTokens = productTokens.filter((token) => !/^(?:basketball|football|baseball|soccer|hockey|cards?|trading)$/.test(token));
  if (!meaningfulProductTokens.length) return false;
  return meaningfulProductTokens.every((token) => setTokens.has(token));
}

function productCoreText(resolved = {}) {
  const manufacturer = normalizeText(resolved.manufacturer);
  const brand = normalizeText(resolved.brand);
  let product = titleCleanup(normalizeText(resolved.product).replace(new RegExp(`^${String(resolved.year || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
  if (/^Immaculate\s+Collection(?:\s+(?:Basketball|Football|Baseball|Soccer|Hockey))?$/i.test(product)) {
    product = "Immaculate";
  }
  if (normalizeText(resolved.set)) {
    const withoutSportSuffix = titleCleanup(product.replace(/\s+(?:Basketball|Football|Baseball|Soccer|Hockey)$/i, ""));
    if (withoutSportSuffix && normalizeText(withoutSportSuffix).toLowerCase() === normalizeText(brand).toLowerCase()) {
      product = withoutSportSuffix;
    }
  }
  const brandText = brandIdentityText(resolved);
  if (setLooksLikeProductHierarchy(resolved)) return productHierarchyText(resolved);
  if (!product) return productHierarchyText(resolved);

  const brandComparable = normalizeText(brand).toLowerCase();
  const productComparable = normalizeText(product).toLowerCase();
  const brandTextComparable = normalizeText(brandText).toLowerCase();
  if (brandTextComparable && (productComparable === brandTextComparable || productComparable.startsWith(`${brandTextComparable} `))) return product;
  if (brandComparable && (productComparable === brandComparable || productComparable.startsWith(`${brandComparable} `))) {
    return titleCleanup([manufacturer, product].filter(Boolean).join(" "));
  }
  const firstProductToken = productComparable.split(/\s+/).find(Boolean);
  if (manufacturer && firstProductToken && brandTextComparable.split(/\s+/).includes(firstProductToken)) {
    return titleCleanup([manufacturer, product].filter(Boolean).join(" "));
  }
  return titleCleanup([brandText, product].filter(Boolean).join(" "));
}

function setTitleText(resolved = {}, productIdentity = "") {
  if (setLooksLikeProductHierarchy(resolved)) return "";
  let set = titleCleanup(normalizeText(resolved.set).replace(new RegExp(`^${String(resolved.year || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
  if (!set || phraseIncludes(productIdentity, set)) return "";
  const productPrefix = normalizeText(productIdentity);
  if (productPrefix && set.toLowerCase().startsWith(`${productPrefix.toLowerCase()} `)) {
    set = titleCleanup(set.slice(productPrefix.length));
  }
  const productWithoutManufacturer = titleCleanup(normalizeText(resolved.product).replace(new RegExp(`^${String(resolved.manufacturer || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
  [resolved.product, productWithoutManufacturer, resolved.brand].map(normalizeText).filter(Boolean).forEach((prefix) => {
    if (set.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
      set = titleCleanup(set.slice(prefix.length));
    }
  });
  return set;
}

function teamTitleText(value) {
  const team = normalizeText(value);
  return team ? `(${team})` : "";
}

function collectorNumberText(resolved = {}) {
  const collector = displayCardNumber(resolved.collector_number, resolved);
  if (!collector) return "";
  return `#${collector.replace(/^#/, "")}`;
}

function numericalRarityText(resolved = {}) {
  return serialLimitText(resolved.numerical_rarity, { oneOfOne: resolved.one_of_one })
    || (resolved.one_of_one ? "1/1" : "");
}

function titleItems(resolved, {
  includeTeam = false
} = {}) {
  const productIdentity = productCoreText(resolved);
  const setText = setTitleText(resolved, productIdentity);
  const subject = subjectText(resolved);
  const team = normalizeText(resolved.team);
  const cardName = cardNameText(resolved, subject);
  const identityText = titleCleanup(productIdentity);
  const variants = variantItems(resolved, identityText);
  const existingVariantText = variants.map((item) => item.text).join(" ");
  const printFinish = printFinishText(resolved);
  const serialLimit = numericalRarityText(resolved);
  const collectorNumber = collectorNumberText(resolved);
  const grade = renderGrade(resolved);
  const cardTypes = cardTypeItems(resolved).filter((item) => {
    const designText = [cardName, existingVariantText].filter(Boolean).join(" ");
    return !designTextCoversCardType(designText, item.text);
  });
  const isDelayedCriticalAttribute = (item) => /^(?:Auto|Patch|Relic|Auto Relic)$/i.test(normalizeText(item.text));
  const delayedAttributeCardTypes = cardTypes
    .filter(isDelayedCriticalAttribute)
    .map(preserveCriticalCardAttribute);
  const leadingCardTypes = cardTypes.filter((item) => !isDelayedCriticalAttribute(item));
  const rarity = rarityItems(resolved);
  const searchOptimization = searchOptimizationItems(resolved, [cardName, existingVariantText, printFinish].filter(Boolean).join(" "));

  return [
    { key: "year", text: resolved.year, priority: 4, required: Boolean(resolved.year), compactable: false },
    { key: "product_identity", text: productIdentity, priority: 5, required: Boolean(productIdentity), compactable: true },
    { key: "set", text: setText, priority: 16, compactable: true },
    { key: "subject", text: subject, priority: 3, required: Boolean(subject), compactable: true },
    {
      key: "card_name",
      text: cardName,
      priority: 7,
      required: /\b(?:Auto|Autograph|Autographs|Signature|Signatures|Patch|Relic|Jersey|Memorabilia|Rookie\s+Ticket)\b/i.test(cardName),
      compactable: true
    },
    ...leadingCardTypes.map((item) => ({ ...item, key: "release_variant" })),
    ...variants.map((item) => ({ key: "release_variant", text: item.text, priority: item.priority, required: item.required === true })),
    { key: "print_finish", text: printFinish, priority: 74, compactable: true },
    { key: "serial_limit", text: serialLimit, priority: 5, required: Boolean(serialLimit), compactable: false },
    ...rarity,
    { key: "card_number", text: collectorNumber, priority: 95, compactable: false },
    ...searchOptimization,
    ...delayedAttributeCardTypes,
    includeTeam ? {
      key: "search_optimization",
      text: team && !phraseIncludes(subject, team) ? teamTitleText(team) : null,
      priority: 42,
      compactable: true
    } : null,
    { key: "grading", text: grade, priority: 6, compactable: false }
  ].filter((item) => item && normalizeText(item.text));
}

function moveGradeToEnd(title, grade) {
  if (!grade || title.endsWith(grade)) return title;
  if (!phraseIncludes(title, grade)) return title;
  const withoutGrade = titleCleanup(title.replace(new RegExp(`\\b${grade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " "));
  return titleCleanup(`${withoutGrade} ${grade}`);
}

export function renderSportsTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const grade = renderGrade(resolved);
  const baseItems = titleItems(resolved);
  const team = normalizeText(resolved.team);
  const teamText = teamTitleText(team);
  const baseFitted = fitTitleItems(baseItems, { maxLength });
  const teamLimit = Math.min(maxLength, 80);
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
