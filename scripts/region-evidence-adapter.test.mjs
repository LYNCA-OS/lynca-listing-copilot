import assert from "node:assert/strict";
import {
  adaptCloudVisionRegionEvidence,
  adaptOcrRegionEvidence,
  adaptPreingestionRegionEvidence,
  adaptRegionEvidence,
  assertValidRegionEvidenceDocument,
  regionEvidenceAdapterVersion,
  regionEvidenceSchemaVersion,
  regionEvidenceStates
} from "../lib/listing/evidence/region-evidence-adapter.mjs";

const imageSha256 = "a".repeat(64);
const sharedContext = {
  imageSha256,
  imageGenerationId: "generation-001",
  side: "back",
  region: "collector_number",
  cropId: "crop-code-1",
  cropRole: "card_code_crop",
  cropBox: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
  sensor: "VISION_OCR",
  sensorRevision: "vision-sensor-v3",
  provider: "google_vision",
  providerRevision: "images-annotate-v1",
  model: "document_text_detection",
  modelRevision: "builtin-2026-07",
  producer: "recognition-worker",
  producerRevision: "worker-sha-123"
};

// Direct Cloud Vision annotations retain the source polygon and explicit
// image/crop lineage. The first aggregate annotation is deliberately omitted.
const cloudInput = {
  responses: [{
    textAnnotations: [
      { description: "CARD NO. RS-2" },
      {
        description: "RS-2",
        confidence: 0.97,
        boundingPoly: {
          vertices: [{ x: 11, y: 22 }, { x: 61, y: 22 }, { x: 61, y: 42 }, { x: 11, y: 42 }]
        }
      }
    ]
  }]
};
const cloudSnapshot = structuredClone(cloudInput);
const cloud = adaptCloudVisionRegionEvidence(cloudInput, sharedContext);
assert.equal(cloud.schema_version, regionEvidenceSchemaVersion);
assert.equal(cloud.adapter_version, regionEvidenceAdapterVersion);
assert.deepEqual(cloudInput, cloudSnapshot, "adapter must not mutate Cloud Vision input");
assert.equal(cloud.evidence.length, 1);
assert.equal(cloud.evidence[0].state, regionEvidenceStates.VALUE);
assert.equal(cloud.evidence[0].text, "RS-2");
assert.equal(cloud.evidence[0].value, "RS-2");
assert.equal(cloud.evidence[0].side, "back");
assert.equal(cloud.evidence[0].region, "collector_number");
assert.equal(cloud.evidence[0].crop_id, "crop-code-1");
assert.deepEqual(cloud.evidence[0].crop_box, sharedContext.cropBox);
assert.deepEqual(cloud.evidence[0].bbox, cloudInput.responses[0].textAnnotations[1].boundingPoly);
assert.equal(cloud.evidence[0].line_id, "response_0:line_0");
assert.equal(cloud.evidence[0].image_sha256, imageSha256);
assert.equal(cloud.evidence[0].image_generation_id, "generation-001");
assert.equal(cloud.evidence[0].sensor_revision, "vision-sensor-v3");
assert.equal(cloud.evidence[0].provider_revision, "images-annotate-v1");
assert.equal(cloud.evidence[0].model_revision, "builtin-2026-07");
assert.equal(cloud.evidence[0].producer_revision, "worker-sha-123");
assert.equal(cloud.evidence[0].provenance.complete, true);
assertValidRegionEvidenceDocument(cloud);

const paddle = adaptOcrRegionEvidence({
  ocr_backend: "paddleocr",
  raw_text: "09/50",
  text_candidates: [{ text: "09/50", confidence: 0.94 }]
}, {
  ...sharedContext,
  provider: "paddleocr",
  model: "paddleocr"
});
assert.equal(paddle.source_kind, "OCR");
assert.equal(paddle.evidence[0].provenance.source_kind, "OCR");

// Existing preingestion patches retain semantic field, line geometry and the
// producer/job provenance that survives today's flattened bundle contract.
const preingestion = adaptPreingestionRegionEvidence({
  bundle_version: "preingestion-bundle-v1",
  image_generation_id: "generation-002",
  images: [{
    image_id: "image-back",
    role: "back_original",
    content_sha256: "b".repeat(64)
  }],
  crop_plan: [{
    role: "card_code_crop",
    source_region: "collector_number",
    crop_metadata: {
      crop_id: "crop-code-2",
      source_side: "back",
      normalized_bounds: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 }
    }
  }],
  evidence_patches: [{
    patch_id: "patch-card-code",
    field: "card_number",
    value: "RS-2",
    raw_text: "CARD NO. RS-2",
    text_candidates: [{
      value: "RS-2",
      confidence: 0.96,
      line_id: "vision-line-7",
      bbox: [11, 22, 61, 42]
    }],
    source_type: "OCR",
    source_image_id: "image-back",
    confidence: 0.9,
    provenance: {
      job_key: "ocr:ocr-crop-v21:bundle:card-code",
      source_side: "back",
      source_region: "collector_number",
      crop_id: "crop-code-2",
      crop_type: "card_code_crop",
      sensor_revision: "vision-sensor-v3",
      provider: "google_vision",
      provider_revision: "images-annotate-v1",
      model_revision: "builtin-2026-07",
      generated_by: "preingestion_ocr_worker",
      producer_revision: "ocr-crop-v21"
    }
  }]
}, {
  sensor: "VISION_OCR",
  model: "document_text_detection"
});
assert.equal(preingestion.evidence.length, 1);
assert.equal(preingestion.evidence[0].field, "card_number");
assert.equal(preingestion.evidence[0].value, "RS-2");
assert.equal(preingestion.evidence[0].text, "RS-2");
assert.equal(preingestion.evidence[0].line_id, "vision-line-7");
assert.deepEqual(preingestion.evidence[0].bbox, [11, 22, 61, 42]);
assert.equal(preingestion.evidence[0].image_sha256, "b".repeat(64));
assert.deepEqual(preingestion.evidence[0].crop_box, { x: 0.1, y: 0.7, width: 0.8, height: 0.2 });
assert.equal(preingestion.evidence[0].provenance.source_job_key, "ocr:ocr-crop-v21:bundle:card-code");
assert.equal(preingestion.evidence[0].provenance.complete, true);

// Sensor silence, sensor failure and explicit disagreement remain distinct.
const empty = adaptCloudVisionRegionEvidence({ responses: [{ textAnnotations: [] }] }, sharedContext);
assert.equal(empty.evidence[0].state, regionEvidenceStates.EMPTY);
assert.equal(empty.evidence[0].text, "");
assert.equal(empty.evidence[0].value, null);

const pendingBundle = adaptPreingestionRegionEvidence({
  status: "PENDING_WORKER",
  bundle_version: "preingestion-bundle-v1",
  image_generation_id: "generation-pending"
}, sharedContext);
assert.equal(pendingBundle.evidence[0].state, regionEvidenceStates.UNKNOWN);

const unknown = adaptCloudVisionRegionEvidence({
  responses: [{ error: { code: 8, message: "quota unavailable" } }]
}, sharedContext);
assert.equal(unknown.evidence[0].state, regionEvidenceStates.UNKNOWN);
assert.equal(unknown.evidence[0].value, null);
assert.equal(unknown.evidence[0].provenance.source_error, "quota unavailable");

const emptyLinesBeforeCandidates = adaptCloudVisionRegionEvidence({
  lines: [],
  text_candidates: [{ text: "PRIZM", confidence: 0.91 }]
}, sharedContext);
assert.equal(emptyLinesBeforeCandidates.evidence[0].state, regionEvidenceStates.VALUE);
assert.equal(emptyLinesBeforeCandidates.evidence[0].text, "PRIZM");

const conflict = adaptRegionEvidence({
  field: "card_number",
  status: "CONFLICT",
  source_type: "OCR",
  source_image_id: "image-back",
  conflicts: [{ conflicting_values: ["RS-2", "RS-Z"] }],
  provenance: {
    job_key: "ocr:ocr-crop-v21:bundle:conflict",
    source_side: "back",
    source_region: "collector_number",
    producer_revision: "ocr-crop-v21"
  }
}, sharedContext);
assert.equal(conflict.source_kind, "PREINGESTION");
assert.equal(conflict.evidence[0].state, regionEvidenceStates.CONFLICT);
assert.deepEqual(conflict.evidence[0].conflict_values, ["RS-2", "RS-Z"]);
assert.equal(conflict.evidence[0].value, null);

// Missing revisions are explicit trace debt rather than fabricated lineage.
const unversioned = adaptCloudVisionRegionEvidence({ raw_text: "VISIBLE" }, {
  imageSha256,
  imageGenerationId: "generation-003"
});
assert.equal(unversioned.evidence[0].state, regionEvidenceStates.VALUE);
assert.equal(unversioned.evidence[0].producer_revision, "UNVERSIONED");
assert.equal(unversioned.evidence[0].provenance.complete, false);
assert.ok(unversioned.evidence[0].provenance.missing.includes("producer_revision"));

for (const packet of [cloud, preingestion, empty, pendingBundle, unknown, emptyLinesBeforeCandidates, conflict, unversioned]) {
  assert.equal(packet.policy.can_generate_title, false);
  assert.equal(packet.policy.can_resolve_identity, false);
  assert.equal(packet.policy.can_override_resolver, false);
  assert.equal(JSON.stringify(packet).includes("generated_title"), false);
  assertValidRegionEvidenceDocument(packet);
}

console.log("region evidence adapter tests passed");
