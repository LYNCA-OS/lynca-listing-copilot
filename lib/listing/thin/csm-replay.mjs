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
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION,
  THIN_COMPOSER_VERSION_V1,
  computeCsmPacketHashes,
  csmIdentityGrammarForComposition
} from "./csm-persistence.mjs";

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

const COMPOSER_DISPATCH = Object.freeze({
  [THIN_COMPOSER_VERSION_V1]: Object.freeze({
    [EBAY_PROFILE_VERSION]: (fields) => composeFromCanonicalFields(fields, {
      profile: MARKETPLACE_PROFILES.ebay,
      features: { exact_parallel_color_compaction: false }
    })
  }),
  [THIN_COMPOSER_VERSION]: Object.freeze({
    [EBAY_PROFILE_VERSION]: (fields) => composeFromCanonicalFields(fields, {
      profile: MARKETPLACE_PROFILES.ebay
    })
  }),
  [EXTERNAL_IDENTITY_REPLAY_V1.output.composer_version]: Object.freeze({
    [EXTERNAL_IDENTITY_REPLAY_V1.output.marketplace_profile_version]: (fields) => composeFromCanonicalFields(fields, {
      profile: EBAY_VERIFIED_EXTERNAL_IDENTITY_REPLAY_PROFILE_V1,
      features: { verified_external_identity_title: true }
    })
  }),
  [EXTERNAL_IDENTITY_REPLAY_V2.output.composer_version]: Object.freeze({
    [EXTERNAL_IDENTITY_REPLAY_V2.output.marketplace_profile_version]: (fields) => composeFromCanonicalFields(fields, {
      profile: EBAY_VERIFIED_EXTERNAL_IDENTITY_REPLAY_PROFILE_V2,
      features: {
        verified_external_identity_title: true,
        verified_external_identity_priority_v2: true
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
  return replayComposer(output)(fields);
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
export function replayFromRows(rows) {
  const compose = (fields) => composeCanonicalFieldsForStoredOutput(fields, rows?.output);
  const compositionGrammar = replayCompositionGrammar(rows);
  const resolved = rows.resolved || [];
  const fields = {
    subjects: [], attributes: [], components: [], unreadable: [], low_confidence: [],
    grammar: compositionGrammar, lot_count: ""
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

  // `search_optimization` collapses RC / Auto / Patch / Relic and the team into
  // one bracket, so the components come back out of it rather than from a
  // components column that the schema does not have.
  const search = resolved.find((row) => row.bracket === "search_optimization");
  if (search && Array.isArray(search.canonical_value)) {
    const COMPONENTS = new Set(["RC", "Auto", "Patch", "Relic", "Jersey"]);
    fields.team = search.canonical_value.filter((value) => !COMPONENTS.has(value)).join(" ");
  }
  // Components come from the projection row, not inferred back out of
  // search_optimization: that bracket drops Jersey and fixes the order.
  fields.components = [...(rows.output?.structured_output?.components || [])];
  fields.attributes = [...fields.components];
  // `ip_sport` is the CSM name; the composer's bracket is `ip`.
  const ipRow = resolved.find((row) => row.bracket === "ip_sport" && row.selected_kind === "VALUE");
  if (ipRow) fields.ip = Array.isArray(ipRow.canonical_value) ? ipRow.canonical_value.join(" ") : String(ipRow.canonical_value);

  fields.lot_count = rows.output?.structured_output?.lot_count || "";
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

  const composed = compose(fields);
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

/**
 * Did the replay reproduce what shipped?
 *
 * Reports the specific disagreement rather than a boolean: "replay failed" is
 * not actionable, "replay lost print_finish" is.
 */
export function verifyReplay(rows, originalTitle) {
  const problems = [
    ...packetHashProblems(rows),
    ...externalIdentityProblems(rows)
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
