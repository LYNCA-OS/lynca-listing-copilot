// Evaluation-only bridge for the proposed accuracy lane:
// free expression -> SEM/CSM-shaped candidate -> canonical Composer.
//
// It never calls a provider, mutates the input object, or becomes production
// authority. The caller supplies an already parsed expression (freeFields),
// optional visible identity facts, and optional exact observations. Every
// accepted change is still projected through CSM's own field mapper and the
// deterministic Composer before it is returned.

import { semCanonicalEditableFields } from "../csm/sem-definition.mjs";
import { resolvedFieldsToSemSuggestion } from "../csm/title-derived-sem.mjs";
import { toResolvedFields } from "./csm-emit.mjs";
import { composeFromCanonicalFields } from "./canonical-composer.mjs";
import { applyAccuracyMechanismV2 } from "./accuracy-mechanism-bundle-v2.mjs";
import { replayCandidateIdentityV3 } from "./candidate-identity-replay-v3.mjs";
import { replaySerialObservationSingleDigitV1 } from "./candidate-identity-replay-v1.mjs";

export const ACCURACY_EXPRESSION_OVERLAY_V1 = "accuracy-expression-overlay-v1";
export const DEFAULT_EXPRESSION_MECHANISMS = Object.freeze([
  "finish_family_color_only",
  "product_known_manufacturer_extension"
]);

const clone = (value) => structuredClone(value ?? {});

function semProjection(fields) {
  return resolvedFieldsToSemSuggestion(toResolvedFields(fields));
}

function unknownSemFields(sem) {
  const allowed = new Set(semCanonicalEditableFields);
  return Object.keys(sem).filter((name) => !allowed.has(name));
}

/**
 * Apply only narrow, previously screened expression overlays.
 *
 * `expressionFields` is the output of the SEM title/parser projection; it is
 * not trusted merely because it came from a free-form model answer. The
 * existing V2 gates decide which fields may extend the canonical observation.
 */
export function applyAccuracyExpressionOverlayV1(canonicalFields = {}, {
  expressionFields = {},
  expressionTitle = "",
  candidateFacts = [],
  observations = [],
  mechanisms = DEFAULT_EXPRESSION_MECHANISMS,
  includeSerial = true
} = {}) {
  const original = clone(canonicalFields);
  let fields = clone(original);
  const changes = [];
  const rejected = [];

  const identity = replayCandidateIdentityV3(fields, candidateFacts);
  fields = identity.fields;
  if (identity.changes.length) changes.push({ mechanism: "candidate_identity_v3", details: identity.changes });

  for (const mechanism of mechanisms) {
    const result = applyAccuracyMechanismV2(mechanism, fields, {
      freeFields: expressionFields,
      freeTitle: expressionTitle,
      observations
    });
    if (result.blocked) rejected.push({ mechanism, reason: result.blocked });
    if (result.changed) changes.push({ mechanism });
    fields = result.fields;
  }

  if (includeSerial) {
    const serial = replaySerialObservationSingleDigitV1(fields, observations);
    if (serial.changes.length) {
      fields = serial.fields;
      changes.push({ mechanism: "serial_single_digit_v1", details: serial.changes });
    }
  }

  const sem = semProjection(fields);
  const unknown = unknownSemFields(sem);
  if (unknown.length) {
    return {
      fields: original,
      sem: semProjection(original),
      composed: composeFromCanonicalFields(original),
      changes: [],
      rejected: [...rejected, { mechanism: "sem_projection", reason: "unknown_sem_fields", fields: unknown }],
      overlay: ACCURACY_EXPRESSION_OVERLAY_V1,
      authority: "evaluation_only",
      production_promoted: false
    };
  }

  const composed = composeFromCanonicalFields(fields);
  if (composed.length > 80) {
    rejected.push({ mechanism: "composer", reason: "title_over_80" });
    return {
      fields: original,
      sem: semProjection(original),
      composed: composeFromCanonicalFields(original),
      changes: [],
      rejected,
      overlay: ACCURACY_EXPRESSION_OVERLAY_V1,
      authority: "evaluation_only",
      production_promoted: false
    };
  }

  return {
    fields,
    sem,
    composed,
    changes,
    rejected,
    overlay: ACCURACY_EXPRESSION_OVERLAY_V1,
    authority: "evaluation_only",
    production_promoted: false
  };
}
