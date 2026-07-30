import crypto from "node:crypto";

import { outcomes } from "./constraint-enumerator.mjs";
import { deriveFields, summariseDerivation } from "./derive-fields.mjs";
import { candidatePreApplicationEvidenceSnapshotMatches } from "../candidates/candidate-selection-pass.mjs";
import {
  buildVerifiedCurrentImageManifest,
  matchStampedSourceToCurrentImageManifest
} from "../evidence/current-image-manifest.mjs";

export const forwardEnumerationAdapterVersion = "forward-enumeration-adapter-v6-out-of-band-authority";
export const forwardEnumerationIntegritySchemaVersion = "forward-enumeration-integrity-v2";
export const forwardEnumerationExperimentArms = Object.freeze({
  SHADOW: "SHADOW",
  CONSUME: "CONSUME"
});

export function forwardEnumerationExperimentArm(providerOptions = {}) {
  const requested = String(
    providerOptions.forward_enumeration_experiment_arm
    ?? providerOptions.forwardEnumerationExperimentArm
    ?? ""
  ).trim().toUpperCase();
  return requested === forwardEnumerationExperimentArms.CONSUME
    ? forwardEnumerationExperimentArms.CONSUME
    : forwardEnumerationExperimentArms.SHADOW;
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function contentSha256(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

const forwardEnumerationAuthorities = new Map();
const maxForwardEnumerationAuthorities = 2_048;

function immutableCopy(value) {
  return Object.freeze(structuredClone(value));
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function registerForwardEnumerationAuthority({
  observation,
  model,
  packet,
  currentImageManifest,
  candidateSnapshot = null
} = {}) {
  const authorityId = crypto.randomUUID();
  forwardEnumerationAuthorities.set(authorityId, Object.freeze({
    observation_claim: immutableCopy(observation.claim),
    observation_provenance: immutableCopy(observation.provenance),
    model,
    expected_packet: immutableCopy(packet),
    current_image_manifest: currentImageManifest,
    candidate_snapshot: candidateSnapshot ? immutableCopy(candidateSnapshot) : null,
    candidate_snapshot_content_sha256: cleanText(candidateSnapshot?.snapshot_content_sha256) || null
  }));
  if (forwardEnumerationAuthorities.size > maxForwardEnumerationAuthorities) {
    forwardEnumerationAuthorities.delete(forwardEnumerationAuthorities.keys().next().value);
  }
  return authorityId;
}

function comparableValues(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => cleanText(item).toLowerCase())
    .filter((item) => item && item !== "unknown")
    .sort();
}

function sameValue(left, right) {
  const leftValues = comparableValues(left);
  const rightValues = comparableValues(right);
  return leftValues.length > 0
    && leftValues.length === rightValues.length
    && leftValues.every((value, index) => value === rightValues[index]);
}

function textContainsValue(text, value) {
  const normalizedText = cleanText(text).toLowerCase();
  const expected = comparableValues(value);
  if (!normalizedText || !expected.length) return false;
  return expected.every((item) => {
    const escaped = item
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu")
      .test(normalizedText);
  });
}

function canonicalObservationSourceType(value) {
  const sourceType = cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (["CARD_FRONT", "CARD_FRONT_PRINTED_TEXT", "FRONT_PRINTED_TEXT"].includes(sourceType)) return "CARD_FRONT";
  if (["CARD_BACK", "CARD_BACK_PRINTED_TEXT", "BACK_PRINTED_TEXT"].includes(sourceType)) return "CARD_BACK";
  if (["OCR", "OCR_ONLY"].includes(sourceType)) return "OCR";
  if (["SLAB", "SLAB_LABEL", "GRADED_SLAB"].includes(sourceType)) return "SLAB_LABEL";
  if (["VISION_MODEL", "VISION_ONLY", "MODEL_VISUAL", "VISUAL", "VISUAL_GUESS"].includes(sourceType)) return "VISION_MODEL";
  return null;
}

function observationSourceProvenance(source = {}, value = null, allowlist = {}) {
  const sourceType = canonicalObservationSourceType(source.source_type || source.source);
  if (!sourceType) return null;
  if (sourceType === "VISION_MODEL"
    && source.direct_observation !== true
    && source.directly_observed !== true) return null;
  const sourceImageId = cleanText(source.source_image_id || source.image_id) || null;
  const sourceCropId = cleanText(source.source_crop_id || source.crop_id) || null;
  const sourceObjectPath = cleanText(
    source.source_object_path || source.object_path
  ) || null;
  // Never infer or backfill source identity here. Evidence Normalizer is the
  // only owner allowed to stamp a verified current-image manifest identity.
  const binding = matchStampedSourceToCurrentImageManifest(source, allowlist);
  if (!binding) return null;
  const sourceValue = source.normalized_value
    ?? source.value
    ?? source.observed_value
    ?? source.observed_text
    ?? source.visible_text
    ?? source.raw_text;
  if (!sameValue(sourceValue, value) && !textContainsValue(sourceValue, value)) return null;
  return Object.freeze({
    source_type: sourceType,
    source_image_id: sourceImageId,
    source_crop_id: sourceCropId,
    source_region: cleanText(source.source_region || source.region) || null,
    source_object_path: sourceObjectPath,
    source_content_sha256: cleanText(source.source_content_sha256).toLowerCase(),
    image_generation_id: cleanText(source.image_generation_id),
    asset_id: cleanText(source.asset_id),
    tenant_id: cleanText(source.tenant_id),
    current_image_manifest_fingerprint: cleanText(source.current_image_manifest_fingerprint),
    direct_observation: sourceType === "VISION_MODEL" ? true : null,
    crop_lineage: binding.crop_lineage || null
  });
}

function evidenceSupport(evidenceMap = {}, aliases = [], value = null, allowlist = {}) {
  for (const evidenceField of aliases) {
    const entry = object(evidenceMap[evidenceField]);
    const status = cleanText(entry.status).toUpperCase();
    if (["MISSING", "CONFLICT", "NOT_APPLICABLE"].includes(status)) continue;
    const entryValue = entry.normalized_value ?? entry.value;
    const matchingCandidates = (Array.isArray(entry.candidates) ? entry.candidates : [])
      .filter((candidate) => sameValue(candidate?.normalized_value ?? candidate?.value, value));
    const sources = sameValue(entryValue, value)
      ? [
          ...(Array.isArray(entry.sources) ? entry.sources : []),
          ...matchingCandidates.flatMap((candidate) => (
            Array.isArray(candidate?.sources) ? candidate.sources : []
          ))
        ]
      : matchingCandidates.flatMap((candidate) => (
          Array.isArray(candidate?.sources) ? candidate.sources : []
        ));
    const provenance = sources
      .map((source) => observationSourceProvenance(source, value, allowlist))
      .find(Boolean);
    if (provenance) return { evidence_field: evidenceField, provenance };
  }
  return null;
}

function providerEvidenceSupport(rows = [], aliases = [], value = null, allowlist = {}) {
  for (const row of rows) {
    const field = cleanText(row?.field || row?.field_name);
    if (!aliases.includes(field)) continue;
    if (!sameValue(row?.normalized_value ?? row?.value, value)) continue;
    const provenance = observationSourceProvenance(row, value, allowlist);
    if (provenance) return { evidence_field: field, provenance };
  }
  return null;
}

const observedClaimFields = Object.freeze([
  { claim: "year", raw: ["year"], evidence: ["year"] },
  { claim: "manufacturer", raw: ["manufacturer", "brand"], evidence: ["manufacturer", "brand"] },
  { claim: "sport", raw: ["ip_sport", "sport", "category"], evidence: ["ip_sport", "sport", "category"] },
  { claim: "players", raw: ["players", "subjects"], evidence: ["players", "subjects", "player", "subject", "character"] },
  { claim: "player", raw: ["player", "subject", "character"], evidence: ["players", "subjects", "player", "subject", "character"] },
  { claim: "set", raw: ["set", "subset", "insert"], evidence: ["set", "subset", "insert"] },
  { claim: "card_name", raw: ["card_name"], evidence: ["card_name"] }
]);

function observedClaim(result = {}, observationContext = {}) {
  const allowlist = buildVerifiedCurrentImageManifest(observationContext);
  const normalizedEvidence = object(result.normalized_evidence || result.evidence);
  const providerEvidence = Array.isArray(result.raw_provider_field_evidence)
    ? result.raw_provider_field_evidence
    : [];
  const layers = [
    {
      name: "RAW_OBSERVED_FIELDS",
      fields: object(result.raw_observed_fields),
      support: (aliases, value) => evidenceSupport(normalizedEvidence, aliases, value, allowlist)
    },
    {
      name: "RAW_PROVIDER_FIELDS",
      fields: object(result.raw_provider_fields),
      support: (aliases, value) => providerEvidenceSupport(providerEvidence, aliases, value, allowlist)
    }
  ];
  const claim = {};
  const provenance = [];
  const unproven = new Set();

  for (const spec of observedClaimFields) {
    if (spec.claim === "player" && present(claim.players)) continue;
    for (const layer of layers) {
      const rawField = spec.raw.find((field) => present(layer.fields[field]));
      if (!rawField) continue;
      const value = layer.fields[rawField];
      const support = layer.support(spec.evidence, value);
      if (!support) {
        unproven.add(spec.claim);
        continue;
      }
      claim[spec.claim] = value;
      provenance.push(Object.freeze({
        claim_field: spec.claim,
        observed_value: value,
        raw_field: rawField,
        evidence_field: support.evidence_field,
        input_layer: layer.name,
        ...support.provenance
      }));
      unproven.delete(spec.claim);
      break;
    }
  }

  return Object.freeze({
    claim: Object.freeze(claim),
    provenance: Object.freeze(provenance),
    unproven_fields: Object.freeze([...unproven].sort()),
    context_status: allowlist.status === "COMPLETE" ? "VERIFIED" : "UNKNOWN",
    context_reason: allowlist.reason_code
  });
}

function resultFromCandidateSnapshot(snapshot = {}) {
  return {
    raw_observed_fields: object(snapshot.raw_observed_fields),
    raw_provider_fields: object(snapshot.raw_provider_fields),
    normalized_evidence: object(snapshot.normalized_evidence),
    raw_provider_field_evidence: Array.isArray(snapshot.raw_provider_field_evidence)
      ? snapshot.raw_provider_field_evidence
      : []
  };
}

export function forwardEnumerationCandidatePacketForResult(
  result = {},
  model = null,
  { observationContext = {} } = {}
) {
  return deriveFields(
    observedClaim(result, observationContext).claim,
    model
  ).forward_enumeration_candidate_packet;
}

export function forwardEnumerationTraceForResult(
  result = {},
  model = null,
  { observationContext = {} } = {}
) {
  return forwardEnumerationCandidatePacketForResult(
    result,
    model,
    { observationContext }
  ).trace;
}

function identityEvidenceItems(packet = {}) {
  return packet.trace
    .filter((row) => row.status === outcomes.VALUE && present(row.value))
    .map((row) => ({
      field: row.field,
      value: row.value,
      source: "STRUCTURED_DATABASE",
      confidence: 0.72,
      metadata: {
        candidate_id: packet.candidates.find((candidate) => candidate.derived_field === row.field)?.id || null,
        retrieval_application_decision: "SUPPORT",
        retrieval_application_reason: "forward_constraint_value_candidate",
        candidate_is_evidence_not_truth: true,
        derived_fact_status: row.status,
        derived_fact_candidates: row.candidates,
        provenance: row.provenance,
        adapter_version: forwardEnumerationAdapterVersion
      }
    }));
}

function forwardEnumerationIntegrity({
  packet = {},
  observationProvenance = [],
  evidenceItems = [],
  currentImageManifest = {},
  authorityId = null
} = {}) {
  const payload = {
    adapter_version: forwardEnumerationAdapterVersion,
    authority_id: authorityId,
    observation_manifest_fingerprint: currentImageManifest.image_set_fingerprint || null,
    observation_provenance: observationProvenance,
    candidate_packet: packet,
    identity_evidence_items: evidenceItems
  };
  return Object.freeze({
    schema_version: forwardEnumerationIntegritySchemaVersion,
    adapter_version: forwardEnumerationAdapterVersion,
    authority_id: authorityId,
    observation_manifest_fingerprint: payload.observation_manifest_fingerprint,
    packet_content_sha256: contentSha256(payload)
  });
}

function validConstraintTrace(packet = {}) {
  if (!cleanText(packet.schema_version)
    || !cleanText(packet.enumerator_version)
    || !Array.isArray(packet.candidates)
    || !Array.isArray(packet.evidence)
    || !Array.isArray(packet.trace)) return false;
  return packet.trace.every((row) => {
    if (!row || !Object.values(outcomes).includes(row.status) || !cleanText(row.field)) return false;
    const provenance = object(row.provenance);
    if (!cleanText(provenance.source)
      || !cleanText(provenance.trust)
      || !cleanText(provenance.version)
      || !cleanText(provenance.rule_id)) return false;
    if (row.status === outcomes.VALUE) {
      return present(row.value)
        && Array.isArray(row.candidates)
        && row.candidates.some((candidate) => sameValue(candidate, row.value));
    }
    if (row.status === outcomes.EMPTY) return !present(row.value);
    return true;
  });
}

function validateForwardEnumerationApplication(result = {}) {
  const forward = object(result.retrieval_application);
  const manifest = buildVerifiedCurrentImageManifest(result.current_image_context);
  if (manifest.status !== "COMPLETE") return { valid: false, reason: "CURRENT_IMAGE_CONTEXT_INVALID" };
  const integrity = object(forward.forward_enumeration_integrity);
  const authority = forwardEnumerationAuthorities.get(cleanText(integrity.authority_id));
  if (!authority) return { valid: false, reason: "OUT_OF_BAND_AUTHORITY_UNAVAILABLE" };
  if (!sameCanonicalValue(manifest, authority.current_image_manifest)) {
    return { valid: false, reason: "OUT_OF_BAND_CURRENT_IMAGE_CONTEXT_MISMATCH" };
  }
  if (authority.candidate_snapshot) {
    const snapshot = object(result.candidate_pre_application_evidence_snapshot);
    const snapshotValidation = candidatePreApplicationEvidenceSnapshotMatches(
      snapshot,
      authority.current_image_manifest
    );
    if (!snapshotValidation.valid
      || snapshotValidation.snapshot_content_sha256 !== authority.candidate_snapshot_content_sha256
      || !sameCanonicalValue(snapshot, authority.candidate_snapshot)) {
      return { valid: false, reason: "OUT_OF_BAND_CANDIDATE_SNAPSHOT_MISMATCH" };
    }
  }
  const packet = object(result.forward_enumeration_candidate_packet);
  if (!validConstraintTrace(packet)) return { valid: false, reason: "CANDIDATE_PACKET_INVALID" };
  const expectedPacket = deriveFields(
    authority.observation_claim,
    authority.model
  ).forward_enumeration_candidate_packet;
  if (!sameCanonicalValue(expectedPacket, authority.expected_packet)
    || !sameCanonicalValue(packet, authority.expected_packet)) {
    return { valid: false, reason: "CANDIDATE_PACKET_AUTHORITY_MISMATCH" };
  }
  const provenance = Array.isArray(result.forward_enumeration_observation_provenance)
    ? result.forward_enumeration_observation_provenance
    : [];
  if (!provenance.length || !provenance.every((row) => (
    observationSourceProvenance(row, row.observed_value, manifest)
  ))) return { valid: false, reason: "OBSERVATION_PROVENANCE_INVALID" };
  if (!sameCanonicalValue(provenance, authority.observation_provenance)) {
    return { valid: false, reason: "OBSERVATION_PROVENANCE_AUTHORITY_MISMATCH" };
  }
  const expectedItems = identityEvidenceItems(packet);
  const storedItems = Array.isArray(forward.forward_enumeration_identity_evidence_items)
    ? forward.forward_enumeration_identity_evidence_items
    : [];
  if (JSON.stringify(canonical(storedItems)) !== JSON.stringify(canonical(expectedItems))) {
    return { valid: false, reason: "IDENTITY_EVIDENCE_CONTENT_MISMATCH" };
  }
  const expectedIntegrity = forwardEnumerationIntegrity({
    packet,
    observationProvenance: provenance,
    evidenceItems: expectedItems,
    currentImageManifest: manifest,
    authorityId: integrity.authority_id
  });
  if (integrity.schema_version !== expectedIntegrity.schema_version
    || integrity.adapter_version !== expectedIntegrity.adapter_version
    || integrity.observation_manifest_fingerprint !== expectedIntegrity.observation_manifest_fingerprint
    || integrity.packet_content_sha256 !== expectedIntegrity.packet_content_sha256) {
    return { valid: false, reason: "PACKET_CONTENT_HASH_MISMATCH" };
  }
  return { valid: true, reason: null, items: expectedItems };
}

// Shadow is the default and changes no resolver input. Active mode is intended
// only for deterministic replay/canary: it adds evidence to the existing
// application packet and still leaves the final choice to Identity Resolver.
export function attachForwardEnumerationCandidates(
  result = {},
  model = null,
  { shadow = true, observationContext = {} } = {}
) {
  const currentImageManifest = buildVerifiedCurrentImageManifest(observationContext);
  const candidateSnapshot = object(result.candidate_pre_application_evidence_snapshot);
  const candidateSnapshotValidation = candidatePreApplicationEvidenceSnapshotMatches(
    candidateSnapshot,
    currentImageManifest
  );
  const observation = observedClaim(
    Object.keys(candidateSnapshot).length
      ? candidateSnapshotValidation.valid
        ? resultFromCandidateSnapshot(candidateSnapshot)
        : {}
      : result,
    observationContext
  );
  const derivedFieldsPacket = deriveFields(observation.claim, model);
  const packet = derivedFieldsPacket.forward_enumeration_candidate_packet;
  const evidenceItems = identityEvidenceItems(packet);
  const authorityId = registerForwardEnumerationAuthority({
    observation,
    model,
    packet,
    currentImageManifest,
    candidateSnapshot: candidateSnapshotValidation.valid ? candidateSnapshot : null
  });
  const integrity = forwardEnumerationIntegrity({
    packet,
    observationProvenance: observation.provenance,
    evidenceItems,
    currentImageManifest,
    authorityId
  });
  const patch = {
    ...result,
    current_image_context: currentImageManifest.status === "COMPLETE"
      ? currentImageManifest
      : result.current_image_context || null,
    derived_fields_packet: derivedFieldsPacket,
    derived_fields_summary: summariseDerivation([derivedFieldsPacket]),
    forward_enumeration_observation_provenance: observation.provenance,
    forward_enumeration_unproven_observation_fields: observation.unproven_fields,
    forward_enumeration_candidate_packet: packet,
    forward_enumeration_trace: packet.trace,
    forward_enumeration_shadow: {
      schema_version: forwardEnumerationAdapterVersion,
      experiment_arm: shadow
        ? forwardEnumerationExperimentArms.SHADOW
        : forwardEnumerationExperimentArms.CONSUME,
      candidate_count: packet.candidates.length,
      observation_field_count: Object.keys(observation.claim).length,
      observation_provenance_count: observation.provenance.length,
      observation_context_status: observation.context_status,
      observation_context_reason: observation.context_reason,
      identity_evidence_count: evidenceItems.length,
      identity_evidence_items: evidenceItems,
      integrity,
      production_retrieval_affected: shadow !== true,
      title_changed: false
    }
  };
  if (shadow) return patch;
  const current = result.retrieval_application && typeof result.retrieval_application === "object"
    ? result.retrieval_application
    : {};
  return {
    ...patch,
    retrieval_query_expansion_fields: derivedFieldsPacket.query_expansion_fields,
    retrieval_application: {
      ...current,
      enabled: true,
      owns_candidate_application: true,
      identity_evidence_items: [
        ...(Array.isArray(current.identity_evidence_items) ? current.identity_evidence_items : []),
        ...evidenceItems
      ],
      forward_enumeration_identity_evidence_items: evidenceItems,
      forward_enumeration_integrity: integrity,
      forward_enumeration_adapter_version: forwardEnumerationAdapterVersion
    }
  };
}

export function mergeForwardEnumerationApplicationEvidence(result = {}, application = {}) {
  const forward = result.retrieval_application;
  if (forward?.forward_enumeration_adapter_version !== forwardEnumerationAdapterVersion) return application;
  const validation = validateForwardEnumerationApplication(result);
  if (!validation.valid) {
    return {
      ...application,
      forward_enumeration_identity_evidence_count: 0,
      forward_enumeration_validation_status: "REJECTED",
      forward_enumeration_validation_reason: validation.reason
    };
  }
  const forwardItems = validation.items;
  if (!forwardItems.length) return application;
  const currentItems = Array.isArray(application.identity_evidence_items)
    ? application.identity_evidence_items
    : [];
  const keyFor = (item = {}) => JSON.stringify([
    item.field || null,
    item.value ?? null,
    item.source || null,
    item.metadata?.candidate_id || null
  ]);
  const seen = new Set(currentItems.map(keyFor));
  const added = forwardItems.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const identityEvidenceItems = [...currentItems, ...added];
  return {
    ...application,
    identity_evidence_items: identityEvidenceItems,
    identity_evidence_count: identityEvidenceItems.length,
    forward_enumeration_adapter_version: forwardEnumerationAdapterVersion,
    forward_enumeration_validation_status: "VERIFIED",
    forward_enumeration_validation_reason: null,
    forward_enumeration_identity_evidence_count: added.length
  };
}
