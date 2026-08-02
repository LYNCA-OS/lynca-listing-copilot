// Evaluation-only bundle of narrow, source-shaped recovery mechanisms.
//
// This module is deliberately outside the production thin path.  It may add
// a value only when a paid canonical response left the slot empty and the
// already-paid free/exhaustive evidence satisfies the mechanism's guard.

import { resolveKnowledgeEntry } from "../../listing-knowledge-registry.mjs";
import { applyAccuracyMechanismV2 } from "./accuracy-mechanism-bundle-v2.mjs";

export const ACCURACY_MECHANISM_BUNDLE_V3 = "accuracy-mechanism-bundle-v3";
export const ACCURACY_MECHANISM_NAMES_V3 = Object.freeze([
  "finish_family_color_only",
  "serial_single_digit",
  "rarity_sar_only",
  "printed_trainer_gallery",
  "printed_first_bowman",
  "product_known_manufacturer_extension",
  "attested_insert",
  "tcg_ip_logo_exact"
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function changedFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].sort().flatMap((field) => {
    const oldValue = before?.[field] ?? null;
    const newValue = after?.[field] ?? null;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return [];
    return [{ field, before: oldValue, after: newValue }];
  });
}

function replayAttestedInsert(fields = {}, observations = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (clean(next.card_name)) return { fields: next, changes };

  const candidate = (observations || [])
    .filter((observation) => observation?.label === "insert_name")
    .filter((observation) => observation?.kind === "printed_text")
    .filter((observation) => observation?.confidence === "high")
    .map((observation) => ({
      ...observation,
      value: clean(observation.evidence),
      entry: resolveKnowledgeEntry(observation.evidence)
    }))
    .find((observation) => (
      observation.entry?.type === "insert"
      && observation.value.length >= 2
      && observation.value.length <= 48
    ));
  if (!candidate) return { fields: next, changes };

  next.card_name = candidate.value;
  changes.push({ field: "card_name", value: candidate.value, source: candidate });
  return { fields: next, changes };
}

function replayTcgIpLogoExact(fields = {}, observations = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (clean(next.ip) || clean(next.grammar).toLowerCase() !== "tcg") return { fields: next, changes };

  const candidate = (observations || [])
    .filter((observation) => observation?.kind === "printed_text")
    .filter((observation) => observation?.label === "logo")
    .filter((observation) => observation?.confidence === "high")
    .map((observation) => clean(observation.evidence).toUpperCase())
    .map((value) => value === "DISNEY LORCANA" ? "Disney Lorcana" : value === "DISNEY" ? "Disney" : "")
    .find(Boolean);
  if (!candidate) return { fields: next, changes };

  next.ip = candidate;
  changes.push({ field: "ip", value: candidate });
  return { fields: next, changes };
}

export function applyAccuracyMechanismV3(name, fields = {}, {
  freeFields = {},
  freeTitle = "",
  observations = []
} = {}) {
  if (!ACCURACY_MECHANISM_NAMES_V3.includes(name)) {
    throw new Error(`unknown_accuracy_mechanism:${name}`);
  }
  const result = name === "attested_insert"
    ? replayAttestedInsert(fields, observations)
    : name === "tcg_ip_logo_exact"
      ? replayTcgIpLogoExact(fields, observations)
      : applyAccuracyMechanismV2(name, fields, { freeFields, freeTitle, observations });
  return {
    ...result,
    mechanism: name,
    bundle: ACCURACY_MECHANISM_BUNDLE_V3,
    authority: "evaluation_only",
    production_promoted: false
  };
}

export function applyAccuracyMechanismBundleV3(fields = {}, context = {}) {
  let current = structuredClone(fields || {});
  const changes = [];
  const changeDetails = [];
  for (const name of ACCURACY_MECHANISM_NAMES_V3) {
    const before = current;
    const result = applyAccuracyMechanismV3(name, current, context);
    if (result.changed || result.changes?.length) changes.push(name);
    current = result.fields;
    const fields = changedFields(before, current);
    if (fields.length) changeDetails.push({ mechanism: name, fields });
  }
  return {
    fields: current,
    changes,
    change_details: changeDetails,
    bundle: ACCURACY_MECHANISM_BUNDLE_V3,
    authority: "evaluation_only",
    production_promoted: false
  };
}
