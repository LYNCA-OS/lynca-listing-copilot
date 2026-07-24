// Stable browser-facing facade. Presentation code imports this module instead
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
  INTAKE_PREVIEW_CARD_WINDOW,
  claimNextBatchAsset,
  windowIntakePreviewGroups
} from "./batch-recognition-intent.mjs";
export {
  startNonBlockingDerivedUpload,
  summarizeDerivedUploadOutcomes
} from "./upload-phases.mjs";
export {
  SIGNED_UPLOAD_URL_GENERATION_LIMIT,
  WRITER_IMAGE_INTAKE_CONTRACT_VERSION,
  shouldRefreshSignedUpload
} from "./upload-recovery-policy.mjs";
export { stripClientImageTransport } from "../v4/assets/asset-lifecycle-contract.mjs";
export {
  defaultRecognitionProfileId,
  withRecognitionRequestIntent
} from "../v4/contracts/recognition-request.mjs";
