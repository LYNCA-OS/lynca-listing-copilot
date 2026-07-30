import { readFile } from "node:fs/promises";

export const coverageDisposition = Object.freeze({
  NO_BACKFILL_PRODUCT_YEAR_PRESENT: "NO_BACKFILL_PRODUCT_YEAR_PRESENT",
  SET_AS_PRODUCT_CANDIDATE: "SET_AS_PRODUCT_CANDIDATE",
  PRODUCT_NAME_ABSENT_FROM_CATALOG: "PRODUCT_NAME_ABSENT_FROM_CATALOG",
  UNCLASSIFIED: "UNCLASSIFIED"
});

function booleanValue(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function hasOwn(row, key) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

export function classifyCoveragePredicates(row = {}) {
  const productYearPresent = booleanValue(row.product_year_present);
  const setMatchesCatalogProduct = booleanValue(row.set_matches_catalog_product);
  const productSeenAnyYear = hasOwn(row, "product_seen_any_year")
    ? booleanValue(row.product_seen_any_year)
    : !(booleanValue(row.product_absent) || booleanValue(row.product_name_absent_from_catalog));

  let disposition = coverageDisposition.UNCLASSIFIED;
  if (productYearPresent) disposition = coverageDisposition.NO_BACKFILL_PRODUCT_YEAR_PRESENT;
  else if (setMatchesCatalogProduct) disposition = coverageDisposition.SET_AS_PRODUCT_CANDIDATE;
  else if (!productSeenAnyYear) disposition = coverageDisposition.PRODUCT_NAME_ABSENT_FROM_CATALOG;

  return {
    disposition,
    product_year_present: productYearPresent,
    set_matches_catalog_product: setMatchesCatalogProduct,
    product_name_absent_from_catalog: !productSeenAnyYear,
    catalog_write_allowed: false,
    required_next_action: disposition === coverageDisposition.PRODUCT_NAME_ABSENT_FROM_CATALOG
      ? "REVIEWED_INTERNAL_CONFIRMATION"
      : disposition === coverageDisposition.SET_AS_PRODUCT_CANDIDATE
        ? "VALIDATE_SET_AS_PRODUCT_WITH_YEAR_AND_MANUFACTURER"
        : disposition === coverageDisposition.NO_BACKFILL_PRODUCT_YEAR_PRESENT
          ? "RETRIEVAL_DIAGNOSTIC"
          : "MANUAL_TAXONOMY_REVIEW"
  };
}

export function summarizeCoveragePredicates(rows, { expectedTotal = null } = {}) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const summary = {
    total: rows.length,
    overlapping_predicates: {
      product_year_present: 0,
      set_matches_catalog_product: 0,
      product_name_absent_from_catalog: 0
    },
    mutually_exclusive: Object.fromEntries(Object.values(coverageDisposition).map((key) => [key, 0])),
    overlap_cells: {
      product_year_only: 0,
      product_year_and_set: 0,
      set_only: 0,
      set_and_product_absent: 0,
      product_absent_only: 0,
      none: 0
    },
    catalog_write_allowed: false
  };

  for (const row of rows) {
    const result = classifyCoveragePredicates(row);
    const a = result.product_year_present;
    const b = result.set_matches_catalog_product;
    const c = result.product_name_absent_from_catalog;
    if (a && c) throw new Error("invalid predicates: product-year present and product absent cannot both be true");

    summary.overlapping_predicates.product_year_present += Number(a);
    summary.overlapping_predicates.set_matches_catalog_product += Number(b);
    summary.overlapping_predicates.product_name_absent_from_catalog += Number(c);
    summary.mutually_exclusive[result.disposition] += 1;

    if (a && b) summary.overlap_cells.product_year_and_set += 1;
    else if (a) summary.overlap_cells.product_year_only += 1;
    else if (b && c) summary.overlap_cells.set_and_product_absent += 1;
    else if (b) summary.overlap_cells.set_only += 1;
    else if (c) summary.overlap_cells.product_absent_only += 1;
    else summary.overlap_cells.none += 1;
  }

  const classifiedTotal = Object.values(summary.mutually_exclusive).reduce((sum, value) => sum + value, 0);
  const cellTotal = Object.values(summary.overlap_cells).reduce((sum, value) => sum + value, 0);
  if (classifiedTotal !== rows.length || cellTotal !== rows.length) {
    throw new Error(`classification invariant failed: rows=${rows.length} classified=${classifiedTotal} cells=${cellTotal}`);
  }
  if (expectedTotal !== null && rows.length !== Number(expectedTotal)) {
    throw new Error(`expected ${expectedTotal} rows, received ${rows.length}`);
  }
  return summary;
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function main(argv = process.argv) {
  const inputPath = argValue(argv, "--input");
  if (!inputPath) throw new Error("--input is required; pass the read-only SQL row export");
  const raw = await readFile(inputPath, "utf8");
  const parsed = raw.trim().startsWith("[") || raw.trim().startsWith("{") ? JSON.parse(raw) : null;
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.row_predicates)
      ? parsed.row_predicates
      : raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const expectedTotal = argValue(argv, "--expected-total", "") || null;
  process.stdout.write(`${JSON.stringify(summarizeCoveragePredicates(rows, { expectedTotal }), null, 2)}\n`);
}

if (process.argv[1]?.endsWith("audit-catalog-gap-coverage-classification.mjs")) {
  main().catch((error) => {
    console.error(`catalog gap coverage audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
