// Durable, Composer-owned attribution for canonical atoms projected into a
// marketplace title. Readers consume this receipt; they never guess coverage
// by searching strings in the rendered title.

export const PUBLICATION_COVERAGE_VERSION = "csm-publication-coverage-v1";

export const PUBLICATION_DISPOSITION = Object.freeze({
  PUBLISHED: "PUBLISHED",
  SUPPRESSED_BY_PROFILE: "SUPPRESSED_BY_PROFILE",
  DROPPED_FOR_BUDGET: "DROPPED_FOR_BUDGET",
  DEDUPED_COVERED: "DEDUPED_COVERED",
  TRUNCATED_LOSS: "TRUNCATED_LOSS",
  WITHHELD_BY_CONTRACT: "WITHHELD_BY_CONTRACT"
});

export const PUBLICATION_BRACKET_SOURCE_FIELDS = Object.freeze({
  lot: Object.freeze(["lot_count"]),
  ip: Object.freeze(["ip"]),
  language: Object.freeze(["language"]),
  year: Object.freeze(["year"]),
  manufacturer: Object.freeze(["manufacturer"]),
  manufacturer_product_set: Object.freeze(["manufacturer", "product", "set"]),
  product: Object.freeze(["product"]),
  set: Object.freeze(["set"]),
  subject: Object.freeze(["subjects"]),
  card_name: Object.freeze(["card_name"]),
  release_variant: Object.freeze(["release_variant"]),
  print_finish: Object.freeze(["print_finish"]),
  numerical_rarity: Object.freeze(["serial"]),
  descriptive_rarity: Object.freeze(["descriptive_rarity"]),
  card_number: Object.freeze(["card_number"]),
  search_optimization: Object.freeze(["components", "search_optimization", "team"]),
  grading_info: Object.freeze(["grading_info", "grade"]),
  special_stamp: Object.freeze(["special_stamp"]),
  description: Object.freeze(["description"])
});

const ROOT_KEYS = Object.freeze(["atoms", "schema_version"]);
const ATOM_KEYS = Object.freeze([
  "bracket", "canonical_value", "disposition", "source_field", "source_index"
]);
const dispositions = new Set(Object.values(PUBLICATION_DISPOSITION));

const exactKeys = (value, keys) => JSON.stringify(Object.keys(value).sort())
  === JSON.stringify(keys);

function canonicalAtomValue(sourceField, value) {
  if (sourceField === "grading_info" && value && typeof value === "object"
      && !Array.isArray(value)) {
    const company = String(value.company || "").trim();
    const card = String(value.card_grade || "").trim();
    const auto = String(value.auto_grade || "").trim();
    if (value.grade_type === "AUTO_ONLY") {
      return [company, "Auto", auto || card].filter(Boolean).join(" ");
    }
    if (value.grade_type === "AUTHENTIC_WITH_AUTO") {
      return `${[company, "Authentic"].filter(Boolean).join(" ")}${auto ? `/${auto}` : ""}`;
    }
    if (card && auto) return `${[company, card].filter(Boolean).join(" ")}/${auto}`;
    return [company, card || auto].filter(Boolean).join(" ");
  }
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function validatePublicationCoverage(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || !exactKeys(receipt, ROOT_KEYS)
      || receipt.schema_version !== PUBLICATION_COVERAGE_VERSION
      || !Array.isArray(receipt.atoms)) {
    throw new TypeError("publication_coverage_shape_invalid");
  }
  const seen = new Set();
  for (const atom of receipt.atoms) {
    if (!atom || typeof atom !== "object" || Array.isArray(atom)
        || !exactKeys(atom, ATOM_KEYS)
        || typeof atom.bracket !== "string" || !atom.bracket
        || typeof atom.source_field !== "string" || !atom.source_field
        || !Number.isInteger(atom.source_index) || atom.source_index < 0
        || typeof atom.canonical_value !== "string" || !atom.canonical_value.trim()
        || !dispositions.has(atom.disposition)
        || !PUBLICATION_BRACKET_SOURCE_FIELDS[atom.bracket]?.includes(atom.source_field)) {
      throw new TypeError("publication_coverage_atom_invalid");
    }
    const identity = `${atom.bracket}\u0000${atom.source_field}\u0000${atom.source_index}`;
    if (seen.has(identity)) throw new TypeError("publication_coverage_atom_duplicate");
    seen.add(identity);
  }
  return receipt;
}

export function createPublicationCoverage(atoms = []) {
  const receipt = {
    schema_version: PUBLICATION_COVERAGE_VERSION,
    atoms: atoms.map((atom) => ({
      bracket: atom.bracket,
      source_field: atom.source_field,
      source_index: atom.source_index,
      canonical_value: String(atom.canonical_value).replace(/\s+/g, " ").trim(),
      disposition: atom.disposition
    }))
  };
  validatePublicationCoverage(receipt);
  return Object.freeze({
    ...receipt,
    atoms: Object.freeze(receipt.atoms.map(Object.freeze))
  });
}

export function publicationCoverageAtomsForFields(fields = {}, brackets = []) {
  const atoms = [];
  for (const bracket of brackets) {
    const sourceFields = bracket === "grading_info"
      ? [fields.grading_info ? "grading_info" : "grade"]
      : (PUBLICATION_BRACKET_SOURCE_FIELDS[bracket] || []);
    for (const sourceField of sourceFields) {
      const raw = fields[sourceField];
      const values = (Array.isArray(raw) ? raw : [raw])
        .map((value) => canonicalAtomValue(sourceField, value)).filter(Boolean);
      values.forEach((canonicalValue, sourceIndex) => atoms.push({
        bracket, source_field: sourceField, source_index: sourceIndex, canonical_value: canonicalValue
      }));
    }
  }
  return atoms;
}

export function rebasePublicationCoverage(receipt, fields, brackets) {
  validatePublicationCoverage(receipt);
  const dispositionByIdentity = new Map(receipt.atoms.map((atom) => [
    `${atom.bracket}\u0000${atom.source_field}\u0000${atom.source_index}`,
    atom.disposition
  ]));
  const dispositionByBracket = new Map(receipt.atoms.map((atom) => [
    atom.bracket, atom.disposition
  ]));
  return createPublicationCoverage(publicationCoverageAtomsForFields(fields, brackets)
    .map((atom) => ({
      ...atom,
      disposition: dispositionByIdentity.get(
        `${atom.bracket}\u0000${atom.source_field}\u0000${atom.source_index}`
      ) || dispositionByBracket.get(atom.bracket)
        || PUBLICATION_DISPOSITION.WITHHELD_BY_CONTRACT
    })));
}

export function validatePublicationCoverageAgainstFields(receipt, fields, brackets) {
  validatePublicationCoverage(receipt);
  const expected = publicationCoverageAtomsForFields(fields, brackets);
  const actual = receipt.atoms.map((atom) => ({
    bracket: atom.bracket,
    source_field: atom.source_field,
    source_index: atom.source_index,
    canonical_value: atom.canonical_value
  }));
  const sortAtoms = (atoms) => [...atoms].sort((left, right) => (
    left.bracket.localeCompare(right.bracket)
      || left.source_field.localeCompare(right.source_field)
      || left.source_index - right.source_index
  ));
  const normalizeGradingSource = (atom) => atom.bracket === "grading_info"
    ? { ...atom, source_field: "grading_info" } : atom;
  const normalizedActual = actual.map(normalizeGradingSource);
  const normalizedExpected = expected.map(normalizeGradingSource);
  const actualByIdentity = new Map(normalizedActual.map((atom) => [
    `${atom.bracket}\u0000${atom.source_field}\u0000${atom.source_index}`, atom
  ]));
  const expectedAgainstReceipt = normalizedExpected.map((atom) => {
    const exact = actualByIdentity.get(
      `${atom.bracket}\u0000${atom.source_field}\u0000${atom.source_index}`
    );
    // The exact-parallel compaction is an explicitly traced display-only
    // projection: canonical print_finish stays full while coverage owns the
    // compact emitted atom. Keep that one sanctioned mismatch narrow.
    if (atom.bracket === "print_finish" && exact
        && String(fields.parallel_exact || "").includes(exact.canonical_value)) {
      return { ...atom, canonical_value: exact.canonical_value };
    }
    return atom;
  });
  if (JSON.stringify(sortAtoms(normalizedActual)) !== JSON.stringify(sortAtoms(expectedAgainstReceipt))) {
    throw new TypeError("publication_coverage_canonical_atoms_mismatch");
  }
  return receipt;
}

const CNL_FIELD_TO_BRACKET = Object.freeze({
  subjects: "subject",
  components: "search_optimization",
  search_optimization: "search_optimization",
  team: "search_optimization",
  serial: "numerical_rarity",
  grade: "grading_info",
  grading_info: "grading_info"
});

export function publicationCoverageFromCanonicalNamingTrace(trace = {}) {
  const selected = new Map((trace.selected || []).map((token) => [token.key, token]));
  const omitted = new Map((trace.omitted || []).map((token) => [token.key, token]));
  const tokens = [...selected.values(), ...omitted.values()];
  return createPublicationCoverage(tokens.map((token) => {
    const reason = token.reason;
    let disposition = PUBLICATION_DISPOSITION.PUBLISHED;
    if (!selected.has(token.key)) {
      if (["source_derived_redundancy", "profile_display_ownership"].includes(reason)) {
        disposition = PUBLICATION_DISPOSITION.DEDUPED_COVERED;
      } else if (reason === "profile_distribution_configuration_omitted") {
        disposition = PUBLICATION_DISPOSITION.SUPPRESSED_BY_PROFILE;
      } else if (["budget_lexicographic_selection", "p0_budget_infeasible"].includes(reason)) {
        disposition = PUBLICATION_DISPOSITION.DROPPED_FOR_BUDGET;
      } else {
        disposition = PUBLICATION_DISPOSITION.WITHHELD_BY_CONTRACT;
      }
    }
    const sourceField = String(token.source_field || token.field || "");
    return {
      bracket: CNL_FIELD_TO_BRACKET[token.field] || token.field,
      source_field: sourceField,
      source_index: Number(token.source_index || 0),
      canonical_value: token.canonical_value,
      disposition
    };
  }));
}
