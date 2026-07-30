import { createHash } from "node:crypto";

import { semGrammarForResolved } from "../csm/sem-definition.mjs";

export const secondLookPlannerContract = Object.freeze({
  owner: "V4_SECOND_LOOK_CARD_CODE_PLANNER",
  schema_version: "second-look-card-code-plan-v1",
  policy_version: "second-look-card-code-policy-2026-07-30.1",
  production_default: "OFF",
  title_effect: "NONE",
  resolver_effect: "PROPOSAL_ONLY"
});

export const secondLookIdentityCriticalReasons = Object.freeze({
  EXACT_IDENTITY_CARD_CODE_GAP: "EXACT_IDENTITY_CARD_CODE_GAP",
  RETRIEVAL_CARD_CODE_GAP: "RETRIEVAL_CARD_CODE_GAP",
  SELECTION_IDENTITY_DISCRIMINATOR: "SELECTION_IDENTITY_DISCRIMINATOR"
});

const allowedIdentityCriticalReasons = new Set(Object.values(secondLookIdentityCriticalReasons));
const cardCodeFields = Object.freeze([
  "tcg_card_number",
  "checklist_code",
  "collector_number",
  "card_number"
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "" && cleanText(value).toUpperCase() !== "UNKNOWN";
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function imageRole(image = {}) {
  const metadata = object(image.cropMetadata || image.crop_metadata);
  return cleanText(
    image.storageRole
    || image.storage_role
    || image.role
    || image.capture_role
    || image.captureRole
    || metadata.crop_role
    || metadata.role
  ).toLowerCase();
}

function canonicalSha256(value) {
  const normalized = cleanText(value).toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function imageIdentity(image = {}) {
  const metadata = object(image.cropMetadata || image.crop_metadata);
  const sources = [
    ["IMAGE_GENERATION_SHA256", image.image_generation_hash || image.imageGenerationHash],
    ["CONTENT_SHA256", image.content_sha256 || image.contentSha256],
    ["IMAGE_SHA256", image.image_sha256 || image.imageSha256 || image.sha256],
    ["SOURCE_CONTENT_SHA256", metadata.source_content_sha256 || metadata.sourceContentSha256],
    ["CROP_CONTENT_SHA256", metadata.content_sha256 || metadata.contentSha256]
  ];
  for (const [source, value] of sources) {
    const identitySha256 = canonicalSha256(value);
    if (identitySha256) return { identity_sha256: identitySha256, identity_source: source };
  }
  return { identity_sha256: null, identity_source: null };
}

function imageManifest(images = []) {
  return array(images).map((image) => ({
    ...imageIdentity(image),
    role: imageRole(image) || "unknown"
  }));
}

function evidenceState(evidence = {}, fieldName = "") {
  const field = object(object(evidence)[fieldName]);
  const status = cleanText(field.status).toUpperCase();
  const candidates = array(field.candidates);
  if (valuePresent(field.value) || candidates.some((candidate) => valuePresent(candidate?.value))) return "VALUE";
  if (status === "CONFLICT" || array(field.conflicts).length) return "CONFLICT";
  if (["MISSING", "NOT_APPLICABLE"].includes(status)) return "EMPTY";
  return "UNTRACED";
}

function normalizedFieldState(value) {
  const status = cleanText(value).toUpperCase();
  return ["VALUE", "EMPTY", "UNKNOWN", "CONFLICT"].includes(status) ? status : "UNTRACED";
}

function codeFieldStates({ resolved = {}, evidence = {}, fieldStates = {}, unresolved = [] } = {}) {
  const unresolvedSet = new Set(array(unresolved).map((field) => cleanText(field).toLowerCase()).filter(Boolean));
  return Object.fromEntries(cardCodeFields.map((field) => {
    if (valuePresent(object(resolved)[field])) return [field, "VALUE"];
    const fromEvidence = evidenceState(evidence, field);
    if (fromEvidence !== "UNTRACED") return [field, fromEvidence];
    const explicit = normalizedFieldState(object(fieldStates)[field]);
    if (explicit !== "UNTRACED") return [field, explicit];
    if (unresolvedSet.has(field)) return [field, "UNKNOWN"];
    return [field, "UNTRACED"];
  }));
}

function freezePlan(plan) {
  Object.values(plan).forEach((value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) Object.freeze(value);
  });
  return Object.freeze(plan);
}

function skipped(reason, replayInput, extra = {}) {
  return freezePlan({
    ...secondLookPlannerContract,
    should_run: false,
    decision_status: "INELIGIBLE",
    reason_code: reason,
    target_fields: Object.freeze([]),
    required_targets: Object.freeze([]),
    input_hash: sha256({
      policy_version: secondLookPlannerContract.policy_version,
      replay_input: replayInput
    }),
    replay_input: Object.freeze(replayInput),
    ...extra
  });
}

export function planSecondLookCardCode({
  resolved = {},
  evidence = {},
  fieldStates = {},
  unresolved = [],
  images = [],
  evaluationEnabled = false,
  identityCriticalReason = ""
} = {}) {
  const manifest = imageManifest(images);
  const states = codeFieldStates({ resolved, evidence, fieldStates, unresolved });
  const grammar = semGrammarForResolved(resolved);
  const explicitReason = cleanText(identityCriticalReason).toUpperCase();
  const acceptedIdentityReason = allowedIdentityCriticalReasons.has(explicitReason) ? explicitReason : null;
  const replayInput = Object.freeze({
    grammar,
    code_field_states: Object.freeze(states),
    image_manifest: Object.freeze(manifest),
    identity_critical_reason: acceptedIdentityReason
  });

  if (evaluationEnabled !== true) return skipped("EVALUATION_PROFILE_REQUIRED", replayInput);
  if (!manifest.length || manifest.some((image) => !image.identity_sha256)) {
    return skipped("IMMUTABLE_IMAGE_IDENTITY_REQUIRED", replayInput);
  }
  const hasCardCodeCrop = manifest.some((image) => image.role === "card_code_crop");
  const hasBack = manifest.some((image) => /(?:^|[_-])back(?:$|[_-])/.test(image.role) || image.role === "back_original");
  if (!hasCardCodeCrop && !hasBack) return skipped("CARD_CODE_IMAGE_REGION_UNAVAILABLE", replayInput);
  if (Object.values(states).includes("VALUE")) return skipped("CARD_CODE_ALREADY_OBSERVED", replayInput);
  if (Object.values(states).includes("CONFLICT")) return skipped("CARD_CODE_CONFLICT_NOT_SECOND_LOOK_GAP", replayInput);
  if (!Object.values(states).includes("UNKNOWN")) return skipped("CARD_CODE_UNKNOWN_STATE_NOT_PROVEN", replayInput);

  const eligibilityClass = grammar === "TCG"
    ? "TCG_CODE"
    : acceptedIdentityReason
      ? "IDENTITY_CRITICAL_CARD_CODE"
      : null;
  if (!eligibilityClass) return skipped("LOW_VALUE_STANDARD_CARD_NUMBER", replayInput);

  return freezePlan({
    ...secondLookPlannerContract,
    should_run: true,
    decision_status: "ELIGIBLE",
    reason_code: grammar === "TCG" ? "TCG_CARD_CODE_UNKNOWN" : acceptedIdentityReason,
    eligibility_class: eligibilityClass,
    target_fields: Object.freeze(["card_number_or_code"]),
    required_targets: Object.freeze(["card_number_or_code"]),
    image_policy: hasCardCodeCrop ? "RELEVANT_CROPS_ONLY" : "PRIMARY_PLUS_RELEVANT_CROPS_ONLY",
    max_paid_calls: 1,
    timeout_ms: 3_500,
    input_hash: sha256({
      policy_version: secondLookPlannerContract.policy_version,
      replay_input: replayInput
    }),
    replay_input: replayInput
  });
}

export function secondLookPlanInputHash(plan = {}) {
  return sha256({
    policy_version: secondLookPlannerContract.policy_version,
    replay_input: object(plan.replay_input)
  });
}

export const __secondLookPlannerTestHooks = Object.freeze({
  cardCodeFields,
  codeFieldStates,
  imageManifest,
  stableJson
});
