import {
  providerOutputFieldClass,
  providerOutputFieldContract
} from "../../providers/provider-output-field-contract.mjs";
import { providerSchemaError } from "../../providers/provider-errors.mjs";
import { validateProviderEvidencePayload } from "../../providers/provider-response-normalizer.mjs";
import { visionProviderIds } from "../../providers/provider-contract.mjs";
import { runBoundedOpenAiAssist } from "../../providers/openai-bounded-assist.mjs";

const provider = visionProviderIds.OPENAI_LEGACY;

export const targetedVisualObservationContract = Object.freeze({
  owner: "V4_TARGETED_VISUAL_OBSERVATION",
  executor_version: "targeted-visual-observation-v2",
  prompt_version: "targeted-visual-read-only-v2",
  schema_version: "targeted-visual-sparse-v2",
  max_derived_images: 4,
  title_effect: "NONE",
  resolver_effect: "PROPOSAL_ONLY"
});

const literalIdentityFields = Object.freeze([
  "card_name",
  "insert",
  "set",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "card_number"
]);

const literalCardCodeFields = Object.freeze([
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "card_number"
]);

export const targetedVisualFieldGroups = Object.freeze({
  card_name_or_insert_or_code: literalIdentityFields,
  card_number_or_code: literalCardCodeFields
});

const visibleAppearanceBooleanFields = new Set([
  "auto",
  "patch",
  "relic",
  "jersey",
  "sketch"
]);

const basicSurfaceColours = new Map([
  ["gold", "Gold"],
  ["silver", "Silver"],
  ["white", "White"],
  ["red", "Red"],
  ["blue", "Blue"],
  ["green", "Green"],
  ["black", "Black"],
  ["orange", "Orange"],
  ["purple", "Purple"]
]);

const printedBooleanMarkers = Object.freeze({
  rc: /\b(?:RC|ROOKIE)\b/i,
  first_bowman: /\b1ST\s+BOWMAN\b/i,
  ssp: /\bSSP\b/i,
  case_hit: /\bCASE[\s-]*HIT\b/i,
  auto: /\b(?:AUTO|AUTOGRAPH|SIGNED|SIGNATURE)\b/i,
  patch: /\bPATCH\b/i,
  relic: /\b(?:RELIC|MEMORABILIA)\b/i,
  jersey: /\bJERSEY\b/i,
  sketch: /\bSKETCH\b/i,
  redemption: /\bREDEMPTION\b/i,
  one_of_one: /(?:\b1\s*\/\s*1\b|\bONE\s+OF\s+ONE\b)/i
});

const cropRolesForField = Object.freeze({
  year: ["year_product_crop"],
  manufacturer: ["year_product_crop"],
  players: ["subject_crop"],
  set: ["card_type_crop", "year_product_crop"],
  subset: ["card_type_crop"],
  insert: ["card_type_crop"],
  card_name: ["card_type_crop"],
  official_card_type: ["card_type_crop"],
  card_number: ["card_code_crop"],
  tcg_card_number: ["card_code_crop"],
  collector_number: ["card_code_crop"],
  checklist_code: ["card_code_crop"],
  print_run_number: ["serial_crop"],
  print_run_numerator: ["serial_crop"],
  print_run_denominator: ["serial_crop"],
  grade_company: ["grade_label_crop"],
  card_grade: ["grade_label_crop"],
  auto_grade: ["grade_label_crop"],
  grade_type: ["grade_label_crop"],
  cert_number: ["grade_label_crop"]
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function roleForImage(image = {}) {
  const metadata = image.cropMetadata || image.crop_metadata || {};
  return cleanText(
    image.storageRole
    || image.storage_role
    || image.role
    || image.capture_angle
    || metadata.crop_role
    || metadata.role
  ).toLowerCase();
}

function imageIsDerived(image = {}) {
  const role = roleForImage(image);
  if (image.derived || image.sourceRegion || image.source_region) return true;
  return Boolean(role) && ![
    "image_1_original",
    "image_2_original",
    "front_original",
    "back_original",
    "front",
    "back",
    "primary"
  ].includes(role);
}

export function expandTargetedVisualFields(targetFields = []) {
  const requested = (Array.isArray(targetFields) ? targetFields : [])
    .map(cleanText)
    .filter(Boolean)
    .flatMap((field) => targetedVisualFieldGroups[field] || [field]);
  const fields = unique(requested);
  const invalid = fields.filter((field) => (
    providerOutputFieldContract[field]?.classification !== providerOutputFieldClass.READ
  ));
  if (invalid.length) {
    throw new Error(`targeted visual fields must be READ-only: ${invalid.join(",")}`);
  }
  return Object.freeze(fields);
}

export function selectTargetedVisualImages(images = [], targetFields = [], {
  imagePolicy = "PRIMARY_PLUS_RELEVANT_CROPS_ONLY",
  maxDerived = targetedVisualObservationContract.max_derived_images,
  requiredTargets = targetFields
} = {}) {
  const allImages = Array.isArray(images) ? images : [];
  const primary = allImages.filter((image) => !imageIsDerived(image)).slice(0, 2);
  const fallbackPrimary = primary.length ? primary : allImages.slice(0, 2);
  const primarySet = new Set(fallbackPrimary);
  const exactTargetFields = expandTargetedVisualFields(targetFields);
  const wantedRoles = unique(exactTargetFields.flatMap((field) => cropRolesForField[field] || []));
  const derived = allImages
    .filter((image) => !primarySet.has(image) && wantedRoles.includes(roleForImage(image)))
    .sort((left, right) => wantedRoles.indexOf(roleForImage(left)) - wantedRoles.indexOf(roleForImage(right)))
    .slice(0, Math.max(0, Number(maxDerived) || 0));
  const selectedDerivedRoles = new Set(derived.map(roleForImage));
  const requirementsCoveredByCrops = unique(requiredTargets.map(cleanText)).every((requirement) => {
    // The identity OR-group needs an identity-bearing crop. A generic
    // year/product crop can happen to be scheduled for `set`, but that does
    // not prove the card name, insert, or code is actually visible there.
    // Keep the original pair as bounded redundancy unless the card-type or
    // card-code crop is present.
    if (requirement === "card_name_or_insert_or_code") {
      return ["card_type_crop", "card_code_crop"].some((role) => selectedDerivedRoles.has(role));
    }
    const fields = targetedVisualFieldGroups[requirement] || [requirement];
    return fields.some((field) => (
      (cropRolesForField[field] || []).some((role) => selectedDerivedRoles.has(role))
    ));
  });
  const includePrimary = cleanText(imagePolicy) !== "RELEVANT_CROPS_ONLY"
    || !requirementsCoveredByCrops;
  return Object.freeze([
    ...(includePrimary ? fallbackPrimary : []),
    ...derived
  ]);
}

function fieldsByType(fields = [], type = "string") {
  return fields.filter((field) => providerOutputFieldContract[field]?.value_type === type);
}

function typedEntrySchema(fields, valueSchema) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      f: { type: "string", enum: fields.length ? [...fields] : ["__NONE__"] },
      v: valueSchema
    },
    required: ["f", "v"]
  };
}

function imageIdentity(image = {}) {
  const metadata = image.cropMetadata || image.crop_metadata || {};
  return cleanText(
    image.image_id
    || image.imageId
    || image.id
    || image.asset_image_id
    || image.assetImageId
    || image.object_path
    || image.objectPath
    || image.storage_path
    || image.storagePath
    || metadata.image_id
    || metadata.crop_id
    || metadata.source_image_id
  ) || null;
}

function sideForImage(image = {}) {
  const metadata = image.cropMetadata || image.crop_metadata || {};
  const explicit = cleanText(
    image.source_side
    || image.sourceSide
    || image.side
    || metadata.source_side
    || metadata.sourceSide
  ).toLowerCase();
  if (explicit === "back" || explicit === "rear") return "back";
  if (explicit === "front" || explicit === "obverse") return "front";
  const role = roleForImage(image);
  if (/(?:^|[_-])back(?:$|[_-])/.test(role)) return "back";
  return "front";
}

export function targetedVisualImageManifest(images = []) {
  return Object.freeze((Array.isArray(images) ? images : []).map((image, index) => {
    const ref = `image_${index + 1}`;
    const imageId = imageIdentity(image);
    if (!imageId) {
      throw new Error(`targeted_visual_image_identity_missing:${ref}`);
    }
    return Object.freeze({
      ref,
      image_id: imageId,
      role: roleForImage(image) || "unknown",
      side: sideForImage(image)
    });
  }));
}

export function targetedVisualResponseSchema(targetFields = [], selectedImages = []) {
  const fields = expandTargetedVisualFields(targetFields);
  const imageRefs = targetedVisualImageManifest(selectedImages).map((image) => image.ref);
  const strings = fieldsByType(fields, "string");
  const booleans = fieldsByType(fields, "boolean");
  const numbers = fieldsByType(fields, "number");
  const lists = fieldsByType(fields, "list");
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      r: { type: "string", enum: ["CONFIRMED", "ABSTAIN"] },
      v: {
        type: "object",
        additionalProperties: false,
        properties: {
          s: { type: "array", items: typedEntrySchema(strings, { type: "string" }) },
          b: { type: "array", items: typedEntrySchema(booleans, { type: "boolean" }) },
          n: { type: "array", items: typedEntrySchema(numbers, { type: "number" }) },
          l: { type: "array", items: typedEntrySchema(lists, { type: "array", items: { type: "string" } }) }
        },
        required: ["s", "b", "n", "l"]
      },
      e: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            f: { type: "string", enum: [...fields] },
            s: { type: "string", enum: ["PRINTED_TEXT", "VISIBLE_APPEARANCE", "SLAB_LABEL"] },
            i: { type: "string", enum: imageRefs.length ? imageRefs : ["__NONE__"] },
            t: { type: "string" }
          },
          required: ["f", "s", "i", "t"]
        }
      },
      u: { type: "array", items: { type: "string", enum: [...fields] } }
    },
    required: ["r", "v", "e", "u"]
  };
}

function requirementText(target) {
  const fields = targetedVisualFieldGroups[target];
  return fields ? `any one of [${fields.join(", ")}]` : target;
}

export function buildTargetedVisualPrompt(targetFields = [], selectedImages = [], requiredTargets = targetFields) {
  const fields = expandTargetedVisualFields(targetFields);
  const imageManifest = targetedVisualImageManifest(selectedImages);
  return [
    "Read only literal facts visible on the supplied card or slab images.",
    `Allowed fields: ${fields.join(", ")}.`,
    `Success requirements: ${unique(requiredTargets.map(cleanText)).map(requirementText).join(", ")}.`,
    `Image references in supplied order: ${imageManifest.map((image) => `${image.ref}=${image.role}`).join(", ") || "none"}.`,
    "Every evidence i must use one of those exact image_N references; never invent or echo an image id.",
    "Return sparse values only. Never infer product, team, exact named parallel, title, or marketplace wording.",
    "Use basic surface colours only (Gold, Silver, White, Red, Blue, Green, Black, Orange, Purple).",
    "For names, codes, grades, variation wording, and numbering, copy visible text exactly.",
    "PRINTED_TEXT and SLAB_LABEL values must be literally supported by t.",
    "Use VISIBLE_APPEARANCE only for surface_color or a visibly present auto, patch, relic, jersey, or sketch; emit only positive component booleans.",
    "If a requested fact is not visible, place its field in u. Do not guess."
  ].join("\n");
}

function valuesFromPacket(packet = {}, allowedFields = []) {
  const allowed = new Set(allowedFields);
  const values = {};
  const seen = new Set();
  const consume = (entries, type, valueCheck) => {
    if (!Array.isArray(entries)) throw providerSchemaError(provider, `Targeted visual packet ${type} values must be an array.`);
    for (const entry of entries) {
      const field = cleanText(entry?.f);
      if (!allowed.has(field) || field === "__NONE__" || seen.has(field) || !valueCheck(entry?.v)) {
        throw providerSchemaError(provider, `Targeted visual packet contains invalid or duplicate field ${field || "unknown"}.`);
      }
      seen.add(field);
      values[field] = entry.v;
    }
  };
  consume(packet?.v?.s, "string", (value) => typeof value === "string" && cleanText(value) !== "");
  consume(packet?.v?.b, "boolean", (value) => typeof value === "boolean");
  consume(packet?.v?.n, "number", (value) => Number.isFinite(value));
  consume(packet?.v?.l, "list", (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && cleanText(item) !== ""));
  return values;
}

function evidenceKindFor(field) {
  if (["grade_company", "card_grade", "auto_grade", "grade_type", "cert_number"].includes(field)) return "GRADE_LABEL";
  if (["print_run_number", "print_run_numerator", "print_run_denominator"].includes(field)) return "PRINTED_LIMITED_NUMBERING";
  if (literalIdentityFields.includes(field)) return "PRINTED_IDENTITY_TEXT";
  return "TARGETED_PROVIDER_OBSERVATION";
}

function comparableTokens(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function textContainsTokens(visibleText, value) {
  const expected = comparableTokens(value);
  const observed = comparableTokens(visibleText);
  if (!expected.length || expected.length > observed.length) return false;
  return observed.some((_, index) => expected.every((token, offset) => observed[index + offset] === token));
}

function printedTextSupportsValue(field, value, visibleText) {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => textContainsTokens(visibleText, item));
  }
  if (typeof value === "boolean") {
    return value === true && Boolean(printedBooleanMarkers[field]?.test(visibleText));
  }
  return textContainsTokens(visibleText, value);
}

function visibleAppearanceSupportsValue(field, value) {
  if (field === "surface_color" && typeof value === "string") {
    return basicSurfaceColours.has(cleanText(value).toLowerCase());
  }
  return visibleAppearanceBooleanFields.has(field) && value === true;
}

export function expandTargetedVisualPacket(packet = {}, targetFields = [], { selectedImages = [] } = {}) {
  const allowedFields = expandTargetedVisualFields(targetFields);
  const imageManifest = targetedVisualImageManifest(selectedImages);
  const imagesByRef = new Map(imageManifest.map((image) => [image.ref, image]));
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw providerSchemaError(provider, "Targeted visual response must be an object.");
  }
  if (!["CONFIRMED", "ABSTAIN"].includes(packet.r)) {
    throw providerSchemaError(provider, "Targeted visual response has invalid status.");
  }
  const fields = valuesFromPacket(packet, allowedFields);
  const evidenceRows = Array.isArray(packet.e) ? packet.e : null;
  if (!evidenceRows) throw providerSchemaError(provider, "Targeted visual evidence must be an array.");
  const evidenceByField = new Map();
  for (const row of evidenceRows) {
    const field = cleanText(row?.f);
    const kind = cleanText(row?.s).toUpperCase();
    if (!allowedFields.includes(field) || !(field in fields) || evidenceByField.has(field)) {
      throw providerSchemaError(provider, `Targeted visual evidence contains invalid or duplicate field ${field || "unknown"}.`);
    }
    if (!["PRINTED_TEXT", "VISIBLE_APPEARANCE", "SLAB_LABEL"].includes(kind)) {
      throw providerSchemaError(provider, `Targeted visual evidence has invalid source kind for ${field}.`);
    }
    const imageRef = cleanText(row?.i);
    const sourceImage = imagesByRef.get(imageRef);
    if (!sourceImage) {
      throw providerSchemaError(provider, `Targeted visual evidence has invalid image ref for ${field}.`);
    }
    const visibleText = cleanText(row?.t);
    if (kind !== "VISIBLE_APPEARANCE" && !visibleText) {
      throw providerSchemaError(provider, `Targeted visual text evidence is empty for ${field}.`);
    }
    if ((kind === "PRINTED_TEXT" || kind === "SLAB_LABEL")
      && !printedTextSupportsValue(field, fields[field], visibleText)) {
      throw providerSchemaError(provider, `Targeted visual text evidence does not support value for ${field}.`);
    }
    if (kind === "VISIBLE_APPEARANCE" && !visibleAppearanceSupportsValue(field, fields[field])) {
      throw providerSchemaError(provider, `Targeted visual VISIBLE_APPEARANCE is not allowed for ${field}.`);
    }
    evidenceByField.set(field, {
      field,
      value: fields[field],
      // Both the value and `t` originate in the same model response. Their
      // agreement is a schema-integrity check, not independent OCR proof.
      // Never let a model self-attest CARD_* or SLAB_LABEL trust.
      source_type: "VISION_MODEL",
      source_image_id: sourceImage.image_id,
      source_region: sourceImage.role,
      raw_text: visibleText,
      visible_text: visibleText,
      evidence_kind: evidenceKindFor(field),
      confidence: null,
      review_required: true,
      directly_observed: false,
      direct_observation: false,
      model_claimed_source_kind: kind,
      source_inference_method: "TARGETED_VISUAL_MODEL"
    });
  }
  const missingEvidence = Object.keys(fields).filter((field) => !evidenceByField.has(field));
  if (missingEvidence.length) {
    throw providerSchemaError(provider, `Targeted visual values lack direct evidence: ${missingEvidence.join(",")}.`);
  }
  const unresolved = unique(Array.isArray(packet.u) ? packet.u.map(cleanText) : []);
  if (unresolved.some((field) => !allowedFields.includes(field) || field in fields)) {
    throw providerSchemaError(provider, "Targeted visual unresolved fields are invalid or already populated.");
  }
  return validateProviderEvidencePayload(provider, {
    recognition_status: packet.r,
    fields,
    field_evidence: [...evidenceByField.values()],
    unresolved,
    vector_candidate_decision: {
      selected_candidate_id: null,
      decision: "NOT_AVAILABLE",
      supported_fields: [],
      rejected_fields: [],
      conflicts: []
    }
  });
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return cleanText(value) !== "";
}

export function targetedVisualObservationSafety(parsed = {}, requestedTargets = [], { knownFields = {} } = {}) {
  const observedFields = parsed?.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const fields = {
    ...(knownFields && typeof knownFields === "object" && !Array.isArray(knownFields) ? knownFields : {}),
    ...observedFields
  };
  const missing = [];
  for (const target of unique((Array.isArray(requestedTargets) ? requestedTargets : []).map(cleanText))) {
    const group = targetedVisualFieldGroups[target];
    if (group) {
      if (!group.some((field) => valuePresent(fields[field]))) missing.push(target);
    } else if (!valuePresent(fields[target])) {
      missing.push(target);
    }
  }
  const subjectPresent = valuePresent(fields.players);
  const literalIdentityPresent = literalIdentityFields.some((field) => valuePresent(fields[field]));
  const safe = parsed.recognition_status !== "ABSTAIN"
    && subjectPresent
    && literalIdentityPresent
    && missing.length === 0;
  return Object.freeze({
    safe,
    reason: safe
      ? "TARGETED_OBSERVATION_SUFFICIENT"
      : parsed.recognition_status === "ABSTAIN"
        ? "TARGETED_OBSERVATION_ABSTAINED"
        : !subjectPresent
          ? "TARGETED_SUBJECT_MISSING"
          : !literalIdentityPresent
            ? "TARGETED_LITERAL_IDENTITY_MISSING"
            : "TARGETED_REQUESTED_FIELD_MISSING",
    missing_requested_fields: Object.freeze(missing),
    subject_present: subjectPresent,
    literal_identity_present: literalIdentityPresent
  });
}

export async function runTargetedVisualObservation({
  images = [],
  targetFields = [],
  requiredTargets = targetFields,
  imagePolicy = "PRIMARY_PLUS_RELEVANT_CROPS_ONLY",
  shardKey = "",
  preferredKeySlot = null,
  modelOverride = "",
  maxOutputTokens = 384,
  timeoutMs = 3_500,
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal = null,
  requestContext = {},
  knownFields = {}
} = {}) {
  const expandedFields = expandTargetedVisualFields(targetFields);
  const selectedImages = selectTargetedVisualImages(images, expandedFields, {
    imagePolicy,
    requiredTargets
  });
  if (!selectedImages.length) throw new Error("targeted_visual_images_missing");
  const prompt = buildTargetedVisualPrompt(targetFields, selectedImages, requiredTargets);
  const result = await runBoundedOpenAiAssist({
    prompt,
    schema: targetedVisualResponseSchema(targetFields, selectedImages),
    schemaName: "listing_targeted_visual_sparse_v2",
    images: selectedImages,
    shardKey,
    preferredKeySlot,
    modelOverride,
    maxOutputTokens,
    timeoutMs,
    imageDetail: "auto",
    textVerbosity: "low",
    env,
    fetchImpl,
    signal,
    requestContext
  });
  let parsed;
  let safety;
  try {
    parsed = expandTargetedVisualPacket(result.parsed, targetFields, { selectedImages });
    safety = targetedVisualObservationSafety(parsed, requiredTargets, { knownFields });
  } catch (error) {
    // The transport has already completed and incurred one paid call. Preserve
    // only bounded accounting metadata so semantic validation failures cannot
    // disappear from the evaluation ledger.
    if (error && typeof error === "object") {
      error.provider_call_attempted = true;
      error.provider_usage = result.usage || null;
      error.provider_model_id = result.model_id || null;
      error.provider_response_hash = result.response_hash || null;
    }
    throw error;
  }
  return {
    ...result,
    ...targetedVisualObservationContract,
    response_profile: targetedVisualObservationContract.schema_version,
    parsed,
    targeted_visual_observation: {
      ...targetedVisualObservationContract,
      target_fields: expandedFields,
      route_target_fields: Object.freeze(unique(targetFields.map(cleanText))),
      required_targets: Object.freeze(unique(requiredTargets.map(cleanText))),
      input_image_count: selectedImages.length,
      input_image_roles: Object.freeze(selectedImages.map(roleForImage)),
      prompt_chars: prompt.length,
      safety
    }
  };
}

export const __targetedVisualObservationTestHooks = Object.freeze({
  basicSurfaceColours,
  comparableTokens,
  cropRolesForField,
  imageIsDerived,
  literalIdentityFields,
  printedTextSupportsValue,
  roleForImage,
  sideForImage,
  valuesFromPacket
});
