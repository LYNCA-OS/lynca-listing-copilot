import { createHash } from "node:crypto";

import {
  PROPOSED_CRITICAL_FIELDS,
  RULER_CLAIM_FIELDS,
  RULER_VERSION,
  TITLE_POLICIES,
  TRUTH_SOURCES,
  TRUTH_STATUSES,
  clean,
  uniqueSorted
} from "./semantic-publication-contract.mjs";
import {
  RULER_BUNDLE_SHA256,
  conceptRegistrySha256,
  criticalPolicySha256,
  inspectConceptRegistry,
  inspectCriticalPolicy
} from "./semantic-publication-material-validator.mjs";

export const PILOT_VERSION = "typed-gold-annotation-pilot-v1";
export const PILOT_SEED = "typed-gold-r0-2026-08-09";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]))
    : value;
export const stableSha256 = (value) => sha256(JSON.stringify(canonicalize(value)));

export const pilotSelectionPolicy = (seed = PILOT_SEED) => ({
  policy_id: "typed-gold-r0-label-blind-stratified-selection-v1",
  seed,
  source_population: "frozen_existing_150",
  strata: { CARD_FRONT: 1, "CARD_BACK+CARD_FRONT": 19 },
  within_stratum_order: "sha256(seed+NUL+physical_card_id)_ascending",
  prohibited_selection_inputs: ["sealed reviewed title", "title-derived field", "model outcome"]
});

const regionForRole = (role) => {
  if (role === "front_original") return "CARD_FRONT";
  if (role === "back_original") return "CARD_BACK";
  throw new Error(`unsupported_image_role:${role || "empty"}`);
};

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || stableSha256(Object.keys(value).sort()) !== stableSha256([...expected].sort())) {
    throw new Error(`physical_projection_exact_keys_required:${label}`);
  }
}

export function buildPhysicalOnlyProjection({ dataset, cohortAssetIds, datasetSha256, sourceCohortSha256 } = {}) {
  if (!Array.isArray(dataset?.items) || !Array.isArray(cohortAssetIds)) throw new Error("projection_sources_required");
  if (new Set(cohortAssetIds.map(clean)).size !== cohortAssetIds.length) throw new Error("duplicate_projection_cohort_asset_id");
  const byId = new Map(dataset.items.map((item) => [clean(item.asset_id), item]));
  if (byId.size !== dataset.items.length || byId.has("")) throw new Error("projection_source_asset_ids_invalid");
  const items = cohortAssetIds.map((rawId) => {
    const assetId = clean(rawId);
    const source = byId.get(assetId);
    if (!source) throw new Error(`projection_asset_missing:${assetId}`);
    return {
      asset_id: assetId,
      physical_card_id: clean(source.physical_card_id),
      images: (source.images || []).map(({ bucket, object_path, role }) => ({ bucket, object_path, role }))
    };
  });
  const projection = {
    schema_version: "typed-gold-physical-only-projection-v1",
    dataset_sha256: clean(datasetSha256),
    source_cohort_sha256: clean(sourceCohortSha256),
    items
  };
  return {
    projection,
    manifest: {
      schema_version: "typed-gold-physical-only-projection-manifest-v1",
      projection_sha256: stableSha256(projection),
      dataset_sha256: projection.dataset_sha256,
      source_cohort_sha256: projection.source_cohort_sha256,
      item_count: items.length,
      ordered_asset_ids_sha256: stableSha256(items.map((item) => item.asset_id)),
      ordered_physical_card_ids_sha256: stableSha256(items.map((item) => item.physical_card_id))
    }
  };
}

export function validatePhysicalOnlyProjection(projection, manifest = null) {
  exactKeys(projection, ["schema_version", "dataset_sha256", "source_cohort_sha256", "items"], "root");
  if (projection.schema_version !== "typed-gold-physical-only-projection-v1"
    || !Array.isArray(projection.items)) throw new Error("physical_projection_schema_invalid");
  for (const [index, item] of projection.items.entries()) {
    exactKeys(item, ["asset_id", "physical_card_id", "images"], `item:${index}`);
    if (!Array.isArray(item.images)) throw new Error(`physical_projection_images_required:${index}`);
    item.images.forEach((image, imageIndex) => {
      exactKeys(image, ["bucket", "object_path", "role"], `image:${index}:${imageIndex}`);
      if (!["front_original", "back_original"].includes(image.role)
        || !clean(image.bucket) || !clean(image.object_path)) {
        throw new Error(`physical_projection_image_invalid:${index}:${imageIndex}`);
      }
    });
  }
  const assetIds = projection.items.map((item) => clean(item.asset_id));
  const physicalIds = projection.items.map((item) => clean(item.physical_card_id));
  if (assetIds.some((id) => !id) || new Set(assetIds).size !== assetIds.length) throw new Error("physical_projection_asset_ids_invalid");
  if (physicalIds.some((id) => !id) || new Set(physicalIds).size !== physicalIds.length) throw new Error("physical_projection_physical_ids_invalid");
  if (manifest) {
    if (manifest.schema_version !== "typed-gold-physical-only-projection-manifest-v1"
      || manifest.projection_sha256 !== stableSha256(projection)
      || manifest.dataset_sha256 !== projection.dataset_sha256
      || manifest.source_cohort_sha256 !== projection.source_cohort_sha256
      || manifest.item_count !== projection.items.length
      || manifest.ordered_asset_ids_sha256 !== stableSha256(projection.items.map((item) => item.asset_id))
      || manifest.ordered_physical_card_ids_sha256 !== stableSha256(projection.items.map((item) => item.physical_card_id))) {
      throw new Error("physical_projection_manifest_mismatch");
    }
  }
  return true;
}

export function defaultPilotCriticalPolicy() {
  const policy = {
    policy_id: "typed-gold-r0-critical-policy-proposal-v1",
    status: "PROPOSED_UNAPPROVED",
    fields: [...PROPOSED_CRITICAL_FIELDS]
  };
  return { ...policy, sha256: criticalPolicySha256(policy) };
}

export function defaultPilotConceptRegistry() {
  const registry = {
    registry_id: "typed-gold-r0-empty-registry-placeholder-v1",
    status: "MISSING_UNAPPROVED",
    concepts: []
  };
  return { ...registry, sha256: conceptRegistrySha256(registry) };
}

export function selectPilotCards({ physicalProjection, count = 20, seed = PILOT_SEED } = {}) {
  validatePhysicalOnlyProjection(physicalProjection);
  if (count !== 20) throw new Error("pilot_count_must_be_20");
  const eligible = physicalProjection.items.map((item) => {
    const assetId = clean(item.asset_id);
    const physicalCardId = clean(item.physical_card_id);
    if (!physicalCardId) throw new Error(`physical_card_id_required:${assetId}`);
    const regions = uniqueSorted((item.images || []).map((image) => regionForRole(image.role)));
    if (regions.length === 0) throw new Error(`image_reference_required:${assetId}`);
    return { item, assetId, physicalCardId, regions, stratum: regions.join("+") };
  });
  if (new Set(eligible.map((row) => row.physicalCardId)).size !== eligible.length) {
    throw new Error("duplicate_source_physical_card_id");
  }
  const strata = Map.groupBy(eligible, (row) => row.stratum);
  const single = strata.get("CARD_FRONT") || [];
  const dual = strata.get("CARD_BACK+CARD_FRONT") || [];
  if (single.length < 1 || dual.length < count - 1) throw new Error("frozen_strata_unavailable");
  const rank = (row) => sha256(`${seed}\0${row.physicalCardId}`);
  const take = (rows, n) => [...rows].sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, n);
  return [...take(single, 1), ...take(dual, count - 1)]
    .sort((a, b) => rank(a).localeCompare(rank(b)));
}

export function buildPilotPacket({
  physicalProjection,
  projectionManifest,
  criticalPolicy = defaultPilotCriticalPolicy(),
  conceptRegistry = defaultPilotConceptRegistry(),
  seed = PILOT_SEED
} = {}) {
  const policy = inspectCriticalPolicy(criticalPolicy);
  const registry = inspectConceptRegistry(conceptRegistry);
  validatePhysicalOnlyProjection(physicalProjection, projectionManifest);
  const selected = selectPilotCards({ physicalProjection, seed });
  const selectionPolicy = pilotSelectionPolicy(seed);
  const cards = selected.map(({ item, assetId, physicalCardId, regions }) => ({
    asset_id: assetId,
    physical_card_id: physicalCardId,
    images: item.images.map((image) => ({
      image_ref: `${image.bucket}/${image.object_path}`,
      source_region: regionForRole(image.role)
    })),
    source_regions: regions,
    annotation_template: {
      typed_claims: [],
      required_fact_scan: { status: null, reviewed_source_regions: [], missing_required_claims: [] },
      wrong_role_axis: { status: null, findings: [] }
    }
  }));
  const packet = {
    schema_version: PILOT_VERSION,
    authority: "EVALUATION_ONLY_UNANNOTATED",
    blind: true,
    reviewed_title_labels_opened: false,
    scorer_version: RULER_VERSION,
    bindings: {
      dataset_sha256: physicalProjection.dataset_sha256,
      source_cohort_sha256: physicalProjection.source_cohort_sha256,
      physical_projection_sha256: stableSha256(physicalProjection),
      selection_policy_sha256: stableSha256(selectionPolicy),
      critical_policy_sha256: policy.sha256,
      concept_registry_sha256: registry.sha256,
      scorer_bundle_sha256: RULER_BUNDLE_SHA256
    },
    approval_state: {
      critical_policy_frozen: policy.frozen,
      concept_registry_frozen: registry.frozen
    },
    material_snapshots: {
      critical_policy: criticalPolicy,
      concept_registry: conceptRegistry
    },
    selection_policy: selectionPolicy,
    cards
  };
  return {
    packet,
    receipt: {
      schema_version: "typed-gold-annotation-packet-receipt-v1",
      packet_sha256: stableSha256(packet),
      bindings: packet.bindings,
      card_count: cards.length,
      strata: { CARD_FRONT: 1, "CARD_BACK+CARD_FRONT": 19 },
      ordered_asset_ids_sha256: stableSha256(cards.map((card) => card.asset_id)),
      ordered_physical_card_ids_sha256: stableSha256(cards.map((card) => card.physical_card_id)),
      sealed_reviewed_title_bytes_read: false
    }
  };
}

export function validatePilotPacket(packet, receipt) {
  if (packet?.schema_version !== PILOT_VERSION || receipt?.schema_version !== "typed-gold-annotation-packet-receipt-v1") {
    throw new Error("typed_gold_packet_schema_invalid");
  }
  if (packet.reviewed_title_labels_opened !== false || receipt.sealed_reviewed_title_bytes_read !== false) {
    throw new Error("sealed_label_boundary_invalid");
  }
  if (stableSha256(packet) !== receipt.packet_sha256) throw new Error("typed_gold_packet_tampered");
  if (stableSha256(packet.selection_policy) !== packet.bindings?.selection_policy_sha256) {
    throw new Error("selection_policy_sha_mismatch");
  }
  const criticalPolicy = inspectCriticalPolicy(packet.material_snapshots?.critical_policy);
  const conceptRegistry = inspectConceptRegistry(packet.material_snapshots?.concept_registry);
  if (!criticalPolicy.sha256_matches || !conceptRegistry.sha256_matches
    || criticalPolicy.computed_sha256 !== packet.bindings?.critical_policy_sha256
    || conceptRegistry.computed_sha256 !== packet.bindings?.concept_registry_sha256
    || criticalPolicy.frozen !== packet.approval_state?.critical_policy_frozen
    || conceptRegistry.frozen !== packet.approval_state?.concept_registry_frozen) {
    throw new Error("policy_or_registry_binding_mismatch");
  }
  if (packet.bindings?.scorer_bundle_sha256 !== RULER_BUNDLE_SHA256) throw new Error("scorer_bundle_sha_mismatch");
  for (const [key, value] of Object.entries(packet.bindings || {})) {
    if (!/^[a-f0-9]{64}$/.test(clean(value))) throw new Error(`invalid_binding_sha256:${key}`);
  }
  if (!Array.isArray(packet.cards) || packet.cards.length !== 20) throw new Error("typed_gold_packet_must_have_20_cards");
  const assets = packet.cards.map((card) => clean(card.asset_id));
  const physical = packet.cards.map((card) => clean(card.physical_card_id));
  if (assets.some((id) => !id) || new Set(assets).size !== 20) throw new Error("packet_asset_ids_invalid");
  if (physical.some((id) => !id) || new Set(physical).size !== 20) throw new Error("duplicate_physical_card_id");
  if (stableSha256(receipt.bindings) !== stableSha256(packet.bindings)
    || receipt.card_count !== 20
    || receipt.ordered_asset_ids_sha256 !== stableSha256(assets)
    || receipt.ordered_physical_card_ids_sha256 !== stableSha256(physical)) {
    throw new Error("typed_gold_receipt_binding_mismatch");
  }
  for (const card of packet.cards) {
    const regions = uniqueSorted((card.images || []).map((image) => image.source_region));
    if (!regions.length || stableSha256(regions) !== stableSha256(card.source_regions)) {
      throw new Error(`source_region_invalid:${card.asset_id}`);
    }
  }
  return true;
}

function validateReview(review, packet, expectedRole) {
  if (review?.schema_version !== "typed-gold-independent-review-v1" || review?.role !== expectedRole) {
    throw new Error(`review_schema_invalid:${expectedRole}`);
  }
  if (!clean(review.reviewer_id)) throw new Error(`reviewer_id_required:${expectedRole}`);
  const byAsset = new Map((review.cards || []).map((card) => [clean(card.asset_id), card]));
  if (byAsset.size !== 20 || (review.cards || []).length !== 20) throw new Error(`review_card_coverage_invalid:${expectedRole}`);
  for (const source of packet.cards) {
    const card = byAsset.get(source.asset_id);
    if (!card || clean(card.physical_card_id) !== source.physical_card_id) throw new Error(`review_identity_mismatch:${expectedRole}:${source.asset_id}`);
    const scan = card.required_fact_scan;
    const role = card.wrong_role_axis;
    if (scan?.status !== "COMPLETE" || stableSha256(uniqueSorted(scan.reviewed_source_regions || [])) !== stableSha256(source.source_regions)) {
      throw new Error(`required_scan_incomplete:${expectedRole}:${source.asset_id}`);
    }
    if (!new Set(["CLEAR", "FOUND"]).has(role?.status)) throw new Error(`wrong_role_axis_incomplete:${expectedRole}:${source.asset_id}`);
    if (!Array.isArray(card.typed_claims)) throw new Error(`typed_claims_missing:${expectedRole}:${source.asset_id}`);
    for (const claim of card.typed_claims) {
      if (!RULER_CLAIM_FIELDS.has(clean(claim.field)) || !clean(claim.value)
        || !TRUTH_STATUSES.includes(claim.truth_status) || !TITLE_POLICIES.includes(claim.title_policy)
        || !TRUTH_SOURCES.includes(claim.truth_source) || typeof claim.recognition_required !== "boolean"
        || !source.source_regions.includes(claim.source_region)
        || !Array.isArray(claim.evidence_refs) || claim.evidence_refs.length === 0) {
        throw new Error(`typed_claim_invalid:${expectedRole}:${source.asset_id}`);
      }
    }
  }
  return review.reviewer_id;
}

export function evaluatePilotGold({ packet, receipt, reviewerA, reviewerB, adjudication } = {}) {
  validatePilotPacket(packet, receipt);
  const nullMetrics = {
    critical_factual_error_rate: null,
    typed_precision: null,
    typed_recall: null,
    required_missing_rate: null,
    wrong_role_rate: null
  };
  if (!reviewerA || !reviewerB || !adjudication) {
    return { gold_eligible: false, status: "INCOMPLETE", blockers: ["two_independent_reviews_and_adjudication_required"], metrics: nullMetrics };
  }
  const a = validateReview(reviewerA, packet, "REVIEWER_A");
  const b = validateReview(reviewerB, packet, "REVIEWER_B");
  if (a === b) throw new Error("independent_reviewer_ids_must_differ");
  if (adjudication?.schema_version !== "typed-gold-adjudication-v1" || adjudication?.status !== "COMPLETE"
    || !clean(adjudication.reviewer_id) || [a, b].includes(adjudication.reviewer_id)) {
    throw new Error("third_party_adjudication_required");
  }
  validateReview({ ...adjudication, schema_version: "typed-gold-independent-review-v1", role: "ADJUDICATOR" }, packet, "ADJUDICATOR");
  const frozen = packet.approval_state?.critical_policy_frozen === true
    && packet.approval_state?.concept_registry_frozen === true;
  return {
    gold_eligible: frozen,
    status: frozen ? "ADJUDICATED_GOLD_READY" : "ADJUDICATED_PILOT_ONLY",
    blockers: frozen ? [] : ["critical_policy_or_concept_registry_not_frozen_approved"],
    metrics: frozen ? { ...nullMetrics } : nullMetrics
  };
}
