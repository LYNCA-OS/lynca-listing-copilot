export const recognitionRequestContractVersion = "recognition-request-v1";

export const recognitionProfileIds = Object.freeze({
  WRITER_ASSISTED: "writer-assisted-v1",
  WRITER_ASSISTED_EVALUATION: "writer-assisted-evaluation-v1",
  WRITER_ASSISTED_FAST_V5: "writer-assisted-fast-v5",
  ACCURACY_CEILING_ORACLE: "accuracy-ceiling-oracle-v1"
});

export const defaultRecognitionProfileId = recognitionProfileIds.WRITER_ASSISTED;

export const clientForbiddenAlgorithmControlKeys = Object.freeze([
  "provider", "provider_id", "providerId",
  "vision_provider", "visionProvider",
  "provider_options", "providerOptions",
  "explicit_emergency", "explicitEmergency",
  "model", "model_id", "modelId",
  "force_l2_only", "forceL2Only",
  "create_l1_job", "createL1Job",
  "create_l2_job", "createL2Job",
  "disable_fast_scout_l1", "disableFastScoutL1",
  "v4_force_l2_direct", "v4ForceL2Direct",
  "v4_queue_l1_only", "v4QueueL1Only"
]);

const knownRecognitionProfiles = new Set(Object.values(recognitionProfileIds));

function cleanText(value) {
  return String(value ?? "").trim();
}

export class RecognitionRequestContractError extends Error {
  constructor(code, { statusCode = 400 } = {}) {
    super(code);
    this.name = "RecognitionRequestContractError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function recognitionProfileIdFromPayload(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return cleanText(
    value.recognition_profile
    || value.recognitionProfile
  );
}

export function normalizeRecognitionProfileId(value, fallback = defaultRecognitionProfileId) {
  const profileId = cleanText(value || fallback).toLowerCase();
  if (!knownRecognitionProfiles.has(profileId)) {
    throw new RecognitionRequestContractError("unsupported_recognition_profile");
  }
  return profileId;
}

export function stripClientAlgorithmControls(value = {}) {
  const scoped = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
  for (const key of clientForbiddenAlgorithmControlKeys) delete scoped[key];
  return scoped;
}

export function withRecognitionRequestIntent(value = {}, {
  profileId = recognitionProfileIdFromPayload(value) || defaultRecognitionProfileId
} = {}) {
  const scoped = stripClientAlgorithmControls(value);
  return {
    ...scoped,
    recognition_contract_version: recognitionRequestContractVersion,
    recognition_profile: normalizeRecognitionProfileId(profileId)
  };
}
