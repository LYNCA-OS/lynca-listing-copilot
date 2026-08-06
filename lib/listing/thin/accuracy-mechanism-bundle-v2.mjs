// Evaluation-only safety refinement over accuracy-mechanism-bundle-v1.
//
// Fresh mixed-cohort confirmation found two explainable false promotions:
// a finish candidate whose serial denominator conflicted with canonical, and
// a product extension on Lot grammar that displaced subjects. This wrapper
// blocks exactly those cases and delegates all other mechanisms to v1.

import {
  ACCURACY_MECHANISM_NAMES,
  applyAccuracyMechanismV1
} from "./accuracy-mechanism-bundle-v1.mjs";

export const ACCURACY_MECHANISM_BUNDLE_V2 = "accuracy-mechanism-bundle-v2";

const serialDenominator = (value) => {
  const match = String(value ?? "").replace(/\s+/g, " ").match(/\/\s*(\d{1,5})\b/);
  return match ? Number(match[1]) : null;
};

function finishSerialCompatible(fields, freeFields) {
  const canonical = serialDenominator(fields.serial);
  const candidate = serialDenominator(freeFields.serial);
  return canonical === null || candidate === null || canonical === candidate;
}

function blocked(name, fields, freeFields) {
  if (name === "finish_family_color_only" && !finishSerialCompatible(fields, freeFields)) {
    return "serial_denominator_conflict";
  }
  if (name === "product_known_manufacturer_extension"
      && (String(fields.grammar || "").toLowerCase() === "lot" || String(fields.lot_count || "").trim())) {
    return "lot_product_extension_disallowed";
  }
  return null;
}

export function applyAccuracyMechanismV2(name, fields = {}, {
  freeFields = {},
  freeTitle = "",
  observations = []
} = {}) {
  if (!ACCURACY_MECHANISM_NAMES.includes(name)) throw new Error(`unknown_accuracy_mechanism:${name}`);
  const reason = blocked(name, fields, freeFields);
  if (reason) {
    return {
      fields: structuredClone(fields || {}),
      changed: false,
      mechanism: name,
      bundle: ACCURACY_MECHANISM_BUNDLE_V2,
      authority: "evaluation_only",
      production_promoted: false,
      blocked: reason
    };
  }
  const result = applyAccuracyMechanismV1(name, fields, { freeFields, freeTitle, observations });
  return { ...result, bundle: ACCURACY_MECHANISM_BUNDLE_V2 };
}

export function applyAccuracyMechanismBundleV2(fields = {}, context = {}) {
  let current = structuredClone(fields || {});
  const changes = [];
  const blockedReasons = [];
  for (const name of ACCURACY_MECHANISM_NAMES) {
    const result = applyAccuracyMechanismV2(name, current, context);
    if (result.changed) changes.push(name);
    if (result.blocked) blockedReasons.push({ mechanism: name, reason: result.blocked });
    current = result.fields;
  }
  return {
    fields: current,
    changes,
    blocked: blockedReasons,
    bundle: ACCURACY_MECHANISM_BUNDLE_V2,
    authority: "evaluation_only",
    production_promoted: false
  };
}
