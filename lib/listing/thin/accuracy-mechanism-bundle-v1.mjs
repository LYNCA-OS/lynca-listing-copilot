// Evaluation-only accuracy overlays discovered from the 150-card replay.
//
// This module is intentionally not imported by the production thin path. It
// accepts only already-stored model fields/title/observations and returns a
// temporary field overlay. The canonical object is never mutated and every
// rule is narrower than a generic free-field merge.

import { replaySerialObservationSingleDigitV1 } from "./candidate-identity-replay-v1.mjs";

export const ACCURACY_MECHANISM_BUNDLE_V1 = "accuracy-mechanism-bundle-v1";
export const ACCURACY_MECHANISM_NAMES = Object.freeze([
  "finish_family_color_only",
  "serial_single_digit",
  "rarity_sar_only",
  "printed_trainer_gallery",
  "printed_first_bowman",
  "product_known_manufacturer_extension"
]);

const clean = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const words = (value) => clean(value).split(/\s+/).filter(Boolean);
const same = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase();
const FINISH_FAMILY = /\b(?:refractor|prizm|prism|wave|mojo|shimmer|foil|holo|sparkle|speckle|vinyl|pulsar|raywave|parallel|cracked|ice)\b/i;
const KNOWN_MANUFACTURERS = new Set(["topps", "panini", "upper deck", "leaf"]);

function explicitFreeMarker(title, marker) {
  return new RegExp(`\\b${marker.replace(/\s+/g, "\\s+")}\\b`, "i").test(title);
}

function finishFamilyColorOnly(fields, freeFields) {
  const color = clean(fields.surface_color);
  const existing = clean(fields.print_finish);
  const candidate = clean(freeFields.print_finish);
  if (!color || !same(existing, color) || clean(fields.parallel_family)) return null;
  if (!candidate || same(candidate, existing) || !candidate.toLowerCase().startsWith(`${color.toLowerCase()} `)) return null;
  if (!FINISH_FAMILY.test(candidate)) return null;
  return { print_finish: candidate, parallel_exact: candidate };
}

function rarity(fields, freeFields, value) {
  return !clean(fields.descriptive_rarity) && same(freeFields.descriptive_rarity, value)
    ? { descriptive_rarity: value }
    : null;
}

function printedTrainerGallery(fields, freeTitle) {
  return fields.grammar === "tcg"
    && !clean(fields.card_name)
    && explicitFreeMarker(freeTitle, "Trainer Gallery")
    ? { card_name: "Trainer Gallery" }
    : null;
}

function printedFirstBowman(fields, freeTitle) {
  return /bowman/i.test(`${fields.product || ""} ${fields.set || ""}`)
    && !clean(fields.descriptive_rarity)
    && explicitFreeMarker(freeTitle, "1st Bowman")
    ? { descriptive_rarity: "1st Bowman" }
    : null;
}

function productKnownManufacturerExtension(fields, freeFields) {
  const manufacturer = words(fields.manufacturer);
  const existing = words(fields.product);
  const candidate = words(freeFields.product);
  if (!manufacturer.length || !KNOWN_MANUFACTURERS.has(manufacturer.join(" ").toLowerCase())) return null;
  if (!existing.length || candidate.length <= existing.length) return null;
  if (candidate[0].toLowerCase() !== manufacturer[0].toLowerCase()) return null;
  const candidateText = candidate.join(" ").toLowerCase();
  if (!existing.every((word) => candidateText.includes(word.toLowerCase()))) return null;
  return { product: freeFields.product };
}

const overlays = Object.freeze({
  finish_family_color_only: (fields, freeFields) => finishFamilyColorOnly(fields, freeFields),
  serial_single_digit: (fields, _freeFields, observations) => {
    const replay = replaySerialObservationSingleDigitV1(fields, observations);
    return replay.changes.length ? replay.fields : null;
  },
  rarity_sar_only: (fields, freeFields) => rarity(fields, freeFields, "SAR"),
  printed_trainer_gallery: (fields, _freeFields, _observations, freeTitle) => printedTrainerGallery(fields, freeTitle),
  printed_first_bowman: (fields, _freeFields, _observations, freeTitle) => printedFirstBowman(fields, freeTitle),
  product_known_manufacturer_extension: (fields, freeFields) => productKnownManufacturerExtension(fields, freeFields)
});

export function applyAccuracyMechanismV1(name, fields = {}, {
  freeFields = {},
  freeTitle = "",
  observations = []
} = {}) {
  if (!ACCURACY_MECHANISM_NAMES.includes(name)) throw new Error(`unknown_accuracy_mechanism:${name}`);
  const original = structuredClone(fields || {});
  const proposed = overlays[name](original, freeFields || {}, observations || [], freeTitle);
  const overlay = proposed && proposed.fields ? proposed.fields : proposed;
  const next = overlay ? { ...original, ...structuredClone(overlay) } : original;
  return {
    fields: next,
    changed: Boolean(overlay),
    mechanism: name,
    bundle: ACCURACY_MECHANISM_BUNDLE_V1,
    authority: "evaluation_only",
    production_promoted: false
  };
}

export function applyAccuracyMechanismBundleV1(fields = {}, context = {}) {
  let current = structuredClone(fields || {});
  const changes = [];
  for (const name of ACCURACY_MECHANISM_NAMES) {
    const result = applyAccuracyMechanismV1(name, current, context);
    if (result.changed) changes.push(name);
    current = result.fields;
  }
  return {
    fields: current,
    changes,
    bundle: ACCURACY_MECHANISM_BUNDLE_V1,
    authority: "evaluation_only",
    production_promoted: false
  };
}
