// Listing title grammar and deterministic cleanup — extracted from the v2 monolith (R1).
// Function bodies are intentionally behavior-identical; the HTTP layer only orchestrates them.
import { resolveKnowledgeEntry } from "../../listing-knowledge-registry.mjs";
import {
  backgroundTermPatterns,
  containsBackgroundTerm,
  extractHighValueInsert
} from "./field-normalization.mjs";
import { appendCalibrationReason } from "./result-calibration.mjs";
import {
  normalizeSerialText,
  rawIncludes,
  searchable,
  serialLimitForTitle,
  stripChecklistCardNumbers,
  stripLiteralPhrase,
  titleIncludesSerial,
  yearConflict
} from "./text-match.mjs";

export function normalizeTitle(title, maxLength) {
  const normalized = String(title || "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

export function cleanupTitleWording(title, maxLength) {
  const cleaned = suppressDuplicateAutoTerms(normalizeGradeDisplay(normalizeSerialText(title)
    .replace(/\b(Topps|Panini|Upper Deck|Bowman|Fleer|Donruss)\s+\1\b/gi, "$1")
    .replace(/\bTopps\s+Chrome\s+Autograph\s+Card\b/gi, "Topps Chrome Auto")
    .replace(/\bChrome\s+Autograph\s+Card\b/gi, "Chrome Auto")
    .replace(/\bChrome\s+Autograph\b/gi, "Chrome Auto")
    .replace(/\b(?:Certified\s+)?(?:On[- ]?card\s+|Sticker\s+)?Autograph\b/gi, "Auto")
    .replace(/\bDual\s+Auto\b/gi, "Dual Auto")
    .replace(/\bTriple\s+Auto\b/gi, "Triple Auto")
    .replace(/\bOne\s+of\s+One\b/gi, "1/1")
    .replace(/\bOne\b(?=\s*$)/gi, "1/1")
    .replace(/\bRated\s+Rookie\b/gi, "RC")
    .replace(/\bRookie\s+Card\b/gi, "RC")
    .replace(/\bRookie\s+RC\s+Card\b/gi, "RC")
    .replace(/\bRookie\s+RC\b/gi, "RC")
    .replace(/\bRC\s+Card\b/gi, "RC")
    .replace(/\bRookie\b(?!\s+(?:Refresh|Auto))/gi, "RC")
    .replace(/\bAutograph\s+Auto\b/gi, "Auto")
    .replace(/\bRefractor\s+Parallel\b/gi, "Refractor")
    .replace(/\bCard\s+Card\b/gi, "Card")
    .replace(/\bRC\s+RC\b/gi, "RC")
    .replace(/\bTopps\s+Chrome\s+Chrome\s+Auto\b/gi, "Topps Chrome Auto")
    .replace(/\bChrome\s+Chrome\s+Auto\b/gi, "Chrome Auto")
    .replace(/\bAuto\s+Auto\b/gi, "Auto")
    .replace(/\s+/g, " ")
    .trim()));

  return normalizeTitle(cleaned, maxLength);
}

export function normalizeGradeDisplay(title) {
  return foldLooseAutoGrade(normalizeBgsGradeDisplay(normalizePsaGradeDisplay(title)));
}

export function normalizePsaGradeDisplay(title) {
  return String(title || "")
    .replace(/\bPSA\s+(AUTH|AUTHENTIC)\s+Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA Auth/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(\d+(?:\.\d+)?)\s+(?:GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)?\s*Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(\d+(?:\.\d+)?)\s+(?:GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, autoGrade) => {
      return `PSA AUTO ${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(AUTH|AUTHENTIC)\b/gi, "PSA Auth")
    .replace(/\bPSA\s+AUTO\s+(AUTH|AUTHENTIC)\b/gi, "PSA AUTO Auth");
}

export function normalizeBgsGradeDisplay(title) {
  return String(title || "")
    .replace(/\b(?:Gem\s+Mint\s+|Mint\s+)?Beckett\s+(Altered|Authentic|Auth|\d+(?:\.\d+)?)\s+BGS\s+\1\s+Auto\s+(\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`;
    })
    .replace(/\b(?:Gem\s+Mint\s+|Mint\s+)?Beckett\s+(Altered|Authentic|Auth|\d+(?:\.\d+)?)\s+BGS\s+\1\b/gi, (_, cardGrade) => {
      return `BGS ${normalizeBgsGradeToken(cardGrade)}`;
    })
    .replace(/\bBGS\s+(Altered|Authentic|Auth|\d+(?:\.\d+)?)\s+Auto\s+(\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`;
    })
    .replace(/\bBGS\s+Auto\s+(\d+(?:\.\d+)?)\b/gi, (_, autoGrade) => {
      return `BGS AUTO ${normalizeBgsGradeToken(autoGrade)}`;
    })
    .replace(/\bBGS\s+(Authentic|Auth)\b/gi, "BGS Auth")
    .replace(/\bBGS\s+Altered\b/gi, "BGS Altered");
}

export function foldLooseAutoGrade(title) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();

  const gradeValuePattern = "(?:10|9(?:\\.5)?|8(?:\\.5)?|7(?:\\.5)?|6(?:\\.5)?|5(?:\\.5)?|4(?:\\.5)?|3(?:\\.5)?|2(?:\\.5)?|1(?:\\.5)?)";
  const psaLooseAutoGradePattern = new RegExp(`\\bPSA\\s+(?:\\d+(?:\\.\\d+)?\\s+)?(MINT|GEM\\s+MINT|NM-MT|NM|EX-MT|EX|AUTH|AUTHENTIC|ALTERED)?\\s*(${gradeValuePattern}|AUTH|AUTHENTIC|ALTERED)\\b(?=[\\s\\S]*\\b(?:PSA\\/DNA\\s+Cert\\s+)?(?:Autograph|Auto|AUTO)\\s+(AUTH|AUTHENTIC|${gradeValuePattern})\\b)`, "gi");
  const psaDescriptorGradePattern = new RegExp(`\\bPSA\\s+(?:${gradeValuePattern}\\s+)?(?:MINT|GEM\\s+MINT|NM-MT|NM|EX-MT|EX)\\s+(${gradeValuePattern})\\b(?=[\\s\\S]*\\b(?:PSA\\/DNA\\s+Cert\\s+)?(?:Autograph|Auto|AUTO)\\s+(AUTH|AUTHENTIC|${gradeValuePattern})\\b)`, "gi");
  const bgsLooseAutoGradePattern = new RegExp(`\\bBGS\\s+(?:\\d+(?:\\.\\d+)?\\s+)?(?:GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX|AUTHENTIC|AUTH|ALTERED)?\\s*(${gradeValuePattern}|AUTHENTIC|AUTH|ALTERED)\\b(?=[\\s\\S]*\\b(?:Autograph|Auto|AUTO)\\s+(${gradeValuePattern})\\b)`, "gi");
  const bgsLeadingAutoGradePattern = new RegExp(`\\b(?:Autograph|Auto|AUTO)\\s+(${gradeValuePattern})\\s+BGS\\s+(?:GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX|AUTHENTIC|AUTH|ALTERED)?\\s*(${gradeValuePattern}|AUTHENTIC|AUTH|ALTERED)\\b`, "gi");

  cleaned = cleaned.replace(
    psaDescriptorGradePattern,
    (_, cardGrade, autoGrade) => `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`
  );

  cleaned = cleaned.replace(
    psaLooseAutoGradePattern,
    (_, _descriptor, cardGrade, autoGrade) => `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`
  );

  cleaned = cleaned.replace(
    bgsLooseAutoGradePattern,
    (_, cardGrade, autoGrade) => `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`
  );

  cleaned = cleaned.replace(
    bgsLeadingAutoGradePattern,
    (_, autoGrade, cardGrade) => `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`
  );

  if (/\b(?:PSA|BGS)\s+(?:Auth|\d+(?:\.\d+)?)\/(?:Auth|\d+(?:\.\d+)?)\b/i.test(cleaned)) {
    cleaned = cleaned.replace(new RegExp(`\\b(?:PSA\\/DNA\\s+Cert\\s+)?(?:Autograph|Auto|AUTO)\\s+(AUTH|AUTHENTIC|${gradeValuePattern})\\b`, "gi"), " ");
  }

  return cleaned
    .replace(/\b(?:Gem\s+Mint|Mint|Authentic|Altered)\s+(?=BGS\s+(?:Altered|Auth|\d+(?:\.\d+)?(?:\/(?:Auth|\d+(?:\.\d+)?))?))/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePsaGradeToken(value) {
  const token = String(value || "").trim();
  return /^(?:AUTH|AUTHENTIC)$/i.test(token) ? "Auth" : token;
}

export function normalizeBgsGradeToken(value) {
  const token = String(value || "").trim();
  if (/^Authentic$/i.test(token)) return "Auth";
  if (/^Auth$/i.test(token)) return "Auth";
  if (/^Altered$/i.test(token)) return "Altered";
  return token;
}

export function suppressDuplicateAutoTerms(title) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const protectedAutoPhrases = [
    "Chrome Rookie Auto",
    "Chrome Auto",
    "Dual Signatures Auto",
    "PSA AUTO",
    "BGS AUTO"
  ];
  const placeholder = "__AUTO__";

  protectedAutoPhrases.forEach((phrase) => {
    cleaned = cleaned.replace(new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi"), phrase.replace(/\bAuto\b/i, placeholder));
  });

  const autoMatches = cleaned.match(/\bAuto\b/gi) || [];
  const hasProtectedAuto = cleaned.includes(placeholder);
  if (autoMatches.length <= 1 && !hasProtectedAuto) return cleaned;
  if (autoMatches.length <= 1 && !/\b(?:RC|Rookie)\s+Auto\b/i.test(cleaned)) {
    return cleaned
      .replace(new RegExp(placeholder, "g"), "Auto")
      .replace(/\b(PSA|BGS)\s+Auto\b/g, (_, company) => `${company} AUTO`);
  }
  if (autoMatches.length === 0) {
    return cleaned.replace(new RegExp(placeholder, "g"), "Auto");
  }

  if (hasProtectedAuto) {
    cleaned = cleaned
      .replace(/\bRC\s+Auto\b/gi, "RC")
      .replace(/\bRookie\s+Auto\b/gi, "Rookie")
      .replace(/\bAuto\b/gi, " ");
  } else {
    let seenAuto = false;
    cleaned = cleaned.replace(/\bAuto\b/gi, (match) => {
      if (seenAuto) return " ";
      seenAuto = true;
      return match;
    });
  }

  cleaned = cleaned
    .replace(new RegExp(placeholder, "g"), "Auto")
    .replace(/\b(PSA|BGS)\s+Auto\b/g, (_, company) => `${company} AUTO`)
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

export function moveLeadingGradeToEnd(title, maxLength) {
  const normalized = cleanupTitleWording(title, maxLength);
  const leadingGrade = normalized.match(/^(PSA|BGS|CGC)\s+(?:GEM\s+MINT\s+|MINT\s+|PRISTINE\s+)?(\d+(?:\.\d+)?)\s+(.+)$/i);
  if (leadingGrade) {
    const [, company, grade, rest] = leadingGrade;
    return cleanupTitleWording(`${rest} ${company.toUpperCase()} ${grade}`, maxLength);
  }

  const gradePattern = /\b(?:PSA\s+(?:AUTO\s+)?(?:Auth\/(?:Auth|\d+(?:\.\d+)?)|\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Auth|\d+(?:\.\d+)?)|BGS\s+(?:AUTO\s+)?(?:\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Altered|Auth|\d+(?:\.\d+)?)|CGC\s+(?:Auth|\d+(?:\.\d+)?))\b/gi;
  const gradeMatches = [...normalized.matchAll(gradePattern)];
  if (gradeMatches.length === 0) return normalized;

  const grade = gradeMatches.at(-1)[0].replace(/\bPSA\s+AUTO\b/i, "PSA AUTO");
  const withoutGrade = normalized.replace(gradePattern, " ").replace(/\s+/g, " ").trim();
  if (!withoutGrade) return cleanupTitleWording(grade, maxLength);

  return cleanupTitleWording(`${withoutGrade} ${grade}`, maxLength);
}

export function applySportsTitleGrammar(title, fields, maxLength) {
  if (!fields.player) return cleanupTitleWording(title, maxLength);

  let cleaned = cleanupTitleWording(positionSportsProductName(ensureSportsProductName(title, fields), fields), maxLength * 2);
  const cardType = resolveProtectedCardType(cleaned, fields);
  if (!cardType || !rawIncludes(cleaned, fields.player)) {
    return finalizeSportsTitle(cleaned, fields, maxLength);
  }

  const withoutCardType = stripLiteralPhrase(cleaned, cardType);
  const playerPattern = new RegExp(fields.player.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  cleaned = withoutCardType.replace(playerPattern, (match) => `${match} ${cardType}`);

  return finalizeSportsTitle(cleaned, fields, maxLength);
}

export function finalizeSportsTitle(title, fields, maxLength) {
  const requiredTerms = [
    sportsTitleShouldRecoverSerial(fields, title) ? serialLimitForTitle(fields.numerical_rarity, fields) : null,
    sportsTitleNeedsRc(fields, title) ? "RC" : null
  ].filter(Boolean);
  let cleaned = ensureSportsRcMarker(cleanupTitleWording(title, maxLength * 2), fields);

  if (requiredTerms.length > 0) {
    cleaned = fitRequiredTitleTerms(cleaned, requiredTerms, fields, maxLength);
  }

  return normalizeTitle(cleanupTitleWording(cleaned, maxLength * 2), maxLength);
}

export function ensureSportsProductName(title, fields) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const brand = String(fields.brand || "").trim();
  const product = String(fields.product || "").trim();
  if (!product) return cleaned;

  const productName = sportsProductDisplayName(brand, product);
  if (brand && productName) {
    cleaned = cleaned.replace(
      new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      productName
    );
  }

  if (productName && !rawIncludes(cleaned, productName) && rawIncludes(cleaned, product)) {
    cleaned = cleaned.replace(new RegExp(`\\b${product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), productName);
  }

  const productCore = (brand
    ? product.replace(new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ")
    : product)
    .replace(/\bCollection\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (productName && productCore && !rawIncludes(cleaned, productName) && rawIncludes(cleaned, productCore)) {
    cleaned = cleaned.replace(new RegExp(`\\b${productCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), productName);
  }

  if (productName && productCore && productName !== productCore && rawIncludes(cleaned, productName)) {
    cleaned = dedupeRecoveredProductCore(cleaned, productName, productCore);
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

export function positionSportsProductName(title, fields) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const productName = sportsProductDisplayName(fields.brand, fields.product);
  if (!productName || !rawIncludes(cleaned, productName)) return cleaned;

  cleaned = stripLiteralPhrase(cleaned, productName);
  const year = String(fields.year || "").trim();
  if (year && rawIncludes(cleaned, year)) {
    return cleaned.replace(new RegExp(`\\b${year.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), `${year} ${productName}`)
      .replace(/\s+/g, " ")
      .trim();
  }

  return `${productName} ${cleaned}`.replace(/\s+/g, " ").trim();
}

export function dedupeRecoveredProductCore(title, productName, productCore) {
  const escapedCore = productCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedProduct = productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const productPattern = new RegExp(`\\b${escapedProduct}\\b`, "i");
  const corePattern = new RegExp(`\\b${escapedCore}\\b`, "gi");
  const productMatch = productPattern.exec(title);
  if (!productMatch) return title;

  return title.replace(corePattern, (match, offset) => {
    const insideProduct = offset >= productMatch.index && offset < productMatch.index + productMatch[0].length;
    return insideProduct ? match : " ";
  }).replace(/\s+/g, " ").trim();
}

export function sportsProductDisplayName(brand, product) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedProduct = String(product || "").replace(/\s+/g, " ").trim();
  if (!normalizedProduct) return normalizedProduct;

  if (/^Panini\s+Immaculate\s+Collection$/i.test(`${normalizedBrand} ${normalizedProduct}`) || /^Immaculate\s+Collection$/i.test(normalizedProduct)) {
    return "Panini Immaculate";
  }

  return normalizedBrand && !rawIncludes(normalizedProduct, normalizedBrand)
    ? `${normalizedBrand} ${normalizedProduct}`
    : normalizedProduct;
}

export function ensureSportsRcMarker(title, fields) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const needsRc = sportsTitleNeedsRc(fields, cleaned);

  if (!needsRc || /\bRC\b/i.test(cleaned)) return cleaned;

  const gradePattern = /\b(?:PSA\s+(?:AUTO\s+)?(?:Auth\/(?:Auth|\d+(?:\.\d+)?)|\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Auth|\d+(?:\.\d+)?)|BGS\s+(?:AUTO\s+)?(?:\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Altered|Auth|\d+(?:\.\d+)?)|CGC\s+(?:Auth|\d+(?:\.\d+)?))\b$/i;
  const grade = cleaned.match(gradePattern)?.[0];
  if (!grade) return `${cleaned} RC`.replace(/\s+/g, " ").trim();

  cleaned = cleaned.slice(0, -grade.length).trim();
  return `${cleaned} RC ${grade}`.replace(/\s+/g, " ").trim();
}

export function sportsTitleNeedsRc(fields, title) {
  return /\bRC\b/i.test(String(fields.subset || ""))
    || /Chrome Rookie Auto/i.test(`${fields.insert || ""} ${title || ""}`);
}

export function sportsTitleShouldRecoverSerial(fields, title) {
  if (!fields.numerical_rarity && !fields.one_of_one) return false;
  if (titleIncludesSerial(title, fields)) return true;
  const combined = `${fields.insert || ""} ${fields.product || ""} ${title || ""}`;
  return /Chrome Rookie Auto|Chrome Auto|Dual Signatures|Duo Logoman Autographs|Star Swatch Signatures|Immaculate|Flawless|Prizm/i.test(combined);
}

export function repairOrphanAutoGradeSuffix(title, fields, maxLength) {
  const serial = serialLimitForTitle(fields.numerical_rarity || "", fields);
  if (/^\/\d+(?:\.\d+)?$/.test(serial)) return title;

  const repaired = String(title || "")
    .replace(/\s+\/(Auth|\d+(?:\.\d+)?)\s+(PSA|BGS)\s+(Auth|\d+(?:\.\d+)?)\b/gi, (_, autoGrade, company, cardGrade) => {
      return ` ${company.toUpperCase()} ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\s+/g, " ")
    .trim();

  return normalizeTitle(repaired, maxLength);
}

export function resolveProtectedCardType(title, fields) {
  const protectedTypes = [
    "Chrome Rookie Auto",
    "Chrome Auto",
    "Dual Signatures Auto",
    "Dual Signatures",
    "Duo Logoman Autographs",
    "Star Swatch Signatures"
  ];
  const explicitInsert = protectedTypes.find((term) => rawIncludes(fields.insert, term));
  if (explicitInsert) return explicitInsert;
  return protectedTypes.find((term) => rawIncludes(title, term));
}

export function stripBackgroundTerms(value) {
  return backgroundTermPatterns.reduce(
    (text, pattern) => text.replace(pattern, " "),
    String(value || "")
  ).replace(/\s+/g, " ").trim();
}

export function ensureTitleTerm(title, term) {
  if (!term || rawIncludes(title, term)) return title;
  return `${title} ${term}`.replace(/\s+/g, " ").trim();
}

export function ensureTitleTerms(title, terms) {
  return terms.reduce((currentTitle, term) => ensureTitleTerm(currentTitle, term), title);
}

export function compactLowPriorityTitleTerms(title, fields, maxLength) {
  if (String(title || "").length <= maxLength) return title;

  const lowPriorityTerms = [
    fields.team,
    fields.position,
    "NBA",
    "NFL",
    "MLB",
    "NHL",
    "UFC",
    "Golden State Warriors",
    "Oklahoma City Thunder",
    "Thunder",
    "Jersey No.",
    "Collection",
    "RC Card",
    "Card"
  ].filter(Boolean);

  return lowPriorityTerms.reduce(
    (currentTitle, term) => stripLiteralPhrase(currentTitle, term),
    title
  ).replace(/\s+/g, " ").trim();
}

export function fitRequiredTitleTerms(title, requiredTerms, fields, maxLength) {
  let currentTitle = ensureTitleTerms(title, requiredTerms);
  let normalizedTitle = normalizeTitle(currentTitle, maxLength);

  if (requiredTerms.every((term) => rawIncludes(normalizedTitle, term))) {
    return currentTitle;
  }

  const removableTerms = [
    fields.team,
    fields.brand,
    fields.product,
    "Golden State Warriors",
    "Oklahoma City Thunder",
    "Thunder",
    "Immaculate Collection",
    "Collection",
    "Jersey No.",
    "RC Card",
    "Card"
  ].filter(Boolean);

  for (const term of removableTerms) {
    currentTitle = stripLiteralPhrase(currentTitle, term);
    currentTitle = ensureTitleTerms(currentTitle, requiredTerms);
    normalizedTitle = normalizeTitle(currentTitle, maxLength);

    if (requiredTerms.every((requiredTerm) => rawIncludes(normalizedTitle, requiredTerm))) {
      return currentTitle;
    }
  }

  return currentTitle;
}

export function sanitizeResultText(result, fields, confidence, unresolved, maxTitleLength) {
  const hadBackgroundContamination = [
    result.title,
    result.reason,
    ...Object.values(result.fields || {})
  ].some((value) => typeof value === "string" && containsBackgroundTerm(value));

  const highValueInsert = resolveKnowledgeEntry(fields.insert)?.label || extractHighValueInsert(fields.insert);
  const rawTitle = stripChecklistCardNumbers(stripBackgroundTerms(result.title), fields)
    .replace(/\bBase\b/gi, fields.insert || fields.parallel ? " " : "Base")
    .replace(/\s+/g, " ")
    .trim();
  const requiredTitleTerms = [
    fields.product && !rawIncludes(rawTitle, fields.product) ? fields.product : null,
    fields.product === "Topps Cosmic Chrome" ? "Cosmic Chrome" : null,
    highValueInsert,
    fields.parallel === "Platinum" ? "Platinum" : null,
    titleIncludesSerial(rawTitle, fields) ? serialLimitForTitle(fields.numerical_rarity, fields) : null,
    fields.one_of_one ? "1/1" : null,
    fields.grade_company && fields.grade ? `${fields.grade_company} ${String(fields.grade).match(/\d+(?:\.\d+)?/)?.[0] || fields.grade}` : null,
    fields.grade_company && /auto/i.test(String(result.title || "")) && /auto\s*10/i.test(String(result.title || "")) ? "Auto 10" : null
  ].filter(Boolean);
  let strippedTitle = rawTitle;

  if (fields.product === "Topps Cosmic Chrome") {
    strippedTitle = strippedTitle
      .replace(/\bTopps\s+Chrome\s+Cosmic\b/gi, "Topps Cosmic Chrome")
      .replace(/\bTopps\s+Chrome\b/gi, "Topps Cosmic Chrome");
  }

  if (fields.year && yearConflict(searchable(strippedTitle), fields.year)) {
    strippedTitle = strippedTitle.replace(/\b20\d{2}(?:-\d{2})?\b/, fields.year);
  }

  if (fields.one_of_one) {
    strippedTitle = strippedTitle
      .replace(/\bOne\s+of\s+One\b/gi, "1/1")
      .replace(/\bOne\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (highValueInsert === "Red Propulsion") {
    strippedTitle = strippedTitle.replace(/\bPropulsion\b/gi, "Red Propulsion");
  }

  if (highValueInsert === "Dual Signatures") {
    strippedTitle = strippedTitle.replace(/\bDual\b(?!\s+Signatures\b)/gi, "Dual Signatures");
    strippedTitle = strippedTitle.replace(/\bDual\s+Signatures\b(?!\s+Auto\b)/gi, "Dual Signatures Auto");
  }

  if (highValueInsert === "Duo Logoman Autographs") {
    strippedTitle = strippedTitle.replace(/\bDual\s+Auto\b|\bDual\b/gi, "Duo Logoman Autographs");
  }

  if (highValueInsert === "Star Swatch Signatures") {
    strippedTitle = strippedTitle.replace(/\bPatch\s+Auto\b/gi, "Star Swatch Signatures");
  }

  const repairedTitle = fitRequiredTitleTerms(
    compactLowPriorityTitleTerms(strippedTitle, fields, maxTitleLength),
    requiredTitleTerms,
    fields,
    maxTitleLength
  );
  const repairedHighValueInsert = Boolean(highValueInsert && !rawIncludes(strippedTitle, highValueInsert));
  const title = applySportsTitleGrammar(repairedTitle, fields, maxTitleLength);
  let reason = stripBackgroundTerms(result.reason);
  let guardedConfidence = confidence;
  const guardedUnresolved = [...unresolved];

  if (repairedHighValueInsert) {
    reason = appendCalibrationReason(reason, "High-value insert term preserved from structured evidence.");
  }

  const illustratorGuard = applyIllustratorMetadataGuard({
    title,
    reason: hadBackgroundContamination
      ? appendCalibrationReason(reason, "Background branding ignored.")
      : reason,
    fields,
    confidence: guardedConfidence,
    unresolved: guardedUnresolved,
    maxTitleLength
  });

  return {
    ...illustratorGuard,
    hadBackgroundContamination
  };
}

export function applyIllustratorMetadataGuard({ title, reason, fields, confidence, unresolved, maxTitleLength }) {
  if (!fields.artist || fields.sketch) {
    return { title, reason, confidence, unresolved };
  }

  const artistInTitle = rawIncludes(title, fields.artist);
  const identity = fields.character || fields.player;
  const likelyPokemonTrainer = [
    title,
    reason,
    fields.brand,
    fields.product,
    fields.set,
    fields.subset,
    fields.insert
  ].some((value) => /pokemon|pokémon|trainer|supporter|tcg|支援者|训练家|訓練家|寶可夢|宝可梦/i.test(String(value || "")));

  if (!artistInTitle && !likelyPokemonTrainer) {
    return { title, reason, confidence, unresolved };
  }

  let guardedTitle = artistInTitle ? stripLiteralPhrase(title, fields.artist) : title;
  if (likelyPokemonTrainer && !fields.year) {
    guardedTitle = guardedTitle.replace(/\b20\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
  }

  if (identity && !rawIncludes(guardedTitle, identity)) {
    guardedTitle = `${identity} ${guardedTitle}`.replace(/\s+/g, " ").trim();
  }

  guardedTitle = ensureTitleTerm(guardedTitle, fields.card_number);
  guardedTitle = ensureTitleTerm(guardedTitle, fields.subset);
  guardedTitle = ensureTitleTerm(guardedTitle, fields.set);

  const guardedUnresolved = [...unresolved];
  if (!guardedUnresolved.includes("illustrator metadata only")) {
    guardedUnresolved.push("illustrator metadata only");
  }

  return {
    title: normalizeTitle(guardedTitle, maxTitleLength),
    confidence: confidence === "HIGH" ? "MEDIUM" : confidence,
    reason: appendCalibrationReason(reason, identity
      ? "Illustrator is metadata only."
      : "Illustrator is metadata only; localized trainer identity requires operator review."),
    unresolved: guardedUnresolved
  };
}

