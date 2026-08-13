import {
  validateExternalIdentityDecisionObservation,
  validateExternalIdentitySourceProvenance
} from "../knowledge/csm-external-identity-support.mjs";
import {
  CARD_NAME_PREDICATE,
  SET_CARD_NAME_RELATION_CONTRACT_VERSION,
  SET_MEMBERSHIP_PREDICATE,
  validateSetCardNameRelationReceipt
} from "./set-card-name-contract.mjs";
import {
  validateVerifiedOriginalObservationReceipt
} from "./verified-original-observation-support.mjs";
import { sanitizeListingTitle } from "./sanitize-listing-title.mjs";

const RELATION_FIELDS = Object.freeze([
  ["set", SET_MEMBERSHIP_PREDICATE],
  ["card_name", CARD_NAME_PREDICATE]
]);
const EXTERNAL_CHANGE_ACTIONS = new Set([
  "FILL", "CORROBORATE", "CORRECT_CONFLICT"
]);
const VERIFIED_CHANGE_ACTIONS = new Set([
  "FILL", "CORRECT_CONFLICT", "CLEAR_CONFLICT"
]);
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const canonical = (value) => sanitizeListingTitle(clean(value)).title;

function canonicalRelationFields(fields, label) {
  const result = {};
  for (const [field] of RELATION_FIELDS) {
    const value = fields?.[field];
    if (typeof value !== "string" || canonical(value) !== value) {
      throw new TypeError(`set_card_name_relation_${label}_noncanonical:${field}`);
    }
    result[field] = value;
  }
  return result;
}

function applied(receipt) {
  return receipt?.status === "APPLIED";
}

function providerFields(receipt) {
  return Object.fromEntries(RELATION_FIELDS.map(([field]) => [
    field, receipt?.[field]?.value ?? ""
  ]));
}

/** Project an already adapter-validated receipt through deterministic cleanup. */
export function projectSetCardNameRelationReceipt(providerReceipt, observedFields = {}) {
  // Re-establish the standalone receipt's structural and typed-predicate
  // integrity without claiming its pre-sanitizer values equal the observation.
  validateSetCardNameRelationReceipt(providerReceipt, providerFields(providerReceipt));
  const canonicalObservedFields = canonicalRelationFields(observedFields, "observed");
  const projected = {
    schema_version: SET_CARD_NAME_RELATION_CONTRACT_VERSION,
    set: null,
    card_name: null
  };
  for (const [field] of RELATION_FIELDS) {
    const expected = providerReceipt[field] == null ? "" : canonical(providerReceipt[field].value);
    if (expected !== canonicalObservedFields[field]) {
      throw new TypeError(`set_card_name_relation_sanitizer_projection_mismatch:${field}`);
    }
    if (!clean(expected)) continue;
    if (providerReceipt[field] == null) {
      throw new TypeError(`set_card_name_relation_sanitizer_projection_missing:${field}`);
    }
    projected[field] = {
      predicate: providerReceipt[field].predicate,
      value: canonicalObservedFields[field]
    };
  }
  return validateSetCardNameRelationReceipt(projected, canonicalObservedFields);
}

function validatedAuthorities({
  observedFields,
  resolvedFields,
  externalIdentitySupport,
  verifiedOriginalObservationSupport,
  verifiedOriginalResolvedProjection
}) {
  const authorities = [];
  if (applied(externalIdentitySupport)) {
    if (!validateExternalIdentitySourceProvenance(externalIdentitySupport)) {
      throw new TypeError("set_card_name_relation_authority_invalid:external_identity_source");
    }
    if (!validateExternalIdentityDecisionObservation(
      externalIdentitySupport, observedFields, resolvedFields
    )) {
      throw new TypeError("set_card_name_relation_authority_invalid:external_identity_decision");
    }
    authorities.push({
      kind: "external_identity",
      receipt: externalIdentitySupport,
      allowedFields: new Set(["set"]),
      allowedActions: EXTERNAL_CHANGE_ACTIONS
    });
  }
  if (applied(verifiedOriginalObservationSupport)) {
    if (!validateVerifiedOriginalObservationReceipt(
      verifiedOriginalObservationSupport, {
        observedFields,
        ...(verifiedOriginalResolvedProjection == null
          ? { resolvedFields }
          : { resolvedProjection: verifiedOriginalResolvedProjection })
      }
    )) {
      throw new TypeError("set_card_name_relation_authority_invalid:verified_original");
    }
    authorities.push({
      kind: "verified_original",
      receipt: verifiedOriginalObservationSupport,
      allowedFields: new Set(RELATION_FIELDS.map(([field]) => field)),
      allowedActions: VERIFIED_CHANGE_ACTIONS
    });
  }
  if (authorities.length > 1) {
    throw new TypeError("set_card_name_relation_authority_ambiguous");
  }
  return authorities;
}

/** Validate every Set/Card Name transition against one private resolver receipt. */
export function validateSetCardNameRelationTransition({
  observedFields = {},
  resolvedFields = {},
  externalIdentitySupport = null,
  verifiedOriginalObservationSupport = null,
  verifiedOriginalResolvedProjection = null
} = {}) {
  const canonicalObservedFields = canonicalRelationFields(observedFields, "observed");
  const canonicalResolvedFields = canonicalRelationFields(resolvedFields, "resolved");
  const authorities = validatedAuthorities({
    observedFields,
    resolvedFields,
    externalIdentitySupport,
    verifiedOriginalObservationSupport,
    verifiedOriginalResolvedProjection
  });
  for (const [field] of RELATION_FIELDS) {
    if (canonicalObservedFields[field] === canonicalResolvedFields[field]) continue;
    const eligible = authorities.filter((authority) => {
      const decision = authority.receipt?.field_decisions?.[field];
      return authority.allowedFields.has(field)
        && decision && typeof decision === "object" && !Array.isArray(decision)
        && authority.allowedActions.has(decision.action);
    });
    if (eligible.length !== 1) {
      throw new TypeError(eligible.length
        ? `set_card_name_relation_authority_ambiguous:${field}`
        : `set_card_name_relation_authority_missing:${field}`);
    }
  }
  return true;
}

/** Build the final relation without relabelling resolver authority as provider evidence. */
export function reconcileSetCardNameRelationReceipt({
  providerReceipt,
  observedFields = {},
  resolvedFields = {},
  externalIdentitySupport = null,
  verifiedOriginalObservationSupport = null,
  verifiedOriginalResolvedProjection = null
} = {}) {
  const observedReceipt = projectSetCardNameRelationReceipt(providerReceipt, observedFields);
  const canonicalObservedFields = canonicalRelationFields(observedFields, "observed");
  const canonicalResolvedFields = canonicalRelationFields(resolvedFields, "resolved");
  validateSetCardNameRelationTransition({
    observedFields,
    resolvedFields,
    externalIdentitySupport,
    verifiedOriginalObservationSupport,
    verifiedOriginalResolvedProjection
  });
  const finalReceipt = {
    schema_version: SET_CARD_NAME_RELATION_CONTRACT_VERSION,
    set: null,
    card_name: null
  };
  for (const [field, predicate] of RELATION_FIELDS) {
    if (canonicalObservedFields[field] === canonicalResolvedFields[field]) {
      finalReceipt[field] = observedReceipt[field];
    } else if (canonicalResolvedFields[field]) {
      finalReceipt[field] = { predicate, value: canonicalResolvedFields[field] };
    }
  }
  return validateSetCardNameRelationReceipt(finalReceipt, canonicalResolvedFields);
}

/** Cross-bind a final durable receipt to the observed→resolved transition. */
export function validateResolvedSetCardNameRelationReceipt({
  receipt,
  observedFields = {},
  resolvedFields = {},
  externalIdentitySupport = null,
  verifiedOriginalObservationSupport = null,
  verifiedOriginalResolvedProjection = null
} = {}) {
  const canonicalResolvedFields = canonicalRelationFields(resolvedFields, "resolved");
  validateSetCardNameRelationReceipt(receipt, canonicalResolvedFields);
  for (const [field] of RELATION_FIELDS) {
    if (receipt[field] != null && receipt[field].value !== canonicalResolvedFields[field]) {
      throw new TypeError(`set_card_name_relation_value_noncanonical:${field}`);
    }
  }
  validateSetCardNameRelationTransition({
    observedFields,
    resolvedFields,
    externalIdentitySupport,
    verifiedOriginalObservationSupport,
    verifiedOriginalResolvedProjection
  });
  return receipt;
}
