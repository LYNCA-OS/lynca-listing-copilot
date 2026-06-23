import {
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields,
  assertValidEvidenceDocument
} from "./evidence-schema.mjs";
import { resolveCardFields } from "../resolver/resolve-card.mjs";
import { splitCardNumber } from "../resolver/number-resolver.mjs";

const legacyToResolvedField = Object.freeze({
  year: "year",
  brand: "brand",
  product: "product",
  set: "set",
  subset: "subset",
  insert: "insert",
  parallel: "parallel",
  player: "players",
  character: "character",
  artist: "artist",
  team: "team",
  serial_number: "serial_number",
  grade_company: "grade_company",
  grade: "card_grade",
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

function fieldSourceForImages(images = [], observedText = "") {
  const image = images[0] || {};

  return createVisionSource({
    imageId: image.id || null,
    side: image.sourceRegion ? null : "front",
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
  const status = !hasValue
    ? "MISSING"
    : unresolvedText.includes(fieldName.replace(/_/g, " "))
      ? "REVIEW"
      : confidence >= 0.86
        ? "CONFIRMED"
        : "REVIEW";

  return createEvidenceField({
    value: hasValue ? textValue : null,
    normalizedValue: hasValue ? textValue : null,
    status,
    confidence: hasValue ? confidence : 0,
    sources: hasValue ? [fieldSourceForImages(images, Array.isArray(textValue) ? textValue.join(" / ") : textValue)] : [],
    unresolvedReason: hasValue ? null : "not_extracted"
  });
}

export function legacyFieldsToResolvedFields(fields = {}) {
  const resolvedInput = {};

  Object.entries(legacyToResolvedField).forEach(([legacyField, resolvedField]) => {
    const value = fields[legacyField];
    if (value === undefined || value === null || value === "") return;
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
    set: resolved.set,
    subset: resolved.subset,
    insert: resolved.insert || resolved.card_type,
    parallel: resolved.parallel,
    player: Array.isArray(resolved.players) ? resolved.players.join(" / ") || null : null,
    character: resolved.character,
    artist: resolved.artist,
    team: resolved.team,
    card_number: resolved.checklist_code || resolved.collector_number,
    serial_number: resolved.serial_number,
    grade_company: resolved.grade_company,
    grade: resolved.card_grade,
    auto: resolved.auto,
    relic: resolved.relic,
    patch: resolved.patch,
    sketch: resolved.sketch,
    redemption: resolved.redemption,
    one_of_one: resolved.one_of_one
  };
}

export function providerPayloadToEvidenceDocument(payload = {}, {
  images = []
} = {}) {
  const unresolved = Array.isArray(payload.unresolved) ? payload.unresolved.map(normalizeText).filter(Boolean) : [];
  const legacyFields = {
    ...(payload.fields || {}),
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
