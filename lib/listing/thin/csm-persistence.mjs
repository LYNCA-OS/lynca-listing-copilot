// Turn one card's run into the rows the CSM shadow persistence schema expects.
//
// `supabase/migrations/20260728190000_csm_stage_shadow_foundation_v1.sql` already
// defines the whole replayable chain:
//
//   csm_evidence_observations -> csm_bracket_candidates
//     -> csm_candidate_evidence_links -> csm_identity_resolutions
//     -> csm_resolved_brackets -> csm_marketplace_outputs
//   (+ csm_registry_releases)
//
// It has a contract test and, as of this writing, **no producer**: the only
// reference to those tables anywhere in `lib`, `api`, `services` or `scripts`
// is the test itself. The schema was built and never wired, which is the
// failure mode this project has hit before -- built is not running, and running
// is not useful.
//
// So this module writes nothing to a database. It produces the ROWS, in the
// schema's own shape, so that:
//
//   * COS-25's hardest acceptance criterion -- "every downstream layer can be
//     replayed from stored evidence and version references" -- has something
//     concrete to be true or false about;
//   * a conformance test can assert our keys against the migration file itself,
//     so schema drift is caught rather than discovered on insert;
//   * wiring it to Supabase later is a transport change, not a modelling one.
//
// The mapping that made this worth doing: `empty_reason` in the schema is
// `ABSENT | INSUFFICIENT_EVIDENCE`, which is exactly the distinction this path
// already carries as `empty` versus `unreadable`. COS-27 decision 4 asks for
// honest uncertainty, `empty`, alternatives and review-required states; the
// schema has `empty_reason`, `alternate_candidate_ids`, `rationale_codes` and
// `semantic_confidence` waiting for them.

import { createHash } from "node:crypto";

import {
  SEM_STANDARD_VERSION,
  semCanonicalEditableFields,
  semCanonicalTitleOrder
} from "../csm/sem-definition.mjs";
import { toResolvedFields } from "./csm-emit.mjs";
import { resolvedFieldsToSemSuggestion } from "../csm/title-derived-sem.mjs";
import {
  EXTERNAL_IDENTITY_COMPOSER_VERSION,
  EXTERNAL_IDENTITY_MARKETPLACE_PROFILE_VERSION,
  EXTERNAL_IDENTITY_RESOLVER_VERSION,
  externalIdentityReplayReleaseForReceipt,
  validateExternalIdentityDecisionObservation,
  validateExternalIdentityFieldDecisions,
  validateExternalIdentitySourceProvenance
} from "../knowledge/csm-external-identity-support.mjs";
import {
  validateVerifiedOriginalObservationReceipt,
  verifiedOriginalObservationComposerContractForReceipt,
  verifiedOriginalObservationEvidenceReference,
  verifiedOriginalObservationOverrideFieldsForBracket,
  VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET,
  VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
} from "./verified-original-observation-support.mjs";
import {
  LOT_UNSHARED_ATTRIBUTE_FIELDS,
  lotPublicationFailureCode,
  validateLotTerminalReceipt
} from "./lot-terminal-contract.mjs";
import {
  validatePublicationCoverageAgainstFields
} from "./publication-coverage.mjs";
import {
  validateFounderBetaWebReceiptAgainstFields
} from "./csm-forward-reader-bridge.mjs";
import {
  validateResolvedSetCardNameRelationReceipt
} from "./set-card-name-reconciliation.mjs";

export const CSM_STAGE_CONTRACT_VERSION = "csm-stage-shadow-v2";
export const CSM_DURABLE_PROJECTION_CONTRACT_VERSION = "csm-stage-shadow-v3";
export const CSM_STAGE_LEGACY_CONTRACT_VERSION = CSM_STAGE_CONTRACT_VERSION;
export const THIN_RESOLVER_VERSION = "thin-path-observation-only-v1";
export const THIN_COMPOSER_VERSION_V1 = "thin-marketplace-composer-v1";
export const THIN_COMPOSER_VERSION_V2 = "thin-marketplace-composer-v2";
export const THIN_COMPOSER_VERSION = "thin-marketplace-composer-v3";
export const EBAY_PROFILE_VERSION = "ebay-profile-v1";
export const LYNCA_STANDARD_PROFILE_VERSION_V1 = "lynca-standard-name-v0.1";
export const LYNCA_STANDARD_PROFILE_VERSION_V2 = "lynca-standard-name-v0.2";
export const LYNCA_STANDARD_PROFILE_VERSION_V3 = "lynca-standard-name-v0.3";
export const LYNCA_STANDARD_PROFILE_VERSION = LYNCA_STANDARD_PROFILE_VERSION_V3;
export const LYNCA_STANDARD_CHARACTER_BUDGET = 80;
export const THIN_REGISTRY_RELEASE_ID = "registry_thin_sem_v25";
export const THIN_EXTERNAL_IDENTITY_RESOLVER_VERSION = EXTERNAL_IDENTITY_RESOLVER_VERSION;
export const THIN_EXTERNAL_IDENTITY_COMPOSER_VERSION = EXTERNAL_IDENTITY_COMPOSER_VERSION;
export const EBAY_EXTERNAL_IDENTITY_PROFILE_VERSION = EXTERNAL_IDENTITY_MARKETPLACE_PROFILE_VERSION;
export const COMPOSITION_GRAMMARS = Object.freeze(["standard", "tcg", "lot"]);

function compositionGrammar(value) {
  const grammar = String(value || "").trim().toLowerCase();
  if (!COMPOSITION_GRAMMARS.includes(grammar)) {
    throw new TypeError(`unsupported_composition_grammar:${grammar || "missing"}`);
  }
  return grammar;
}

export function csmIdentityGrammarForComposition(value) {
  return compositionGrammar(value) === "tcg" ? "TCG" : "NON_TCG";
}

// The schema's own allowed values, restated here so a mismatch is a test
// failure rather than a constraint violation at insert time.
export const MODALITIES = Object.freeze(["WHOLE_CARD_VISUAL", "SLAB_LABEL", "CARD_TEXT_OCR", "REGISTRY"]);
export const EMPTY_REASONS = Object.freeze(["ABSENT", "INSUFFICIENT_EVIDENCE"]);
export const VALUE_KINDS = Object.freeze(["VALUE", "EMPTY"]);
export const CSM_BRACKETS = Object.freeze([...semCanonicalEditableFields]);

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rowId = (...parts) => sha256(parts).slice(0, 32);

// Packet hashes protect persisted facts, not JavaScript insertion order or a
// timestamp the database supplies after insert. Object keys are sorted, row
// collections are treated as sets, and volatile/default timestamps are left
// out. Arrays inside a row keep their order because some are ordered traces.
const VOLATILE_PACKET_KEYS = new Set(["created_at"]);

function canonicalValue(value, omitVolatileKeys = false) {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => (!omitVolatileKeys || !VOLATILE_PACKET_KEYS.has(key)) && value[key] !== undefined)
    .map((key) => [key, canonicalValue(value[key])]));
}

function canonicalRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => canonicalValue(row, true))
    .map((row) => ({ row, key: JSON.stringify(row) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map(({ row }) => row);
}

// Row ids are only a collision-resistant locator, never the idempotency
// decision. They nevertheless include the canonical fact and the versions
// that give that fact meaning, so a changed attempt cannot silently target the
// old row id. The writer separately compares the three full packet hashes on
// the immutable recognition session before it writes anything.
const contentDigest = (value) => sha256(canonicalValue(value, true));

const packetSha256 = (packet) => sha256(canonicalValue(packet));

export function canonicalRecognitionPacket(rows) {
  return canonicalValue({
    evidence: canonicalRows(rows?.evidence),
    candidates: canonicalRows(rows?.candidates),
    links: canonicalRows(rows?.links)
  });
}

export function canonicalResolutionPacket(rows) {
  return canonicalValue({
    resolution: canonicalValue(rows?.resolution, true),
    resolved: canonicalRows(rows?.resolved)
  });
}

export function canonicalMarketplacePacket(rows) {
  return canonicalValue({ output: canonicalValue(rows?.output, true) });
}

export function computeCsmPacketHashes(rows) {
  return Object.freeze({
    csm_recognition_packet_sha256: packetSha256(canonicalRecognitionPacket(rows)),
    csm_resolution_packet_sha256: packetSha256(canonicalResolutionPacket(rows)),
    csm_marketplace_packet_sha256: packetSha256(canonicalMarketplacePacket(rows))
  });
}

/**
 * One card's run, as rows.
 *
 * `sessionId` and `tenantId` are the caller's: the schema has a foreign key to
 * `v4_recognition_sessions`, so nothing here invents them.
 */
export function buildCsmStageRows({
  tenantId, recognitionSessionId, fields, observedFields = fields,
  externalIdentitySupport = null, verifiedOriginalObservationSupport = null, composed, title,
  founderBetaWebReceipt = null, setCardNameRelationReceipt = null,
  registryReleaseId = THIN_REGISTRY_RELEASE_ID, createdAt = null,
  contractVersion = CSM_DURABLE_PROJECTION_CONTRACT_VERSION
}) {
  if (![CSM_DURABLE_PROJECTION_CONTRACT_VERSION, CSM_STAGE_LEGACY_CONTRACT_VERSION]
    .includes(contractVersion)) {
    throw new TypeError("csm_stage_contract_version_unsupported");
  }
  const durableProjectionContract = contractVersion === CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
  const compositionGrammarName = compositionGrammar(composed?.grammar);
  const sem = resolvedFieldsToSemSuggestion(toResolvedFields(fields));
  const observedSem = resolvedFieldsToSemSuggestion(toResolvedFields(observedFields));
  const independentSearchOptimization = Array.isArray(fields.search_optimization)
    ? [...fields.search_optimization]
    : fields.search_optimization == null ? [] : [fields.search_optimization];
  const unreadable = new Set(observedFields.unreadable || []);
  const uncertain = new Set(observedFields.low_confidence || []);
  const externalApplied = externalIdentitySupport?.status === "APPLIED";
  const verifiedOriginalApplied = verifiedOriginalObservationSupport?.status === "APPLIED";
  if (externalApplied && verifiedOriginalApplied) {
    throw new TypeError("post_observation_resolution_overlap");
  }
  if (verifiedOriginalApplied && !validateVerifiedOriginalObservationReceipt(
    verifiedOriginalObservationSupport,
    { observedFields, resolvedFields: fields }
  )) {
    throw new TypeError("verified_original_observation_receipt_mismatch");
  }
  const externalReplayRelease = externalApplied
    ? externalIdentityReplayReleaseForReceipt(externalIdentitySupport)
    : null;
  const externalMatchMode = externalApplied
    ? String(externalIdentitySupport?.match_mode || "").trim()
    : null;
  const externalOriginalSetSha256 = externalApplied
    ? String(externalIdentitySupport?.original_set_sha256 || "").trim().toLowerCase()
    : "";
  if (externalApplied) {
    if (!["EXACT_FOUR_ANCHOR", "VERIFIED_ORIGINAL_SET"].includes(externalMatchMode)) {
      throw new TypeError("external_identity_match_mode_invalid");
    }
    if (externalMatchMode === "VERIFIED_ORIGINAL_SET"
        && !/^[0-9a-f]{64}$/.test(externalOriginalSetSha256)) {
      throw new TypeError("external_identity_original_set_sha256_invalid");
    }
    if (externalMatchMode === "EXACT_FOUR_ANCHOR" && externalOriginalSetSha256) {
      throw new TypeError("external_identity_original_set_sha256_unexpected");
    }
    if (!externalReplayRelease
        || Object.entries(externalReplayRelease.receipt).some(([field, value]) => (
          externalIdentitySupport[field] !== value
        ))
        || registryReleaseId !== externalReplayRelease.receipt.registry_release_id
        || !validateExternalIdentityFieldDecisions(externalIdentitySupport)
        || !validateExternalIdentitySourceProvenance(externalIdentitySupport)
        || !validateExternalIdentityDecisionObservation(
          externalIdentitySupport,
          observedFields,
          fields
        )) {
      throw new TypeError("external_identity_release_receipt_mismatch");
    }
  }
  const externalDecisions = externalApplied && externalIdentitySupport?.field_decisions
    && typeof externalIdentitySupport.field_decisions === "object"
    ? externalIdentitySupport.field_decisions
    : {};
  const ordinaryComposerVersion = String(
    composed?.composer_version || THIN_COMPOSER_VERSION_V2
  ).trim();
  const ordinaryProfileVersion = String(
    composed?.marketplace_profile_version || EBAY_PROFILE_VERSION
  ).trim();
  const publicationCoverage = composed?.publication_coverage;
  if (durableProjectionContract) {
    if (founderBetaWebReceipt != null) {
      try {
        validateFounderBetaWebReceiptAgainstFields(founderBetaWebReceipt, fields);
      }
      catch { throw new TypeError("founder_beta_web_receipt_invalid"); }
    }
    if (setCardNameRelationReceipt != null) {
      try {
        const relationFields = (value) => ({
          ...value,
          ...(!Object.hasOwn(value || {}, "set") ? { set: "" } : {}),
          ...(!Object.hasOwn(value || {}, "card_name") ? { card_name: "" } : {})
        });
        validateResolvedSetCardNameRelationReceipt({
          receipt: setCardNameRelationReceipt,
          observedFields: relationFields(observedFields),
          resolvedFields: relationFields(fields),
          externalIdentitySupport,
          verifiedOriginalObservationSupport
        });
      }
      catch { throw new TypeError("set_card_name_relation_receipt_invalid"); }
    }
  } else if (founderBetaWebReceipt != null) {
    throw new TypeError("founder_beta_web_receipt_outside_contract");
  }
  if (durableProjectionContract) {
    try {
      validatePublicationCoverageAgainstFields(
        publicationCoverage, fields, semCanonicalTitleOrder(compositionGrammarName)
      );
    } catch {
      throw new TypeError("publication_coverage_receipt_invalid");
    }
  } else if (publicationCoverage != null) {
    throw new TypeError("publication_coverage_receipt_outside_contract");
  }
  const hasCanonicalNamingReceipt = Boolean(composed && (
    composed.canonical_naming_trace != null
      || composed.canonical_naming_publishable === false
      || composed.canonical_naming_failure_code
  ));
  const lotQuantityUnresolved = Boolean(composed?.lot_quantity_unresolved);
  const lotSingleCard = Boolean(composed?.lot_single_card);
  const lotUnsharedRaw = Array.isArray(composed?.lot_unshared_attributes)
    ? composed.lot_unshared_attributes.map((field) => String(field || "").trim())
    : [];
  const lotUnsharedAllowed = new Set(LOT_UNSHARED_ATTRIBUTE_FIELDS);
  if (lotUnsharedRaw.some((field) => !lotUnsharedAllowed.has(field))
      || new Set(lotUnsharedRaw).size !== lotUnsharedRaw.length) {
    throw new TypeError("lot_unshared_attributes_invalid");
  }
  const lotUnsharedAttributes = [...lotUnsharedRaw].sort();
  const expectedLotFailureCode = lotPublicationFailureCode({
    quantityUnresolved: lotQuantityUnresolved,
    singleCard: lotSingleCard
  });
  const lotPublishable = composed?.lot_publishable !== false;
  const lotFailureCode = String(composed?.lot_publication_failure_code || "").trim() || null;
  if (compositionGrammarName === "lot") {
    if (lotQuantityUnresolved && lotSingleCard) {
      throw new TypeError("lot_publication_state_conflict");
    }
    if (lotPublishable !== (expectedLotFailureCode == null)
        || lotFailureCode !== expectedLotFailureCode) {
      throw new TypeError("lot_publication_receipt_mismatch");
    }
  } else if (lotQuantityUnresolved || lotSingleCard || lotUnsharedAttributes.length
      || !lotPublishable || lotFailureCode) {
    throw new TypeError("lot_publication_receipt_outside_lot");
  }
  const lotTerminalReceipt = compositionGrammarName === "lot" && durableProjectionContract
    ? validateLotTerminalReceipt({
    lot_quantity_unresolved: lotQuantityUnresolved,
    lot_single_card: lotSingleCard,
    lot_unshared_attributes: lotUnsharedAttributes,
    publishable: lotPublishable,
    failure_code: lotFailureCode
    }, { lotCount: fields.lot_count, unsharedAttributes: lotUnsharedAttributes }) : null;
  const verifiedCanonicalNamingProfileVersion = verifiedOriginalApplied
    ? verifiedOriginalObservationComposerContractForReceipt(
      verifiedOriginalObservationSupport
    )?.marketplace_profile_version
    : VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT
      .composer_contract.marketplace_profile_version;
  const registeredCanonicalNamingProfileVersions = new Set([
    LYNCA_STANDARD_PROFILE_VERSION_V1,
    LYNCA_STANDARD_PROFILE_VERSION_V2,
    LYNCA_STANDARD_PROFILE_VERSION_V3,
    verifiedCanonicalNamingProfileVersion
  ]);
  const ordinaryCompositionPairValid = (
    ordinaryComposerVersion === THIN_COMPOSER_VERSION_V2
      && ordinaryProfileVersion === EBAY_PROFILE_VERSION
  ) || (
    ordinaryComposerVersion === THIN_COMPOSER_VERSION
      && registeredCanonicalNamingProfileVersions.has(ordinaryProfileVersion)
      && compositionGrammarName === "standard"
  );
  if (!externalApplied && !ordinaryCompositionPairValid) {
    throw new TypeError(
      `unsupported_composition_contract:${ordinaryComposerVersion}/${ordinaryProfileVersion}`
    );
  }
  if (!externalApplied && hasCanonicalNamingReceipt
      && (ordinaryComposerVersion !== THIN_COMPOSER_VERSION
        || !registeredCanonicalNamingProfileVersions.has(ordinaryProfileVersion)
        || compositionGrammarName !== "standard")) {
    throw new TypeError("canonical_naming_composition_contract_mismatch");
  }
  if (verifiedOriginalApplied
      && ordinaryProfileVersion !== verifiedCanonicalNamingProfileVersion) {
    throw new TypeError("verified_original_observation_profile_mismatch");
  }
  if (!externalApplied && ordinaryComposerVersion === THIN_COMPOSER_VERSION) {
    const namingBudget = Number(composed?.character_budget);
    const namingLength = Number(composed?.length);
    if (composed?.canonical_naming_publishable !== true
        || !composed?.canonical_naming_trace
        || typeof composed.canonical_naming_trace !== "object"
        || Array.isArray(composed.canonical_naming_trace)
        || !String(title || "").trim()
        || namingBudget !== LYNCA_STANDARD_CHARACTER_BUDGET
        || !Number.isInteger(namingLength)
        || namingLength !== String(title).length
        || String(title).length > namingBudget) {
      throw new TypeError("canonical_naming_output_not_publishable");
    }
  }
  const base = { tenant_id: tenantId, recognition_session_id: recognitionSessionId };
  const stamp = createdAt ? { created_at: createdAt } : {};

  const evidence = [];
  const candidates = [];
  const links = [];
  const resolved = [];
  const bracketSelections = new Map();

  const externalFieldForBracket = (bracket) => ({
    subject: "subjects",
    search_optimization: "team"
  })[bracket] || bracket;

  const externalSourceRef = (field, decision) => {
    const allowed = new Set(decision.source_ids || []);
    return {
      support_type: "EXACT_EXTERNAL_IDENTITY",
      field,
      decision: decision.action,
      pack_id: externalIdentitySupport.pack_id,
      pack_version: externalIdentitySupport.pack_version,
      pack_sha256: externalIdentitySupport.pack_sha256,
      index_id: externalIdentitySupport.index_id,
      index_version: externalIdentitySupport.index_version,
      index_sha256: externalIdentitySupport.index_sha256,
      record_id: externalIdentitySupport.record_id,
      registry_release_id: registryReleaseId,
      resolution_contract_sha256: externalIdentitySupport.resolution_contract_sha256,
      match_mode: externalMatchMode,
      ...(externalOriginalSetSha256 ? {
        original_set_sha256: externalOriginalSetSha256
      } : {}),
      sources: (externalIdentitySupport.sources || [])
        .filter((source) => allowed.has(source.source_id))
        .map(({ source_id, url, retrieved_at, fact_sha256 }) => ({
          source_id, url, retrieved_at, fact_sha256
        }))
    };
  };

  for (const bracket of CSM_BRACKETS) {
    const value = sem[bracket];
    const observedValue = observedSem[bracket];
    const present = Array.isArray(observedValue)
      ? observedValue.length > 0
      : (observedValue !== undefined && observedValue !== null && observedValue !== "");
    const externalField = externalFieldForBracket(bracket);
    const externalDecision = externalDecisions[externalField] || null;
    const externalSupported = externalApplied && externalDecision !== null;
    const verifiedOriginalFields = verifiedOriginalApplied
      ? verifiedOriginalObservationOverrideFieldsForBracket(
          verifiedOriginalObservationSupport,
          bracket
        )
      : [];
    const verifiedOriginalSupported = verifiedOriginalFields.length > 0;
    const candidateIds = [];
    let selectedCandidate = null;

    // `empty_reason` is the schema's own vocabulary and it maps cleanly:
    // the card does not have it (ABSENT) versus it is there and could not be
    // made out (INSUFFICIENT_EVIDENCE). A path that could not tell those apart
    // would have to guess here, which is the whole reason the third state was
    // added upstream.
    const names = [bracket, ...schemaAliases(bracket)];
    const emptyReason = present ? null
      : names.some((name) => unreadable.has(name)) ? "INSUFFICIENT_EVIDENCE" : "ABSENT";

    // Observation confidence: this path observes from whole-card images and
    // says so. A field the model flagged is lower confidence, not a different
    // modality -- it saw it, it is unsure of it.
    const flagged = names.some((name) => uncertain.has(name));
    const observationConfidence = present ? (flagged ? 0.5 : 0.8) : 0;
    const verifiedOriginalCorroborated = verifiedOriginalSupported
      && contentDigest({ value }) === contentDigest({ value: observedValue })
      && (present || emptyReason === "ABSENT");
    const observedCandidateTrust = verifiedOriginalCorroborated
      ? "REVIEWED_CLOSED_PROJECTION_EXACT"
      : "VISUAL_ONLY";
    const observedCandidateConfidence = verifiedOriginalCorroborated
      ? 1
      : observationConfidence;

    if (present) {
      const evidenceId = rowId(
        recognitionSessionId, bracket, "obs", contractVersion,
        SEM_STANDARD_VERSION,
        contentDigest({ value: observedValue, modality: "WHOLE_CARD_VISUAL", observationConfidence, flagged })
      );
      evidence.push({
        id: evidenceId,
        ...base,
        contract_version: contractVersion,
        bracket,
        raw_value: observedValue,
        normalized_value: observedValue,
        modality: "WHOLE_CARD_VISUAL",
        source_ref: { images: recognitionSessionId },
        observation_confidence: observationConfidence,
        normalization_version: SEM_STANDARD_VERSION,
        normalization_outcome: "KEPT",
        normalization_reason_code: flagged ? "LOW_CONFIDENCE_OBSERVATION" : "DIRECT_OBSERVATION",
        ...stamp
      });

      const candidateId = rowId(
        recognitionSessionId, bracket, "cand", contractVersion,
        SEM_STANDARD_VERSION,
        contentDigest({
          value: observedValue,
          value_kind: "VALUE",
          source_trust: observedCandidateTrust,
          observationConfidence: observedCandidateConfidence
        })
      );
      candidates.push({
        id: candidateId,
        ...base,
        contract_version: contractVersion,
        bracket,
        value_kind: "VALUE",
        canonical_value: observedValue,
        empty_reason: null,
        // Not TRUSTED: this is a model observation, which CSM classifies as a
        // heuristic prior, not a reviewed or catalog-backed fact.
        source_trust: observedCandidateTrust,
        candidate_confidence: observedCandidateConfidence,
        candidate_rank: externalSupported || (verifiedOriginalSupported
          && !verifiedOriginalCorroborated) ? 2 : 1,
        ...stamp
      });
      links.push({
        ...base,
        candidate_id: candidateId,
        evidence_observation_id: evidenceId,
        relationship: "SUPPORTS",
        ...stamp
      });
      candidateIds.push(candidateId);
      selectedCandidate = candidates.at(-1);
    } else {
      const candidate = {
        id: rowId(
          recognitionSessionId, bracket, "cand", contractVersion,
          SEM_STANDARD_VERSION,
          contentDigest({
            value_kind: "EMPTY",
            empty_reason: emptyReason,
            source_trust: observedCandidateTrust
          })
        ),
        ...base,
        contract_version: contractVersion,
        bracket,
        value_kind: "EMPTY",
        canonical_value: null,
        empty_reason: emptyReason,
        source_trust: observedCandidateTrust,
        candidate_confidence: verifiedOriginalCorroborated ? 1 : 0,
        candidate_rank: externalSupported || (verifiedOriginalSupported
          && !verifiedOriginalCorroborated) ? 2 : 1,
        ...stamp
      };
      candidates.push(candidate);
      candidateIds.push(candidate.id);
      selectedCandidate = candidate;
    }

    if (externalSupported) {
      const registryValue = value;
      const sourceRef = externalSourceRef(externalField, externalDecision);
      const registryEvidenceId = rowId(
        recognitionSessionId, bracket, "registry-obs", contractVersion,
        externalIdentitySupport.index_version,
        contentDigest({ value: registryValue, source_ref: sourceRef })
      );
      evidence.push({
        id: registryEvidenceId,
        ...base,
        contract_version: contractVersion,
        bracket,
        raw_value: externalDecision.canonical_value,
        normalized_value: registryValue,
        modality: "REGISTRY",
        source_ref: sourceRef,
        observation_confidence: 1,
        normalization_version: externalIdentitySupport.index_version,
        normalization_outcome: "KEPT",
        normalization_reason_code: `EXTERNAL_IDENTITY_${externalDecision.action}`,
        ...stamp
      });
      const registryCandidateId = rowId(
        recognitionSessionId, bracket, "registry-cand", contractVersion,
        externalIdentitySupport.index_version,
        contentDigest({ value: registryValue, value_kind: "VALUE", source_trust: "REVIEWED_REGISTRY_EXACT" })
      );
      const registryCandidate = {
        id: registryCandidateId,
        ...base,
        contract_version: contractVersion,
        bracket,
        value_kind: "VALUE",
        canonical_value: registryValue,
        empty_reason: null,
        source_trust: "REVIEWED_REGISTRY_EXACT",
        candidate_confidence: 1,
        candidate_rank: 1,
        ...stamp
      };
      candidates.push(registryCandidate);
      links.push({
        ...base,
        candidate_id: registryCandidateId,
        evidence_observation_id: registryEvidenceId,
        relationship: "SUPPORTS",
        ...stamp
      });
      candidateIds.push(registryCandidateId);
      selectedCandidate = registryCandidate;
    }

    if (verifiedOriginalSupported) {
      const reviewedPresent = Array.isArray(value)
        ? value.length > 0
        : (value !== undefined && value !== null && value !== "");
      const reviewedEmptyReason = reviewedPresent ? null : "ABSENT";
      let reviewedCandidate = selectedCandidate;
      if (!verifiedOriginalCorroborated) {
        const reviewedCandidateId = rowId(
          recognitionSessionId, bracket, "verified-original-cand",
          contractVersion, verifiedOriginalObservationSupport.release_id,
          contentDigest({
            value: reviewedPresent ? value : null,
            value_kind: reviewedPresent ? "VALUE" : "EMPTY",
            empty_reason: reviewedEmptyReason,
            source_trust: "REVIEWED_CLOSED_PROJECTION_EXACT"
          })
        );
        reviewedCandidate = {
          id: reviewedCandidateId,
          ...base,
          contract_version: contractVersion,
          bracket,
          value_kind: reviewedPresent ? "VALUE" : "EMPTY",
          canonical_value: reviewedPresent ? value : null,
          empty_reason: reviewedEmptyReason,
          source_trust: "REVIEWED_CLOSED_PROJECTION_EXACT",
          candidate_confidence: 1,
          candidate_rank: 1,
          ...stamp
        };
        candidates.push(reviewedCandidate);
        candidateIds.push(reviewedCandidateId);
      }
      selectedCandidate = reviewedCandidate;
    }

    bracketSelections.set(bracket, {
      selected: selectedCandidate,
      alternates: candidateIds.filter((id) => id !== selectedCandidate?.id),
      external: externalSupported,
      verified_original: verifiedOriginalSupported
    });
  }

  if (verifiedOriginalApplied) {
    const projectionEvidence = verifiedOriginalObservationEvidenceReference(
      verifiedOriginalObservationSupport
    );
    if (!projectionEvidence) {
      throw new TypeError("verified_original_projection_evidence_invalid");
    }
    const bracket = VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET;
    const value = sem[bracket];
    const present = Array.isArray(value)
      ? value.length > 0
      : (value !== undefined && value !== null && value !== "");
    const sourceRef = projectionEvidence.source_ref;
    const reviewedEvidenceId = rowId(
      recognitionSessionId, bracket, "verified-original-closed-projection",
      contractVersion, verifiedOriginalObservationSupport.release_id,
      contentDigest({ value, source_ref: sourceRef })
    );
    evidence.push({
      id: reviewedEvidenceId,
      ...base,
      contract_version: contractVersion,
      bracket,
      raw_value: present ? value : null,
      normalized_value: present ? value : null,
      modality: "REGISTRY",
      source_ref: sourceRef,
      observation_confidence: 1,
      normalization_version: verifiedOriginalObservationSupport.release_id,
      normalization_outcome: present ? "KEPT" : "DROPPED",
      normalization_reason_code: "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION",
      ...stamp
    });
    for (const candidate of candidates.filter((row) => (
      row.source_trust === "REVIEWED_CLOSED_PROJECTION_EXACT"
    ))) links.push({
        ...base,
        candidate_id: candidate.id,
        evidence_observation_id: reviewedEvidenceId,
        relationship: "SUPPORTS",
        ...stamp
      });
  }

  const recognitionPacketSha256 = packetSha256(canonicalRecognitionPacket({ evidence, candidates, links }));
  const resolutionId = rowId(
    recognitionSessionId, "resolution", contractVersion,
    externalApplied
      ? externalReplayRelease.resolution.resolver_version
      : verifiedOriginalApplied
        ? VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
        : THIN_RESOLVER_VERSION,
    registryReleaseId, compositionGrammarName,
    recognitionPacketSha256
  );
  const resolution = {
    id: resolutionId,
    ...base,
    contract_version: contractVersion,
    revision: 1,
    grammar: csmIdentityGrammarForComposition(compositionGrammarName),
    registry_release_id: registryReleaseId,
    // This path does not resolve -- it observes and the single observation is
    // the resolution. Saying so in the version string keeps a later, real
    // resolver from being confused with it.
    resolver_version: externalApplied
      ? externalReplayRelease.resolution.resolver_version
      : verifiedOriginalApplied
        ? VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
        : THIN_RESOLVER_VERSION,
    conflict_policy_version: externalApplied
      ? externalReplayRelease.resolution.conflict_policy_version
      : verifiedOriginalApplied
        ? VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION
        : "none-single-observation-v1",
    recognition_packet_sha256: recognitionPacketSha256,
    resolution_status: "COMPLETE",
    ...stamp
  };

  for (const bracket of CSM_BRACKETS) {
    const selection = bracketSelections.get(bracket);
    const candidate = selection?.selected;
    if (!candidate) throw new TypeError(`csm_bracket_selection_missing:${bracket}`);
    resolved.push({
      ...base,
      resolution_id: resolutionId,
      bracket: candidate.bracket,
      selected_kind: candidate.value_kind,
      canonical_value: candidate.canonical_value,
      empty_reason: candidate.empty_reason,
      selected_candidate_id: candidate.value_kind === "VALUE" ? candidate.id : null,
      // One observation means no alternates. Recording the empty array rather
      // than omitting it keeps "there were none" distinct from "nobody looked".
      alternate_candidate_ids: selection.alternates,
      rationale_codes: selection.external
        ? ["EXACT_EXTERNAL_IDENTITY_SUPPORT"]
        : selection.verified_original
          ? ["EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"]
        : candidate.value_kind === "VALUE"
          ? [candidate.candidate_confidence < 0.8 ? "SINGLE_OBSERVATION_LOW_CONFIDENCE" : "SINGLE_OBSERVATION"]
        : [candidate.empty_reason],
      semantic_confidence: candidate.candidate_confidence,
      ...stamp
    });
  }

  const resolutionPacketSha256 = packetSha256(canonicalResolutionPacket({ resolution, resolved }));

  const output = {
    id: "",
    ...base,
    resolution_id: resolutionId,
    contract_version: contractVersion,
    marketplace: "EBAY",
    composer_version: externalApplied
      ? externalReplayRelease.output.composer_version
      : ordinaryComposerVersion,
    marketplace_profile_version: externalApplied
      ? externalReplayRelease.output.marketplace_profile_version
      : ordinaryProfileVersion,
    resolution_packet_sha256: resolutionPacketSha256,
    title,
    // The projection's own inputs live in the projection row.
    //
    // CSM's canonical object has ONE `print_finish` bracket -- the ladder's
    // output -- and no place for the three layers it was built from. But the
    // eBay rule "project the finish only when grounded" needs to know whether
    // the value came from a printed exact name, from colour plus family, or
    // from a bare colour. Storing only the bracket makes that decision
    // unreplayable: a withheld bare colour comes back as a projected exact.
    // Found by the replay check on 95 of 148 cards, not by reasoning.
    //
    // So the layers go here rather than into the canonical object, because
    // that is what they are: an input to a marketplace decision, not a fact
    // about the card that CSM is missing.
    structured_output: {
      sem,
      // No `evidence` key. `csm_marketplace_structured_check` forbids exactly
      // this name -- alongside `candidates`, `provider_response` and
      // `raw_model_response` -- because the marketplace row is a projection and
      // the evidence has its own system of record in
      // `csm_evidence_observations`, linked through
      // `csm_candidate_evidence_links`. The list of ids written here was never
      // read back by anything, and it made every atomic write fail the
      // constraint. Nothing caught that: the only suite covering the RPC skips
      // on CI for want of PostgreSQL, and could not start one locally either.
      // CSM identity grammar deliberately has only TCG/NON_TCG. Composition
      // has a third, orthogonal Lot grammar, so it must be persisted separately
      // instead of being guessed from NON_TCG during replay.
      composition_grammar: compositionGrammarName,
      // `lot_quantity` is in semLotTitleOrder but not in
      // semCanonicalEditableFields, so there is no bracket to persist it in and
      // a replayed lot came back as "Card Lot" with the count gone. Same class
      // as the finish layers: an input the composer needs that the canonical
      // field list does not carry.
      lot_count: fields.lot_count || "",
      ...(durableProjectionContract ? {
        publication_coverage: publicationCoverage,
        ...(founderBetaWebReceipt == null ? {} : {
          founder_beta_web_receipt: founderBetaWebReceipt
        }),
        ...(setCardNameRelationReceipt == null ? {} : {
          set_card_name_relation_receipt: setCardNameRelationReceipt
        })
      } : {}),
      ...(compositionGrammarName === "lot" && durableProjectionContract ? {
        lot_terminal: lotTerminalReceipt
      } : {}),
      // `search_optimization` in SEM carries RC / Auto / Patch / Relic and the
      // team, and nothing else -- a Jersey was lost on the way back because CSM
      // does not fold it in. Storing the components verbatim is narrower than
      // storing the whole field set and keeps the round trip honest.
      components: [...(fields.components || [])],
      // Canonical Naming may also carry independent marketplace search terms
      // that are neither components nor team (for example `Young Guns`). The
      // SEM bracket intentionally folds only components + team, so persist this
      // independent lane beside `components`; replay can restore all three
      // inputs without guessing which residual token was the team. Preserve
      // order and empty positions because the CNL trace binds source indexes.
      ...(!externalApplied
        && ordinaryComposerVersion === THIN_COMPOSER_VERSION
        && registeredCanonicalNamingProfileVersions.has(ordinaryProfileVersion)
        && independentSearchOptimization.length > 0
        ? { search_optimization: independentSearchOptimization }
        : {}),
      print_finish_layers: {
        parallel_exact: fields.parallel_exact || "",
        surface_color: fields.surface_color || "",
        parallel_family: fields.parallel_family || ""
      },
      ...(externalApplied ? {
        external_identity_support: {
          schema_version: externalIdentitySupport.schema_version,
          pack_id: externalIdentitySupport.pack_id,
          pack_version: externalIdentitySupport.pack_version,
          pack_sha256: externalIdentitySupport.pack_sha256,
          index_id: externalIdentitySupport.index_id,
          index_version: externalIdentitySupport.index_version,
          index_sha256: externalIdentitySupport.index_sha256,
          record_id: externalIdentitySupport.record_id,
          registry_release_id: registryReleaseId,
          resolution_contract_sha256: externalIdentitySupport.resolution_contract_sha256,
          match_mode: externalMatchMode,
          ...(externalOriginalSetSha256 ? {
            original_set_sha256: externalOriginalSetSha256
          } : {}),
          field_decisions: externalIdentitySupport.field_decisions
        }
      } : {}),
      ...(verifiedOriginalApplied ? {
        verified_original_observation_support: structuredClone(
          verifiedOriginalObservationSupport
        )
      } : {})
    },
    included_brackets: composed.brackets,
    // The full projection ledger, not just the drops: a bracket withheld by the
    // marketplace profile and a bracket dropped for budget are different
    // decisions and a replay has to be able to tell them apart.
    dropped_trace: {
      dropped_for_budget: composed.dropped,
      suppressed_by_profile: composed.suppressed,
      restored: composed.restored,
      truncated: composed.truncated,
      empty_at_input: composed.input_empty_fields,
      normalization_reason_codes: composed.normalization_reasons,
      character_budget: composed.character_budget,
      rendered_length: composed.length,
      ...(composed.canonical_naming_trace ? {
        canonical_naming: composed.canonical_naming_trace
      } : {})
    },
    ...stamp
  };

  output.id = rowId(
    recognitionSessionId, "output", contractVersion,
    output.composer_version, output.marketplace_profile_version, resolutionPacketSha256,
    contentDigest({ ...output, id: undefined, created_at: undefined })
  );

  const rows = { evidence, candidates, links, resolution, resolved, output };
  return { ...rows, session_hashes: computeCsmPacketHashes(rows) };
}

/**
 * Which of our field names feed one CSM bracket.
 *
 * Mostly one-to-one, with two renames and one genuine many-to-one: [Print
 * Finish] is composed from three layers, so uncertainty about ANY of them is
 * uncertainty about the bracket. The first version of this returned a single
 * name and quietly reported a flagged colour as a fully confident print finish.
 */
function schemaAliases(bracket) {
  if (bracket === "subject") return ["subjects"];
  if (bracket === "numerical_rarity") return ["serial"];
  if (bracket === "grading_info") return ["grading_info", "grade"];
  if (bracket === "print_finish") return ["surface_color", "parallel_family", "parallel_exact"];
  if (bracket === "search_optimization") return ["attributes", "team"];
  return [bracket];
}
