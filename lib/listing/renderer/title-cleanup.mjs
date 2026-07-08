import {
  denominatorOnlyPrintRun,
  expandPrintRunFields,
  parsePrintRunValue,
  printRunTitleText
} from "../print-run/print-run-fields.mjs";

export function normalizeText(value) {
  const raw = String(value ?? "").trim();
  const jsonLike = raw.startsWith("[") && raw.endsWith("]") || raw.startsWith("\"") && raw.endsWith("\"");
  if (jsonLike) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => ["string", "number"].includes(typeof item))) {
        return parsed.map((item) => String(item).trim()).filter(Boolean).join(" / ")
          .replace(/\s+/g, " ")
          .trim();
      }
      if (["string", "number"].includes(typeof parsed)) {
        return String(parsed)
          .replace(/\s+/g, " ")
          .trim();
      }
    } catch {
      // Keep the original text when a bracketed card name is not JSON.
    }
  }
  return raw
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

export function printRunLimitText(value, {
  oneOfOne = false,
  directCurrentInstance = true
} = {}) {
  const fields = typeof value === "object" && value !== null
    ? value
    : { print_run_number: value, one_of_one: oneOfOne };
  return printRunTitleText(fields, { directCurrentInstance });
}

export function serialLimitText(value, options = {}) {
  return printRunLimitText(value, options);
}

export function serialDenominatorOnlyText(value) {
  return denominatorOnlyPrintRun(expandPrintRunFields({ serial_number: value }))
    || denominatorOnlyPrintRun(parsePrintRunValue(value));
}

export function normalizeGradeToken(value) {
  if (typeof value === "boolean") return "";
  const token = normalizeText(value);
  if (!token) return "";
  if (/^(?:AUTH|AUTHENTIC)$/i.test(token)) return "Auth";
  if (/^ALTERED$/i.test(token)) return "Altered";

  const numeric = token.match(/\b\d+(?:\.\d+)?\b/);
  if (numeric) return numeric[0];
  if (/^(?:true|false|null|none|unknown|n\/?a|graded|ungraded|card|auto|mint|gem\s*mint|gem\s*mt|nm\s*-?\s*mt|near\s*mint|excellent|very\s*good|good|poor)$/i.test(token)) {
    return "";
  }
  return "";
}

export function normalizeAutoGradeToken(value) {
  if (typeof value === "boolean") return "";
  const token = normalizeText(value);
  if (!token) return "";
  if (/^(?:AUTH|AUTHENTIC)$/i.test(token)) return "Auth";
  if (/^ALTERED$/i.test(token)) return "Altered";
  const labeled = token.match(/^(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|ALTERED|\d+(?:\.\d+)?)$/i);
  if (labeled) return normalizeAutoGradeToken(labeled[1]);
  return /^\d+(?:\.\d+)?$/.test(token) ? token : "";
}

function normalizeGradeCompanyText(value) {
  if (typeof value === "boolean") return "";
  const company = normalizeText(value).toUpperCase();
  if (!company) return "";
  if (/^(?:TRUE|FALSE|NULL|NONE|UNKNOWN|N\/?A|GRADED|UNGRADED|CARD|AUTO|GRADE)$/i.test(company)) return "";
  return company;
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
    .replace(/\bRef\.?\b/gi, "Refractor")
    .replace(/\bRefractors\b/gi, "Refractor")
    .replace(/\bHOR\s+PAT\s+AUTO\b/gi, "Patch Auto")
    .replace(/\bPAT\s+AUTO\b/gi, "Patch Auto")
    .replace(/\bAuto\s+Auto\b/gi, "Auto")
    .replace(/\bAuto\s+Patch\b/gi, "Patch Auto")
    .replace(/\bPatch\s+Auto\s+Patch\s+Auto\b/gi, "Patch Auto")
    .replace(/\b(Swatch\s+Signatures\b(?:(?!\bPatch\s+Auto\b).)*?)\s+Patch\s+Auto\b/gi, "$1")
    .replace(/\b(Chrome|Finest|Gusto|Hoopla|Club\s+Legends|Canvas\s+Creations)\s+\1\b/gi, "$1")
    .replace(/\bAuto\s+(1st\s+Bowman)\b/gi, "$1 Auto")
    .replace(/\bOne\s+of\s+One\b/gi, "1/1")
    .replace(/\bCard\s+Card\b/gi, "Card")
    .replace(/\bTRUE\s+(?:GEM\s*)?\d+(?:\.\d+)?\b/gi, " ")
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

const outputProductConfigurationPattern = /\b(?:FOTL|First\s+Off\s+The\s+Line|Hobby|Retail|Choice|Fast\s+Break)\b/gi;

export function stripOutputProductConfiguration(value) {
  return titleCleanup(normalizeText(value)
    .replace(/\bFirst\s+Off\s+The\s+Line\b/gi, "FOTL")
    .replace(outputProductConfigurationPattern, " "));
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
  if (/^topps$/i.test(brand) && /^bowman\b/i.test(product)) return titleCleanup(product);
  if (productComparable === brandComparable || productComparable.startsWith(`${brandComparable} `)) {
    return titleCleanup(product);
  }

  return titleCleanup(`${brand} ${product}`);
}

export function brandIdentityText(resolved = {}) {
  const parts = [];
  const brandPart = (value) => {
    const text = normalizeText(value);
    return /^Panini\s+America(?:,\s*Inc\.?)?$/i.test(text) ? "Panini" : text;
  };
  pushProductIdentityPhrase(parts, brandPart(resolved.manufacturer));
  pushProductIdentityPhrase(parts, brandPart(resolved.brand));
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
    let text = stripOutputProductConfiguration(value);
    if (year) {
      text = titleCleanup(text.replace(new RegExp(`^${year.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""));
    }
    if (/^(?:Encased|Status|National\s+Treasures)\s+(?:Basketball|Football|Baseball|Soccer|Hockey)$/i.test(text)) {
      text = titleCleanup(text.replace(/\s+(?:Basketball|Football|Baseball|Soccer|Hockey)$/i, ""));
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
  if (product && set) {
    const productTokens = normalizeComparable(product).split(/\s+/).filter(Boolean);
    const setTokens = normalizeComparable(set).split(/\s+/).filter(Boolean);
    if (productTokens.length && setTokens.length && productTokens.at(-1) === setTokens[0]) {
      const setWithoutOverlap = titleCleanup(set.split(/\s+/).slice(1).join(" "));
      if (setWithoutOverlap) {
        pushProductIdentityPhrase(parts, product);
        pushProductIdentityPhrase(parts, setWithoutOverlap);
        return titleCleanup(parts.join(" "));
      }
    }
  }
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

function subjectCodeVariants(subject = "") {
  const words = normalizeText(subject)
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const first = words[0] || "";
  const last = words.at(-1) || "";
  const variants = new Set();
  if (first && last && first !== last) {
    variants.add(`${first[0] || ""}${last[0] || ""}`);
    variants.add(`${first[0] || ""}${last.slice(0, 2)}`);
    variants.add(`${first[0] || ""}${last.slice(0, 3)}`);
  }
  if (last) variants.add(last.slice(0, 3));
  return [...variants].map((value) => value.toUpperCase()).filter((value) => value.length >= 2);
}

export function displayCardNumber(value, resolved = {}) {
  const text = normalizeText(value).replace(/^#/, "");
  if (!text) return "";
  const subjectCodes = (Array.isArray(resolved.players) ? resolved.players : [resolved.player, resolved.character])
    .flatMap(subjectCodeVariants);
  const match = text.match(/^([A-Z]{2,8})-([A-Z]{2,6})$/i);
  if (match && subjectCodes.includes(match[2].toUpperCase())) return match[1].toUpperCase();
  return text;
}

export function renderGrade(resolved = {}) {
  const company = normalizeGradeCompanyText(resolved.grade_company);
  const cardGrade = normalizeGradeToken(resolved.card_grade);
  const autoGrade = normalizeAutoGradeToken(resolved.auto_grade);

  if (!company) {
    return "";
  }

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
  return "";
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
