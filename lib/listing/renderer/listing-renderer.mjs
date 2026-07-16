import { normalizeResolvedFields, serialNumeratorDirectProvenance } from "../evidence/evidence-schema.mjs";
import { expandPrintRunFields, printRunTitleText } from "../print-run/print-run-fields.mjs";
import { renderGenericTitle } from "./generic-title-renderer.mjs";
import { moduleOrder, renderListingModules, rendererVersion } from "./module-renderer.mjs";
import { renderPokemonTitle } from "./pokemon-title-renderer.mjs";
import { renderSportsTitle } from "./sports-title-renderer.mjs";
import { fitTitleItems } from "./title-length-policy.mjs";
import { inferSemGrammar } from "../csm/sem-definition.mjs";
import {
  normalizeComparable,
  normalizeAutoGradeToken,
  normalizeText,
  productHierarchyText,
  renderGrade,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";

function hasPresentationValue(value) {
  return String(value ?? "").trim() !== "";
}

function immutablePresentationSnapshot(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(immutablePresentationSnapshot));
  }
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, immutablePresentationSnapshot(entry)])
  ));
}

const printRunDenominatorSourceTypes = Object.freeze(new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "SLAB_LABEL",
  "OCR",
  "OPERATOR",
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_REGISTRY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "STRUCTURED_DATABASE",
  "VECTOR_APPROVED_REFERENCE"
]));

const printRunAliasFieldNames = Object.freeze([
  "print_run_number",
  "numerical_rarity",
  "serial_number"
]);

const printRunAtomicDenominatorFieldNames = Object.freeze([
  "print_run_denominator",
  "serial_denominator",
  "expected_serial_denominator",
  "numbered_to"
]);

const printRunAtomicDenominatorFields = Object.freeze(new Set(printRunAtomicDenominatorFieldNames));

const printRunEvidenceFieldNames = Object.freeze([
  ...printRunAliasFieldNames,
  ...printRunAtomicDenominatorFieldNames
]);

const printRunReferenceSourceTypes = Object.freeze(new Set([
  "INTERNAL_REGISTRY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "STRUCTURED_DATABASE",
  "VECTOR_APPROVED_REFERENCE",
  "MARKETPLACE",
  "OPEN_WEB",
  "VISUAL_GUESS"
]));

function printRunDenominatorProvenance(field) {
  if (!field || typeof field !== "object") return false;
  const sources = Array.isArray(field.sources) ? field.sources : [];
  return sources.some((source) => printRunDenominatorSourceTypes.has(String(source?.source_type || "").toUpperCase()));
}

function confirmedPrintRunEvidence(field) {
  return ["CONFIRMED", "MANUAL_CONFIRMED"].includes(String(field?.status || "").toUpperCase());
}

function printRunSourceTypes(source = {}) {
  return [source.source_type, source.original_source_type]
    .map((value) => String(value || "").toUpperCase())
    .filter(Boolean);
}

function printRunSourceScopes(source = {}) {
  return [
    source.provenance_scope,
    source.provenanceScope,
    source.scope,
    source.source_scope,
    source.sourceScope
  ]
    .map((value) => String(value || "").toUpperCase())
    .filter(Boolean);
}

function referencePrintRunSource(source) {
  const sourceTypes = printRunSourceTypes(source);
  if (printRunSourceScopes(source).includes("REFERENCE")) return true;
  if (sourceTypes.includes("OFFICIAL_GRADING_DATA") && source.physical_instance_match !== true) return true;
  return sourceTypes.some((sourceType) => printRunReferenceSourceTypes.has(sourceType)
    || /(?:CATALOG|VECTOR|REFERENCE)/.test(sourceType));
}

function printRunEvidenceSources(field = {}) {
  const sources = Array.isArray(field.sources) ? field.sources : [];
  if (sources.length) {
    return sources.map((source) => ({
      provenance_scope: field.provenance_scope,
      scope: field.scope,
      physical_instance_match: field.physical_instance_match,
      ...source
    }));
  }
  if (!field.source_type) return sources;
  return [{
    source_type: field.source_type,
    original_source_type: field.original_source_type,
    provenance_scope: field.provenance_scope,
    scope: field.scope,
    physical_instance_match: field.physical_instance_match,
    observed_text: field.observed_text,
    raw_text: field.raw_text,
    value: field.value
  }];
}

function currentInstancePrintRunSource(source) {
  if (referencePrintRunSource(source)) return false;
  return serialNumeratorDirectProvenance({
    status: "CONFIRMED",
    sources: [source]
  });
}

function printRunFieldsFromValue(fieldName, value) {
  if (!printRunAtomicDenominatorFields.has(fieldName)) return expandPrintRunFields(value);
  const keyed = expandPrintRunFields({ [fieldName]: value });
  const denominator = keyed.print_run_denominator || expandPrintRunFields(value).print_run_denominator;
  return denominator ? expandPrintRunFields({ print_run_denominator: denominator }) : {};
}

function evidencePrintRunFields(fieldName, field = {}) {
  const canonicalValues = [field.normalized_value, field.value, field.observed_text];
  for (const value of canonicalValues) {
    const parsed = printRunFieldsFromValue(fieldName, value);
    if (parsed.print_run_number || parsed.print_run_denominator) return parsed;
  }

  const sources = printRunEvidenceSources(field);
  for (const source of sources) {
    for (const value of [source?.observed_text, source?.raw_text, source?.value]) {
      const parsed = printRunFieldsFromValue(fieldName, value);
      if (parsed.print_run_number || parsed.print_run_denominator) return parsed;
    }
  }
  return {};
}

function fullPrintRunKey(fields = {}) {
  if (fields.suspicious_print_run || !fields.print_run_numerator || !fields.print_run_denominator) return null;
  return `${Number(fields.print_run_numerator)}/${Number(fields.print_run_denominator)}`;
}

function printRunEvidenceStrength(left, right) {
  const leftManual = String(left.field.status || "").toUpperCase() === "MANUAL_CONFIRMED";
  const rightManual = String(right.field.status || "").toUpperCase() === "MANUAL_CONFIRMED";
  if (leftManual !== rightManual) return rightManual ? 1 : -1;

  const confidenceDifference = Number(right.field.confidence || 0) - Number(left.field.confidence || 0);
  if (confidenceDifference) return confidenceDifference;

  const bestTrustTier = (candidate) => Math.min(
    ...(Array.isArray(candidate.field.sources) ? candidate.field.sources : [])
      .map((source) => Number(source?.trust_tier))
      .filter(Number.isFinite),
    11
  );
  const trustDifference = bestTrustTier(left) - bestTrustTier(right);
  if (trustDifference) return trustDifference;

  const valueDifference = String(fullPrintRunKey(left.fields) || left.fields.print_run_number || "")
    .localeCompare(String(fullPrintRunKey(right.fields) || right.fields.print_run_number || ""));
  if (valueDifference) return valueDifference;
  return left.fieldName.localeCompare(right.fieldName);
}

function currentInstancePrintRunReading(fieldName, field, fallbackFields) {
  const sources = printRunEvidenceSources(field);
  const currentSources = sources.filter(currentInstancePrintRunSource);
  const implicitManualObservation = String(field?.status || "").toUpperCase() === "MANUAL_CONFIRMED"
    && sources.length === 0;
  if (!currentSources.length && !implicitManualObservation) {
    return { currentInstance: false, fields: fallbackFields, conflict: false };
  }
  if (printRunAtomicDenominatorFields.has(fieldName) || !currentSources.length) {
    return { currentInstance: true, fields: fallbackFields, conflict: false };
  }

  const sourceReadings = currentSources
    .map((source) => evidencePrintRunFields(fieldName, {
      normalized_value: source?.observed_text,
      value: source?.value,
      observed_text: source?.raw_text
    }))
    .filter((fields) => fields.print_run_number || fields.print_run_denominator);
  if (!sourceReadings.length) {
    return { currentInstance: true, fields: fallbackFields, conflict: false };
  }

  const fullKeys = new Set(sourceReadings.map(fullPrintRunKey).filter(Boolean));
  const denominatorKeys = new Set(sourceReadings.map((fields) => fields.print_run_denominator).filter(Boolean));
  return {
    currentInstance: true,
    fields: sourceReadings.find((fields) => fullPrintRunKey(fields)) || sourceReadings[0],
    conflict: fullKeys.size > 1 || denominatorKeys.size > 1
  };
}

function conflictPrintRunAlias(evidence = {}) {
  return printRunAliasFieldNames.some((fieldName) => {
    const field = evidence?.[fieldName];
    if (String(field?.status || "").toUpperCase() !== "CONFLICT"
      || !Array.isArray(field?.candidates)
      || field.candidates.length === 0) return false;
    const sources = [
      ...printRunEvidenceSources(field),
      ...field.candidates.flatMap((candidate) => Array.isArray(candidate?.sources) ? candidate.sources : [])
    ];
    return sources.length === 0 || !sources.every(referencePrintRunSource);
  });
}

function selectPrintRunEvidence(evidence = {}) {
  const candidates = printRunEvidenceFieldNames
    .map((fieldName) => ({
      fieldName,
      field: evidence?.[fieldName]
    }))
    .filter(({ field }) => confirmedPrintRunEvidence(field))
    .map((candidate) => {
      const atomicDenominator = printRunAtomicDenominatorFields.has(candidate.fieldName);
      const parsedFields = evidencePrintRunFields(candidate.fieldName, candidate.field);
      const currentReading = currentInstancePrintRunReading(candidate.fieldName, candidate.field, parsedFields);
      const fields = currentReading.currentInstance ? currentReading.fields : parsedFields;
      const directCurrentInstance = currentReading.currentInstance && !atomicDenominator;
      const referenceSources = printRunEvidenceSources(candidate.field).filter(referencePrintRunSource);
      const verificationBindingEligible = !atomicDenominator
        && Boolean(fullPrintRunKey(fields))
        && (currentReading.currentInstance || referenceSources.length === 0);
      return {
        ...candidate,
        fields,
        currentInstance: currentReading.currentInstance,
        currentReadingConflict: currentReading.conflict,
        directCurrentInstance,
        verificationBindingEligible,
        denominatorProvenance: atomicDenominator || currentReading.currentInstance || printRunDenominatorProvenance(candidate.field),
        fullKey: directCurrentInstance ? fullPrintRunKey(fields) : null
      };
    });
  const directFullCandidates = candidates
    .filter((candidate) => candidate.directCurrentInstance && candidate.fullKey)
    .sort(printRunEvidenceStrength);
  const verifiedFullCandidates = candidates
    .filter((candidate) => candidate.verificationBindingEligible)
    .sort(printRunEvidenceStrength);
  const denominatorCandidates = candidates
    .filter((candidate) => candidate.denominatorProvenance && candidate.fields.print_run_denominator)
    .sort(printRunEvidenceStrength);
  const fullKeys = new Set(directFullCandidates.map((candidate) => candidate.fullKey));
  const verifiedFullKeys = new Set(verifiedFullCandidates.map((candidate) => fullPrintRunKey(candidate.fields)));
  const denominatorKeys = new Set(denominatorCandidates.map((candidate) => candidate.fields.print_run_denominator));
  const currentDenominatorKeys = new Set(candidates
    .filter((candidate) => candidate.currentInstance && candidate.fields.print_run_denominator)
    .map((candidate) => candidate.fields.print_run_denominator));
  const verifiedDenominatorKeys = new Set(candidates
    .filter((candidate) => (candidate.currentInstance || candidate.verificationBindingEligible)
      && candidate.fields.print_run_denominator)
    .map((candidate) => candidate.fields.print_run_denominator));
  const currentReadingConflict = candidates.some((candidate) => candidate.currentReadingConflict);
  const aliasConflict = conflictPrintRunAlias(evidence);

  return {
    confirmed: candidates.length > 0,
    direct: directFullCandidates[0] || null,
    verified: verifiedFullCandidates[0] || null,
    denominator: denominatorCandidates[0] || null,
    fullConflict: fullKeys.size > 1,
    denominatorConflict: denominatorKeys.size > 1,
    numeratorConflict: aliasConflict
      || currentReadingConflict
      || fullKeys.size > 1
      || currentDenominatorKeys.size > 1,
    verifiedNumeratorConflict: aliasConflict
      || currentReadingConflict
      || verifiedFullKeys.size > 1
      || verifiedDenominatorKeys.size > 1
  };
}

function withPrintRunDisplay(resolved, fields, display, directCurrentInstance) {
  const denominator = fields.print_run_denominator || null;
  const numerator = directCurrentInstance ? fields.print_run_numerator || null : null;
  return {
    ...resolved,
    ...fields,
    print_run_number: display,
    print_run_numerator: numerator,
    print_run_denominator: denominator,
    numbered_to: denominator,
    serial_number: display,
    serial_denominator: denominator,
    expected_serial_denominator: denominator,
    numerical_rarity: display,
    one_of_one: directCurrentInstance && fields.one_of_one === true,
    suspicious_print_run: fields.suspicious_print_run === true,
    print_run_review_required: fields.print_run_review_required === true
  };
}

function evidenceObservedText(field = {}) {
  return [
    field.observed_text,
    field.value,
    ...(Array.isArray(field.sources) ? field.sources.map((source) => source?.observed_text || source?.value || "") : [])
  ].map(normalizeText).filter(Boolean).join(" ");
}

function firstBowmanEvidenceAdjustment(resolved = {}, evidence = {}) {
  const evidenceText = Object.values(evidence || {}).map(evidenceObservedText).join(" ");
  if (!/\b1st\s+Bowman\b/i.test(evidenceText)) return resolved;

  const rcEvidenceText = evidenceObservedText(evidence.rc);
  const rcLooksOnlyFirstBowman = /\b1st\s+Bowman\b/i.test(rcEvidenceText)
    && !/\b(?:RC|Rookie(?:\s+Card)?)\b/i.test(rcEvidenceText.replace(/\b1st\s+Bowman\b/gi, " "));

  return {
    ...resolved,
    first_bowman: true,
    rc: rcLooksOnlyFirstBowman ? false : resolved.rc
  };
}

function looksLikeTcg(resolved = {}) {
  return inferSemGrammar(resolved) === "TCG";
}

function looksLikeSports(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.team
  ].filter(Boolean).join(" "));
  if (looksLikeTcg(resolved)) return false;
  if (!text) return true;
  return /sports?|nba|nfl|mlb|nhl|wnba|ufc|topps|panini|upper deck|bowman|donruss|prizm|select|flawless|immaculate|chrome/.test(text);
}

export function selectTitleRenderer(resolved = {}) {
  if (looksLikeTcg(resolved)) return "pokemon";
  if (looksLikeSports(resolved)) return "sports";
  return "generic";
}

export function renderResolvedTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  if (isLotTitle(normalized)) return renderLotTitle(normalized, { maxLength });
  const renderer = selectTitleRenderer(normalized);
  const result = renderer === "pokemon"
    ? renderPokemonTitle(normalized, { maxLength })
    : renderer === "sports"
      ? renderSportsTitle(normalized, { maxLength })
      : renderGenericTitle(normalized, { maxLength });

  return {
    renderer,
    rendered_title: result.title,
    title_length_policy: result.policy
  };
}

function isLotTitle(resolved = {}) {
  return resolved.multi_card === true
    || Number(resolved.card_count || 0) > 1
    || /\blot\b|多张|套卡/i.test(String(resolved.lot_type || ""));
}

function lotQuantityText(resolved = {}) {
  const count = Number(resolved.card_count || 0);
  return count > 1 ? `Lot x${count}` : "Lot";
}

function lotSubjectText(resolved = {}) {
  const players = Array.isArray(resolved.players) ? resolved.players : [];
  const subjects = players.length ? players : [resolved.character].filter(Boolean);
  return subjects.slice(0, 3).map(normalizeText).filter(Boolean).join(" / ");
}

function lotDescriptionText(resolved = {}) {
  return [
    resolved.card_name,
    resolved.insert,
    resolved.surface_color,
    resolved.parallel_exact || resolved.parallel_family || resolved.parallel,
    resolved.lot_type && !/\blot\b/i.test(resolved.lot_type) ? resolved.lot_type : null
  ].map(normalizeText).filter(Boolean).reduce((parts, part) => {
    const comparable = normalizeComparable(part);
    if (!comparable) return parts;
    if (!parts.some((existing) => {
      const existingComparable = normalizeComparable(existing);
      return existingComparable === comparable
        || existingComparable.includes(comparable)
        || comparable.includes(existingComparable);
    })) parts.push(part);
    return parts;
  }, []).join(" ");
}

function lotSearchOptimizationText(resolved = {}) {
  return [
    resolved.rc ? "RC" : null,
    resolved.auto ? "Auto" : null,
    resolved.patch ? "Patch" : null,
    resolved.relic ? "Relic" : null,
    resolved.team && !normalizeComparable(lotSubjectText(resolved)).includes(normalizeComparable(resolved.team)) ? `(${resolved.team})` : null
  ].map(normalizeText).filter(Boolean).join(" ");
}

function renderLotTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const items = [
    { key: "lot_quantity", text: lotQuantityText(resolved), priority: 1, required: true, compactable: false },
    { key: "year", text: resolved.year, priority: 4, required: Boolean(resolved.year), compactable: false },
    { key: "product_identity", text: productHierarchyText(resolved), priority: 5, required: Boolean(productHierarchyText(resolved)), compactable: true },
    { key: "subject", text: lotSubjectText(resolved), priority: 6, required: Boolean(lotSubjectText(resolved)), compactable: true },
    { key: "description", text: lotDescriptionText(resolved), priority: 28, compactable: true },
    { key: "search_optimization", text: lotSearchOptimizationText(resolved), priority: 42, compactable: true },
    { key: "grading", text: renderGrade(resolved), priority: 72, compactable: false }
  ].filter((item) => normalizeText(item.text));
  const fitted = fitTitleItems(items, { maxLength });

  return {
    renderer: "lot",
    rendered_title: titleCleanup(fitted.title),
    title_length_policy: fitted.policy
  };
}

export function renderListingPresentation({
  resolved = {},
  evidence = {},
  maxLength = 80,
  serialNumeratorVerified = null,
  trustResolvedPrintRunWithoutEvidence = true
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  const cleanAutoGrade = normalizeAutoGradeToken(normalized.auto_grade);
  const gradeSanitized = normalized.auto_grade && !cleanAutoGrade
    ? {
      ...normalized,
      auto_grade: null,
      grade_type: normalized.card_grade ? "CARD_ONLY" : "UNKNOWN"
    }
    : cleanAutoGrade && cleanAutoGrade !== normalized.auto_grade
      ? { ...normalized, auto_grade: cleanAutoGrade }
      : normalized;
  const printRunEvidence = selectPrintRunEvidence(evidence);
  const hasEvidence = Boolean(Object.keys(evidence || {}).length);
  const grammarAdjusted = firstBowmanEvidenceAdjustment(gradeSanitized, evidence);
  const resolvedPrintRunFields = expandPrintRunFields(grammarAdjusted);
  const trustedResolvedPrintRun = !hasEvidence && trustResolvedPrintRunWithoutEvidence;
  const trustedResolvedNumerator = trustedResolvedPrintRun && serialNumeratorVerified === null;
  const directPrintRunEvidence = serialNumeratorVerified === true
    ? !printRunEvidence.verifiedNumeratorConflict
      ? printRunEvidence.direct || printRunEvidence.verified
      : null
    : serialNumeratorVerified !== false && !printRunEvidence.numeratorConflict
      ? printRunEvidence.direct
      : null;
  // Reference denominator disagreement is irrelevant once a non-conflicting
  // current-instance full reading is bound to its own concrete evidence value.
  const evidenceDenominator = !printRunEvidence.denominatorConflict
    ? printRunEvidence.denominator
    : null;
  const printRunFields = directPrintRunEvidence?.fields
    || evidenceDenominator?.fields
    || resolvedPrintRunFields;
  const directPrintRunDisplay = Boolean(directPrintRunEvidence) || trustedResolvedNumerator;
  const denominatorAuthorized = Boolean(directPrintRunEvidence || evidenceDenominator || trustedResolvedPrintRun);
  // `1/1` has no safe denominator-only representation: `#/1` makes the same
  // physical-copy claim. Any path without direct numerator authority must
  // suppress it instead of letting the one-of-one shortcut restore it.
  const unverifiedOneOfOne = printRunFields.print_run_denominator === "1" && !directPrintRunDisplay;
  const printRunDisplay = !unverifiedOneOfOne && denominatorAuthorized
    ? printRunTitleText(printRunFields, {
      directCurrentInstance: directPrintRunDisplay
    })
    : "";
  const printRunSuppressedResolved = !hasPresentationValue(printRunDisplay)
    && (resolvedPrintRunFields.print_run_number || resolvedPrintRunFields.print_run_denominator)
    ? {
      ...grammarAdjusted,
      print_run_number: null,
      print_run_numerator: null,
      print_run_denominator: null,
      numbered_to: null,
      serial_number: null,
      serial_denominator: null,
      expected_serial_denominator: null,
      numerical_rarity: null,
      one_of_one: false,
      suspicious_print_run: false,
      print_run_review_required: false
    }
    : grammarAdjusted;
  const presentationResolved = hasPresentationValue(printRunDisplay)
    ? withPrintRunDisplay(
      grammarAdjusted,
      printRunFields,
      printRunDisplay,
      directPrintRunDisplay
    )
    : printRunSuppressedResolved;
  const presentationResolvedFields = immutablePresentationSnapshot(presentationResolved);
  const modules = renderListingModules({
    resolved: presentationResolvedFields,
    evidence
  });
  const title = renderResolvedTitle(presentationResolvedFields, { maxLength });

  return {
    renderer_version: rendererVersion,
    renderer: title.renderer,
    module_order: moduleOrder,
    modules,
    rendered_title: title.rendered_title,
    final_title: title.rendered_title,
    title_length_policy: title.title_length_policy,
    presentation_resolved_fields: presentationResolvedFields
  };
}
