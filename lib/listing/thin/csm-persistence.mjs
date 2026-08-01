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

import { SEM_STANDARD_VERSION, semCanonicalEditableFields } from "../csm/sem-definition.mjs";
import { toResolvedFields } from "./csm-emit.mjs";
import { resolvedFieldsToSemSuggestion } from "../csm/title-derived-sem.mjs";

export const CSM_STAGE_CONTRACT_VERSION = "csm-stage-shadow-v1";
export const THIN_RESOLVER_VERSION = "thin-path-observation-only-v1";
export const THIN_COMPOSER_VERSION = "thin-marketplace-composer-v1";
export const EBAY_PROFILE_VERSION = "ebay-profile-v1";

// The schema's own allowed values, restated here so a mismatch is a test
// failure rather than a constraint violation at insert time.
export const MODALITIES = Object.freeze(["WHOLE_CARD_VISUAL", "SLAB_LABEL", "CARD_TEXT_OCR", "REGISTRY"]);
export const EMPTY_REASONS = Object.freeze(["ABSENT", "INSUFFICIENT_EVIDENCE"]);
export const VALUE_KINDS = Object.freeze(["VALUE", "EMPTY"]);
export const CSM_BRACKETS = Object.freeze([...semCanonicalEditableFields]);

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rowId = (...parts) => sha256(parts.join("|")).slice(0, 32);

/**
 * One card's run, as rows.
 *
 * `sessionId` and `tenantId` are the caller's: the schema has a foreign key to
 * `v4_recognition_sessions`, so nothing here invents them.
 */
export function buildCsmStageRows({
  tenantId, recognitionSessionId, fields, composed, title,
  registryReleaseId = null, createdAt = null
}) {
  const sem = resolvedFieldsToSemSuggestion(toResolvedFields(fields));
  const unreadable = new Set(fields.unreadable || []);
  const uncertain = new Set(fields.low_confidence || []);
  const base = { tenant_id: tenantId, recognition_session_id: recognitionSessionId };
  const stamp = createdAt ? { created_at: createdAt } : {};

  const evidence = [];
  const candidates = [];
  const links = [];
  const resolved = [];

  for (const bracket of CSM_BRACKETS) {
    const value = sem[bracket];
    const present = Array.isArray(value) ? value.length > 0 : (value !== undefined && value !== null && value !== "");

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

    if (present) {
      const evidenceId = rowId(recognitionSessionId, bracket, "obs");
      evidence.push({
        id: evidenceId,
        ...base,
        contract_version: CSM_STAGE_CONTRACT_VERSION,
        bracket,
        raw_value: value,
        normalized_value: value,
        modality: "WHOLE_CARD_VISUAL",
        source_ref: { images: recognitionSessionId },
        observation_confidence: observationConfidence,
        normalization_version: SEM_STANDARD_VERSION,
        normalization_outcome: "NORMALIZED",
        normalization_reason_code: flagged ? "LOW_CONFIDENCE_OBSERVATION" : "DIRECT_OBSERVATION",
        ...stamp
      });

      const candidateId = rowId(recognitionSessionId, bracket, "cand");
      candidates.push({
        id: candidateId,
        ...base,
        contract_version: CSM_STAGE_CONTRACT_VERSION,
        bracket,
        value_kind: "VALUE",
        canonical_value: value,
        empty_reason: null,
        // Not TRUSTED: this is a model observation, which CSM classifies as a
        // heuristic prior, not a reviewed or catalog-backed fact.
        source_trust: "VISUAL_ONLY",
        candidate_confidence: observationConfidence,
        candidate_rank: 1,
        ...stamp
      });
      links.push({ ...base, candidate_id: candidateId, evidence_observation_id: evidenceId, relationship: "SUPPORTS", ...stamp });
    } else {
      candidates.push({
        id: rowId(recognitionSessionId, bracket, "cand"),
        ...base,
        contract_version: CSM_STAGE_CONTRACT_VERSION,
        bracket,
        value_kind: "EMPTY",
        canonical_value: null,
        empty_reason: emptyReason,
        source_trust: "VISUAL_ONLY",
        candidate_confidence: 0,
        candidate_rank: 1,
        ...stamp
      });
    }
  }

  const resolutionId = rowId(recognitionSessionId, "resolution");
  const recognitionPacket = { fields, sem };
  const resolution = {
    id: resolutionId,
    ...base,
    contract_version: CSM_STAGE_CONTRACT_VERSION,
    revision: 1,
    grammar: composed.grammar,
    registry_release_id: registryReleaseId,
    // This path does not resolve -- it observes and the single observation is
    // the resolution. Saying so in the version string keeps a later, real
    // resolver from being confused with it.
    resolver_version: THIN_RESOLVER_VERSION,
    conflict_policy_version: "none-single-observation-v1",
    recognition_packet_sha256: sha256(recognitionPacket),
    resolution_status: "COMPLETE",
    ...stamp
  };

  for (const candidate of candidates) {
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
      alternate_candidate_ids: [],
      rationale_codes: candidate.value_kind === "VALUE"
        ? [candidate.candidate_confidence < 0.8 ? "SINGLE_OBSERVATION_LOW_CONFIDENCE" : "SINGLE_OBSERVATION"]
        : [candidate.empty_reason],
      semantic_confidence: candidate.candidate_confidence,
      ...stamp
    });
  }

  const output = {
    id: rowId(recognitionSessionId, "output"),
    ...base,
    resolution_id: resolutionId,
    contract_version: CSM_STAGE_CONTRACT_VERSION,
    marketplace: composed.marketplace,
    composer_version: THIN_COMPOSER_VERSION,
    marketplace_profile_version: EBAY_PROFILE_VERSION,
    resolution_packet_sha256: sha256(resolved),
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
      evidence: evidence.map((row) => row.id),
      // `lot_quantity` is in semLotTitleOrder but not in
      // semCanonicalEditableFields, so there is no bracket to persist it in and
      // a replayed lot came back as "Card Lot" with the count gone. Same class
      // as the finish layers: an input the composer needs that the canonical
      // field list does not carry.
      lot_count: fields.lot_count || "",
      // `search_optimization` in SEM carries RC / Auto / Patch / Relic and the
      // team, and nothing else -- a Jersey was lost on the way back because CSM
      // does not fold it in. Storing the components verbatim is narrower than
      // storing the whole field set and keeps the round trip honest.
      components: [...(fields.components || [])],
      print_finish_layers: {
        parallel_exact: fields.parallel_exact || "",
        surface_color: fields.surface_color || "",
        parallel_family: fields.parallel_family || ""
      }
    },
    included_brackets: composed.brackets,
    // The full projection ledger, not just the drops: a bracket withheld by the
    // marketplace profile and a bracket dropped for budget are different
    // decisions and a replay has to be able to tell them apart.
    dropped_trace: {
      dropped_for_budget: composed.dropped,
      suppressed_by_profile: composed.suppressed,
      restored: composed.restored,
      truncated: composed.truncated
    },
    ...stamp
  };

  return { evidence, candidates, links, resolution, resolved, output };
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
  if (bracket === "grading_info") return ["grade"];
  if (bracket === "print_finish") return ["surface_color", "parallel_family", "parallel_exact"];
  return [bracket];
}
