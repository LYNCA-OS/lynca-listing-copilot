import { conflictSeverities, detectedConflictFields } from "./types.mjs";
import {
  canonicalValueKey,
  sourceIsOcr,
  sourceIsRegistry,
  sourceIsRetrieval,
  sourceIsSlab
} from "./normalizer.mjs";

const severityByField = Object.freeze({
  serial_number: conflictSeverities.HIGH,
  multi_card: conflictSeverities.HIGH,
  card_count: conflictSeverities.HIGH,
  lot_type: conflictSeverities.HIGH,
  product: conflictSeverities.HIGH,
  players: conflictSeverities.HIGH,
  card_type: conflictSeverities.HIGH,
  official_card_type: conflictSeverities.HIGH,
  observable_components: conflictSeverities.MEDIUM,
  checklist_code: conflictSeverities.HIGH,
  parallel_exact: conflictSeverities.MEDIUM,
  parallel: conflictSeverities.MEDIUM,
  parallel_family: conflictSeverities.MEDIUM,
  surface_color: conflictSeverities.MEDIUM,
  year: conflictSeverities.MEDIUM,
  grade_company: conflictSeverities.MEDIUM,
  card_grade: conflictSeverities.MEDIUM,
  auto_grade: conflictSeverities.MEDIUM,
  grade_type: conflictSeverities.MEDIUM
});

function valueText(value) {
  return Array.isArray(value) ? value.join(" / ") : String(value ?? "");
}

function uniqueValues(items = [], predicate) {
  const values = new Map();
  items.filter(predicate).forEach((item) => {
    const key = canonicalValueKey(item.field, item.value);
    if (key) values.set(key, item.value);
  });
  return [...values.values()];
}

function sourceGroupsForField(groups = []) {
  const items = groups.flatMap((group) => group.evidence_items);
  const ocrValues = uniqueValues(items, (item) => sourceIsOcr(item.source));
  const slabValues = uniqueValues(items, (item) => sourceIsSlab(item.source));
  const registryValues = uniqueValues(items, (item) => sourceIsRegistry(item.source));
  const retrievalValues = uniqueValues(items, (item) => sourceIsRetrieval(item.source));

  return {
    ocr_values: ocrValues,
    slab_values: slabValues,
    registry_values: registryValues,
    retrieval_values: retrievalValues,
    has_ocr_conflict: ocrValues.length > 1,
    has_registry_conflict: registryValues.length > 1,
    has_retrieval_conflict: retrievalValues.length > 1,
    has_slab_ocr_conflict: slabValues.length > 0 && ocrValues.some((value) => !slabValues.some((slab) => valueText(slab).toLowerCase() === valueText(value).toLowerCase())),
    has_registry_ocr_conflict: registryValues.length > 0 && ocrValues.some((value) => !registryValues.some((registry) => valueText(registry).toLowerCase() === valueText(value).toLowerCase()))
  };
}

function conflictType(field, groups) {
  if (groups.has_slab_ocr_conflict) return "SLAB_OCR_CONFLICT";
  if (groups.has_registry_ocr_conflict) return "REGISTRY_OCR_CONFLICT";
  if (groups.has_ocr_conflict) return "OCR_CONFLICT";
  if (groups.has_registry_conflict) return "REGISTRY_CONFLICT";
  if (groups.has_retrieval_conflict) return "RETRIEVAL_CONFLICT";
  return `${field.toUpperCase()}_MISMATCH`;
}

export function detectConflicts(aggregation = {}) {
  const conflicts = [];
  const fields = aggregation.fields || {};

  Object.entries(fields).forEach(([field, grouped]) => {
    if (!detectedConflictFields.includes(field)) return;
    const groups = Object.values(grouped || {});
    if (groups.length <= 1) return;

    const sourceGroups = sourceGroupsForField(groups);
    conflicts.push({
      field,
      conflict_type: conflictType(field, sourceGroups),
      conflicting_values: groups.map((group) => group.value),
      severity: severityByField[field] || conflictSeverities.LOW,
      source_groups: sourceGroups,
      resolved: false
    });
  });

  return conflicts;
}

export function groupConflictsByField(conflicts = []) {
  return (Array.isArray(conflicts) ? conflicts : []).reduce((acc, conflict) => {
    acc[conflict.field] ||= [];
    acc[conflict.field].push(conflict);
    return acc;
  }, {});
}
