import {
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields,
  assertValidEvidenceDocument
} from "./evidence-schema.mjs";
import { resolveCardFields } from "../resolver/resolve-card.mjs";
import { splitCardNumber } from "../resolver/number-resolver.mjs";
import { splitParallelDescriptor } from "../../identity-resolution/parallel-taxonomy.mjs";

const legacyToResolvedField = Object.freeze({
  year: "year",
  manufacturer: "manufacturer",
  brand: "brand",
  product: "product",
  multi_card: "multi_card",
  card_count: "card_count",
  lot_type: "lot_type",
  set: "set",
  subset: "subset",
  card_type: "card_type",
  insert: "insert",
  surface_color: "surface_color",
  surfaceColor: "surface_color",
  parallel_family: "parallel_family",
  parallelFamily: "parallel_family",
  parallel_exact: "parallel_exact",
  parallelExact: "parallel_exact",
  parallel: "parallel",
  variation: "variation",
  player: "players",
  players: "players",
  character: "character",
  artist: "artist",
  team: "team",
  collector_number: "collector_number",
  checklist_code: "checklist_code",
  serial_number: "serial_number",
  rc: "rc",
  first_bowman: "first_bowman",
  ssp: "ssp",
  case_hit: "case_hit",
  grade_company: "grade_company",
  grade: "card_grade",
  card_grade: "card_grade",
  auto_grade: "auto_grade",
  grade_type: "grade_type",
  auto: "auto",
  relic: "relic",
  patch: "patch",
  sketch: "sketch",
  redemption: "redemption",
  one_of_one: "one_of_one"
});

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function confidenceForPayload(payload = {}) {
  const normalized = String(payload.confidence || "").toUpperCase();
  return {
    HIGH: 0.9,
    MEDIUM: 0.65,
    UNSURE: 0.5,
    LOW: 0.35,
    FAILED: 0.05
  }[normalized] ?? 0.5;
}

export const splitLegacyCardNumber = splitCardNumber;

function searchable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reasonMentions(reasonText, terms = []) {
  return terms.some((term) => reasonText.includes(term));
}

function inferredEvidenceSourceType(fieldName, payload = {}, unresolved = []) {
  const reasonText = searchable([
    payload.reason,
    ...(Array.isArray(unresolved) ? unresolved : [])
  ].filter(Boolean).join(" "));
  const visualOnly = reasonMentions(reasonText, [
    "visual",
    "visual only",
    "visual-only",
    "visible foil",
    "foil alone",
    "foil color",
    "color only",
    "design color",
    "looks",
    "appears",
    "inferred",
    "likely",
    "guess",
    "guessed",
    "requires operator review"
  ]);
  const explicitFieldPrint = reasonMentions(reasonText, [
    "card text explicitly",
    "front card text explicitly",
    "back text explicitly",
    "visible label text",
    "label text",
    "slab label text",
    "psa label text",
    "bgs label text",
    "beckett label text",
    "cgc label text",
    "front printed text",
    "back printed text",
    "card text supports",
    "front card text supports",
    "back text supports",
    "slab label supports",
    "slab label identifies",
    "slab label clearly identifies",
    "slab label states",
    "slab label clearly states",
    "slab label says",
    "label identifies",
    "label clearly identifies",
    "label clearly states",
    "psa label supports",
    "printed parallel",
    "parallel printed",
    "printed rc",
    "rc logo printed",
    "printed rookie",
    "printed 1st bowman",
    "1st bowman printed",
    "card says",
    "label states",
    "explicitly states"
  ]);
  const registrySupport = reasonMentions(reasonText, [
    "registry supports",
    "checklist supports",
    "official checklist supports",
    "structured database supports"
  ]);
  const explicitPrinted = reasonMentions(reasonText, [
    "card text",
    "card front",
    "front card text",
    "front and back images confirm",
    "front and back image confirms",
    "front and back confirms",
    "front image confirms",
    "back image confirms",
    "front confirms",
    "back confirms",
    "product text",
    "printed",
    "explicit",
    "explicitly",
    "supports",
    "states",
    "shows",
    "visible",
    "serial visible"
  ]);
  const backPrinted = reasonMentions(reasonText, [
    "back text",
    "back side",
    "back side",
    "back side",
    "back-side",
    "reverse text",
    "printed on the back",
    "card code"
  ]);
  const slabLabel = reasonMentions(reasonText, [
    "slab",
    "label",
    "psa",
    "bgs",
    "beckett",
    "cgc"
  ]);
  const slabIdentitySupport = reasonMentions(reasonText, [
    "slab text supports",
    "label supports",
    "label explicitly supports",
    "label text",
    "label identifies",
    "label clearly identifies",
    "slab label text",
    "slab label identifies",
    "slab label clearly identifies",
    "psa label text",
    "psa label supports",
    "bgs label text",
    "bgs label supports",
    "beckett label text",
    "beckett label supports",
    "cgc label text",
    "cgc label supports"
  ]);
  const mixedPrintedAndSlab = slabLabel && reasonMentions(reasonText, [
    "card text supports",
    "front card text supports",
    "back text supports",
    "product text supports",
    "card-issued"
  ]);

  if (slabLabel && (fieldName.startsWith("grade_") || fieldName === "card_grade" || fieldName === "auto_grade" || fieldName === "grade_type" || (slabIdentitySupport && !mixedPrintedAndSlab))) {
    return "SLAB_LABEL";
  }

  if (["surface_color", "parallel_family", "parallel_exact", "parallel", "variation", "ssp", "case_hit"].includes(fieldName)) {
    if (registrySupport) return "STRUCTURED_DATABASE";
    if (visualOnly || !explicitFieldPrint) return "VISION_MODEL";
    if (slabLabel) return "SLAB_LABEL";
    if (backPrinted) return "CARD_BACK";
    return "CARD_FRONT";
  }

  if (["rc", "first_bowman"].includes(fieldName)) {
    if (visualOnly) return "VISION_MODEL";
    if (backPrinted) return "CARD_BACK";
    return "CARD_FRONT";
  }

  if (backPrinted) return "CARD_BACK";
  if (explicitPrinted) return "CARD_FRONT";
  return "VISION_MODEL";
}

function fieldSourceForImages(images = [], observedText = "", {
  fieldName = "",
  payload = {},
  unresolved = []
} = {}) {
  const image = images[0] || {};
  const sourceType = inferredEvidenceSourceType(fieldName, payload, unresolved);

  return createVisionSource({
    sourceType,
    imageId: image.id || null,
    side: sourceType === "CARD_BACK" ? "back" : image.sourceRegion ? null : "front",
    captureRole: image.derived ? image.storageRole || "derived_crop" : "primary",
    region: image.sourceRegion || null,
    observedText,
    glareOcclusion: image.imageQuality?.glare_score ?? null,
    blurScore: image.imageQuality?.blur_score ?? null,
    trustTier: image.derived ? 2 : 1
  });
}

function evidenceFromResolvedField(fieldName, value, {
  payload,
  images,
  unresolved
}) {
  const confidence = confidenceForPayload(payload);
  const textValue = Array.isArray(value) ? value : normalizeText(value);
  const hasValue = Array.isArray(textValue) ? textValue.length > 0 : Boolean(textValue);
  const unresolvedText = unresolved.join(" ").toLowerCase();
  const reviewRequested = hasValue && unresolvedText.includes(fieldName.replace(/_/g, " "));
  const status = !hasValue
    ? "MISSING"
    : reviewRequested
      ? "REVIEW"
      : confidence >= 0.86
        ? "CONFIRMED"
        : "REVIEW";

  return createEvidenceField({
    value: hasValue ? textValue : null,
    normalizedValue: hasValue ? textValue : null,
    status,
    confidence: hasValue ? confidence : 0,
    sources: hasValue ? [fieldSourceForImages(images, Array.isArray(textValue) ? textValue.join(" / ") : textValue, {
      fieldName,
      payload,
      unresolved
    })] : [],
    unresolvedReason: !hasValue
      ? "not_extracted"
      : reviewRequested
        ? "operator_review_requested"
        : null
  });
}

export function legacyFieldsToResolvedFields(fields = {}) {
  const resolvedInput = {};

  Object.entries(legacyToResolvedField).forEach(([legacyField, resolvedField]) => {
    const value = fields[legacyField];
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    if (resolvedField === "players") {
      resolvedInput.players = Array.isArray(value) ? value : [value];
    } else {
      resolvedInput[resolvedField] = value;
    }
  });

  const splitNumber = splitLegacyCardNumber(fields.card_number);
  ["serial_number", "collector_number", "checklist_code"].forEach((key) => {
    if (!resolvedInput[key] && splitNumber[key]) resolvedInput[key] = splitNumber[key];
  });

  if (fields.serial_number) resolvedInput.serial_number = fields.serial_number;
  if ((fields.parallel || fields.variation) && (!resolvedInput.surface_color || !resolvedInput.parallel_family)) {
    const descriptor = splitParallelDescriptor(fields.parallel || fields.variation);
    if (!resolvedInput.surface_color && descriptor.surface_color) resolvedInput.surface_color = descriptor.surface_color;
    if (!resolvedInput.parallel_family && descriptor.parallel_family) resolvedInput.parallel_family = descriptor.parallel_family;
  }

  return resolveCardFields({
    resolved: normalizeResolvedFields(resolvedInput),
    legacyFields: fields
  }).resolved;
}

export function resolvedFieldsToLegacyFields(resolved = {}) {
  return {
    year: resolved.year,
    brand: resolved.brand || resolved.manufacturer,
    product: resolved.product,
    multi_card: resolved.multi_card,
    card_count: resolved.card_count,
    lot_type: resolved.lot_type,
    set: resolved.set,
    subset: resolved.subset,
    insert: resolved.insert || resolved.card_type,
    surface_color: resolved.surface_color,
    parallel_family: resolved.parallel_family,
    parallel_exact: resolved.parallel_exact,
    parallel: resolved.parallel,
    variation: resolved.variation,
    player: Array.isArray(resolved.players) ? resolved.players.join(" / ") || null : null,
    players: resolved.players,
    character: resolved.character,
    artist: resolved.artist,
    team: resolved.team,
    card_number: resolved.checklist_code || resolved.collector_number,
    collector_number: resolved.collector_number,
    checklist_code: resolved.checklist_code,
    serial_number: resolved.serial_number,
    grade_company: resolved.grade_company,
    grade: resolved.card_grade,
    card_grade: resolved.card_grade,
    auto_grade: resolved.auto_grade,
    grade_type: resolved.grade_type,
    rc: resolved.rc,
    first_bowman: resolved.first_bowman,
    ssp: resolved.ssp,
    case_hit: resolved.case_hit,
    auto: resolved.auto,
    relic: resolved.relic,
    patch: resolved.patch,
    sketch: resolved.sketch,
    redemption: resolved.redemption,
    one_of_one: resolved.one_of_one
  };
}

function titleCasePhrase(value) {
  return normalizeText(value)
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferSlabLabelParallel(payload = {}) {
  const text = normalizeText([
    payload.reason,
    payload.title,
    payload.model_title_suggestion
  ].filter(Boolean).join(" "));
  if (!/\b(?:slab|label|psa|bgs|beckett|cgc|sgc)\b/i.test(text)) return "";

  const colors = "Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow";
  const suffixes = "Bordered|Cracked Ice|Geometric|Hyper|Mojo|Prizm|Refractor|Shimmer|Sparkle|Sparkles|Speckle|Vinyl|Wave";
  const variation = text.match(new RegExp(`\\bVariation[-\\s]+(${colors})(?:[-\\s]+(${suffixes}))?\\b`, "i"));
  if (variation) {
    const color = titleCasePhrase(variation[1]);
    const suffix = titleCasePhrase(variation[2] || "");
    return `Variation-${[color, suffix].filter(Boolean).join(" ")}`;
  }

  return "";
}

export function providerPayloadToEvidenceDocument(payload = {}, {
  images = []
} = {}) {
  const unresolved = Array.isArray(payload.unresolved) ? payload.unresolved.map(normalizeText).filter(Boolean) : [];
  const inferredParallel = payload.fields?.parallel || payload.fields?.variation
    ? ""
    : inferSlabLabelParallel(payload);
  const legacyFields = {
    ...(payload.fields || {}),
    ...(inferredParallel ? { parallel: inferredParallel } : {}),
    title: payload.title || payload.model_title_suggestion || ""
  };
  const resolverResult = resolveCardFields({
    resolved: payload.resolved || legacyFieldsToResolvedFields(legacyFields),
    legacyFields
  });
  const resolved = resolverResult.resolved;
  const evidence = {};

  Object.entries(resolved).forEach(([fieldName, value]) => {
    if (fieldName === "grade_type" && value === "UNKNOWN") return;
    if (Array.isArray(value) && value.length === 0) return;
    if (value === null || value === false) return;
    evidence[fieldName] = evidenceFromResolvedField(fieldName, value, {
      payload,
      images,
      unresolved
    });
  });

  const document = {
    evidence,
    resolved,
    unresolved,
    model_title_suggestion: payload.model_title_suggestion || payload.title || "",
    schema_version: "evidence-fields-v1",
    resolution_trace: resolverResult.resolution_trace
  };

  return assertValidEvidenceDocument(document);
}
