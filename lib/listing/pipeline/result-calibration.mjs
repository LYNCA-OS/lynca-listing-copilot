// Result confidence and parallel-risk calibration — extracted from the v2 monolith (R1).
// It is provider-neutral and contains no network or persistence side effects.
import {
  hasComplexVisualParallelRisk,
  resolveKnowledgeEntry
} from "../../listing-knowledge-registry.mjs";
import { safeSurfaceColor } from "../parallel-policy.mjs";
import {
  auditParallelText,
  commerciallyRequiresCardNumber,
  gradeIncluded,
  hasStrongEvidence,
  searchable,
  subjectIncluded,
  textMentionsAny,
  titleIncludes,
  titleIncludesAny,
  titleIncludesSerial,
  yearConflict
} from "./text-match.mjs";

export function normalizeUnresolved(unresolved, fields = {}) {
  const candidates = Array.isArray(unresolved)
    ? unresolved
    : Array.isArray(fields.unresolvedFields)
      ? fields.unresolvedFields
      : [];

  return candidates
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function hasVisuallyGuessedParallel(fields, reasonText, unresolved) {
  const parallelText = auditParallelText(fields);
  if (!parallelText) return false;

  const combined = `${parallelText} ${reasonText} ${searchable(unresolved.join(" "))}`;
  return textMentionsAny(combined, [
    "visual",
    "looks",
    "appears",
    "inferred",
    "likely",
    "guess",
    "guessed",
    "uncertain",
    "not text supported",
    "not text-supported",
    "foil alone"
  ]) && !hasStrongEvidence(reasonText);
}

export function hasUncertainty(reasonText, unresolved) {
  const unresolvedText = searchable(unresolved.join(" "));
  const combined = `${reasonText} ${unresolvedText}`;
  return textMentionsAny(combined, [
    "uncertain",
    "unsure",
    "likely",
    "inferred",
    "visual-only",
    "visual only",
    "appears",
    "seems",
    "possible",
    "may be",
    "review",
    "unclear",
    "ambiguous",
    "partial",
    "partially",
    "incomplete",
    "guess",
    "guessed",
    "not confirmed",
    "unresolved"
  ]);
}

export function hasVisualOnlyParallelRisk(fields, reasonText, unresolved) {
  const parallelText = auditParallelText(fields);
  const combined = `${parallelText} ${reasonText} ${searchable(unresolved.join(" "))}`;
  const patternTerms = [
    "wave",
    "shimmer",
    "pattern",
    "foil",
    "refractor",
    "disco",
    "pulsar",
    "prizm",
    "parallel"
  ];

  if (!textMentionsAny(combined, patternTerms)) return false;
  if (!textMentionsAny(combined, ["visual", "looks", "appears", "inferred", "likely", "guess"]) && hasComplexVisualParallelRisk(fields.parallel)) {
    return !hasStrongEvidence(reasonText);
  }
  return textMentionsAny(combined, ["visual", "looks", "appears", "inferred", "likely", "guess"])
    && !hasStrongEvidence(reasonText);
}

export function hasParallelReviewRequest(fields, reasonText, unresolved) {
  const parallelText = auditParallelText(fields);
  if (!parallelText) return false;

  const reviewText = searchable(unresolved.join(" "));
  const combined = `${parallelText} ${reasonText} ${reviewText}`;
  if (textMentionsAny(combined, [
    "exact parallel requires operator review",
    "exact parallel requires review",
    "visual-only parallel requires operator review",
    "visual only parallel requires operator review",
    "parallel requires operator review",
    "parallel requires review",
    "parallel require review",
    "parallel uncertain",
    "uncertain parallel",
    "exact geometric parallel requires review"
  ])) {
    return true;
  }

  const isParallelLike = textMentionsAny(combined, [
    "parallel",
    "variation",
    "color",
    "foil",
    "pattern",
    "geometric",
    "wave",
    "shimmer",
    "refractor",
    "prizm"
  ]);
  const asksReview = textMentionsAny(combined, [
    "operator review",
    "requires review",
    "manual review",
    "needs review",
    "unconfirmed",
    "not confirmed",
    "uncertain"
  ]);

  return isParallelLike && asksReview;
}

export function suppressReviewOnlyParallelFields(fields, reason, unresolved = []) {
  const reasonText = searchable(reason);
  if (!hasParallelReviewRequest(fields, reasonText, unresolved)
    && !hasVisualOnlyParallelRisk(fields, reasonText, unresolved)
    && !hasVisuallyGuessedParallel(fields, reasonText, unresolved)) {
    return fields;
  }

  const suppressed = { ...fields };
  [
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "parallel",
    "variation"
  ].forEach((field) => {
    if (suppressed[field] !== undefined) suppressed[field] = null;
  });
  return suppressed;
}

export function narrowSurfaceColorFromOpenSetParallel(fields = {}) {
  const explicitColor = safeSurfaceColor(fields.surface_color);
  if (explicitColor && !openSetSurfaceColorPatternContaminated(fields)) return explicitColor;

  for (const value of [
    fields.parallel_exact,
    fields.parallel,
    fields.variation,
    fields.parallel_family
  ]) {
    const text = String(value || "");
    if (!text) continue;
    if (/\btiger\s+stripe\b/i.test(text)) continue;
    const color = safeSurfaceColor(text);
    if (color) return color;
  }
  return "";
}

const directParallelEvidenceSources = new Set([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "CARD_BACK",
  "CARD_FRONT",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_REGISTRY",
  "STRUCTURED_DATABASE",
  "INTERNAL_APPROVED_HISTORY"
]);

export function sourceName(value = {}) {
  return String(value.source || value.source_type || value.original_source || "").toUpperCase();
}

export function sourceHasExplicitDirectEvidence(value = {}) {
  const metadata = value.metadata || {};
  return value.direct_observation === true
    || value.directly_observed === true
    || value.text_visible === true
    || value.visible_marker === true
    || metadata.direct_observation === true
    || metadata.directly_observed === true
    || metadata.text_visible === true
    || metadata.visible_marker === true;
}

export function evidenceNodeHasDirectParallelSupport(node = {}) {
  const sources = [
    ...(Array.isArray(node.sources) ? node.sources : []),
    ...(Array.isArray(node.supporting_sources) ? node.supporting_sources : [])
  ];
  if (sources.some((source) => directParallelEvidenceSources.has(sourceName(source)) && sourceHasExplicitDirectEvidence(source))) return true;

  const candidates = Array.isArray(node.candidates) ? node.candidates : [];
  return candidates.some((candidate) => {
    return [
      ...(Array.isArray(candidate.sources) ? candidate.sources : []),
      ...(Array.isArray(candidate.supporting_sources) ? candidate.supporting_sources : [])
    ].some((source) => directParallelEvidenceSources.has(sourceName(source)) && sourceHasExplicitDirectEvidence(source));
  });
}

export function resultHasDirectParallelSupport(result = {}) {
  const parallelFields = ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"];
  const evidence = result.evidence || result.normalized_evidence || {};
  if (parallelFields.some((field) => evidenceNodeHasDirectParallelSupport(evidence[field]))) return true;

  const fieldStates = Array.isArray(result.field_states) ? result.field_states : [];
  return fieldStates.some((fieldState) => {
    return parallelFields.includes(fieldState.field) && evidenceNodeHasDirectParallelSupport(fieldState);
  });
}

export function openSetSurfaceColorPatternContaminated(fields = {}) {
  const combined = searchable([
    fields.insert,
    fields.card_type,
    fields.official_card_type,
    fields.subset,
    fields.parallel_exact,
    fields.parallel,
    fields.variation
  ].filter(Boolean).join(" "));
  return textMentionsAny(combined, [
    "tiger",
    "zebra",
    "snakeskin",
    "snake skin",
    "elephant",
    "leopard",
    "animal print"
  ]);
}

export function auditMissingHighValueFields(title, fields) {
  const titleText = searchable(title);
  const missing = [];

  if (fields.player && !subjectIncluded(titleText, fields.player)) {
    missing.push("player");
  }

  if (fields.character && !subjectIncluded(titleText, fields.character)) {
    missing.push("character");
  }

  if (fields.year && (!titleText.includes(fields.year) || yearConflict(titleText, fields.year))) {
    missing.push("year");
  }

  if (fields.numerical_rarity && !titleIncludesSerial(title, fields)) {
    missing.push("numerical rarity");
  }

  const cardNumberRegistryEntry = resolveKnowledgeEntry(fields.card_number);
  if (
    commerciallyRequiresCardNumber(fields)
    && !titleIncludes(titleText, fields.card_number)
    && !(cardNumberRegistryEntry && titleIncludes(titleText, cardNumberRegistryEntry.label))
  ) {
    missing.push("card number");
  }

  if (fields.auto && !titleIncludesAny(titleText, ["auto", "autograph", "signed"])) {
    missing.push("auto");
  }

  if (fields.relic && !titleIncludesAny(titleText, ["relic", "memorabilia"])) {
    missing.push("relic");
  }

  if (fields.patch && !titleText.includes("patch")) {
    missing.push("patch");
  }

  if (fields.sketch && !titleText.includes("sketch")) {
    missing.push("sketch");
  }

  if (fields.redemption && !titleText.includes("redemption")) {
    missing.push("redemption");
  }

  if (fields.one_of_one && !titleIncludesAny(titleText, ["1/1", "01/01", "001/001", "one of one"])) {
    missing.push("1/1");
  }

  if (fields.grade_company && !titleIncludes(titleText, fields.grade_company)) {
    missing.push("grade company");
  }

  if (fields.grade && !gradeIncluded(titleText, fields.grade)) {
    missing.push("grade");
  }

  if (fields.subset && /\b(rookie|rc|1st bowman|1st)\b/i.test(fields.subset) && !titleIncludes(titleText, fields.subset)) {
    missing.push("rookie/1st");
  }

  return missing;
}

export function parallelRequiresTitlePresence(fields = {}, reasonText = "", unresolved = []) {
  const parallelText = auditParallelText(fields);
  if (!parallelText) return false;
  if (hasParallelReviewRequest(fields, reasonText, unresolved)
    || hasVisualOnlyParallelRisk(fields, reasonText, unresolved)
    || hasVisuallyGuessedParallel(fields, reasonText, unresolved)) {
    return false;
  }
  if (fields.parallel_exact || fields.parallel_family) return true;
  return textMentionsAny(reasonText, [
    "printed parallel",
    "parallel printed",
    "card text supports parallel",
    "front card text supports parallel",
    "back text supports parallel",
    "slab label supports parallel",
    "label supports parallel",
    "registry supports parallel",
    "checklist supports parallel",
    "official checklist supports parallel"
  ]);
}

export function auditMissingReviewFields(title, fields, reasonText = "", unresolved = []) {
  const titleText = searchable(title);
  const missing = [];

  if (parallelRequiresTitlePresence(fields, reasonText, unresolved)
    && ![fields.parallel_exact, fields.parallel_family, fields.parallel, fields.variation, fields.surface_color]
      .filter(Boolean)
      .some((value) => titleIncludes(titleText, value))) {
    missing.push("parallel");
  }

  if (fields.insert && !titleIncludes(titleText, fields.insert)) {
    missing.push("insert");
  }

  return missing;
}

export function calibrateConfidence({ title, confidence, reason, fields, unresolved }) {
  if (confidence === "FAILED") return { confidence, reason, unresolved };

  const reasonText = searchable(reason);
  const missingHighValueFields = auditMissingHighValueFields(title, fields);
  const calibratedUnresolved = [...unresolved];
  missingHighValueFields.forEach((field) => {
    const label = `title missing ${field}`;
    if (!calibratedUnresolved.includes(label)) calibratedUnresolved.push(label);
  });

  const lowTriggers = missingHighValueFields.length > 0
    || yearConflict(searchable(title), fields.year)
    || textMentionsAny(`${reasonText} ${searchable(unresolved.join(" "))}`, [
      "wrong year",
      "year mismatch",
      "wrong serial",
      "serial mismatch",
      "missing auto",
      "missing serial",
      "missing grade",
      "missing player",
      "missing character",
      "missing card number",
      "missing 1/1",
      "missing rookie",
      "missing 1st bowman",
      "contradicts title"
    ]);

  if (lowTriggers) {
    return {
      confidence: "LOW",
      reason: appendCalibrationReason(reason, "Confidence downgraded: high-value fields require manual correction."),
      unresolved: calibratedUnresolved.slice(0, 12)
    };
  }

  if (confidence !== "HIGH") {
    return { confidence, reason, unresolved: calibratedUnresolved };
  }

  const missingReviewFields = auditMissingReviewFields(title, fields, reasonText, calibratedUnresolved);
  missingReviewFields.forEach((field) => {
    const label = `title missing ${field}`;
    if (!calibratedUnresolved.includes(label)) calibratedUnresolved.push(label);
  });

  const highAllowed = hasStrongEvidence(reasonText)
    && calibratedUnresolved.length === 0
    && !hasUncertainty(reasonText, calibratedUnresolved)
    && !hasVisualOnlyParallelRisk(fields, reasonText, calibratedUnresolved)
    && !hasVisuallyGuessedParallel(fields, reasonText, calibratedUnresolved);

  if (highAllowed) {
    return { confidence, reason, unresolved: calibratedUnresolved };
  }

  const reviewLabel = "operator review required";
  if (!calibratedUnresolved.includes(reviewLabel)) calibratedUnresolved.push(reviewLabel);

  return {
    confidence: "MEDIUM",
    reason: appendCalibrationReason(reason, "Confidence downgraded: core identity fields may be usable, but listing readiness requires operator review."),
    unresolved: calibratedUnresolved.slice(0, 12)
  };
}

export function appendCalibrationReason(reason, calibrationReason) {
  const base = String(reason || "").trim();
  const combined = base ? `${base} ${calibrationReason}` : calibrationReason;
  return combined.slice(0, 520);
}

