// Evaluation-only recovery for the human-audited high100 schema-compression
// direct-evidence lane. This module reads retained observations only; it is not
// imported by the production thin path and never calls a provider.

export const ACCURACY_SCHEMA73_OVERLAY_V1 = "accuracy-schema73-overlay-v1";
export const ACCURACY_SCHEMA73_MECHANISMS = Object.freeze([
  "exact_season_suffix",
  "front_same_value_serial",
  "typed_exact_admission"
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const copy = (value) => structuredClone(value ?? {});

function observationRows(observations) {
  return Array.isArray(observations) ? observations : [];
}

function exactSeasonSuffix(fields, observations) {
  const next = copy(fields);
  const changes = [];
  const year = clean(next.year);
  if (!/^\d{4}$/.test(year)) return { fields: next, changes };

  const expectedSuffix = String((Number(year) + 1) % 100).padStart(2, "0");
  const candidate = observationRows(observations)
    .filter((row) => row?.kind === "printed_text" && row?.confidence === "high")
    .filter((row) => ["card_back", "slab_label"].includes(row?.region))
    .filter((row) => ["set", "year_set", "copyright_set_line"].includes(row?.label))
    .map((row) => {
      const match = clean(row.evidence).match(/\b((?:19|20)\d{2})-(\d{2})\b/);
      return match ? { row, start: match[1], suffix: match[2] } : null;
    })
    .filter(Boolean)
    .find(({ start, suffix }) => start === year && suffix === expectedSuffix);

  if (!candidate) return { fields: next, changes };
  next.year = `${year}-${expectedSuffix}`;
  changes.push({
    field: "year",
    before: year,
    value: next.year,
    reason_code: "exact_next_season_suffix",
    source: candidate.row
  });
  return { fields: next, changes };
}

function serialParts(value) {
  const match = clean(value).replace(/\s*\/\s*/g, "/").match(/^(\d{1,5})\/(\d{1,5})$/);
  return match ? {
    text: `${match[1]}/${match[2]}`,
    numeratorText: match[1],
    denominatorText: match[2],
    numerator: Number(match[1]),
    denominator: Number(match[2])
  } : null;
}

function frontSameValueSerial(fields, observations) {
  const next = copy(fields);
  const changes = [];
  const existing = serialParts(next.serial);
  if (!existing || existing.numeratorText.length !== 2) return { fields: next, changes };

  const candidate = observationRows(observations)
    .filter((row) => row?.kind === "printed_text" && row?.confidence === "high")
    .filter((row) => row?.region === "card_front")
    .filter((row) => ["serial_number", "stamped_number"].includes(row?.label))
    .map((row) => ({ row, serial: serialParts(row.evidence) }))
    .filter(({ serial }) => serial?.numeratorText.length === 3 && serial.numeratorText.startsWith("0"))
    .find(({ serial }) => serial.numerator === existing.numerator
      && serial.denominator === existing.denominator);

  if (!candidate || candidate.serial.text === existing.text) return { fields: next, changes };
  next.serial = candidate.serial.text;
  changes.push({
    field: "serial",
    before: existing.text,
    value: candidate.serial.text,
    reason_code: "front_exact_serial_same_numeric_value",
    same_numeric_value: true,
    source: candidate.row
  });
  return { fields: next, changes };
}

const TYPED_EXACT_REGISTRY = Object.freeze([
  Object.freeze({
    id: "topps_chrome_nbl_logo",
    matches: (row) => row?.label === "logo"
      && row?.kind === "printed_text"
      && row?.confidence === "high"
      && row?.region === "card_front"
      && clean(row.evidence).toUpperCase() === "NBL",
    patch: (fields) => /^topps$/i.test(clean(fields.manufacturer))
      && /\bchrome\b/i.test(clean(fields.product))
      && !clean(fields.set)
      ? [{ field: "set", value: "NBL" }]
      : null
  }),
  Object.freeze({
    id: "topps_tribute_home_run_derby",
    matches: (row) => ["event", "event_logo_text"].includes(row?.label)
      && row?.kind === "printed_text"
      && row?.confidence === "high"
      && row?.region === "card_front"
      && /\bHOME RUN DERBY\b/i.test(clean(row.evidence)),
    patch: (fields) => /^topps$/i.test(clean(fields.manufacturer))
      && /\btribute\b/i.test(clean(fields.product))
      && !clean(fields.release_variant)
      ? [{ field: "release_variant", value: "Derby" }]
      : null
  }),
  Object.freeze({
    id: "topps_signature_class_pick_number",
    matches: (row) => row?.label === "unknown"
      && row?.kind === "printed_text"
      && row?.confidence === "high"
      && row?.region === "card_front"
      && /^PICK\s+\d{1,2}$/i.test(clean(row.evidence)),
    patch: (fields, row) => /^topps$/i.test(clean(fields.manufacturer))
      && /\bsignature class\b/i.test(clean(fields.product))
      && !clean(fields.card_name)
      ? [{ field: "card_name", value: clean(row.evidence).replace(/^pick/i, "Pick") }]
      : null
  }),
  Object.freeze({
    id: "bowman_prospect_first_semantic_compaction",
    matches: (row) => row?.label === "stamped_number"
      && row?.kind === "printed_text"
      && row?.confidence === "high"
      && row?.region === "card_front"
      && clean(row.evidence).toUpperCase() === "1ST",
    patch: (fields) => /^topps$/i.test(clean(fields.manufacturer))
      && /\bbowman chrome\b/i.test(clean(fields.product))
      && /^chrome prospect autograph$/i.test(clean(fields.set))
      && Array.isArray(fields.components)
      && fields.components.some((value) => /^auto$/i.test(clean(value)))
      ? [{
        field: "set",
        value: "Prospect 1st",
        sanctioned_title_losses: ["autograph"],
        semantic_retained_by: "Auto component; Chrome product"
      }]
      : null
  }),
  Object.freeze({
    id: "donruss_optic_team_role_compaction",
    matches: (row) => row?.label === "logo"
      && row?.kind === "printed_text"
      && row?.confidence === "high"
      && row?.region === "card_front"
      && clean(row.evidence).toUpperCase() === "OPTIC",
    patch: (fields) => /^panini$/i.test(clean(fields.manufacturer))
      && /^donruss football$/i.test(clean(fields.product))
      && /^legendary logos$/i.test(clean(fields.set))
      && clean(fields.card_name)
      && clean(fields.card_name).toLowerCase() === clean(fields.team).toLowerCase()
      ? [{ field: "product", value: "Donruss Optic Football" }, {
        field: "card_name",
        value: "",
        sanctioned_title_losses: clean(fields.card_name).toLowerCase().split(/\s+/),
        semantic_retained_by: "identical Team field; marketplace team suppression"
      }]
      : null
  })
]);

function typedExactAdmission(fields, observations) {
  const next = copy(fields);
  const changes = [];
  for (const entry of TYPED_EXACT_REGISTRY) {
    const source = observationRows(observations).find(entry.matches);
    const patches = source ? entry.patch(next, source) : null;
    for (const patch of patches || []) {
      const before = next[patch.field] ?? "";
      next[patch.field] = patch.value;
      changes.push({
        ...patch,
        before,
        reason_code: entry.id,
        source
      });
    }
  }
  return { fields: next, changes };
}

const APPLY = Object.freeze({
  exact_season_suffix: exactSeasonSuffix,
  front_same_value_serial: frontSameValueSerial,
  typed_exact_admission: typedExactAdmission
});

export function applyAccuracySchema73MechanismV1(name, fields = {}, { observations = [] } = {}) {
  if (!ACCURACY_SCHEMA73_MECHANISMS.includes(name)) {
    throw new Error(`unknown_accuracy_schema73_mechanism:${name}`);
  }
  const result = APPLY[name](fields, observations);
  return {
    ...result,
    mechanism: name,
    overlay: ACCURACY_SCHEMA73_OVERLAY_V1,
    authority: "evaluation_only",
    production_promoted: false
  };
}

export function applyAccuracySchema73OverlayV1(fields = {}, {
  observations = [],
  mechanisms = ACCURACY_SCHEMA73_MECHANISMS
} = {}) {
  let current = copy(fields);
  const changes = [];
  for (const name of mechanisms) {
    const result = applyAccuracySchema73MechanismV1(name, current, { observations });
    current = result.fields;
    if (result.changes.length) changes.push({ mechanism: name, details: result.changes });
  }
  return {
    fields: current,
    changes,
    overlay: ACCURACY_SCHEMA73_OVERLAY_V1,
    authority: "evaluation_only",
    production_promoted: false
  };
}
