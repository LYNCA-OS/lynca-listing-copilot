import crypto from "node:crypto";

export const regionEvidenceSchemaVersion = "region-evidence-v1";
export const regionEvidenceAdapterVersion = "region-evidence-adapter-v1";
export const regionEvidenceProvenanceVersion = "region-evidence-provenance-v1";

export const regionEvidenceStates = Object.freeze({
  VALUE: "VALUE",
  EMPTY: "EMPTY",
  UNKNOWN: "UNKNOWN",
  CONFLICT: "CONFLICT"
});

const stateValues = new Set(Object.values(regionEvidenceStates));
const emptyStatuses = new Set(["EMPTY", "MISSING", "NO_TEXT", "NOT_APPLICABLE"]);
const unknownStatuses = new Set(["UNKNOWN", "FAILED", "ERROR", "UNAVAILABLE"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function textOrNull(value) {
  const valueText = cleanText(value);
  return valueText || null;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function confidenceOrNull(value) {
  const number = finiteOrNull(value);
  return number === null ? null : Math.max(0, Math.min(1, number));
}

function plainClone(value) {
  if (value === null || value === undefined) return null;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }
}

function firstText(...values) {
  for (const value of values) {
    const normalized = textOrNull(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizedStatus(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function stateForRecord(record = {}, { text = null, value = null } = {}) {
  const status = normalizedStatus(record.state || record.status || record.worker_status || record.workerStatus);
  const conflicts = Array.isArray(record.conflicts) ? record.conflicts : [];
  if (status === regionEvidenceStates.CONFLICT || record.conflict === true || conflicts.length) {
    return regionEvidenceStates.CONFLICT;
  }
  if (emptyStatuses.has(status)) return regionEvidenceStates.EMPTY;
  if (unknownStatuses.has(status) || record.error) return regionEvidenceStates.UNKNOWN;
  if (textOrNull(text) || textOrNull(value)) return regionEvidenceStates.VALUE;
  return regionEvidenceStates.UNKNOWN;
}

function candidateText(candidate) {
  if (typeof candidate === "string") return textOrNull(candidate);
  if (!candidate || typeof candidate !== "object") return null;
  return firstText(
    candidate.text,
    candidate.description,
    candidate.raw_text,
    candidate.rawText,
    candidate.value,
    candidate.label,
    candidate.transcription
  );
}

function candidateBox(candidate = {}) {
  if (!candidate || typeof candidate !== "object") return null;
  return plainClone(
    candidate.bbox
    ?? candidate.box
    ?? candidate.bounding_box
    ?? candidate.boundingBox
    ?? candidate.bounding_poly
    ?? candidate.boundingPoly
    ?? candidate.vertices
    ?? candidate.points
    ?? candidate.polygon
  );
}

function candidateArrays(payload = {}) {
  const arrays = [
    payload.lines,
    payload.text_candidates,
    payload.textCandidates,
    payload.candidates,
    payload.boxes
  ].filter(Array.isArray);
  return arrays.find((entries) => entries.length) || arrays[0] || [];
}

function revision(value) {
  return textOrNull(value) || "UNVERSIONED";
}

function firstRevision(...values) {
  for (const value of values) {
    const normalized = textOrNull(value);
    if (normalized && normalized !== "UNVERSIONED") return normalized;
  }
  return "UNVERSIONED";
}

function contextFor(input = {}, context = {}, sourceKind = "UNKNOWN") {
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const provenance = input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance)
    ? input.provenance
    : {};
  const sourceType = normalizedStatus(input.source_type || input.sourceType || context.sourceType);
  const provider = firstText(
    context.provider,
    input.provider,
    input.vision_provider,
    input.visionProvider,
    input.ocr_backend,
    provenance.provider,
    sourceKind === "CLOUD_VISION" ? "google_vision" : sourceType === "OCR" ? "ocr" : null
  );
  const model = firstText(context.model, input.model, input.model_id, input.modelId, provenance.model, provider);
  return {
    image_sha256: firstText(
      context.imageSha256,
      context.image_sha256,
      input.image_sha256,
      input.imageSha256,
      input.content_sha256,
      input.contentSha256,
      metadata.image_sha256,
      provenance.image_sha256
    ),
    image_generation_id: firstText(
      context.imageGenerationId,
      context.image_generation_id,
      input.image_generation_id,
      input.imageGenerationId,
      metadata.image_generation_id,
      provenance.image_generation_id
    ),
    side: firstText(
      context.side,
      input.side,
      input.source_side,
      input.sourceSide,
      metadata.source_side,
      provenance.source_side
    ),
    region: firstText(
      context.region,
      input.region,
      input.source_region,
      input.sourceRegion,
      metadata.source_region,
      provenance.source_region,
      input.crop_type,
      input.cropType
    ),
    crop_id: firstText(
      context.cropId,
      context.crop_id,
      input.crop_id,
      input.cropId,
      metadata.crop_id,
      provenance.crop_id
    ),
    crop_role: firstText(
      context.cropRole,
      context.crop_role,
      input.crop_role,
      input.cropRole,
      input.crop_type,
      input.cropType,
      metadata.crop_role,
      provenance.crop_type
    ),
    crop_box: plainClone(
      context.cropBox
      ?? context.crop_box
      ?? input.crop_box
      ?? input.cropBox
      ?? metadata.pixel_bounds
      ?? metadata.normalized_bounds
      ?? provenance.crop_box
    ),
    sensor: firstText(context.sensor, input.sensor, provenance.sensor, sourceType === "OCR" ? "OCR" : "VISION_OCR"),
    sensor_revision: firstRevision(context.sensorRevision, context.sensor_revision, input.sensor_revision, provenance.sensor_revision),
    provider,
    provider_revision: firstRevision(context.providerRevision, context.provider_revision, input.provider_revision, provenance.provider_revision),
    model,
    model_revision: firstRevision(context.modelRevision, context.model_revision, input.model_revision, input.modelRevision, provenance.model_revision),
    producer: firstText(context.producer, input.producer, input.generated_by, provenance.generated_by, sourceKind.toLowerCase()),
    producer_revision: firstRevision(
      context.producerRevision,
      context.producer_revision,
      input.producer_revision,
      provenance.producer_revision,
      input.schema_version
    )
  };
}

function conflictingValues(record = {}) {
  const direct = Array.isArray(record.conflicting_values) ? record.conflicting_values : [];
  const nested = (Array.isArray(record.conflicts) ? record.conflicts : []).flatMap((conflict) => (
    Array.isArray(conflict?.conflicting_values) ? conflict.conflicting_values : []
  ));
  return [...new Set([...direct, ...nested].map(textOrNull).filter(Boolean))];
}

function evidenceId(entry = {}, sourceIndex = 0) {
  const fingerprint = JSON.stringify({
    schema_version: regionEvidenceSchemaVersion,
    image_sha256: entry.image_sha256,
    image_generation_id: entry.image_generation_id,
    side: entry.side,
    region: entry.region,
    crop_id: entry.crop_id,
    line_id: entry.line_id,
    field: entry.field,
    text: entry.text,
    value: entry.value,
    state: entry.state,
    source_index: sourceIndex
  });
  return `region_evidence_${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
}

function buildEvidence(record = {}, candidate = null, {
  context = {},
  sourceKind = "UNKNOWN",
  sourceContract = "unknown",
  sourceIndex = 0,
  lineId = null
} = {}) {
  const sourceContext = contextFor(record, context, sourceKind);
  const candidateRecord = candidate && typeof candidate === "object" ? candidate : {};
  const observedText = candidateText(candidate) || firstText(record.raw_text, record.rawText, record.text);
  const semanticValue = record.value ?? record.normalized_value ?? record.normalizedValue ?? observedText;
  const state = stateForRecord(record, { text: observedText, value: semanticValue });
  const bbox = candidateBox(candidateRecord) || candidateBox(record);
  const missingProvenance = [
    ["image_sha256", sourceContext.image_sha256],
    ["image_generation_id", sourceContext.image_generation_id],
    ["sensor_revision", sourceContext.sensor_revision !== "UNVERSIONED"],
    ["provider_revision", sourceContext.provider_revision !== "UNVERSIONED"],
    ["model_revision", sourceContext.model_revision !== "UNVERSIONED"],
    ["producer_revision", sourceContext.producer_revision !== "UNVERSIONED"]
  ].filter(([, present]) => !present).map(([name]) => name);
  const entry = {
    evidence_version: regionEvidenceSchemaVersion,
    adapter_version: regionEvidenceAdapterVersion,
    state,
    field: firstText(record.field, record.evidence_field),
    value: state === regionEvidenceStates.VALUE ? plainClone(semanticValue) : null,
    conflict_values: state === regionEvidenceStates.CONFLICT ? conflictingValues(record) : [],
    side: sourceContext.side,
    region: sourceContext.region,
    crop_id: sourceContext.crop_id,
    crop_role: sourceContext.crop_role,
    crop_box: sourceContext.crop_box,
    line_id: firstText(
      candidateRecord.line_id,
      candidateRecord.lineId,
      candidateRecord.id,
      lineId,
      record.line_id,
      record.lineId
    ),
    bbox,
    text: state === regionEvidenceStates.EMPTY ? "" : observedText,
    confidence: confidenceOrNull(candidateRecord.confidence ?? candidateRecord.score ?? record.confidence),
    image_sha256: sourceContext.image_sha256,
    image_generation_id: sourceContext.image_generation_id,
    sensor: sourceContext.sensor,
    sensor_revision: sourceContext.sensor_revision,
    provider: sourceContext.provider,
    provider_revision: sourceContext.provider_revision,
    model: sourceContext.model,
    model_revision: sourceContext.model_revision,
    producer: sourceContext.producer,
    producer_revision: sourceContext.producer_revision,
    provenance: {
      provenance_version: regionEvidenceProvenanceVersion,
      adapter_version: regionEvidenceAdapterVersion,
      source_kind: sourceKind,
      source_contract: revision(sourceContract),
      source_schema_version: revision(record.schema_version),
      source_index: sourceIndex,
      source_record_id: firstText(record.patch_id, record.patchId, record.request_id, record.requestId),
      source_job_key: firstText(record.job_key, record.provenance?.job_key),
      source_status: firstText(record.state, record.status, record.worker_status, record.workerStatus),
      source_error: firstText(record.error?.message, record.error?.code, record.error),
      producer_revision: sourceContext.producer_revision,
      complete: missingProvenance.length === 0,
      missing: missingProvenance
    }
  };
  return { ...entry, evidence_id: evidenceId(entry, sourceIndex) };
}

function document(evidence = [], sourceKind = "UNKNOWN") {
  const output = {
    schema_version: regionEvidenceSchemaVersion,
    adapter_version: regionEvidenceAdapterVersion,
    source_kind: sourceKind,
    evidence,
    policy: {
      can_generate_title: false,
      can_resolve_identity: false,
      can_override_resolver: false
    }
  };
  assertValidRegionEvidenceDocument(output);
  return output;
}

function googleVisionCandidates(response = {}) {
  const direct = candidateArrays(response);
  if (direct.length) return direct;
  const annotations = Array.isArray(response.textAnnotations || response.text_annotations)
    ? response.textAnnotations || response.text_annotations
    : [];
  if (annotations.length > 1) return annotations.slice(1);

  const pages = response.fullTextAnnotation?.pages || response.full_text_annotation?.pages || [];
  const words = pages.flatMap((page, pageIndex) => (page.blocks || []).flatMap((block, blockIndex) => (
    (block.paragraphs || []).flatMap((paragraph, paragraphIndex) => (
      (paragraph.words || []).map((word, wordIndex) => ({
        text: (word.symbols || []).map((symbol) => symbol.text || "").join(""),
        confidence: word.confidence ?? paragraph.confidence ?? block.confidence ?? page.confidence,
        bbox: word.boundingBox || word.bounding_box || null,
        line_id: `page_${pageIndex}:block_${blockIndex}:paragraph_${paragraphIndex}:word_${wordIndex}`
      }))
    ))
  )));
  if (words.length) return words;
  const aggregate = firstText(
    response.raw_text,
    response.rawText,
    response.text,
    response.fullTextAnnotation?.text,
    response.full_text_annotation?.text
  );
  return aggregate ? [{ text: aggregate, source_kind: "raw_aggregate" }] : [];
}

function ocrSourceKind(input = {}, context = {}) {
  const declared = normalizedStatus(context.sourceKind || context.source_kind);
  if (declared) return declared;
  const backend = cleanText(
    input.ocr_backend
    || input.backend
    || input.vision_provider
    || input.provider
    || context.provider
  ).toLowerCase();
  return backend.includes("google") && backend.includes("vision") ? "CLOUD_VISION" : "OCR";
}

export function adaptOcrRegionEvidence(input = {}, context = {}) {
  const sourceKind = ocrSourceKind(input, context);
  const responses = Array.isArray(input.responses) ? input.responses : [input];
  const evidence = [];
  responses.forEach((response, responseIndex) => {
    const inheritedContext = contextFor(input, context, sourceKind);
    const responseContext = { ...inheritedContext, ...context };
    const candidates = googleVisionCandidates(response);
    if (response.error) {
      evidence.push(buildEvidence({ ...response, status: "UNKNOWN" }, null, {
        context: responseContext,
        sourceKind,
        sourceContract: input.schema_version || (sourceKind === "CLOUD_VISION" ? "google-cloud-vision" : "ocr-response"),
        sourceIndex: responseIndex,
        lineId: `response_${responseIndex}`
      }));
      return;
    }
    if (!candidates.length) {
      evidence.push(buildEvidence({ ...response, status: "EMPTY" }, null, {
        context: responseContext,
        sourceKind,
        sourceContract: input.schema_version || (sourceKind === "CLOUD_VISION" ? "google-cloud-vision" : "ocr-response"),
        sourceIndex: responseIndex,
        lineId: `response_${responseIndex}`
      }));
      return;
    }
    candidates.forEach((candidate, candidateIndex) => {
      evidence.push(buildEvidence(response, candidate, {
        context: responseContext,
        sourceKind,
        sourceContract: input.schema_version || response.schema_version || (sourceKind === "CLOUD_VISION" ? "google-cloud-vision" : "ocr-response"),
        sourceIndex: responseIndex * 100000 + candidateIndex,
        lineId: `response_${responseIndex}:line_${candidateIndex}`
      }));
    });
  });
  return document(evidence, sourceKind);
}

export function adaptCloudVisionRegionEvidence(input = {}, context = {}) {
  return adaptOcrRegionEvidence(input, { ...context, sourceKind: "CLOUD_VISION" });
}

export function adaptPreingestionRegionEvidence(input = {}, context = {}) {
  const patches = Array.isArray(input)
    ? input
    : [
        ...(Array.isArray(input.evidence_patches) ? input.evidence_patches : []),
        ...Object.values(input.initial_evidence && typeof input.initial_evidence === "object" ? input.initial_evidence : {})
      ];
  const bundleContext = contextFor(input, {
    ...context,
    imageGenerationId: context.imageGenerationId || context.image_generation_id || input.image_generation_id
  }, "PREINGESTION");
  const bundleImages = [
    ...(Array.isArray(input.images) ? input.images : []),
    ...(Array.isArray(input.derived_images) ? input.derived_images : [])
  ];
  const bundleCrops = Array.isArray(input.crop_plan) ? input.crop_plan : [];
  const evidence = [];
  patches.forEach((patch, patchIndex) => {
    const sourceImageId = firstText(patch.source_image_id, patch.sourceImageId, patch.provenance?.source_image_id);
    const sourceImage = bundleImages.find((image) => firstText(
      image.image_id,
      image.imageId,
      image.derived_id,
      image.derivedId,
      image.id
    ) === sourceImageId) || {};
    const patchCropId = firstText(patch.crop_id, patch.cropId, patch.provenance?.crop_id);
    const sourceCrop = bundleCrops.find((crop) => firstText(
      crop.crop_id,
      crop.cropId,
      crop.crop_metadata?.crop_id
    ) === patchCropId) || {};
    const cropMetadata = sourceCrop.crop_metadata && typeof sourceCrop.crop_metadata === "object"
      ? sourceCrop.crop_metadata
      : {};
    const patchContext = {
      ...bundleContext,
      imageSha256: firstText(
        patch.image_sha256,
        patch.provenance?.image_sha256,
        sourceImage.content_sha256,
        sourceImage.contentSha256,
        bundleContext.image_sha256
      ),
      side: firstText(
        patch.side,
        patch.provenance?.source_side,
        cropMetadata.source_side,
        sourceImage.side,
        sourceImage.role,
        bundleContext.side
      ),
      region: firstText(
        patch.region,
        patch.provenance?.source_region,
        sourceCrop.source_region,
        cropMetadata.source_region,
        bundleContext.region
      ),
      cropId: patchCropId || bundleContext.crop_id,
      cropRole: firstText(
        patch.crop_role,
        patch.provenance?.crop_type,
        sourceCrop.role,
        cropMetadata.crop_role,
        bundleContext.crop_role
      ),
      cropBox: patch.crop_box
        ?? patch.provenance?.crop_box
        ?? cropMetadata.pixel_bounds
        ?? cropMetadata.normalized_bounds
        ?? bundleContext.crop_box
    };
    const candidates = candidateArrays(patch);
    if (!candidates.length) {
      evidence.push(buildEvidence(patch, null, {
        context: patchContext,
        sourceKind: "PREINGESTION",
        sourceContract: input.bundle_version || patch.schema_version || "preingestion-evidence-patch",
        sourceIndex: patchIndex,
        lineId: `patch_${patchIndex}`
      }));
      return;
    }
    candidates.forEach((candidate, candidateIndex) => {
      evidence.push(buildEvidence(patch, candidate, {
        context: patchContext,
        sourceKind: "PREINGESTION",
        sourceContract: input.bundle_version || patch.schema_version || "preingestion-evidence-patch",
        sourceIndex: patchIndex * 100000 + candidateIndex,
        lineId: `patch_${patchIndex}:line_${candidateIndex}`
      }));
    });
  });
  if (!patches.length) {
    const bundleStatus = normalizedStatus(input.worker_status || input.workerStatus || input.status);
    evidence.push(buildEvidence({
      status: emptyStatuses.has(bundleStatus) ? "EMPTY" : "UNKNOWN"
    }, null, {
      context: bundleContext,
      sourceKind: "PREINGESTION",
      sourceContract: input.bundle_version || "preingestion-bundle",
      sourceIndex: 0,
      lineId: "bundle"
    }));
  }
  return document(evidence, "PREINGESTION");
}

export function adaptRegionEvidence(input = {}, context = {}) {
  if (Array.isArray(input)
    || Array.isArray(input.evidence_patches)
    || input.initial_evidence
    || input.patch_id
    || input.evidence_field
    || input.provenance?.job_key) {
    return adaptPreingestionRegionEvidence(Array.isArray(input) ? input : {
      ...input,
      evidence_patches: Array.isArray(input.evidence_patches) ? input.evidence_patches : [input]
    }, context);
  }
  return adaptOcrRegionEvidence(input, context);
}

export function assertValidRegionEvidenceDocument(input = {}) {
  if (input.schema_version !== regionEvidenceSchemaVersion) {
    throw new Error("RegionEvidence schema_version is invalid.");
  }
  if (input.adapter_version !== regionEvidenceAdapterVersion || !Array.isArray(input.evidence)) {
    throw new Error("RegionEvidence adapter contract is invalid.");
  }
  for (const [index, entry] of input.evidence.entries()) {
    if (!stateValues.has(entry?.state)) throw new Error(`RegionEvidence evidence[${index}].state is invalid.`);
    if (entry.evidence_version !== regionEvidenceSchemaVersion || entry.adapter_version !== regionEvidenceAdapterVersion) {
      throw new Error(`RegionEvidence evidence[${index}] is unversioned.`);
    }
    if (!entry.provenance || entry.provenance.provenance_version !== regionEvidenceProvenanceVersion) {
      throw new Error(`RegionEvidence evidence[${index}].provenance is invalid.`);
    }
    if (!entry.producer_revision || !entry.sensor_revision || !entry.provider_revision || !entry.model_revision) {
      throw new Error(`RegionEvidence evidence[${index}] revision vector is incomplete.`);
    }
    if (entry.state === regionEvidenceStates.VALUE && entry.value === null && !entry.text) {
      throw new Error(`RegionEvidence evidence[${index}] VALUE has no observation.`);
    }
    if (entry.state !== regionEvidenceStates.VALUE && entry.value !== null) {
      throw new Error(`RegionEvidence evidence[${index}] non-VALUE cannot carry an applied value.`);
    }
  }
  return input;
}
