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

function titleCaseAllCapsDescriptor(value = "") {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => {
      if (!/^[A-Z]{4,}$/.test(token) || /^(?:FOTL|PSA|BGS|SGC|CGC|TAG|RC|SP|SSP|NBA|NFL|MLB|NHL|FIFA|UEFA)$/i.test(token)) return token;
      return `${token[0]}${token.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function compactOutputProductIdentity(value = "") {
  const text = titleCleanup(normalizeText(value)
    .replace(/\bFIFA\s+World\s+Cup\s+Qatar\s+2022\b/gi, "World Cup")
    .replace(/\bWorld\s+Cup\s+Qatar\s+2022\b/gi, "World Cup")
    .replace(/\s+(?:Basketball|Football|Baseball|Hockey)$/i, ""));
  if (/\bFIFA\s+Soccer$/i.test(text)) return text;
  return titleCleanup(text.replace(/\s+Soccer$/i, ""));
}

function productSetOutputOverride({ manufacturer = "", brand = "", product = "", set = "" } = {}) {
  const productText = normalizeText(product);
  const setText = normalizeText(set);
  const makerText = brandIdentityText({ manufacturer, brand });
  if (!productText || !setText) return "";

  if (/^(?:Panini\s+)?Prizm$/i.test(productText) && /\b(?:FIFA\s+)?World\s+Cup\b/i.test(setText)) {
    const productPrefix = /^Panini\s+/i.test(productText)
      ? productText
      : [makerText || manufacturer || brand, productText].filter(Boolean).join(" ");
    return compactOutputProductIdentity([productPrefix, "World Cup"].filter(Boolean).join(" "));
  }

  return "";
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
  const normalizedDisplayInsertText = /\bRookie\s+(?:Material|Materials|Patch|RPA)\s+Signatures?\b/i.test(displayInsertText)
    ? "Rookie Patch Auto"
    : /\b(?:Material|Materials|Patch|RPA)\s+Signatures?\b/i.test(displayInsertText)
      ? "Patch Auto"
      : displayInsertText;
  const insertIsIdentityCritical = /\b(?:historic\s+ties|dual\s+signatures?|triple|auto|autograph|autographs|autographed|signed|signatures?|relic|patch|jersey|memorabilia|booklet|rookie\s+ticket|rated\s+rookie)\b/i.test(insertText);
  const parts = [
    {
      field: "insert",
      text: normalizedDisplayInsertText && phraseIncludes(identityText, normalizedDisplayInsertText)
        ? null
        : normalizedDisplayInsertText,
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
  const required = /^(?:Auto|Auto Relic|Auto Patch|Patch Auto)$/i.test(text);
  if (!/^(?:Auto|Patch|Relic|Jersey|Auto Relic|Auto Patch|Patch Auto)$/i.test(text)) return item;
  return {
    ...item,
    required,
    priority: /^(?:Auto Relic|Auto Patch|Patch Auto)$/i.test(text) ? 9 : required ? 11 : 12,
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
  const cardName = normalizeText(resolved.card_name);
  const materialSignature = /\b(?:Rookie\s+)?(?:Material|Materials|Patch|RPA)\s+Signatures?\b/i.test(cardName);
  const knownRookieInsert = /\b(?:New\s+Breed|Freshman\s+Fabric|Rookie\s+Ticket|Rated\s+Rookie|Rookie\s+Material|Rookie\s+Patch)\b/i.test(cardName)
    || /\b(?:New\s+Breed|Freshman\s+Fabric|Rookie\s+Ticket|Rated\s+Rookie|Rookie\s+Material|Rookie\s+Patch)\b/i.test(normalizeText(resolved.insert || resolved.official_card_type || resolved.card_type));

  if (resolved.rc || knownRookieInsert || materialSignature && /\bRookie\b/i.test(cardName) || /^(?:RC|Rookie|Rookie Card|Rated Rookie)$/i.test(subset) || /Chrome\s+Rookie\s+Auto/i.test(existingText)) parts.push("RC");
  if (resolved.first_bowman || /^1st Bowman$/i.test(subset)) parts.push("1st Bowman");
  if ((resolved.auto || materialSignature) && !/\bAuto\b/i.test(existing)) parts.push("Auto");
  if ((resolved.patch || materialSignature) && !/\bPatch\b/i.test(existing)) parts.push("Patch");
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
  let text = normalizeText(resolved.card_name);
  if (!text || phraseIncludes(subject, text)) return "";
  if (/^(?:Rookie|Rookie Card|RC)$/i.test(text) && resolved.rc) return "";
  text = titleCleanup(text
    .replace(/\bSIG[-\s]*(Black|Blue|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/gi, "Signatures $1")
    .replace(/\bAuto[-\s]*(Black|Blue|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/gi, "Auto $1"));
  text = titleCaseAllCapsDescriptor(text);
  const color = safeSurfaceColor(resolved.surface_color);
  if (color) {
    text = titleCleanup(text.replace(new RegExp(`\\b(Signatures?)\\s+${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "$1 "));
  }
  if (/^Shield$/i.test(text)) return "NFL Shield Patch";
  if (/\bRookie\s+(?:Material|Materials|Patch|RPA)\s+Signatures?\b/i.test(text)) return "Rookie Patch Auto";
  if (/\b(?:Material|Materials|Patch|RPA)\s+Signatures?\b/i.test(text)) return "Patch Auto";
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
  if (/^(?:Auto\s+Patch|Patch\s+Auto)$/i.test(cardType) && hasAuto && (hasPatch || hasRelic)) return true;
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

function sportSuffixFromSet(resolved = {}) {
  const set = titleCleanup(normalizeText(resolved.set)
    .replace(new RegExp(`^${String(resolved.year || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
  const match = set.match(/\b(Basketball|Football|Baseball|Soccer|Hockey)$/i);
  if (!match) return "";
  return titleCleanup(match[1]);
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
  const productSetOverride = productSetOutputOverride({
    manufacturer,
    brand,
    product,
    set: resolved.set
  });
  if (productSetOverride) return productSetOverride;
  const brandText = brandIdentityText(resolved);
  if (setLooksLikeProductHierarchy(resolved)) return compactOutputProductIdentity(productHierarchyText(resolved));
  if (!product) return compactOutputProductIdentity(productHierarchyText(resolved));

  const brandComparable = normalizeText(brand).toLowerCase();
  const productComparable = normalizeText(product).toLowerCase();
  const brandTextComparable = normalizeText(brandText).toLowerCase();
  if (/^topps$/i.test(manufacturer)
    && (/^bowman\b/i.test(brand) || /^bowman\b/i.test(product))
    && /^bowman\b/i.test(product)) {
    return compactOutputProductIdentity(product);
  }
  if (brandTextComparable && (productComparable === brandTextComparable || productComparable.startsWith(`${brandTextComparable} `))) return compactOutputProductIdentity(product);
  if (brandComparable && (productComparable === brandComparable || productComparable.startsWith(`${brandComparable} `))) {
    return compactOutputProductIdentity([manufacturer, product].filter(Boolean).join(" "));
  }
  const firstProductToken = productComparable.split(/\s+/).find(Boolean);
  if (manufacturer && firstProductToken && brandTextComparable.split(/\s+/).includes(firstProductToken)) {
    return compactOutputProductIdentity([manufacturer, product].filter(Boolean).join(" "));
  }
  return compactOutputProductIdentity([brandText, product].filter(Boolean).join(" "));
}

function setTitleText(resolved = {}, productIdentity = "") {
  if (setLooksLikeProductHierarchy(resolved)) return sportSuffixFromSet(resolved);
  let set = titleCleanup(normalizeText(resolved.set).replace(new RegExp(`^${String(resolved.year || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
  if (!set || phraseIncludes(productIdentity, set)) return "";
  const productPrefix = normalizeText(productIdentity);
  if (productPrefix && set.toLowerCase().startsWith(`${productPrefix.toLowerCase()} `)) {
    set = titleCleanup(set.slice(productPrefix.length));
  }
  const productTokens = comparableTokens(productPrefix);
  const setTokens = comparableTokens(set);
  if (productTokens.length && setTokens.length && productTokens.at(-1) === setTokens[0]) {
    set = titleCleanup(set.split(/\s+/).slice(1).join(" "));
  }
  const productWithoutManufacturer = titleCleanup(normalizeText(resolved.product).replace(new RegExp(`^${String(resolved.manufacturer || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
  [resolved.product, productWithoutManufacturer, resolved.brand].map(normalizeText).filter(Boolean).forEach((prefix) => {
    if (set.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
      set = titleCleanup(set.slice(prefix.length));
    }
  });
  return set;
}

function pureSportSetText(value = "") {
  return /^(?:Basketball|Football|Baseball|Soccer|Hockey)$/i.test(normalizeText(value));
}

function teamTitleText(value) {
  const team = normalizeText(value);
  return team ? `(${team})` : "";
}

function collectorNumberText(resolved = {}) {
  const collector = displayCardNumber(resolved.collector_number, resolved);
  if (!collector) return "";
  const representedText = [
    resolved.card_name,
    resolved.insert,
    resolved.official_card_type,
    resolved.card_type
  ].map(normalizeText).filter(Boolean).join(" ");
  if (/^TCAR(?:[- ]|$)/i.test(collector) && /\bChrome\s+Rookie\s+Auto\b/i.test(representedText)) return "";
  if (/^PRP(?:[- ]|$)/i.test(collector) && /\bPropulsion\b/i.test(representedText)) return "";
  if (/^SR(?:[- ]|$)/i.test(collector) && /\bStar\s+Swatch\s+Signatures?\b/i.test(representedText)) return "";
  return `#${collector.replace(/^#/, "")}`;
}

function numericalRarityText(resolved = {}) {
  return serialLimitText(resolved, { oneOfOne: resolved.one_of_one })
    || (resolved.one_of_one ? "1/1" : "");
}

function titleItems(resolved) {
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
    const designText = [
      cardName,
      existingVariantText,
      resolved.auto ? "Auto" : ""
    ].filter(Boolean).join(" ");
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
    { key: "set", text: setText, priority: pureSportSetText(setText) ? 99 : 16, compactable: true },
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
    { key: "card_number", text: collectorNumber, priority: 88, compactable: false },
    ...searchOptimization,
    ...delayedAttributeCardTypes,
    {
      key: "search_optimization",
      text: team && !phraseIncludes(subject, team) ? teamTitleText(team) : null,
      priority: 96,
      compactable: true
    },
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
