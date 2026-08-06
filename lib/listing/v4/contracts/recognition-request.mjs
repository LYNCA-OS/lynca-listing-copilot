export const recognitionRequestContractVersion = "recognition-request-v1";

export const recognitionProfileIds = Object.freeze({
  WRITER_ASSISTED: "writer-assisted-v1"
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
  return stripClientAlgorithmControlsReporting(value).value;
}

/**
 * Strip the same keys, and say which ones were actually there.
 *
 * Stripping silently is what makes this dangerous. The request still succeeds,
 * the run still produces a score, and nothing anywhere says the controls were
 * discarded -- so an experiment that varies a stripped key measures the same
 * configuration twice and reports the difference as a finding.
 *
 * That is not hypothetical. A paired run set `--model gpt-5.6-luna` against a
 * preview that had no LAUNCH_GATE_EVAL_SECRET configured; `provider_options`
 * was dropped, every call went to the env-pinned gpt-5-mini-2025-08-07, and the
 * only trace of the requested model was in the client's own copy of what it had
 * asked for. The result looked like a clean measurement of a model switch and
 * contained no model switch.
 *
 * So the strip now reports. Callers that hold the authorization boundary are
 * expected to surface `removed` -- refusing the request is the wrong answer,
 * because unauthorized callers sending these keys is normal and the boundary
 * must hold, but the caller has to be able to find out that it held.
 */
export function stripClientAlgorithmControlsReporting(value = {}) {
  const scoped = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
  const removed = [];
  for (const key of clientForbiddenAlgorithmControlKeys) {
    if (Object.hasOwn(scoped, key)) removed.push(key);
    delete scoped[key];
  }
  return { value: scoped, removed };
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
