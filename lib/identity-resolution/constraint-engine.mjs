import { conflictSeverities } from "./types.mjs";
import {
  canonicalValueKey,
  normalizeChecklistCode,
  normalizeFieldValue,
  normalizeSource,
  normalizeText,
  parseSerial,
  sourceIsOcr,
  sourceIsMarketplace,
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

function aggregationValuesForFields(aggregation = {}, fields = []) {
  return fields.flatMap((field) => {
    const groups = aggregation.fields?.[field] || {};
    return Object.values(groups).map((group) => group.value).filter(Boolean);
  });
}

function descriptorCollidesWithProductIdentity(value, context = {}) {
  const candidate = normalizeText(value).toLowerCase();
  if (!candidate) return false;
  return aggregationValuesForFields(context.aggregation, ["product", "set", "brand", "manufacturer"])
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean)
    .some((identityValue) => identityValue === candidate);
}

function candidateHasGroundedIdentitySource(candidate = {}) {
  return (candidate.evidence_items || []).some((item) => {
    return sourceIsSlab(item.source)
      || sourceIsOcr(item.source)
      || sourceIsRegistry(item.source)
      || (sourceIsRetrieval(item.source) && !sourceIsMarketplace(item.source));
  });
}

function groundedIdentityRule(field) {
  return {
    code: `${field}_without_grounded_source`,
    field,
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ candidate, field }) {
      return candidateHasGroundedIdentitySource(candidate)
        ? null
        : violation(field, this.code, `${field} must come from slab, printed/OCR text, registry, or non-marketplace retrieval evidence`, this.severity);
    }
  };
}

function descriptorProductCollisionRule(field) {
  return {
    code: `${field}_collides_with_product_identity`,
    field,
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field, context }) {
      return descriptorCollidesWithProductIdentity(value, context)
        ? violation(field, this.code, `${field} cannot duplicate product, set, brand, or manufacturer identity`, this.severity)
        : null;
    }
  };
}

const candidateConstraintRules = Object.freeze([
  {
    code: "invalid_serial_number",
    field: "serial_number",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field }) {
      const parsed = parseSerial(value);
      return parsed.serial && parsed.denominator !== null && !parsed.valid
        ? violation(field, this.code, "serial numerator must be less than or equal to denominator", this.severity)
        : null;
    }
  },
  {
    code: "checklist_registry_mismatch",
    field: "checklist_code",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field, context }) {
      const allowed = allowedChecklistCodes(context.productSchemas, context.registryRecords, context.identity || {});
      const normalized = normalizeChecklistCode(value);
      return allowed.length && normalized && !allowed.includes(normalized)
        ? violation(field, this.code, "checklist_code does not match available product registry", this.severity)
        : null;
    }
  },
  {
    code: "player_without_grounded_source",
    field: "players",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ candidate, field }) {
      const hasAllowedSource = (candidate.evidence_items || []).some((item) => {
        return !sourceIsMarketplace(item.source) && normalizeSource(item.source) !== "VISUAL_GUESS";
      });
      return !hasAllowedSource
        ? violation(field, this.code, "player cannot be marketplace-only or pure visual guess evidence", this.severity)
        : null;
    }
  },
  groundedIdentityRule("parallel"),
  groundedIdentityRule("variation"),
  groundedIdentityRule("rc"),
  groundedIdentityRule("first_bowman"),
  groundedIdentityRule("ssp"),
  groundedIdentityRule("case_hit"),
  descriptorProductCollisionRule("insert"),
  descriptorProductCollisionRule("card_type"),
  descriptorProductCollisionRule("parallel"),
  descriptorProductCollisionRule("variation"),
  {
    code: "card_type_schema_mismatch",
    field: "card_type",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field, context }) {
      const allowed = allowedCardTypes(context.productSchemas, context.identity || {});
      const normalized = normalizeText(value).toLowerCase();
      return allowed.length && normalized && !allowed.includes(normalized)
        ? violation(field, this.code, "card_type does not exist in product schema", this.severity)
        : null;
    }
  }
]);

function severityPenalty(severity) {
  return {
    [conflictSeverities.HIGH]: 1,
    [conflictSeverities.MEDIUM]: 0.55,
    [conflictSeverities.LOW]: 0.25
  }[severity] ?? 0.5;
}

function scoreConstraintViolations(weightedViolations = []) {
  const penalty = weightedViolations.reduce((sum, item) => {
    return sum + Number(item.weight || 0) * severityPenalty(item.violation?.severity);
  }, 0);
  return Math.max(0, Number((1 - Math.min(1, penalty)).toFixed(4)));
}

function evaluateCandidateConstraintRules(candidate = {}, context = {}) {
  const field = candidate.field;
  const value = normalizeFieldValue(field, candidate.value);

  return candidateConstraintRules
    .filter((rule) => rule.field === field)
    .map((rule) => ({
      rule,
      violation: rule.evaluate({ candidate, context, field, value }),
      weight: rule.weight
    }))
    .filter((item) => item.violation);
}

export function validateCandidate(candidate = {}, context = {}) {
  const weightedViolations = evaluateCandidateConstraintRules(candidate, context);
  const structuralValidity = scoreConstraintViolations(weightedViolations);
  const violations = weightedViolations.map((item) => ({
    ...item.violation,
    weight: item.weight,
    score_penalty: Number((Number(item.weight || 0) * severityPenalty(item.violation?.severity)).toFixed(4))
  }));

  return {
    valid: structuralValidity > 0,
    structural_validity: structuralValidity,
    constraint_score: structuralValidity,
    evaluated_rules: candidateConstraintRules
      .filter((rule) => rule.field === candidate.field)
      .map((rule) => ({ code: rule.code, weight: rule.weight, severity: rule.severity })),
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
