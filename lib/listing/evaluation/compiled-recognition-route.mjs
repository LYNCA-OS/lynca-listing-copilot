import { createHash } from "node:crypto";

import { sourceTrustValues } from "../external/external-candidate-contract.mjs";

// This is an evaluation transport contract, not a recognition implementation.
// It compiles already-versioned image evidence and Release Pack vocabulary into
// retrieval inputs. It cannot resolve SEM fields or render a title.

export const compiledRecognitionRouteContractVersion = "compiled-recognition-route-v1";
export const compiledRecognitionRouteModes = Object.freeze({
  OFFLINE: "OFFLINE",
  SHADOW: "SHADOW"
});
export const compiledRecognitionOutcomes = Object.freeze({
  VALUE: "VALUE",
  EMPTY: "EMPTY",
  UNKNOWN: "UNKNOWN"
});

const allowedSplits = new Set(["development", "validation"]);
const allowedModes = new Set(Object.values(compiledRecognitionRouteModes));
const allowedOutcomes = new Set(Object.values(compiledRecognitionOutcomes));
const allowedReleaseTrust = new Set([
  sourceTrustValues.OFFICIAL_CHECKLIST,
  sourceTrustValues.REVIEWED_INTERNAL,
  sourceTrustValues.INTERNAL_VERIFIED_TITLE
]);

const allowedDirectEvidenceModalities = new Set([
  "CARD_TEXT_OCR",
  "SLAB_LABEL_OCR",
  "DIRECT_VISUAL_OBSERVATION",
  "OPERATOR_CONFIRMED"
]);

const allowedDirectEvidenceProducers = new Map([
  ["CANONICAL_PREINGESTION_EVIDENCE", new Set(["preingestion-evidence-fields-v2"])]
]);
const directEvidencePermission = "DIRECT_IMAGE_EVIDENCE";

// These are retrieval facets, not the public SEM contract. Instance-specific
// fields such as serial numerator, grade, cert, condition, and defects are
// deliberately absent: a Release Pack must never supply them.
const allowedRetrievalFields = new Set([
  "year",
  "season",
  "manufacturer",
  "product",
  "set_or_insert",
  "subject",
  "card_number",
  "print_finish",
  "sport"
]);

const sha256Pattern = /^[0-9a-f]{64}$/i;

export class CompiledRecognitionRouteContractError extends Error {
  constructor(code, path = "") {
    super(path ? `${code}:${path}` : code);
    this.name = "CompiledRecognitionRouteContractError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path = "") {
  throw new CompiledRecognitionRouteContractError(code, path);
}

function cleanText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function comparisonKey(value) {
  return cleanText(value).toLocaleLowerCase("en-US");
}

function requiredText(value, path) {
  const text = cleanText(value);
  if (!text) fail("TEXT_REQUIRED", path);
  return text;
}

function requiredObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("OBJECT_REQUIRED", path);
  return value;
}

function requiredSha256(value, path) {
  const hash = requiredText(value, path).toLowerCase();
  if (!sha256Pattern.test(hash)) fail("SHA256_REQUIRED", path);
  return hash;
}

function requiredConfidence(value, path) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    fail("CONFIDENCE_OUT_OF_RANGE", path);
  }
  return confidence;
}

function requiredField(value, path) {
  const field = requiredText(value, path);
  if (!allowedRetrievalFields.has(field)) fail("RETRIEVAL_FIELD_NOT_ALLOWED", path);
  return field;
}

function stringArray(value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail("STRING_ARRAY_REQUIRED", path);
  const output = value.map((entry, index) => requiredText(entry, `${path}[${index}]`));
  return [...new Map(output.map((entry) => [comparisonKey(entry), entry])).values()];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stableCandidateId(pack, rowId, value = "") {
  const stable = JSON.stringify([
    pack.pack_id,
    pack.revision,
    pack.content_sha256,
    rowId,
    cleanText(value)
  ]);
  return `compiled:${createHash("sha256").update(stable).digest("hex").slice(0, 20)}`;
}

function validateScope(scope = {}) {
  requiredObject(scope, "evaluation_scope");
  const split = requiredText(scope.split, "evaluation_scope.split").toLowerCase();
  if (!allowedSplits.has(split)) {
    fail(split === "holdout" ? "HOLDOUT_FORBIDDEN" : "EVALUATION_SPLIT_NOT_ALLOWED", "evaluation_scope.split");
  }
  if (scope.holdout_consumed !== false) fail("HOLDOUT_MUST_REMAIN_SEALED", "evaluation_scope.holdout_consumed");
  return {
    split,
    sample_id: requiredText(scope.sample_id, "evaluation_scope.sample_id"),
    holdout_consumed: false
  };
}

function validateImageSnapshot(snapshot = {}) {
  requiredObject(snapshot, "image_snapshot");
  const hashes = stringArray(snapshot.image_sha256, "image_snapshot.image_sha256", { allowEmpty: false })
    .map((hash, index) => requiredSha256(hash, `image_snapshot.image_sha256[${index}]`));
  if (hashes.length > 2) fail("TOO_MANY_CURRENT_IMAGES", "image_snapshot.image_sha256");
  return {
    schema_version: requiredText(snapshot.schema_version, "image_snapshot.schema_version"),
    image_generation_id: requiredText(snapshot.image_generation_id, "image_snapshot.image_generation_id"),
    image_set_sha256: requiredSha256(snapshot.image_set_sha256, "image_snapshot.image_set_sha256"),
    image_sha256: hashes
  };
}

function validateProvenance(provenance = {}, path) {
  requiredObject(provenance, path);
  const sourceTrust = requiredText(provenance.source_trust, `${path}.source_trust`).toUpperCase();
  if (!allowedReleaseTrust.has(sourceTrust)) fail("RELEASE_TRUST_NOT_ALLOWED", `${path}.source_trust`);
  return {
    source_id: requiredText(provenance.source_id, `${path}.source_id`),
    source_type: requiredText(provenance.source_type, `${path}.source_type`),
    source_version: requiredText(provenance.source_version, `${path}.source_version`),
    source_trust: sourceTrust,
    rule_id: requiredText(provenance.rule_id, `${path}.rule_id`)
  };
}

function validateReleaseRow(row = {}, index) {
  const path = `release_pack.candidates[${index}]`;
  requiredObject(row, path);
  const outcome = requiredText(row.outcome, `${path}.outcome`).toUpperCase();
  if (!allowedOutcomes.has(outcome)) fail("INVALID_RELEASE_OUTCOME", `${path}.outcome`);
  const value = cleanText(row.value);
  const alternatives = row.alternatives === undefined
    ? []
    : stringArray(row.alternatives, `${path}.alternatives`);

  if (outcome === compiledRecognitionOutcomes.VALUE && !value) fail("VALUE_REQUIRES_VALUE", `${path}.value`);
  if (outcome === compiledRecognitionOutcomes.VALUE && alternatives.length) {
    fail("VALUE_CANNOT_HAVE_ALTERNATIVES", `${path}.alternatives`);
  }
  if (outcome !== compiledRecognitionOutcomes.VALUE && value) fail("NON_VALUE_CANNOT_HAVE_VALUE", `${path}.value`);
  if (outcome === compiledRecognitionOutcomes.EMPTY && alternatives.length) {
    fail("EMPTY_CANNOT_HAVE_ALTERNATIVES", `${path}.alternatives`);
  }

  return {
    id: requiredText(row.id, `${path}.id`),
    field: requiredField(row.field, `${path}.field`),
    outcome,
    value: value || null,
    alternatives,
    reason_code: requiredText(row.reason_code, `${path}.reason_code`),
    provenance: validateProvenance(row.provenance, `${path}.provenance`)
  };
}

function validateReleasePack(pack = {}) {
  requiredObject(pack, "release_pack");
  if (!Array.isArray(pack.candidates)) fail("RELEASE_CANDIDATES_REQUIRED", "release_pack.candidates");
  const candidates = pack.candidates.map(validateReleaseRow);
  const ids = new Set();
  for (const [index, candidate] of candidates.entries()) {
    if (ids.has(candidate.id)) fail("DUPLICATE_RELEASE_CANDIDATE_ID", `release_pack.candidates[${index}].id`);
    ids.add(candidate.id);
  }
  return {
    schema_version: requiredText(pack.schema_version, "release_pack.schema_version"),
    pack_id: requiredText(pack.pack_id, "release_pack.pack_id"),
    revision: requiredText(pack.revision, "release_pack.revision"),
    content_sha256: requiredSha256(pack.content_sha256, "release_pack.content_sha256"),
    source_manifest_sha256: requiredSha256(pack.source_manifest_sha256, "release_pack.source_manifest_sha256"),
    candidates
  };
}

function validateDirectEvidence(rows, imageSnapshot) {
  if (!Array.isArray(rows) || rows.length === 0) fail("DIRECT_IMAGE_EVIDENCE_REQUIRED", "direct_image_evidence");
  const allowedImages = new Set(imageSnapshot.image_sha256);
  const ids = new Set();
  return rows.map((row, index) => {
    const path = `direct_image_evidence[${index}]`;
    requiredObject(row, path);
    const id = requiredText(row.id, `${path}.id`);
    if (ids.has(id)) fail("DUPLICATE_DIRECT_EVIDENCE_ID", `${path}.id`);
    ids.add(id);
    const imageSha256 = requiredSha256(row.image_sha256, `${path}.image_sha256`);
    if (!allowedImages.has(imageSha256)) fail("EVIDENCE_NOT_FROM_CURRENT_IMAGE", `${path}.image_sha256`);
    const modality = requiredText(row.modality, `${path}.modality`).toUpperCase();
    if (!allowedDirectEvidenceModalities.has(modality)) {
      fail("DIRECT_EVIDENCE_MODALITY_NOT_ALLOWED", `${path}.modality`);
    }
    const producerPath = `${path}.producer`;
    requiredObject(row.producer, producerPath);
    const producerKind = requiredText(row.producer.kind, `${producerPath}.kind`).toUpperCase();
    const producerContractRevision = requiredText(
      row.producer.contract_revision,
      `${producerPath}.contract_revision`
    );
    const allowedRevisions = allowedDirectEvidenceProducers.get(producerKind);
    if (!allowedRevisions?.has(producerContractRevision)) {
      fail("DIRECT_EVIDENCE_PRODUCER_NOT_ALLOWED", producerPath);
    }
    const producerPermission = requiredText(
      row.producer.permission,
      `${producerPath}.permission`
    ).toUpperCase();
    if (producerPermission !== directEvidencePermission) {
      fail("DIRECT_EVIDENCE_PERMISSION_REQUIRED", `${producerPath}.permission`);
    }
    return {
      id,
      field: requiredField(row.field, `${path}.field`),
      value: requiredText(row.value, `${path}.value`),
      confidence: requiredConfidence(row.confidence, `${path}.confidence`),
      modality,
      source_version: requiredText(row.source_version, `${path}.source_version`),
      normalization_version: requiredText(row.normalization_version, `${path}.normalization_version`),
      image_sha256: imageSha256,
      producer: {
        kind: producerKind,
        contract_revision: producerContractRevision,
        permission: producerPermission
      }
    };
  });
}

function validatePrototypeScores(packet, releasePack, imageSnapshot) {
  if (packet === undefined || packet === null) return null;
  requiredObject(packet, "prototype_scores");
  const queryImageSha256 = requiredSha256(packet.query_image_sha256, "prototype_scores.query_image_sha256");
  if (!imageSnapshot.image_sha256.includes(queryImageSha256)) {
    fail("PROTOTYPE_SCORE_NOT_FROM_CURRENT_IMAGE", "prototype_scores.query_image_sha256");
  }
  if (!Array.isArray(packet.rows)) fail("PROTOTYPE_SCORE_ROWS_REQUIRED", "prototype_scores.rows");
  const releaseById = new Map(releasePack.candidates.map((row) => [row.id, row]));
  const links = new Set();
  const rows = packet.rows.map((row, index) => {
    const path = `prototype_scores.rows[${index}]`;
    requiredObject(row, path);
    const releaseCandidateId = requiredText(row.release_candidate_id, `${path}.release_candidate_id`);
    const release = releaseById.get(releaseCandidateId);
    if (!release) fail("UNKNOWN_RELEASE_CANDIDATE", `${path}.release_candidate_id`);
    if (release.field !== "product" || release.outcome === compiledRecognitionOutcomes.EMPTY) {
      fail("PROTOTYPE_SCORE_REQUIRES_PRODUCT_CANDIDATE", `${path}.release_candidate_id`);
    }
    const candidateValue = requiredText(row.candidate_value, `${path}.candidate_value`);
    const allowedValues = release.outcome === compiledRecognitionOutcomes.VALUE
      ? [release.value]
      : release.alternatives;
    if (!allowedValues.some((value) => comparisonKey(value) === comparisonKey(candidateValue))) {
      fail("PROTOTYPE_VALUE_NOT_IN_RELEASE_PACK", `${path}.candidate_value`);
    }
    const link = `${releaseCandidateId}::${comparisonKey(candidateValue)}`;
    if (links.has(link)) fail("DUPLICATE_PROTOTYPE_SCORE", path);
    links.add(link);
    return {
      release_candidate_id: releaseCandidateId,
      candidate_value: candidateValue,
      score: requiredConfidence(row.score, `${path}.score`),
      permission: "QUERY_EXPANSION_ONLY"
    };
  });
  return {
    schema_version: requiredText(packet.schema_version, "prototype_scores.schema_version"),
    bank_revision: requiredText(packet.bank_revision, "prototype_scores.bank_revision"),
    scorer_revision: requiredText(packet.scorer_revision, "prototype_scores.scorer_revision"),
    query_image_sha256: queryImageSha256,
    rows
  };
}

function evidenceForField(directEvidence, field) {
  return directEvidence.filter((row) => row.field === field);
}

function releaseConstraint(row, directEvidence) {
  const evidence = evidenceForField(directEvidence, row.field);
  const candidateKey = comparisonKey(row.value);
  const supporting = row.outcome === compiledRecognitionOutcomes.VALUE
    ? evidence.filter((item) => comparisonKey(item.value) === candidateKey).map((item) => item.id)
    : [];
  const contradicting = row.outcome === compiledRecognitionOutcomes.VALUE
    ? evidence.filter((item) => comparisonKey(item.value) !== candidateKey).map((item) => item.id)
    : row.outcome === compiledRecognitionOutcomes.EMPTY
      ? evidence.map((item) => item.id)
      : [];
  return {
    release_candidate_id: row.id,
    field: row.field,
    outcome: row.outcome,
    value: row.value,
    alternatives: row.alternatives,
    reason_code: row.reason_code,
    supporting_direct_evidence_ids: supporting,
    contradicting_direct_evidence_ids: contradicting,
    direct_conflict: contradicting.length > 0,
    permission: row.outcome === compiledRecognitionOutcomes.UNKNOWN
      ? "QUERY_EXPANSION_ONLY"
      : row.outcome === compiledRecognitionOutcomes.EMPTY
        ? "EXPLICIT_EMPTY_CONSTRAINT"
        : "CANDIDATE_SUPPORT_ONLY",
    provenance: row.provenance
  };
}

function candidateValues(row) {
  if (row.outcome === compiledRecognitionOutcomes.VALUE) return [row.value];
  if (row.outcome === compiledRecognitionOutcomes.UNKNOWN) return row.alternatives;
  return [];
}

function retrievalQueryTerms(directEvidence, releasePack) {
  const direct = directEvidence.map((row) => ({
    field: row.field,
    value: row.value,
    permission: "DIRECT_QUERY_INPUT",
    source_ref: { evidence_id: row.id, image_sha256: row.image_sha256 }
  }));
  const release = releasePack.candidates.flatMap((row) => candidateValues(row).map((value) => ({
    field: row.field,
    value,
    permission: row.outcome === compiledRecognitionOutcomes.VALUE
      ? "VERSIONED_QUERY_CONSTRAINT"
      : "QUERY_EXPANSION_ONLY",
    source_ref: {
      release_candidate_id: row.id,
      release_pack_revision: releasePack.revision,
      outcome: row.outcome
    }
  })));
  const seen = new Set();
  return [...direct, ...release].filter((term) => {
    const key = `${term.field}::${comparisonKey(term.value)}::${term.permission}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCandidateRows(releasePack, constraints, prototypeScores) {
  const constraintsById = new Map(constraints.map((row) => [row.release_candidate_id, row]));
  const prototypes = prototypeScores?.rows || [];
  return releasePack.candidates.flatMap((row) => candidateValues(row).map((value) => {
    const constraint = constraintsById.get(row.id);
    const prototype = prototypes.find((entry) => (
      entry.release_candidate_id === row.id
      && comparisonKey(entry.candidate_value) === comparisonKey(value)
    ));
    return {
      id: stableCandidateId(releasePack, row.id, value),
      release_candidate_id: row.id,
      field: row.field,
      value,
      release_outcome: row.outcome,
      permission: row.outcome === compiledRecognitionOutcomes.UNKNOWN
        ? "QUERY_EXPANSION_ONLY"
        : "CANDIDATE_SUPPORT_ONLY",
      eligibility: constraint.direct_conflict
        ? "BLOCKED_BY_DIRECT_CONFLICT"
        : row.outcome === compiledRecognitionOutcomes.UNKNOWN
          ? "AMBIGUOUS_QUERY_CANDIDATE"
          : "UNSELECTED_CANDIDATE",
      supporting_direct_evidence_ids: constraint.supporting_direct_evidence_ids,
      contradicting_direct_evidence_ids: constraint.contradicting_direct_evidence_ids,
      prototype_support: prototype || null,
      provenance: row.provenance
    };
  }));
}

export function buildCompiledRecognitionRoutePacket(input = {}) {
  requiredObject(input, "$input");
  const mode = requiredText(input.mode, "mode").toUpperCase();
  if (!allowedModes.has(mode)) fail("EXECUTION_MODE_NOT_ALLOWED", "mode");
  const scope = validateScope(input.evaluation_scope);
  const imageSnapshot = validateImageSnapshot(input.image_snapshot);
  const releasePack = validateReleasePack(input.release_pack);
  const directEvidence = validateDirectEvidence(input.direct_image_evidence, imageSnapshot);
  const prototypeScores = validatePrototypeScores(input.prototype_scores, releasePack, imageSnapshot);
  const constraints = releasePack.candidates.map((row) => releaseConstraint(row, directEvidence));
  const candidates = buildCandidateRows(releasePack, constraints, prototypeScores);

  return deepFreeze({
    contract_version: compiledRecognitionRouteContractVersion,
    execution: {
      mode,
      production_effect: false,
      provider_calls: 0,
      holdout_consumed: false
    },
    evaluation_scope: scope,
    image_snapshot: imageSnapshot,
    release_pack_ref: {
      schema_version: releasePack.schema_version,
      pack_id: releasePack.pack_id,
      revision: releasePack.revision,
      content_sha256: releasePack.content_sha256,
      source_manifest_sha256: releasePack.source_manifest_sha256
    },
    retrieval_packet: {
      query_terms: retrievalQueryTerms(directEvidence, releasePack),
      direct_image_evidence: directEvidence,
      release_constraints: constraints,
      prototype_query_support: prototypeScores
    },
    candidate_packet: {
      candidates,
      selected_candidate_id: null,
      selection_owner_called: false,
      resolution_owner_called: false
    },
    trace: {
      release_outcome_counts: Object.fromEntries(Object.values(compiledRecognitionOutcomes).map((outcome) => [
        outcome,
        releasePack.candidates.filter((row) => row.outcome === outcome).length
      ])),
      direct_evidence_count: directEvidence.length,
      prototype_score_count: prototypeScores?.rows.length || 0,
      direct_conflict_count: constraints.filter((row) => row.direct_conflict).length,
      output_boundary: "RETRIEVAL_AND_CANDIDATES_ONLY"
    }
  });
}
