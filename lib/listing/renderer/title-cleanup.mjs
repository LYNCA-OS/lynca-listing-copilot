export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeComparable(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSerial(value) {
  return normalizeText(value)
    .replace(/#(\d{1,5})\s*\/\s*(\d{1,5})\b/g, "$1/$2")
    .replace(/\b(\d{1,5})\s*\/\s*(\d{1,5})\b/g, "$1/$2");
}

export function serialLimitText(value, {
  oneOfOne = false
} = {}) {
  const serial = normalizeSerial(value);
  if (!serial) return "";

  const denominatorOnly = serial.match(/^#?\s*\/\s*0*(\d{1,6})\b/);
  if (denominatorOnly) {
    const denominator = denominatorOnly[1];
    return denominator === "1" ? "1/1" : `#/${denominator}`;
  }

  const numbered = serial.match(/(?:^|[^A-Z0-9])(0*\d{1,6})\s*\/\s*0*(\d{1,6})\b/i);
  if (!numbered) return "";

  const numerator = numbered[1];
  const denominator = numbered[2];
  const numeratorValue = Number(numerator);
  const denominatorValue = Number(denominator);
  if (denominatorValue === 1 && (oneOfOne || numeratorValue === 1)) return "1/1";
  if (numeratorValue >= 1 && numeratorValue <= denominatorValue) {
    return `#/${denominator}`;
  }
  return `#/${denominator}`;
}

export function serialDenominatorOnlyText(value) {
  const serial = normalizeSerial(value);
  if (!serial) return "";
  const match = serial.match(/\/\s*0*(\d{1,6})\b/);
  if (!match) return serial;
  const denominator = match[1];
  return denominator === "1" ? "1/1" : `#/${denominator}`;
}

export function normalizeGradeToken(value) {
  const token = normalizeText(value);
  if (/^(?:AUTH|AUTHENTIC)$/i.test(token)) return "Auth";
  if (/^ALTERED$/i.test(token)) return "Altered";

  const numeric = token.match(/\b\d+(?:\.\d+)?\b/);
  return numeric ? numeric[0] : token;
}

export function titleCleanup(value) {
  return normalizeText(value)
    .replace(/\bPokémon\b/giu, "Pokemon")
    .replace(/\bRookie\s+Card\b/gi, "RC")
    .replace(/\bRated\s+Rookie\b/gi, "RC")
    .replace(/\bRookie\s+RC\b/gi, "RC")
    .replace(/\bRC\s+RC\b/gi, "RC")
    .replace(/\bAutograph\b/gi, "Auto")
    .replace(/\bAutos\b/gi, "Auto")
    .replace(/\bAuto\s+Auto\b/gi, "Auto")
    .replace(/\b(Chrome|Finest|Gusto|Hoopla|Club\s+Legends|Canvas\s+Creations)\s+\1\b/gi, "$1")
    .replace(/\bAuto\s+(1st\s+Bowman)\b/gi, "$1 Auto")
    .replace(/\bOne\s+of\s+One\b/gi, "1/1")
    .replace(/\bCard\s+Card\b/gi, "Card")
    .replace(/\s+(,)/g, "$1")
    .replace(/(,)(?=\S)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

const nonEnglishTitleScriptPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;

export function containsNonEnglishTitleScript(value) {
  return nonEnglishTitleScriptPattern.test(normalizeText(value));
}

export function phraseIncludes(value, needle) {
  const normalizedNeedle = normalizeComparable(needle);
  if (!normalizedNeedle) return true;
  return normalizeComparable(value).includes(normalizedNeedle);
}

export function pushUniquePhrase(parts, phrase) {
  const text = titleCleanup(phrase);
  if (!text) return;

  const comparable = normalizeComparable(text);
  if (!comparable) return;
  if (parts.some((part) => normalizeComparable(part) === comparable || normalizeComparable(part).includes(comparable))) {
    return;
  }

  const containingIndex = parts.findIndex((part) => comparable.includes(normalizeComparable(part)));
  if (containingIndex !== -1) {
    parts.splice(containingIndex, 1, text);
    return;
  }

  parts.push(text);
}

function pushProductIdentityPhrase(parts, phrase) {
  const text = titleCleanup(phrase);
  if (!text) return;

  const comparable = normalizeComparable(text);
  if (!comparable) return;
  if (parts.some((part) => {
    const partComparable = normalizeComparable(part);
    return partComparable === comparable || partComparable.includes(comparable);
  })) {
    return;
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const partComparable = normalizeComparable(parts[index]);
    if (partComparable && comparable.includes(partComparable)) parts.splice(index, 1);
  }

  parts.push(text);
}

export function productIdentityText(resolved = {}) {
  const parts = [];
  const brand = normalizeText(resolved.brand || resolved.manufacturer);
  const product = normalizeText(resolved.product);
  const set = normalizeText(resolved.set);

  if (/^Panini$/i.test(brand) && /^Immaculate\s+Collection$/i.test(product)) {
    pushProductIdentityPhrase(parts, "Panini Immaculate");
    pushProductIdentityPhrase(parts, set);
    return titleCleanup(parts.join(" "));
  }

  pushProductIdentityPhrase(parts, brand);
  pushProductIdentityPhrase(parts, product);
  pushProductIdentityPhrase(parts, set);

  return titleCleanup(parts.join(" "));
}

export function productHierarchyText(resolved = {}) {
  const brand = brandIdentityText(resolved);
  const product = productSetText(resolved);
  const brandComparable = normalizeComparable(brand);
  const productComparable = normalizeComparable(product);

  if (!brand) return titleCleanup(product);
  if (!product) return titleCleanup(brand);
  if (productComparable === brandComparable || productComparable.startsWith(`${brandComparable} `)) {
    return titleCleanup(product);
  }

  return titleCleanup(`${brand} ${product}`);
}

export function brandIdentityText(resolved = {}) {
  const parts = [];
  pushProductIdentityPhrase(parts, resolved.manufacturer);
  pushProductIdentityPhrase(parts, resolved.brand);
  return titleCleanup(parts.join(" "));
}

export function productSetText(resolved = {}) {
  const parts = [];
  const brandText = brandIdentityText(resolved);
  const manufacturerText = normalizeText(resolved.manufacturer);
  const compactComparable = (value) => normalizeComparable(value)
    .replace(/\b(?:trading cards?|memorabilia|collection|basketball|football|baseball|soccer|hockey)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const brandComparables = [
    brandText,
    resolved.manufacturer,
    resolved.brand,
    compactComparable(brandText),
    compactComparable(resolved.brand)
  ].map(normalizeComparable).filter(Boolean);
  const year = normalizeText(resolved.year);

  const cleanPart = (value) => {
    let text = normalizeText(value);
    if (year) {
      text = titleCleanup(text.replace(new RegExp(`^${year.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
    }
    for (const brand of brandComparables) {
      const comparable = normalizeComparable(text);
      if (brand && comparable.startsWith(`${brand} `)) {
        text = titleCleanup(text.split(/\s+/).slice(brand.split(" ").length).join(" "));
      }
    }
    return text;
  };

  const originalProduct = normalizeText(resolved.product);
  const originalProductCompactComparable = compactComparable(originalProduct);
  const originalProductComparable = normalizeComparable(originalProduct);
  const set = cleanPart(resolved.set);
  const brandCompactComparables = [
    compactComparable(brandText),
    compactComparable(resolved.brand)
  ].filter(Boolean);
  const brandRawComparables = [
    normalizeComparable(brandText),
    normalizeComparable(resolved.brand)
  ].filter(Boolean);
  if (brandRawComparables.some((brand) => brand && originalProductComparable === brand)) {
    return titleCleanup(set);
  }
  const productIsBrandWithSportSuffix = brandCompactComparables.some((brand) => {
    if (!brand) return false;
    const remainder = originalProductComparable.startsWith(`${brand} `)
      ? originalProductComparable.slice(brand.length).trim()
      : "";
    return /^(?:basketball|football|baseball|soccer|hockey)$/.test(remainder);
  });
  if (productIsBrandWithSportSuffix) {
    pushProductIdentityPhrase(parts, brandText);
    pushProductIdentityPhrase(parts, set);
    return titleCleanup(parts.join(" "));
  }

  let product = cleanPart(originalProduct);
  const manufacturerComparable = normalizeComparable(manufacturerText);
  if (/^(?:Basketball|Football|Baseball|Soccer|Hockey|FIFA Soccer)$/i.test(product)
    && manufacturerComparable
    && originalProductComparable.startsWith(`${manufacturerComparable} `)) {
    product = titleCleanup(originalProduct.split(/\s+/).slice(manufacturerText.split(/\s+/).length).join(" "));
  }

  if (/^Immaculate\s+Collection$/i.test(product)) product = "Immaculate";

  pushProductIdentityPhrase(parts, product);
  pushProductIdentityPhrase(parts, set);
  return titleCleanup(parts.join(" "));
}

export function subjectText(resolved = {}) {
  const players = Array.isArray(resolved.players)
    ? resolved.players.map(normalizeText).filter(Boolean)
    : [];
  if (players.length) return players.join(" / ");
  return normalizeText(resolved.character || (resolved.sketch ? resolved.artist : ""));
}

export function renderGrade(resolved = {}) {
  const company = normalizeText(resolved.grade_company).toUpperCase();
  if (!company) return "";

  const cardGrade = normalizeGradeToken(resolved.card_grade);
  const autoGrade = normalizeGradeToken(resolved.auto_grade);

  if (resolved.grade_type === "CARD_AND_AUTO" && cardGrade && autoGrade) {
    if (/^PSA(?:\/DNA)?$/i.test(company) && cardGrade === autoGrade) return `${company} ${cardGrade}`;
    return `${company} ${cardGrade}/${autoGrade}`;
  }

  if (resolved.grade_type === "AUTO_ONLY" && autoGrade) {
    return `${company} AUTO ${autoGrade}`;
  }

  if (resolved.grade_type === "CARD_ONLY" && company === "PSA/DNA" && cardGrade && !autoGrade) {
    return `PSA ${cardGrade}`;
  }

  if (resolved.grade_type === "AUTHENTIC") {
    return `${company} Auth`;
  }

  if (resolved.grade_type === "ALTERED") {
    return `${company} Altered`;
  }

  if (cardGrade) return `${company} ${cardGrade}`;
  if (autoGrade) return `${company} AUTO ${autoGrade}`;
  return company;
}

export function compactSubjectNames(value) {
  return normalizeText(value)
    .split("/")
	    .map((part) => {
	      const words = normalizeText(part).split(" ").filter(Boolean);
	      const last = words.at(-1) || "";
	      if (/^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(last) && words.length >= 2) {
	        return `${words.at(-2)} ${last}`;
	      }
	      return last;
	    })
    .filter(Boolean)
    .join(" / ");
}
