import { conflictSeverities } from "./types.mjs";
import {
  canonicalValueKey,
  normalizeChecklistCode,
  normalizeFieldValue,
  normalizeText,
  parseSerial,
  sourceIsOcr,
  sourceIsRegistry,
  sourceIsRetrieval,
  sourceIsSlab
} from "./normalizer.mjs";

function listFromMaybe(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function schemaRecords(productSchemas = []) {
  return listFromMaybe(productSchemas).filter((schema) => schema && typeof schema === "object");
}

function schemaMatchesIdentity(schema = {}, identity = {}) {
  if (!identity.product) return true;
  const product = normalizeText(schema.product || schema.product_name || schema.name).toLowerCase();
  return !product || product === normalizeText(identity.product).toLowerCase();
}

function collectSchemaValues(productSchemas, keys, identity = {}) {
  const values = [];
  schemaRecords(productSchemas)
    .filter((schema) => schemaMatchesIdentity(schema, identity))
    .forEach((schema) => {
      keys.forEach((key) => {
        const raw = schema[key];
        if (Array.isArray(raw)) values.push(...raw);
      });
    });
  return values;
}

function allowedChecklistCodes(productSchemas = [], registryRecords = [], identity = {}) {
  const schemaCodes = collectSchemaValues(productSchemas, ["checklist_codes", "checklistCodes", "collector_numbers", "collectorNumbers"], identity);
  const registryCodes = listFromMaybe(registryRecords).flatMap((record) => {
    const fields = record?.fields || record?.resolved || record || {};
    return [fields.checklist_code, fields.checklistCode, fields.collector_number, fields.collectorNumber].filter(Boolean);
  });
  return [...new Set([...schemaCodes, ...registryCodes].map(normalizeChecklistCode).filter(Boolean))];
}

function allowedCardTypes(productSchemas = [], identity = {}) {
  return [...new Set(collectSchemaValues(productSchemas, ["card_types", "cardTypes", "allowed_card_types", "allowedCardTypes"], identity)
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean))];
}

function violation(field, code, message, severity = conflictSeverities.HIGH) {
  return { field, code, message, severity };
}

export function validateCandidate(candidate = {}, context = {}) {
  const field = candidate.field;
  const value = normalizeFieldValue(field, candidate.value);
  const violations = [];

  if (field === "serial_number") {
    const parsed = parseSerial(value);
    if (parsed.serial && parsed.denominator !== null && !parsed.valid) {
      violations.push(violation(field, "invalid_serial_number", "serial numerator must be less than or equal to denominator"));
    }
  }

  if (field === "checklist_code") {
    const allowed = allowedChecklistCodes(context.productSchemas, context.registryRecords, context.identity || {});
    const normalized = normalizeChecklistCode(value);
    if (allowed.length && normalized && !allowed.includes(normalized)) {
      violations.push(violation(field, "checklist_registry_mismatch", "checklist_code does not match available product registry"));
    }
  }

  if (field === "players") {
    const hasAllowedSource = (candidate.evidence_items || []).some((item) => sourceIsSlab(item.source) || sourceIsOcr(item.source) || sourceIsRegistry(item.source) || sourceIsRetrieval(item.source));
    if (!hasAllowedSource) {
      violations.push(violation(field, "player_without_grounded_source", "player must come from slab, OCR, registry, or retrieval evidence"));
    }
  }

  if (field === "card_type") {
    const allowed = allowedCardTypes(context.productSchemas, context.identity || {});
    const normalized = normalizeText(value).toLowerCase();
    if (allowed.length && normalized && !allowed.includes(normalized)) {
      violations.push(violation(field, "card_type_schema_mismatch", "card_type does not exist in product schema"));
    }
  }

  return {
    valid: violations.length === 0,
    structural_validity: violations.length ? 0 : 1,
    violations
  };
}

export function validateIdentity(identity = {}, context = {}) {
  const conflicts = [];

  if (identity.serial_number) {
    const parsed = parseSerial(identity.serial_number);
    if (parsed.denominator !== null && !parsed.valid) {
      conflicts.push({
        field: "serial_number",
        conflict_type: "SERIAL_CONSTRAINT_VIOLATION",
        conflicting_values: [identity.serial_number],
        severity: conflictSeverities.HIGH,
        reason: "serial numerator must be less than or equal to denominator",
        resolved: false
      });
    }
  }

  if (identity.checklist_code) {
    const allowed = allowedChecklistCodes(context.productSchemas, context.registryRecords, identity);
    const normalized = normalizeChecklistCode(identity.checklist_code);
    if (allowed.length && normalized && !allowed.includes(normalized)) {
      conflicts.push({
        field: "checklist_code",
        conflict_type: "CHECKLIST_REGISTRY_MISMATCH",
        conflicting_values: [identity.checklist_code, ...allowed],
        severity: conflictSeverities.HIGH,
        reason: "checklist_code does not match available product registry",
        resolved: false
      });
    }
  }

  if (identity.card_type) {
    const allowed = allowedCardTypes(context.productSchemas, identity);
    const normalized = canonicalValueKey("card_type", identity.card_type);
    if (allowed.length && normalized && !allowed.includes(normalized)) {
      conflicts.push({
        field: "card_type",
        conflict_type: "CARD_TYPE_SCHEMA_MISMATCH",
        conflicting_values: [identity.card_type, ...allowed],
        severity: conflictSeverities.HIGH,
        reason: "card_type does not exist in product schema",
        resolved: false
      });
    }
  }

  return conflicts;
}
