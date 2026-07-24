// Stable public browser-facing facade. Presentation code imports this module instead
// of reaching into recognition, storage, queue, or CSM implementation folders.
export {
  analyzeImageQualityFromImageData,
  defaultCaptureProfileId,
  summarizeAssetImageQuality
} from "../image-quality/quality-gate.mjs";
export { planTargetedCrops } from "../image-quality/crop-planner.mjs";
export { labelForCsmField } from "../csm/field-labels.mjs";
export {
  groupClientResultsByJobId,
  isClientStatusNotFound,
  observeClientJobPoll,
  queuedStatusPollDelay,
  shouldDeclareClientStatusOrphan
} from "../v4/jobs/client-poll-policy.mjs";
export { fetchWithBoundedRetry } from "./bounded-fetch.mjs";
export {
  startNonBlockingDerivedUpload,
  summarizeDerivedUploadOutcomes
} from "./upload-phases.mjs";
export { stripClientImageTransport } from "../v4/assets/asset-lifecycle-contract.mjs";
export {
  defaultRecognitionProfileId,
  withRecognitionRequestIntent
} from "../v4/contracts/recognition-request.mjs";
