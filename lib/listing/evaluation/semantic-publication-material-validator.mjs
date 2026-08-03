import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  clean,
  normalizeClaimValue,
  PROPOSED_CRITICAL_FIELDS,
  RULER_CLAIM_FIELDS,
  RULER_VERSION,
  uniqueSorted
} from "./semantic-publication-contract.mjs";

const sourceFiles = [
  new URL(import.meta.url),
  new URL("./semantic-publication-ruler.mjs", import.meta.url),
  new URL("./semantic-publication-contract.mjs", import.meta.url),
  new URL("./semantic-publication-concepts.mjs", import.meta.url),
  new URL("./semantic-publication-cohort-gate.mjs", import.meta.url),
  new URL("./gold-coverage-audit.mjs", import.meta.url),
  new URL("../csm/sem-definition.mjs", import.meta.url)
];

export const RULER_BUNDLE_SHA256 = sourceFiles.reduce((hash, url) => hash
  .update(`${url.pathname.split("/").at(-1)}\0`)
  .update(readFileSync(fileURLToPath(url)))
  .update("\0"), createHash("sha256")).digest("hex");

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalizeJson(value[key])]));
  }
  return value;
}

function stableSha256Json(value) {
  return sha256Json(canonicalizeJson(value));
}

export function criticalPolicySha256(policy = {}) {
  return sha256Json({
    schema_version: "critical-field-policy-v1",
    policy_id: clean(policy.policy_id),
    status: clean(policy.status),
    fields: uniqueSorted(Array.isArray(policy.fields) ? policy.fields : [])
  });
}

export function inspectCriticalPolicy(policy = null) {
  const normalizedFields = uniqueSorted(Array.isArray(policy?.fields) ? policy.fields : []);
  const explicitFields = normalizedFields.length > 0;
  const fieldsValid = normalizedFields.every((field) => RULER_CLAIM_FIELDS.has(field));
  const fields = explicitFields ? normalizedFields : [...PROPOSED_CRITICAL_FIELDS];
  const computedSha256 = criticalPolicySha256({ ...policy, fields });
  const frozen = policy?.status === "FROZEN_APPROVED"
    && Boolean(clean(policy?.policy_id))
    && explicitFields
    && fieldsValid
    && clean(policy?.sha256) === computedSha256;
  return {
    policy_id: clean(policy?.policy_id) || null,
    status: clean(policy?.status) || "PROPOSED_UNAPPROVED",
    sha256: clean(policy?.sha256) || null,
    computed_sha256: computedSha256,
    sha256_matches: clean(policy?.sha256) === computedSha256,
    fields_valid: fieldsValid,
    fields,
    frozen
  };
}

function canonicalConcepts(concepts = []) {
  return concepts.map((concept) => ({
    id: clean(concept.id),
    field: clean(concept.field),
    label: clean(concept.label),
    aliases: uniqueSorted(Array.isArray(concept.aliases) ? concept.aliases.map(normalizeClaimValue) : []),
    parents: uniqueSorted(Array.isArray(concept.parents) ? concept.parents : [])
  })).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function conceptRegistrySha256(registry = {}) {
  return sha256Json({
    schema_version: "concept-registry-v1",
    registry_id: clean(registry.registry_id),
    status: clean(registry.status),
    concepts: canonicalConcepts(Array.isArray(registry.concepts) ? registry.concepts : [])
  });
}

export function inspectConceptRegistry(registry = null) {
  const concepts = Array.isArray(registry?.concepts) ? registry.concepts : [];
  const computedSha256 = conceptRegistrySha256({ ...registry, concepts });
  const frozen = registry?.status === "FROZEN_APPROVED"
    && Boolean(clean(registry?.registry_id))
    && concepts.length > 0
    && clean(registry?.sha256) === computedSha256;
  return {
    registry_id: clean(registry?.registry_id) || null,
    status: clean(registry?.status) || "MISSING_UNAPPROVED",
    sha256: clean(registry?.sha256) || null,
    computed_sha256: computedSha256,
    sha256_matches: clean(registry?.sha256) === computedSha256,
    frozen,
    concepts
  };
}

export function rulerApprovalManifestSha256(manifest = {}) {
  return stableSha256Json({
    schema_version: "semantic-publication-approval-manifest-v1",
    manifest_id: clean(manifest.manifest_id),
    status: clean(manifest.status),
    ruler_version: clean(manifest.ruler_version),
    scorer_bundle_sha256: clean(manifest.scorer_bundle_sha256),
    critical_policy_sha256: clean(manifest.critical_policy_sha256),
    concept_registry_sha256: clean(manifest.concept_registry_sha256),
    grammar_checker_id: clean(manifest.grammar_checker_id),
    grammar_checker_sha256: clean(manifest.grammar_checker_sha256),
    cohort_selection_sha256: clean(manifest.cohort_selection_sha256),
    gold_coverage_report_sha256: clean(manifest.gold_coverage_report_sha256),
    annotation_packet_sha256: clean(manifest.annotation_packet_sha256),
    arm_outputs_sha256: clean(manifest.arm_outputs_sha256),
    card_material_sha256_by_asset: manifest.card_material_sha256_by_asset || {}
  });
}

export function cardMaterialSha256({
  asset_id,
  physical_card_id,
  annotations,
  canonical_claims,
  title_claims,
  title_text,
  annotation_complete,
  title_constraints
} = {}) {
  return stableSha256Json({
    schema_version: "semantic-publication-card-material-v1",
    asset_id: clean(asset_id),
    physical_card_id: clean(physical_card_id),
    annotations: annotations || [],
    canonical_claims: canonical_claims || [],
    title_claims: title_claims || [],
    title_text: String(title_text ?? ""),
    annotation_complete: annotation_complete === true,
    title_constraints: title_constraints || null
  });
}

export function inspectApprovalManifest(manifest = null) {
  const computedSha256 = rulerApprovalManifestSha256(manifest || {});
  const materialHashes = manifest?.card_material_sha256_by_asset;
  const materialMapValid = materialHashes && typeof materialHashes === "object"
    && !Array.isArray(materialHashes)
    && Object.keys(materialHashes).length > 0
    && Object.values(materialHashes).every((value) => /^[a-f0-9]{64}$/i.test(clean(value)));
  const requiredHashes = [
    manifest?.scorer_bundle_sha256,
    manifest?.critical_policy_sha256,
    manifest?.concept_registry_sha256,
    manifest?.grammar_checker_sha256,
    manifest?.cohort_selection_sha256,
    manifest?.gold_coverage_report_sha256,
    manifest?.annotation_packet_sha256,
    manifest?.arm_outputs_sha256
  ];
  const frozen = manifest?.status === "SEALED_APPROVED"
    && Boolean(clean(manifest?.manifest_id))
    && clean(manifest?.ruler_version) === RULER_VERSION
    && clean(manifest?.scorer_bundle_sha256) === RULER_BUNDLE_SHA256
    && Boolean(clean(manifest?.grammar_checker_id))
    && requiredHashes.every((value) => /^[a-f0-9]{64}$/i.test(clean(value)))
    && materialMapValid
    && clean(manifest?.sha256) === computedSha256;
  return {
    manifest_id: clean(manifest?.manifest_id) || null,
    status: clean(manifest?.status) || "MISSING_UNAPPROVED",
    ruler_version: clean(manifest?.ruler_version) || null,
    scorer_bundle_sha256: clean(manifest?.scorer_bundle_sha256) || null,
    critical_policy_sha256: clean(manifest?.critical_policy_sha256) || null,
    concept_registry_sha256: clean(manifest?.concept_registry_sha256) || null,
    grammar_checker_id: clean(manifest?.grammar_checker_id) || null,
    grammar_checker_sha256: clean(manifest?.grammar_checker_sha256) || null,
    cohort_selection_sha256: clean(manifest?.cohort_selection_sha256) || null,
    gold_coverage_report_sha256: clean(manifest?.gold_coverage_report_sha256) || null,
    annotation_packet_sha256: clean(manifest?.annotation_packet_sha256) || null,
    arm_outputs_sha256: clean(manifest?.arm_outputs_sha256) || null,
    card_material_sha256_by_asset: materialMapValid ? { ...materialHashes } : {},
    material_map_valid: Boolean(materialMapValid),
    sha256: clean(manifest?.sha256) || null,
    computed_sha256: computedSha256,
    sha256_matches: clean(manifest?.sha256) === computedSha256,
    frozen
  };
}

export function validateTitlePredictionTrace(prediction, prepared, index, titleText) {
  if (clean(prediction.emission_status) !== "FULL") throw new Error(`title_claim_not_fully_emitted:${prepared.key}`);
  const renderedText = clean(prediction.rendered_text);
  if (!renderedText) throw new Error(`title_claim_rendered_text_required:${prepared.key}`);
  if (!Array.isArray(prediction.title_spans) || prediction.title_spans.length === 0) {
    throw new Error(`title_claim_span_required:${prepared.key}`);
  }
  let previousEnd = -1;
  const titleSpans = prediction.title_spans.map((span) => {
    const start = span?.start;
    const end = span?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || end > titleText.length || start < previousEnd) {
      throw new Error(`invalid_title_claim_span:${prepared.key}`);
    }
    previousEnd = end;
    return { start, end };
  });
  const renderedFromTitle = clean(titleSpans.map(({ start, end }) => titleText.slice(start, end)).join(" "));
  if (renderedFromTitle !== renderedText) throw new Error(`title_claim_span_text_mismatch:${prepared.key}`);
  const transformCodes = uniqueSorted(Array.isArray(prediction.transform_codes) ? prediction.transform_codes : []);
  const sourceFields = uniqueSorted(Array.isArray(prediction.source_fields) ? prediction.source_fields : []);
  if (sourceFields.length === 0 || sourceFields.some((field) => !RULER_CLAIM_FIELDS.has(field))) {
    throw new Error(`title_claim_source_fields_invalid:${prepared.key}`);
  }
  if (transformCodes.length !== 1) throw new Error(`title_claim_transform_required:${prepared.key}`);
  const renderedIdentity = normalizeClaimValue(renderedText);
  const valueIdentity = normalizeClaimValue(prepared.value);
  let renderedMatchesIdentity = false;
  if (transformCodes[0] === "EXACT_OR_ALIAS") {
    if (!sourceFields.includes(prepared.field)) {
      throw new Error(`title_claim_source_field_mismatch:${prepared.key}`);
    }
    renderedMatchesIdentity = prepared.concept_id
      ? index.byId.get(prepared.concept_id)?.aliases.includes(renderedIdentity)
      : renderedIdentity === valueIdentity;
  } else if (transformCodes[0] === "LOT_CARD_LOT") {
    if (!sourceFields.includes("lot_quantity")) {
      throw new Error(`title_claim_source_field_mismatch:${prepared.key}`);
    }
    renderedMatchesIdentity = prepared.field === "lot_quantity"
      && /^\d+$/.test(valueIdentity)
      && renderedIdentity === `${valueIdentity} card lot`;
  } else {
    throw new Error(`unsupported_title_claim_transform:${transformCodes[0]}`);
  }
  if (!renderedMatchesIdentity) throw new Error(`title_claim_rendered_identity_mismatch:${prepared.key}`);
  return {
    ...prepared,
    rendered_text: renderedText,
    title_spans: titleSpans,
    source_fields: sourceFields,
    transform_codes: transformCodes,
    emission_status: "FULL"
  };
}

export function unclaimedSemanticFragments(titleText, titleClaims) {
  const covered = new Uint8Array(titleText.length);
  for (const claim of titleClaims) {
    for (const { start, end } of claim.title_spans) covered.fill(1, start, end);
  }
  const fragments = [];
  for (const match of titleText.matchAll(/\S+/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!covered.slice(start, end).every(Boolean)) fragments.push({ text: match[0], start, end });
  }
  return fragments;
}

export function inspectTitleConstraints(titleText, constraints = null) {
  const computedTitleSha256 = createHash("sha256").update(titleText).digest("hex");
  const violations = Array.isArray(constraints?.grammar_violation_codes)
    ? uniqueSorted(constraints.grammar_violation_codes)
    : null;
  const certificateKnown = Boolean(clean(constraints?.grammar_checker_id))
    && /^[a-f0-9]{64}$/i.test(clean(constraints?.grammar_checker_sha256))
    && /^[a-f0-9]{64}$/i.test(clean(constraints?.checked_title_sha256))
    && clean(constraints?.checked_title_sha256) === computedTitleSha256
    && violations !== null;
  const length = [...titleText].length;
  return {
    grammar_checker_id: clean(constraints?.grammar_checker_id) || null,
    grammar_checker_sha256: clean(constraints?.grammar_checker_sha256) || null,
    checked_title_sha256: clean(constraints?.checked_title_sha256) || null,
    computed_title_sha256: computedTitleSha256,
    title_hash_matches: clean(constraints?.checked_title_sha256) === computedTitleSha256,
    grammar_violation_codes: violations,
    rendered_length: length,
    length_ok: length <= 80,
    grammar_ok: certificateKnown ? violations.length === 0 : null,
    certificate_known: certificateKnown
  };
}
