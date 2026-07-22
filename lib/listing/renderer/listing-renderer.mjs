import { semGrammarForResolved } from "../csm/sem-definition.mjs";
import { normalizeResolvedFields, serialNumeratorDirectProvenance } from "../evidence/evidence-schema.mjs";
import { expandPrintRunFields, printRunTitleText } from "../print-run/print-run-fields.mjs";
import { renderGenericTitle } from "./generic-title-renderer.mjs";
import { moduleOrder, renderListingModules, rendererVersion } from "./module-renderer.mjs";
import { renderPokemonTitle } from "./pokemon-title-renderer.mjs";
import { renderSportsTitle } from "./sports-title-renderer.mjs";
import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeComparable,
  normalizeAutoGradeToken,
  normalizeText,
  productHierarchyText,
  renderGrade,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";
import { canonicalPublisherIdentity } from "../pipeline/publisher-identity.mjs";

function hasPresentationValue(value) {
  return String(value ?? "").trim() !== "";
}

const safeBaseColors = Object.freeze([
  "black", "blue", "bronze", "gold", "green", "orange",
  "pink", "purple", "red", "silver", "white", "yellow"
]);

function safeEmbeddedColor(resolved = {}) {
  if (normalizeText(resolved.surface_color)) return null;
  const text = [
    resolved.parallel_exact,
    resolved.parallel_family,
    resolved.parallel,
    resolved.set,
    resolved.insert,
    resolved.card_name
  ].map(normalizeText).filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  const matches = safeBaseColors.filter((color) => new RegExp(`\\b${color}\\b`, "i").test(text));
  if (matches.length !== 1) return null;
  return matches[0][0].toUpperCase() + matches[0].slice(1);
}

function autographSemanticsAdjusted(resolved = {}) {
  const cardName = normalizeText(resolved.card_name);
  const insert = normalizeText(resolved.insert);
  const descriptor = `${cardName} ${insert}`.trim();
  const components = Array.isArray(resolved.observable_components)
    ? resolved.observable_components.map((item) => String(item).toLowerCase())
    : [];
  const observableAuto = components.includes("auto");
  const officialAutoName = /\b(?:auto(?:graph(?:ed|s)?)?|signatures)\b/i.test(descriptor);
  const genericSignedOnly = /\bsigned\b/i.test(descriptor) && !officialAutoName;
  const embeddedColor = safeEmbeddedColor(resolved);

  return {
    ...resolved,
    ...(embeddedColor ? { surface_color: embeddedColor } : {}),
    auto: observableAuto || officialAutoName
      ? true
      : genericSignedOnly
        ? false
        : resolved.auto,
    card_name: genericSignedOnly && !observableAuto ? null : resolved.card_name
  };
}

function publisherPresentationAdjusted(resolved = {}) {
  const publisher = canonicalPublisherIdentity({
    manufacturer: resolved.manufacturer,
    brand: resolved.brand,
    product: resolved.product,
    gradeCompany: resolved.grade_company
  });
  return {
    ...resolved,
    manufacturer: publisher.manufacturer,
    brand: publisher.brand
  };
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

function printRunDenominatorProvenance(field) {
  if (!field || typeof field !== "object") return false;
  const sources = Array.isArray(field.sources) ? field.sources : [];
  return sources.some((source) => printRunDenominatorSourceTypes.has(String(source?.source_type || "").toUpperCase()));
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
  return semGrammarForResolved(resolved) === "TCG";
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
  const normalized = autographSemanticsAdjusted(publisherPresentationAdjusted(normalizeResolvedFields(resolved)));
  const lot = isLotTitle(normalized);
  const multiSubjectReview = normalized.lot_type === "MULTI_SUBJECT_REVIEW";
  if (lot || multiSubjectReview) return renderLotTitle(normalized, {
    maxLength,
    includeQuantity: lot
  });
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
  // The reviewed writer corpus spells the lot marker as one token ("lotx3");
  // "Lot x3" splits into two tokens and never matches buyer searches or the
  // reviewed standard.
  return count > 1 ? `Lotx${count}` : "Lot";
}

function lotSubjectText(resolved = {}) {
  const players = Array.isArray(resolved.players) ? resolved.players : [];
  const subjects = players.length ? players : [resolved.character].filter(Boolean);
  return subjects.slice(0, 3).map(normalizeText).filter(Boolean).join(" / ");
}

function lotProductIdentityText(resolved = {}) {
  // A lot can contain different inserts/sets. Keep the shared product family in
  // the required identity slot and leave set/insert wording to the optional
  // description slot so recognizable subjects win the 80-character budget.
  return productHierarchyText({
    ...resolved,
    set: null,
    subset: null,
    insert: null,
    card_name: null
  });
}

function lotDescriptionText(resolved = {}) {
  return [
    resolved.card_name,
    resolved.insert,
    resolved.surface_color,
    resolved.parallel_exact || resolved.parallel_family || resolved.parallel,
    resolved.lot_type
      && resolved.lot_type !== "MULTI_SUBJECT_REVIEW"
      && !/\blot\b/i.test(resolved.lot_type)
      ? resolved.lot_type
      : null
  ].map(normalizeText).filter((part) => part && !/^(?:Base|Base Card)$/i.test(part)).reduce((parts, part) => {
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

function multiSubjectIdentityText(resolved = {}) {
  const namedCardType = normalizeText(resolved.official_card_type || resolved.card_type)
    .replace(/\b(?:Triple\s+)?(?:Autograph|Auto|Relic|Patch|Jersey|Memorabilia|Signature)\b/gi, " ")
    .replace(/\bCard\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [resolved.card_name, resolved.insert, namedCardType]
    .map(normalizeText)
    .find((value) => value && !/^(?:Base|Base Card|1st Bowman|Bowman Briefing)$/i.test(value)) || "";
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
  maxLength = 80,
  includeQuantity = true
} = {}) {
  const productIdentity = lotProductIdentityText(resolved);
  const multiSubjectIdentity = includeQuantity ? "" : multiSubjectIdentityText(resolved);
  const items = [
    includeQuantity
      ? { key: "lot_quantity", text: lotQuantityText(resolved), priority: 1, required: true, compactable: false }
      : null,
    { key: "year", text: resolved.year, priority: 4, required: Boolean(resolved.year), compactable: false },
    { key: "product_identity", text: productIdentity, priority: 5, required: Boolean(productIdentity), compactable: true },
    { key: "subject", text: lotSubjectText(resolved), priority: 6, required: Boolean(lotSubjectText(resolved)), compactable: true },
    { key: "multi_subject_identity", text: multiSubjectIdentity, priority: 7, required: Boolean(multiSubjectIdentity), compactable: true },
    // Preserve recognizable lot subjects before optional shared descriptors.
    // Otherwise a long insert/set can force every person down to a surname
    // even when dropping that descriptor leaves ample room under 80 chars.
    { key: "description", text: lotDescriptionText(resolved), priority: 42, compactable: true },
    { key: "search_optimization", text: lotSearchOptimizationText(resolved), priority: 42, compactable: true },
    {
      key: "grading",
      text: renderGrade(resolved),
      priority: includeQuantity ? 72 : 8,
      required: !includeQuantity && Boolean(renderGrade(resolved)),
      compactable: false
    }
  ].filter((item) => item && normalizeText(item.text));
  const fitted = fitTitleItems(items, { maxLength });

  return {
    renderer: includeQuantity ? "lot" : "multi_subject",
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
  const normalized = autographSemanticsAdjusted(publisherPresentationAdjusted(normalizeResolvedFields(resolved)));
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
  const printRunEvidence = evidence?.print_run_number || evidence?.numerical_rarity || evidence?.serial_number;
  const hasEvidence = Boolean(Object.keys(evidence || {}).length);
  const confirmedPrintRunEvidence = ["CONFIRMED", "MANUAL_CONFIRMED"].includes(printRunEvidence?.status);
  const sourcedPrintRunEvidence = printRunDenominatorProvenance(printRunEvidence);
  const directPrintRunProvenance = confirmedPrintRunEvidence && (
    serialNumeratorVerified === false
      ? false
      : serialNumeratorVerified === true || serialNumeratorDirectProvenance(printRunEvidence)
  );
  const grammarAdjusted = firstBowmanEvidenceAdjustment(gradeSanitized, evidence);
  const printRunFields = expandPrintRunFields(grammarAdjusted);
  // `1/1` has no safe denominator-only representation: `#/1` makes the same
  // physical-copy claim. If current-image OCR rejected the numerator, suppress
  // the entire print run instead of letting the one-of-one shortcut restore it.
  const unverifiedOneOfOne = serialNumeratorVerified === false && printRunFields.one_of_one === true;
  const safeUnverifiedDenominator = serialNumeratorVerified === false
    && !unverifiedOneOfOne
    && Number(printRunFields.print_run_denominator) > 1
    ? `#/${Number(printRunFields.print_run_denominator)}`
    : "";
  const printRunDisplay = !unverifiedOneOfOne
    && ((!hasEvidence && trustResolvedPrintRunWithoutEvidence)
      || (confirmedPrintRunEvidence && (sourcedPrintRunEvidence || directPrintRunProvenance)))
    ? printRunTitleText(printRunFields, {
      directCurrentInstance: directPrintRunProvenance || (!hasEvidence && trustResolvedPrintRunWithoutEvidence)
    })
    : safeUnverifiedDenominator;
  const printRunSuppressedResolved = (unverifiedOneOfOne || ((hasEvidence || !trustResolvedPrintRunWithoutEvidence) && (!confirmedPrintRunEvidence || (!sourcedPrintRunEvidence && !directPrintRunProvenance)))) && (printRunFields.print_run_number || printRunFields.print_run_denominator)
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
    ? {
      ...grammarAdjusted,
      ...printRunFields,
      numerical_rarity: printRunDisplay,
      print_run_number: printRunDisplay
    }
    : printRunSuppressedResolved;
  const modules = renderListingModules({
    resolved: presentationResolved,
    evidence
  });
  const title = renderResolvedTitle(presentationResolved, { maxLength });

  return {
    renderer_version: rendererVersion,
    renderer: title.renderer,
    module_order: moduleOrder,
    modules,
    rendered_title: title.rendered_title,
    final_title: title.rendered_title,
    title_length_policy: title.title_length_policy
  };
}
