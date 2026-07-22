import { normalizeGradeCompanyValue } from "../grade/grade-company.mjs";

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sameGraderIdentity(value, gradeCompany) {
  const publisher = cleanText(value);
  const grader = normalizeGradeCompanyValue(gradeCompany);
  if (!publisher || !grader) return false;
  return normalizeGradeCompanyValue(publisher) === grader;
}

function publisherFromProduct(product = "") {
  const text = cleanText(product);
  if (/^(?:Topps\s+)?Bowman\b/i.test(text)) {
    return { manufacturer: "Topps", brand: "Bowman" };
  }
  if (/^Topps\b/i.test(text)) return { manufacturer: "Topps", brand: "Topps" };
  if (/^Panini\b/i.test(text)) return { manufacturer: "Panini", brand: "Panini" };
  if (/^Donruss\b/i.test(text)) return { manufacturer: "Panini", brand: "Donruss" };
  if (/^(?:Upper\s+Deck|UD)\b/i.test(text)) {
    return { manufacturer: "Upper Deck", brand: "Upper Deck" };
  }
  if (/^Leaf\b/i.test(text)) return { manufacturer: "Leaf", brand: "Leaf" };
  return null;
}

const canonicalPublisherNames = new Map([
  ["topps", "Topps"],
  ["bowman", "Bowman"],
  ["panini", "Panini"],
  ["donruss", "Donruss"],
  ["upper deck", "Upper Deck"],
  ["leaf", "Leaf"]
]);

function recognizedPublisherName(value) {
  return canonicalPublisherNames.get(cleanText(value).toLowerCase()) || null;
}

function publisherCompatibleWithProduct(value, product) {
  const publisher = recognizedPublisherName(value);
  const productText = cleanText(product).toLowerCase();
  if (!publisher || !productText) return null;
  const token = publisher.toLowerCase();
  if (productText.includes(token)) return publisher;
  if (publisher === "Topps" && /^(?:topps\s+)?bowman\b/i.test(productText)) return publisher;
  return null;
}

// Publisher identity is redundant with an explicit product prefix. Prefer that
// stable product fact over team names, slab companies, or verbose legal text
// that vision can accidentally place in manufacturer/brand.
export function canonicalPublisherIdentity({
  manufacturer = null,
  brand = null,
  product = null,
  gradeCompany = null
} = {}) {
  const safeManufacturer = sameGraderIdentity(manufacturer, gradeCompany)
    ? null
    : cleanText(manufacturer) || null;
  const safeBrand = sameGraderIdentity(brand, gradeCompany)
    ? null
    : cleanText(brand) || null;
  const fromProduct = publisherFromProduct(product);
  if (fromProduct) {
    // Product identity can sanitize a present publisher field, but must not
    // manufacture a new field that the evidence/resolution layer intentionally
    // left absent or conflicting.
    if (!safeManufacturer && !safeBrand) {
      return { manufacturer: null, brand: null };
    }
    return {
      manufacturer: publisherCompatibleWithProduct(safeManufacturer, product) || fromProduct.manufacturer,
      brand: publisherCompatibleWithProduct(safeBrand, product) || fromProduct.brand
    };
  }

  return {
    manufacturer: safeManufacturer,
    brand: safeBrand || safeManufacturer
  };
}
