// Evaluation-only, label-blind adapter for the v3 residual visible-evidence lane.
// It can replay already-captured candidates through frozen narrow mechanisms,
// but it has no provider, persistence, runtime, or production authority.

import { createHash } from "node:crypto";

import { resolveKnowledgeEntry } from "../../lib/listing-knowledge-registry.mjs";
import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";
import { applyAccuracyMechanismBundleV3 } from "../../lib/listing/thin/accuracy-mechanism-bundle-v3.mjs";
import { projectFreeTitleThroughCsm } from "../../scripts/measure-free-title-csm-projection.mjs";
import { resolveCapturedModelResidualV2 } from "./model-residual-big-head-v2.mjs";
import {
  MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3,
  MODEL_RESIDUAL_CANDIDATE_ROLES_V3
} from "./model-residual-candidate-lane-v3.mjs";

export const MODEL_RESIDUAL_VISIBLE_EVIDENCE_V3 = "model-residual-visible-evidence-v3";

const REGIONS = new Set(["slab_label", "card_front", "card_back", "front_symbol"]);
const BASES = new Set(["printed_text", "visual_pattern"]);
const FREE_FIELD_NAMES = ["product", "print_finish", "descriptive_rarity"];
const FREE_FIELD_ROLES = Object.freeze({
  product: new Set(["identity_phrase"]),
  print_finish: new Set(["finish_phrase"]),
  descriptive_rarity: new Set(["commercial_marker"])
});
const KNOWN_FINISH_FAMILY = /\b(?:refractor|prizm|prism|wave|mojo|shimmer|foil|holo|sparkle|speckle|vinyl|pulsar|raywave|parallel|cracked|ice)\b/i;
const CANONICAL_EVIDENCE_FIELDS = ["year", "manufacturer", "product", "language", "set",
  "card_name", "release_variant", "surface_color", "parallel_family", "parallel_exact",
  "descriptive_rarity", "subjects", "team", "card_number", "serial", "attributes", "grade",
  "lot_count", "ip"];
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase("en-US");
const clone = (value) => structuredClone(value ?? {});
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const textTokens = (value) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().match(/[a-z0-9]+(?:\/[a-z0-9]+)*/g) ?? [];
const scalarText = (value) => Array.isArray(value) ? value.flatMap(scalarText)
  : value && typeof value === "object" ? Object.values(value).flatMap(scalarText)
    : [clean(value)];

function normalizedFraction(value) {
  const match = clean(value).match(/^(\d{1,5})\/(\d{1,5})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : null;
}

function tokenIdentity(token) {
  return normalizedFraction(token) ? `n:${normalizedFraction(token)}` : `t:${lower(token)}`;
}

function tokenSet(value) {
  return new Set(textTokens(value).map(tokenIdentity));
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function containsTokens(container, contained) {
  const available = tokenSet(container);
  const wanted = tokenSet(contained);
  return wanted.size > 0 && [...wanted].every((token) => available.has(token));
}

function exactRegistryInsert(value) {
  const entry = resolveKnowledgeEntry(value);
  if (!entry) return false;
  return [entry.label, ...(entry.aliases || [])].some((alias) => lower(alias) === lower(value));
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates)) return { rows: [], defects: ["candidate_source_not_array"] };
  if (candidates.length > MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3) {
    return { rows: [], defects: [`candidate_row_overflow:${candidates.length}`] };
  }
  const defects = [];
  const rows = candidates.flatMap((candidate, index) => {
    const row = {
      text: clean(candidate?.text),
      role: clean(candidate?.role),
      region: clean(candidate?.region),
      basis: clean(candidate?.basis)
    };
    if (!row.text || row.text.length > 96 || !MODEL_RESIDUAL_CANDIDATE_ROLES_V3.includes(row.role)
      || !REGIONS.has(row.region) || !BASES.has(row.basis)
      || (row.basis === "visual_pattern" && row.role !== "finish_phrase")
      || (candidate?.authority && candidate.authority !== "candidate_only")
      || candidate?.automatic_csm_admission === true
      || candidate?.automatic_renderer_admission === true
      || candidate?.persistence_authority === true) {
      defects.push(`invalid_candidate:${index}`);
      return [];
    }
    return [row];
  });
  return { rows: defects.length ? [] : rows, defects };
}

function compatibleProposal(field, canonicalValue, currentValue, proposal) {
  if (!proposal) return false;
  const baseline = clean(canonicalValue);
  const current = clean(currentValue);
  if (current && lower(current) !== lower(proposal)
    && !containsTokens(proposal, current) && !containsTokens(current, proposal)) return false;
  if (!baseline || lower(baseline) === lower(proposal)) return true;
  return ["product", "print_finish"].includes(field) && containsTokens(proposal, baseline);
}

function buildContext(fields, candidates) {
  const freeFields = {};
  const blockedFields = new Set();
  const projections = [];
  for (const candidate of candidates) {
    const projected = projectFreeTitleThroughCsm(candidate.text).fields;
    const accepted = {};
    if (candidate.basis !== "printed_text") {
      projections.push({ text: candidate.text, accepted_fields: accepted });
      continue;
    }
    for (const field of FREE_FIELD_NAMES) {
      const proposal = clean(projected[field]);
      if (!FREE_FIELD_ROLES[field].has(candidate.role) || !proposal || blockedFields.has(field)) continue;
      if (!containsTokens(candidate.text, proposal)
        || !compatibleProposal(field, fields[field], freeFields[field], proposal)) {
        if (freeFields[field] && lower(freeFields[field]) !== lower(proposal)) {
          delete freeFields[field];
          blockedFields.add(field);
        }
        continue;
      }
      if (!freeFields[field] || containsTokens(proposal, freeFields[field])) freeFields[field] = proposal;
      accepted[field] = freeFields[field];
    }
    projections.push({ text: candidate.text, accepted_fields: accepted });
  }

  const observations = [];
  for (const candidate of candidates) {
    if (candidate.basis !== "printed_text") continue;
    const base = { evidence: candidate.text, kind: "printed_text", region: candidate.region,
      confidence: "high", confidence_basis: "v3_exact_visible_schema" };
    if (candidate.role === "exact_code" && normalizedFraction(candidate.text)) {
      observations.push({ ...base, label: "serial_number" });
    }
    if (["commercial_marker", "identity_phrase", "other_visible"].includes(candidate.role)
      && exactRegistryInsert(candidate.text)) {
      observations.push({ ...base, label: "insert_name" });
    }
    // The adapter supplies exact text only. The frozen bundle owns the logo
    // allowlist; unknown logos therefore remain candidate-only here.
    if (["identity_phrase", "other_visible"].includes(candidate.role)) {
      observations.push({ ...base, label: "logo" });
    }
  }
  return {
    freeFields,
    freeTitle: candidates.filter((candidate) => candidate.basis === "printed_text"
      && candidate.role !== "exact_code")
      .map((candidate) => candidate.text).join(" | "),
    observations,
    projections,
    blocked_fields: [...blockedFields].sort()
  };
}

function temporaryBareColourBridge(fields, candidates, context) {
  if (clean(fields.surface_color) || clean(fields.parallel_family) || clean(fields.print_finish)) return null;
  const color = clean(fields.observed_surface_color);
  const withheld = (fields.withheld_finish_terms || []).some((term) => term?.layer === "surface_color"
    && lower(term.value) === lower(color) && term.reason === "BARE_COLOUR_NOT_TAXONOMY_CONFIRMED");
  const printedFinish = candidates.some((candidate) => candidate.basis === "printed_text"
    && candidate.role === "finish_phrase" && lower(candidate.text) === lower(context.freeFields.print_finish));
  const proposal = clean(context.freeFields.print_finish);
  if (!color || !withheld || !printedFinish || !proposal.toLowerCase().startsWith(`${color.toLowerCase()} `)
    || !KNOWN_FINISH_FAMILY.test(proposal)) return null;
  return { ...clone(fields), surface_color: color, print_finish: color };
}

function changedFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}

function allowedFieldChange(field, before, after, sourceText) {
  const oldValue = clean(before[field]);
  const nextValue = clean(after[field]);
  if (field === "serial") return normalizedFraction(oldValue)
    && normalizedFraction(oldValue) === normalizedFraction(nextValue);
  if (field === "product") return oldValue && containsTokens(nextValue, oldValue)
    && containsTokens(sourceText, nextValue);
  if (["print_finish", "parallel_exact"].includes(field)) {
    return containsTokens(sourceText, nextValue)
      && (!oldValue || containsTokens(nextValue, oldValue) || containsTokens(nextValue, before.surface_color));
  }
  if (["card_name", "descriptive_rarity", "ip"].includes(field)) {
    return !oldValue && nextValue && containsTokens(sourceText, nextValue);
  }
  return false;
}

export function resolveModelResidualVisibleEvidenceV3(canonicalFields = {}, candidates = [], {
  composerFeatures
} = {}) {
  const baselineFields = clone(canonicalFields);
  const composeOptions = composerFeatures === undefined ? {} : { features: composerFeatures };
  const baseline = composeFromCanonicalFields(baselineFields, composeOptions);
  const normalized = normalizeCandidates(candidates);
  if (normalized.defects.length) {
    return {
      schema_version: MODEL_RESIDUAL_VISIBLE_EVIDENCE_V3,
      authority: "evaluation_only",
      production_promoted: false,
      provider_calls: 0,
      accepted: false,
      fields: baselineFields,
      title: baseline.title,
      defects: normalized.defects,
      guards: { valid_candidate_contract: false },
      context: null,
      decisions: []
    };
  }

  const context = buildContext(baselineFields, normalized.rows);
  const bridgeFields = temporaryBareColourBridge(baselineFields, normalized.rows, context);
  const safeBundle = applyAccuracyMechanismBundleV3(bridgeFields || baselineFields, context);
  if (bridgeFields && safeBundle.changes.includes("finish_family_color_only")) {
    safeBundle.fields.surface_color = baselineFields.surface_color;
    safeBundle.fields.parallel_family = baselineFields.parallel_family;
  }
  const trueBundleFields = new Set(changedFields(baselineFields, safeBundle.fields));
  safeBundle.change_details = safeBundle.change_details.flatMap((detail) => {
    const fields = detail.fields.filter(({ field }) => trueBundleFields.has(field));
    return fields.length ? [{ ...detail, fields }] : [];
  });
  const residual = resolveCapturedModelResidualV2(safeBundle.fields, normalized.rows,
    { composerFeatures });
  const attemptedFields = clone(residual.fields);
  const attemptedTitle = residual.title;
  const sourceText = [
    ...CANONICAL_EVIDENCE_FIELDS.flatMap((field) => scalarText(baselineFields[field])),
    ...normalized.rows.map((row) => row.text)
  ].join(" ");
  const baselineTokens = tokenSet(baseline.title);
  const attemptedTokens = tokenSet(attemptedTitle);
  const sourceTokens = tokenSet(sourceText);
  const changed = changedFields(baselineFields, attemptedFields);
  const lostTitleTokens = difference(baselineTokens, attemptedTokens);
  const unbackedNewTokens = difference(attemptedTokens, baselineTokens)
    .filter((token) => !sourceTokens.has(token));
  const guards = {
    valid_candidate_contract: true,
    no_baseline_title_displacement: lostTitleTokens.length === 0,
    all_new_tokens_source_backed: unbackedNewTokens.length === 0,
    field_changes_allowlisted: changed.every((field) =>
      allowedFieldChange(field, baselineFields, attemptedFields, sourceText)),
    within_80_characters: attemptedTitle.length <= 80
  };
  const accepted = Object.values(guards).every(Boolean);
  return {
    schema_version: MODEL_RESIDUAL_VISIBLE_EVIDENCE_V3,
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    accepted,
    applied: accepted && changed.length > 0,
    fields: accepted ? attemptedFields : baselineFields,
    title: accepted ? attemptedTitle : baseline.title,
    defects: [],
    guards,
    context,
    safety: {
      changed_fields: changed,
      lost_baseline_title_tokens: lostTitleTokens,
      unbacked_new_tokens: unbackedNewTokens,
      attempted_title: attemptedTitle
    },
    decisions: {
      safe_bundle_mechanisms: safeBundle.changes,
      safe_bundle_field_changes: safeBundle.change_details,
      temporary_bare_colour_bridge: bridgeFields ? {
        applied: safeBundle.changes.includes("finish_family_color_only"),
        observed_color_sha256: sha256(baselineFields.observed_surface_color),
        withheld_reason: "BARE_COLOUR_NOT_TAXONOMY_CONFIRMED"
      } : null,
      residual: residual.decisions,
      downstream: residual.downstream
    }
  };
}
