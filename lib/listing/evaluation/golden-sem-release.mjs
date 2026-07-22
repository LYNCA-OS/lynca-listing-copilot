import crypto from "node:crypto";
import {
  SEM_STANDARD_VERSION,
  semCanonicalEditableFields
} from "../csm/sem-definition.mjs";
import { titleDerivedSemSuggestion } from "../csm/title-derived-sem.mjs";
import {
  releaseSetItemSetSha256,
  releaseSetTypes,
  validateReleaseSetManifest
} from "./release-set-contract.mjs";

export const goldenSemReviewSchemaVersion = "golden-sem-review-packet-v1";
export const goldenSemReleaseBundleSchemaVersion = "golden-sem-release-bundle-v1";
export const goldenSemPartitionSchemaVersion = "golden-sem-partition-v1";
export const goldenSemReviewWorklistSchemaVersion = "golden-sem-review-worklist-v1";
export const goldenSemSplitPlanSchemaVersion = "golden-sem-split-plan-v1";

export const goldenSemLaunchFields = Object.freeze([
  "year",
  "ip_sport",
  "language",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "descriptive_rarity",
  "numerical_rarity",
  "release_variant",
  "print_finish",
  "special_stamp",
  "grading_info"
]);

export const goldenSemCriticalFields = Object.freeze([
  "subject",
  "year",
  "product",
  "print_finish",
  "numerical_rarity",
  "grading_info"
]);

export const goldenSemReviewStatuses = Object.freeze([
  "UNREVIEWED",
  "CONFIRMED",
  "UNKNOWN",
  "NOT_APPLICABLE"
]);

const confirmedStatuses = new Set(["CONFIRMED", "UNKNOWN", "NOT_APPLICABLE"]);
const listFields = new Set(["subject", "special_stamp", "search_optimization"]);
const splitNames = Object.freeze(["development", "validation", "holdout"]);
const splitRatios = Object.freeze({ development: 0.70, validation: 0.15, holdout: 0.15 });

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function sourceItems(source = {}) {
  if (Array.isArray(source)) return source;
  for (const key of ["items", "results", "records", "cards", "tasks"]) {
    if (Array.isArray(source?.[key])) return source[key];
  }
  return [];
}

function sourceItemId(item = {}, index = 0) {
  return cleanText(
    item.item_id
    || item.card_id
    || item.asset_id
    || item.source_feedback_id
    || item.candidate_id
    || item.task_id
    || item.id
    || `golden-sem-${index + 1}`
  );
}

function correctedTitle(item = {}) {
  return cleanText(
    item.source_titles?.corrected_title
    || item.corrected_title_reference
    || item.corrected_title_hint
    || item.corrected_title
    || item.writer_final_title
    || item.final_title
  );
}

function recognitionImages(item = {}) {
  const explicitImages = item.recognition_input?.images
    || item.images
    || item.image_inputs
    || [];
  const rawFeedbackImages = [
    {
      image_id: "front",
      bucket: item.front_bucket,
      object_path: item.front_object_path,
      url: item.front_image_url,
      image_role: "front_original"
    },
    {
      image_id: "back",
      bucket: item.back_bucket,
      object_path: item.back_object_path,
      url: item.back_image_url,
      image_role: "back_original"
    }
  ].filter((image) => image.url || image.object_path);
  const images = asArray(explicitImages).length ? explicitImages : rawFeedbackImages;
  return asArray(images).map((image, index) => {
    if (typeof image === "string") return { image_id: `image-${index + 1}`, url: image };
    const row = plainObject(image);
    return Object.fromEntries(Object.entries({
      image_id: cleanText(row.image_id || row.id || `image-${index + 1}`),
      bucket: cleanText(row.bucket) || null,
      object_path: cleanText(row.object_path || row.path) || null,
      url: cleanText(row.url || row.source_url || row.image_url) || null,
      content_sha256: cleanText(row.content_sha256) || null,
      image_role: cleanText(row.image_role || row.role) || null
    }).filter(([, value]) => value !== null && value !== ""));
  }).filter((image) => image.url || image.object_path);
}

export { titleDerivedSemSuggestion } from "../csm/title-derived-sem.mjs";

function blankReviewField(field, suggestion) {
  return {
    field,
    parser_suggestion: suggestion ?? (listFields.has(field) ? [] : ""),
    reviewed_value: listFields.has(field) ? [] : "",
    reviewed_status: "UNREVIEWED",
    evidence_sources: [],
    reviewer_notes: ""
  };
}

export function buildGoldenSemReviewPacket(source = {}, {
  datasetId = "supabase-writer-reviewed-sem-v1",
  now = () => new Date()
} = {}) {
  const items = sourceItems(source).map((item, index) => {
    const itemId = sourceItemId(item, index);
    const title = correctedTitle(item);
    const suggestion = titleDerivedSemSuggestion(title);
    return {
      item_id: itemId,
      source_feedback_id: cleanText(item.source_feedback_id || item.id) || null,
      card_identity_id: cleanText(item.card_identity_id) || null,
      split_group_id: cleanText(item.split_group_id || item.card_identity_id) || null,
      recognition_input: {
        images: recognitionImages(item)
      },
      sealed_reference: {
        writer_reviewed_title: title,
        title_is_reviewed_ground_truth: Boolean(title),
        title_visible_to_recognition: false,
        title_used_as_field_ground_truth: false
      },
      parser_suggestion: {
        parser_id: "parseReviewedTitleFields",
        sem_standard_version: SEM_STANDARD_VERSION,
        fields: suggestion,
        review_required: true
      },
      reviewed_ground_truth: {
        review_status: "UNREVIEWED",
        reviewed_by: "",
        reviewed_at: "",
        fields: Object.fromEntries(goldenSemLaunchFields.map((field) => [
          field,
          blankReviewField(field, suggestion[field])
        ]))
      }
    };
  });

  return {
    schema_version: goldenSemReviewSchemaVersion,
    dataset_id: datasetId,
    generated_at: now().toISOString(),
    sem_standard_version: SEM_STANDARD_VERSION,
    source: {
      source_schema_version: source?.schema_version || null,
      source_table: source?.source?.table || source?.source_table || "listing_title_feedback",
      writer_reviewed_title_is_title_ground_truth: true,
      writer_reviewed_title_is_field_ground_truth: false
    },
    review_contract: {
      required_fields: goldenSemLaunchFields,
      allowed_field_statuses: goldenSemReviewStatuses,
      confirmed_fields_require_evidence: true,
      parser_suggestion_is_ground_truth: false,
      holdout_is_never_used_for_training_or_tuning: true
    },
    summary: {
      source_item_count: sourceItems(source).length,
      review_item_count: items.length,
      with_writer_reviewed_title_count: items.filter((item) => item.sealed_reference.writer_reviewed_title).length,
      with_image_count: items.filter((item) => item.recognition_input.images.length > 0).length,
      reviewed_item_count: 0
    },
    items
  };
}

function reviewFieldStatus(fieldRecord = {}) {
  return cleanText(fieldRecord.reviewed_status || fieldRecord.status).toUpperCase();
}

function reviewFieldValue(fieldRecord = {}) {
  return fieldRecord.reviewed_value ?? fieldRecord.value ?? "";
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every((entry) => cleanText(entry));
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return cleanText(value) !== "";
}

export function validateGoldenSemReviewPacket(packet = {}, {
  requireApproved = false
} = {}) {
  const errors = [];
  const warnings = [];
  const items = sourceItems(packet);
  if (packet.schema_version !== goldenSemReviewSchemaVersion) {
    errors.push(`schema_version must be ${goldenSemReviewSchemaVersion}`);
  }
  if (!cleanText(packet.dataset_id)) errors.push("dataset_id is required");
  if (packet.sem_standard_version !== SEM_STANDARD_VERSION) errors.push("SEM standard version is stale");
  if (!items.length) errors.push("items must not be empty");
  const ids = items.map((item, index) => sourceItemId(item, index));
  if (new Set(ids).size !== ids.length) errors.push("item_id values must be unique");

  let approvedCount = 0;
  items.forEach((item, index) => {
    const itemId = sourceItemId(item, index);
    const review = plainObject(item.reviewed_ground_truth);
    const approved = cleanText(review.review_status).toUpperCase() === "APPROVED";
    if (approved) approvedCount += 1;
    if (requireApproved && !approved) errors.push(`${itemId}: review_status must be APPROVED`);
    if (approved && !cleanText(review.reviewed_by)) errors.push(`${itemId}: reviewed_by is required`);
    if (approved && !cleanText(review.reviewed_at)) errors.push(`${itemId}: reviewed_at is required`);
    if (!item.recognition_input?.images?.length) warnings.push(`${itemId}: no recognition images`);
    if (!item.sealed_reference?.writer_reviewed_title) warnings.push(`${itemId}: writer-reviewed title is missing`);

    for (const field of goldenSemLaunchFields) {
      const fieldRecord = plainObject(review.fields?.[field]);
      const status = reviewFieldStatus(fieldRecord);
      const value = reviewFieldValue(fieldRecord);
      if (requireApproved && !confirmedStatuses.has(status)) {
        errors.push(`${itemId}.${field}: reviewed_status must be CONFIRMED, UNKNOWN, or NOT_APPLICABLE`);
        continue;
      }
      if (status === "CONFIRMED" && !valuePresent(value)) {
        errors.push(`${itemId}.${field}: CONFIRMED requires a reviewed_value`);
      }
      if (status === "CONFIRMED" && !asArray(fieldRecord.evidence_sources).filter(cleanText).length) {
        errors.push(`${itemId}.${field}: CONFIRMED requires evidence_sources`);
      }
    }
  });

  return {
    ok: errors.length === 0,
    schema_version: "golden-sem-review-validation-v1",
    dataset_id: cleanText(packet.dataset_id) || null,
    item_count: items.length,
    approved_item_count: approvedCount,
    errors,
    warnings
  };
}

function comparable(value) {
  if (Array.isArray(value)) return [...new Set(value.map(comparable).filter(Boolean))].sort().join("|");
  if (value && typeof value === "object") {
    return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}:${comparable(child)}`).join("|");
  }
  return cleanText(value).toLowerCase().replace(/[^a-z0-9/.-]+/g, " ").trim();
}

function approvedFields(item = {}) {
  const fields = plainObject(item.reviewed_ground_truth?.fields);
  return Object.fromEntries(goldenSemLaunchFields.map((field) => {
    const record = plainObject(fields[field]);
    const status = reviewFieldStatus(record);
    return [field, status === "CONFIRMED" ? reviewFieldValue(record) : status];
  }));
}

function semanticIdentityGroup(item = {}) {
  const explicit = cleanText(item.split_group_id || item.card_identity_id);
  if (explicit) return explicit;
  const fields = approvedFields(item);
  const identityFields = [
    "year",
    "ip_sport",
    "language",
    "manufacturer",
    "product",
    "set",
    "subject",
    "card_name",
    "card_number",
    "descriptive_rarity",
    "release_variant",
    "print_finish",
    "special_stamp"
  ];
  const semanticKey = identityFields.map((field) => `${field}:${comparable(fields[field])}`).join("\n");
  if (semanticKey.replace(/[^a-z0-9]/g, "")) return `sem:${stableHash(semanticKey)}`;
  const imageHash = item.recognition_input?.images?.map((image) => image.content_sha256).find(Boolean);
  return imageHash ? `image:${imageHash}` : `item:${cleanText(item.item_id)}`;
}

function targetCounts(total, minimumHoldout = 45) {
  if (minimumHoldout > 0 && total < minimumHoldout) {
    throw new Error(`Golden SEM release requires at least ${minimumHoldout} reviewed items; found ${total}`);
  }
  const baseHoldout = Math.round(total * splitRatios.holdout);
  const holdout = Math.max(baseHoldout, minimumHoldout);
  if (holdout === baseHoldout) {
    const raw = splitNames.map((name) => ({
      name,
      raw: total * splitRatios[name],
      count: Math.floor(total * splitRatios[name])
    }));
    let remaining = total - raw.reduce((sum, row) => sum + row.count, 0);
    const tieOrder = { holdout: 0, validation: 1, development: 2 };
    raw.sort((left, right) => (
      (right.raw - right.count) - (left.raw - left.count)
      || tieOrder[left.name] - tieOrder[right.name]
    ));
    for (const row of raw) {
      if (remaining <= 0) break;
      row.count += 1;
      remaining -= 1;
    }
    return Object.fromEntries(raw.map((row) => [row.name, row.count]));
  }
  const remaining = total - holdout;
  const development = Math.round(remaining * (splitRatios.development / (splitRatios.development + splitRatios.validation)));
  return { development, validation: remaining - development, holdout };
}

function assignGroups(items = [], seed = "lynca-golden-sem-v1", minimumHoldout = 45) {
  const groups = new Map();
  for (const item of items) {
    const groupId = semanticIdentityGroup(item);
    const group = groups.get(groupId) || [];
    group.push(item);
    groups.set(groupId, group);
  }
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => (
    stableHash(`${seed}:${left}`).localeCompare(stableHash(`${seed}:${right}`))
  ));
  const targets = targetCounts(items.length, minimumHoldout);
  const assigned = Object.fromEntries(splitNames.map((name) => [name, []]));
  for (const [, groupItems] of orderedGroups) {
    const choices = splitNames.map((name) => ({
      name,
      remainingRatio: targets[name] > 0
        ? (targets[name] - assigned[name].length) / targets[name]
        : Number.NEGATIVE_INFINITY,
      overflow: Math.max(0, assigned[name].length + groupItems.length - targets[name])
    })).sort((left, right) => (
      right.remainingRatio - left.remainingRatio
      || left.overflow - right.overflow
      || splitNames.indexOf(left.name) - splitNames.indexOf(right.name)
    ));
    assigned[choices[0].name].push(...groupItems);
  }
  return { assigned, targets, groupCount: groups.size };
}

function frozenItem(item = {}) {
  const fieldRecords = plainObject(item.reviewed_ground_truth?.fields);
  const fields = {};
  const fieldStatuses = {};
  const evidenceSources = {};
  for (const field of goldenSemLaunchFields) {
    const record = plainObject(fieldRecords[field]);
    const status = reviewFieldStatus(record);
    fieldStatuses[field] = status;
    fields[field] = status === "CONFIRMED" ? reviewFieldValue(record) : status;
    evidenceSources[field] = asArray(record.evidence_sources).map(cleanText).filter(Boolean);
  }
  const criticalFields = goldenSemCriticalFields.filter((field) => fieldStatuses[field] === "CONFIRMED");
  return {
    item_id: cleanText(item.item_id),
    query_card_id: cleanText(item.item_id),
    source_feedback_id: cleanText(item.source_feedback_id) || null,
    identity_group_id: semanticIdentityGroup(item),
    recognition_input: {
      images: recognitionImages(item)
    },
    reviewed_ground_truth: {
      fields,
      field_statuses: fieldStatuses,
      evidence_sources: evidenceSources,
      reviewed_by: cleanText(item.reviewed_ground_truth?.reviewed_by),
      reviewed_at: cleanText(item.reviewed_ground_truth?.reviewed_at),
      sem_standard_version: SEM_STANDARD_VERSION
    },
    retrieval_ground_truth: {
      accepted_identity_ids: asArray(item.retrieval_ground_truth?.accepted_identity_ids).map(cleanText).filter(Boolean),
      accepted_candidate_ids: asArray(item.retrieval_ground_truth?.accepted_candidate_ids).map(cleanText).filter(Boolean),
      source: cleanText(item.retrieval_ground_truth?.source) || null
    },
    critical_fields: criticalFields,
    sealed_evaluation_reference: {
      writer_reviewed_title: cleanText(item.sealed_reference?.writer_reviewed_title),
      visible_to_recognition: false
    }
  };
}

function partitionPolicy(partition) {
  return {
    training_eligible: partition === "development",
    threshold_tuning_eligible: partition !== "holdout",
    catalog_promotion_eligible: partition === "development",
    reference_index_eligible: partition === "development",
    recognition_hint_eligible: false,
    frozen_holdout: partition === "holdout"
  };
}

function reviewPlanningGroup(item = {}) {
  const explicit = cleanText(item.split_group_id || item.card_identity_id);
  if (explicit) return explicit;
  const suggestion = plainObject(item.parser_suggestion?.fields);
  const identityFields = ["year", "manufacturer", "product", "set", "subject", "card_name", "card_number"];
  const identity = identityFields.map((field) => `${field}:${comparable(suggestion[field])}`).join("\n");
  const hasUsefulIdentity = ["year", "product", "subject"].filter((field) => comparable(suggestion[field])).length >= 2;
  if (hasUsefulIdentity) return `parser-plan:${stableHash(identity)}`;
  return `sealed-title:${stableHash(item.sealed_reference?.writer_reviewed_title || item.item_id)}`;
}

export function buildGoldenSemReviewWorklist(packet = {}) {
  const items = sourceItems(packet).map((item) => {
    const suggestions = plainObject(item.parser_suggestion?.fields);
    const fields = goldenSemLaunchFields.flatMap((field) => {
      const value = suggestions[field];
      if (!valuePresent(value)) return [];
      return [{
        field,
        parser_suggestion: value,
        operator_action: "CONFIRM_OR_CORRECT",
        reviewed_value: value,
        evidence_sources: [],
        reviewer_notes: ""
      }];
    });
    return {
      item_id: item.item_id,
      source_feedback_id: item.source_feedback_id,
      sealed_writer_title: item.sealed_reference?.writer_reviewed_title || "",
      image_count: item.recognition_input?.images?.length || 0,
      fields,
      review_complete: false
    };
  });
  return {
    schema_version: goldenSemReviewWorklistSchemaVersion,
    dataset_id: packet.dataset_id,
    generated_at: new Date().toISOString(),
    policy: {
      only_parser_populated_fields_require_confirmation: true,
      blank_fields_are_not_assumed_not_applicable: true,
      parser_suggestion_is_ground_truth: false
    },
    summary: {
      item_count: items.length,
      item_with_review_field_count: items.filter((item) => item.fields.length > 0).length,
      field_confirmation_count: items.reduce((sum, item) => sum + item.fields.length, 0),
      image_backed_item_count: items.filter((item) => item.image_count > 0).length,
      per_field: Object.fromEntries(goldenSemLaunchFields.map((field) => [
        field,
        items.filter((item) => item.fields.some((entry) => entry.field === field)).length
      ]))
    },
    items
  };
}

export function planGoldenSemReviewSplits(packet = {}, {
  seed = "lynca-golden-sem-v4-oracle",
  minimumHoldout = 45
} = {}) {
  const items = sourceItems(packet);
  const groups = new Map();
  for (const item of items) {
    const groupId = reviewPlanningGroup(item);
    const group = groups.get(groupId) || [];
    group.push(item);
    groups.set(groupId, group);
  }
  const ordered = [...groups.entries()].sort(([left], [right]) => (
    stableHash(`${seed}:${left}`).localeCompare(stableHash(`${seed}:${right}`))
  ));
  const targets = targetCounts(items.length, minimumHoldout);
  const assigned = Object.fromEntries(splitNames.map((name) => [name, []]));
  for (const [groupId, groupItems] of ordered) {
    const choice = splitNames.map((name) => ({
      name,
      deficit: targets[name] - assigned[name].length,
      overflow: Math.max(0, assigned[name].length + groupItems.length - targets[name])
    })).sort((left, right) => right.deficit - left.deficit || left.overflow - right.overflow)[0].name;
    assigned[choice].push(...groupItems.map((item) => ({ item_id: item.item_id, planning_group_id: groupId })));
  }
  return {
    schema_version: goldenSemSplitPlanSchemaVersion,
    dataset_id: packet.dataset_id,
    seed,
    status: "SEALED_ASSIGNMENT_PENDING_FIELD_REVIEW",
    policy: {
      minimum_holdout: minimumHoldout,
      holdout_visible_to_recognition_or_tuning: false,
      final_freeze_requires_reviewed_identity_groups: true
    },
    target_counts: targets,
    actual_counts: Object.fromEntries(splitNames.map((name) => [name, assigned[name].length])),
    partitions: assigned
  };
}

export function freezeGoldenSemReleaseSets(packet = {}, {
  version = "v1",
  seed = "lynca-golden-sem-v1",
  minimumHoldout = 45,
  now = () => new Date()
} = {}) {
  const validation = validateGoldenSemReviewPacket(packet, { requireApproved: true });
  if (!validation.ok) throw new Error(`Golden SEM review packet is not freeze-ready: ${validation.errors.join("; ")}`);
  const frozenAt = now().toISOString();
  const items = sourceItems(packet);
  const { assigned, targets, groupCount } = assignGroups(items, seed, minimumHoldout);
  const partitions = Object.fromEntries(splitNames.map((partition) => {
    const frozenItems = assigned[partition].map(frozenItem);
    return [partition, {
      schema_version: goldenSemPartitionSchemaVersion,
      dataset_id: packet.dataset_id,
      partition,
      version,
      frozen_at: frozenAt,
      sem_standard_version: SEM_STANDARD_VERSION,
      evaluation_truth_policy: plainObject(packet.evaluation_truth_policy),
      item_set_sha256: releaseSetItemSetSha256(frozenItems),
      data_policy: partitionPolicy(partition),
      items: frozenItems
    }];
  }));
  const identityGroups = Object.fromEntries(splitNames.map((partition) => [
    partition,
    new Set(partitions[partition].items.map((item) => item.identity_group_id))
  ]));
  const crossSplitOverlap = [];
  for (let leftIndex = 0; leftIndex < splitNames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < splitNames.length; rightIndex += 1) {
      const left = splitNames[leftIndex];
      const right = splitNames[rightIndex];
      for (const groupId of identityGroups[left]) {
        if (identityGroups[right].has(groupId)) crossSplitOverlap.push({ group_id: groupId, left, right });
      }
    }
  }
  if (crossSplitOverlap.length) throw new Error("Golden SEM split leaked identity groups across partitions");

  const holdout = partitions.holdout;
  const holdoutReleaseSet = {
    schema_version: "release-set-v1",
    set_id: `${packet.dataset_id}-core-holdout`,
    set_type: releaseSetTypes.CORE_HOLDOUT,
    version,
    frozen_at: frozenAt,
    item_set_sha256: releaseSetItemSetSha256(holdout.items),
    sem_standard_version: SEM_STANDARD_VERSION,
    evaluation_truth_policy: plainObject(packet.evaluation_truth_policy),
    leakage_policy: {
      exclude_from_training: true,
      exclude_query_images_from_reference_index: true,
      exclude_from_catalog_promotion: true,
      exclude_identity_from_catalog: false,
      exclude_from_threshold_tuning: true
    },
    items: holdout.items
  };
  const holdoutValidation = validateReleaseSetManifest(holdoutReleaseSet);
  if (!holdoutValidation.ok) {
    throw new Error(`Frozen holdout release set is invalid: ${holdoutValidation.errors.join("; ")}`);
  }

  return {
    schema_version: goldenSemReleaseBundleSchemaVersion,
    dataset_id: packet.dataset_id,
    version,
    frozen_at: frozenAt,
    sem_standard_version: SEM_STANDARD_VERSION,
    evaluation_truth_policy: plainObject(packet.evaluation_truth_policy),
    split_policy: {
      seed,
      ratios: splitRatios,
      minimum_holdout: minimumHoldout,
      target_counts: targets,
      actual_counts: Object.fromEntries(splitNames.map((partition) => [partition, partitions[partition].items.length])),
      identity_group_count: groupCount,
      cross_split_identity_overlap_count: crossSplitOverlap.length
    },
    partitions,
    holdout_release_set: holdoutReleaseSet,
    validation: {
      review_packet: validation,
      holdout_release_set: holdoutValidation
    }
  };
}

export function goldenSemPublicFields() {
  return semCanonicalEditableFields.filter((field) => goldenSemLaunchFields.includes(field));
}
