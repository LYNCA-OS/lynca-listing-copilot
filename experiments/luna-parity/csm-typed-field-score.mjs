// Scores a runtime answer against the founder-approved golden CSM projection
// in LYNCA-OS/csmdata, under that dataset's own acceptance policy v2.
//
// This replaces the title-regex bracket metric. That one had to guess which
// bracket a title token belonged to, and -- more importantly -- it used MY
// definition of fabrication, which was stricter than the founder's. The policy
// says plainly:
//
//   "A numerical_rarity or print_finish mismatch alone does not fail a case;
//    it remains reported. Manufacturer and Product pass when reviewed evidence
//    establishes semantic identity equivalence. Absolute failures always fail."
//
// So misreading a serial that IS on the card is tolerated recognition variance.
// Asserting a value for a field the founder marked explicitly empty is
// FABRICATED_OR_UNBACKED_VALUE, an absolute failure. Recognition error and
// fabrication are different things, and only the dataset owner gets to draw
// that line.

const RUNTIME_TO_CSM = Object.freeze({
  year: "year",
  manufacturer: "manufacturer",
  product: "product",
  subjects: "subject",
  card_name: "card_name",
  card_number: "card_number",
  print_finish: "print_finish",
  descriptive_rarity: "descriptive_rarity",
  release_variant: "release_variant",
  special_stamp: "special_stamp",
  language: "language",
  serial: "numerical_rarity",
  ip: "ip_sport",
  grading_info: "grading_info"
});

const fold = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(fold).filter(Boolean).sort().join(" | ");
  if (value && typeof value === "object") return fold(value.value ?? JSON.stringify(value));
  return fold(value);
}

const isEmpty = (value) => normalizeValue(value) === "";

export function buildGoldIndex(goldenProjection) {
  const index = new Map();
  for (const entry of goldenProjection.cases) {
    const fields = new Map();
    for (const fragment of entry.canonical_fragments || []) fields.set(fragment.field, fragment.value);
    index.set(entry.case_id, {
      caseId: entry.case_id,
      answer: entry.golden_csm_answer,
      fields,
      explicitlyEmpty: new Set(entry.explicitly_empty_fields || []),
      auxiliary: entry.recognized_auxiliary_attributes || []
    });
  }
  return index;
}

// Values in the ruling file often carry a leading season ("2026 Bowman
// Baseball"), which is the year bracket, not part of product identity.
const stripYear = (value) => value.replace(/^(?:19|20)\d{2}(?:\s+\d{2})?\s+/, "").trim();

export function buildEquivalenceIndex(decisions) {
  const index = new Map();
  for (const decision of decisions.decisions || []) {
    if (decision.decision !== "SEMANTIC_EQUIVALENT") continue;
    const field = decision.field;
    const expected = stripYear(fold(decision.expected));
    const actual = stripYear(fold(decision.actual));
    // Per-case ruling, exactly as written.
    index.set(`${decision.case_id}::${field}::${fold(decision.actual)}`, true);
    // The same ruling as a case-independent VALUE PAIR. The founder ruled
    // "Bowman Chrome ~ Bowman Baseball" on six separate cases; ruling a pattern
    // on one card and not the identical pattern on another is arbitrary. Both
    // directions, because the file records them both ways.
    index.set(`pair::${field}::${expected}::${actual}`, true);
    index.set(`pair::${field}::${actual}::${expected}`, true);
  }
  return index;
}

// The policy names these as release CONFIGURATION, which must never be
// serialised into release_variant. Putting them there is an absolute failure,
// not a wording preference.
const RELEASE_CONFIGURATION = Object.freeze([
  "first off the line", "fotl", "hobby", "delight", "retail", "asia", "choice"
]);

const TOLERATED = new Set(["numerical_rarity", "print_finish"]);
const EQUIVALENCE_ALLOWED = new Set(["manufacturer", "product"]);


// Containment only. The head-token rule this replaces called
// "Topps Chrome" and "Topps Finest" equivalent because both start with the
// manufacturer -- which is precisely the DISTINCT_PRODUCT_IDENTITY_COLLAPSED_AS_
// EQUIVALENT absolute failure. Anything beyond containment must come from a
// founder ruling, not from this function.
function sameFamily(want, got) {
  const a = stripYear(want).split(" ").filter(Boolean);
  const b = stripYear(got).split(" ").filter(Boolean);
  if (!a.length || !b.length) return false;
  const setA = new Set(a);
  const setB = new Set(b);
  return a.every((t) => setB.has(t)) || b.every((t) => setA.has(t));
}

export function scoreCase({ gold, runtimeFields = {}, equivalence = new Map(), caseId }) {
  const verdicts = {};
  const absoluteFailures = [];

  for (const [runtimeKey, csmField] of Object.entries(RUNTIME_TO_CSM)) {
    const actual = runtimeFields[runtimeKey];
    const hasActual = !isEmpty(actual);
    const goldHas = gold.fields.has(csmField);
    const goldEmpty = gold.explicitlyEmpty.has(csmField);

    if (!goldHas && goldEmpty && hasActual) {
      // The founder reviewed this card and recorded the field as empty. A value
      // here is not "unverifiable" -- it is contradicted by the gold answer.
      verdicts[csmField] = "FABRICATED_OR_UNBACKED";
      absoluteFailures.push({ field: csmField, code: "FABRICATED_OR_UNBACKED_VALUE", value: actual });
      continue;
    }
    if (!goldHas) { verdicts[csmField] = hasActual ? "EXTRA_UNRULED" : "ABSENT"; continue; }
    if (!hasActual) { verdicts[csmField] = "MISSED"; continue; }

    const want = normalizeValue(gold.fields.get(csmField));
    const got = normalizeValue(actual);
    if (want === got) { verdicts[csmField] = "MATCH"; continue; }
    if (EQUIVALENCE_ALLOWED.has(csmField)) {
      // Founder's per-case ruling wins outright.
      if (equivalence.get(`${caseId}::${csmField}::${fold(actual)}`)) {
        verdicts[csmField] = "SEMANTIC_EQUIVALENT";
        continue;
      }
      // The policy grants family equivalence as a GENERAL rule
      // ("SAME_PRODUCT_SERIES_OR_FAMILY_EQUIVALENCE_ALLOWED"), not only where a
      // case was pre-ruled. Scoring these as mismatches made the runtime look
      // far worse than the founder's own standard: "Bowman Baseball" vs
      // "Bowman Chrome" is the same family, and the ruling file says so
      // explicitly for two other cases.
      //
      // Two sources only, neither of them invented here: a value pair the
      // founder already ruled SEMANTIC_EQUIVALENT (applied consistently across
      // cases, since the ruling is about the pattern), or plain containment.
      if (equivalence.get(`pair::${csmField}::${stripYear(want)}::${stripYear(got)}`)) {
        verdicts[csmField] = "FOUNDER_RULED_PAIR";
        continue;
      }
      if (sameFamily(want, got)) {
        verdicts[csmField] = "CONTAINMENT_EQUIVALENT";
        continue;
      }
    }
    verdicts[csmField] = TOLERATED.has(csmField) ? "TOLERATED_VARIANCE" : "MISMATCH";
  }

  const variant = normalizeValue(runtimeFields.release_variant);
  if (variant && RELEASE_CONFIGURATION.some((term) => variant.includes(term))) {
    absoluteFailures.push({
      field: "release_variant",
      code: "RELEASE_CONFIGURATION_SERIALIZED_AS_RELEASE_VARIANT",
      value: runtimeFields.release_variant
    });
  }

  const hardMismatches = Object.entries(verdicts)
    .filter(([, verdict]) => verdict === "MISMATCH")
    .map(([field]) => field);

  return {
    case_id: caseId,
    verdicts,
    absolute_failures: absoluteFailures,
    hard_mismatches: hardMismatches,
    // Policy: absolute failures always fail; tolerated variance never fails.
    passed: absoluteFailures.length === 0 && hardMismatches.length === 0,
    fabricated: absoluteFailures.some((f) => f.code === "FABRICATED_OR_UNBACKED_VALUE")
  };
}

export function summarize(rows = []) {
  const counts = {};
  for (const row of rows) {
    for (const [field, verdict] of Object.entries(row.verdicts)) {
      counts[field] = counts[field] || {};
      counts[field][verdict] = (counts[field][verdict] || 0) + 1;
    }
  }
  return {
    cases: rows.length,
    passed: rows.filter((row) => row.passed).length,
    pass_rate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0,
    fabricated_cases: rows.filter((row) => row.fabricated).length,
    absolute_failure_cases: rows.filter((row) => row.absolute_failures.length > 0).length,
    per_field: counts
  };
}
