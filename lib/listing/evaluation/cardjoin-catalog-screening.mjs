import crypto from "node:crypto";

import { cardJoinDefaultGate, requiredCardJoinCoverage } from "./cardjoin-addressability.mjs";

export const cardJoinCatalogScreeningVersion = "cardjoin-catalog-screening-v1";

const identityFields = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_number",
  "print_finish",
  "serial_denominator"
]);

function cleanText(value) {
  return String(Array.isArray(value) ? value.join(" ") : value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function catalogFields(card = {}) {
  return {
    year: card.season_year || "",
    manufacturer: card.manufacturer || "",
    product: card.product || "",
    set: card.set_or_insert || card.subset || "",
    subject: card.players?.length ? card.players : card.metadata?.character || [],
    card_number: card.card_number || card.checklist_code || "",
    print_finish: card.surface_color || "",
    serial_denominator: card.serial_denominator || card.numerical_rarity?.denominator || ""
  };
}

function catalogSourceClass(card = {}) {
  const sourceType = String(card.source?.source_type || "").toUpperCase();
  if (/(?:OFFICIAL|CARDLIST|DATABASE)/.test(sourceType)) return "official";
  if (sourceType === "INTERNAL_CORRECTED_TITLE") {
    return card.source?.source_metadata?.writer_title_batch_id ? "writer" : "reviewed";
  }
  return "ineligible";
}

function sourceFeedbackId(card = {}) {
  return cleanText(card.source?.source_metadata?.source_feedback_id);
}

function sha256Value(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^(?:sha256:)?[a-f0-9]{64}$/.test(text) ? text.replace(/^sha256:/, "") : "";
}

function textSet(value) {
  return new Set((Array.isArray(value) ? value : []).map((entry) => String(entry ?? "").trim()).filter(Boolean));
}

function hashSet(value) {
  return new Set((Array.isArray(value) ? value : []).map(sha256Value).filter(Boolean));
}

function validFrozenManifest(manifest = {}) {
  const leakage = manifest.leakage_check || {};
  return Boolean(
    manifest.schema_version
    && manifest.frozen_assignment_id
    && sha256Value(manifest.source_fingerprint_sha256)
    && Number(leakage.development_validation) === 0
    && Number(leakage.development_holdout) === 0
    && Number(leakage.validation_holdout) === 0
  );
}

function catalogLineage(card = {}) {
  const source = card.source || {};
  const metadata = source.source_metadata || {};
  return {
    source_ids: textSet([
      source.id,
      source.source_id,
      metadata.source_id,
      metadata.source_feedback_id,
      ...(Array.isArray(metadata.derived_from_source_ids) ? metadata.derived_from_source_ids : [])
    ]),
    content_hashes: hashSet([
      source.source_version,
      source.content_sha256,
      metadata.source_file_sha256,
      metadata.content_sha256,
      ...(Array.isArray(metadata.derived_from_content_sha256) ? metadata.derived_from_content_sha256 : [])
    ])
  };
}

function identityKey(fields = {}) {
  return identityFields.map((field) => `${field}:${cleanText(fields[field])}`).join("|");
}

function allKnownFieldsMatch(truth = {}, candidate = {}) {
  return identityFields.every((field) => (
    !cleanText(truth[field]) || cleanText(truth[field]) === cleanText(candidate[field])
  ));
}

function sameCoreAnchor(truth = {}, candidate = {}) {
  const truthNumber = cleanText(truth.card_number);
  const truthSubject = cleanText(truth.subject);
  return Boolean(
    (truthNumber && truthNumber === cleanText(candidate.card_number))
    || (truthSubject && truthSubject === cleanText(candidate.subject))
  );
}

function partitionByItemId(manifest = {}) {
  const output = new Map();
  for (const split of ["development", "validation"]) {
    for (const itemId of manifest.partitions?.[split] || []) output.set(String(itemId), split);
  }
  return output;
}

function validTruthItem(item = {}, partitions = new Map()) {
  const truth = item.retrieval_ground_truth || {};
  const provenance = truth.provenance || {};
  const split = partitions.get(String(item.item_id));
  return Boolean(
    split
    && truth.retrieval_evaluable === true
    && truth.accepted_identity_ids?.[0]
    && truth.identity_fields
    && (cleanText(truth.identity_fields.card_number) || cleanText(truth.identity_fields.subject))
    && provenance.source_id
    && sha256Value(provenance.source_version)
    && provenance.independent_from_system_under_test === true
    && provenance.sealed_from_system === true
    && Array.isArray(truth.sealed_source_candidate_ids)
    && truth.sealed_source_candidate_ids.length > 0
  );
}

function identityGroups(dataset = {}, manifest = {}) {
  if (!validFrozenManifest(manifest)) throw new Error("INVALID_FROZEN_SOURCE_MANIFEST");
  const partitions = partitionByItemId(manifest);
  const groups = new Map();
  for (const item of dataset.items || []) {
    if (!validTruthItem(item, partitions)) continue;
    const truth = item.retrieval_ground_truth;
    const identityId = String(truth.accepted_identity_ids[0]);
    const split = partitions.get(String(item.item_id));
    const current = groups.get(identityId);
    if (current && current.split !== split) {
      throw new Error(`identity group crosses frozen splits: ${identityId}`);
    }
    const group = current || {
      identity_id: identityId,
      split,
      truth: truth.identity_fields,
      item_ids: [],
      source_feedback_ids: new Set(),
      sealed_source_candidate_ids: new Set(),
      truth_provenance: []
    };
    group.item_ids.push(String(item.item_id));
    group.source_feedback_ids.add(cleanText(item.source_feedback_id || item.item_id));
    for (const id of truth.sealed_source_candidate_ids || []) group.sealed_source_candidate_ids.add(String(id));
    group.truth_provenance.push(truth.provenance);
    groups.set(identityId, group);
  }
  return [...groups.values()];
}

function sourcePresence(rows = []) {
  return Object.fromEntries(["official", "writer", "reviewed"].map((source) => [
    source,
    rows.some((row) => row.source_class === source)
  ]));
}

function countRows(rows = [], predicate) {
  return rows.filter(predicate).length;
}

function splitMetrics(rows = []) {
  return {
    denominator: rows.length,
    product_year_present: countRows(rows, (row) => row.product_year_present),
    core_present: countRows(rows, (row) => row.core_present),
    core_unique: countRows(rows, (row) => row.core_unique),
    all_known_exact_unique: countRows(rows, (row) => row.all_known_exact_unique),
    product_year_presence_rate: rate(countRows(rows, (row) => row.product_year_present), rows.length),
    core_presence_rate: rate(countRows(rows, (row) => row.core_present), rows.length),
    core_unique_rate: rate(countRows(rows, (row) => row.core_unique), rows.length),
    all_known_exact_unique_rate: rate(countRows(rows, (row) => row.all_known_exact_unique), rows.length)
  };
}

export function screenCardJoinCatalog({ dataset = {}, manifest = {}, catalog = {} } = {}) {
  const groups = identityGroups(dataset, manifest);
  const eligibleCatalog = (catalog.cards || []).flatMap((card) => {
    const sourceClass = catalogSourceClass(card);
    return sourceClass === "ineligible" ? [] : [{ card, fields: catalogFields(card), source_class: sourceClass }];
  });
  const productYearIndex = new Map();
  for (const row of eligibleCatalog) {
    const key = `${cleanText(row.fields.year)}::${cleanText(row.fields.product)}`;
    const bucket = productYearIndex.get(key) || [];
    bucket.push(row);
    productYearIndex.set(key, bucket);
  }

  const rows = groups.map((group) => {
    const key = `${cleanText(group.truth.year)}::${cleanText(group.truth.product)}`;
    const productYearRows = productYearIndex.get(key) || [];
    const truthSourceIds = textSet(group.truth_provenance.map((entry) => entry.source_id));
    const truthSourceHashes = hashSet(group.truth_provenance.map((entry) => entry.source_version));
    const isSelf = (row) => {
      const lineage = catalogLineage(row.card);
      return group.sealed_source_candidate_ids.has(String(row.card.id))
        || group.source_feedback_ids.has(sourceFeedbackId(row.card))
        || [...lineage.source_ids].some((id) => truthSourceIds.has(id) || group.source_feedback_ids.has(cleanText(id)))
        || [...lineage.content_hashes].some((hash) => truthSourceHashes.has(hash));
    };
    const independentRows = productYearRows.filter((row) => !isSelf(row));
    const selfCoreRows = productYearRows.filter((row) => isSelf(row) && sameCoreAnchor(group.truth, row.fields));
    const coreRows = independentRows.filter((row) => sameCoreAnchor(group.truth, row.fields));
    const coreIdentityKeys = new Set(coreRows.map((row) => identityKey(row.fields)));
    const exactRows = independentRows.filter((row) => allKnownFieldsMatch(group.truth, row.fields));
    const exactIdentityKeys = new Set(exactRows.map((row) => identityKey(row.fields)));
    const coreUnique = coreIdentityKeys.size === 1;
    const exactUnique = exactIdentityKeys.size === 1;
    const classification = exactUnique
      ? "UNIQUE_EXACT"
      : coreRows.length > 0
        ? "PRESENT_AMBIGUOUS"
        : selfCoreRows.length > 0
          ? "SELF_SOURCE_ONLY"
          : "CATALOG_ROW_ABSENT";
    return {
      identity_id: group.identity_id,
      split: group.split,
      item_count: group.item_ids.length,
      item_ids: group.item_ids,
      classification,
      product_year_present: independentRows.length > 0,
      core_present: coreRows.length > 0,
      core_unique: coreUnique,
      all_known_exact_unique: exactUnique,
      independent_product_year_row_count: independentRows.length,
      independent_core_row_count: coreRows.length,
      independent_core_identity_count: coreIdentityKeys.size,
      independent_exact_identity_count: exactIdentityKeys.size,
      self_core_row_count: selfCoreRows.length,
      source_presence: sourcePresence(coreRows),
      truth_provenance: group.truth_provenance
    };
  });

  const development = rows.filter((row) => row.split === "development");
  const validation = rows.filter((row) => row.split === "validation");
  const requiredCoverage = requiredCardJoinCoverage();
  const split = {
    development: splitMetrics(development),
    validation: splitMetrics(validation)
  };
  for (const [splitName, value] of Object.entries(split)) {
    value.required_unique_count = Math.ceil(value.denominator * requiredCoverage);
    value.minimum_denominator = splitName === "development"
      ? cardJoinDefaultGate.minimum_development
      : cardJoinDefaultGate.minimum_validation;
    value.denominator_passed = value.denominator >= value.minimum_denominator;
    value.gate_passed = value.denominator_passed
      && value.all_known_exact_unique >= value.required_unique_count;
  }
  const sourceCounts = Object.fromEntries(["official", "writer", "reviewed"].map((source) => [
    source,
    rows.filter((row) => row.source_presence[source]).length
  ]));
  const totalDevVal = (manifest.actual_counts?.development || 0) + (manifest.actual_counts?.validation || 0);
  const report = {
    schema_version: cardJoinCatalogScreeningVersion,
    generated_at: new Date().toISOString(),
    route: "NO_FULL_PROVIDER",
    scope: "DEVELOPMENT_VALIDATION_ONLY",
    holdout_consumed: false,
    status: split.development.gate_passed && split.validation.gate_passed ? "GO" : "NO_GO",
    gate: {
      required_addressable_coverage: requiredCoverage,
      development_passed: split.development.gate_passed,
      validation_passed: split.validation.gate_passed,
      combined_result_is_not_a_release_gate: true
    },
    denominator: {
      labeled_rows: rows.reduce((sum, row) => sum + row.item_count, 0),
      identity_groups: rows.length,
      total_frozen_devval_rows: totalDevVal,
      labeled_row_coverage: rate(rows.reduce((sum, row) => sum + row.item_count, 0), totalDevVal)
    },
    catalog: {
      total_rows: (catalog.cards || []).length,
      eligible_rows: eligibleCatalog.length,
      source_row_counts: Object.fromEntries(["official", "writer", "reviewed"].map((source) => [
        source,
        eligibleCatalog.filter((row) => row.source_class === source).length
      ]))
    },
    split,
    combined: splitMetrics(rows),
    core_source_identity_group_counts: sourceCounts,
    classification_counts: Object.fromEntries([
      "UNIQUE_EXACT",
      "PRESENT_AMBIGUOUS",
      "SELF_SOURCE_ONLY",
      "CATALOG_ROW_ABSENT"
    ].map((classification) => [classification, rows.filter((row) => row.classification === classification).length])),
    rows
  };
  report.report_sha256 = crypto.createHash("sha256")
    .update(JSON.stringify({ ...report, generated_at: null, report_sha256: null }))
    .digest("hex");
  return report;
}
