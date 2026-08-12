// Rebuild the output from stored rows alone.
//
// COS-25's acceptance criterion is "every downstream layer can be replayed from
// stored evidence and version references". That one cannot be retrofitted: a
// pipeline that persists a summary instead of the inputs is unreplayable
// forever, and you only find out when you need to re-derive something.
//
// So this takes ONLY the rows -- no original provider payload, no in-memory
// fields object -- and reconstructs the canonical object and the composed
// title. If it disagrees with what was shipped, either persistence dropped
// something or composition is not deterministic, and the check says which.
//
// What it deliberately does not do is call the model again. Replay is about
// the layers below recognition; the observation itself is the one thing that
// cannot be replayed, which is exactly why the evidence rows exist.

import { composeFromCanonicalFields } from "./canonical-composer.mjs";
import {
  composeLyncaStandardNameForProfile,
  LYNCA_STANDARD_PROFILE_VERSION_V1,
  LYNCA_STANDARD_PROFILE_VERSION_V2
} from "./canonical-naming-adapter.mjs";
import { MARKETPLACE_PROFILES } from "./marketplace-composer-rules.mjs";
import {
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  externalIdentityReplayReleaseForReceipt,
  validateExternalIdentityEvidenceSourceRef,
  validateExternalIdentityFieldDecisions
} from "../knowledge/csm-external-identity-support.mjs";
import {
  CSM_BRACKETS,
  COMPOSITION_GRAMMARS,
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  EBAY_PROFILE_VERSION,
  LYNCA_STANDARD_CHARACTER_BUDGET,
  THIN_COMPOSER_VERSION,
  THIN_COMPOSER_VERSION_V1,
  THIN_COMPOSER_VERSION_V2,
  computeCsmPacketHashes,
  csmIdentityGrammarForComposition
} from "./csm-persistence.mjs";
import {
  validateVerifiedOriginalObservationReceipt,
  validateVerifiedOriginalObservationReceiptShape,
  validateVerifiedOriginalObservationSourceRef,
  verifiedOriginalObservationOverrideFieldsForBracket,
  verifiedOriginalObservationReplayProjection,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT,
  VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
} from "./verified-original-observation-support.mjs";
import {
  validateLotTerminalReceipt
} from "./lot-terminal-contract.mjs";
import { validatePublicationCoverage } from "./publication-coverage.mjs";

export class CsmReplayError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.name = "CsmReplayError";
    this.code = code;
    this.detail = detail;
  }
}

// A stored version selects executable rules explicitly. Falling through to the
// current implementation would make an old row silently change meaning after
// a deployment, which is the opposite of replay.
const EXTERNAL_IDENTITY_REPLAY_V1 =
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v1;
const EXTERNAL_IDENTITY_REPLAY_V2 =
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v2;

// Profile implementations are versioned replay code too. Keep this v1 literal
// beside its historical dispatch entry; an active marketplace profile may be
// replaced later without changing titles reconstructed from v1 rows.
const EBAY_VERIFIED_EXTERNAL_IDENTITY_REPLAY_PROFILE_V1 = Object.freeze({
  id: "ebay-verified-external-identity-v1",
  characterBudget: 80,
  suppress: Object.freeze({
    card_number: Object.freeze([]),
    search_optimization: Object.freeze([])
  }),
  retainWithinSuppressed: Object.freeze({})
});
const EBAY_VERIFIED_EXTERNAL_IDENTITY_REPLAY_PROFILE_V2 = Object.freeze({
  id: "ebay-verified-external-identity-v2",
  characterBudget: 80,
  suppress: Object.freeze({
    card_number: Object.freeze([]),
    search_optimization: Object.freeze([])
  }),
  retainWithinSuppressed: Object.freeze({})
});

function composeLyncaStandardReplay(fields, marketplaceProfileVersion, output) {
  if (fields?.grammar !== "standard") {
    throw new CsmReplayError(
      "unsupported_composition_grammar_for_version",
      `${THIN_COMPOSER_VERSION}/${fields?.grammar || "missing"}`
    );
  }
  return composeLyncaStandardNameForProfile(fields, {
    marketplaceProfileVersion,
    publicationCoverage: output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION
  });
}

const COMPOSER_DISPATCH = Object.freeze({
  [THIN_COMPOSER_VERSION_V1]: Object.freeze({
    [EBAY_PROFILE_VERSION]: (fields, output) => composeFromCanonicalFields(fields, {
      profile: MARKETPLACE_PROFILES.ebay,
      features: {
        exact_parallel_color_compaction: false,
        durable_lot_terminal_shared_only: output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
        publication_coverage: output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION
      }
    })
  }),
  [THIN_COMPOSER_VERSION_V2]: Object.freeze({
    [EBAY_PROFILE_VERSION]: (fields, output) => composeFromCanonicalFields(fields, {
      profile: MARKETPLACE_PROFILES.ebay,
      features: {
        durable_lot_terminal_shared_only: output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
        publication_coverage: output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION
      }
    })
  }),
  [THIN_COMPOSER_VERSION]: Object.freeze({
    [LYNCA_STANDARD_PROFILE_VERSION_V1]: (fields, output) => composeLyncaStandardReplay(
      fields, LYNCA_STANDARD_PROFILE_VERSION_V1, output
    ),
    [LYNCA_STANDARD_PROFILE_VERSION_V2]: (fields, output) => composeLyncaStandardReplay(
      fields, LYNCA_STANDARD_PROFILE_VERSION_V2, output
    )
  }),
  [EXTERNAL_IDENTITY_REPLAY_V1.output.composer_version]: Object.freeze({
    [EXTERNAL_IDENTITY_REPLAY_V1.output.marketplace_profile_version]: (fields, output) => composeFromCanonicalFields(fields, {
      profile: EBAY_VERIFIED_EXTERNAL_IDENTITY_REPLAY_PROFILE_V1,
      features: {
        verified_external_identity_title: true,
        publication_coverage: output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION
      }
    })
  }),
  [EXTERNAL_IDENTITY_REPLAY_V2.output.composer_version]: Object.freeze({
    [EXTERNAL_IDENTITY_REPLAY_V2.output.marketplace_profile_version]: (fields, output) => composeFromCanonicalFields(fields, {
      profile: EBAY_VERIFIED_EXTERNAL_IDENTITY_REPLAY_PROFILE_V2,
      features: {
        verified_external_identity_title: true,
        verified_external_identity_priority_v2: true,
        publication_coverage: output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION
      }
    })
  })
});

function replayComposer(output) {
  const byProfile = COMPOSER_DISPATCH[output?.composer_version];
  const compose = byProfile?.[output?.marketplace_profile_version];
  if (!compose) {
    throw new CsmReplayError("unsupported_replay_version",
      `${output?.composer_version || "missing"}/${output?.marketplace_profile_version || "missing"}`);
  }
  if (output?.marketplace !== "EBAY") {
    throw new CsmReplayError("unsupported_marketplace", output?.marketplace || "missing");
  }
  return compose;
}

/**
 * Compose corrected canonical fields with the exact executable contract that
 * produced a stored output. Resolution review must not silently upgrade an
 * old title to today's Composer while claiming the old version in provenance.
 */
export function composeCanonicalFieldsForStoredOutput(fields, output) {
  return replayComposer(output)(fields, output);
}

function replayCompositionGrammar(rows) {
  const identityGrammar = rows?.resolution?.grammar;
  const stored = rows?.output?.structured_output?.composition_grammar;
  let grammar = String(stored || "").trim().toLowerCase();

  if (!grammar) {
    // Backward compatibility for rows written before composition_grammar was
    // persisted. TCG identity is unambiguous. Under composer v1 every Lot title
    // includes the non-droppable `lot` bracket, so the projection ledger safely
    // distinguishes Lot from Standard. Anything less is ambiguous and closed.
    if (identityGrammar === "TCG") grammar = "tcg";
    else if (identityGrammar === "NON_TCG"
      && Array.isArray(rows?.output?.included_brackets)
      && rows.output.included_brackets.length > 0) {
      grammar = rows.output.included_brackets.includes("lot") ? "lot" : "standard";
    } else {
      throw new CsmReplayError("composition_grammar_missing_or_ambiguous", identityGrammar || "missing");
    }
  }

  if (!COMPOSITION_GRAMMARS.includes(grammar)) {
    throw new CsmReplayError("unsupported_composition_grammar", grammar);
  }
  if (csmIdentityGrammarForComposition(grammar) !== identityGrammar) {
    throw new CsmReplayError("identity_composition_grammar_mismatch", `${identityGrammar}/${grammar}`);
  }
  return grammar;
}

// CSM bracket -> the field name the composer reads. The inverse of the map in
// csm-persistence, and it has the same many-to-one problem in reverse: [Print
// Finish] was stored as one bracket and the composer wants the three layers
// back, so the stored value is returned as `parallel_exact` -- the layer that
// renders verbatim. Round-tripping it through colour and family would be
// guessing which parts of "Gold Refractor" were which.
const FIELD_FOR_BRACKET = Object.freeze({
  subject: "subjects",
  grading_info: "grade",
  numerical_rarity: "serial",
  search_optimization: "team"
});

/**
 * @param rows as produced by `buildCsmStageRows`
 * @returns { fields, title, grammar } rebuilt from the rows
 */
export function replayFromRows(rows, { allowUnsealedMutation = false } = {}) {
  const compose = (fields) => composeCanonicalFieldsForStoredOutput(fields, rows?.output);
  const compositionGrammar = replayCompositionGrammar(rows);
  const durableStage = rows?.output?.contract_version === CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
  const resolved = rows.resolved || [];
  const fields = {
    subjects: [], attributes: [], components: [], unreadable: [], low_confidence: [],
    grammar: compositionGrammar, lot_count: "",
    // EMPTY rows are legitimate evidence, not absent object keys. Preserve the
    // full scalar shape so server-built review snapshots can bind a correction
    // to the actual empty value instead of accepting a value for a field that
    // replay made disappear.
    year: "", manufacturer: "", product: "", set: "", card_name: "",
    release_variant: "", descriptive_rarity: "", card_number: "", serial: "",
    team: "", special_stamp: "", description: "", language: "",
    parallel_exact: "", surface_color: "", parallel_family: "", print_finish: "",
    grading_info: null, grade: "", search_optimization: []
  };

  for (const row of resolved) {
    const name = FIELD_FOR_BRACKET[row.bracket] || row.bracket;
    if (row.selected_kind === "EMPTY") {
      // The stored reason is what makes the two empties distinguishable on the
      // way back. Losing it here would make a replayed object claim the card
      // lacks a field when the record says it was merely unreadable.
      if (row.empty_reason === "INSUFFICIENT_EVIDENCE") fields.unreadable.push(row.bracket);
      continue;
    }
    const value = row.canonical_value;
    // [Print Finish] is restored from the layers the projection row kept, not
    // from the bracket: the bracket holds the ladder's OUTPUT and the eBay rule
    // needs its inputs. Without this a withheld bare colour replays as a
    // projected exact name.
    if (row.bracket === "print_finish") continue;
    // `grading_info` is an object in SEM ({ card_grade, auto_grade, ... }), and
    // stringifying it produced "[object Object]" in a composed title.
    if (row.bracket === "grading_info") {
      if (typeof value === "object" && value) {
        const company = value.company || value.grade_company || "";
        const cardGrade = value.card_grade || "";
        const autoGrade = value.auto_grade || "";
        fields.grading_info = {
          company: String(company),
          card_grade: String(cardGrade),
          auto_grade: String(autoGrade),
          grade_type: String(value.grade_type || "")
        };
        if (fields.grading_info.grade_type === "AUTO_ONLY") {
          fields.grade = [company, "Auto", autoGrade || cardGrade].filter(Boolean).join(" ");
        } else if (fields.grading_info.grade_type === "AUTHENTIC_WITH_AUTO") {
          fields.grade = `${[company, "Authentic"].filter(Boolean).join(" ")}${autoGrade ? `/${autoGrade}` : ""}`;
        } else {
          fields.grade = cardGrade && autoGrade
            ? `${[company, cardGrade].filter(Boolean).join(" ")}/${autoGrade}`
            : [company, cardGrade || autoGrade].filter(Boolean).join(" ");
        }
      } else {
        fields.grade = String(value);
      }
      continue;
    }
    if (name === "subjects") fields.subjects = Array.isArray(value) ? value : [value];
    else if (name === "team") fields.team = Array.isArray(value) ? value.join(" ") : String(value);
    else fields[name] = Array.isArray(value) ? value.join(" ") : String(value);

    // Low semantic confidence on the way in was a flagged field; restore that
    // so a replayed object carries the same review state as the original.
    if (row.semantic_confidence !== undefined && row.semantic_confidence < 0.8) {
      fields.low_confidence.push(row.bracket);
    }
  }

  // The SEM `search_optimization` bracket collapses its fixed component
  // vocabulary and the team. Use only its non-component residual as team;
  // components themselves are restored verbatim from the projection below.
  const search = resolved.find((row) => row.bracket === "search_optimization");
  if (search && Array.isArray(search.canonical_value)) {
    const COMPONENTS = new Set(["RC", "Auto", "Patch", "Relic", "Jersey"]);
    fields.team = search.canonical_value.filter((value) => !COMPONENTS.has(value)).join(" ");
  }
  // Components come from the projection row, not inferred back out of
  // search_optimization: that bracket drops Jersey and fixes the order.
  fields.components = [...(rows.output?.structured_output?.components || [])];
  fields.attributes = [...fields.components];
  // Independent search terms are projection inputs of their own. They cannot
  // be recovered from the SEM search bracket because every non-component
  // residual there is the team; treating `Young Guns` as a team would corrupt
  // both fields. Historical rows predate this optional lane and replay as [].
  fields.search_optimization = Array.isArray(
    rows.output?.structured_output?.search_optimization
  ) ? [...rows.output.structured_output.search_optimization] : [];
  // `ip_sport` is the CSM name; the composer's bracket is `ip`.
  const ipRow = resolved.find((row) => row.bracket === "ip_sport" && row.selected_kind === "VALUE");
  if (ipRow) fields.ip = Array.isArray(ipRow.canonical_value) ? ipRow.canonical_value.join(" ") : String(ipRow.canonical_value);

  fields.lot_count = rows.output?.structured_output?.lot_count || "";
  const lotTerminal = rows.output?.structured_output?.lot_terminal;
  const storedPublicationCoverage = rows.output?.structured_output?.publication_coverage;
  if (durableStage) {
    try {
      validatePublicationCoverage(storedPublicationCoverage);
    } catch {
      throw new CsmReplayError("publication_coverage_receipt_invalid");
    }
    if (compositionGrammar === "lot" && lotTerminal == null) {
      throw new CsmReplayError("lot_terminal_receipt_missing");
    }
  } else if (storedPublicationCoverage != null) {
    throw new CsmReplayError("publication_coverage_receipt_outside_contract");
  }
  if (compositionGrammar === "lot" && lotTerminal != null) {
    try {
      validateLotTerminalReceipt(lotTerminal, { lotCount: fields.lot_count });
    } catch {
      throw new CsmReplayError("lot_terminal_receipt_invalid");
    }
    fields.lot_unshared_attributes = [...lotTerminal.lot_unshared_attributes];
  } else if (compositionGrammar !== "lot" && lotTerminal != null) {
    throw new CsmReplayError("lot_terminal_receipt_outside_lot");
  }
  const layers = rows.output?.structured_output?.print_finish_layers;
  if (layers) {
    fields.parallel_exact = layers.parallel_exact || "";
    fields.surface_color = layers.surface_color || "";
    fields.parallel_family = layers.parallel_family || "";
    fields.print_finish = fields.parallel_exact
      || (fields.surface_color && fields.parallel_family
        ? (fields.parallel_family.toLowerCase().includes(fields.surface_color.toLowerCase())
          ? fields.surface_color : `${fields.surface_color} ${fields.parallel_family}`)
        : fields.surface_color || fields.parallel_family || "");
  }

  const recomposed = compose(fields);
  if (compositionGrammar === "lot" && lotTerminal == null
      && (recomposed.lot_quantity_unresolved || recomposed.lot_single_card)) {
    throw new CsmReplayError("lot_terminal_receipt_missing");
  }
  if (compositionGrammar === "lot" && lotTerminal != null) {
    const replayedUnshared = [...new Set(recomposed.lot_unshared_attributes || [])].sort();
    const storedUnshared = [...new Set(lotTerminal.lot_unshared_attributes)].sort();
    if (JSON.stringify(replayedUnshared) !== JSON.stringify(storedUnshared)
        || recomposed.lot_quantity_unresolved !== lotTerminal.lot_quantity_unresolved
        || recomposed.lot_single_card !== lotTerminal.lot_single_card) {
      throw new CsmReplayError("lot_terminal_replay_mismatch");
    }
  }
  if (durableStage) {
    try {
      validatePublicationCoverage(recomposed.publication_coverage);
    } catch {
      throw new CsmReplayError("publication_coverage_recompute_invalid");
    }
    const normalizeCoverageForReplay = (coverage) => ({
      ...coverage,
      atoms: (coverage?.atoms || []).map((atom) => (
        atom.bracket === "grading_info"
          ? { ...atom, source_field: "grading_info" }
          : atom.bracket === "print_finish"
          && fields.parallel_exact
          && String(fields.parallel_exact).includes(atom.canonical_value)
          ? { ...atom, canonical_value: fields.parallel_exact }
          : atom
      ))
    });
    if (!allowUnsealedMutation
        && JSON.stringify(canonicalJsonValue(normalizeCoverageForReplay(storedPublicationCoverage)))
        !== JSON.stringify(canonicalJsonValue(normalizeCoverageForReplay(
          recomposed.publication_coverage
        )))) {
      throw new CsmReplayError("publication_coverage_replay_mismatch");
    }
  }
  const composed = lotTerminal == null ? recomposed : {
    ...recomposed,
    lot_terminal_durable: true,
    lot_quantity_unresolved: lotTerminal.lot_quantity_unresolved,
    lot_single_card: lotTerminal.lot_single_card,
    lot_unshared_attributes: [...lotTerminal.lot_unshared_attributes],
    lot_publishable: lotTerminal.publishable,
    lot_publication_failure_code: lotTerminal.failure_code ?? null
  };
  if (durableStage) composed.publication_coverage_durable = true;
  return { fields, title: composed.title, grammar: composed.grammar, composed };
}

function packetHashProblems(rows) {
  const computed = computeCsmPacketHashes(rows);
  const session = rows?.session_hashes || rows?.session;
  const problems = [];
  const checks = [
    ["recognition", "resolution.recognition_packet_sha256", rows?.resolution?.recognition_packet_sha256,
      computed.csm_recognition_packet_sha256],
    ["resolution", "output.resolution_packet_sha256", rows?.output?.resolution_packet_sha256,
      computed.csm_resolution_packet_sha256]
  ];

  if (!session || typeof session !== "object") {
    problems.push({ kind: "session_packet_hashes_missing" });
  } else {
    checks.push(
      ["recognition", "session.csm_recognition_packet_sha256", session.csm_recognition_packet_sha256,
        computed.csm_recognition_packet_sha256],
      ["resolution", "session.csm_resolution_packet_sha256", session.csm_resolution_packet_sha256,
        computed.csm_resolution_packet_sha256],
      ["marketplace", "session.csm_marketplace_packet_sha256", session.csm_marketplace_packet_sha256,
        computed.csm_marketplace_packet_sha256]
    );
  }

  for (const [packet, source, stored, actual] of checks) {
    if (!stored) problems.push({ kind: "packet_hash_missing", packet, source });
    else if (stored !== actual) problems.push({ kind: "packet_hash_mismatch", packet, source, stored, actual });
  }
  return problems;
}

function externalIdentityProblems(rows) {
  const problems = [];
  const output = rows?.output;
  const metadata = output?.structured_output?.external_identity_support;
  const knownExternalOutputVersion = Object.values(
    EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
  ).some((release) => (
    output?.composer_version === release.output.composer_version
      || output?.marketplace_profile_version === release.output.marketplace_profile_version
  ));
  if (!knownExternalOutputVersion && metadata == null) return problems;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [{ kind: "external_identity_receipt_missing_or_unexpected" }];
  }

  const release = externalIdentityReplayReleaseForReceipt(metadata);
  if (!release) {
    return [{
      kind: "external_identity_replay_release_unsupported",
      registry_release_id: String(metadata.registry_release_id || "") || null
    }];
  }

  for (const [field, value] of Object.entries(release.receipt)) {
    if (metadata[field] !== value) {
      problems.push({ kind: "external_identity_receipt_mismatch", field });
    }
  }
  for (const [field, value] of Object.entries(release.output)) {
    if (output?.[field] !== value) {
      problems.push({ kind: "external_identity_output_receipt_mismatch", field });
    }
  }
  if (!String(metadata.record_id || "").trim()) {
    problems.push({ kind: "external_identity_record_id_missing" });
  }
  if (!release.match_modes.includes(metadata.match_mode)) {
    problems.push({ kind: "external_identity_match_mode_invalid" });
  } else if (metadata.match_mode === "VERIFIED_ORIGINAL_SET") {
    if (!/^[0-9a-f]{64}$/.test(String(metadata.original_set_sha256 || ""))) {
      problems.push({ kind: "external_identity_original_set_sha256_invalid" });
    }
  } else if (metadata.original_set_sha256 != null) {
    problems.push({ kind: "external_identity_original_set_sha256_unexpected" });
  }
  if (!validateExternalIdentityFieldDecisions(metadata)) {
    problems.push({ kind: "external_identity_field_decisions_invalid" });
  }
  for (const [field, value] of Object.entries(release.resolution)) {
    if (rows?.resolution?.[field] !== value) {
      problems.push({ kind: "external_identity_resolution_receipt_mismatch", field });
    }
  }

  const registryEvidence = (rows?.evidence || []).filter(
    (row) => row?.modality === "REGISTRY" || row?.source_ref?.support_type === "EXACT_EXTERNAL_IDENTITY"
  );
  if (registryEvidence.length === 0) {
    problems.push({ kind: "external_identity_registry_evidence_missing" });
  }
  for (const row of registryEvidence) {
    const source = row?.source_ref || {};
    for (const field of [
      "pack_id", "pack_version", "pack_sha256", "index_id", "index_version", "index_sha256",
      "record_id", "registry_release_id", "resolution_contract_sha256", "match_mode"
    ]) {
      if (source[field] !== metadata[field]) {
        problems.push({ kind: "external_identity_evidence_receipt_mismatch", field, bracket: row?.bracket });
      }
    }
    if ((source.original_set_sha256 ?? null) !== (metadata.original_set_sha256 ?? null)) {
      problems.push({
        kind: "external_identity_evidence_receipt_mismatch",
        field: "original_set_sha256",
        bracket: row?.bracket
      });
    }
    if (!validateExternalIdentityEvidenceSourceRef(metadata, source)) {
      problems.push({
        kind: "external_identity_source_provenance_invalid",
        bracket: row?.bracket,
        field: String(source?.field || "") || null
      });
    }
  }
  if (validateExternalIdentityFieldDecisions(metadata)) {
    const bracketForField = (field) => ({
      subjects: "subject",
      team: "search_optimization"
    })[field] || field;
    const absent = (value) => Array.isArray(value)
      ? value.length === 0
      : !String(value ?? "").trim();
    const searchComponents = (Array.isArray(output?.structured_output?.components)
      ? output.structured_output.components
      : []).filter((value) => ["RC", "Auto", "Patch", "Relic"].includes(value));
    const teamResidual = (actual) => {
      if (!Array.isArray(actual)) return null;
      const remaining = [...actual];
      for (const component of searchComponents) {
        const index = remaining.indexOf(component);
        if (index >= 0) remaining.splice(index, 1);
      }
      return remaining;
    };
    const rowValueMatches = (field, actual, expected) => {
      if (field === "team") {
        const residual = teamResidual(actual);
        const expectedResidual = absent(expected) ? [] : [expected];
        return Array.isArray(residual)
          && residual.length === expectedResidual.length
          && residual.every((value, index) => value === expectedResidual[index]);
      }
      if (Array.isArray(actual) || Array.isArray(expected)) {
        return Array.isArray(actual) && Array.isArray(expected)
          && actual.length === expected.length
          && actual.every((value, index) => value === expected[index]);
      }
      return actual === expected;
    };
    const exactValueMatches = (actual, expected) => {
      if (Array.isArray(actual) || Array.isArray(expected)) {
        return Array.isArray(actual) && Array.isArray(expected)
          && actual.length === expected.length
          && actual.every((value, index) => value === expected[index]);
      }
      return actual === expected;
    };
    for (const field of Object.keys(metadata.field_decisions)) {
      const matchingRows = registryEvidence.filter((row) => row?.source_ref?.field === field);
      if (matchingRows.length !== 1) {
        problems.push({
          kind: "external_identity_field_evidence_cardinality_invalid",
          field,
          count: matchingRows.length
        });
      }
      const decision = metadata.field_decisions[field];
      const bracket = bracketForField(field);
      if (matchingRows.length === 1 && (
        matchingRows[0]?.modality !== "REGISTRY"
        || matchingRows[0]?.bracket !== bracket
        || !exactValueMatches(matchingRows[0]?.raw_value, decision.canonical_value)
        || !rowValueMatches(field, matchingRows[0]?.normalized_value, decision.canonical_value)
      )) {
        problems.push({
          kind: "external_identity_registry_value_mismatch",
          field,
          bracket
        });
      }
      const visualRows = (rows?.evidence || []).filter((row) => (
        row?.modality === "WHOLE_CARD_VISUAL" && row?.bracket === bracket
      ));
      const expectedVisualCount = field === "team"
        ? (searchComponents.length || !absent(decision.observed_value) ? 1 : 0)
        : (absent(decision.observed_value) ? 0 : 1);
      if (visualRows.length !== expectedVisualCount
          || (visualRows.length === 1 && (!rowValueMatches(
            field,
            visualRows[0]?.raw_value,
            decision.observed_value
          ) || !rowValueMatches(
            field,
            visualRows[0]?.normalized_value,
            decision.observed_value
          )))) {
        problems.push({
          kind: "external_identity_observed_evidence_mismatch",
          field,
          bracket,
          count: visualRows.length
        });
      }
      const resolvedRows = (rows?.resolved || []).filter((row) => row?.bracket === bracket);
      if (resolvedRows.length !== 1
          || resolvedRows[0]?.selected_kind !== "VALUE"
          || !rowValueMatches(field, resolvedRows[0]?.canonical_value, decision.canonical_value)) {
        problems.push({
          kind: "external_identity_resolved_value_mismatch",
          field,
          bracket,
          count: resolvedRows.length
        });
      }
    }
    for (const row of registryEvidence) {
      const field = String(row?.source_ref?.field || "");
      if (!Object.hasOwn(metadata.field_decisions, field)) {
        problems.push({ kind: "external_identity_field_evidence_unexpected", field: field || null });
      }
    }
  }
  return problems;
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== "";
}

function verifiedOriginalProblems(rows, replayed = null) {
  const problems = [];
  const output = rows?.output;
  const metadata = output?.structured_output?.verified_original_observation_support;
  const supportEvidence = (rows?.evidence || []).filter((row) => (
    row?.source_ref?.support_type === "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"
  ));
  const reviewedCandidates = (rows?.candidates || []).filter((row) => (
    row?.source_trust === "REVIEWED_CLOSED_PROJECTION_EXACT"
  ));
  const resolverSignal = rows?.resolution?.resolver_version
      === VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
    || rows?.resolution?.conflict_policy_version
      === VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION;

  if (metadata == null && !resolverSignal
      && supportEvidence.length === 0 && reviewedCandidates.length === 0) return problems;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [{ kind: "verified_original_receipt_missing_or_unexpected" }];
  }
  if (output?.structured_output?.external_identity_support != null) {
    problems.push({ kind: "post_observation_resolution_overlap" });
  }
  if (!validateVerifiedOriginalObservationReceiptShape(metadata)) {
    return [...problems, { kind: "verified_original_receipt_invalid" }];
  }
  if (rows?.resolution?.resolver_version !== VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION) {
    problems.push({ kind: "verified_original_resolver_version_mismatch" });
  }
  if (rows?.resolution?.conflict_policy_version
      !== VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION) {
    problems.push({ kind: "verified_original_conflict_policy_version_mismatch" });
  }
  if (rows?.resolution?.grammar !== "NON_TCG") {
    problems.push({ kind: "verified_original_identity_grammar_mismatch" });
  }
  const composerContract = VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT
    .composer_contract;
  if (output?.composer_version !== composerContract.composer_version
      || output?.marketplace_profile_version !== composerContract.marketplace_profile_version
      || output?.structured_output?.composition_grammar !== "standard") {
    problems.push({ kind: "verified_original_composer_contract_mismatch" });
  }
  const observedProjection = verifiedOriginalObservationReplayProjection(
    metadata.observed_fields
  );

  let projectionEvidence = null;
  if (supportEvidence.length !== 1) {
    problems.push({
      kind: "verified_original_projection_evidence_cardinality_invalid",
      count: supportEvidence.length
    });
  } else {
    projectionEvidence = supportEvidence[0];
    if (projectionEvidence?.bracket !== VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET
        || projectionEvidence?.modality !== "REGISTRY"
        || projectionEvidence?.normalization_version !== metadata.release_id
        || projectionEvidence?.normalization_reason_code
          !== "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"
        || projectionEvidence?.observation_confidence !== 1
        || !validateVerifiedOriginalObservationSourceRef(
          metadata,
          projectionEvidence?.source_ref,
          VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET
        )) {
      problems.push({ kind: "verified_original_projection_evidence_invalid" });
    }
  }

  const expectedBrackets = new Set();
  for (const bracket of CSM_BRACKETS) {
    const fields = verifiedOriginalObservationOverrideFieldsForBracket(metadata, bracket);
    if (fields.length === 0) continue;
    expectedBrackets.add(bracket);

    const candidates = reviewedCandidates.filter((row) => row?.bracket === bracket);
    if (candidates.length !== 1) {
      problems.push({
        kind: "verified_original_reviewed_candidate_cardinality_invalid",
        bracket,
        count: candidates.length
      });
      continue;
    }
    const candidate = candidates[0];
    const present = valuePresent(candidate?.canonical_value);
    const expectedKind = present ? "VALUE" : "EMPTY";
    if (candidate?.value_kind !== expectedKind
        || candidate?.empty_reason !== (present ? null : "ABSENT")
        || candidate?.candidate_rank !== 1
        || candidate?.candidate_confidence !== 1) {
      problems.push({ kind: "verified_original_reviewed_candidate_invalid", bracket });
    }
    if (bracket === VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET
        && projectionEvidence) {
      const row = projectionEvidence;
      const expectedNormalized = present ? candidate.canonical_value : null;
      if (!sameCanonicalValue(row?.raw_value, expectedNormalized)
          || !sameCanonicalValue(row?.normalized_value, expectedNormalized)
          || row?.normalization_outcome !== (present ? "KEPT" : "DROPPED")) {
        problems.push({
          kind: "verified_original_evidence_normalization_mismatch",
          bracket
        });
      }
    }
    const reviewedLinks = (rows?.links || []).filter((link) => (
      link?.candidate_id === candidate.id
    ));
    const observedValue = observedProjection.sem?.[bracket];
    const visualEvidence = (rows?.evidence || []).filter((row) => (
      row?.modality === "WHOLE_CARD_VISUAL" && row?.bracket === bracket
    ));
    const corroboratedVisual = valuePresent(observedValue)
      && sameCanonicalValue(candidate.canonical_value, observedValue)
      && visualEvidence.length === 1;
    const expectedEvidenceIds = new Set([
      projectionEvidence?.id,
      ...(corroboratedVisual ? [visualEvidence[0].id] : [])
    ].filter(Boolean));
    if (reviewedLinks.length !== expectedEvidenceIds.size
        || reviewedLinks.some((link) => (
          !expectedEvidenceIds.has(link?.evidence_observation_id)
            || link?.relationship !== "SUPPORTS"
        ))) {
      problems.push({
        kind: "verified_original_evidence_link_set_invalid",
        bracket,
        count: reviewedLinks.length
      });
    }

    const resolvedRows = (rows?.resolved || []).filter((row) => row?.bracket === bracket);
    if (resolvedRows.length !== 1) {
      problems.push({
        kind: "verified_original_resolved_cardinality_invalid",
        bracket,
        count: resolvedRows.length
      });
    } else {
      const resolvedRow = resolvedRows[0];
      if (resolvedRow.selected_kind !== candidate.value_kind
          || !sameCanonicalValue(resolvedRow.canonical_value, candidate.canonical_value)
          || resolvedRow.empty_reason !== candidate.empty_reason
          || resolvedRow.selected_candidate_id !== (present ? candidate.id : null)
          || !sameCanonicalValue(
            resolvedRow.rationale_codes,
            ["EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"]
          )
          || resolvedRow.semantic_confidence !== 1) {
        problems.push({ kind: "verified_original_resolved_selection_invalid", bracket });
      }
    }
  }
  for (const candidate of reviewedCandidates) {
    if (!expectedBrackets.has(candidate?.bracket)) {
      problems.push({
        kind: "verified_original_reviewed_candidate_unexpected",
        bracket: candidate?.bracket || null
      });
    }
  }
  const projectionLinks = projectionEvidence ? (rows?.links || []).filter((link) => (
    link?.evidence_observation_id === projectionEvidence.id
  )) : [];
  if (projectionEvidence && (projectionLinks.length !== expectedBrackets.size
      || projectionLinks.some((link) => !reviewedCandidates.some((candidate) => (
        candidate.id === link?.candidate_id
          && candidate.bracket && expectedBrackets.has(candidate.bracket)
          && link?.relationship === "SUPPORTS"
      ))))) {
    problems.push({
      kind: "verified_original_projection_evidence_link_set_invalid",
      count: projectionLinks.length
    });
  }

  for (const bracket of CSM_BRACKETS) {
    const expected = observedProjection.sem?.[bracket];
    const visualRows = (rows?.evidence || []).filter((row) => (
      row?.modality === "WHOLE_CARD_VISUAL" && row?.bracket === bracket
    ));
    const expectedCount = valuePresent(expected) ? 1 : 0;
    if (visualRows.length !== expectedCount
        || (expectedCount === 1 && (
          !sameCanonicalValue(visualRows[0]?.raw_value, expected)
            || !sameCanonicalValue(visualRows[0]?.normalized_value, expected)
        ))) {
      problems.push({
        kind: "verified_original_observed_visual_evidence_mismatch",
        bracket,
        count: visualRows.length
      });
    }
  }

  if (replayed && !validateVerifiedOriginalObservationReceipt(metadata, {
    observedFields: metadata.observed_fields,
    resolvedProjection: verifiedOriginalObservationReplayProjection(replayed.fields)
  })) {
    problems.push({ kind: "verified_original_replayed_projection_mismatch" });
  }
  return problems;
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalJsonValue(value[key])]));
}

function canonicalNamingTraceProblems(rows, replayed) {
  const output = rows?.output;
  if (output?.composer_version !== THIN_COMPOSER_VERSION
      || ![LYNCA_STANDARD_PROFILE_VERSION_V1, LYNCA_STANDARD_PROFILE_VERSION_V2]
        .includes(output?.marketplace_profile_version)) return [];

  const problems = [];
  const recomposed = replayed?.composed;
  const replayedTitle = String(replayed?.title ?? recomposed?.title ?? "");
  if (recomposed?.canonical_naming_publishable !== true) {
    problems.push({
      kind: "canonical_naming_output_not_publishable",
      failure_code: recomposed?.canonical_naming_failure_code || null
    });
  }
  if (!replayedTitle.trim()) problems.push({ kind: "canonical_naming_title_empty" });
  if (recomposed?.canonical_naming_failure_code) {
    problems.push({
      kind: "canonical_naming_failure_code_present",
      failure_code: recomposed.canonical_naming_failure_code
    });
  }
  if (!Number.isInteger(recomposed?.length) || recomposed.length !== replayedTitle.length) {
    problems.push({ kind: "canonical_naming_rendered_length_mismatch" });
  }
  if (output?.title !== replayedTitle) {
    problems.push({ kind: "canonical_naming_stored_title_mismatch" });
  }

  const storedBudget = output?.dropped_trace?.character_budget;
  if (storedBudget !== LYNCA_STANDARD_CHARACTER_BUDGET
      || recomposed?.character_budget !== LYNCA_STANDARD_CHARACTER_BUDGET
      || storedBudget !== recomposed?.character_budget) {
    problems.push({
      kind: "canonical_naming_character_budget_mismatch",
      stored: storedBudget ?? null,
      replayed: recomposed?.character_budget ?? null
    });
  }
  if (output?.dropped_trace?.rendered_length !== replayedTitle.length) {
    problems.push({ kind: "canonical_naming_stored_length_mismatch" });
  }

  const stored = output?.dropped_trace?.canonical_naming;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    problems.push({ kind: "canonical_naming_trace_missing" });
    return problems;
  }
  const recomputed = recomposed?.canonical_naming_trace;
  if (!recomputed || typeof recomputed !== "object" || Array.isArray(recomputed)) {
    problems.push({ kind: "canonical_naming_trace_recompute_missing" });
    return problems;
  }
  if (JSON.stringify(canonicalJsonValue(stored)) !== JSON.stringify(canonicalJsonValue(recomputed))) {
    problems.push({ kind: "canonical_naming_trace_mismatch" });
  }
  return problems;
}

/**
 * Validate the persisted CNL decision trace against a deterministic replay.
 * This narrow export lets a DB read model verify the trace without pretending
 * that its partial row bundle is the complete hash-sealed CSM packet.
 */
export function validateCanonicalNamingReplayTrace(output, composed) {
  return canonicalNamingTraceProblems({ output }, { composed }).length === 0;
}

/**
 * Validate only the durable external-identity packet used by product readback.
 *
 * The detailed problems intentionally stay private to this module: the Glass
 * Box needs a fail-closed boolean, not a way to echo stored observed values or
 * Registry payloads into its public response.
 */
export function validateExternalIdentityReplayPacket(rows) {
  return externalIdentityProblems(rows).length === 0;
}

/**
 * Validate the complete durable closed-projection lineage used by historical
 * readback. This dispatch is release-registry based and intentionally does not
 * consult the active fresh-writer gate.
 */
export function validateVerifiedOriginalObservationReplayPacket(rows) {
  if (verifiedOriginalProblems(rows).length > 0) return false;
  let replayed;
  try {
    replayed = replayFromRows(rows);
  } catch {
    return false;
  }
  return verifiedOriginalProblems(rows, replayed).length === 0;
}

/**
 * Did the replay reproduce what shipped?
 *
 * Reports the specific disagreement rather than a boolean: "replay failed" is
 * not actionable, "replay lost print_finish" is.
 */
export function verifyReplay(rows, originalTitle) {
  const problems = [
    ...packetHashProblems(rows),
    ...externalIdentityProblems(rows),
    ...verifiedOriginalProblems(rows)
  ];

  // Every bracket the resolution recorded must come back. A bracket that
  // vanishes between store and replay is persistence losing data, which is the
  // failure this whole exercise exists to make visible.
  const storedBrackets = new Set((rows.resolved || []).map((row) => row.bracket));
  for (const bracket of CSM_BRACKETS) {
    if (!storedBrackets.has(bracket)) problems.push({ kind: "bracket_not_persisted", bracket });
  }

  // Never execute a composer over rows whose persisted packet chain is broken.
  // The caller still gets exact hash/bracket diagnostics, but no result that
  // could be mistaken for a trusted replay.
  if (problems.length > 0) return { ok: false, problems, replayed: null };

  let replayed;
  try {
    replayed = replayFromRows(rows);
  } catch (error) {
    if (error instanceof CsmReplayError) {
      problems.push({ kind: error.code, detail: error.detail });
      return { ok: false, problems, replayed: null };
    }
    throw error;
  }

  problems.push(...canonicalNamingTraceProblems(rows, replayed));
  problems.push(...verifiedOriginalProblems(rows, replayed));

  if (replayed.title !== originalTitle) {
    problems.push({
      kind: "title_mismatch",
      stored: rows.output?.title ?? null,
      original: originalTitle,
      replayed: replayed.title
    });
  }
  if (rows.output && rows.output.title !== originalTitle) {
    problems.push({ kind: "stored_title_mismatch", stored: rows.output.title, original: originalTitle });
  }

  return { ok: problems.length === 0, problems, replayed };
}
