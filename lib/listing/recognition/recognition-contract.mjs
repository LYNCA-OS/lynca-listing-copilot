export const recognitionEndpointPath = "/v1/analyze-card-images";

export const recognitionImageRoles = Object.freeze([
  "front_original",
  "back_original",
  "front_alternate",
  "back_alternate",
  "serial_crop",
  "checklist_code_crop",
  "collector_number_crop",
  "grade_label_crop",
  "year_product_crop",
  "surface_view",
  "additional"
]);

export const recognitionRequestedFields = Object.freeze([
  "subject",
  "year_product",
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade_label",
  "back_text",
  "parallel",
  "card_type",
  "multi_card",
  "card_count"
]);

export const recognitionPipelineVersion = "recognition-worker-contract-v1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validationError(path, message) {
  return { path, message };
}

export function validateRecognitionRequest(payload = {}) {
  const errors = [];

  if (!isPlainObject(payload)) return [validationError("payload", "Recognition request must be an object.")];
  if (!normalizeText(payload.asset_id)) errors.push(validationError("asset_id", "asset_id is required."));
  if (!Array.isArray(payload.images) || payload.images.length < 1) {
    errors.push(validationError("images", "At least one image is required."));
  } else {
    payload.images.forEach((image, index) => {
      if (!isPlainObject(image)) {
        errors.push(validationError(`images[${index}]`, "Image must be an object."));
        return;
      }
      if (!normalizeText(image.image_id)) errors.push(validationError(`images[${index}].image_id`, "image_id is required."));
      if (!recognitionImageRoles.includes(image.role)) errors.push(validationError(`images[${index}].role`, "Invalid image role."));
      if (!normalizeText(image.signed_url)) errors.push(validationError(`images[${index}].signed_url`, "signed_url is required."));
    });
  }

  if (payload.requested_fields !== undefined) {
    if (!Array.isArray(payload.requested_fields)) {
      errors.push(validationError("requested_fields", "requested_fields must be an array."));
    } else {
      payload.requested_fields.forEach((field, index) => {
        if (!recognitionRequestedFields.includes(field)) {
          errors.push(validationError(`requested_fields[${index}]`, "Unknown requested field."));
        }
      });
    }
  }

  if (payload.options !== undefined && !isPlainObject(payload.options)) {
    errors.push(validationError("options", "options must be an object."));
  }

  return errors;
}

export function validateRecognitionResponse(payload = {}) {
  const errors = [];

  if (!isPlainObject(payload)) return [validationError("payload", "Recognition response must be an object.")];
  if (!normalizeText(payload.asset_id)) errors.push(validationError("asset_id", "asset_id is required."));
  ["rectification", "image_quality", "processing"].forEach((field) => {
    if (!isPlainObject(payload[field])) errors.push(validationError(field, `${field} must be an object.`));
  });
  if (!Array.isArray(payload.regions)) errors.push(validationError("regions", "regions must be an array."));
  if (!isPlainObject(payload.ocr_evidence)) errors.push(validationError("ocr_evidence", "ocr_evidence must be an object."));
  if (!isPlainObject(payload.visual_features)) errors.push(validationError("visual_features", "visual_features must be an object."));
  if (payload.processing && !normalizeText(payload.processing.pipeline_version)) {
    errors.push(validationError("processing.pipeline_version", "pipeline_version is required."));
  }
  if (payload.processing && typeof payload.processing.latency_ms !== "number") {
    errors.push(validationError("processing.latency_ms", "latency_ms must be a number."));
  }

  return errors;
}

export function createUnavailableRecognitionResponse({
  assetId = "",
  reason = "recognition_worker_unavailable"
} = {}) {
  return {
    asset_id: assetId,
    unavailable: true,
    reason,
    rectification: {},
    image_quality: {},
    multi_card_detection: {},
    regions: [],
    ocr_evidence: {},
    visual_features: {},
    processing: {
      pipeline_version: recognitionPipelineVersion,
      model_versions: {},
      latency_ms: 0
    }
  };
}
